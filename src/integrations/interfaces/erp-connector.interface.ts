/**
 * Integration SDK — ERP Connector Interface
 *
 * Defines the contract for connecting MediPulse to pharmacy / hospital ERP systems.
 * Implement this interface per ERP vendor (SAP, Oracle, custom).
 * Register the implementation in IntegrationRegistryService.
 *
 * No implementations exist yet — this is the contract layer for Phase 1.5.
 */

export interface ProductMaster {
  erpSku:       string;
  name:         string;
  genericName?: string;
  category?:    string;
  unit?:        string;
}

export interface ErpInventoryEntry {
  erpSku:   string;
  quantity: number;
  location: string;
}

export interface ErpOrderPayload {
  erpOrderRef:       string;
  supplierErpCode:   string;
  lines: Array<{
    erpSku:    string;
    quantity:  number;
    unitPrice: number;
  }>;
}

export interface IErpConnector {
  readonly connectorType: 'erp';

  /** Pull current inventory snapshot from the ERP */
  pullInventory(tenantId: string): Promise<ErpInventoryEntry[]>;

  /** Push a confirmed MediPulse order back into the ERP */
  pushOrder(tenantId: string, order: ErpOrderPayload): Promise<{ erpRef: string }>;

  /** Fetch the ERP's product master catalog for SKU normalization */
  getProductMaster(tenantId: string): Promise<ProductMaster[]>;

  /** Verify the connection is alive and credentials are valid */
  healthCheck(tenantId: string): Promise<{ connected: boolean; latencyMs: number }>;
}
