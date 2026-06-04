import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Pharmacy's preferred supplier network.
 * A pharmacy can mark suppliers as preferred with a priority (1 = highest).
 *
 * Effect on recommendations:
 *   The rules engine checks this table when selecting the recommended supplier
 *   for REORDER and draft generation — preferred suppliers are chosen first
 *   (if available and within acceptable price range).
 */
@Entity('preferred_suppliers')
@Index(['pharmacyTenantId', 'supplierTenantId'], { unique: true })
@Index(['pharmacyTenantId', 'priority'])
export class PreferredSupplier {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  pharmacyTenantId: string;

  @Column({ type: 'uuid' })
  supplierTenantId: string;

  /**
   * Priority within the pharmacy's preferred list.
   * 1 = highest priority (first choice), higher number = lower priority.
   */
  @Column({ type: 'int', default: 5 })
  priority: number;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn()
  createdAt: Date;
}
