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
exports.AdminService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const tenant_entity_1 = require("../auth/entities/tenant.entity");
const user_entity_1 = require("../auth/entities/user.entity");
let AdminService = class AdminService {
    constructor(tenantRepository, userRepository) {
        this.tenantRepository = tenantRepository;
        this.userRepository = userRepository;
    }
    async findAllTenants() {
        const tenants = await this.tenantRepository.find({
            order: { createdAt: 'DESC' },
        });
        const tenantsWithCount = await Promise.all(tenants.map(async (tenant) => {
            const userCount = await this.userRepository.count({
                where: { tenantId: tenant.id },
            });
            return { ...tenant, userCount };
        }));
        return tenantsWithCount;
    }
    async findAllUsers() {
        return this.userRepository.find({
            relations: ['tenant'],
            order: { createdAt: 'DESC' },
        });
    }
    async createTenant(dto) {
        const existing = await this.tenantRepository.findOne({
            where: { slug: dto.slug },
        });
        if (existing) {
            throw new common_1.ConflictException(`A tenant with slug "${dto.slug}" already exists`);
        }
        const tenant = this.tenantRepository.create({
            name: dto.name,
            slug: dto.slug,
            type: dto.type,
            isActive: true,
        });
        return this.tenantRepository.save(tenant);
    }
    async deactivateUser(id) {
        const user = await this.userRepository.findOne({
            where: { id },
            relations: ['tenant'],
        });
        if (!user) {
            throw new common_1.NotFoundException(`User with ID ${id} not found`);
        }
        await this.userRepository.update(id, { isActive: false });
        return this.userRepository.findOne({
            where: { id },
            relations: ['tenant'],
        });
    }
};
exports.AdminService = AdminService;
exports.AdminService = AdminService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(tenant_entity_1.Tenant)),
    __param(1, (0, typeorm_1.InjectRepository)(user_entity_1.User)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository])
], AdminService);
//# sourceMappingURL=admin.service.js.map