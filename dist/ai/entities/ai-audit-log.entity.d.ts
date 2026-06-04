import { Tenant } from '../../auth/entities/tenant.entity';
import { User } from '../../auth/entities/user.entity';
export type AuditStatus = 'success' | 'failed' | 'blocked_input' | 'blocked_output' | 'rate_limited';
export declare class AiAuditLog {
    id: string;
    pharmacyTenantId: string;
    pharmacyTenant: Tenant;
    triggeredByUserId: string;
    triggeredByUser: User;
    model: string;
    promptVersion: string;
    status: AuditStatus;
    recommendationsGenerated: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    latencyMs: number;
    rulesTriggered: string[];
    outputsBlocked: number;
    errorMessage: string;
    createdAt: Date;
}
