"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrdersModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const orders_controller_1 = require("./orders.controller");
const orders_service_1 = require("./orders.service");
const invoice_service_1 = require("./invoice.service");
const invoice_entity_1 = require("./entities/invoice.entity");
const order_entity_1 = require("./entities/order.entity");
const order_item_entity_1 = require("./entities/order-item.entity");
const order_return_request_entity_1 = require("./entities/order-return-request.entity");
const order_comment_entity_1 = require("./entities/order-comment.entity");
const inventory_item_entity_1 = require("../inventory/entities/inventory-item.entity");
const supplier_catalog_item_entity_1 = require("../supplier/entities/supplier-catalog-item.entity");
const tenant_entity_1 = require("../auth/entities/tenant.entity");
const redis_module_1 = require("../common/redis/redis.module");
let OrdersModule = class OrdersModule {
};
exports.OrdersModule = OrdersModule;
exports.OrdersModule = OrdersModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([
                order_entity_1.Order, order_item_entity_1.OrderItem, order_return_request_entity_1.OrderReturnRequest, order_comment_entity_1.OrderComment, invoice_entity_1.Invoice,
                inventory_item_entity_1.InventoryItem, supplier_catalog_item_entity_1.SupplierCatalogItem, tenant_entity_1.Tenant,
            ]),
            redis_module_1.RedisModule,
        ],
        controllers: [orders_controller_1.OrdersController],
        providers: [orders_service_1.OrdersService, invoice_service_1.InvoiceService],
        exports: [orders_service_1.OrdersService, invoice_service_1.InvoiceService, typeorm_1.TypeOrmModule],
    })
], OrdersModule);
//# sourceMappingURL=orders.module.js.map