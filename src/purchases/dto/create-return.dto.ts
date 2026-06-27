import {
  IsArray, IsEnum, IsNotEmpty, IsNumber, IsOptional,
  IsString, IsUUID, IsDateString, Min, Max, MaxLength, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ReturnLineDto {
  @IsUUID()
  productId: string;

  @IsString() @IsNotEmpty()
  productName: string;

  @IsOptional() @IsString()
  productSku?: string;

  @IsOptional() @IsString()
  batchNumber?: string;

  @IsOptional() @IsDateString()
  expiryDate?: string;

  @IsOptional() @IsNumber() @Min(0)
  availableQty?: number;

  @IsNumber() @Min(1)
  returnQty: number;

  @IsOptional() @IsNumber() @Min(0)
  freeGoodsQty?: number;

  @IsNumber() @Min(0)
  returnPrice: number;

  @IsOptional() @IsNumber() @Min(0) @Max(100)
  discountPct?: number;

  @IsOptional() @IsNumber() @Min(0)
  taxPct?: number;
}

export class CreateReturnDto {
  @IsOptional() @IsUUID()
  supplierTenantId?: string;

  @IsString() @IsNotEmpty()
  supplierName: string;

  @IsOptional() @IsDateString()
  supplierInvoiceDate?: string;

  @IsOptional() @IsString()
  supplierInvoiceNumber?: string;

  @IsOptional() @IsEnum(['cash', 'credit_card', 'bank_transfer', 'credit_term'])
  paymentMethod?: string;

  @IsOptional() @IsEnum(['percent', 'fixed'])
  discountType?: string;

  @IsOptional() @IsNumber() @Min(0)
  discountValue?: number;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;

  @IsArray() @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines: ReturnLineDto[];
}
