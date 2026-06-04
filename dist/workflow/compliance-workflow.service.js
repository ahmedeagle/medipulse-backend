"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var ComplianceWorkflowService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ComplianceWorkflowService = void 0;
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const schedule_1 = require("@nestjs/schedule");
const product_batch_entity_1 = require("../inventory/entities/product-batch.entity");
const inventory_item_entity_1 = require("../inventory/entities/inventory-item.entity");
const notification_service_1 = require("../notifications/notification.service");
const notification_email_service_1 = require("../notifications/notification-email.service");
const user_entity_1 = require("../auth/entities/user.entity");
const role_enum_1 = require("../common/enums/role.enum");
const domain_events_1 = require("../events/domain-events");
let ComplianceWorkflowService = ComplianceWorkflowService_1 = class ComplianceWorkflowService {
    constructor(batchRepo, inventoryRepo, userRepo, dataSource, notificationSvc, emailSvc, emitter) {
        this.batchRepo = batchRepo;
        this.inventoryRepo = inventoryRepo;
        this.userRepo = userRepo;
        this.dataSource = dataSource;
        this.notificationSvc = notificationSvc;
        this.emailSvc = emailSvc;
        this.emitter = emitter;
        this.logger = new common_1.Logger(ComplianceWorkflowService_1.name);
    }
    async onProductRecalled(event) {
        try {
            const inventoryQb = this.inventoryRepo
                .createQueryBuilder()
                .where('productId = :productId', { productId: event.productId });
            const affected = await inventoryQb.getMany();
            this.logger.log(`Recall ${event.recallId}: flagging ${affected.length} inventory records`);
            for (const pharmacyId of event.affectedPharmacyIds) {
                await this.notificationSvc.create({
                    tenantId: pharmacyId,
                    type: 'system',
                    title: `⚠️ Product Recall — ${event.recallType.toUpperCase()}`,
                    body: `SFDA Recall Reference: ${event.recallReferenceNumber}. ` +
                        `Please immediately quarantine the affected product/batch and do not dispense.`,
                    resourceRef: `recall:${event.recallId}`,
                    emailSent: false,
                });
                const admins = await this.getAdmins(pharmacyId);
                for (const admin of admins) {
                    await this.emailSvc.send(admin.email, `⚠️ URGENT: Product Recall Notice — Ref: ${event.recallReferenceNumber}`, this.buildRecallEmail(event.recallReferenceNumber, event.recallType));
                }
            }
            this.logger.log(`Recall notifications sent to ${event.affectedPharmacyIds.length} pharmacies`);
        }
        catch (err) {
            this.logger.error(`onProductRecalled failed: ${err.message}`);
        }
    }
    async checkExpiryAlerts() {
        const now = new Date();
        const windows = [
            { days: 90, label: 'Planning Alert', urgency: 'low' },
            { days: 30, label: 'Action Required', urgency: 'medium' },
            { days: 7, label: 'CRITICAL', urgency: 'high' },
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
                const holding = await this.inventoryRepo
                    .createQueryBuilder('i')
                    .where('i.productId = :productId', { productId: batch.productId })
                    .andWhere('i.quantity > 0')
                    .andWhere('i.deletedAt IS NULL')
                    .getMany();
                const uniqueTenants = [...new Set(holding.map((i) => i.pharmacyTenantId))];
                for (const tenantId of uniqueTenants) {
                    const daysRemaining = Math.floor((new Date(batch.expiryDate).getTime() - now.getTime()) / 86_400_000);
                    await this.notificationSvc.create({
                        tenantId,
                        type: 'system',
                        title: `${window.label}: Product expiring in ${daysRemaining} days`,
                        body: `Batch ${batch.batchNumber} expires on ` +
                            `${new Date(batch.expiryDate).toLocaleDateString()}. ` +
                            `Take action to avoid waste or patient harm.`,
                        resourceRef: `batch:${batch.id}`,
                    });
                    this.emitter.emit(domain_events_1.EVENTS.BATCH_EXPIRY_ALERT, {
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
    async getAdmins(tenantId) {
        return this.userRepo.find({ where: { tenantId, role: role_enum_1.Role.PHARMACY_ADMIN, isActive: true } });
    }
    buildRecallEmail(referenceNumber, recallType) {
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
};
exports.ComplianceWorkflowService = ComplianceWorkflowService;
__decorate([
    (0, event_emitter_1.OnEvent)(domain_events_1.EVENTS.PRODUCT_RECALLED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ComplianceWorkflowService.prototype, "onProductRecalled", null);
__decorate([
    (0, schedule_1.Cron)('0 7 * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ComplianceWorkflowService.prototype, "checkExpiryAlerts", null);
exports.ComplianceWorkflowService = ComplianceWorkflowService = ComplianceWorkflowService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(product_batch_entity_1.ProductBatch)),
    __param(1, (0, typeorm_1.InjectRepository)(inventory_item_entity_1.InventoryItem)),
    __param(2, (0, typeorm_1.InjectRepository)(user_entity_1.User)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.DataSource,
        notification_service_1.NotificationService,
        notification_email_service_1.NotificationEmailService,
        event_emitter_1.EventEmitter2])
], ComplianceWorkflowService);
//# sourceMappingURL=compliance-workflow.service.js.map