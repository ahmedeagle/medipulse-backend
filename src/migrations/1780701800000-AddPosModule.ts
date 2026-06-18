import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPosModule1780701800000 implements MigrationInterface {
  name = 'AddPosModule1780701800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE pos_shifts (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        "pharmacyTenantId" UUID NOT NULL,
        "cashierId" UUID NOT NULL,
        "cashierName" VARCHAR(120),
        status VARCHAR(20) NOT NULL DEFAULT 'open',
        "openingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "closingBalance" DECIMAL(12,2),
        "totalSales" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "totalReturns" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "totalCashIn" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "totalCashOut" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "transactionCount" INTEGER NOT NULL DEFAULT 0,
        "returnCount" INTEGER NOT NULL DEFAULT 0,
        "openNote" TEXT,
        "closeNote" TEXT,
        "openedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "closedAt" TIMESTAMP
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_pos_shifts_tenant_status ON pos_shifts("pharmacyTenantId", status)
    `);

    await queryRunner.query(`
      CREATE TABLE pos_customers (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        "pharmacyTenantId" UUID NOT NULL,
        name VARCHAR(120) NOT NULL,
        phone VARCHAR(30),
        email VARCHAR(120),
        gender VARCHAR(10),
        address VARCHAR(255),
        tags TEXT[] NOT NULL DEFAULT '{}',
        "totalPurchases" DECIMAL(14,2) NOT NULL DEFAULT 0,
        "visitCount" INTEGER NOT NULL DEFAULT 0,
        "lastVisitAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_pos_customers_tenant ON pos_customers("pharmacyTenantId")
    `);

    await queryRunner.query(`
      CREATE TABLE pos_transactions (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        "pharmacyTenantId" UUID NOT NULL,
        "shiftId" UUID NOT NULL,
        "cashierId" UUID NOT NULL,
        "customerId" UUID,
        type VARCHAR(10) NOT NULL DEFAULT 'sale',
        subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
        "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "totalAmount" DECIMAL(12,2) NOT NULL,
        "paymentMethod" VARCHAR(20) NOT NULL DEFAULT 'cash',
        "cashAmount" DECIMAL(12,2),
        "cardAmount" DECIMAL(12,2),
        "changeAmount" DECIMAL(12,2),
        status VARCHAR(20) NOT NULL DEFAULT 'completed',
        "voidedByUserId" UUID,
        "voidedAt" TIMESTAMP,
        note TEXT,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_pos_tx_tenant_created ON pos_transactions("pharmacyTenantId", "createdAt" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_pos_tx_shift ON pos_transactions("pharmacyTenantId", "shiftId")
    `);
    await queryRunner.query(`
      CREATE INDEX idx_pos_tx_customer ON pos_transactions("customerId") WHERE "customerId" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE pos_transaction_items (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        "transactionId" UUID NOT NULL REFERENCES pos_transactions(id) ON DELETE CASCADE,
        "inventoryItemId" UUID,
        "productId" UUID NOT NULL,
        "productName" VARCHAR(255) NOT NULL,
        quantity INTEGER NOT NULL,
        "unitPrice" DECIMAL(12,2) NOT NULL,
        "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
        subtotal DECIMAL(12,2) NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_pos_items_tx ON pos_transaction_items("transactionId")
    `);

    await queryRunner.query(`
      CREATE TABLE pos_cash_movements (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        "pharmacyTenantId" UUID NOT NULL,
        "shiftId" UUID NOT NULL,
        type VARCHAR(10) NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        reason VARCHAR(100) NOT NULL,
        note TEXT,
        "performedByUserId" UUID NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_pos_cash_tenant_shift ON pos_cash_movements("pharmacyTenantId", "shiftId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS pos_cash_movements`);
    await queryRunner.query(`DROP TABLE IF EXISTS pos_transaction_items`);
    await queryRunner.query(`DROP TABLE IF EXISTS pos_transactions`);
    await queryRunner.query(`DROP TABLE IF EXISTS pos_customers`);
    await queryRunner.query(`DROP TABLE IF EXISTS pos_shifts`);
  }
}
