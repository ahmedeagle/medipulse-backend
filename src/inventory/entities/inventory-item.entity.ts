import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from '../../auth/entities/tenant.entity';
import { Product } from './product.entity';

@Entity('inventory_items')
@Index(['pharmacyTenantId', 'deletedAt'])   // primary access pattern: all items for a pharmacy
@Index(['pharmacyTenantId', 'productId'])   // deduplication check on order delivery
export class InventoryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  pharmacyTenantId: string;

  @ManyToOne(() => Tenant, { eager: false })
  @JoinColumn({ name: 'pharmacyTenantId' })
  pharmacyTenant: Tenant;

  @Column({ type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, (product) => product.inventoryItems, { eager: false })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column({ type: 'int', default: 0 })
  quantity: number;

  @Column({ type: 'int', default: 10 })
  minThreshold: number;

  @Column({ type: 'date', nullable: true })
  expiryDate: Date;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
