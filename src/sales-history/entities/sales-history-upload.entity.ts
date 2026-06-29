import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * sales_history_uploads — self-service onboarding upload.
 *
 * When a pharmacy migrates onto MediPulse it usually already has 6+ months of
 * historical sales/purchase data exported from its previous system. We let the
 * pharmacy upload those raw files here; the ops team then processes them to
 * backfill `consumption_snapshots`, which unlocks demand forecasting and the
 * seasonal radar from day one instead of cold-starting.
 *
 * Phase 1 scope: STORE the file + notify ops. We deliberately do NOT parse the
 * file here — parsing/backfill is handled by ops/dev tooling so a malformed
 * sheet can never break the live system.
 */
@Entity('sales_history_uploads')
@Index(['tenantId', 'createdAt'])
export class SalesHistoryUpload {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'uuid', nullable: true })
  uploadedByUserId: string | null;

  @Column({ type: 'varchar', length: 255 })
  fileName: string;

  @Column({ type: 'int' })
  fileSize: number;

  @Column({ type: 'varchar', length: 120, nullable: true })
  mimeType: string | null;

  /** Raw uploaded bytes — handed to ops for processing, never parsed live. */
  @Column({ type: 'bytea' })
  fileContent: Buffer;

  /** What the pharmacy says this file contains: sales | purchases | mixed | unspecified */
  @Column({ type: 'varchar', length: 20, default: 'unspecified' })
  kind: string;

  /** Optional free-text note from the pharmacy (date range, source system, etc.) */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  /** Ops workflow state: pending | processed | rejected */
  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: string;

  @CreateDateColumn()
  createdAt: Date;
}
