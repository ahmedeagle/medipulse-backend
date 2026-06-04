"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegrationsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const tenant_integration_entity_1 = require("./entities/tenant-integration.entity");
const integration_registry_service_1 = require("./integration-registry.service");
let IntegrationsService = class IntegrationsService {
    constructor(repo, registry) {
        this.repo = repo;
        this.registry = registry;
    }
    async create(dto) {
        const existing = await this.repo.findOne({
            where: { tenantId: dto.tenantId, type: dto.type },
        });
        if (existing) {
            throw new common_1.ConflictException(`Tenant ${dto.tenantId} already has a ${dto.type} integration — update or delete it first`);
        }
        return this.repo.save(this.repo.create({ ...dto, status: 'inactive' }));
    }
    async findAllForTenant(tenantId) {
        return this.repo.find({ where: { tenantId }, order: { type: 'ASC' } });
    }
    async findAll() {
        return this.repo.find({ order: { tenantId: 'ASC', type: 'ASC' } });
    }
    async toggle(id, status) {
        const integration = await this.repo.findOne({ where: { id } });
        if (!integration)
            throw new common_1.NotFoundException(`Integration ${id} not found`);
        await this.repo.update(id, { status });
        return this.repo.findOne({ where: { id } });
    }
    async remove(id) {
        const integration = await this.repo.findOne({ where: { id } });
        if (!integration)
            throw new common_1.NotFoundException(`Integration ${id} not found`);
        await this.repo.delete(id);
        this.registry.unregister(integration.tenantId, integration.type);
    }
    listActiveConnectors() {
        return this.registry.listRegistered();
    }
};
exports.IntegrationsService = IntegrationsService;
exports.IntegrationsService = IntegrationsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(tenant_integration_entity_1.TenantIntegration)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        integration_registry_service_1.IntegrationRegistryService])
], IntegrationsService);
//# sourceMappingURL=integrations.service.js.map