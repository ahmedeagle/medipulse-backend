import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { ProductBatch, BatchStatus } from './entities/product-batch.entity';
import { InventoryService } from './inventory.service';
import { NotificationService } from '../notifications/notification.service';
import { PharmacySettingsService } from '../pharmacy-settings/pharmacy-settings.service';

@Injectable()
export class ExpiredInventoryCron {
  private readonly logger = new Logger(ExpiredInventoryCron.name);

  constructor(
    @InjectRepository(ProductBatch)
    private readonly batchRepo: Repository<ProductBatch>,
    private readonly inventoryService: InventoryService,
    private readonly notificationService: NotificationService,
    private readonly settingsSvc: PharmacySettingsService,
  ) {}

  // Runs every day at 6:00 AM UTC
  @Cron('0 6 * * *')
  async scanAndFlagExpired() {
    this.logger.log('Running expired inventory scan...');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. Auto-transition active batches that passed expiry to status = 'expired'
    // Guard: skip batches where noExpiry = true (medical devices, consumables)
    const expiredBatches = await this.batchRepo
      .createQueryBuilder('b')
      .where('b.status = :status', { status: 'active' })
      .andWhere('b."expiryDate" < :today', { today })
      .andWhere('(b."noExpiry" = false OR b."noExpiry" IS NULL)')
      .getMany();

    if (expiredBatches.length > 0) {
      const ids = expiredBatches.map((b) => b.id);
      await this.batchRepo
        .createQueryBuilder()
        .update()
        .set({ status: 'expired' as BatchStatus })
        .whereInIds(ids)
        .execute();
      this.logger.log(`Auto-expired ${expiredBatches.length} batch(es)`);
    }

    // 2. Find tenants with actually-expired items still in stock (quantity > 0)
    const tenants = await this.inventoryService.findDistinctTenants();

    for (const tenantId of tenants) {
      const expiredItems = await this.inventoryService.findExpiredForCron(tenantId);
      if (expiredItems.length === 0) continue;

      // Check if we already sent an "expired" notification today for this tenant
      const todayKey = new Date().toISOString().slice(0, 10);
      const alreadySent = await this.notificationService.findTodayExpiredDigest(tenantId, todayKey);
      if (alreadySent) continue;

      const count = expiredItems.length;
      const names = expiredItems
        .slice(0, 3)
        .map((i) => (i as any).product?.nameAr || (i as any).product?.name || '')
        .filter(Boolean)
        .join('، ');

      if (await this.settingsSvc.getNotifFlag(tenantId, 'enableExpiryAlerts')) {
        await this.notificationService.create({
          tenantId,
          type: 'expired_stock',
          title: `⛔ ${count} منتج منتهي الصلاحية في المخزون`,
          body: `${names}${count > 3 ? ` و${count - 3} آخرين` : ''} — يجب إزالتهم من المخزون فوراً لتجنب المخالفات التنظيمية`,
          resourceRef: '/pharmacy/inventory?filter=expired',
        });
      }

      this.logger.log(`Sent expired-stock alert to tenant ${tenantId}: ${count} items`);
    }
  }
}
