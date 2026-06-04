"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RulesEngine = exports.RiskEngine = exports.DemandEngine = exports.SeasonalityEngine = void 0;
const recommendation_type_enum_1 = require("../common/enums/recommendation-type.enum");
const hijri_calendar_1 = require("../common/utils/hijri-calendar");
class SeasonalityEngine {
    constructor(date) {
        this.today = date ?? new Date();
    }
    getSignal(category) {
        return hijri_calendar_1.HijriCalendar.getCategoryMultiplier(this.today, category);
    }
    getMultiplierDelta(category) {
        const signal = this.getSignal(category);
        return signal.multiplier - 1.0;
    }
    getEventLabel() {
        const event = hijri_calendar_1.HijriCalendar.getActiveEvent(this.today);
        return event?.arabicName ?? 'No active event';
    }
}
exports.SeasonalityEngine = SeasonalityEngine;
class DemandEngine {
    getSignal(productId, orderHistory) {
        const now = Date.now();
        const DAY = 86_400_000;
        const items = orderHistory.filter((o) => o.productId === productId);
        const last30 = items.filter((o) => now - o.createdAt.getTime() <= 30 * DAY);
        const sum30 = last30.reduce((s, o) => s + o.quantity, 0);
        const sum90 = items.reduce((s, o) => s + o.quantity, 0);
        const avg30 = sum30 / 30;
        const avg90 = sum90 / 90;
        let trend = 'stable';
        if (avg90 > 0) {
            if (avg30 > avg90 * 1.1)
                trend = 'increasing';
            else if (avg30 < avg90 * 0.9)
                trend = 'decreasing';
        }
        const dailyUsage = avg30 > 0 ? avg30 : avg90;
        return { avg30, avg90, trend, dailyUsage };
    }
}
exports.DemandEngine = DemandEngine;
class RiskEngine {
    assess(stockDays, expectedNeedDays) {
        if (stockDays < expectedNeedDays)
            return 'HIGH';
        if (stockDays < expectedNeedDays * 1.5)
            return 'MEDIUM';
        return 'LOW';
    }
    stockDays(currentQuantity, dailyUsage) {
        if (dailyUsage <= 0)
            return 999;
        return Math.floor(currentQuantity / dailyUsage);
    }
    suggestedReorderQty(dailyUsage, currentQuantity, leadDays = 14) {
        const safetyBuffer = Math.ceil(dailyUsage * 7);
        const needed = Math.ceil(dailyUsage * leadDays);
        return Math.max(0, needed - currentQuantity + safetyBuffer);
    }
}
exports.RiskEngine = RiskEngine;
class RulesEngine {
    constructor() {
        this.demand = new DemandEngine();
        this.risk = new RiskEngine();
    }
    generateRecommendations(inventoryItems, supplierCatalog, orderHistory = [], ctx = {}) {
        const recs = [];
        const today = new Date();
        const { supplierScores = new Map(), consumptionData = new Map(), forecastData = new Map(), scheduleData = new Map(), } = ctx;
        const historyDays = orderHistory.length > 0
            ? Math.min(90, Math.ceil((Date.now() - Math.min(...orderHistory.map(o => o.createdAt.getTime()))) / 86_400_000))
            : 0;
        const hasInsufficientHistory = historyDays < 28;
        if (hasInsufficientHistory && inventoryItems.filter(i => i.quantity <= i.minThreshold).length > 0) {
            const lowStockCount = inventoryItems.filter(i => i.quantity <= i.minThreshold).length;
            recs.push({
                type: recommendation_type_enum_1.RecommendationType.INSUFFICIENT_DATA,
                productId: null,
                riskLevel: 'MEDIUM',
                payload: {
                    historyDays,
                    lowStockCount,
                    message: `${lowStockCount} product${lowStockCount !== 1 ? 's' : ''} below threshold detected. Order at least a few products to enable AI-powered demand forecasting. Currently showing threshold-based alerts only.`,
                    action: 'Place your first orders to enable intelligent recommendations',
                    daysOfHistoryNeeded: 28 - historyDays,
                },
            });
        }
        const seasonality = new SeasonalityEngine(today);
        const catalogByProduct = new Map();
        for (const item of supplierCatalog) {
            if (!catalogByProduct.has(item.productId))
                catalogByProduct.set(item.productId, []);
            catalogByProduct.get(item.productId).push(item);
        }
        for (const item of hasInsufficientHistory ? [] : inventoryItems.filter((i) => i.quantity <= i.minThreshold)) {
            const product = item.product;
            const productName = product?.name ?? 'Unknown';
            const category = product?.category ?? '';
            const signal = this.demand.getSignal(item.productId, orderHistory);
            const hijriSignal = seasonality.getSignal(category);
            const seasonMultiplier = hijriSignal.multiplier - 1.0;
            const adjustedDailyUsage = signal.dailyUsage * hijriSignal.multiplier;
            const schedule = scheduleData.get(item.productId);
            const effectiveLeadDays = schedule?.effectiveLeadTimeDays
                ? Number(schedule.effectiveLeadTimeDays)
                : 14;
            const stockDaysRemaining = this.risk.stockDays(item.quantity, adjustedDailyUsage);
            const riskLevel = this.risk.assess(stockDaysRemaining, effectiveLeadDays);
            const suggestedQty = schedule?.eoqQty
                ? Math.ceil(Number(schedule.eoqQty))
                : this.risk.suggestedReorderQty(adjustedDailyUsage, item.quantity, effectiveLeadDays);
            const availableListings = (catalogByProduct.get(item.productId) ?? []).filter((l) => l.isAvailable);
            const recommendedSupplier = this.pickBestSupplier(availableListings, supplierScores);
            recs.push({
                type: recommendation_type_enum_1.RecommendationType.REORDER,
                productId: item.productId,
                riskLevel,
                payload: {
                    productId: item.productId,
                    productName,
                    currentQuantity: item.quantity,
                    minThreshold: item.minThreshold,
                    deficit: item.minThreshold - item.quantity,
                    stockDays: stockDaysRemaining,
                    suggestedReorderQty: suggestedQty,
                    recommendedSupplier: recommendedSupplier
                        ? { tenantId: recommendedSupplier.supplierTenantId, reliabilityLabel: supplierScores.get(recommendedSupplier.supplierTenantId)?.reliabilityLabel ?? 'unknown' }
                        : null,
                    demand: {
                        avg30: Math.round(signal.avg30 * 10) / 10,
                        avg90: Math.round(signal.avg90 * 10) / 10,
                        trend: signal.trend,
                        dailyUsage: Math.round(adjustedDailyUsage * 10) / 10,
                    },
                    seasonality: {
                        event: hijriSignal.eventName,
                        source: hijriSignal.source,
                        multiplier: hijriSignal.multiplier,
                        adjustmentApplied: hijriSignal.multiplier !== 1.0,
                    },
                    eoq: schedule ? {
                        eoqQty: Number(schedule.eoqQty),
                        safetyStockQty: Number(schedule.safetyStockQty),
                        reorderPoint: Number(schedule.reorderPoint),
                        effectiveLeadDays,
                    } : null,
                    forecast: forecastData.get(item.productId) ? {
                        forecastedQty14d: Number(forecastData.get(item.productId).forecastedQty),
                        trend: forecastData.get(item.productId).trend,
                        ciLow: Number(forecastData.get(item.productId).confidenceIntervalLow),
                        ciHigh: Number(forecastData.get(item.productId).confidenceIntervalHigh),
                    } : null,
                },
            });
            if (availableListings.length > 1) {
                const sorted = [...availableListings].sort((a, b) => Number(a.price) - Number(b.price));
                const maxPrice = Number(sorted[sorted.length - 1].price);
                const options = sorted.map((l) => {
                    const price = Number(l.price);
                    const score = supplierScores.get(l.supplierTenantId);
                    return {
                        supplierTenantId: l.supplierTenantId,
                        supplierName: l.supplierTenant?.name ?? 'Unknown Supplier',
                        price,
                        currency: l.currency,
                        stock: l.stock,
                        savings: maxPrice > 0 ? Math.round(((maxPrice - price) / maxPrice) * 100) : 0,
                        reliabilityLabel: score?.reliabilityLabel ?? 'unknown',
                        reliabilityScore: score ? Number(score.overallScore) : null,
                    };
                });
                recs.push({
                    type: recommendation_type_enum_1.RecommendationType.PRICE_COMPARISON,
                    productId: item.productId,
                    riskLevel,
                    payload: {
                        productId: item.productId,
                        productName,
                        options,
                        cheapestSupplier: options[0].supplierName,
                        maxSavings: options[0].savings,
                    },
                });
            }
        }
        for (const item of inventoryItems) {
            const product = item.product;
            if (!product?.genericName)
                continue;
            const listings = catalogByProduct.get(item.productId) ?? [];
            if (listings.length > 0 && listings.some((l) => l.isAvailable))
                continue;
            const signal = this.demand.getSignal(item.productId, orderHistory);
            const riskLevel = this.risk.assess(this.risk.stockDays(item.quantity, signal.dailyUsage), 14);
            const alternatives = new Map();
            for (const catalogItem of supplierCatalog) {
                if (!catalogItem.isAvailable || catalogItem.productId === item.productId)
                    continue;
                const alt = catalogItem.product;
                if (!alt || alt.genericName !== product.genericName)
                    continue;
                if (!alternatives.has(alt.id))
                    alternatives.set(alt.id, { productId: alt.id, productName: alt.name, supplierCount: 0 });
                alternatives.get(alt.id).supplierCount += 1;
            }
            if (alternatives.size > 0) {
                recs.push({
                    type: recommendation_type_enum_1.RecommendationType.ALTERNATIVE,
                    productId: item.productId,
                    riskLevel,
                    payload: {
                        unavailableProductId: item.productId,
                        unavailableProductName: product.name,
                        genericName: product.genericName,
                        alternatives: Array.from(alternatives.values()).sort((a, b) => b.supplierCount - a.supplierCount),
                    },
                });
            }
        }
        if (consumptionData.size > 0) {
            for (const item of inventoryItems) {
                if (item.quantity === 0)
                    continue;
                const snapshots = consumptionData.get(item.productId) ?? [];
                const recentActivity = snapshots.slice(0, 8).some((s) => s.quantityConsumed > 0);
                if (!recentActivity && snapshots.length >= 8) {
                    recs.push({
                        type: recommendation_type_enum_1.RecommendationType.DEAD_STOCK_ALERT,
                        productId: item.productId,
                        riskLevel: 'LOW',
                        payload: {
                            productId: item.productId,
                            productName: item.product?.name ?? 'Unknown',
                            currentQuantity: item.quantity,
                            weeksWithoutMovement: snapshots.length,
                        },
                    });
                }
            }
        }
        if (consumptionData.size > 0) {
            for (const item of inventoryItems) {
                const snapshots = consumptionData.get(item.productId) ?? [];
                if (snapshots.length < 5)
                    continue;
                const current = snapshots[0].quantityConsumed;
                const avg4w = snapshots.slice(1, 5).reduce((s, r) => s + r.quantityConsumed, 0) / 4;
                if (avg4w > 0 && current > avg4w * 1.5) {
                    recs.push({
                        type: recommendation_type_enum_1.RecommendationType.CONSUMPTION_SPIKE,
                        productId: item.productId,
                        riskLevel: 'MEDIUM',
                        payload: {
                            productId: item.productId,
                            productName: item.product?.name ?? 'Unknown',
                            currentWeekQty: current,
                            avg4WeekQty: Math.round(avg4w),
                            spikePercent: Math.round(((current - avg4w) / avg4w) * 100),
                        },
                    });
                }
            }
        }
        if (forecastData.size > 0) {
            for (const item of inventoryItems) {
                const forecast = forecastData.get(item.productId);
                if (!forecast || forecast.trend !== 'increasing')
                    continue;
                const signal = this.demand.getSignal(item.productId, orderHistory);
                const current14d = signal.dailyUsage * 14;
                if (current14d > 0 &&
                    Number(forecast.forecastedQty) > current14d * 1.30) {
                    const increasePercent = Math.round(((Number(forecast.forecastedQty) - current14d) / current14d) * 100);
                    recs.push({
                        type: recommendation_type_enum_1.RecommendationType.FORECAST_ALERT,
                        productId: item.productId,
                        riskLevel: increasePercent >= 60 ? 'HIGH' : 'MEDIUM',
                        payload: {
                            productId: item.productId,
                            productName: item.product?.name ?? 'Unknown',
                            currentQuantity: item.quantity,
                            forecastedQty14d: Number(forecast.forecastedQty),
                            currentTrend14d: Math.round(current14d),
                            increasePercent,
                            ciLow: Number(forecast.confidenceIntervalLow),
                            ciHigh: Number(forecast.confidenceIntervalHigh),
                            algorithm: forecast.algorithm,
                        },
                    });
                }
            }
        }
        if (scheduleData.size > 0) {
            for (const item of inventoryItems) {
                const schedule = scheduleData.get(item.productId);
                if (!schedule?.reorderByDate || !schedule.daysUntilReorderNeeded)
                    continue;
                const days = Number(schedule.daysUntilReorderNeeded);
                if (days <= 7 && item.quantity > item.minThreshold) {
                    recs.push({
                        type: recommendation_type_enum_1.RecommendationType.REORDER_SCHEDULE,
                        productId: item.productId,
                        riskLevel: days <= 2 ? 'HIGH' : days <= 5 ? 'MEDIUM' : 'LOW',
                        payload: {
                            productId: item.productId,
                            productName: item.product?.name ?? 'Unknown',
                            currentQuantity: item.quantity,
                            reorderByDate: schedule.reorderByDate,
                            predictedStockoutDate: schedule.predictedStockoutDate,
                            daysUntilReorderNeeded: days,
                            eoqQty: Number(schedule.eoqQty),
                            recommendedSupplierTenantId: schedule.recommendedSupplierTenantId,
                        },
                    });
                }
            }
        }
        const riskOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
        return recs.sort((a, b) => riskOrder[a.riskLevel] - riskOrder[b.riskLevel]);
    }
    pickBestSupplier(listings, scores) {
        if (!listings.length)
            return null;
        return listings.reduce((best, listing) => {
            if (!best)
                return listing;
            const bestScore = Number(scores.get(best.supplierTenantId)?.overallScore ?? 0);
            const thisScore = Number(scores.get(listing.supplierTenantId)?.overallScore ?? 0);
            if (thisScore !== bestScore)
                return thisScore > bestScore ? listing : best;
            return Number(listing.price) < Number(best.price) ? listing : best;
        }, null);
    }
}
exports.RulesEngine = RulesEngine;
//# sourceMappingURL=rules.engine.js.map