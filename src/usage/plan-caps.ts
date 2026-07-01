/**
 * Plan tiers and their monthly usage caps for the two metered, cost-bearing
 * resources. `null` = unlimited (fair-use, enterprise-negotiated).
 *
 * These must match the pricing published on the marketing site so the numbers we
 * advertise are the numbers the system actually enforces.
 */
export type PlanTier = 'free' | 'starter' | 'pro' | 'enterprise';
export type MeteredResource = 'ai' | 'whatsapp';

export interface PlanCaps {
  /** User-initiated AI assistant requests per month. */
  aiRequests: number | null;
  /** Outbound WhatsApp conversations per month. */
  whatsappConversations: number | null;
}

export const PLAN_CAPS: Record<PlanTier, PlanCaps> = {
  free:       { aiRequests: 50,   whatsappConversations: 0 },
  starter:    { aiRequests: 500,  whatsappConversations: 0 },
  pro:        { aiRequests: 3000, whatsappConversations: 500 },
  enterprise: { aiRequests: null, whatsappConversations: null }, // unlimited / negotiated
};

export function capFor(tier: PlanTier, resource: MeteredResource): number | null {
  const caps = PLAN_CAPS[tier] ?? PLAN_CAPS.free;
  return resource === 'ai' ? caps.aiRequests : caps.whatsappConversations;
}

/** Current billing period key in 'YYYY-MM' (UTC). */
export function currentPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}
