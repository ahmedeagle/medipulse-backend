import {
  IsUUID,
  IsNumber,
  IsInt,
  IsOptional,
  IsBoolean,
  IsIn,
  IsDateString,
  Min,
} from 'class-validator';

export class CreateListingDto {
  @IsUUID()
  inventoryItemId: string;

  @IsNumber()
  @Min(0.01)
  price: number;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  minOrderQty?: number;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsIn(['normal', 'clearance', 'emergency'])
  listingType?: 'normal' | 'clearance' | 'emergency';

  @IsOptional()
  @IsIn(['none', 'discount', 'bonus'])
  offerType?: 'none' | 'discount' | 'bonus';

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountPct?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bonusQty?: number;

  @IsOptional()
  @IsBoolean()
  autoUpdateDiscount?: boolean;
}

export class UpdateListingDto {
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  minOrderQty?: number;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsIn(['normal', 'clearance', 'emergency'])
  listingType?: 'normal' | 'clearance' | 'emergency';

  @IsOptional()
  @IsIn(['none', 'discount', 'bonus'])
  offerType?: 'none' | 'discount' | 'bonus';

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountPct?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bonusQty?: number;

  @IsOptional()
  @IsBoolean()
  autoUpdateDiscount?: boolean;
}
