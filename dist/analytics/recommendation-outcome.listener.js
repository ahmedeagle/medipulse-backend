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
var RecommendationOutcomeListener_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecommendationOutcomeListener = void 0;
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const schedule_1 = require("@nestjs/schedule");
const ai_recommendation_entity_1 = require("../ai/entities/ai-recommendation.entity");
const domain_events_1 = require("../events/domain-events");
const recommendation_type_enum_1 = require("../common/enums/recommendation-type.enum");
let RecommendationOutcomeListener = RecommendationOutcomeListener_1 = class RecommendationOutcomeListener {
    constructor(recRepo) {
        this.recRepo = recRepo;
        this.logger = new common_1.Logger(RecommendationOutcomeListener_1.name);
    }
    async onOrderDelivered(event) {
        try {
            const productIds = event.items.map((i) => i.productId);
            if (!productIds.length)
                return;
            const recs = await this.recRepo
                .createQueryBuilder('r')
                .where('r.pharmacyTenantId = :tenantId', { tenantId: event.pharmacyTenantId })
                .andWhere('r.productId IN (:...productIds)', { productIds })
                .andWhere('r.type = :type', { type: recommendation_type_enum_1.RecommendationType.REORDER })
                .andWhere('r.riskLevel = :risk', { risk: 'HIGH' })
                .andWhere('r.outcome IS NULL')
                .andWhere('r.isDismissed = false')
                .getMany();
            if (!recs.length)
                return;
            await this.recRepo
                .createQueryBuilder()
                .update()
                .set({ outcome: 'acted_on', outcomeAt: new Date() })
                .where('id IN (:...ids)', { ids: recs.map((r) => r.id) })
                .execute();
            this.logger.log(`Marked ${recs.length} recommendation(s) as acted_on for tenant ${event.pharmacyTenantId}`);
        }
        catch (err) {
            this.logger.error(`RecommendationOutcome update failed: ${err.message}`);
        }
    }
    async markIgnored() {
        const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
        const result = await this.recRepo
            .createQueryBuilder()
            .update()
            .set({ outcome: 'ignored', outcomeAt: new Date() })
            .where('outcome IS NULL')
            .andWhere('riskLevel = :risk', { risk: 'HIGH' })
            .andWhere('"createdAt" <= :cutoff', { cutoff: sevenDaysAgo })
            .andWhere('"isDismissed" = false')
            .execute();
        if (result.affected) {
            this.logger.log(`Marked ${result.affected} recommendation(s) as ignored`);
        }
    }
};
exports.RecommendationOutcomeListener = RecommendationOutcomeListener;
__decorate([
    (0, event_emitter_1.OnEvent)(domain_events_1.EVENTS.ORDER_DELIVERED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [domain_events_1.OrderDeliveredEvent]),
    __metadata("design:returntype", Promise)
], RecommendationOutcomeListener.prototype, "onOrderDelivered", null);
__decorate([
    (0, schedule_1.Cron)('0 5 * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], RecommendationOutcomeListener.prototype, "markIgnored", null);
exports.RecommendationOutcomeListener = RecommendationOutcomeListener = RecommendationOutcomeListener_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(ai_recommendation_entity_1.AiRecommendation)),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], RecommendationOutcomeListener);
//# sourceMappingURL=recommendation-outcome.listener.js.map