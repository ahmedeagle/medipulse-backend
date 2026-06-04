export type OrganizationType = 'chain' | 'hospital_network' | 'group';
export declare class Organization {
    id: string;
    name: string;
    slug: string;
    type: OrganizationType;
    isActive: boolean;
    createdAt: Date;
}
