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
Object.defineProperty(exports, "__esModule", { value: true });
exports.JwtStrategy = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const passport_jwt_1 = require("passport-jwt");
const jwks_rsa_1 = require("jwks-rsa");
const config_1 = require("@nestjs/config");
const role_enum_1 = require("../../common/enums/role.enum");
let JwtStrategy = class JwtStrategy extends (0, passport_1.PassportStrategy)(passport_jwt_1.Strategy) {
    constructor(config) {
        const kcUrl = config.get('KC_URL');
        const kcRealm = config.get('KC_REALM');
        super({
            jwtFromRequest: passport_jwt_1.ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKeyProvider: (0, jwks_rsa_1.passportJwtSecret)({
                cache: true,
                cacheMaxEntries: 5,
                cacheMaxAge: 300_000,
                rateLimit: true,
                jwksRequestsPerMinute: 5,
                jwksUri: `${kcUrl}/realms/${kcRealm}/protocol/openid-connect/certs`,
            }),
            algorithms: ['RS256'],
        });
        this.config = config;
    }
    async validate(payload) {
        if (!payload?.sub) {
            throw new common_1.UnauthorizedException('Invalid token payload');
        }
        const aud = Array.isArray(payload['aud']) ? payload['aud'] : [payload['aud']];
        const expectedAud = this.config.get('KC_CLIENT_ID');
        if (expectedAud && aud.length > 0 && !aud.includes(expectedAud) && !aud.includes('account')) {
            throw new common_1.UnauthorizedException('Token audience mismatch');
        }
        const kcRoles = payload.realm_access?.roles ?? [];
        const role = this.mapKcRole(kcRoles);
        if (!role) {
            throw new common_1.UnauthorizedException('No recognized MediPulse role assigned in Keycloak');
        }
        if (!payload.tenantId && role !== role_enum_1.Role.SYSTEM_ADMIN) {
            const isProd = this.config.get('NODE_ENV') === 'production';
            if (isProd) {
                throw new common_1.UnauthorizedException('tenantId missing from Keycloak token — check protocol mapper');
            }
        }
        if (role === role_enum_1.Role.CHAIN_ADMIN && !payload.organizationId) {
            throw new common_1.UnauthorizedException('organizationId missing from Keycloak token — check protocol mapper for chain-admin users');
        }
        return {
            id: payload.sub,
            email: payload.email,
            firstName: payload.given_name ?? '',
            lastName: payload.family_name ?? '',
            role,
            tenantId: payload.tenantId ?? null,
            organizationId: payload.organizationId ?? null,
        };
    }
    mapKcRole(roles) {
        if (roles.includes('system-admin'))
            return role_enum_1.Role.SYSTEM_ADMIN;
        if (roles.includes('chain-admin'))
            return role_enum_1.Role.CHAIN_ADMIN;
        if (roles.includes('pharmacy-admin'))
            return role_enum_1.Role.PHARMACY_ADMIN;
        if (roles.includes('supplier-admin'))
            return role_enum_1.Role.SUPPLIER_ADMIN;
        return null;
    }
};
exports.JwtStrategy = JwtStrategy;
exports.JwtStrategy = JwtStrategy = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], JwtStrategy);
//# sourceMappingURL=jwt.strategy.js.map