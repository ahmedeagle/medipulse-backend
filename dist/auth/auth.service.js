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
var AuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const user_entity_1 = require("./entities/user.entity");
const tenant_entity_1 = require("./entities/tenant.entity");
const role_enum_1 = require("../common/enums/role.enum");
const tenant_type_enum_1 = require("../common/enums/tenant-type.enum");
const keycloak_admin_service_1 = require("./services/keycloak-admin.service");
let AuthService = AuthService_1 = class AuthService {
    constructor(userRepo, tenantRepo, kcAdmin, dataSource) {
        this.userRepo = userRepo;
        this.tenantRepo = tenantRepo;
        this.kcAdmin = kcAdmin;
        this.dataSource = dataSource;
        this.logger = new common_1.Logger(AuthService_1.name);
    }
    async register(dto) {
        const existingUser = await this.userRepo.findOne({ where: { email: dto.email } });
        if (existingUser) {
            throw new common_1.ConflictException(`A user with email ${dto.email} already exists`);
        }
        const role = dto.tenantType === tenant_type_enum_1.TenantType.PHARMACY
            ? role_enum_1.Role.PHARMACY_ADMIN
            : role_enum_1.Role.SUPPLIER_ADMIN;
        const slug = this.toSlug(dto.tenantName);
        const existingSlug = await this.tenantRepo.findOne({ where: { slug } });
        const finalSlug = existingSlug ? `${slug}-${Date.now()}` : slug;
        const qr = this.dataSource.createQueryRunner();
        await qr.connect();
        await qr.startTransaction();
        let kcId = null;
        try {
            const tenant = qr.manager.create(tenant_entity_1.Tenant, {
                name: dto.tenantName,
                slug: finalSlug,
                type: dto.tenantType,
                isActive: true,
            });
            const savedTenant = await qr.manager.save(tenant_entity_1.Tenant, tenant);
            const user = qr.manager.create(user_entity_1.User, {
                kcId: 'pending',
                email: dto.email,
                firstName: dto.firstName,
                lastName: dto.lastName,
                role,
                isActive: true,
                tenantId: savedTenant.id,
            });
            const savedUser = await qr.manager.save(user_entity_1.User, user);
            kcId = await this.kcAdmin.createUser({
                email: dto.email,
                firstName: dto.firstName,
                lastName: dto.lastName,
                role,
                tenantId: savedTenant.id,
            });
            await qr.manager.update(user_entity_1.User, savedUser.id, { kcId });
            await qr.commitTransaction();
            this.logger.log(`Registered: ${dto.email} tenant=${savedTenant.id} kc=${kcId}`);
            const { passwordHash: _pw, ...safe } = savedUser;
            return {
                user: { ...safe, kcId },
                message: `User created. A password setup email has been sent to ${dto.email}.`,
            };
        }
        catch (err) {
            await qr.rollbackTransaction();
            if (kcId) {
                try {
                    await this.kcAdmin.deleteUser(kcId);
                    this.logger.warn(`Rolled back KC user ${kcId} after DB failure`);
                }
                catch (cleanupErr) {
                    this.logger.error(`KC cleanup failed for ${kcId}: ${cleanupErr.message}`);
                }
            }
            throw err;
        }
        finally {
            await qr.release();
        }
    }
    async syncProfile(kcClaims) {
        let user = await this.userRepo.findOne({ where: { kcId: kcClaims.id } });
        if (!user) {
            user = this.userRepo.create({
                kcId: kcClaims.id,
                email: kcClaims.email,
                firstName: kcClaims.firstName,
                lastName: kcClaims.lastName,
                role: kcClaims.role,
                isActive: true,
                tenantId: kcClaims.tenantId,
            });
            user = await this.userRepo.save(user);
            this.logger.log(`Auto-created local profile for KC user ${kcClaims.id}`);
        }
        else {
            await this.userRepo.update(user.id, {
                email: kcClaims.email,
                firstName: kcClaims.firstName,
                lastName: kcClaims.lastName,
                role: kcClaims.role,
            });
            user = { ...user, ...kcClaims, id: user.id };
        }
        return this.userRepo.findOne({
            where: { id: user.id },
            relations: ['tenant'],
        });
    }
    async getProfile(kcId) {
        const user = await this.userRepo.findOne({
            where: { kcId },
            relations: ['tenant'],
        });
        if (!user)
            throw new common_1.NotFoundException('User profile not found');
        return user;
    }
    toSlug(name) {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = AuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(user_entity_1.User)),
    __param(1, (0, typeorm_1.InjectRepository)(tenant_entity_1.Tenant)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        keycloak_admin_service_1.KeycloakAdminService,
        typeorm_2.DataSource])
], AuthService);
//# sourceMappingURL=auth.service.js.map