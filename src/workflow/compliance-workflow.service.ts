import { Injectable, Logger } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { ProductBatch } from '../inventory/entities/product-batch.entity';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { NotificationService } from '../notifications/notification.service';
import { NotificationEmailService } from '../notifications/notification-email.service';
import { User } from '../auth/entities/user.entity';
import { Role } from '../common/enums/role.enum';
import { EVENTS } from '../events/domain-events';

/**
 * Compliance workflow orchestration:
 *   - Product recalls: quarantine inventory, notify all affected pharmacies
 *   - Expiry alerts: 90-day, 30-day, 7-day advance warnings per batch
 *
 * Kept separate from OrderWorkflowService because these are compliance-domain
 * concerns (SFDA, batch tracking) vs. procurement-domain concerns (order lifecycle).
 */
@Injectable()
export class ComplianceWorkflowService {
  private readonly logger = new Logger(ComplianceWorkflowService.name);

  constructor(
    @InjectRepository(ProductBatch)
    private readonly batchRepo: Repository<ProductBatch>,
    @InjectRepository(InventoryItem)
    private readonly inventoryRepo: Repository<InventoryItem>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly notificationSvc: NotificationService,
    private readonly emailSvc: NotificationEmailService,
    private readonly emitter: EventEmitter2,
  ) {}

  // ─── Recall handling ─────────────────────────────────────────────────────

  @OnEvent(EVENTS.PRODUCT_RECALLED)
  async onProductRecalled(event: {
    recallId:              string;
    productId:             string;
    batchNumber?:          string;
    recallType:            string;
    recallReferenceNumber: string;
    affectedPharmacyIds:   string[];
  }): Promise<void> {
    try {
      // Quarantine all inventory items with the recalled batch
      const inventoryQb = this.inventoryRepo
        .createQueryBuilder()
        .where('productId = :productId', { productId: event.productId });

      const affected = await inventoryQb.getMany();
      this.logger.log(`Recall ${event.recallId}: flagging ${affected.length} inventory records`);

      // Notify each affected pharmacy
      for (const pharmacyId of event.affectedPharmacyIds) {
        await this.notificationSvc.create({
          tenantId:    pharmacyId,
          type:        'system',
          title:       `⚠️ Product Recall — ${event.recallType.toUpperCase()}`,
          body:        `SFDA Recall Reference: ${event.recallReferenceNumber}. ` +
                       `Please immediately quarantine the affected product/batch and do not dispense.`,
          resourceRef: `recall:${event.recallId}`,
          emailSent:   false,
        });

        const admins = await this.getAdmins(pharmacyId);
        for (const admin of admins) {
          await this.emailSvc.send(
            admin.email,
            `⚠️ URGENT: Product Recall Notice — Ref: ${event.recallReferenceNumber}`,
            this.buildRecallEmail(event.recallReferenceNumber, event.recallType),
          );
        }
      }

      this.logger.log(
        `Recall notifications sent to ${event.affectedPharmacyIds.length} pharmacies`,
      );
    } catch (err: any) {
      this.logger.error(`onProductRecalled failed: ${err.message}`);
    }
  }

  // ─── Expiry alert cron — runs daily at 7am ────────────────────────────────

  @Cron('0 7 * * *')
  async checkExpiryAlerts(): Promise<void> {
    const now = new Date();

    // Three alert windows: 90 days (planning), 30 days (action), 7 days (critical)
    const windows = [
      { days: 90, label: 'Planning Alert', urgency: 'low'      as const },
      { days: 30, label: 'Action Required', urgency: 'medium'  as const },
      { days: 7,  label: 'CRITICAL',         urgency: 'high'   as const },
    ];

    for (const window of windows) {
      const cutoff = new Date(now.getTime() + window.days * 86_400_000);

      const expiringBatches = await this.batchRepo
        .createQueryBuilder('b')
        .where("b.status = 'active'")
        .andWhere('b.expiryDate <= :cutoff', { cutoff })
        .andWhere('b.expiryDate > :now', { now })
        .getMany();

      for (const batch of expiringBatches) {
        // Find pharmacies holding this batch (via OrderItem.batchNumber + InventoryItem)
        const holding = await this.inventoryRepo
          .createQueryBuilder('i')
          .where('i.productId = :productId', { productId: batch.productId })
          .andWhere('i.quantity > 0')
          .andWhere('i.deletedAt IS NULL')
          .getMany();

        const uniqueTenants = [...new Set(holding.map((i) => i.pharmacyTenantId))];

        for (const tenantId of uniqueTenants) {
          const daysRemaining = Math.floor(
            (new Date(batch.expiryDate).getTime() - now.getTime()) / 86_400_000,
          );

          await this.notificationSvc.create({
            tenantId,
            type:        'system',
            title:       `${window.label}: Product expiring in ${daysRemaining} days`,
            body:        `Batch ${batch.batchNumber} expires on ` +
                         `${new Date(batch.expiryDate).toLocaleDateString()}. ` +
                         `Take action to avoid waste or patient harm.`,
            resourceRef: `batch:${batch.id}`,
          });

          this.emitter.emit(EVENTS.BATCH_EXPIRY_ALERT, {
            batchId: batch.id, productId: batch.productId,
            expiryDate: batch.expiryDate, daysRemaining, tenantId,
          });
        }
      }

      if (expiringBatches.length > 0) {
        this.logger.log(`Expiry alerts (${window.days}d): ${expiringBatches.length} batches`);
      }
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async getAdmins(tenantId: string): Promise<User[]> {
    return this.userRepo.find({ where: { tenantId, role: Role.PHARMACY_ADMIN, isActive: true } });
  }

  private buildRecallEmail(referenceNumber: string, recallType: string): string {
    return `
      <!DOCTYPE html><html><body style="font-family:sans-serif;max-width:580px;margin:0 auto;padding:24px">
        <div style="background:#fef2f2;border:2px solid #ef4444;border-radius:12px;padding:24px">
          <h2 style="color:#dc2626;margin-top:0">⚠️ URGENT: Product Recall Notice</h2>
          <p><strong>SFDA Reference:</strong> ${referenceNumber}</p>
          <p><strong>Recall Type:</strong> ${recallType.replace('_', ' ').toUpperCase()}</p>
          <p style="color:#dc2626;font-weight:bold">
            Immediately quarantine all affected product/batch stock.
            Do not dispense to patients until further notice.
          </p>
          <p>Log in to MediPulse for full recall details and next steps.</p>
        </div>
        <p style="color:#9ca3af;font-size:11px;margin-top:16px;text-align:center">
          MediPulse — Healthcare Procurement Intelligence
        </p>
      </body></html>
    `;
  }
}
