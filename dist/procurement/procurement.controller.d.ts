import { ProcurementDraftService } from './procurement-draft.service';
declare class RejectDraftDto {
    reason?: string;
}
export declare class ProcurementController {
    private readonly draftService;
    constructor(draftService: ProcurementDraftService);
    getQueue(user: any): Promise<{
        criticalDrafts: import("./entities/procurement-draft.entity").ProcurementDraft[];
        expiringStock: import("../inventory/entities/inventory-item.entity").InventoryItem[];
        pendingOrders: import("../orders/entities/order.entity").Order[];
    }>;
    listDrafts(user: any): Promise<import("./entities/procurement-draft.entity").ProcurementDraft[]>;
    approveDraft(user: any, id: string): Promise<import("../orders/entities/order.entity").Order>;
    rejectDraft(user: any, id: string, dto: RejectDraftDto): Promise<import("./entities/procurement-draft.entity").ProcurementDraft>;
}
export {};
