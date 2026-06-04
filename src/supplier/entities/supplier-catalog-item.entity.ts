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
import { Product } from '../../inventory/entities/product.entity';

@Entity('supplier_catalog')
@Index(['supplierTenantId', 'deletedAt'])          // supplier catalog list
@Index(['productId', 'isAvailable', 'deletedAt'])  // price comparison across suppliers
export class SupplierCatalogItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  supplierTenantId: string;

  @ManyToOne(() => Tenant, { eager: false })
  @JoinColumn({ name: 'supplierTenantId' })
  supplierTenant: Tenant;

  @Column({ type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, (product) => product.supplierCatalogItems, { eager: false })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column({ type: 'varchar', length: 10, default: 'SAR' })
  currency: string;

  @Column({ type: 'boolean', default: true })
  isAvailable: boolean;

  @Column({ type: 'int', default: 0 })
  stock: number;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
