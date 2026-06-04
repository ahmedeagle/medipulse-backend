export type ProfileStatus = 'pending_review' | 'verified' | 'rejected' | 'suspended';
export declare class SupplierProfile {
    id: string;
    supplierTenantId: string;
    companyName: string;
    registrationNumber: string;
    licenseNumber: string;
    licenseExpiryDate: Date;
    address: string;
    phone: string;
    website: string;
    deliveryZones: string[];
    minOrderAmount: number;
    maxDeliveryDays: number;
    paymentTerms: string;
    certifications: Array<{
        name: string;
        number?: string;
        expiryDate?: string;
    }>;
    status: ProfileStatus;
    rejectionReason: string;
    verifiedAt: Date;
    updatedAt: Date;
    createdAt: Date;
}
