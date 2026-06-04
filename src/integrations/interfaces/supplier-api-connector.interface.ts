/**
 * Integration SDK — Supplier API Connector Interface
 *
 * Direct API integration with supplier inventory / ordering systems.
 * Enables real-time availability checks, automated pricing sync,
 * and automated order placement without manual portal entry.
 */

export interface SupplierProductAvailability {
  supplierSku: string;
  available:   boolean;
  stock:       number;
  price:       number;
  currency:    string;
  leadDays:    number;
}

export interface SupplierOrderRequest {
  buyerRef:  string;   // MediPulse order ID
  lines: Array<{
    supplierSku: string;
    quantity:    number;
  }>;
  deliveryAddress?: string;
}

export interface SupplierOrderConfirmation {
  supplierOrderRef: string;
  estimatedDelivery: Date;
  confirmedLines: Array<{ supplierSku: string; quantity: number; unitPrice: number }>;
}

export interface ISupplierApiConnector {
  readonly connectorType: 'supplier_api';

  /** Get real-time availability + pricing for a list of SKUs */
  getAvailability(supplierTenantId: string, skus: string[]): Promise<SupplierProductAvailability[]>;

  /** Place an order directly via the supplier's API */
  placeOrder(supplierTenantId: string, order: SupplierOrderRequest): Promise<SupplierOrderConfirmation>;

  /** Pull latest pricing sheet from supplier — for catalog sync */
  updatePricing(supplierTenantId: string): Promise<SupplierProductAvailability[]>;

  healthCheck(supplierTenantId: string): Promise<{ connected: boolean; latencyMs: number }>;
}
