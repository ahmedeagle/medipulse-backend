import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddP2pListings1780700600000 implements MigrationInterface {
  name = 'AddP2pListings1780700600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "p2p_listings" (
        "id"                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "sellerTenantId"     uuid NOT NULL,
        "inventoryItemId"    uuid NOT NULL,
        "productId"          uuid NOT NULL,
        "price"              decimal(10,2) NOT NULL,
        "quantity"           int NOT NULL DEFAULT 0,
        "minOrderQty"        int NOT NULL DEFAULT 1,
        "expiryDate"         date,
        "status"             varchar(20) NOT NULL DEFAULT 'active',
        "listingType"        varchar(20) NOT NULL DEFAULT 'normal',
        "offerType"          varchar(20) NOT NULL DEFAULT 'none',
        "discountPct"        decimal(5,2),
        "bonusQty"           int,
        "autoUpdateDiscount" boolean NOT NULL DEFAULT false,
        "updatedAt"          timestamp NOT NULL DEFAULT now(),
        "createdAt"          timestamp NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_p2p_listings_seller_status"
        ON "p2p_listings" ("sellerTenantId","status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_p2p_listings_product_status"
        ON "p2p_listings" ("productId","status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_p2p_listings_expiry_status"
        ON "p2p_listings" ("expiryDate","status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_p2p_listings_inventory_item"
        ON "p2p_listings" ("inventoryItemId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_p2p_listings_type_status"
        ON "p2p_listings" ("listingType","status")
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "p2p_listings"."listingType"
        IS 'normal | clearance | emergency'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "p2p_listings"."status"
        IS 'active | paused | sold_out | expired'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "p2p_listings"`);
  }
}
