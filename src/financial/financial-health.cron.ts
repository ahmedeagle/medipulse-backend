import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../auth/entities/tenant.entity';
import { TenantType } from '../common/enums/tenant-type.enum';
import { FinancialService } from './financial.service';
import { NotificationService } from '../notifications/notification.service';

@Injectable()
export class FinancialHealthCron {
  private readonly logger = new Logger(FinancialHealthCron.name);

  constructor(
    private readonly financialService: FinancialService,
    private readonly notificationService: NotificationService,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
  ) {}

  @Cron('0 8 * * *') // every day at 08:00
  async sendFinancialHealthAlerts(): Promise<void> {
    const pharmacies = await this.tenantRepo.find({
      where: { type: TenantType.PHARMACY, isActive: true },
      select: ['id'],
    });

    const todayKey = new Date().toISOString().slice(0, 10);

    for (const tenant of pharmacies) {
      try {
        const snapshot = await this.financialService.getHealthSnapshot(tenant.id);
        if (!snapshot.alerts.length) continue;

        const resourceRef = `financial-health-daily:${todayKey}:${tenant.id}`;
        const existing = await this.notificationService.findByResourceRef(resourceRef, tenant.id);
        if (existing) continue;

        const type = snapshot.deadStockPct > 30 ? 'dead_stock_warning' : 'system';

        await this.notificationService.create({
          tenantId: tenant.id,
          type,
          title: 'تنبيه الصحة المالية',
          body: snapshot.alerts.join(' — '),
          resourceRef,
        });
      } catch (err) {
        this.logger.warn(`Financial health alert failed for tenant ${tenant.id}: ${err?.message}`);
      }
    }

    this.logger.log(`Financial health alerts processed for ${pharmacies.length} pharmacies`);
  }
}
