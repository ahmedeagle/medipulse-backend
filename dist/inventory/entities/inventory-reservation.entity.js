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
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryReservation = exports.ReservationStatus = void 0;
const typeorm_1 = require("typeorm");
var ReservationStatus;
(function (ReservationStatus) {
    ReservationStatus["PENDING"] = "pending";
    ReservationStatus["CONFIRMED"] = "confirmed";
    ReservationStatus["EXPIRED"] = "expired";
    ReservationStatus["RELEASED"] = "released";
    ReservationStatus["COMMITTED"] = "committed";
})(ReservationStatus || (exports.ReservationStatus = ReservationStatus = {}));
let InventoryReservation = class InventoryReservation {
};
exports.InventoryReservation = InventoryReservation;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], InventoryReservation.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'supplier_tenant_id' }),
    __metadata("design:type", String)
], InventoryReservation.prototype, "supplierTenantId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'product_id' }),
    __metadata("design:type", String)
], InventoryReservation.prototype, "productId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'reserved_for_tenant_id' }),
    __metadata("design:type", String)
], InventoryReservation.prototype, "reservedForTenantId", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", Number)
], InventoryReservation.prototype, "quantity", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'order_id', nullable: true }),
    __metadata("design:type", String)
], InventoryReservation.prototype, "orderId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'status', type: 'varchar', length: 20, default: ReservationStatus.PENDING }),
    __metadata("design:type", String)
], InventoryReservation.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'expires_at', type: 'timestamptz' }),
    __metadata("design:type", Date)
], InventoryReservation.prototype, "expiresAt", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], InventoryReservation.prototype, "createdAt", void 0);
exports.InventoryReservation = InventoryReservation = __decorate([
    (0, typeorm_1.Entity)('inventory_reservations'),
    (0, typeorm_1.Index)('ix_reservation_supplier_product', ['supplierTenantId', 'productId']),
    (0, typeorm_1.Index)('ix_reservation_status', ['status']),
    (0, typeorm_1.Index)('ix_reservation_expires', ['expiresAt'])
], InventoryReservation);
//# sourceMappingURL=inventory-reservation.entity.js.map