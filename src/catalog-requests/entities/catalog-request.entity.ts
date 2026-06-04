import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type CatalogRequestStatus =
  | 'submitted'
  | 'under_review'
  | 'need_info'
  | 'approved'
  | 'rejected'
  | 'closed';

export type CatalogRequestType = 'add' | 'fix' | 'merge';

export type CatalogRequestDecision = 'approved' | 'rejected' | 'merged' | 'closed';

export interface CatalogRequestPayload {
  /** Proposed / observed product name (Arabic). */
  nameAr?: string;
  /** Proposed / observed product name (English). */
  name?: string;
  /** Barcode / GTIN if known. */
  barcode?: string;
  /** Manufacturer as reported by the pharmacy. */
  manufacturer?: string;
  /** Dosage form (tablet, syrup, etc.). */
  dosageForm?: string;
  /** Strength label (e.g. "500mg"). */
  strength?: string;
  /** Optional reference image URL or data URL. */
  imageUrl?: string;
  /** Free-form notes from the requester. */
  notes?: string;
  /** Any extra signals (sku, atc, etc.). */
  [k: string]: any;
}

export interface CatalogRequestTimelineEntry {
  at:    string;
  actor: 'pharmacy' | 'admin' | 'system';
  actorId?: string;
  event: string;     // 'submitted' | 'reviewed' | 'need_info' | 'approved' | 'rejected' | 'merged' | 'note'
  note?: string;
}

/**
 * Catalog Request — formal ticket from a pharmacy asking the catalog admin team
 * to add a missing product, fix an existing one, or merge duplicates.
 *
 * Each request has a stable, human-readable tracking number (REQ-XXXXXX) so
 * pharmacy staff can follow up. The full lifecycle is appended to `timeline`
 * as immutable audit entries.
 */
@Entity('catalog_requests')
@Index(['pharmacyTenantId', 'status'])
@Index(['status', 'createdAt'])
@Index(['trackingNumber'])
export class CatalogRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Public tracking ID, e.g. REQ-A1B2C3. Unique. */
  @Column({ type: 'varchar', length: 20, unique: true })
  trackingNumber: string;

  @Column({ type: 'uuid' })
  pharmacyTenantId: string;

  /** Optional link back to the inventory row that triggered the request. */
  @Column({ type: 'uuid', nullable: true })
  inventoryItemId: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @Column({ type: 'varchar', length: 20, default: 'add' })
  type: CatalogRequestType;

  @Column({ type: 'varchar', length: 20, default: 'submitted' })
  status: CatalogRequestStatus;

  /** Snapshot of what the pharmacy submitted. Immutable history of intent. */
  @Column({ type: 'jsonb' })
  payload: CatalogRequestPayload;

  @Column({ type: 'varchar', length: 20, nullable: true })
  adminDecision: CatalogRequestDecision | null;

  @Column({ type: 'uuid', nullable: true })
  adminUserId: string | null;

  @Column({ type: 'text', nullable: true })
  adminNotes: string | null;

  @Column({ type: 'text', nullable: true })
  rejectionReason: string | null;

  /** Catalog product the admin chose / created when approving. */
  @Column({ type: 'uuid', nullable: true })
  resolvedCatalogProductId: string | null;

  /** Append-only audit log of every state transition. */
  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  timeline: CatalogRequestTimelineEntry[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date | null;
}
