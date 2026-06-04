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
exports.SupplierProfileService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const supplier_profile_entity_1 = require("./entities/supplier-profile.entity");
let SupplierProfileService = class SupplierProfileService {
    constructor(repo) {
        this.repo = repo;
    }
    async upsert(supplierTenantId, dto) {
        const existing = await this.repo.findOne({ where: { supplierTenantId } });
        if (existing) {
            await this.repo.update(existing.id, {
                ...dto,
                status: existing.status === 'verified' ? 'pending_review' : existing.status,
            });
            return this.repo.findOne({ where: { id: existing.id } });
        }
        return this.repo.save(this.repo.create({ supplierTenantId, ...dto, status: 'pending_review' }));
    }
    async getOwn(supplierTenantId) {
        return this.repo.findOne({ where: { supplierTenantId } });
    }
    async findById(supplierTenantId) {
        const profile = await this.repo.findOne({ where: { supplierTenantId } });
        if (!profile)
            throw new common_1.NotFoundException(`Supplier profile not found`);
        return profile;
    }
    async findAll(status) {
        const where = status ? { status } : {};
        return this.repo.find({ where, order: { companyName: 'ASC' } });
    }
    async findByZone(region) {
        return this.repo
            .createQueryBuilder('p')
            .where('p.deliveryZones @> :zone::jsonb', { zone: JSON.stringify([region]) })
            .andWhere('p.status = :status', { status: 'verified' })
            .getMany();
    }
    async verify(supplierTenantId) {
        const profile = await this.findById(supplierTenantId);
        await this.repo.update(profile.id, { status: 'verified', verifiedAt: new Date(), rejectionReason: null });
        return this.repo.findOne({ where: { id: profile.id } });
    }
    async reject(supplierTenantId, reason) {
        const profile = await this.findById(supplierTenantId);
        await this.repo.update(profile.id, { status: 'rejected', rejectionReason: reason });
        return this.repo.findOne({ where: { id: profile.id } });
    }
    async suspend(supplierTenantId) {
        const profile = await this.findById(supplierTenantId);
        await this.repo.update(profile.id, { status: 'suspended' });
        return this.repo.findOne({ where: { id: profile.id } });
    }
};
exports.SupplierProfileService = SupplierProfileService;
exports.SupplierProfileService = SupplierProfileService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(supplier_profile_entity_1.SupplierProfile)),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], SupplierProfileService);
//# sourceMappingURL=supplier-profile.service.js.map