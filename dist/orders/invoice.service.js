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
var InvoiceService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvoiceService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const ioredis_1 = require("ioredis");
const invoice_entity_1 = require("./entities/invoice.entity");
const order_entity_1 = require("./entities/order.entity");
const tenant_entity_1 = require("../auth/entities/tenant.entity");
const order_status_enum_1 = require("../common/enums/order-status.enum");
const redis_module_1 = require("../common/redis/redis.module");
let InvoiceService = InvoiceService_1 = class InvoiceService {
    constructor(invoiceRepo, orderRepo, tenantRepo, redis) {
        this.invoiceRepo = invoiceRepo;
        this.orderRepo = orderRepo;
        this.tenantRepo = tenantRepo;
        this.redis = redis;
        this.logger = new common_1.Logger(InvoiceService_1.name);
    }
    async generateForOrder(orderId) {
        const existing = await this.invoiceRepo.findOne({ where: { orderId } });
        if (existing)
            return existing;
        const order = await this.orderRepo.findOne({
            where: { id: orderId },
            relations: ['items', 'items.product'],
        });
        if (!order)
            throw new common_1.NotFoundException(`Order ${orderId} not found`);
        const deliveredStatuses = [order_status_enum_1.OrderStatus.DELIVERED, order_status_enum_1.OrderStatus.PARTIALLY_DELIVERED];
        if (!deliveredStatuses.includes(order.status)) {
            throw new common_1.BadRequestException(`Invoice can only be generated for delivered orders. Current status: ${order.status}`);
        }
        const [pharmacy, supplier] = await Promise.all([
            this.tenantRepo.findOne({ where: { id: order.pharmacyTenantId } }),
            this.tenantRepo.findOne({ where: { id: order.supplierTenantId } }),
        ]);
        const invoiceNumber = await this.generateInvoiceNumber();
        const issueDate = new Date();
        const invoice = this.invoiceRepo.create({
            orderId,
            pharmacyTenantId: order.pharmacyTenantId,
            supplierTenantId: order.supplierTenantId,
            invoiceNumber,
            issueDate,
            subtotalAmount: Number(order.subtotalAmount),
            vatRate: Number(order.vatRate),
            vatAmount: Number(order.vatAmount),
            totalAmount: Number(order.totalAmount),
            currency: order.currency,
            buyerName: pharmacy?.name ?? 'Unknown Pharmacy',
            sellerName: supplier?.name ?? 'Unknown Supplier',
            status: 'issued',
            issuedAt: issueDate,
        });
        invoice.qrCode = this.generateZatcaQrCode({
            sellerName: invoice.sellerName,
            sellerVatNumber: invoice.sellerVatNumber ?? '000000000000000',
            timestamp: issueDate.toISOString(),
            totalAmount: invoice.totalAmount,
            vatAmount: invoice.vatAmount,
        });
        const saved = await this.invoiceRepo.save(invoice);
        this.logger.log(`Invoice ${invoiceNumber} generated for order ${orderId}`);
        return saved;
    }
    async findByOrder(orderId) {
        return this.invoiceRepo.findOne({ where: { orderId } });
    }
    generateZatcaQrCode(params) {
        const fields = [
            { tag: 0x01, value: params.sellerName },
            { tag: 0x02, value: params.sellerVatNumber },
            { tag: 0x03, value: params.timestamp },
            { tag: 0x04, value: params.totalAmount.toFixed(2) },
            { tag: 0x05, value: params.vatAmount.toFixed(2) },
        ];
        const bytes = [];
        for (const field of fields) {
            const encoded = Buffer.from(field.value, 'utf-8');
            bytes.push(field.tag);
            bytes.push(encoded.length);
            bytes.push(...encoded);
        }
        return Buffer.from(bytes).toString('base64');
    }
    async generateInvoiceNumber() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const key = `medipulse:invoice:seq:${year}-${month}`;
        const seq = await this.redis.incr(key);
        if (seq === 1) {
            await this.redis.expire(key, 40 * 86_400);
        }
        return `${year}-${month}-${String(seq).padStart(6, '0')}`;
    }
};
exports.InvoiceService = InvoiceService;
exports.InvoiceService = InvoiceService = InvoiceService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(invoice_entity_1.Invoice)),
    __param(1, (0, typeorm_1.InjectRepository)(order_entity_1.Order)),
    __param(2, (0, typeorm_1.InjectRepository)(tenant_entity_1.Tenant)),
    __param(3, (0, common_1.Inject)(redis_module_1.REDIS_CLIENT)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        ioredis_1.default])
], InvoiceService);
//# sourceMappingURL=invoice.service.js.map