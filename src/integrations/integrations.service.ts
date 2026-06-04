import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantIntegration, IntegrationType, IntegrationStatus } from './entities/tenant-integration.entity';
import { IntegrationRegistryService } from './integration-registry.service';

@Injectable()
export class IntegrationsService {
  constructor(
    @InjectRepository(TenantIntegration)
    private readonly repo: Repository<TenantIntegration>,
    private readonly registry: IntegrationRegistryService,
  ) {}

  async create(dto: {
    tenantId:    string;
    type:        IntegrationType;
    connectorId: string;
    config?:     Record<string, any>;
    secretsArn?: string;
  }): Promise<TenantIntegration> {
    const existing = await this.repo.findOne({
      where: { tenantId: dto.tenantId, type: dto.type },
    });
    if (existing) {
      throw new ConflictException(
        `Tenant ${dto.tenantId} already has a ${dto.type} integration — update or delete it first`,
      );
    }
    return this.repo.save(this.repo.create({ ...dto, status: 'inactive' }));
  }

  async findAllForTenant(tenantId: string): Promise<TenantIntegration[]> {
    return this.repo.find({ where: { tenantId }, order: { type: 'ASC' } });
  }

  async findAll(): Promise<TenantIntegration[]> {
    return this.repo.find({ order: { tenantId: 'ASC', type: 'ASC' } });
  }

  async toggle(id: string, status: IntegrationStatus): Promise<TenantIntegration> {
    const integration = await this.repo.findOne({ where: { id } });
    if (!integration) throw new NotFoundException(`Integration ${id} not found`);
    await this.repo.update(id, { status });
    return this.repo.findOne({ where: { id } });
  }

  async remove(id: string): Promise<void> {
    const integration = await this.repo.findOne({ where: { id } });
    if (!integration) throw new NotFoundException(`Integration ${id} not found`);
    await this.repo.delete(id);
    this.registry.unregister(integration.tenantId, integration.type as any);
  }

  /** Returns the registered connectors (in-memory, from IntegrationRegistryService) */
  listActiveConnectors() {
    return this.registry.listRegistered();
  }
}
