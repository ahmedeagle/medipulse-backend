export declare class RegionalDemandSignal {
    id: string;
    productId: string;
    region: string;
    month: number;
    demandMultiplier: number;
    source: 'manual' | 'computed';
    notes: string;
}
