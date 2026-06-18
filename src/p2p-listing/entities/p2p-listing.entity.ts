import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type ListingStatus = 'active' | 'paused' | 'sold_out' | 'expired';
export type ListingType = 'normal' | 'clearance' | 'emergency';
export type OfferType = 'none' | 'discount' | 'bonus';

@Entity('p2p_listings')
@Index(['sellerTenantId', 'status'])
@Index(['productId', 'status'])
@Index(['expiryDate', 'status'])
@Index(['inventoryItemId'])
@Index(['listingType', 'status'])
export class P2pListing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  sellerTenantId: string;

  @Column({ type: 'uuid' })
  inventoryItemId: string;

  /** Denormalized for fast marketplace search without joining inventory */
  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column({ type: 'int', default: 0 })
  quantity: number;

  @Column({ type: 'int', default: 1 })
  minOrderQty: number;

  @Column({ type: 'date', nullable: true })
  expiryDate: Date;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: ListingStatus;

  /** normal = standard listing, clearance = 🔥 near-expiry, emergency = ⚡ available now */
  @Column({ type: 'varchar', length: 20, default: 'normal' })
  listingType: ListingType;

  @Column({ type: 'varchar', length: 20, default: 'none' })
  offerType: OfferType;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  discountPct: number;

  @Column({ type: 'int', nullable: true })
  bonusQty: number;

  /** When true, the auto-discount cron will adjust discountPct as expiry approaches */
  @Column({ type: 'boolean', default: false })
  autoUpdateDiscount: boolean;

  @UpdateDateColumn()
  updatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
