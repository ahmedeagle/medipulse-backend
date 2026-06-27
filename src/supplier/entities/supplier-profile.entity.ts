import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type ProfileStatus = 'pending_review' | 'verified' | 'rejected' | 'suspended';

/**
 * Extended business profile for supplier tenants.
 * One-to-one with Tenant (supplierTenantId is unique).
 *
 * Suppliers fill this in after onboarding. System admin verifies.
 * Verification status affects recommendation ranking (verified suppliers rank higher).
 */
@Entity('supplier_profiles')
@Index(['supplierTenantId'], { unique: true })
@Index(['status'])
export class SupplierProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  supplierTenantId: string;

  // ── Business information ───────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255 })
  companyName: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  registrationNumber: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  licenseNumber: string;

  @Column({ type: 'date', nullable: true })
  licenseExpiryDate: Date;

  @Column({ type: 'text', nullable: true })
  address: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string;

  /** Business email for PO confirmations, invoice corrections, dispute trail. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string;

  /**
   * WhatsApp number (E.164, e.g. "+201234567890").
   * Primary fast-channel for delivery coordination — most Egyptian/Saudi
   * pharma suppliers respond to WhatsApp faster than to email or phone.
   */
  @Column({ type: 'varchar', length: 32, nullable: true })
  whatsapp: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  website: string;

  // ── Operational details ────────────────────────────────────────────────────

  /**
   * Regions the supplier delivers to.
   * Matches values in Tenant.region and RegionalDemandSignal.region.
   * Example: ["riyadh", "jeddah", "ksa_east"]
   */
  @Column({ type: 'jsonb', default: [] })
  deliveryZones: string[];

  /** Minimum order amount in SAR */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  minOrderAmount: number;

  /** Maximum lead time in days for standard orders */
  @Column({ type: 'int', default: 7 })
  maxDeliveryDays: number;

  /** Payment terms description, e.g. "Net 30", "Cash on delivery" */
  @Column({ type: 'varchar', length: 100, nullable: true })
  paymentTerms: string;

  // ── Certifications ─────────────────────────────────────────────────────────

  /**
   * Array of certification objects.
   * Example: [{ name: "SFDA", number: "12345", expiryDate: "2027-01-01" }]
   */
  @Column({ type: 'jsonb', default: [] })
  certifications: Array<{ name: string; number?: string; expiryDate?: string }>;

  // ── Verification ───────────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 20, default: 'pending_review' })
  status: ProfileStatus;

  @Column({ type: 'text', nullable: true })
  rejectionReason: string;

  @Column({ type: 'timestamp', nullable: true })
  verifiedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
