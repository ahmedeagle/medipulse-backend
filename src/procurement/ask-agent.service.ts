import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ProcurementOrchestrator } from './procurement-orchestrator.service';
import { ProcurementCartService } from './procurement-cart.service';
import { FinancialService } from '../financial/financial.service';
import type { OrchestratorResult } from './procurement-orchestrator.types';

// ── Types exposed to the controller ─────────────────────────────────────────

export interface ParsedLine {
  /** Original line as the user typed it (trimmed). */
  raw: string;
  /** Quantity extracted from the line; defaults to 1 if none detected. */
  qty: number;
  /** Drug query after the quantity is stripped — what we match against Product. */
  query: string;
}

export interface ResolvedLine extends ParsedLine {
  match: ProductMatch | null;
  /** Plan computed by the orchestrator. Null when we could not match a product. */
  plan: OrchestratorResult | null;
}

export interface ProductMatch {
  productId: string;
  name: string;
  nameAr: string | null;
  genericName: string | null;
  strength: string | null;
  dosageForm: string | null;
  /** 0..100 — how confident the matcher is. */
  score: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface AskPreview {
  items: ResolvedLine[];
  /** Lines we couldn't parse a drug name out of (text was empty after stripping qty). */
  unparsable: string[];
  /** Aggregate cost across every line that has a plan. */
  totalCost: number;
  /** Highest risk score across all plans (0..100). */
  highestRisk: number;
}

// ── Parser helpers ──────────────────────────────────────────────────────────

/** Arabic–Indic digits (٠..٩) → western digits. Idempotent on western input. */
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
function normaliseDigits(s: string): string {
  let out = '';
  for (const ch of s) {
    const idx = ARABIC_DIGITS.indexOf(ch);
    out += idx >= 0 ? String(idx) : ch;
  }
  return out;
}

/** Tokens that are quantity-modifiers, not part of the drug name. */
const QTY_NOISE_WORDS = [
  'علبة', 'علب', 'شريط', 'شرائط', 'حبة', 'حبوب', 'قرص', 'أقراص',
  'box', 'boxes', 'strip', 'strips', 'pack', 'packs', 'unit', 'units',
  'pcs', 'pc', 'tablet', 'tablets', 'tab', 'tabs', 'cap', 'caps',
  'عدد', 'كمية', 'qty', 'x', '×',
];

/** Filler words an Arabic-speaking user typically prepends. Stripped silently. */
const FILLER_PREFIX = /^(?:محتاج|اريد|أريد|عايز|عاوز|i\s*need|i\s*want|need|please|من\s+فضلك)\s+/i;

/**
 * Splits a free-text block into individual order lines.
 *
 * Separators (any of): newline, comma, Arabic comma (،), Arabic semicolon (؛),
 * `+`, ` و ` (Arabic "and"), `;`.
 */
function splitLines(text: string): string[] {
  return text
    .replace(/[\r\n،؛;+]+/g, '\n')
    // " و " as a separator — only when surrounded by spaces so we don't break
    // proper drug names that contain the letter.
    .replace(/\s+و\s+/g, '\n')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Extracts the first integer (1..100000) from a string and returns it plus
 * the residual text with the number removed.
 *
 * Examples:
 *   "50 panadol"           → { qty: 50, rest: 'panadol' }
 *   "panadol 30"           → { qty: 30, rest: 'panadol' }
 *   "augmentin 1g x 20"    → { qty: 20, rest: 'augmentin 1g' }  // x is noise
 *   "voltaren"             → { qty: 1,  rest: 'voltaren' }
 *
 * Note: a leading digit run that looks like a strength (e.g. "500" before
 * "mg") is kept in the residual — we only treat numbers as quantity when
 * they're not glued to a unit token.
 */
function extractQty(line: string): { qty: number; rest: string } {
  const normalised = normaliseDigits(line);
  // Find every standalone integer in the line (not glued to letters).
  const matches = Array.from(normalised.matchAll(/(?<![A-Za-z\u0600-\u06FF])(\d{1,6})(?!\s*(?:mg|mcg|µg|g|ml|iu|٪|%))/gi));
  if (matches.length === 0) {
    return { qty: 1, rest: normalised.trim() };
  }
  // Prefer the first match (most users put qty at the start).
  const m = matches[0];
  const qty = Math.max(1, Math.min(100_000, parseInt(m[1], 10)));
  const rest = (normalised.slice(0, m.index) + normalised.slice(m.index! + m[0].length)).trim();
  return { qty, rest };
}

/** Removes quantity-modifier noise words and filler prefixes. */
function cleanQuery(text: string): string {
  let out = text.replace(FILLER_PREFIX, '');
  for (const w of QTY_NOISE_WORDS) {
    out = out.replace(new RegExp(`(^|\\s)${w}(?=\\s|$)`, 'gi'), ' ');
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

export function parseAskText(text: string): { items: ParsedLine[]; unparsable: string[] } {
  const items: ParsedLine[] = [];
  const unparsable: string[] = [];
  for (const raw of splitLines(text)) {
    const { qty, rest } = extractQty(raw);
    const query = cleanQuery(rest);
    if (!query || query.length < 2) {
      unparsable.push(raw);
      continue;
    }
    items.push({ raw, qty, query });
  }
  return { items, unparsable };
}

// ── Service ─────────────────────────────────────────────────────────────────

interface ProductRow {
  id: string;
  name: string;
  nameAr: string | null;
  genericName: string | null;
  canonicalName: string | null;
  activeIngredient: string | null;
  strength: string | null;
  dosageForm: string | null;
  barcode: string | null;
}

@Injectable()
export class AskAgentService {
  private readonly logger = new Logger(AskAgentService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly orchestrator: ProcurementOrchestrator,
    private readonly cart: ProcurementCartService,
    private readonly financial: FinancialService,
  ) {}

  // ─── PREVIEW ────────────────────────────────────────────────────────────

  /**
   * Parses free text, resolves each line to a Product, and runs the
   * Procurement Decision Engine per line. No DB writes.
   */
  async preview(tenantId: string, text: string): Promise<AskPreview> {
    const { items, unparsable } = parseAskText(text);

    if (items.length === 0) {
      return { items: [], unparsable, totalCost: 0, highestRisk: 0 };
    }

    // 1) Resolve every line to a Product in a single round-trip.
    const matches = await this.resolveProducts(items.map((i) => i.query));

    // 1.5) Pre-warm tenant-wide signals that are otherwise re-fetched
    //      once per parallel orchestrator run. Wallet is the biggest win:
    //      a 30-line ask used to trigger 30 financial.getWallet() calls.
    //      Failure here is non-fatal — we just skip the cache.
    let warmWallet: unknown = undefined;
    try {
      warmWallet = await this.financial.getWallet(tenantId);
    } catch (err) {
      this.logger.warn(`[ask-agent] wallet warm failed tenant=${tenantId}: ${(err as Error).message}`);
    }
    const warmCache = warmWallet !== undefined ? { wallet: warmWallet } : undefined;

    // 2) For every matched line, generate a plan with bounded concurrency.
    //    Lines without a match are returned with plan=null so the UI can
    //    surface "no product found — open a catalog request" guidance.
    //    We cap concurrency at 5 to avoid swamping the DB pool when a
    //    user pastes a 30+ line shopping list.
    const CONCURRENCY = 5;
    const resolved: ResolvedLine[] = new Array(items.length);
    for (let start = 0; start < items.length; start += CONCURRENCY) {
      const chunk = items.slice(start, start + CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async (line, ci): Promise<ResolvedLine> => {
          const idx = start + ci;
          const match = matches[idx];
          if (!match) return { ...line, match: null, plan: null };
          try {
            const plan = await this.orchestrator.generatePlan(
              tenantId,
              match.productId,
              line.qty,
              { triggerEvent: 'manual', warmCache },
            );
            return { ...line, match, plan };
          } catch (err) {
            // The orchestrator is allowed to fail (no suppliers, no demand
            // signals, etc.). We surface match + plan=null so the UI can
            // explain why we couldn't price the line.
            this.logger.warn(
              `[ask-agent] plan failed tenant=${tenantId} product=${match.productId}: ${(err as Error).message}`,
            );
            return { ...line, match, plan: null };
          }
        }),
      );
      for (let i = 0; i < chunkResults.length; i++) resolved[start + i] = chunkResults[i];
    }

    const totalCost = resolved.reduce((s, r) => s + (r.plan?.totalCost ?? 0), 0);
    const highestRisk = resolved.reduce((m, r) => Math.max(m, r.plan?.riskScore ?? 0), 0);

    return { items: resolved, unparsable, totalCost, highestRisk };
  }

  // ─── APPLY ──────────────────────────────────────────────────────────────

  /**
   * Adds each confirmed item to the procurement cart. Calls addToCart
   * sequentially so the per-product `delete existing ai_plan drafts then
   * insert fresh splits` transaction never races against itself.
   *
   * Returns the up-to-date cart so the UI can render it immediately.
   */
  async apply(
    tenantId: string,
    items: Array<{ productId: string; qty: number }>,
  ): Promise<{ added: number; skipped: Array<{ productId: string; reason: string }> }> {
    const skipped: Array<{ productId: string; reason: string }> = [];
    let added = 0;

    for (const item of items) {
      try {
        await this.cart.addToCart(tenantId, item.productId, item.qty);
        added += 1;
      } catch (err) {
        const reason = (err as Error).message ?? 'unknown error';
        this.logger.warn(
          `[ask-agent] addToCart failed tenant=${tenantId} product=${item.productId}: ${reason}`,
        );
        skipped.push({ productId: item.productId, reason });
      }
    }

    return { added, skipped };
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  /**
   * Resolves an array of free-text drug queries to Product rows.
   *
   * Strategy:
   *  1) One bulk SQL fetch that returns candidate products matching ANY
   *     query via ILIKE on name / nameAr / genericName / canonicalName /
   *     activeIngredient / barcode.
   *  2) In-memory scoring per query against the candidate set.
   *
   * Trade-off: we accept a slightly larger candidate set (still bounded
   * because every term must appear in at least one column) in exchange
   * for a single DB round-trip instead of N queries.
   */
  private async resolveProducts(queries: string[]): Promise<Array<ProductMatch | null>> {
    if (queries.length === 0) return [];

    // Build LIKE terms — strip vowel diacritics for Arabic, lowercase ASCII.
    const terms = queries.map((q) => normaliseForMatch(q));
    const patterns = terms.map((t) => `%${t}%`);

    // One bound parameter (text array) referenced from every column predicate.
    const candidates = await this.dataSource.query<ProductRow[]>(
      `
      SELECT id, name, "nameAr", "genericName", "canonicalName",
             "activeIngredient", strength, "dosageForm", barcode
      FROM products
      WHERE LOWER(name)               ILIKE ANY ($1::text[])
         OR LOWER("nameAr")           ILIKE ANY ($1::text[])
         OR LOWER("genericName")      ILIKE ANY ($1::text[])
         OR LOWER("canonicalName")    ILIKE ANY ($1::text[])
         OR LOWER("activeIngredient") ILIKE ANY ($1::text[])
         OR LOWER(barcode)            ILIKE ANY ($1::text[])
      LIMIT 500
      `,
      [patterns],
    );

    return terms.map((term) => pickBestMatch(term, candidates));
  }
}

// ── Matching internals (exported for unit testing) ──────────────────────────

/** Lower-cases ASCII, removes Arabic diacritics (ً..ْ), and collapses spaces. */
export function normaliseForMatch(s: string): string {
  return normaliseDigits(s)
    .toLowerCase()
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Scores a product row against a normalised query and returns the best match.
 * Scoring rubric (max 100):
 *   exact name / nameAr match                100
 *   query is prefix of name                   90
 *   barcode exact                             95
 *   query contained in name                   75
 *   query contained in genericName            70
 *   query contained in canonicalName          70
 *   query contained in activeIngredient       65
 *   token overlap (every token matches)       60
 *   token overlap (some tokens match)         40..55
 *   none of the above                          0
 */
export function pickBestMatch(term: string, candidates: ProductRow[]): ProductMatch | null {
  if (!term) return null;
  const tokens = term.split(/\s+/).filter((t) => t.length >= 2);
  let best: { row: ProductRow; score: number } | null = null;

  for (const row of candidates) {
    const score = scoreRow(term, tokens, row);
    if (score > 0 && (!best || score > best.score)) {
      best = { row, score };
    }
  }
  if (!best) return null;

  const conf: ProductMatch['confidence'] =
    best.score >= 80 ? 'high' : best.score >= 55 ? 'medium' : 'low';

  return {
    productId: best.row.id,
    name: best.row.name,
    nameAr: best.row.nameAr,
    genericName: best.row.genericName,
    strength: best.row.strength,
    dosageForm: best.row.dosageForm,
    score: best.score,
    confidence: conf,
  };
}

function scoreRow(term: string, tokens: string[], row: ProductRow): number {
  const name = (row.name || '').toLowerCase();
  const nameAr = (row.nameAr || '').toLowerCase();
  const generic = (row.genericName || '').toLowerCase();
  const canonical = (row.canonicalName || '').toLowerCase();
  const active = (row.activeIngredient || '').toLowerCase();
  const barcode = (row.barcode || '').toLowerCase();

  if (term === name || term === nameAr) return 100;
  if (term === barcode && barcode) return 95;
  if (name.startsWith(term) || nameAr.startsWith(term)) return 90;
  if (name.includes(term)) return 75;
  if (generic.includes(term)) return 70;
  if (canonical.includes(term)) return 70;
  if (active.includes(term)) return 65;

  // Token-overlap fallback — every token must appear somewhere.
  if (tokens.length > 1) {
    const haystack = `${name} ${nameAr} ${generic} ${canonical} ${active}`;
    const hits = tokens.filter((t) => haystack.includes(t)).length;
    if (hits === tokens.length) return 60;
    if (hits >= 2) return 40 + Math.min(15, hits * 3);
  }
  return 0;
}
