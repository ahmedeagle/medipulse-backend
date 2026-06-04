import { Repository, DataSource } from 'typeorm';
import { WeeklyAnalyticsSnapshot } from './entities/weekly-analytics-snapshot.entity';
import { Tenant } from '../auth/entities/tenant.entity';
export declare class AnalyticsSnapshotService {
    private readonly snapshotRepo;
    private readonly tenantRepo;
    private readonly dataSource;
    private readonly logger;
    constructor(snapshotRepo: Repository<WeeklyAnalyticsSnapshot>, tenantRepo: Repository<Tenant>, dataSource: DataSource);
    computeWeeklySnapshots(): Promise<void>;
    private computeForTenant;
    getSnapshots(tenantId: string, weeks?: number): Promise<WeeklyAnalyticsSnapshot[]>;
}
