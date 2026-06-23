import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

export type WishListSource = 'auto' | 'manual';

@Entity('wish_list_items')
@Index(['pharmacyTenantId'])
@Index(['pharmacyTenantId', 'productId'], { unique: true })
export class WishListItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  pharmacyTenantId: string;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: 'varchar', length: 255 })
  productName: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  productSku: string;

  @Column({ type: 'int', default: 0 })
  currentStock: number;

  @Column({ type: 'int', default: 0 })
  requestedQty: number;

  @Column({ type: 'int', nullable: true })
  recommendedQty: number;

  @Column({ type: 'uuid', nullable: true })
  lastSupplierId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  lastSupplierName: string;

  @Column({ type: 'varchar', length: 10, default: 'manual' })
  source: WishListSource;

  @Column({ type: 'uuid', nullable: true })
  draftPoId: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  draftPoNumber: string;

  @UpdateDateColumn()
  updatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
