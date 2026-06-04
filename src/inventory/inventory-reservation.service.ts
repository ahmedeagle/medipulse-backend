import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, In } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import {
  InventoryReservation, ReservationStatus,
} from './entities/inventory-reservation.entity';

const REDIS_STOCK_KEY = (supplierTenantId: string, productId: string) =>
  `medipulse:stock:avail:${supplierTenantId}:${productId}`;

const CHECKOUT_TTL_MS  = 15 * 60 * 1000;   // 15 minutes
const CONFIRMED_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Atomic stock reservation via Redis DECRBY.
 *
 * Redis key `medipulse:stock:avail:{supplier}:{product}` = availableStock.
 * DECRBY is atomic — prevents race conditions when two pharmacies order the
 * last unit simultaneously.
 *
 * The Lua script below:
 *   1. Checks current available > requested quantity
 *   2. If yes → DECRBY atomically → return new value
 *   3. If no  → return -1 (caller throws InsufficientStockException)
 */
const RESERVE_SCRIPT = `
  local key = KEYS[1]
  local qty = tonumber(ARGV[1])
  local cur = tonumber(redis.call('GET', key) or '0')
  if cur < qty then
    return -1
  end
  return redis.call('DECRBY', key, qty)
`;

@Injectable()
export class InventoryReservationService {
  constructor(
    @InjectRepository(InventoryReservation)
    private readonly repo: Repository<InventoryReservation>,
    @InjectRedis()
    private readonly redis: Redis,
  ) {}

  /** Seed the Redis available stock counter from the DB (called on startup / sync). */
  async syncAvailableStock(supplierTenantId: string, productId: string, physicalStock: number): Promise<void> {
    const activeReservations = await this.repo.sum(
      'quantity' as any,
      {
        supplierTenantId,
        productId,
        status: In([ReservationStatus.PENDING, ReservationStatus.CONFIRMED]),
      },
    );
    const available = Math.max(0, physicalStock - (Number(activeReservations) || 0));
    await this.redis.set(REDIS_STOCK_KEY(supplierTenantId, productId), available);
  }

  /**
   * Atomically reserve stock.
   * Returns the reservation record or throws if insufficient.
   */
  async reserve(
    supplierTenantId: string,
    productId:        string,
    pharmacyTenantId: string,
    quantity:         number,
    orderId?:         string,
    isPending?:       boolean, // true = checkout hold, false = confirmed order
  ): Promise<InventoryReservation> {
    const key    = REDIS_STOCK_KEY(supplierTenantId, productId);
    const result = await (this.redis as any).eval(RESERVE_SCRIPT, 1, key, quantity);

    if (result === -1) {
      throw new BadRequestException(
        `Insufficient stock for product ${productId}. Only ${await this.redis.get(key) ?? 0} units available.`,
      );
    }

    const ttl    = isPending ? CHECKOUT_TTL_MS : CONFIRMED_TTL_MS;
    const status = isPending ? ReservationStatus.PENDING : ReservationStatus.CONFIRMED;

    return this.repo.save(
      this.repo.create({
        supplierTenantId,
        productId,
        reservedForTenantId: pharmacyTenantId,
        quantity,
        orderId:    orderId ?? null,
        status,
        expiresAt:  new Date(Date.now() + ttl),
      }),
    );
  }

  /** Confirm a pending reservation (order placed → extend TTL to 24h). */
  async confirm(reservationId: string, orderId: string): Promise<void> {
    await this.repo.update(reservationId, {
      status:   ReservationStatus.CONFIRMED,
      orderId,
      expiresAt: new Date(Date.now() + CONFIRMED_TTL_MS),
    });
  }

  /** Commit a confirmed reservation (order shipped — never expires). */
  async commit(reservationId: string): Promise<void> {
    await this.repo.update(reservationId, { status: ReservationStatus.COMMITTED });
  }

  /** Release a reservation (order cancelled). Restores available stock. */
  async release(reservationId: string): Promise<void> {
    const res = await this.repo.findOne({ where: { id: reservationId } });
    if (!res || res.status === ReservationStatus.RELEASED) return;

    await this.repo.update(reservationId, { status: ReservationStatus.RELEASED });

    // Restore the Redis counter
    const key = REDIS_STOCK_KEY(res.supplierTenantId, res.productId);
    await this.redis.incrby(key, res.quantity);
  }

  /** Cron: expire stale PENDING reservations and restore stock. */
  @Cron(CronExpression.EVERY_MINUTE)
  async expireStale(): Promise<void> {
    const stale = await this.repo.find({
      where: {
        status:    In([ReservationStatus.PENDING, ReservationStatus.CONFIRMED]),
        expiresAt: LessThan(new Date()),
      },
    });

    for (const res of stale) {
      await this.repo.update(res.id, { status: ReservationStatus.EXPIRED });
      const key = REDIS_STOCK_KEY(res.supplierTenantId, res.productId);
      await this.redis.incrby(key, res.quantity);
    }
  }
}
