import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression }  from '@nestjs/schedule';
import { DataSource }            from 'typeorm';
import { PurchasesService }      from './purchases.service';

@Injectable()
export class WishListCron {
  private readonly logger = new Logger(WishListCron.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly purchasesService: PurchasesService,
  ) {}

  @Cron('0 2 * * *', { timeZone: 'Asia/Riyadh' })
  async autoPopulateAllTenants() {
    this.logger.log('Starting nightly wish-list auto-populate');

    // Paginated tenant iteration — the previous implementation loaded
    // every distinct tenant id into memory in one shot, which became a
    // memory spike at scale and held a long-running connection open.
    const PAGE_SIZE = 500;
    let offset = 0;
    let total = 0;
    let tenantsProcessed = 0;

    for (;;) {
      const tenants: Array<{ pharmacyTenantId: string }> = await this.dataSource.query(
        `SELECT DISTINCT "pharmacyTenantId"
           FROM inventory_items
          WHERE "deletedAt" IS NULL
          ORDER BY "pharmacyTenantId"
          LIMIT $1 OFFSET $2`,
        [PAGE_SIZE, offset],
      );
      if (tenants.length === 0) break;

      for (const { pharmacyTenantId } of tenants) {
        try {
          const { upserted } = await this.purchasesService.autoPopulateWishList(pharmacyTenantId);
          total += upserted;
        } catch (err) {
          this.logger.error(`Wish-list populate failed for tenant ${pharmacyTenantId}`, err);
        }
      }
      tenantsProcessed += tenants.length;
      if (tenants.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    this.logger.log(
      `Wish-list auto-populate done — ${total} new items added across ${tenantsProcessed} tenants`,
    );
  }
}
