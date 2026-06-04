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
exports.PreferredSupplierService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const preferred_supplier_entity_1 = require("./entities/preferred-supplier.entity");
const supplier_profile_entity_1 = require("./entities/supplier-profile.entity");
let PreferredSupplierService = class PreferredSupplierService {
    constructor(repo, profileRepo) {
        this.repo = repo;
        this.profileRepo = profileRepo;
    }
    async connect(pharmacyTenantId, supplierTenantId, priority = 5, notes) {
        const existing = await this.repo.findOne({ where: { pharmacyTenantId, supplierTenantId } });
        if (existing) {
            await this.repo.update(existing.id, { priority, notes: notes ?? null });
            return this.repo.findOne({ where: { id: existing.id } });
        }
        return this.repo.save(this.repo.create({ pharmacyTenantId, supplierTenantId, priority, notes }));
    }
    async disconnect(pharmacyTenantId, supplierTenantId) {
        const link = await this.repo.findOne({ where: { pharmacyTenantId, supplierTenantId } });
        if (!link)
            throw new common_1.NotFoundException('Connection not found');
        await this.repo.delete(link.id);
    }
    async listForPharmacy(pharmacyTenantId) {
        return this.repo.find({
            where: { pharmacyTenantId },
            order: { priority: 'ASC' },
        });
    }
    async getPriorityList(pharmacyTenantId) {
        const links = await this.listForPharmacy(pharmacyTenantId);
        return links.map((l) => l.supplierTenantId);
    }
};
exports.PreferredSupplierService = PreferredSupplierService;
exports.PreferredSupplierService = PreferredSupplierService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(preferred_supplier_entity_1.PreferredSupplier)),
    __param(1, (0, typeorm_1.InjectRepository)(supplier_profile_entity_1.SupplierProfile)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository])
], PreferredSupplierService);
//# sourceMappingURL=preferred-supplier.service.js.map