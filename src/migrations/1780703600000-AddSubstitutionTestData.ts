import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds two branded Paracetamol 500mg tablet variants alongside the canonical
 * entry so the Smart Substitution engine has real alternatives to surface at POS.
 * Also seeds inventory items with realistic cost/sell prices so the flyout can
 * show meaningful margin-delta and customer-saving values in dev/demo.
 * Safe to run on prod — uses WHERE NOT EXISTS guards on every insert.
 */
export class AddSubstitutionTestData1780703600000 implements MigrationInterface {
  name = 'AddSubstitutionTestData1780703600000';

  async up(qr: QueryRunner): Promise<void> {
    // Panadol 500mg — higher margin branded option
    await qr.query(`
      INSERT INTO products (
        id, name, "nameAr", "genericName", "activeIngredient",
        strength, "dosageForm", category, unit,
        manufacturer, "isCanonical", "requiresMapping",
        "canonicalProductId", "createdAt"
      )
      SELECT
        'a1b2c3d4-e5f6-7890-abcd-ef1234560001',
        'Panadol 500mg Tablets',
        'بانادول 500 مجم أقراص',
        'Paracetamol',
        'Paracetamol',
        '500mg', 'tablet', 'analgesic', 'tablet',
        'GSK', true, false,
        '2a48ccda-6d26-4d38-ada5-1f635532d272',
        NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM products WHERE id = 'a1b2c3d4-e5f6-7890-abcd-ef1234560001'
      )
    `);

    // Paramol 500mg — cheaper option (customer saving)
    await qr.query(`
      INSERT INTO products (
        id, name, "nameAr", "genericName", "activeIngredient",
        strength, "dosageForm", category, unit,
        manufacturer, "isCanonical", "requiresMapping",
        "canonicalProductId", "createdAt"
      )
      SELECT
        'a1b2c3d4-e5f6-7890-abcd-ef1234560002',
        'Paramol 500mg Tablets',
        'باراموول 500 مجم أقراص',
        'Paracetamol',
        'Paracetamol',
        '500mg', 'tablet', 'analgesic', 'tablet',
        'Delta Pharma', true, false,
        '2a48ccda-6d26-4d38-ada5-1f635532d272',
        NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM products WHERE id = 'a1b2c3d4-e5f6-7890-abcd-ef1234560002'
      )
    `);

    // Cataflam 50mg — branded Diclofenac Sodium tablet
    await qr.query(`
      INSERT INTO products (
        id, name, "nameAr", "genericName", "activeIngredient",
        strength, "dosageForm", category, unit,
        manufacturer, "isCanonical", "requiresMapping", "createdAt"
      )
      SELECT
        'a1b2c3d4-e5f6-7890-abcd-ef1234560003',
        'Cataflam 50mg Tablets',
        'كاتافلام 50 مجم أقراص',
        'Diclofenac',
        'Diclofenac Sodium',
        '50mg', 'tablet', 'analgesic', 'tablet',
        'Novartis', true, false,
        NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM products WHERE id = 'a1b2c3d4-e5f6-7890-abcd-ef1234560003'
      )
    `);

    // Inventory: canonical Paracetamol 500mg — cost 5, sell 12 (base for comparison)
    await qr.query(`
      INSERT INTO inventory_items (
        id, "pharmacyTenantId", "productId",
        quantity, "minThreshold",
        "costPrice", "sellingPrice",
        "linkStatus", "createdAt", "updatedAt"
      )
      SELECT
        'b1b2c3d4-e5f6-7890-abcd-ef1234560010',
        '8c390877-e99c-41db-b3d2-91dc139c3bcc',
        '2a48ccda-6d26-4d38-ada5-1f635532d272',
        50, 10, 5.00, 12.00,
        'linked', NOW(), NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM inventory_items WHERE id = 'b1b2c3d4-e5f6-7890-abcd-ef1234560010'
      )
    `);

    // Inventory: Panadol 500mg — cost 8, sell 22 → margin 14 vs base 7 → +7 delta
    await qr.query(`
      INSERT INTO inventory_items (
        id, "pharmacyTenantId", "productId",
        quantity, "minThreshold",
        "costPrice", "sellingPrice",
        "linkStatus", "createdAt", "updatedAt"
      )
      SELECT
        'b1b2c3d4-e5f6-7890-abcd-ef1234560011',
        '8c390877-e99c-41db-b3d2-91dc139c3bcc',
        'a1b2c3d4-e5f6-7890-abcd-ef1234560001',
        30, 5, 8.00, 22.00,
        'linked', NOW(), NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM inventory_items WHERE id = 'b1b2c3d4-e5f6-7890-abcd-ef1234560011'
      )
    `);

    // Inventory: Paramol 500mg — cost 3, sell 8 → customer saves 4 EGP vs base
    await qr.query(`
      INSERT INTO inventory_items (
        id, "pharmacyTenantId", "productId",
        quantity, "minThreshold",
        "costPrice", "sellingPrice",
        "linkStatus", "createdAt", "updatedAt"
      )
      SELECT
        'b1b2c3d4-e5f6-7890-abcd-ef1234560012',
        '8c390877-e99c-41db-b3d2-91dc139c3bcc',
        'a1b2c3d4-e5f6-7890-abcd-ef1234560002',
        80, 10, 3.00, 8.00,
        'linked', NOW(), NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM inventory_items WHERE id = 'b1b2c3d4-e5f6-7890-abcd-ef1234560012'
      )
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`
      DELETE FROM inventory_items WHERE id IN (
        'b1b2c3d4-e5f6-7890-abcd-ef1234560010',
        'b1b2c3d4-e5f6-7890-abcd-ef1234560011',
        'b1b2c3d4-e5f6-7890-abcd-ef1234560012'
      )
    `);
    await qr.query(`
      DELETE FROM products WHERE id IN (
        'a1b2c3d4-e5f6-7890-abcd-ef1234560001',
        'a1b2c3d4-e5f6-7890-abcd-ef1234560002',
        'a1b2c3d4-e5f6-7890-abcd-ef1234560003'
      )
    `);
  }
}
