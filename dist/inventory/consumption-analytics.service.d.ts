import { Repository, DataSource } from 'typeorm';
import { ConsumptionSnapshot } from './entities/consumption-snapshot.entity';
import { RegionalDemandSignal } from './entities/regional-demand-signal.entity';
export declare class ConsumptionAnalyticsService {
    private readonly snapshotRepo;
    private readonly signalRepo;
    private readonly dataSource;
    private readonly logger;
    constructor(snapshotRepo: Repository<ConsumptionSnapshot>, signalRepo: Repository<RegionalDemandSignal>, dataSource: DataSource);
    computeWeeklySnapshots(): Promise<void>;
    getSnapshots(tenantId: string, productId: string, weeks?: number): Promise<ConsumptionSnapshot[]>;
    getRegionalMultiplier(productId: string, region: string, month: number): Promise<number>;
    isSpiking(snapshots: ConsumptionSnapshot[]): boolean;
    private classifyVelocity;
}
