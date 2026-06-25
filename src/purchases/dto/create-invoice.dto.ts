import {
  IsArray, IsEnum, IsNotEmpty, IsNumber,
  IsOptional, IsString, IsUUID, IsDateString,
  Min, Max, MaxLength, ValidateNested, IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

export class InvoiceLineDto {
  @IsUUID()
  productId: string;

  @IsString() @IsNotEmpty()
  productName: string;

  @IsOptional() @IsString()
  productSku?: string;

  @IsOptional() @IsUUID()
  supplierTenantId?: string;

  @IsOptional() @IsString()
  batchNumber?: string;

  @IsOptional() @IsDateString()
  expiryDate?: string;

  @IsNumber() @Min(1)
  purchaseQty: number;

  @IsOptional() @IsNumber() @Min(0)
  freeGoodsQty?: number;

  @IsNumber() @Min(0)
  purchasePrice: number;

  @IsOptional() @IsNumber() @Min(0)
  salePrice?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(100)
  discountPct?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(100)
  taxPct?: number;

  @IsOptional() @IsBoolean()
  priceWarningDismissed?: boolean;

  @IsOptional() @IsNumber() @Min(0)
  sortOrder?: number;
}

export class CreateInvoiceDto {
  @IsOptional() @IsUUID()
  supplierTenantId?: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  supplierName: string;

  @IsOptional() @IsString() @MaxLength(100)
  supplierInvoiceNumber?: string;

  @IsOptional() @IsDateString()
  invoiceDate?: string;

  @IsOptional() @IsEnum(['cash', 'credit_card', 'bank_transfer', 'credit_term'])
  paymentMethod?: string;

  @IsOptional() @IsEnum(['percent', 'fixed'])
  discountType?: string;

  @IsOptional() @IsNumber() @Min(0)
  discountValue?: number;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;

  @IsArray() @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines: InvoiceLineDto[];
}
