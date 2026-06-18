import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { P2pOrder } from './entities/p2p-order.entity';
import { P2pListing } from '../p2p-listing/entities/p2p-listing.entity';

/**
 * Scans every 5 minutes for accepted orders whose reservation window has
 * expired. Cancels the order and restores the listing's quantity so the
 * stock becomes available for other buyers.
 */
@Injectable()
export class P2pReservationCron {
  private readonly logger = new Logger(P2pReservationCron.name);

  constructor(
    @InjectRepository(P2pOrder)
    private readonly orderRepo: Repository<P2pOrder>,
    @InjectRepository(P2pListing)
    private readonly listingRepo: Repository<P2pListing>,
  ) {}

  @Cron('*/5 * * * *')
  async expireStaleReservations(): Promise<void> {
    const expired = await this.orderRepo.find({
      where: {
        status: 'accepted',
        reservationExpiresAt: LessThan(new Date()),
      },
      take: 100,
    });

    if (!expired.length) return;

    this.logger.log(`Expiring ${expired.length} stale reservation(s)`);

    for (const order of expired) {
      try {
        const listing = await this.listingRepo.findOne({
          where: { id: order.listingId },
        });
        if (listing) {
          await this.listingRepo.update(listing.id, {
            quantity: listing.quantity + order.requestedQty,
            status: 'active',
          });
        }
        await this.orderRepo.update(order.id, { status: 'cancelled' });
      } catch (err: any) {
        this.logger.error(`Failed to expire reservation ${order.id}: ${err.message}`);
      }
    }
  }
}
