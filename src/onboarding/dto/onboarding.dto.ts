import { IsArray, IsInt, IsUUID, Min, Max, ArrayMaxSize, ArrayMinSize, ValidateNested, IsOptional, IsString, MaxLength, IsEmail, IsIn, ArrayUnique, ArrayNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

// ─────────────────────────────────────────────────────────────────────────────
// Seed consumption snapshots
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One product's weekly consumption history coming out of the legacy ERP.
 * The pharmacy supplies an array of weekly quantities; index 0 = most recent
 * completed week, index N = oldest. We backdate ConsumptionSnapshot rows
 * starting from the most recent Monday so the AI's "do I have ≥4 weeks of
 * history?" gate passes immediately.
 */
export class SeedConsumptionItemDto {
  @IsUUID('4')
  productId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(52)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(1_000_000, { each: true })
  weeklyQty!: number[];
}

export class SeedConsumptionDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(5_000)
  @ValidateNested({ each: true })
  @Type(() => SeedConsumptionItemDto)
  items!: SeedConsumptionItemDto[];

  /**
   * When true (the default), existing snapshots for the same
   * (tenantId, productId, weekStart) tuple are left untouched. Set to
   * false only when the pharmacy is intentionally re-importing.
   */
  @IsOptional()
  preserveExisting?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk supplier invite (system admin)
// ─────────────────────────────────────────────────────────────────────────────

export class BulkInviteSupplierItemDto {
  @IsString() @MaxLength(255)
  name!: string;

  @IsString() @MaxLength(100)
  /** URL-safe identifier — lowercase letters, digits, hyphens. */
  slug!: string;

  @IsOptional() @IsEmail() @MaxLength(255)
  contactEmail?: string;

  @IsOptional() @IsString() @MaxLength(100)
  city?: string;

  @IsOptional() @IsString() @MaxLength(100)
  region?: string;
}

export class BulkInviteSuppliersDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BulkInviteSupplierItemDto)
  suppliers!: BulkInviteSupplierItemDto[];
}
