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
var NotificationEventListener_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationEventListener = void 0;
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const notification_service_1 = require("./notification.service");
const notification_email_service_1 = require("./notification-email.service");
const user_entity_1 = require("../auth/entities/user.entity");
const tenant_entity_1 = require("../auth/entities/tenant.entity");
const domain_events_1 = require("../events/domain-events");
const role_enum_1 = require("../common/enums/role.enum");
let NotificationEventListener = NotificationEventListener_1 = class NotificationEventListener {
    constructor(notificationSvc, emailSvc, userRepo, tenantRepo) {
        this.notificationSvc = notificationSvc;
        this.emailSvc = emailSvc;
        this.userRepo = userRepo;
        this.tenantRepo = tenantRepo;
        this.logger = new common_1.Logger(NotificationEventListener_1.name);
    }
    async onRecommendationGenerated(event) {
        if (event.riskLevel !== 'HIGH')
            return;
        try {
            await this.notificationSvc.create({
                tenantId: event.tenantId,
                type: 'high_risk_stockout',
                title: 'Critical Stock Alert',
                body: `A HIGH-risk stock shortage has been detected. A procurement draft has been prepared for your review.`,
                resourceRef: `recommendation:${event.recommendationId}`,
                emailSent: false,
            });
            const admins = await this.getAdmins(event.tenantId, role_enum_1.Role.PHARMACY_ADMIN);
            const tenant = await this.tenantRepo.findOne({ where: { id: event.tenantId } });
            for (const admin of admins) {
                const { subject, html } = this.emailSvc.buildHighRiskStockout('a product', 0, tenant?.name ?? 'Your pharmacy');
                await this.emailSvc.send(admin.email, subject, html);
            }
        }
        catch (err) {
            this.logger.error(`Notification failed (recommendation): ${err.message}`);
        }
    }
    async onOrderStatusChanged(event) {
        try {
            if (['accepted', 'shipped', 'cancelled'].includes(event.to)) {
                await this.notificationSvc.create({
                    tenantId: event.pharmacyTenantId,
                    type: 'order_status_changed',
                    title: `Order ${event.to.toUpperCase()}`,
                    body: `Your order has been ${event.to} by the supplier.`,
                    resourceRef: `order:${event.orderId}`,
                });
                const admins = await this.getAdmins(event.pharmacyTenantId, role_enum_1.Role.PHARMACY_ADMIN);
                const { subject, html } = this.emailSvc.buildOrderStatusChanged(event.orderId, event.to, 'Your order', false);
                for (const admin of admins) {
                    await this.emailSvc.send(admin.email, subject, html);
                }
            }
            if (event.to === 'pending') {
                await this.notificationSvc.create({
                    tenantId: event.supplierTenantId,
                    type: 'order_status_changed',
                    title: 'New Order Received',
                    body: `A pharmacy has placed a new order. Please review and accept or decline.`,
                    resourceRef: `order:${event.orderId}`,
                });
                const supplierAdmins = await this.getAdmins(event.supplierTenantId, role_enum_1.Role.SUPPLIER_ADMIN);
                const { subject, html } = this.emailSvc.buildOrderStatusChanged(event.orderId, 'PENDING — action required', 'New order received', true);
                for (const admin of supplierAdmins) {
                    await this.emailSvc.send(admin.email, subject, html);
                }
            }
        }
        catch (err) {
            this.logger.error(`Notification failed (order status): ${err.message}`);
        }
    }
    async onOrderDelivered(event) {
        try {
            await this.notificationSvc.create({
                tenantId: event.pharmacyTenantId,
                type: 'delivery_confirmed',
                title: 'Delivery Confirmed ✓',
                body: `Your order has been delivered and inventory updated automatically.`,
                resourceRef: `order:${event.orderId}`,
            });
            const tenant = await this.tenantRepo.findOne({ where: { id: event.pharmacyTenantId } });
            const admins = await this.getAdmins(event.pharmacyTenantId, role_enum_1.Role.PHARMACY_ADMIN);
            const { subject, html } = this.emailSvc.buildDeliveryConfirmed(event.orderId.slice(0, 8), tenant?.name ?? 'Your pharmacy');
            for (const admin of admins) {
                await this.emailSvc.send(admin.email, subject, html);
            }
        }
        catch (err) {
            this.logger.error(`Notification failed (delivery): ${err.message}`);
        }
    }
    async getAdmins(tenantId, role) {
        return this.userRepo.find({
            where: { tenantId, role, isActive: true },
        });
    }
};
exports.NotificationEventListener = NotificationEventListener;
__decorate([
    (0, event_emitter_1.OnEvent)(domain_events_1.EVENTS.RECOMMENDATION_GENERATED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [domain_events_1.RecommendationGeneratedEvent]),
    __metadata("design:returntype", Promise)
], NotificationEventListener.prototype, "onRecommendationGenerated", null);
__decorate([
    (0, event_emitter_1.OnEvent)(domain_events_1.EVENTS.ORDER_STATUS_CHANGED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [domain_events_1.OrderStatusChangedEvent]),
    __metadata("design:returntype", Promise)
], NotificationEventListener.prototype, "onOrderStatusChanged", null);
__decorate([
    (0, event_emitter_1.OnEvent)(domain_events_1.EVENTS.ORDER_DELIVERED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [domain_events_1.OrderDeliveredEvent]),
    __metadata("design:returntype", Promise)
], NotificationEventListener.prototype, "onOrderDelivered", null);
exports.NotificationEventListener = NotificationEventListener = NotificationEventListener_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, typeorm_1.InjectRepository)(user_entity_1.User)),
    __param(3, (0, typeorm_1.InjectRepository)(tenant_entity_1.Tenant)),
    __metadata("design:paramtypes", [notification_service_1.NotificationService,
        notification_email_service_1.NotificationEmailService,
        typeorm_2.Repository,
        typeorm_2.Repository])
], NotificationEventListener);
//# sourceMappingURL=notification-event.listener.js.map