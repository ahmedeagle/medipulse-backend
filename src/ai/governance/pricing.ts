/**
 * AI model pricing — single source of truth for $ cost computation.
 *
 * Rates expressed in USD per 1 million tokens. Defaults track public OpenAI
 * list prices but EVERY model can be overridden at runtime via env vars so
 * we never need a redeploy when pricing changes:
 *
 *   AI_PRICE_<MODEL>_INPUT_PER_MTOK     (USD per 1M input tokens)
 *   AI_PRICE_<MODEL>_OUTPUT_PER_MTOK    (USD per 1M output tokens)
 *
 *   e.g. AI_PRICE_GPT_4O_MINI_INPUT_PER_MTOK=0.15
 *        AI_PRICE_GPT_4O_MINI_OUTPUT_PER_MTOK=0.60
 *
 * If a model is not in the table we fall back to the cheap-mini rate so a
 * misconfigured model name never silently over-bills the customer.
 */

export interface ModelRate {
  inputPerMTok:  number   // USD / 1M input tokens
  outputPerMTok: number   // USD / 1M output tokens
}

// Defaults — adjust here when OpenAI changes published pricing.
const DEFAULT_RATES: Record<string, ModelRate> = {
  'gpt-4o-mini':       { inputPerMTok: 0.15,  outputPerMTok: 0.60  },
  'gpt-4o':            { inputPerMTok: 2.50,  outputPerMTok: 10.00 },
  'gpt-4.1':           { inputPerMTok: 2.00,  outputPerMTok: 8.00  },
  'gpt-4.1-mini':      { inputPerMTok: 0.40,  outputPerMTok: 1.60  },
  'gpt-4.1-nano':      { inputPerMTok: 0.10,  outputPerMTok: 0.40  },
}

const FALLBACK_KEY = 'gpt-4o-mini'

function envKey(model: string, side: 'INPUT' | 'OUTPUT'): string {
  // gpt-4o-mini -> GPT_4O_MINI
  const slug = model.toUpperCase().replace(/[^A-Z0-9]/g, '_')
  return `AI_PRICE_${slug}_${side}_PER_MTOK`
}

/** Read effective rate honouring env overrides. */
export function rateFor(model: string, env: NodeJS.ProcessEnv = process.env): ModelRate {
  const fallback = DEFAULT_RATES[model] ?? DEFAULT_RATES[FALLBACK_KEY]
  const inOver  = Number(env[envKey(model, 'INPUT')]  ?? '')
  const outOver = Number(env[envKey(model, 'OUTPUT')] ?? '')
  return {
    inputPerMTok:  Number.isFinite(inOver)  && inOver  > 0 ? inOver  : fallback.inputPerMTok,
    outputPerMTok: Number.isFinite(outOver) && outOver > 0 ? outOver : fallback.outputPerMTok,
  }
}

/** USD cost for one call, given token counts and the model used. */
export function costFor(
  model:        string,
  inputTokens:  number,
  outputTokens: number,
  env:          NodeJS.ProcessEnv = process.env,
): { inputCostUsd: number; outputCostUsd: number; totalCostUsd: number } {
  const r = rateFor(model, env)
  const inputCostUsd  = (Math.max(0, inputTokens)  / 1_000_000) * r.inputPerMTok
  const outputCostUsd = (Math.max(0, outputTokens) / 1_000_000) * r.outputPerMTok
  return {
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd,
  }
}

/**
 * Blended cost from per-feature aggregate tokens — used when we don't have
 * per-call resolution (e.g. usageBreakdownToday rolls all calls per feature
 * into one bucket). Uses the blended fallback rate, which under-estimates
 * 4o usage and over-estimates nano usage. For exact per-model attribution
 * use the per-row breakdown in AiAuditLog instead.
 */
export function blendedCost(
  inputTokens:  number,
  outputTokens: number,
  modelHint?:   string,
  env:          NodeJS.ProcessEnv = process.env,
): { inputCostUsd: number; outputCostUsd: number; totalCostUsd: number } {
  return costFor(modelHint ?? FALLBACK_KEY, inputTokens, outputTokens, env)
}
