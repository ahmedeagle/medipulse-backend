import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type {
  ImportBatchKind,
  ImportBatchStatus,
} from '../match.constants';

/**
 * One row per CSV upload or "Smart Link" run.
 *
 * Acts as the control record for the async matching pipeline:
 *   - The HTTP controller creates one of these in `queued` state and enqueues
 *     a BullMQ job.
 *   - The worker flips it to `matching`, atomically increments the counters
 *     after every chunk, and finally `completed` (or `failed`).
 *   - The frontend polls a single endpoint (`GET /inventory/imports/:id`) to
 *     drive the live progress toast / wizard.
 */
@Entity('import_batches')
@Index(['tenantId', 'status', 'createdAt'])
export class ImportBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 30, default: 'csv_upload' })
  kind: ImportBatchKind;

  @Column({ type: 'varchar', length: 20, default: 'queued' })
  status: ImportBatchStatus;

  /** Original filename (display-only, for the toast/history list). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  sourceFile: string | null;

  // ── Counters (updated atomically by the worker) ────────────────────────────
  @Column({ type: 'int', default: 0 }) total: number;
  @Column({ type: 'int', default: 0 }) processed: number;
  @Column({ type: 'int', default: 0 }) imported: number;
  @Column({ type: 'int', default: 0 }) updated: number;
  @Column({ type: 'int', default: 0 }) skipped: number;
  @Column({ type: 'int', default: 0 }) autoLinked: number;
  @Column({ type: 'int', default: 0 }) suggested: number;
  @Column({ type: 'int', default: 0 }) unlinked: number;

  /** First N row-level errors (capped to keep payload small). */
  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  errors: Array<{ row: number; reason: string }>;

  /** Fatal error message — only set when status='failed'. */
  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'timestamp', nullable: true }) startedAt: Date | null;
  @Column({ type: 'timestamp', nullable: true }) completedAt: Date | null;
  @Column({ type: 'timestamp', nullable: true }) cancelledAt: Date | null;

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
