import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Brackets } from 'typeorm';
import { Product } from './entities/product.entity';
import { InventoryItem } from './entities/inventory-item.entity';

/**
 * A scored catalog candidate produced by the matching engine.
 *
 * - score:     0..100 confidence
 * - signals:   ordered list of matching signals (most discriminative first)
 * - reasons:   human-readable Arabic explanations for the UI
 */
export interface MatchCandidate {
  product: Product;
  score: number;
  signals: string[];
  reasons: string[];
}

/** Strip diacritics, lowercase, collapse whitespace, drop punctuation. */
function normalize(value?: string | null): string {
  if (!value) return '';
  return value
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')              // diacritics
    .replace(/[\u064b-\u065f\u0670\u06d6-\u06ed]/g, '') // arabic harakat
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Token-set similarity 0..1 — robust to word order. */
function tokenSetSimilarity(a: string, b: string): number {
  const aTokens = new Set(a.split(' ').filter(Boolean));
  const bTokens = new Set(b.split(' ').filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let intersect = 0;
  for (const t of aTokens) if (bTokens.has(t)) intersect++;
  const union = aTokens.size + bTokens.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

/** Levenshtein distance — used for fuzzy single-token matches. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

function fuzzyRatio(a: string, b: string): number {
  if (!a || !b) return 0;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 0;
  return 1 - levenshtein(a, b) / max;
}

/** Normalize strength like "500mg" / "500 MG" / "0.5g" → grams */
function parseStrength(s?: string | null): { value: number; unit: string } | null {
  if (!s) return null;
  const m = s.toString().toLowerCase().match(/(\d+(?:\.\d+)?)\s*(mg|g|mcg|µg|ml|iu|%)/);
  if (!m) return null;
  let value = parseFloat(m[1]);
  let unit = m[2];
  if (unit === 'g')   { value = value * 1000;    unit = 'mg'; }
  if (unit === 'mcg' || unit === 'µg') { value = value / 1000; unit = 'mg'; }
  return { value, unit };
}

@Injectable()
export class CatalogMatchingService {
  constructor(
    @InjectRepository(Product)       private readonly productRepo:   Repository<Product>,
    @InjectRepository(InventoryItem) private readonly inventoryRepo: Repository<InventoryItem>,
  ) {}

  /**
   * Build a structured "search profile" for an inventory item by combining
   * everything we know — its current product fields, batch number, and any
   * payload from a previous catalog request.
   */
  private profileFromItem(item: InventoryItem): {
    name: string; nameAr: string; barcode: string; manufacturer: string;
    strength: string; dosageForm: string;
  } {
    const p = item.product || ({} as any);
    return {
      name:         (p.name        || '').toString(),
      nameAr:       (p.nameAr      || '').toString(),
      barcode:      (p.barcode     || '').toString(),
      manufacturer: (p.manufacturer|| '').toString(),
      strength:     (p.strength    || '').toString(),
      dosageForm:   (p.dosageForm  || '').toString(),
    };
  }

  /**
   * Score a single candidate product against a search profile.
   * Output score is in [0..100]. Signals are ordered by importance.
   */
  scoreCandidate(
    profile: { name?: string; nameAr?: string; barcode?: string; manufacturer?: string; strength?: string; dosageForm?: string },
    candidate: Product,
  ): MatchCandidate {
    const signals: string[] = [];
    const reasons: string[] = [];
    let score = 0;

    // 1. Barcode (most discriminative — bumps to 100)
    if (profile.barcode && candidate.barcode && profile.barcode.trim() === candidate.barcode.trim()) {
      signals.push('barcode_exact');
      reasons.push('تطابق الباركود تمامًا');
      score = Math.max(score, 100);
    }

    // 2. Name similarity (English + Arabic, take max)
    const nA = normalize(profile.name);
    const nB = normalize(candidate.name);
    const arA = normalize(profile.nameAr);
    const arB = normalize(candidate.nameAr);

    const enSim = nA && nB ? Math.max(tokenSetSimilarity(nA, nB), fuzzyRatio(nA, nB)) : 0;
    const arSim = arA && arB ? Math.max(tokenSetSimilarity(arA, arB), fuzzyRatio(arA, arB)) : 0;
    const nameSim = Math.max(enSim, arSim);

    if (nameSim >= 0.95) {
      signals.push('name_exact');
      reasons.push('الاسم متطابق');
      score = Math.max(score, 92);
    } else if (nameSim >= 0.8) {
      signals.push('name_strong');
      reasons.push(`اسم مشابه جدًا (${Math.round(nameSim * 100)}٪)`);
      score = Math.max(score, 75 + (nameSim - 0.8) * 50);
    } else if (nameSim >= 0.6) {
      signals.push('name_partial');
      reasons.push(`تشابه جزئي بالاسم (${Math.round(nameSim * 100)}٪)`);
      score = Math.max(score, 45 + (nameSim - 0.6) * 50);
    }

    // 3. Manufacturer match (+10, multiplicative trust booster)
    const mfA = normalize(profile.manufacturer);
    const mfB = normalize(candidate.manufacturer);
    if (mfA && mfB) {
      const mfSim = Math.max(tokenSetSimilarity(mfA, mfB), fuzzyRatio(mfA, mfB));
      if (mfSim >= 0.85) {
        signals.push('manufacturer_match');
        reasons.push('الشركة المصنعة متطابقة');
        score += 10;
      }
    }

    // 4. Strength normalization
    const sA = parseStrength(profile.strength);
    const sB = parseStrength(candidate.strength);
    if (sA && sB && sA.unit === sB.unit && Math.abs(sA.value - sB.value) < 0.01) {
      signals.push('strength_match');
      reasons.push(`التركيز متطابق (${candidate.strength})`);
      score += 6;
    } else if (profile.strength && candidate.strength &&
               normalize(profile.strength) === normalize(candidate.strength)) {
      signals.push('strength_match');
      reasons.push(`التركيز متطابق (${candidate.strength})`);
      score += 6;
    }

    // 5. Dosage form match
    if (profile.dosageForm && candidate.dosageForm &&
        normalize(profile.dosageForm) === normalize(candidate.dosageForm)) {
      signals.push('dosage_form_match');
      reasons.push(`نفس الشكل الصيدلاني (${candidate.dosageForm})`);
      score += 4;
    }

    // Cap at 100
    score = Math.min(100, Math.round(score * 100) / 100);

    return { product: candidate, score, signals, reasons };
  }

  /**
   * Find the top candidates for the given search profile across the catalog.
   * Uses SQL pre-filtering (barcode / ILIKE / canonicalName) then in-memory
   * scoring on the shortlist for accuracy.
   */
  async findCandidates(profile: {
    name?: string; nameAr?: string; barcode?: string; manufacturer?: string;
    strength?: string; dosageForm?: string;
  }, limit = 10): Promise<MatchCandidate[]> {
    const qb = this.productRepo.createQueryBuilder('p').where('1=1');

    // Catalog hygiene: never surface pharmacy/supplier-created products that
    // are still pending system-admin verification (requiresMapping=true).
    // Only the canonical, verified catalog is allowed to act as a match
    // target — this prevents one tenant's typo from contaminating another.
    qb.andWhere('(p."requiresMapping" IS NULL OR p."requiresMapping" = false)');

    const nameTokens = normalize(profile.name).split(' ').filter(t => t.length >= 2).slice(0, 3);
    const arTokens   = normalize(profile.nameAr).split(' ').filter(t => t.length >= 2).slice(0, 3);

    qb.andWhere(new Brackets(b => {
      b.where('1=0');
      if (profile.barcode) {
        b.orWhere('p.barcode = :bc', { bc: profile.barcode.trim() });
      }
      nameTokens.forEach((tok, i) => {
        b.orWhere(`LOWER(p.name) LIKE :n${i}`, { [`n${i}`]: `%${tok}%` });
        b.orWhere(`LOWER(p."canonicalName") LIKE :cn${i}`, { [`cn${i}`]: `%${tok}%` });
      });
      arTokens.forEach((tok, i) => {
        b.orWhere(`p."nameAr" LIKE :ar${i}`, { [`ar${i}`]: `%${tok}%` });
      });
    }));

    qb.limit(80);
    const shortlist = await qb.getMany();
    if (shortlist.length === 0) return [];

    const scored = shortlist
      .map(c => this.scoreCandidate(profile, c))
      .filter(c => c.score >= 35)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  }

  /**
   * Public API: list candidates for an existing inventory item.
   *
   * Excludes the current linked product so the user only sees alternatives.
   */
  async candidatesForInventoryItem(
    pharmacyTenantId: string,
    inventoryItemId: string,
    extra?: { name?: string; nameAr?: string; barcode?: string; manufacturer?: string; strength?: string; dosageForm?: string },
    limit = 10,
  ): Promise<MatchCandidate[]> {
    const item = await this.inventoryRepo.findOne({
      where: { id: inventoryItemId, pharmacyTenantId },
      relations: ['product'],
    });
    if (!item) return [];

    const baseProfile = this.profileFromItem(item);
    const profile = {
      name:         extra?.name         || baseProfile.name,
      nameAr:       extra?.nameAr       || baseProfile.nameAr,
      barcode:      extra?.barcode      || baseProfile.barcode,
      manufacturer: extra?.manufacturer || baseProfile.manufacturer,
      strength:     extra?.strength     || baseProfile.strength,
      dosageForm:   extra?.dosageForm   || baseProfile.dosageForm,
    };

    const candidates = await this.findCandidates(profile, limit + 5);
    return candidates
      .filter(c => c.product.id !== item.productId)
      .slice(0, limit);
  }

  /**
   * Bulk-suggest matches for every `unlinked` item of a tenant.
   * Auto-promotes high-confidence candidates (>= 90) to `suggested` so
   * the UI can show a "review match" badge without further user action.
   */
  async runMatchingForTenant(pharmacyTenantId: string): Promise<{
    scanned: number;
    suggested: number;
    autoLinked: number;
  }> {
    const unlinked = await this.inventoryRepo.find({
      where: { pharmacyTenantId, linkStatus: 'unlinked' as any },
      relations: ['product'],
      take: 500,
    });
    if (unlinked.length === 0) return { scanned: 0, suggested: 0, autoLinked: 0 };

    let suggested = 0;
    let autoLinked = 0;

    for (const item of unlinked) {
      const profile = this.profileFromItem(item);
      if (!profile.name && !profile.nameAr && !profile.barcode) continue;

      const [top] = await this.findCandidates(profile, 1);
      if (!top) continue;

      if (top.score >= 95
          && top.signals.includes('barcode_exact')
          && top.signals.some(s => s === 'name_exact' || s === 'name_strong' || s === 'name_partial' || s === 'manufacturer_match')) {
        // Defense in depth: barcode alone can be mistyped or shared by accident
        // (e.g. private-label re-packs). We require a corroborating signal
        // (name OR manufacturer) before auto-linking without human review.
        await this.inventoryRepo.update(item.id, {
          productId:        top.product.id,
          linkStatus:       'linked',
          matchScore:       top.score,
          matchExplanation: { signals: top.signals, reasons: top.reasons, autoLinked: true } as any,
          lastLinkedAt:     new Date(),
        });
        autoLinked++;
      } else if (top.score >= 70 || top.signals.includes('barcode_exact')) {
        // Barcode-only matches still surface as suggestions for human review.
        await this.inventoryRepo.update(item.id, {
          linkStatus:       'suggested',
          matchScore:       top.score,
          matchExplanation: { signals: top.signals, reasons: top.reasons, suggestedProductId: top.product.id } as any,
        });
        suggested++;
      }
    }

    return { scanned: unlinked.length, suggested, autoLinked };
  }

  // Helper exposed for tests / suggestions UI
  static normalize = normalize;
  static tokenSetSimilarity = tokenSetSimilarity;
  static fuzzyRatio = fuzzyRatio;
  // keep "In" referenced so unused-import lint doesn't strip it (used in future bulk lookups)
  static _typeormHelpers = { In };
}
