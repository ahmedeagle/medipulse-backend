import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { Product } from './entities/product.entity';

export interface BarcodeLookupResult {
  found:        boolean;
  source:       'local_db' | 'open_food_facts' | 'not_found';
  productId?:   string;   // if found in local DB
  name?:        string;
  genericName?: string;
  manufacturer?: string;
  strength?:    string;
  dosageForm?:  string;
  category?:    string;
  unit?:        string;
}

@Injectable()
export class BarcodeLookupService {
  private readonly logger = new Logger(BarcodeLookupService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
  ) {}

  async lookup(barcode: string): Promise<BarcodeLookupResult> {
    // 1. Check local DB first (fastest, exact match)
    const localProduct = await this.productRepo.findOne({
      where: { barcode },
    });

    if (localProduct) {
      return {
        found:        true,
        source:       'local_db',
        productId:    localProduct.id,
        name:         localProduct.name,
        genericName:  localProduct.genericName,
        strength:     localProduct.strength,
        dosageForm:   localProduct.dosageForm,
        category:     localProduct.category,
        unit:         localProduct.unit,
      };
    }

    // 2. Try Open Food Facts (free, no API key) as fallback
    // Works for many consumer health products and supplements
    try {
      const res = await axios.get(
        `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`,
        { timeout: 5_000 },
      );

      const product = res.data?.product;
      if (product && res.data?.status === 1) {
        const name = product.product_name_en
          || product.product_name
          || product.generic_name_en
          || product.generic_name;

        if (name) {
          return {
            found:        true,
            source:       'open_food_facts',
            name,
            genericName:  product.generic_name_en || product.generic_name || undefined,
            manufacturer: product.brands || undefined,
            category:     this.guessCategory(product.categories_tags || []),
            unit:         'unit',
          };
        }
      }
    } catch (err: any) {
      this.logger.debug(`OpenFoodFacts lookup failed for ${barcode}: ${err.message}`);
    }

    return { found: false, source: 'not_found' };
  }

  private guessCategory(categoryTags: string[]): string {
    const tags = categoryTags.map(t => t.toLowerCase());
    if (tags.some(t => t.includes('antibiotic') || t.includes('penicillin'))) return 'antibiotic';
    if (tags.some(t => t.includes('vitamin'))) return 'vitamin';
    if (tags.some(t => t.includes('supplement'))) return 'supplement';
    if (tags.some(t => t.includes('analgesic') || t.includes('pain'))) return 'analgesic';
    if (tags.some(t => t.includes('antifungal'))) return 'antifungal';
    if (tags.some(t => t.includes('antiviral'))) return 'antiviral';
    if (tags.some(t => t.includes('cardiovascular') || t.includes('cardiac'))) return 'cardiovascular';
    if (tags.some(t => t.includes('diabetes') || t.includes('insulin'))) return 'diabetes';
    if (tags.some(t => t.includes('respiratory') || t.includes('bronch'))) return 'respiratory';
    if (tags.some(t => t.includes('gastro') || t.includes('digestive'))) return 'gastrointestinal';
    return 'general';
  }
}
