/**
 * Job/queue identifiers for the catalog matching worker.
 *
 * One queue handles two job kinds so the same worker pod can throttle both:
 *   - MATCH_BATCH_JOB:  process a CSV-upload batch in chunks
 *   - MATCH_TENANT_JOB: re-scan all unlinked items for one tenant
 *                       (powers the "Smart Link" button + cascading rematch
 *                        after a CatalogRequest is approved)
 */
export const MATCH_QUEUE = 'match';

export const MATCH_BATCH_JOB  = 'match-batch';
export const MATCH_TENANT_JOB = 'match-tenant';

/**
 * Soft cap per worker pull.  Keeps memory bounded; tune per pod size.
 * 200 rows × ~50 ms per row (with PG indexes) ≈ 10 s per chunk — safe under
 * Bull's stalled-job timeout of 30 s.
 */
export const MATCH_CHUNK_SIZE = 200;

/** Status values for ImportBatch. */
export type ImportBatchStatus =
  | 'queued'
  | 'matching'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Status values for ImportBatchRow. */
export type ImportBatchRowStatus =
  | 'pending'
  | 'processed'
  | 'errored';

/** What kind of work this batch represents. */
export type ImportBatchKind =
  | 'csv_upload'      // user uploaded a CSV
  | 'tenant_rematch'  // user clicked Smart Link
  | 'admin_cascade';  // system admin approved a CatalogRequest → re-match
