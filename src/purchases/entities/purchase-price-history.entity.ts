import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, Index,
} from 'typeorm';

@Entity('purchase_price_history')
@Index(['pharmacyTenantId', 'productId', 'supplierTenantId'])
@Index(['pharmacyTenantId', 'productId'])
export class PurchasePriceHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  pharmacyTenantId: string;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: 'uuid', nullable: true })
  supplierTenantId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  supplierName: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  price: number;

  @Column({ type: 'uuid' })
  invoiceId: string;

  @Column({ type: 'timestamp' })
  purchasedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
