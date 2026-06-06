import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import type { ImportBatchRowStatus } from '../match.constants';

/**
 * One staged row per CSV line, awaiting the matcher worker.
 *
 * Why a separate table instead of inserting directly into `inventory_items`:
 *   - `inventory_items.productId` is NOT NULL — we cannot pre-create rows
 *     before the matcher decides which Product to link to.
 *   - Cancellation = `DELETE FROM import_batch_rows WHERE batchId = ?` —
 *     no orphaned inventory rows to clean up.
 *   - Retry semantics: failed rows stay in 'pending' for the next worker tick.
 */
@Entity('import_batch_rows')
@Index(['batchId', 'status'])
export class ImportBatchRow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  batchId: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  /** Excel/CSV row number (1-indexed, including header) — used in error reports. */
  @Column({ type: 'int' })
  rowNumber: number;

  /** Raw parsed row payload — exact CSV columns the worker will consume. */
  @Column({ type: 'jsonb' })
  csvData: Record<string, string | undefined>;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: ImportBatchRowStatus;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn() createdAt: Date;
}
