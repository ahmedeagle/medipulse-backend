import { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
export declare class HealthController {
    private readonly mainDb;
    private readonly auditDb;
    private readonly redis;
    constructor(mainDb: DataSource, auditDb: DataSource, redis: Redis);
    live(): {
        status: string;
        timestamp: string;
    };
    ready(): Promise<{
        status: string;
        timestamp: string;
        mainDb: string;
        auditDb: string;
        redis: string;
    }>;
}
