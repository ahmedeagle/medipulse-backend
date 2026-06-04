import { AdminService } from './admin.service';
import { DlqService } from './dlq.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
export declare class AdminController {
    private readonly adminService;
    private readonly dlqService;
    constructor(adminService: AdminService, dlqService: DlqService);
    findAllTenants(): Promise<(import("../auth/entities/tenant.entity").Tenant & {
        userCount: number;
    })[]>;
    createTenant(dto: CreateTenantDto): Promise<import("../auth/entities/tenant.entity").Tenant>;
    findAllUsers(): Promise<import("../auth/entities/user.entity").User[]>;
    deactivateUser(id: string): Promise<import("../auth/entities/user.entity").User>;
    getDlq(): Promise<import("./dlq.service").DlqJob[]>;
    retryDlqJob(queue: string, jobId: string): Promise<void>;
}
