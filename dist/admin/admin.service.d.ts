import { Repository } from 'typeorm';
import { Tenant } from '../auth/entities/tenant.entity';
import { User } from '../auth/entities/user.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
export declare class AdminService {
    private tenantRepository;
    private userRepository;
    constructor(tenantRepository: Repository<Tenant>, userRepository: Repository<User>);
    findAllTenants(): Promise<(Tenant & {
        userCount: number;
    })[]>;
    findAllUsers(): Promise<User[]>;
    createTenant(dto: CreateTenantDto): Promise<Tenant>;
    deactivateUser(id: string): Promise<User>;
}
