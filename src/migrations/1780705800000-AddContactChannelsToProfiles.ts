import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds direct contact channels (email + WhatsApp) to supplier_profiles and
 * (phone + email + WhatsApp) to seller_profiles.
 *
 * WHY:
 *   Until the full supplier-onboarding portal ships, pharmacies have no way
 *   to reach a supplier after placing a draft PO except via the supplier
 *   name. The Orders screen already imports the Mail / MessageCircle icons
 *   for these CTAs but has nothing to wire them to. Same gap exists on the
 *   P2P side — buyers and sellers can transact through the marketplace but
 *   cannot confirm delivery details, send invoice corrections, or resolve a
 *   dispute without leaving the platform for an out-of-band channel.
 *
 *   Storing the channels on the *profile* (not on the order) keeps a single
 *   source of truth: when the supplier/seller updates their WhatsApp, every
 *   past and future order automatically gets the new number.
 *
 *   All three fields are nullable — they are encouraged, not required —
 *   and the column widths match international E.164 / RFC 5321 maxima.
 */
export class AddContactChannelsToProfiles1780705800000 implements MigrationInterface {
  name = 'AddContactChannelsToProfiles1780705800000';

  public async up(q: QueryRunner): Promise<void> {
    // ── Supplier profiles ────────────────────────────────────────────────
    // `phone` already exists; add email + whatsapp.
    await q.query(`
      ALTER TABLE "supplier_profiles"
        ADD COLUMN IF NOT EXISTS "email"    varchar(255) NULL,
        ADD COLUMN IF NOT EXISTS "whatsapp" varchar(32)  NULL
    `);

    // ── Seller profiles (P2P) ────────────────────────────────────────────
    // No contact columns existed; add all three.
    await q.query(`
      ALTER TABLE "seller_profiles"
        ADD COLUMN IF NOT EXISTS "phone"    varchar(32)  NULL,
        ADD COLUMN IF NOT EXISTS "email"    varchar(255) NULL,
        ADD COLUMN IF NOT EXISTS "whatsapp" varchar(32)  NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "seller_profiles"
        DROP COLUMN IF EXISTS "whatsapp",
        DROP COLUMN IF EXISTS "email",
        DROP COLUMN IF EXISTS "phone"
    `);
    await q.query(`
      ALTER TABLE "supplier_profiles"
        DROP COLUMN IF EXISTS "whatsapp",
        DROP COLUMN IF EXISTS "email"
    `);
  }
}
