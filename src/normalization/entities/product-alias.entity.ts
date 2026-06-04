import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Product } from '../../inventory/entities/product.entity';

/**
 * Maps a supplier-specific SKU or trade name to a canonical Product.
 * This is the core of the product normalization moat:
 * "Amox-500", "Amoxil", "AMX CAP 500mg" all resolve to the same canonical product.
 */
@Entity('product_aliases')
@Index(['supplierTenantId', 'supplierSku'])
@Index(['canonicalProductId'])
export class ProductAlias {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The canonical product this alias resolves to */
  @Column({ type: 'uuid' })
  canonicalProductId: string;

  @ManyToOne(() => Product, { eager: false })
  @JoinColumn({ name: 'canonicalProductId' })
  canonicalProduct: Product;

  /** The supplier that uses this SKU/name */
  @Column({ type: 'uuid' })
  supplierTenantId: string;

  /** Supplier's own SKU or product identifier */
  @Column({ type: 'varchar', length: 255 })
  supplierSku: string;

  /** Supplier's display name for this product (for UI reference) */
  @Column({ type: 'varchar', length: 255, nullable: true })
  supplierName: string;

  /** Mapping confidence: 'auto' (system-suggested) | 'confirmed' (admin-verified) */
  @Column({ type: 'varchar', length: 20, default: 'confirmed' })
  mappingSource: 'auto' | 'confirmed';

  @CreateDateColumn()
  mappedAt: Date;
}
