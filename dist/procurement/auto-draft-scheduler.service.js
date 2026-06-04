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
var AutoDraftSchedulerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutoDraftSchedulerService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const schedule_1 = require("@nestjs/schedule");
const event_emitter_1 = require("@nestjs/event-emitter");
const procurement_schedule_entity_1 = require("../forecasting/entities/procurement-schedule.entity");
const procurement_draft_entity_1 = require("./entities/procurement-draft.entity");
const ai_recommendation_entity_1 = require("../ai/entities/ai-recommendation.entity");
const notification_service_1 = require("../notifications/notification.service");
const notification_email_service_1 = require("../notifications/notification-email.service");
const user_entity_1 = require("../auth/entities/user.entity");
const tenant_entity_1 = require("../auth/entities/tenant.entity");
const supplier_catalog_item_entity_1 = require("../supplier/entities/supplier-catalog-item.entity");
const role_enum_1 = require("../common/enums/role.enum");
const recommendation_type_enum_1 = require("../common/enums/recommendation-type.enum");
const domain_events_1 = require("../events/domain-events");
let AutoDraftSchedulerService = AutoDraftSchedulerService_1 = class AutoDraftSchedulerService {
    constructor(scheduleRepo, draftRepo, recRepo, catalogRepo, userRepo, tenantRepo, notificationSvc, emailSvc, emitter) {
        this.scheduleRepo = scheduleRepo;
        this.draftRepo = draftRepo;
        this.recRepo = recRepo;
        this.catalogRepo = catalogRepo;
        this.userRepo = userRepo;
        this.tenantRepo = tenantRepo;
        this.notificationSvc = notificationSvc;
        this.emailSvc = emailSvc;
        this.emitter = emitter;
        this.logger = new common_1.Logger(AutoDraftSchedulerService_1.name);
    }
    async runDailyDraftGeneration() {
        this.logger.log('Auto-draft scheduler started');
        try {
            await this._run();
        }
        catch (err) {
            this.logger.error(`Auto-draft scheduler failed: ${err.message}`, err.stack);
        }
    }
    async _run() {
        const urgentSchedules = await this.scheduleRepo
            .createQueryBuilder('s')
            .where('s.daysUntilReorderNeeded <= :days', { days: 2 })
            .andWhere('s.reorderByDate IS NOT NULL')
            .getMany();
        if (!urgentSchedules.length) {
            this.logger.log('Auto-draft: no urgent schedules found');
            return;
        }
        let created = 0;
        let skipped = 0;
        for (const schedule of urgentSchedules) {
            const { tenantId, productId } = schedule;
            const existingDraft = await this.draftRepo.findOne({
                where: { pharmacyTenantId: tenantId, productId, status: 'pending_review' },
            });
            if (existingDraft) {
                skipped++;
                continue;
            }
            const listing = await this.catalogRepo
                .createQueryBuilder('c')
                .where('c.productId = :productId', { productId })
                .andWhere('c.isAvailable = true')
                .andWhere('c.deletedAt IS NULL')
                .orderBy('c.price', 'ASC')
                .getOne();
            if (!listing) {
                skipped++;
                continue;
            }
            const supplierTenantId = schedule.recommendedSupplierTenantId ?? listing.supplierTenantId;
            const eoqQty = schedule.eoqQty ? Math.ceil(Number(schedule.eoqQty)) : 10;
            const rec = await this.recRepo.findOne({
                where: {
                    pharmacyTenantId: tenantId,
                    productId,
                    riskLevel: 'HIGH',
                    type: recommendation_type_enum_1.RecommendationType.REORDER,
                    isDismissed: false,
                },
                order: { createdAt: 'DESC' },
            });
            const expiresAt = new Date(Date.now() + 48 * 3_600_000);
            const draft = await this.draftRepo.save(this.draftRepo.create({
                pharmacyTenantId: tenantId,
                supplierTenantId,
                productId,
                suggestedQuantity: Math.max(1, eoqQty),
                unitPrice: Number(listing.price),
                currency: listing.currency,
                urgencyLevel: 'critical',
                recommendationId: rec?.id ?? null,
                expiresAt,
            }));
            await this.notifyPharmacyAdmins(tenantId, productId, eoqQty);
            this.emitter.emit(domain_events_1.EVENTS.RECOMMENDATION_GENERATED, {
                tenantId,
                recommendationId: draft.id,
                type: 'auto_draft',
                riskLevel: 'HIGH',
                confidence: 0,
            });
            created++;
        }
        this.logger.log(`Auto-draft complete: ${created} created, ${skipped} skipped`);
    }
    async notifyPharmacyAdmins(tenantId, productId, qty) {
        try {
            const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
            const admins = await this.userRepo.find({ where: { tenantId, role: role_enum_1.Role.PHARMACY_ADMIN, isActive: true } });
            await this.notificationSvc.create({
                tenantId,
                type: 'draft_created',
                title: 'Procurement Draft Ready',
                body: `MediPulse has prepared a reorder draft for ${qty} units. Review and approve in the Procurement Queue.`,
                resourceRef: `product:${productId}`,
                emailSent: admins.length > 0,
            });
            for (const admin of admins) {
                const { subject, html } = this.emailSvc.buildDraftCreated('your product', qty, 'Selected Supplier');
                await this.emailSvc.send(admin.email, subject, html);
            }
        }
        catch (err) {
            this.logger.error(`Auto-draft notification failed: ${err.message}`);
        }
    }
};
exports.AutoDraftSchedulerService = AutoDraftSchedulerService;
__decorate([
    (0, schedule_1.Cron)('0 6 * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AutoDraftSchedulerService.prototype, "runDailyDraftGeneration", null);
exports.AutoDraftSchedulerService = AutoDraftSchedulerService = AutoDraftSchedulerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(procurement_schedule_entity_1.ProcurementSchedule)),
    __param(1, (0, typeorm_1.InjectRepository)(procurement_draft_entity_1.ProcurementDraft)),
    __param(2, (0, typeorm_1.InjectRepository)(ai_recommendation_entity_1.AiRecommendation)),
    __param(3, (0, typeorm_1.InjectRepository)(supplier_catalog_item_entity_1.SupplierCatalogItem)),
    __param(4, (0, typeorm_1.InjectRepository)(user_entity_1.User)),
    __param(5, (0, typeorm_1.InjectRepository)(tenant_entity_1.Tenant)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        notification_service_1.NotificationService,
        notification_email_service_1.NotificationEmailService,
        event_emitter_1.EventEmitter2])
], AutoDraftSchedulerService);
//# sourceMappingURL=auto-draft-scheduler.service.js.map