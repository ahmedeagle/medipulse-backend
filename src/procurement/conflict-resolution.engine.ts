import { Injectable } from '@nestjs/common';
import {
  NormalizedSignalBundle,
  ConflictResolution,
  SupplierOptionWithScore,
} from './procurement-orchestrator.types';

export interface ResolveContext {
  currentStock: number;
  safetyStock: number;
}

export interface ResolvedBundle {
  signals: NormalizedSignalBundle;
  resolutions: ConflictResolution[];
  rejectedSuppliers: Array<{ supplierTenantId: string; reason: string }>;
  overpaymentWarning: boolean;
  excludeSlowSuppliers: boolean;
  p2pPreferred: boolean;
}

interface Rule {
  id: string;
  label: string;
  condition: (s: NormalizedSignalBundle, ctx: ResolveContext) => boolean;
  apply: (s: NormalizedSignalBundle, ctx: ResolveContext, result: ResolvedBundle) => void;
  outcomeWhenFired: (s: NormalizedSignalBundle) => string;
  outcomeWhenSkipped: string;
}

/** Clones only the mutable parts of the signal bundle (primitives + shallow arrays) */
function cloneBundle(s: NormalizedSignalBundle): NormalizedSignalBundle {
  return {
    ...s,
    p2pAvailable: [...s.p2pAvailable],
    supplierOptions: [...s.supplierOptions],
  };
}

@Injectable()
export class ConflictResolutionEngine {
  private readonly rules: Rule[] = [
    // R1: Cap qty when financially strained — but R2 overrides this
    {
      id: 'R1_FINANCIAL_CAP',
      label: 'Financial Cap',
      condition: (s, ctx) =>
        s.financialRisk === 'high' && ctx.currentStock >= ctx.safetyStock,
      apply: (s) => {
        s.qtyRequired = Math.floor(s.qtyRequired * 0.70);
      },
      outcomeWhenFired: (s) => `Qty capped to ${s.qtyRequired} units (–30%) — high financial risk`,
      outcomeWhenSkipped: 'not triggered',
    },

    // R2: Stockout override — fires when stock is critically low regardless of finances
    {
      id: 'R2_STOCKOUT_OVERRIDE',
      label: 'Critical Stockout Override',
      condition: (s, ctx) => ctx.currentStock < ctx.safetyStock,
      apply: (s, ctx, result) => {
        // Undo R1 if it fired — survival takes priority over finances
        const r1 = result.resolutions.find(r => r.rule === 'R1_FINANCIAL_CAP' && r.fired);
        if (r1) {
          r1.fired = false;
          r1.outcome = 'reversed by R2_STOCKOUT_OVERRIDE';
          s.qtyRequired = Math.ceil(s.qtyRequired / 0.70); // restore
        }
        s.urgencyScore = Math.min(100, s.urgencyScore + 40);
      },
      outcomeWhenFired: (s) =>
        `Stockout imminent — urgency boosted to ${s.urgencyScore}, financial cap reversed`,
      outcomeWhenSkipped: 'not triggered',
    },

    // R3: Market shortage detected → increase urgency + buffer
    {
      id: 'R3_MARKET_SHORTAGE_URGENCY',
      label: 'Market Shortage Urgency',
      condition: (s) => s.marketShortageRisk,
      apply: (s, _ctx, result) => {
        s.urgencyScore = Math.min(100, s.urgencyScore + 30);
        s.qtyRequired = Math.ceil(s.qtyRequired * 1.5);
        if (s.marketAvailabilityRate < 0.30) {
          result.excludeSlowSuppliers = true;
        }
      },
      outcomeWhenFired: (s) =>
        `Market shortage: urgency=${s.urgencyScore}, qty×1.5=${s.qtyRequired}${s.marketAvailabilityRate < 0.30 ? ', slow suppliers excluded' : ''}`,
      outcomeWhenSkipped: 'not triggered',
    },

    // R4: Remove unreliable suppliers unless there are no other options
    {
      id: 'R4_EXCLUDE_UNRELIABLE_SUPPLIERS',
      label: 'Exclude Unreliable Suppliers',
      condition: (s) => s.supplierOptions.some((sup) => sup.reliabilityScore < 50),
      apply: (s, _ctx, result) => {
        const unreliable: SupplierOptionWithScore[] = [];
        const reliable: SupplierOptionWithScore[] = [];
        for (const sup of s.supplierOptions) {
          if (sup.reliabilityScore < 50) unreliable.push(sup);
          else reliable.push(sup);
        }
        if (reliable.length > 0) {
          s.supplierOptions = reliable;
          for (const sup of unreliable) {
            result.rejectedSuppliers.push({
              supplierTenantId: sup.supplierTenantId,
              reason: `reliability score ${sup.reliabilityScore}/100 < 50 threshold`,
            });
          }
        }
        // If no reliable suppliers exist, keep all (unreliable is better than nothing)
      },
      outcomeWhenFired: () => 'Removed suppliers with reliability < 50 (fallback kept if none remain)',
      outcomeWhenSkipped: 'not triggered',
    },

    // R5: High price volatility → warn and prefer P2P for price stability
    {
      id: 'R5_PRICE_VOLATILITY_WARNING',
      label: 'Price Volatility Warning',
      condition: (s) => s.priceVolatility > 25,
      apply: (_s, _ctx, result) => {
        result.overpaymentWarning = true;
        result.p2pPreferred = true;
      },
      outcomeWhenFired: (s) =>
        `Price volatility ${s.priceVolatility.toFixed(1)}% >25% — prefer P2P, overpayment warning raised`,
      outcomeWhenSkipped: 'not triggered',
    },

    // R6: P2P is meaningfully cheaper → prefer P2P fill first
    {
      id: 'R6_P2P_PREFERENCE',
      label: 'P2P Cheaper Than Supplier',
      condition: (s) => {
        if (!s.p2pAvailable.length || !s.supplierOptions.length) return false;
        const cheapestP2P = Math.min(...s.p2pAvailable.map((l) => l.unitPrice));
        const cheapestSupplier = Math.min(...s.supplierOptions.map((sup) => sup.unitPrice));
        return cheapestP2P < cheapestSupplier * 0.95;
      },
      apply: (_s, _ctx, result) => {
        result.p2pPreferred = true;
      },
      outcomeWhenFired: () => 'P2P ≥5% cheaper than best supplier — P2P fill prioritized',
      outcomeWhenSkipped: 'not triggered',
    },
  ];

  apply(signals: NormalizedSignalBundle, ctx: ResolveContext): ResolvedBundle {
    const bundle = cloneBundle(signals);
    const result: ResolvedBundle = {
      signals: bundle,
      resolutions: [],
      rejectedSuppliers: [],
      overpaymentWarning: false,
      excludeSlowSuppliers: false,
      p2pPreferred: false,
    };

    for (const rule of this.rules) {
      const fired = rule.condition(bundle, ctx);
      if (fired) {
        rule.apply(bundle, ctx, result);
      }
      result.resolutions.push({
        rule: rule.id,
        fired,
        outcome: fired ? rule.outcomeWhenFired(bundle) : rule.outcomeWhenSkipped,
      });
    }

    return result;
  }
}
