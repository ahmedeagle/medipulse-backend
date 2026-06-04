import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Product } from '../inventory/entities/product.entity';
import { ProductAlias } from './entities/product-alias.entity';

export interface NormalizedProduct {
  canonicalName: string;
  strength: string | null;
  dosageForm: string | null;
}

const DOSAGE_FORMS = ['tablet', 'capsule', 'syrup', 'injection', 'cream', 'drops', 'inhaler', 'patch', 'gel', 'solution'];
const DOSAGE_FORM_PATTERNS = DOSAGE_FORMS.map((f) => ({ form: f, re: new RegExp(f, 'i') }));

/** Matches strength like "500mg", "250mg/5ml", "10mg/ml", "0.5%" */
const STRENGTH_RE = /\d+(?:\.\d+)?\s*(?:mg\/\d+\s*ml|mg\/ml|mg|ml|mcg|iu|g|%)/i;

@Injectable()
export class ProductNormalizationService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductAlias)
    private readonly aliasRepo: Repository<ProductAlias>,
  ) {}

  // ─── Normalize a raw name into structured fields ──────────────────────────

  normalize(name: string, genericName?: string): NormalizedProduct {
    const source = genericName || name;
    const canonicalName = source.toLowerCase().trim().replace(/\s+/g, ' ');

    const strengthMatch = canonicalName.match(STRENGTH_RE);
    const strength = strengthMatch ? strengthMatch[0].trim() : null;

    const dosageFormMatch = DOSAGE_FORM_PATTERNS.find((p) => p.re.test(canonicalName));
    const dosageForm = dosageFormMatch?.form ?? null;

    return { canonicalName, strength, dosageForm };
  }

  // ─── Find or create a canonical product ──────────────────────────────────

  async findOrCreateCanonical(dto: {
    name: string;
    genericName?: string;
    category: string;
    unit: string;
  }): Promise<Product> {
    const { canonicalName, strength, dosageForm } = this.normalize(dto.name, dto.genericName);

    // Exact match on canonical name + strength + dosage form
    const existing = await this.productRepo
      .createQueryBuilder('p')
      .where('p.canonicalName = :canonicalName', { canonicalName })
      .andWhere('p.isCanonical = true')
      .andWhere(strength ? 'p.strength = :strength' : 'p.strength IS NULL', strength ? { strength } : {})
      .andWhere(dosageForm ? 'p.dosageForm = :dosageForm' : 'p.dosageForm IS NULL', dosageForm ? { dosageForm } : {})
      .getOne();

    if (existing) return existing;

    return this.productRepo.save(
      this.productRepo.create({
        name: dto.name,
        genericName: dto.genericName ?? null,
        category: dto.category,
        unit: dto.unit,
        canonicalName,
        strength,
        dosageForm,
        isCanonical: true,
        requiresMapping: false,
      }),
    );
  }

  // ─── Map a supplier SKU to a canonical product ────────────────────────────

  async mapSupplierSku(
    supplierTenantId: string,
    supplierSku: string,
    canonicalProductId: string,
    supplierName?: string,
  ): Promise<ProductAlias> {
    const canonical = await this.productRepo.findOne({ where: { id: canonicalProductId, isCanonical: true } });
    if (!canonical) throw new NotFoundException(`Canonical product ${canonicalProductId} not found`);

    const existing = await this.aliasRepo.findOne({ where: { supplierTenantId, supplierSku } });
    if (existing) {
      await this.aliasRepo.update(existing.id, { canonicalProductId, supplierName, mappingSource: 'confirmed' });
      return this.aliasRepo.findOne({ where: { id: existing.id } });
    }

    return this.aliasRepo.save(
      this.aliasRepo.create({ supplierTenantId, supplierSku, canonicalProductId, supplierName, mappingSource: 'confirmed' }),
    );
  }

  // ─── Reverse lookup: supplier SKU → canonical product ID ─────────────────

  async resolveProductId(supplierTenantId: string, supplierSku: string): Promise<string | null> {
    const alias = await this.aliasRepo.findOne({ where: { supplierTenantId, supplierSku } });
    return alias?.canonicalProductId ?? null;
  }

  // ─── Auto-suggest mapping for unmapped catalog items ─────────────────────

  async autoSuggestMapping(productName: string, genericName?: string): Promise<Product[]> {
    const { canonicalName } = this.normalize(productName, genericName);
    const words = canonicalName.split(' ').filter((w) => w.length > 3).slice(0, 3);
    if (!words.length) return [];

    const qb = this.productRepo.createQueryBuilder('p').where('p.isCanonical = true');
    words.forEach((word, i) =>
      qb.andWhere(`LOWER(p.canonicalName) LIKE :w${i}`, { [`w${i}`]: `%${word}%` }),
    );
    return qb.limit(5).getMany();
  }

  // ─── Admin: list unmapped catalog items ──────────────────────────────────

  async getUnmappedProducts(): Promise<Product[]> {
    return this.productRepo.find({ where: { requiresMapping: true } });
  }

  async getProductAliases(canonicalProductId: string): Promise<ProductAlias[]> {
    const product = await this.productRepo.findOne({ where: { id: canonicalProductId } });
    if (!product) throw new NotFoundException(`Product ${canonicalProductId} not found`);
    return this.aliasRepo.find({ where: { canonicalProductId }, order: { mappedAt: 'DESC' } });
  }
}
