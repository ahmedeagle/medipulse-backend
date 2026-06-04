export interface SeedProduct {
    name: string;
    genericName: string;
    category: string;
    unit: string;
    strength?: string;
    dosageForm?: string;
    atcCode?: string;
    manufacturer?: string;
}
export declare const WHO_ESSENTIAL_MEDICINES: SeedProduct[];
