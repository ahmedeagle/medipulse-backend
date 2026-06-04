"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantIsolationSubscriber = void 0;
const typeorm_1 = require("typeorm");
const common_1 = require("@nestjs/common");
let TenantIsolationSubscriber = class TenantIsolationSubscriber {
    constructor() {
        this.logger = new common_1.Logger('TenantIsolation');
        this.TENANT_SCOPED_ENTITIES = new Set([
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
    }
    isTenantScoped(entityName) {
        return this.TENANT_SCOPED_ENTITIES.has(entityName);
    }
    afterInsert(event) {
        const name = event.metadata?.name;
        if (!name || !this.isTenantScoped(name))
            return;
        const entity = event.entity;
        if (!entity?.tenantId && !entity?.pharmacyTenantId && !entity?.supplierTenantId) {
            this.logger.warn(`[ISOLATION_AUDIT] INSERT on ${name} without tenantId. ` +
                `Entity id=${entity?.id ?? 'unknown'}. Review the calling service.`);
        }
    }
    afterUpdate(event) {
        const name = event.metadata?.name;
        if (!name || !this.isTenantScoped(name))
            return;
        if (!event.entity) {
            this.logger.debug(`[ISOLATION_AUDIT] Bulk UPDATE on ${name} — verify tenantId filter exists in WHERE clause.`);
        }
    }
    afterRemove(event) {
        const name = event.metadata?.name;
        if (!name || !this.isTenantScoped(name))
            return;
        const entity = event.entity;
        if (entity && !entity?.tenantId && !entity?.pharmacyTenantId) {
            this.logger.warn(`[ISOLATION_AUDIT] DELETE on ${name} without tenantId scope. ` +
                `Entity id=${entity?.id ?? 'unknown'}.`);
        }
    }
};
exports.TenantIsolationSubscriber = TenantIsolationSubscriber;
exports.TenantIsolationSubscriber = TenantIsolationSubscriber = __decorate([
    (0, typeorm_1.EventSubscriber)()
], TenantIsolationSubscriber);
//# sourceMappingURL=tenant-isolation.subscriber.js.map