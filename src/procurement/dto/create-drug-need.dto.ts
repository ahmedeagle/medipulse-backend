import {
  IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min,
} from 'class-validator';

/**
 * Pharmacy types: "I need drug X, qty Y, urgency Z".
 * productId is optional — when omitted the backend resolves it from productName
 * (catalog ILIKE on name / nameAr / barcode). If nothing matches, the need is
 * still recorded as `open` so it can be sourced / radar-tracked later.
 */
export class CreateDrugNeedDto {
  @IsString()
  @MaxLength(255)
  productName: string;

  @IsInt()
  @Min(1)
  @Max(100_000)
  requestedQty: number;

  @IsOptional()
  @IsIn(['normal', 'urgent', 'critical'])
  urgency?: 'normal' | 'urgent' | 'critical';

  @IsOptional()
  @IsUUID('4', { message: 'productId must be a valid UUID' })
  productId?: string;
}
