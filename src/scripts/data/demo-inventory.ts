/**
 * Demo inventory for new pharmacies.
 * 20 high-turnover drugs with realistic stock levels — some below threshold
 * to trigger AI recommendations on first login.
 *
 * Quantities are intentionally set low for several items so the AI
 * immediately generates HIGH-risk recommendations, making the demo compelling.
 */

export interface DemoInventoryItem {
  productName:  string;  // used to find the seeded product by name
  quantity:     number;
  minThreshold: number;
  expiryDays:   number;  // days from now
}

export const DEMO_INVENTORY: DemoInventoryItem[] = [
  // HIGH risk — below threshold (AI will flag these immediately)
  { productName: 'Amoxicillin 500mg Capsules',           quantity: 40,  minThreshold: 100, expiryDays: 180 },
  { productName: 'Paracetamol 500mg Tablets',            quantity: 80,  minThreshold: 200, expiryDays: 365 },
  { productName: 'Omeprazole 20mg Capsules',             quantity: 25,  minThreshold: 80,  expiryDays: 240 },
  { productName: 'Metformin 500mg Tablets',              quantity: 30,  minThreshold: 120, expiryDays: 300 },
  { productName: 'Atorvastatin 20mg Tablets',            quantity: 20,  minThreshold: 60,  expiryDays: 365 },

  // MEDIUM risk — near threshold
  { productName: 'Ibuprofen 400mg Tablets',              quantity: 120, minThreshold: 100, expiryDays: 365 },
  { productName: 'Azithromycin 500mg Tablets',           quantity: 35,  minThreshold: 30,  expiryDays: 200 },
  { productName: 'Amlodipine 5mg Tablets',               quantity: 55,  minThreshold: 50,  expiryDays: 365 },
  { productName: 'Vitamin D3 1000IU Capsules',           quantity: 90,  minThreshold: 80,  expiryDays: 500 },
  { productName: 'Cetirizine 10mg Tablets',              quantity: 70,  minThreshold: 60,  expiryDays: 300 },

  // LOW risk — well-stocked
  { productName: 'Pantoprazole 40mg Tablets',            quantity: 200, minThreshold: 50,  expiryDays: 365 },
  { productName: 'Lisinopril 10mg Tablets',              quantity: 180, minThreshold: 60,  expiryDays: 400 },
  { productName: 'Atenolol 50mg Tablets',                quantity: 150, minThreshold: 50,  expiryDays: 365 },
  { productName: 'Aspirin 100mg Tablets',                quantity: 300, minThreshold: 100, expiryDays: 365 },
  { productName: 'Folic Acid 5mg Tablets',               quantity: 250, minThreshold: 80,  expiryDays: 500 },
  { productName: 'Metronidazole 500mg Tablets',          quantity: 120, minThreshold: 40,  expiryDays: 300 },
  { productName: 'Ciprofloxacin 500mg Tablets',          quantity: 80,  minThreshold: 30,  expiryDays: 240 },
  { productName: 'Salbutamol 100mcg Inhaler',            quantity: 15,  minThreshold: 10,  expiryDays: 365 },
  { productName: 'Normal Saline 0.9% 500ml',             quantity: 20,  minThreshold: 10,  expiryDays: 730 },
  { productName: 'Oral Rehydration Salts Sachet',        quantity: 50,  minThreshold: 20,  expiryDays: 730 },
];
