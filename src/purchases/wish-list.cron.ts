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

    const tenants = await this.dataSource.query(
      `SELECT DISTINCT "pharmacyTenantId" FROM inventory_items WHERE "deletedAt" IS NULL`,
    );

    let total = 0;
    for (const { pharmacyTenantId } of tenants) {
      try {
        const { upserted } = await this.purchasesService.autoPopulateWishList(pharmacyTenantId);
        total += upserted;
      } catch (err) {
        this.logger.error(`Wish-list populate failed for tenant ${pharmacyTenantId}`, err);
      }
    }

    this.logger.log(`Wish-list auto-populate done — ${total} new items added across ${tenants.length} tenants`);
  }
}
