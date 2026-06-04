import { ConfigService } from '@nestjs/config';
import { Role } from '../../common/enums/role.enum';
export declare class KeycloakAdminService {
    private readonly config;
    private readonly logger;
    private readonly http;
    private readonly kcUrl;
    private readonly realm;
    private readonly clientId;
    private readonly clientSecret;
    private cachedToken;
    private tokenExpiresAt;
    constructor(config: ConfigService);
    createUser(params: {
        email: string;
        firstName: string;
        lastName: string;
        role: Role;
        tenantId: string;
    }): Promise<string>;
    deactivateUser(kcId: string): Promise<void>;
    deleteUser(kcId: string): Promise<void>;
    updateUserAttribute(kcId: string, key: string, value: string): Promise<void>;
    private assignRealmRole;
    private sendVerificationEmail;
    private getAdminToken;
    private toKcRoleName;
}
