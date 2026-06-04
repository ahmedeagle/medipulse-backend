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
var OrderWorkflowService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderWorkflowService = void 0;
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const order_return_request_entity_1 = require("../orders/entities/order-return-request.entity");
const order_comment_entity_1 = require("../orders/entities/order-comment.entity");
const ai_recommendation_entity_1 = require("../ai/entities/ai-recommendation.entity");
const notification_service_1 = require("../notifications/notification.service");
const notification_email_service_1 = require("../notifications/notification-email.service");
const user_entity_1 = require("../auth/entities/user.entity");
const role_enum_1 = require("../common/enums/role.enum");
const recommendation_type_enum_1 = require("../common/enums/recommendation-type.enum");
const domain_events_1 = require("../events/domain-events");
let OrderWorkflowService = OrderWorkflowService_1 = class OrderWorkflowService {
    constructor(returnRepo, commentRepo, recRepo, userRepo, notificationSvc, emailSvc) {
        this.returnRepo = returnRepo;
        this.commentRepo = commentRepo;
        this.recRepo = recRepo;
        this.userRepo = userRepo;
        this.notificationSvc = notificationSvc;
        this.emailSvc = emailSvc;
        this.logger = new common_1.Logger(OrderWorkflowService_1.name);
    }
    async onOrderSubmitted(event) {
        try {
            await this.notificationSvc.create({
                tenantId: event.supplierTenantId,
                type: 'order_status_changed',
                title: 'New Order Received',
                body: `Order #${event.orderId.slice(0, 8)} has been submitted. Please review and accept or decline.`,
                resourceRef: `order:${event.orderId}`,
            });
            const supplierAdmins = await this.getAdmins(event.supplierTenantId, role_enum_1.Role.SUPPLIER_ADMIN);
            for (const admin of supplierAdmins) {
                const { subject, html } = this.emailSvc.buildOrderStatusChanged(event.orderId, 'PENDING — action required', 'New order received', true);
                await this.emailSvc.send(admin.email, subject, html);
            }
        }
        catch (err) {
            this.logger.error(`onOrderSubmitted failed: ${err.message}`);
        }
    }
    async onApprovalRequired(event) {
        try {
            await this.notificationSvc.create({
                tenantId: event.pharmacyTenantId,
                type: 'draft_created',
                title: 'Order Requires Director Approval',
                body: `Order #${event.orderId.slice(0, 8)} (SAR ${event.totalAmount.toLocaleString()}) requires your approval before submission.`,
                resourceRef: `order:${event.orderId}`,
            });
        }
        catch (err) {
            this.logger.error(`onApprovalRequired failed: ${err.message}`);
        }
    }
    async onStatusChanged(event) {
        try {
            const notifyPharmacy = ['accepted', 'shipped', 'back_ordered', 'failed_delivery', 'on_hold', 'cancelled'].includes(event.to);
            const notifySupplier = ['return_requested', 'disputed'].includes(event.to);
            if (notifyPharmacy) {
                await this.notificationSvc.create({
                    tenantId: event.pharmacyTenantId,
                    type: 'order_status_changed',
                    title: `Order ${event.to.replace(/_/g, ' ').toUpperCase()}`,
                    body: `Order #${event.orderId.slice(0, 8)} status updated to ${event.to}.`,
                    resourceRef: `order:${event.orderId}`,
                });
            }
            if (notifySupplier) {
                await this.notificationSvc.create({
                    tenantId: event.supplierTenantId,
                    type: 'order_status_changed',
                    title: `Order ${event.to.replace(/_/g, ' ').toUpperCase()}`,
                    body: `Pharmacy has reported an issue with Order #${event.orderId.slice(0, 8)}.`,
                    resourceRef: `order:${event.orderId}`,
                });
            }
        }
        catch (err) {
            this.logger.error(`onStatusChanged notification failed: ${err.message}`);
        }
    }
    async onOrderDelivered(event) {
        try {
            const productIds = event.items.map((i) => i.productId);
            if (!productIds.length)
                return;
            const recs = await this.recRepo
                .createQueryBuilder('r')
                .where('r.pharmacyTenantId = :tenantId', { tenantId: event.pharmacyTenantId })
                .andWhere('r.productId IN (:...productIds)', { productIds })
                .andWhere('r.type = :type', { type: recommendation_type_enum_1.RecommendationType.REORDER })
                .andWhere('r.outcome IS NULL')
                .andWhere('r.isDismissed = false')
                .getMany();
            if (recs.length) {
                await this.recRepo
                    .createQueryBuilder()
                    .update()
                    .set({ outcome: 'acted_on', outcomeAt: new Date() })
                    .where('id IN (:...ids)', { ids: recs.map((r) => r.id) })
                    .execute();
                this.logger.log(`Marked ${recs.length} recommendation(s) as acted_on for tenant ${event.pharmacyTenantId}`);
            }
            await this.notificationSvc.create({
                tenantId: event.pharmacyTenantId,
                type: 'delivery_confirmed',
                title: 'Delivery Confirmed ✓',
                body: `Order #${event.orderId.slice(0, 8)} has been received and inventory updated.`,
                resourceRef: `order:${event.orderId}`,
            });
        }
        catch (err) {
            this.logger.error(`onOrderDelivered side effects failed: ${err.message}`);
        }
    }
    async onReturnRequested(event) {
        try {
            const returnReq = await this.returnRepo.findOne({
                where: { orderId: event.orderId },
                order: { createdAt: 'DESC' },
            });
            if (returnReq) {
                await this.notificationSvc.create({
                    tenantId: returnReq.supplierTenantId,
                    type: 'order_status_changed',
                    title: 'Return Request Received',
                    body: `Pharmacy has initiated a return for Order #${event.orderId.slice(0, 8)}. Please review and approve or reject.`,
                    resourceRef: `order:${event.orderId}`,
                });
            }
        }
        catch (err) {
            this.logger.error(`onReturnRequested notification failed: ${err.message}`);
        }
    }
    async getAdmins(tenantId, role) {
        return this.userRepo.find({ where: { tenantId, role, isActive: true } });
    }
};
exports.OrderWorkflowService = OrderWorkflowService;
__decorate([
    (0, event_emitter_1.OnEvent)(domain_events_1.EVENTS.ORDER_SUBMITTED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OrderWorkflowService.prototype, "onOrderSubmitted", null);
__decorate([
    (0, event_emitter_1.OnEvent)(domain_events_1.EVENTS.ORDER_APPROVAL_REQUIRED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OrderWorkflowService.prototype, "onApprovalRequired", null);
__decorate([
    (0, event_emitter_1.OnEvent)(domain_events_1.EVENTS.ORDER_STATUS_CHANGED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OrderWorkflowService.prototype, "onStatusChanged", null);
__decorate([
    (0, event_emitter_1.OnEvent)(domain_events_1.EVENTS.ORDER_DELIVERED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OrderWorkflowService.prototype, "onOrderDelivered", null);
__decorate([
    (0, event_emitter_1.OnEvent)(domain_events_1.EVENTS.ORDER_RETURN_REQUESTED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OrderWorkflowService.prototype, "onReturnRequested", null);
exports.OrderWorkflowService = OrderWorkflowService = OrderWorkflowService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(order_return_request_entity_1.OrderReturnRequest)),
    __param(1, (0, typeorm_1.InjectRepository)(order_comment_entity_1.OrderComment)),
    __param(2, (0, typeorm_1.InjectRepository)(ai_recommendation_entity_1.AiRecommendation)),
    __param(3, (0, typeorm_1.InjectRepository)(user_entity_1.User)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        notification_service_1.NotificationService,
        notification_email_service_1.NotificationEmailService])
], OrderWorkflowService);
//# sourceMappingURL=order-workflow.service.js.map