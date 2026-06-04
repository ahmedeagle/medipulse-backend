import { SetMetadata } from '@nestjs/common';

export const AUDIT_READ_KEY = 'audit:read:resource';

/**
 * Mark a GET handler as sensitive — access will be recorded in ReadAccessLog.
 *
 * Usage:
 *   @AuditRead('supplier_catalog')
 *   @Get('catalog')
 *   findAll() { ... }
 *
 * Standard resource labels:
 *   supplier_catalog     — supplier pricing viewed by pharmacy
 *   ai_recommendations   — AI recommendations accessed
 *   audit_logs           — audit log accessed (meta-audit)
 *   read_access_logs     — read access logs accessed
 *   org_inventory        — chain admin viewing branch inventory
 *   org_orders           — chain admin viewing branch orders
 *   order_detail         — specific order detail
 *   procurement_draft    — procurement draft viewed
 *   kc_auth_events       — KC auth events accessed
 */
export const AuditRead = (resource: string) => SetMetadata(AUDIT_READ_KEY, resource);
