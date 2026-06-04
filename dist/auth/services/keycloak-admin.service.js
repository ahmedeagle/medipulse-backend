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
var KeycloakAdminService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeycloakAdminService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const axios_1 = require("axios");
const role_enum_1 = require("../../common/enums/role.enum");
let KeycloakAdminService = KeycloakAdminService_1 = class KeycloakAdminService {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(KeycloakAdminService_1.name);
        this.cachedToken = null;
        this.tokenExpiresAt = 0;
        this.kcUrl = config.get('KC_URL');
        this.realm = config.get('KC_REALM');
        this.clientId = config.get('KC_CLIENT_ID');
        this.clientSecret = config.get('KC_CLIENT_SECRET');
        this.http = axios_1.default.create({ baseURL: `${this.kcUrl}/admin/realms/${this.realm}` });
    }
    async createUser(params) {
        const token = await this.getAdminToken();
        const kcRoleName = this.toKcRoleName(params.role);
        try {
            const response = await this.http.post('/users', {
                email: params.email,
                firstName: params.firstName,
                lastName: params.lastName,
                enabled: true,
                emailVerified: false,
                attributes: { tenantId: [params.tenantId] },
                requiredActions: ['UPDATE_PASSWORD', 'VERIFY_EMAIL'],
            }, { headers: { Authorization: `Bearer ${token}` } });
            const location = response.headers['location'] ?? '';
            const kcId = location.split('/').pop();
            if (!kcId) {
                throw new common_1.InternalServerErrorException('KC did not return a user ID');
            }
            await this.assignRealmRole(kcId, kcRoleName, token);
            await this.sendVerificationEmail(kcId, token);
            this.logger.log(`KC user created: ${kcId} (${params.email}) role=${kcRoleName}`);
            return kcId;
        }
        catch (error) {
            if (error.response?.status === 409) {
                throw new common_1.ConflictException(`A Keycloak user with email ${params.email} already exists`);
            }
            this.logger.error(`KC createUser failed: ${error.message}`, error.stack);
            throw new common_1.InternalServerErrorException('Failed to create user in Keycloak');
        }
    }
    async deactivateUser(kcId) {
        const token = await this.getAdminToken();
        await this.http.put(`/users/${kcId}`, { enabled: false }, { headers: { Authorization: `Bearer ${token}` } });
    }
    async deleteUser(kcId) {
        const token = await this.getAdminToken();
        await this.http.delete(`/users/${kcId}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
    }
    async updateUserAttribute(kcId, key, value) {
        const token = await this.getAdminToken();
        const { data: existing } = await this.http.get(`/users/${kcId}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const attributes = { ...(existing.attributes ?? {}), [key]: [value] };
        await this.http.put(`/users/${kcId}`, { attributes }, { headers: { Authorization: `Bearer ${token}` } });
    }
    async assignRealmRole(kcId, roleName, token) {
        const { data: role } = await this.http.get(`/roles/${roleName}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        await this.http.post(`/users/${kcId}/role-mappings/realm`, [role], { headers: { Authorization: `Bearer ${token}` } });
    }
    async sendVerificationEmail(kcId, token) {
        try {
            await this.http.put(`/users/${kcId}/send-verify-email`, {}, { headers: { Authorization: `Bearer ${token}` } });
        }
        catch (error) {
            this.logger.warn(`KC send-verify-email failed for ${kcId}: ${error.message}`);
        }
    }
    async getAdminToken() {
        if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
            return this.cachedToken;
        }
        const params = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.clientId,
            client_secret: this.clientSecret,
        });
        const { data } = await axios_1.default.post(`${this.kcUrl}/realms/${this.realm}/protocol/openid-connect/token`, params.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        this.cachedToken = data.access_token;
        this.tokenExpiresAt = Date.now() + 55_000;
        return this.cachedToken;
    }
    toKcRoleName(role) {
        const map = {
            [role_enum_1.Role.PHARMACY_ADMIN]: 'pharmacy-admin',
            [role_enum_1.Role.SUPPLIER_ADMIN]: 'supplier-admin',
            [role_enum_1.Role.SYSTEM_ADMIN]: 'system-admin',
            [role_enum_1.Role.CHAIN_ADMIN]: 'chain-admin',
        };
        return map[role];
    }
};
exports.KeycloakAdminService = KeycloakAdminService;
exports.KeycloakAdminService = KeycloakAdminService = KeycloakAdminService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], KeycloakAdminService);
//# sourceMappingURL=keycloak-admin.service.js.map