export type IntegrationType = 'erp' | 'pos' | 'supplier_api';
export type IntegrationStatus = 'active' | 'inactive' | 'error';
export declare class TenantIntegration {
    id: string;
    tenantId: string;
    type: IntegrationType;
    connectorId: string;
    config: Record<string, any>;
    secretsArn: string;
    status: IntegrationStatus;
    lastSyncAt: Date;
    lastError: string;
    updatedAt: Date;
    createdAt: Date;
}
