import { Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Role } from '../../common/enums/role.enum';
export interface KcTokenPayload {
    sub: string;
    email: string;
    given_name?: string;
    family_name?: string;
    realm_access?: {
        roles: string[];
    };
    tenantId?: string;
    organizationId?: string;
    iat: number;
    exp: number;
}
declare const JwtStrategy_base: new (...args: any[]) => Strategy;
export declare class JwtStrategy extends JwtStrategy_base {
    private readonly config;
    constructor(config: ConfigService);
    validate(payload: KcTokenPayload): Promise<{
        id: string;
        email: string;
        firstName: string;
        lastName: string;
        role: Role;
        tenantId: string;
        organizationId: string;
    }>;
    private mapKcRole;
}
export {};
