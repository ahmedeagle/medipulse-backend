import { Repository, DataSource } from 'typeorm';
import { User } from './entities/user.entity';
import { Tenant } from './entities/tenant.entity';
import { RegisterDto } from './dto/register.dto';
import { Role } from '../common/enums/role.enum';
import { KeycloakAdminService } from './services/keycloak-admin.service';
export declare class AuthService {
    private userRepo;
    private tenantRepo;
    private readonly kcAdmin;
    private readonly dataSource;
    private readonly logger;
    constructor(userRepo: Repository<User>, tenantRepo: Repository<Tenant>, kcAdmin: KeycloakAdminService, dataSource: DataSource);
    register(dto: RegisterDto): Promise<{
        user: Partial<User>;
        message: string;
    }>;
    syncProfile(kcClaims: {
        id: string;
        email: string;
        firstName: string;
        lastName: string;
        role: Role;
        tenantId: string;
    }): Promise<User>;
    getProfile(kcId: string): Promise<User>;
    private toSlug;
}
