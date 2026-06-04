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
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrdersController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const orders_service_1 = require("./orders.service");
const invoice_service_1 = require("./invoice.service");
const create_order_dto_1 = require("./dto/create-order.dto");
const update_order_status_dto_1 = require("./dto/update-order-status.dto");
const order_status_enum_1 = require("../common/enums/order-status.enum");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
const role_enum_1 = require("../common/enums/role.enum");
const audit_read_decorator_1 = require("../audit/decorators/audit-read.decorator");
class ReceiveItemDto {
}
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], ReceiveItemDto.prototype, "orderItemId", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], ReceiveItemDto.prototype, "quantityAccepted", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], ReceiveItemDto.prototype, "quantityRejected", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReceiveItemDto.prototype, "rejectionReason", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReceiveItemDto.prototype, "batchNumber", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReceiveItemDto.prototype, "expiryDateOnBatch", void 0);
class ConfirmReceiptDto {
}
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_transformer_1.Type)(() => ReceiveItemDto),
    __metadata("design:type", Array)
], ConfirmReceiptDto.prototype, "items", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ConfirmReceiptDto.prototype, "deliveryProofUrl", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ConfirmReceiptDto.prototype, "recipientName", void 0);
class OrderActionDto {
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], OrderActionDto.prototype, "reason", void 0);
class CounterOfferDto {
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CounterOfferDto.prototype, "reason", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CounterOfferDto.prototype, "counterOfferNotes", void 0);
class AddCommentDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AddCommentDto.prototype, "body", void 0);
class ReturnItemDto {
}
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], ReturnItemDto.prototype, "orderItemId", void 0);
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], ReturnItemDto.prototype, "productId", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], ReturnItemDto.prototype, "quantity", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReturnItemDto.prototype, "returnReason", void 0);
class InitiateReturnDto {
}
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_transformer_1.Type)(() => ReturnItemDto),
    __metadata("design:type", Array)
], InitiateReturnDto.prototype, "items", void 0);
let OrdersController = class OrdersController {
    constructor(ordersService, invoiceService) {
        this.ordersService = ordersService;
        this.invoiceService = invoiceService;
    }
    findAll(user, status, supplierTenantId, from, to, take = 50, skip = 0) {
        return this.ordersService.findAll(user, {
            status, supplierTenantId,
            from: from ? new Date(from) : undefined,
            to: to ? new Date(to) : undefined,
            take, skip,
        });
    }
    findOne(user, id) {
        return this.ordersService.findOne(user, id);
    }
    create(user, dto) {
        return this.ordersService.create(user.tenantId, dto, user);
    }
    updateStatus(user, id, dto) {
        return this.ordersService.updateStatus(user, id, dto.status, { reason: dto.reason });
    }
    approve(user, id) {
        return this.ordersService.approve(user, id);
    }
    confirmReceipt(user, id, dto) {
        return this.ordersService.confirmReceipt(user, id, dto.items, {
            deliveryProofUrl: dto.deliveryProofUrl,
            recipientName: dto.recipientName,
        });
    }
    dispute(user, id, dto) {
        return this.ordersService.updateStatus(user, id, order_status_enum_1.OrderStatus.DISPUTED, { reason: dto.reason });
    }
    hold(user, id, dto) {
        return this.ordersService.updateStatus(user, id, order_status_enum_1.OrderStatus.ON_HOLD, { reason: dto.reason });
    }
    initiateReturn(user, id, dto) {
        return this.ordersService.initiateReturn(user, id, dto.items);
    }
    getReturns(id) {
        return this.ordersService.getReturnRequests(id);
    }
    getComments(user, id) {
        return this.ordersService.getComments(user, id);
    }
    getInvoice(id) {
        return this.invoiceService.generateForOrder(id);
    }
    addComment(user, id, dto) {
        return this.ordersService.addComment(user, id, dto.body);
    }
};
exports.OrdersController = OrdersController;
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN, role_enum_1.Role.SUPPLIER_ADMIN, role_enum_1.Role.CHAIN_ADMIN),
    (0, swagger_1.ApiOperation)({
        summary: 'List orders — filtered by role, with search and pagination',
        description: 'PHARMACY_ADMIN sees their orders. SUPPLIER_ADMIN sees orders directed to them. All support filtering by status, date range, and supplier.',
    }),
    (0, swagger_1.ApiQuery)({ name: 'status', required: false, enum: order_status_enum_1.OrderStatus }),
    (0, swagger_1.ApiQuery)({ name: 'supplierTenantId', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'from', required: false, description: 'ISO date' }),
    (0, swagger_1.ApiQuery)({ name: 'to', required: false, description: 'ISO date' }),
    (0, swagger_1.ApiQuery)({ name: 'take', required: false, schema: { default: 50 } }),
    (0, swagger_1.ApiQuery)({ name: 'skip', required: false, schema: { default: 0 } }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('status')),
    __param(2, (0, common_1.Query)('supplierTenantId')),
    __param(3, (0, common_1.Query)('from')),
    __param(4, (0, common_1.Query)('to')),
    __param(5, (0, common_1.Query)('take', new common_1.DefaultValuePipe(50), common_1.ParseIntPipe)),
    __param(6, (0, common_1.Query)('skip', new common_1.DefaultValuePipe(0), common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, Object, Object]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, audit_read_decorator_1.AuditRead)('order_detail'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN, role_enum_1.Role.SUPPLIER_ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Get order detail including full change history' }),
    (0, swagger_1.ApiNotFoundResponse)(),
    (0, swagger_1.ApiForbiddenResponse)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "findOne", null);
__decorate([
    (0, common_1.Post)(),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN),
    (0, swagger_1.ApiOperation)({
        summary: 'Place a new order',
        description: 'Orders above the tenant approval threshold auto-route to PENDING_APPROVAL. Duplicate orders for the same product+supplier trigger 409 unless allowDuplicate:true is passed.',
    }),
    (0, swagger_1.ApiCreatedResponse)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_order_dto_1.CreateOrderDto]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id/status'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SUPPLIER_ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Update order status (supplier side: accept, ship, back-order, etc.)' }),
    (0, swagger_1.ApiBadRequestResponse)({ description: 'Invalid status transition' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, update_order_status_dto_1.UpdateOrderStatusDto]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "updateStatus", null);
__decorate([
    (0, common_1.Post)(':id/approve'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Director approval for orders above the approval threshold' }),
    (0, swagger_1.ApiOkResponse)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "approve", null);
__decorate([
    (0, common_1.Post)(':id/receive'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN),
    (0, swagger_1.ApiOperation)({
        summary: 'Confirm receipt — specify accepted and rejected quantities per item',
        description: 'Called when order is in RECEIVED_PENDING_QC. ' +
            'If all quantityAccepted = ordered quantity → DELIVERED. ' +
            'If some rejected → PARTIALLY_DELIVERED + auto-creates return request. ' +
            'If all rejected → DISPUTED. ' +
            'Inventory is incremented by quantityAccepted only.',
    }),
    (0, swagger_1.ApiBody)({ type: ConfirmReceiptDto }),
    (0, swagger_1.ApiOkResponse)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, ConfirmReceiptDto]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "confirmReceipt", null);
__decorate([
    (0, common_1.Post)(':id/dispute'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Open a dispute on a delivered order (quantity mismatch, quality issue, etc.)' }),
    (0, swagger_1.ApiBody)({ type: OrderActionDto }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, OrderActionDto]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "dispute", null);
__decorate([
    (0, common_1.Post)(':id/hold'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN, role_enum_1.Role.SUPPLIER_ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Put an accepted order on hold (payment dispute, stock issue)' }),
    (0, swagger_1.ApiBody)({ type: OrderActionDto }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, OrderActionDto]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "hold", null);
__decorate([
    (0, common_1.Post)(':id/return'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Initiate a return request for delivered items' }),
    (0, swagger_1.ApiBody)({ type: InitiateReturnDto }),
    (0, swagger_1.ApiCreatedResponse)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, InitiateReturnDto]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "initiateReturn", null);
__decorate([
    (0, common_1.Get)(':id/returns'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN, role_enum_1.Role.SUPPLIER_ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'List return requests for an order' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "getReturns", null);
__decorate([
    (0, common_1.Get)(':id/comments'),
    (0, audit_read_decorator_1.AuditRead)('order_detail'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN, role_enum_1.Role.SUPPLIER_ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Get the full comment thread for an order' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "getComments", null);
__decorate([
    (0, common_1.Get)(':id/invoice'),
    (0, audit_read_decorator_1.AuditRead)('invoice'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN, role_enum_1.Role.SUPPLIER_ADMIN),
    (0, swagger_1.ApiOperation)({
        summary: 'Generate or retrieve the ZATCA-compliant tax invoice for a delivered order',
        description: 'Idempotent — calling twice returns the same invoice. Only available after DELIVERED status.',
    }),
    (0, swagger_1.ApiOkResponse)({ description: 'Invoice with ZATCA QR code' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "getInvoice", null);
__decorate([
    (0, common_1.Post)(':id/comments'),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.PHARMACY_ADMIN, role_enum_1.Role.SUPPLIER_ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Add a comment to the order thread (visible to both parties)' }),
    (0, swagger_1.ApiBody)({ type: AddCommentDto }),
    (0, swagger_1.ApiCreatedResponse)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, AddCommentDto]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "addComment", null);
exports.OrdersController = OrdersController = __decorate([
    (0, swagger_1.ApiTags)('orders'),
    (0, swagger_1.ApiBearerAuth)('access-token'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('orders'),
    __metadata("design:paramtypes", [orders_service_1.OrdersService,
        invoice_service_1.InvoiceService])
], OrdersController);
//# sourceMappingURL=orders.controller.js.map