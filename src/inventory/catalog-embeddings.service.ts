import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { MatchCandidate } from './catalog-matching.service';

/**
 * OPTIONAL embeddings-assisted catalog matching.
 *
 * ── Trust contract ───────────────────────────────────────────────────────────
 * This layer is DISABLED by default and is purely additive. When enabled it may
 * only **re-order and annotate** the candidate list produced by the existing
 * deterministic string matcher — it NEVER mutates a candidate's `score`, so the
 * auto-link / needs-review / unmatched thresholds applied by callers remain
 * byte-for-byte identical to the current behaviour.
 *
 * On ANY failure (no API key, flag off, network/timeout, bad response) it
 * returns the input list unchanged. It can therefore never break or degrade the
 * proven lexical matcher — at worst it is a no-op.
 *
 * Enable with both:
 *   CATALOG_EMBEDDINGS_ENABLED=true
 *   OPENAI_API_KEY=<key>
 */

const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_TIMEOUT_MS = 8_000;
const MAX_CANDIDATES = 12; // only re-rank a small shortlist — bounded cost
const CACHE_MAX = 5_000;

@Injectable()
export class CatalogEmbeddingsService {
  private readonly logger = new Logger(CatalogEmbeddingsService.name);
  private readonly openai: OpenAI | null;
  private readonly enabled: boolean;
  /** product.id → embedding vector (process-local LRU-ish cache) */
  private readonly cache = new Map<string, number[]>();

  constructor(private readonly config: ConfigService) {
    const flag = (this.config.get<string>('CATALOG_EMBEDDINGS_ENABLED') || '').toLowerCase();
    const flagOn = flag === 'true' || flag === '1' || flag === 'yes';
    const apiKey = this.config.get<string>('OPENAI_API_KEY');

    if (flagOn && apiKey) {
      this.openai = new OpenAI({ apiKey, timeout: EMBED_TIMEOUT_MS });
      this.enabled = true;
      this.logger.log('Catalog embeddings assist ENABLED (re-rank only, scores untouched)');
    } else {
      this.openai = null;
      this.enabled = false;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Re-rank candidates by blending the existing lexical score with semantic
   * similarity to the search profile. Returns a NEW array; candidate `score`
   * values are never modified. Falls back to the original list on any problem.
   */
  async reRank(
    profile: { name?: string; nameAr?: string; manufacturer?: string; strength?: string; dosageForm?: string },
    candidates: MatchCandidate[],
  ): Promise<MatchCandidate[]> {
    if (!this.enabled || !this.openai || candidates.length < 2) return candidates;

    // Never touch a confident barcode/exact auto-match — it is already correct.
    if (candidates[0]?.signals?.includes('barcode_exact')) return candidates;

    const shortlist = candidates.slice(0, MAX_CANDIDATES);

    try {
      const profileText = this.toText({
        name: profile.name, nameAr: profile.nameAr,
        manufacturer: profile.manufacturer, strength: profile.strength, dosageForm: profile.dosageForm,
      });
      if (!profileText) return candidates;

      // Build the set of texts that still need embedding (cache the rest).
      const missing: { id: string; text: string }[] = [];
      for (const c of shortlist) {
        if (!this.cache.has(c.product.id)) {
          missing.push({ id: c.product.id, text: this.toText(c.product) });
        }
      }

      const inputs = [profileText, ...missing.map((m) => m.text)];
      const resp = await this.openai.embeddings.create({ model: EMBED_MODEL, input: inputs });
      const vectors = resp.data.map((d) => d.embedding as number[]);

      const profileVec = vectors[0];
      missing.forEach((m, i) => this.put(m.id, vectors[i + 1]));

      // Blend WITHOUT mutating score: build a sort key per candidate.
      const ranked = shortlist
        .map((c) => {
          const vec = this.cache.get(c.product.id);
          const sim = vec ? this.cosine(profileVec, vec) : 0; // 0..1
          // 70% trust the proven lexical score, 30% semantic nudge.
          const sortKey = 0.7 * (c.score / 100) + 0.3 * sim;
          return { c, sim, sortKey };
        })
        .sort((a, b) => b.sortKey - a.sortKey);

      // Annotate (UI only) — does NOT change score/thresholds.
      const out = ranked.map(({ c, sim }) => {
        if (sim >= 0.6 && !c.signals.includes('semantic_match')) {
          return {
            ...c,
            signals: [...c.signals, 'semantic_match'],
            reasons: [...c.reasons, `تشابه دلالي عالٍ (${Math.round(sim * 100)}٪)`],
          };
        }
        return c;
      });

      // Re-attach any candidates beyond the shortlist, preserving original order.
      return [...out, ...candidates.slice(MAX_CANDIDATES)];
    } catch (err) {
      this.logger.warn(`Embeddings re-rank failed, using lexical order: ${(err as Error).message}`);
      return candidates;
    }
  }

  private toText(p: { name?: string; nameAr?: string; manufacturer?: string; strength?: string; dosageForm?: string }): string {
    return [p.name, p.nameAr, p.manufacturer, p.strength, p.dosageForm]
      .map((x) => (x || '').toString().trim())
      .filter(Boolean)
      .join(' ');
  }

  private cosine(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  private put(id: string, vec: number[]): void {
    if (this.cache.size >= CACHE_MAX) {
      // Drop oldest insertion to bound memory.
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(id, vec);
  }
}
