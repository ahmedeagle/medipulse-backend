import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddP2pOrders1780700700000 implements MigrationInterface {
  name = 'AddP2pOrders1780700700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "p2p_orders" (
        "id"                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "buyerTenantId"         uuid NOT NULL,
        "sellerTenantId"        uuid NOT NULL,
        "listingId"             uuid NOT NULL,
        "requestedQty"          int NOT NULL,
        "agreedPrice"           decimal(10,2) NOT NULL,
        "status"                varchar(20) NOT NULL DEFAULT 'pending',
        "reservationExpiresAt"  timestamp,
        "notes"                 text,
        "rejectionReason"       text,
        "respondedAt"           timestamp,
        "completedAt"           timestamp,
        "updatedAt"             timestamp NOT NULL DEFAULT now(),
        "createdAt"             timestamp NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_p2p_orders_buyer"
        ON "p2p_orders" ("buyerTenantId","status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_p2p_orders_seller"
        ON "p2p_orders" ("sellerTenantId","status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_p2p_orders_listing"
        ON "p2p_orders" ("listingId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_p2p_orders_created"
        ON "p2p_orders" ("createdAt" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "p2p_transfer_invoices" (
        "id"              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "p2pOrderId"      uuid NOT NULL UNIQUE,
        "invoiceNumber"   varchar(30) NOT NULL UNIQUE,
        "buyerTenantId"   uuid NOT NULL,
        "sellerTenantId"  uuid NOT NULL,
        "items"           jsonb NOT NULL DEFAULT '[]'::jsonb,
        "subtotal"        decimal(10,2) NOT NULL DEFAULT 0,
        "totalAmount"     decimal(10,2) NOT NULL DEFAULT 0,
        "issuedAt"        timestamp NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_p2p_invoices_order"
        ON "p2p_transfer_invoices" ("p2pOrderId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_p2p_invoices_buyer"
        ON "p2p_transfer_invoices" ("buyerTenantId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_p2p_invoices_seller"
        ON "p2p_transfer_invoices" ("sellerTenantId")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "p2p_disputes" (
        "id"                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "p2pOrderId"        uuid NOT NULL,
        "raisedByTenantId"  uuid NOT NULL,
        "type"              varchar(30) NOT NULL,
        "description"       text NOT NULL,
        "evidenceUrls"      jsonb NOT NULL DEFAULT '[]'::jsonb,
        "status"            varchar(20) NOT NULL DEFAULT 'open',
        "adminNotes"        text,
        "resolvedAt"        timestamp,
        "createdAt"         timestamp NOT NULL DEFAULT now(),
        "updatedAt"         timestamp NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_p2p_disputes_order"
        ON "p2p_disputes" ("p2pOrderId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_p2p_disputes_status"
        ON "p2p_disputes" ("status")
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "p2p_orders"."status"
        IS 'pending | accepted | rejected | completed | cancelled'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "p2p_disputes"."type"
        IS 'wrong_qty | wrong_product | damaged | expired'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "p2p_disputes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "p2p_transfer_invoices"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "p2p_orders"`);
  }
}
