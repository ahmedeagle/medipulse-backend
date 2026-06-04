import { FinancialService } from './financial.service';
export declare class FinancialController {
    private readonly svc;
    constructor(svc: FinancialService);
    ledger(req: any, from: string, to: string, page?: string, limit?: string): Promise<{
        items: import("./entities/financial-ledger-entry.entity").FinancialLedgerEntry[];
        total: number;
        page: number;
        limit: number;
    }>;
    balance(req: any): Promise<Record<string, number>>;
    reconciliation(orderId: string): Promise<import("./entities/financial-ledger-entry.entity").FinancialLedgerEntry[]>;
    getWallet(req: any): Promise<import("./entities/credit-wallet.entity").CreditWallet>;
    setLimit(req: any, tenantId: string, limitSar: number): Promise<import("./entities/credit-wallet.entity").CreditWallet>;
    getSettlements(req: any): Promise<import("./entities/supplier-settlement.entity").SupplierSettlement[]>;
    approveSettlement(id: string, req: any): Promise<import("./entities/supplier-settlement.entity").SupplierSettlement>;
}
