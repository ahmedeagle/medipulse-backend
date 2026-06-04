import { Repository } from 'typeorm';
import { TenantIntegration, IntegrationType, IntegrationStatus } from './entities/tenant-integration.entity';
import { IntegrationRegistryService } from './integration-registry.service';
export declare class IntegrationsService {
    private readonly repo;
    private readonly registry;
    constructor(repo: Repository<TenantIntegration>, registry: IntegrationRegistryService);
    create(dto: {
        tenantId: string;
        type: IntegrationType;
        connectorId: string;
        config?: Record<string, any>;
        secretsArn?: string;
    }): Promise<TenantIntegration>;
    findAllForTenant(tenantId: string): Promise<TenantIntegration[]>;
    findAll(): Promise<TenantIntegration[]>;
    toggle(id: string, status: IntegrationStatus): Promise<TenantIntegration>;
    remove(id: string): Promise<void>;
    listActiveConnectors(): {
        tenantId: string;
        type: string;
    }[];
}
