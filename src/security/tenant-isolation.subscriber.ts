import {
  EventSubscriber, EntitySubscriberInterface,
  InsertEvent, UpdateEvent, RemoveEvent,
} from 'typeorm';
import { Logger } from '@nestjs/common';

/**
 * TenantIsolationSubscriber — TypeORM entity subscriber that
 * logs a warning whenever a mutating operation is performed without
 * an apparent tenant scope.
 *
 * This is an AUDIT and ALERTING layer, not an enforcement gate.
 * Enforcement is done at the service layer via explicit tenantId
 * filters on all queries.
 *
 * In future, this can be promoted to a hard block for entities
 * that implement the `TenantScoped` interface.
 */
@EventSubscriber()
export class TenantIsolationSubscriber implements EntitySubscriberInterface {
  private readonly logger = new Logger('TenantIsolation');

  private readonly TENANT_SCOPED_ENTITIES = new Set([
    'InventoryItem',
    'AiRecommendation',
    'Order',
    'ProcurementDraft',
    'FinancialLedgerEntry',
    'CreditWallet',
    'PaymentTransaction',
    'InventoryReservation',
    'WebhookSubscription',
  ]);

  private isTenantScoped(entityName: string): boolean {
    return this.TENANT_SCOPED_ENTITIES.has(entityName);
  }

  afterInsert(event: InsertEvent<any>): void {
    const name = event.metadata?.name;
    if (!name || !this.isTenantScoped(name)) return;
    const entity = event.entity as any;
    if (!entity?.tenantId && !entity?.pharmacyTenantId && !entity?.supplierTenantId) {
      this.logger.warn(
        `[ISOLATION_AUDIT] INSERT on ${name} without tenantId. ` +
        `Entity id=${entity?.id ?? 'unknown'}. Review the calling service.`,
      );
    }
  }

  afterUpdate(event: UpdateEvent<any>): void {
    const name = event.metadata?.name;
    if (!name || !this.isTenantScoped(name)) return;
    // Bulk updates (no entity) — log for review
    if (!event.entity) {
      this.logger.debug(`[ISOLATION_AUDIT] Bulk UPDATE on ${name} — verify tenantId filter exists in WHERE clause.`);
    }
  }

  afterRemove(event: RemoveEvent<any>): void {
    const name = event.metadata?.name;
    if (!name || !this.isTenantScoped(name)) return;
    const entity = event.entity as any;
    if (entity && !entity?.tenantId && !entity?.pharmacyTenantId) {
      this.logger.warn(
        `[ISOLATION_AUDIT] DELETE on ${name} without tenantId scope. ` +
        `Entity id=${entity?.id ?? 'unknown'}.`,
      );
    }
  }
}
