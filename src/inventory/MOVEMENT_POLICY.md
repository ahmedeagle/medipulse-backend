# Movement & Dead-Stock Policy

This module defines the enterprise rule set for movement/dead-stock classification.

## Source of truth

- Use `consumption_snapshots` (weekly sales/consumption aggregates).
- Do **not** use `inventory_items.updatedAt` to infer business movement.

## Current thresholds

- Movement window: `56` days (8 weeks)
- Active: `<= 14` days since last sale
- Moderate: `<= 56` days since last sale
- Stagnant: `> 56` days since last sale
- Dead stock: quantity `> 0` + no 8-week consumption + last sale `>= 56` days

## Why this policy exists

`updatedAt` changes for many reasons (manual edits, imports, linking, metadata updates)
and is not a reliable signal of demand movement. Snapshot-derived movement scales better
and avoids false positives/negatives in inventory KPIs, alerts, and financial metrics.

## Files expected to follow this policy

- `inventory.service.ts` (API enrichment)
- `lost-revenue.cron.ts` (stockout loss duration)
- Any future dead-stock KPI, dashboard, or recommendation logic
