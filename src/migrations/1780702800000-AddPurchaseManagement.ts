import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPurchaseManagement1780702800000 implements MigrationInterface {
  name = 'AddPurchaseManagement1780702800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE purchase_invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "pharmacyTenantId" UUID NOT NULL,
        "poNumber" VARCHAR(20) NOT NULL,
        "poSequence" INT NOT NULL DEFAULT 1,
        "supplierTenantId" UUID,
        "supplierName" VARCHAR(255) NOT NULL,
        "supplierInvoiceNumber" VARCHAR(100),
        "invoiceDate" DATE,
        "paymentMethod" VARCHAR(30) NOT NULL DEFAULT 'cash',
        "paymentStatus" VARCHAR(20) NOT NULL DEFAULT 'pending',
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        "discountType" VARCHAR(10) NOT NULL DEFAULT 'percent',
        "discountValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
        subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
        "totalDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "totalTax" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "grandTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
        notes TEXT,
        "createdBy" UUID NOT NULL,
        "confirmedAt" TIMESTAMPTZ,
        "cancelledAt" TIMESTAMPTZ,
        "cancelledBy" UUID,
        "deletedAt" TIMESTAMPTZ,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_purchase_invoices_tenant_deleted
        ON purchase_invoices ("pharmacyTenantId", "deletedAt");
      CREATE INDEX idx_purchase_invoices_tenant_status
        ON purchase_invoices ("pharmacyTenantId", status);
      CREATE INDEX idx_purchase_invoices_tenant_created
        ON purchase_invoices ("pharmacyTenantId", "createdAt" DESC);
      CREATE INDEX idx_purchase_invoices_tenant_supplier
        ON purchase_invoices ("pharmacyTenantId", "supplierTenantId");
      CREATE INDEX idx_purchase_invoices_tenant_payment_status
        ON purchase_invoices ("pharmacyTenantId", "paymentStatus");
    `);

    await queryRunner.query(`
      CREATE TABLE purchase_invoice_lines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "invoiceId" UUID NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
        "supplierTenantId" UUID,
        "productId" UUID NOT NULL,
        "productName" VARCHAR(255) NOT NULL,
        "productSku" VARCHAR(100),
        "batchNumber" VARCHAR(100),
        "expiryDate" DATE,
        "purchaseQty" INT NOT NULL DEFAULT 0,
        "freeGoodsQty" INT NOT NULL DEFAULT 0,
        "purchasePrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "salePrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "taxPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "lineTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "priceWarningShown" BOOLEAN NOT NULL DEFAULT false,
        "priceWarningDismissed" BOOLEAN NOT NULL DEFAULT false,
        "sortOrder" INT NOT NULL DEFAULT 0,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_pil_invoice_id ON purchase_invoice_lines ("invoiceId");
      CREATE INDEX idx_pil_product_supplier ON purchase_invoice_lines ("productId", "supplierTenantId");
    `);

    await queryRunner.query(`
      CREATE TABLE purchase_returns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "pharmacyTenantId" UUID NOT NULL,
        "rpoNumber" VARCHAR(20) NOT NULL,
        "rpoSequence" INT NOT NULL DEFAULT 1,
        "supplierTenantId" UUID,
        "supplierName" VARCHAR(255) NOT NULL,
        "supplierInvoiceDate" DATE,
        "supplierInvoiceNumber" VARCHAR(100),
        "paymentMethod" VARCHAR(30) NOT NULL DEFAULT 'cash',
        "paymentStatus" VARCHAR(20) NOT NULL DEFAULT 'pending',
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        "discountType" VARCHAR(10) NOT NULL DEFAULT 'percent',
        "discountValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
        subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
        "totalDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "totalTax" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "grandTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
        notes TEXT,
        "createdBy" UUID NOT NULL,
        "confirmedAt" TIMESTAMPTZ,
        "deletedAt" TIMESTAMPTZ,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_purchase_returns_tenant_deleted
        ON purchase_returns ("pharmacyTenantId", "deletedAt");
      CREATE INDEX idx_purchase_returns_tenant_status
        ON purchase_returns ("pharmacyTenantId", status);
      CREATE INDEX idx_purchase_returns_tenant_created
        ON purchase_returns ("pharmacyTenantId", "createdAt" DESC);
      CREATE INDEX idx_purchase_returns_tenant_supplier
        ON purchase_returns ("pharmacyTenantId", "supplierTenantId");
    `);

    await queryRunner.query(`
      CREATE TABLE purchase_return_lines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "returnId" UUID NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
        "productId" UUID NOT NULL,
        "productName" VARCHAR(255) NOT NULL,
        "productSku" VARCHAR(100),
        "batchNumber" VARCHAR(100),
        "expiryDate" DATE,
        "availableQty" INT NOT NULL DEFAULT 0,
        "returnQty" INT NOT NULL DEFAULT 0,
        "freeGoodsQty" INT NOT NULL DEFAULT 0,
        "returnPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "taxPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "lineTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_prl_return_id ON purchase_return_lines ("returnId");
      CREATE INDEX idx_prl_product_id ON purchase_return_lines ("productId");
    `);

    await queryRunner.query(`
      CREATE TABLE wish_list_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "pharmacyTenantId" UUID NOT NULL,
        "productId" UUID NOT NULL,
        "productName" VARCHAR(255) NOT NULL,
        "productSku" VARCHAR(100),
        "currentStock" INT NOT NULL DEFAULT 0,
        "requestedQty" INT NOT NULL DEFAULT 0,
        "recommendedQty" INT,
        "lastSupplierId" UUID,
        "lastSupplierName" VARCHAR(255),
        source VARCHAR(10) NOT NULL DEFAULT 'manual',
        "draftPoId" UUID,
        "draftPoNumber" VARCHAR(20),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_wishlist_tenant_product UNIQUE ("pharmacyTenantId", "productId")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_wish_list_tenant ON wish_list_items ("pharmacyTenantId");
    `);

    await queryRunner.query(`
      CREATE TABLE purchase_price_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "pharmacyTenantId" UUID NOT NULL,
        "productId" UUID NOT NULL,
        "supplierTenantId" UUID,
        "supplierName" VARCHAR(255),
        price DECIMAL(12,2) NOT NULL,
        "invoiceId" UUID NOT NULL,
        "purchasedAt" TIMESTAMPTZ NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_pph_tenant_product_supplier
        ON purchase_price_history ("pharmacyTenantId", "productId", "supplierTenantId");
      CREATE INDEX idx_pph_tenant_product
        ON purchase_price_history ("pharmacyTenantId", "productId");
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS purchase_price_history CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS wish_list_items CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS purchase_return_lines CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS purchase_returns CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS purchase_invoice_lines CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS purchase_invoices CASCADE');
  }
}
