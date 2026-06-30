# MediPulse AI — Cost, Governance & Billing Reference

> Single source of truth for how the MediPulse AI assistant is priced, how its
> cost is controlled, and how that maps to customer billing/subscription tiers.
> Use this for finance planning, pricing pages, and the AI Center cost widget.

_Last reviewed: 2026-06-30._

---

## 1. The model

| | |
|---|---|
| **Model** | `gpt-4o-mini-2024-07-18` (pinned version) |
| **Why** | Cheapest current OpenAI tier; deterministic with `temperature: 0` |
| **List price** | **$0.15 / 1M input tokens**, **$0.60 / 1M output tokens** |
| **Configurable** | Yes — every rate is overridable via env (`AI_PRICE_GPT_4O_MINI_INPUT_PER_MTOK`, etc.) so a price change never needs a redeploy |

Each chat question makes **2 LLM calls**:
1. **Round 1** — deterministic tool dispatch (`tool_choice: required`, `max_tokens: 150`).
2. **Round 2** — writes a short Arabic headline (`max_tokens: 80`).

Output is hard-capped per call, so an answer can never "run away".

---

## 2. Real measured cost (not an estimate)

From production data for an active pharmacy:

| Day | Questions | Input tok | Output tok | Cost |
|---|---|---|---|---|
| Typical | 14 | 48,686 | 581 | **$0.0077** |
| Busiest | 27 | 70,644 | 1,227 | **$0.011** |

- **≈ $0.0005 per question** (about 0.05 ¢).
- **1,000 questions ≈ $0.55**.
- A busy pharmacy at 30 questions/day ≈ **$0.30 / month**.
- **1,000 active pharmacies ≈ ~$300 / month** total provider cost.

> Cost is **input-token dominated** — the system prompt + tool schemas (~3,500
> tokens) are sent on every call, while output is tiny (capped). This is why the
> hard money ceiling (Layer 12) counts input **and** output.

---

## 3. Governance layers (defense-in-depth)

Twelve independent controls. Each one alone limits spend; together they make
runaway cost effectively impossible.

| # | Layer | What it does | Where |
|---|---|---|---|
| 1 | **Cheapest model, pinned** | `gpt-4o-mini-2024-07-18`, never `gpt-4o` | `chat.service.ts` `CHAT_MODEL` |
| 2 | **Per-call output caps** | 150 + 80 tokens — answers can't be long/expensive | `chat.service.ts` `max_tokens` |
| 3 | **Request throttle** | 15 questions/min per user (30/min for execute) | `chat.controller.ts` `@Throttle` |
| 4 | **Per-tenant, per-feature daily token budget** | chat = 25% of 200k = **50,000 output tok/day**; isolated buckets | `token-budget.ts` |
| 5 | **Budget isolation** | A chat loop can't starve procurement (separate buckets) | `token-budget.ts` `AiFeature` |
| 6 | **5-minute answer cache** | Repeat question within 5 min = **0 tokens** | `chat.service.ts` `answerCache` |
| 7 | **Resolved-answer shortcut** | Previously-resolved question served from DB = **0 tokens** | `chat.service.ts` `findResolvedAnswer` |
| 8 | **Rules-engine fallback** | When budget is exhausted, the system answers with rules only (no LLM) | `ai/rules.engine.ts` |
| 9 | **Cost visibility UI** | "تكلفة الذكاء الاصطناعي اليوم" widget, 80% / 100% warnings | AI Center |
| 10 | **Per-call audit log** | Every call logged with token + USD attribution | `ai_audit_logs` |
| 11 | **Env-tunable caps & pricing** | Change caps/prices with no redeploy | env vars |
| 12 | **Hard USD/day ceiling per tenant** | Optional money kill-switch (input+output); falls back to rules-only | `token-budget.ts` `AI_DAILY_COST_CAP_USD` |

### Key env knobs

```bash
# Token caps
AI_DAILY_OUTPUT_TOKEN_CAP=200000          # global/day, split per feature
AI_DAILY_OUTPUT_TOKEN_CAP_CHAT=50000      # override a single feature

# Hard money ceiling per tenant per day (USD). 0 = disabled.
AI_DAILY_COST_CAP_USD=1                    # recommended: $1/pharmacy/day

# Pricing overrides (no redeploy on OpenAI price changes)
AI_PRICE_GPT_4O_MINI_INPUT_PER_MTOK=0.15
AI_PRICE_GPT_4O_MINI_OUTPUT_PER_MTOK=0.60
```

> **Recommended production setting:** `AI_DAILY_COST_CAP_USD=1`. That allows
> ~1,800 questions/pharmacy/day (effectively unlimited for real use) while
> guaranteeing the most any single pharmacy can ever cost in a day is $1.

---

## 4. Advanced AI features (all OFF by default, additive, fail-safe)

These are intelligence layers that never change live logic until explicitly
enabled. They add **no new UI pages** — that is by design.

| Feature | Env flag | What it does | Cost impact |
|---|---|---|---|
| **Prophet (Facebook) forecasting** | `PROPHET_SHADOW_ENABLED=false` + `PROPHET_MICROSERVICE_URL=` | Runs Prophet in **shadow** beside the live Holt-Winters engine; logs accuracy comparisons to `prophet_forecast_comparison`. Never writes forecasts or touches reorder/EOQ until proven. | Self-hosted microservice (CPU), **no OpenAI cost** |
| **Semantic catalog matching** | `CATALOG_EMBEDDINGS_ENABLED=false` | Uses embeddings to **re-rank** existing catalog-match candidates only | OpenAI embeddings (cheap, `migration` bucket) |
| **POS anomaly detection** | `POS_ANOMALY_DETECTION_ENABLED=false` | Flags suspicious cashier shifts for human review; never blocks | No OpenAI cost (statistical) |

**To enable Prophet:** run `prophet-service/` (`pip install -r requirements.txt`
then `uvicorn main:app --port 8200`, or the included Dockerfile), set
`PROPHET_SHADOW_ENABLED=true` and `PROPHET_MICROSERVICE_URL=http://localhost:8200`,
restart the backend. It then logs Prophet-vs-Holt-Winters accuracy so you can
prove which wins **before** trusting it.

---

## 5. Billing & subscription guidance

Because real cost is ~$0.30/pharmacy/month, AI is a **margin-positive feature**,
not a cost centre. Suggested framing for subscription tiers:

| Plan | AI allowance (fair-use) | Notes |
|---|---|---|
| **Free / Starter** | ~10 AI questions/day, daily AI digest | Rules-engine alerts always on |
| **Pro** | ~50 AI questions/day, full assistant, history | Set `AI_DAILY_COST_CAP_USD≈0.5` |
| **Business / Multi-branch** | Effectively unlimited fair-use | Set `AI_DAILY_COST_CAP_USD≈1–2` |

Provider cost per plan stays well under $1–$2/month even at the top tier, so any
reasonable subscription price keeps a healthy margin.

---

## 6. What to show the end-user (pharmacy) vs keep internal

**Recommendation: do NOT show raw OpenAI dollar cost to pharmacies.** It exposes
your COGS/margin and means nothing to a non-technical pharmacist.

| Audience | Show |
|---|---|
| **Pharmacy end-user** | A friendly **usage/allowance meter** — "استخدمت 12 من 50 سؤالاً ذكياً اليوم", calls made, value delivered (savings, actions automated). **No raw $.** |
| **Internal / Console admin** | Full raw $ cost, per-feature breakdown, per-tenant spend — for billing and ops. |

So the current AI Center "$ cost today" widget is best reframed for end-users as
an **allowance/usage** meter, while the raw-dollar view lives in the internal
Console (admin) surface. This protects margin and keeps the pharmacy UI simple.
