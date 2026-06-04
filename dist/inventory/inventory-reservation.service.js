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
exports.InventoryReservationService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const schedule_1 = require("@nestjs/schedule");
const ioredis_1 = require("@nestjs-modules/ioredis");
const ioredis_2 = require("ioredis");
const inventory_reservation_entity_1 = require("./entities/inventory-reservation.entity");
const REDIS_STOCK_KEY = (supplierTenantId, productId) => `medipulse:stock:avail:${supplierTenantId}:${productId}`;
const CHECKOUT_TTL_MS = 15 * 60 * 1000;
const CONFIRMED_TTL_MS = 24 * 60 * 60 * 1000;
const RESERVE_SCRIPT = `
  local key = KEYS[1]
  local qty = tonumber(ARGV[1])
  local cur = tonumber(redis.call('GET', key) or '0')
  if cur < qty then
    return -1
  end
  return redis.call('DECRBY', key, qty)
`;
let InventoryReservationService = class InventoryReservationService {
    constructor(repo, redis) {
        this.repo = repo;
        this.redis = redis;
    }
    async syncAvailableStock(supplierTenantId, productId, physicalStock) {
        const activeReservations = await this.repo.sum('quantity', {
            supplierTenantId,
            productId,
            status: (0, typeorm_2.In)([inventory_reservation_entity_1.ReservationStatus.PENDING, inventory_reservation_entity_1.ReservationStatus.CONFIRMED]),
        });
        const available = Math.max(0, physicalStock - (Number(activeReservations) || 0));
        await this.redis.set(REDIS_STOCK_KEY(supplierTenantId, productId), available);
    }
    async reserve(supplierTenantId, productId, pharmacyTenantId, quantity, orderId, isPending) {
        const key = REDIS_STOCK_KEY(supplierTenantId, productId);
        const result = await this.redis.eval(RESERVE_SCRIPT, 1, key, quantity);
        if (result === -1) {
            throw new common_1.BadRequestException(`Insufficient stock for product ${productId}. Only ${await this.redis.get(key) ?? 0} units available.`);
        }
        const ttl = isPending ? CHECKOUT_TTL_MS : CONFIRMED_TTL_MS;
        const status = isPending ? inventory_reservation_entity_1.ReservationStatus.PENDING : inventory_reservation_entity_1.ReservationStatus.CONFIRMED;
        return this.repo.save(this.repo.create({
            supplierTenantId,
            productId,
            reservedForTenantId: pharmacyTenantId,
            quantity,
            orderId: orderId ?? null,
            status,
            expiresAt: new Date(Date.now() + ttl),
        }));
    }
    async confirm(reservationId, orderId) {
        await this.repo.update(reservationId, {
            status: inventory_reservation_entity_1.ReservationStatus.CONFIRMED,
            orderId,
            expiresAt: new Date(Date.now() + CONFIRMED_TTL_MS),
        });
    }
    async commit(reservationId) {
        await this.repo.update(reservationId, { status: inventory_reservation_entity_1.ReservationStatus.COMMITTED });
    }
    async release(reservationId) {
        const res = await this.repo.findOne({ where: { id: reservationId } });
        if (!res || res.status === inventory_reservation_entity_1.ReservationStatus.RELEASED)
            return;
        await this.repo.update(reservationId, { status: inventory_reservation_entity_1.ReservationStatus.RELEASED });
        const key = REDIS_STOCK_KEY(res.supplierTenantId, res.productId);
        await this.redis.incrby(key, res.quantity);
    }
    async expireStale() {
        const stale = await this.repo.find({
            where: {
                status: (0, typeorm_2.In)([inventory_reservation_entity_1.ReservationStatus.PENDING, inventory_reservation_entity_1.ReservationStatus.CONFIRMED]),
                expiresAt: (0, typeorm_2.LessThan)(new Date()),
            },
        });
        for (const res of stale) {
            await this.repo.update(res.id, { status: inventory_reservation_entity_1.ReservationStatus.EXPIRED });
            const key = REDIS_STOCK_KEY(res.supplierTenantId, res.productId);
            await this.redis.incrby(key, res.quantity);
        }
    }
};
exports.InventoryReservationService = InventoryReservationService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_MINUTE),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], InventoryReservationService.prototype, "expireStale", null);
exports.InventoryReservationService = InventoryReservationService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(inventory_reservation_entity_1.InventoryReservation)),
    __param(1, (0, ioredis_1.InjectRedis)()),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        ioredis_2.default])
], InventoryReservationService);
//# sourceMappingURL=inventory-reservation.service.js.map