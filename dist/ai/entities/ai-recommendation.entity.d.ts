import { RecommendationType } from '../../common/enums/recommendation-type.enum';
import { Tenant } from '../../auth/entities/tenant.entity';
import { Product } from '../../inventory/entities/product.entity';
export declare class AiRecommendation {
    id: string;
    pharmacyTenantId: string;
    pharmacyTenant: Tenant;
    type: RecommendationType;
    productId: string;
    product: Product;
    payload: Record<string, any>;
    explanation: string;
    explanationFromGpt: boolean;
    riskLevel: string;
    confidence: number;
    confidenceLabel: string;
    rulesTriggered: string[];
    isDismissed: boolean;
    feedbackScore: number;
    feedbackNote: string;
    outcome: 'acted_on' | 'ignored' | 'expired' | null;
    outcomeAt: Date;
    createdAt: Date;
}
