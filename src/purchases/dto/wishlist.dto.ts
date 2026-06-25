import {
  IsInt, IsOptional, IsString, IsUUID,
  MaxLength, Min, Max,
} from 'class-validator';

export class CreateWishListItemDto {
  @IsUUID()
  productId: string;

  @IsString() @MaxLength(200)
  productName: string;

  @IsOptional() @IsString() @MaxLength(50)
  productSku?: string;

  @IsInt() @Min(1) @Max(100_000)
  requestedQty: number;

  @IsOptional() @IsUUID()
  lastSupplierId?: string;

  @IsOptional() @IsString() @MaxLength(200)
  lastSupplierName?: string;
}

export class UpdateWishListItemDto {
  @IsOptional() @IsInt() @Min(1) @Max(100_000)
  requestedQty?: number;

  @IsOptional() @IsUUID()
  lastSupplierId?: string;

  @IsOptional() @IsString() @MaxLength(200)
  lastSupplierName?: string;
}
