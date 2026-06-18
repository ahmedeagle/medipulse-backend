export type IssueSeverity = 'blocking' | 'warning';

export interface ListingIssue {
  code: IssueCode;
  severity: IssueSeverity;
  message: string;
  /** Field the user needs to fix (for frontend inline-edit targeting) */
  field?: string;
}

export type IssueCode =
  | 'UNLINKED_PRODUCT'
  | 'EXPIRED'
  | 'ZERO_STOCK'
  | 'BELOW_MIN_QTY'
  | 'NEAR_EXPIRY_30'
  | 'NEAR_EXPIRY_60'
  | 'NEAR_EXPIRY_90'
  | 'PRICE_ANOMALY'
  | 'DUPLICATE_LISTING';

export interface ListingRuleInput {
  linkStatus: 'linked' | 'unlinked' | 'suggested' | 'pending';
  expiryDate?: Date | string | null;
  quantity: number;
  minOrderQty: number;
  price: number;
  costPrice?: number | null;
  hasActiveDuplicate?: boolean;
}

export interface RulesResult {
  blocking: ListingIssue[];
  warnings: ListingIssue[];
  canPublish: boolean;
}

/**
 * Pure stateless rules engine — no DI, no async, fully testable.
 * Called from P2pListingService before every create/update/validate.
 */
export class ListingRulesEngine {
  static evaluate(input: ListingRuleInput): RulesResult {
    const issues: ListingIssue[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // ── Blocking rules ────────────────────────────────────────────────────────

    if (input.linkStatus !== 'linked') {
      issues.push({
        code: 'UNLINKED_PRODUCT',
        severity: 'blocking',
        message: 'Product must be linked to the catalog before listing',
        field: 'inventoryItemId',
      });
    }

    if (input.expiryDate) {
      const expiry = new Date(input.expiryDate);
      expiry.setHours(0, 0, 0, 0);
      if (expiry <= today) {
        issues.push({
          code: 'EXPIRED',
          severity: 'blocking',
          message: 'Cannot list an expired product',
          field: 'expiryDate',
        });
      }
    }

    if (input.quantity <= 0) {
      issues.push({
        code: 'ZERO_STOCK',
        severity: 'blocking',
        message: 'Quantity must be greater than zero',
        field: 'quantity',
      });
    }

    if (input.quantity > 0 && input.quantity < input.minOrderQty) {
      issues.push({
        code: 'BELOW_MIN_QTY',
        severity: 'blocking',
        message: `Available quantity (${input.quantity}) is less than minimum order quantity (${input.minOrderQty})`,
        field: 'minOrderQty',
      });
    }

    // ── Warning rules — only evaluated when expiry date present ──────────────

    if (input.expiryDate && !issues.some((i) => i.code === 'EXPIRED')) {
      const expiry = new Date(input.expiryDate);
      expiry.setHours(0, 0, 0, 0);
      const daysToExpiry = Math.floor(
        (expiry.getTime() - today.getTime()) / 86_400_000,
      );

      if (daysToExpiry <= 30) {
        issues.push({
          code: 'NEAR_EXPIRY_30',
          severity: 'warning',
          message: `Product expires in ${daysToExpiry} day(s) — consider a discount to sell faster`,
          field: 'discountPct',
        });
      } else if (daysToExpiry <= 60) {
        issues.push({
          code: 'NEAR_EXPIRY_60',
          severity: 'warning',
          message: `Product expires in ${daysToExpiry} day(s) — recommended 10% discount`,
          field: 'discountPct',
        });
      } else if (daysToExpiry <= 90) {
        issues.push({
          code: 'NEAR_EXPIRY_90',
          severity: 'warning',
          message: `Product expires in ${daysToExpiry} day(s) — consider listing as clearance`,
          field: 'listingType',
        });
      }
    }

    if (input.costPrice != null && input.price < input.costPrice) {
      issues.push({
        code: 'PRICE_ANOMALY',
        severity: 'warning',
        message: `Listed price (${input.price}) is below cost price (${input.costPrice})`,
        field: 'price',
      });
    }

    if (input.hasActiveDuplicate) {
      issues.push({
        code: 'DUPLICATE_LISTING',
        severity: 'warning',
        message: 'An active listing already exists for this product — pause the old one or update it',
        field: 'inventoryItemId',
      });
    }

    const blocking = issues.filter((i) => i.severity === 'blocking');
    const warnings = issues.filter((i) => i.severity === 'warning');

    return { blocking, warnings, canPublish: blocking.length === 0 };
  }
}
