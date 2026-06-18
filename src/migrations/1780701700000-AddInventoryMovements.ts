import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInventoryMovements1780701700000 implements MigrationInterface {
  name = 'AddInventoryMovements1780701700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE inventory_movements (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        "pharmacyTenantId" UUID NOT NULL,
        "inventoryItemId" UUID,
        "productId" UUID NOT NULL,
        "changeType" VARCHAR(50) NOT NULL,
        "quantityBefore" INTEGER,
        "quantityDelta" INTEGER NOT NULL,
        "quantityAfter" INTEGER NOT NULL,
        "sourceRef" VARCHAR(255),
        "matchStrategy" VARCHAR(60),
        "performedByUserId" UUID,
        note VARCHAR(500),
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_inv_movements_tenant ON inventory_movements("pharmacyTenantId")
    `);

    await queryRunner.query(`
      CREATE INDEX idx_inv_movements_source ON inventory_movements("sourceRef")
    `);

    await queryRunner.query(`
      CREATE INDEX idx_inv_movements_item ON inventory_movements("inventoryItemId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS inventory_movements`);
  }
}
