"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfidenceEngine = void 0;
class ConfidenceEngine {
    compute(params) {
        const factors = {};
        factors.historyDepth = Math.min(params.historyDays / 90, 1) * 0.40;
        factors.trendStability = params.trend === 'stable' ? 0.25 : 0.15;
        factors.seasonalCoverage = params.seasonalMultiplier > 0 ? 0.15 : 0.10;
        factors.supplierAvailability = params.suppliersAvailable > 0 ? 0.20 : 0.00;
        const score = Math.min(Object.values(factors).reduce((sum, v) => sum + v, 0), 1.0);
        const rounded = Math.round(score * 100) / 100;
        return {
            score: rounded,
            label: this.toLabel(rounded),
            factors,
        };
    }
    toLabel(score) {
        if (score >= 0.70)
            return 'high';
        if (score >= 0.40)
            return 'medium';
        return 'low';
    }
}
exports.ConfidenceEngine = ConfidenceEngine;
//# sourceMappingURL=confidence.engine.js.map