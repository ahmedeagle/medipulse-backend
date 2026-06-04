"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeadStockService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const price_snapshot_entity_1 = require("../analytics/entities/price-snapshot.entity");
let DeadStockService = class DeadStockService {
    constructor(priceRepo, dataSource) {
        this.priceRepo = priceRepo;
        this.dataSource = dataSource;
    }
    async analyzeDeadStock(tenantId) {
        const dormantProducts = await this.dataSource.query(`
      SELECT
        s."productId",
        p.name                                                        AS "productName",
        i.quantity,
        i."expiryDate",
        -- Velocity features for logistic regression classifier
        COALESCE(AVG(s."quantityConsumed") FILTER (WHERE s."weekStart" >= NOW() - INTERVAL '7 days'),  0) AS "v7d",
        COALESCE(AVG(s."quantityConsumed") FILTER (WHERE s."weekStart" >= NOW() - INTERVAL '30 days'), 0) AS "v30d",
        COALESCE(AVG(s."quantityConsumed"),                                                            0) AS "v90d",
        COALESCE(
          EXTRACT(DAYS FROM NOW() - MAX(CASE WHEN s."quantityConsumed" > 0 THEN s."weekStart" END)),
          56
        )                                                                                                 AS "daysSinceLast",
        COUNT(s.id)                                                                                      AS "snapshotCount",
        MIN(s."weekStart")                                                                               AS "firstWeek"
      FROM consumption_snapshots s
      JOIN inventory_items i ON i."pharmacyTenantId" = s."tenantId"
                             AND i."productId"        = s."productId"
                             AND i."deletedAt" IS NULL
      JOIN products p        ON p.id = s."productId"
      WHERE s."tenantId" = $1
        AND i.quantity > 0
      GROUP BY s."productId", p.name, i.quantity, i."expiryDate"
      HAVING COUNT(s.id) >= 4   -- need at least 4 weeks for meaningful signal
      `, [tenantId]);
        const results = [];
        for (const row of dormantProducts) {
            const v7d = parseFloat(row.v7d);
            const v30d = parseFloat(row.v30d);
            const v90d = parseFloat(row.v90d);
            const daysSinceLast = parseFloat(row.daysSinceLast ?? '56');
            const probability = this.computeDeadStockProbability({
                velocity_7d: v7d,
                velocity_30d: v30d,
                velocity_90d: v90d,
                velocity_trend: v90d > 0.001 ? (v30d - v90d) / v90d : 0,
                days_since_last_sale: daysSinceLast,
                days_to_expiry: row.expiryDate
                    ? Math.max(0, Math.floor((new Date(row.expiryDate).getTime() - Date.now()) / 86_400_000))
                    : 180,
                product_age_weeks: row.firstWeek
                    ? Math.floor((Date.now() - new Date(row.firstWeek).getTime()) / (7 * 86_400_000))
                    : parseInt(row.snapshotCount, 10),
            });
            if (probability < 0.70)
                continue;
            const estimatedValue = await this.estimateValue(row.productId, row.quantity);
            const daysToExpiry = row.expiryDate
                ? Math.floor((new Date(row.expiryDate).getTime() - Date.now()) / 86_400_000)
                : null;
            const expiryRisk = daysToExpiry !== null && daysToExpiry <= 30 ? 'critical' :
                daysToExpiry !== null && daysToExpiry <= 90 ? 'high' : 'none';
            const weeksWithoutMovement = Math.round(daysSinceLast / 7);
            const { action, reason, urgencyScore } = this.recommendAction({
                daysToExpiry,
                expiryRisk,
                estimatedValue,
                weeksWithoutMovement,
            });
            const classifierConfidence = probability >= 0.90 ? 'high' : probability >= 0.80 ? 'medium' : 'low';
            results.push({
                productId: row.productId,
                productName: row.productName,
                currentQuantity: row.quantity,
                weeksWithoutMovement,
                estimatedValue,
                expiryRisk,
                daysToExpiry,
                recommendedAction: action,
                actionReason: reason,
                urgencyScore,
                deadStockProbability: Math.round(probability * 1000) / 1000,
                classifierConfidence,
            });
        }
        return results.sort((a, b) => b.urgencyScore - a.urgencyScore);
    }
    async getTotalDeadStockValue(tenantId) {
        const analyses = await this.analyzeDeadStock(tenantId);
        return {
            value: analyses.reduce((s, a) => s + a.estimatedValue, 0),
            count: analyses.length,
        };
    }
    async estimateValue(productId, quantity) {
        const latestPrice = await this.priceRepo
            .createQueryBuilder('p')
            .where('p.productId = :productId', { productId })
            .orderBy('p.recordedAt', 'DESC')
            .getOne();
        const unitCost = latestPrice ? Number(latestPrice.price) : 0;
        return Math.round(unitCost * quantity * 100) / 100;
    }
    computeDeadStockProbability(features) {
        const BIAS = -1.5;
        const W = {
            velocity_7d: -3.5,
            velocity_30d: -2.0,
            velocity_90d: -0.5,
            velocity_trend: -1.8,
            days_since_last_sale: 0.05,
            days_to_expiry: -0.01,
            product_age_weeks: -0.02,
        };
        const z = BIAS
            + W.velocity_7d * Math.min(features.velocity_7d, 10)
            + W.velocity_30d * Math.min(features.velocity_30d, 10)
            + W.velocity_90d * Math.min(features.velocity_90d, 10)
            + W.velocity_trend * Math.max(-2, Math.min(2, features.velocity_trend))
            + W.days_since_last_sale * Math.min(features.days_since_last_sale, 120)
            + W.days_to_expiry * Math.min(features.days_to_expiry, 365)
            + W.product_age_weeks * Math.min(features.product_age_weeks, 104);
        return 1 / (1 + Math.exp(-z));
    }
    recommendAction(params) {
        const { daysToExpiry, expiryRisk, estimatedValue, weeksWithoutMovement } = params;
        if (expiryRisk === 'critical') {
            return {
                action: 'return_to_supplier',
                reason: `Expires in ${daysToExpiry} days. Contact supplier immediately for return or exchange.`,
                urgencyScore: 95,
            };
        }
        if (expiryRisk === 'high' && estimatedValue >= 500) {
            return {
                action: 'markdown',
                reason: `Expires in ${daysToExpiry} days with SAR ${estimatedValue.toFixed(0)} at risk. Consider price reduction to accelerate sales.`,
                urgencyScore: 80,
            };
        }
        if (weeksWithoutMovement >= 16 && estimatedValue >= 1000) {
            return {
                action: 'return_to_supplier',
                reason: `${weeksWithoutMovement} weeks without movement. SAR ${estimatedValue.toFixed(0)} locked in slow-moving inventory. Request return authorization.`,
                urgencyScore: 70,
            };
        }
        if (weeksWithoutMovement >= 12) {
            return {
                action: 'markdown',
                reason: `${weeksWithoutMovement} weeks without movement. A price reduction or bundled offer may accelerate turnover.`,
                urgencyScore: 55,
            };
        }
        if (expiryRisk === 'none' && weeksWithoutMovement <= 10) {
            return {
                action: 'monitor',
                reason: `${weeksWithoutMovement} weeks without movement. Continue monitoring — may be seasonal.`,
                urgencyScore: 30,
            };
        }
        return {
            action: 'write_off',
            reason: `Long-standing dead stock. Consider writing off and rebalancing procurement budget.`,
            urgencyScore: 60,
        };
    }
};
exports.DeadStockService = DeadStockService;
exports.DeadStockService = DeadStockService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(price_snapshot_entity_1.PriceSnapshot)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.DataSource])
], DeadStockService);
//# sourceMappingURL=dead-stock.service.js.map