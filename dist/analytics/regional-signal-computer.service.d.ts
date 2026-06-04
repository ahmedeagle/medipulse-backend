import { Repository, DataSource } from 'typeorm';
import { RegionalDemandSignal } from '../inventory/entities/regional-demand-signal.entity';
export declare class RegionalSignalComputerService {
    private readonly signalRepo;
    private readonly dataSource;
    private readonly logger;
    constructor(signalRepo: Repository<RegionalDemandSignal>, dataSource: DataSource);
    computeAllSignals(): Promise<void>;
    computeForMonth(month: number): Promise<number>;
    getMultiplier(productId: string, region: string, month: number): Promise<number>;
}
