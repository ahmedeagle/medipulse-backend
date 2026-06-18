import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { AiRecommendation } from '../ai/entities/ai-recommendation.entity';
import { RecommendationType } from '../common/enums/recommendation-type.enum';

export interface ExchangeSuggestion {
  productId: string;
  city: string;
  excessTenantId: string;
  excessQty: number;
  shortageTenantId: string;
  shortageQty: number;
  suggestedTransferQty: number;
  excessListingId?: string;
  excessPrice?: number;
}

@Injectable()
export class PharmacyMatchingService {
  private readonly logger = new Logger(PharmacyMatchingService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(AiRecommendation)
    private readonly recRepo: Repository<AiRecommendation>,
  ) {}

  /**
   * Nightly job: find pharmacies in the same city where one has excess and
   * another has a shortage of the same product. Create INTER_BRANCH_TRADE
   * recommendations on both sides so the AI dashboard surfaces them.
   */
  @Cron('0 2 * * *')
  async runNightlyMatching(): Promise<void> {
    const matches = await this.findMatches();
    if (!matches.length) {
      this.logger.log('Pharmacy matching: no matches found');
      return;
    }

    this.logger.log(`Pharmacy matching: ${matches.length} match(es) found`);

    for (const match of matches) {
      const payload = {
        productId: match.productId,
        city: match.city,
        excessTenantId: match.excessTenantId,
        excessQty: match.excessQty,
        shortageTenantId: match.shortageTenantId,
        shortageQty: match.shortageQty,
        suggestedTransferQty: match.suggestedTransferQty,
        excessListingId: match.excessListingId,
        excessPrice: match.excessPrice,
      };

      const explanation = match.excessPrice
        ? `A nearby pharmacy in ${match.city} has ${match.excessQty} units to sell at ${match.excessPrice} SAR — covering your shortage of ${match.shortageQty} units.`
        : `A nearby pharmacy in ${match.city} has ${match.excessQty} excess units — you have a shortage of ${match.shortageQty}.`;

      // Recommendation for the pharmacy WITH shortage (they should buy)
      await this.recRepo.save(
        this.recRepo.create({
          pharmacyTenantId: match.shortageTenantId,
          type: RecommendationType.INTER_BRANCH_TRADE,
          productId: match.productId,
          payload,
          explanation,
          riskLevel: 'MEDIUM',
          isDismissed: false,
        } as any),
      );

      // Recommendation for the pharmacy WITH excess (they should sell)
      await this.recRepo.save(
        this.recRepo.create({
          pharmacyTenantId: match.excessTenantId,
          type: RecommendationType.INTER_BRANCH_TRADE,
          productId: match.productId,
          payload: { ...payload, perspective: 'seller' },
          explanation: `A nearby pharmacy in ${match.city} needs ${match.shortageQty} units — you have ${match.excessQty} excess.`,
          riskLevel: 'LOW',
          isDismissed: false,
        } as any),
      );
    }
  }

  async findMatches(limit = 100): Promise<ExchangeSuggestion[]> {
    // Find (productId, city) combinations where:
    //  - One verified+visible pharmacy has quantity > minThreshold * 3 (excess)
    //  - Another verified+visible pharmacy has quantity < minThreshold (shortage)
    // Join with p2p_listings to get the listing price if one exists
    const rows = await this.dataSource.query<any[]>(`
      SELECT
        excess.product_id                AS "productId",
        excess.city                      AS city,
        excess.pharmacy_tenant_id        AS "excessTenantId",
        excess.qty                       AS "excessQty",
        shortage.pharmacy_tenant_id      AS "shortageTenantId",
        shortage.shortage_qty            AS "shortageQty",
        LEAST(
          excess.qty - excess.min_threshold,
          shortage.shortage_qty
        )                                AS "suggestedTransferQty",
        l.id                             AS "excessListingId",
        l.price                          AS "excessPrice"
      FROM (
        -- Pharmacies with excess: qty > minThreshold * 3
        SELECT
          inv."pharmacyTenantId" AS pharmacy_tenant_id,
          sp.city,
          inv."productId"        AS product_id,
          inv.quantity           AS qty,
          inv."minThreshold"     AS min_threshold
        FROM inventory_items inv
        INNER JOIN seller_profiles sp
          ON sp."pharmacyTenantId" = inv."pharmacyTenantId"
          AND sp."verificationStatus" = 'verified'
          AND sp."isVisible" = true
        WHERE inv.quantity > inv."minThreshold" * 3
          AND inv."deletedAt" IS NULL
          AND sp.city IS NOT NULL
      ) excess
      INNER JOIN (
        -- Pharmacies with shortage: qty < minThreshold
        SELECT
          inv."pharmacyTenantId" AS pharmacy_tenant_id,
          sp.city,
          inv."productId"        AS product_id,
          inv."minThreshold" - inv.quantity AS shortage_qty
        FROM inventory_items inv
        INNER JOIN seller_profiles sp
          ON sp."pharmacyTenantId" = inv."pharmacyTenantId"
          AND sp."verificationStatus" = 'verified'
        WHERE inv.quantity < inv."minThreshold"
          AND inv."deletedAt" IS NULL
          AND sp.city IS NOT NULL
      ) shortage
        ON shortage.product_id = excess.product_id
       AND shortage.city       = excess.city
       AND shortage.pharmacy_tenant_id != excess.pharmacy_tenant_id
      -- Grab cheapest active listing from the excess pharmacy if one exists
      LEFT JOIN LATERAL (
        SELECT id, price
        FROM p2p_listings
        WHERE "sellerTenantId" = excess.pharmacy_tenant_id
          AND "productId"      = excess.product_id
          AND status = 'active'
          AND quantity > 0
        ORDER BY price ASC
        LIMIT 1
      ) l ON true
      ORDER BY shortage_qty DESC
      LIMIT $1
    `, [limit]);

    return rows.map((r) => ({
      productId: r.productId,
      city: r.city,
      excessTenantId: r.excessTenantId,
      excessQty: Number(r.excessQty),
      shortageTenantId: r.shortageTenantId,
      shortageQty: Number(r.shortageQty),
      suggestedTransferQty: Number(r.suggestedTransferQty),
      excessListingId: r.excessListingId ?? undefined,
      excessPrice: r.excessPrice != null ? Number(r.excessPrice) : undefined,
    }));
  }
}
