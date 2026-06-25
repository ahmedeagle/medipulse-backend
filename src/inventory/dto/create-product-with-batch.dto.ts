import { IsBoolean, IsDateString, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { CreateProductDto } from './create-product.dto';

/**
 * F-07: WHO→Batch one-flow.
 * Single payload creates product + first batch + inventory item atomically.
 * Batch fields are optional — omit all to create product-only (existing flow).
 */
export class CreateProductWithBatchDto extends CreateProductDto {
  // ── First-batch fields (all optional — omit to skip batch creation) ────────

  @IsOptional() @IsString() @MaxLength(100)
  batchNumber?: string;

  @IsOptional() @IsInt() @Min(1)
  batchQuantity?: number;

  @IsOptional() @IsNumber() @Min(0)
  minThreshold?: number;

  @IsOptional() @IsBoolean()
  noExpiry?: boolean;

  @IsOptional() @IsDateString()
  expiryDate?: string;

  @IsOptional() @IsDateString()
  manufacturingDate?: string;

  @IsOptional() @IsString() @MaxLength(100)
  location?: string;

  @IsOptional() @IsNumber() @Min(0)
  costPerUnit?: number;

  @IsOptional() @IsNumber() @Min(0)
  sellingPrice?: number;

  @IsOptional() @IsString()
  batchNotes?: string;
}
