import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { User } from '../entities/user.entity';

/**
 * Keycloak JWT payload shape.
 * tenantId + organizationId are custom KC user attributes exposed via protocol mappers.
 */
export interface KcTokenPayload {
  sub: string;
  email: string;
  given_name?: string;
  family_name?: string;
  realm_access?: { roles: string[] };
  tenantId?: string;
  organizationId?: string;   // set on chain admin users (KC attribute)
  iat: number;
  exp: number;
}

/**
 * Validates incoming Bearer tokens against Keycloak's JWKS endpoint.
 *
 * Key properties:
 * - RS256 only — symmetric secrets (HS256) are rejected
 * - JWKS cached 5 min / rate-limited 5 req/min
 * - tenantId claim required for all roles except system-admin
 * - organizationId claim required for chain-admin
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {
    const kcUrl   = config.get<string>('KC_URL');
    const kcRealm = config.get<string>('KC_REALM');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        cacheMaxEntries: 5,
        cacheMaxAge: 300_000,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `${kcUrl}/realms/${kcRealm}/protocol/openid-connect/certs`,
      }),
      algorithms: ['RS256'],
    });
  }

  async validate(payload: KcTokenPayload) {
    if (!payload?.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }

    const aud = Array.isArray(payload['aud']) ? payload['aud'] : [payload['aud']];
    const expectedAud = this.config.get<string>('KC_CLIENT_ID');
    if (expectedAud && aud.length > 0 && !aud.includes(expectedAud) && !aud.includes('account')) {
      throw new UnauthorizedException('Token audience mismatch');
    }

    const kcRoles: string[] = payload.realm_access?.roles ?? [];
    const role = this.mapKcRole(kcRoles);

    if (!role) {
      throw new UnauthorizedException('No recognized MediPulse role assigned in Keycloak');
    }

    // All roles except system-admin require a tenantId.
    let tenantId: string | null = payload.tenantId ?? null;

    if (!tenantId && role !== Role.SYSTEM_ADMIN) {
      const isProd = this.config.get<string>('NODE_ENV') === 'production';
      if (isProd) {
        throw new UnauthorizedException('tenantId missing from Keycloak token — check protocol mapper');
      }
      // Dev fallback: look up tenantId from DB using the KC user ID (sub).
      // This handles the case where the Keycloak protocol mapper isn't configured yet.
      const dbUser = await this.userRepo.findOne({ where: { kcId: payload.sub }, select: ['tenantId'] });
      if (dbUser?.tenantId) {
        tenantId = dbUser.tenantId;
      }
    }

    // chain-admin requires organizationId (always enforced)
    if (role === Role.CHAIN_ADMIN && !payload.organizationId) {
      throw new UnauthorizedException('organizationId missing from Keycloak token — check protocol mapper for chain-admin users');
    }

    return {
      id:             payload.sub,
      email:          payload.email,
      firstName:      payload.given_name  ?? '',
      lastName:       payload.family_name ?? '',
      role,
      tenantId,
      organizationId: payload.organizationId ?? null,
    };
  }

  /**
   * Maps KC realm role names (kebab-case) to app Role enum.
   * Order matters — first match wins if user has multiple roles.
   */
  private mapKcRole(roles: string[]): Role | null {
    if (roles.includes('system-admin'))  return Role.SYSTEM_ADMIN;
    if (roles.includes('chain-admin'))   return Role.CHAIN_ADMIN;
    if (roles.includes('pharmacy-admin')) return Role.PHARMACY_ADMIN;
    if (roles.includes('supplier-admin')) return Role.SUPPLIER_ADMIN;
    return null;
  }
}
