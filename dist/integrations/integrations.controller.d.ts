import { IntegrationsService } from './integrations.service';
import { IntegrationType } from './entities/tenant-integration.entity';
declare class CreateIntegrationDto {
    tenantId: string;
    type: IntegrationType;
    connectorId: string;
    config?: Record<string, any>;
    secretsArn?: string;
}
export declare class IntegrationsController {
    private readonly svc;
    constructor(svc: IntegrationsService);
    create(dto: CreateIntegrationDto): Promise<import("./entities/tenant-integration.entity").TenantIntegration>;
    findAll(): Promise<import("./entities/tenant-integration.entity").TenantIntegration[]>;
    findMine(user: any): Promise<import("./entities/tenant-integration.entity").TenantIntegration[]>;
    listActiveConnectors(): {
        tenantId: string;
        type: string;
    }[];
    enable(id: string): Promise<import("./entities/tenant-integration.entity").TenantIntegration>;
    disable(id: string): Promise<import("./entities/tenant-integration.entity").TenantIntegration>;
    remove(id: string): Promise<void>;
}
export {};
