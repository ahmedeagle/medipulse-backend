import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ example: 'Amoxicillin 500mg Capsules' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'أموكسيسيلين 500 ملغ كبسولات' })
  @IsOptional() @IsString()
  nameAr?: string;

  @ApiPropertyOptional({ example: 'Amoxicillin' })
  @IsOptional() @IsString()
  genericName?: string;

  @ApiProperty({ example: 'antibiotics' })
  @IsString()
  category: string;

  @ApiProperty({ example: 'capsule' })
  @IsString()
  unit: string;

  @ApiPropertyOptional({ example: 'capsule', description: 'tablet | capsule | syrup | injection | cream | drops | spray | powder | suppository | patch | other' })
  @IsOptional() @IsString()
  dosageForm?: string;

  @ApiPropertyOptional({ example: '500mg' })
  @IsOptional() @IsString()
  strength?: string;

  @ApiPropertyOptional({ example: 'SKU-001' })
  @IsOptional() @IsString()
  sku?: string;

  @ApiPropertyOptional({ example: '6901234567890' })
  @IsOptional() @IsString()
  barcode?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'Amoxicillin trihydrate', description: 'Active pharmaceutical ingredient / المادة الفعالة (INN). Auto-populated from WHO catalog.' })
  @IsOptional() @IsString()
  activeIngredient?: string;

  @ApiPropertyOptional({ example: 'J01CA04' })
  @IsOptional() @IsString()
  atcCode?: string;

  @ApiPropertyOptional({ example: 'Pfizer' })
  @IsOptional() @IsString()
  manufacturer?: string;

  @ApiPropertyOptional({ example: 'SA-SFDA-12345' })
  @IsOptional() @IsString()
  sfdaRegistration?: string;

  @ApiPropertyOptional({ example: 'EDA-67890' })
  @IsOptional() @IsString()
  edaRegistration?: string;

  @ApiPropertyOptional({ example: 'MOHAP-11111' })
  @IsOptional() @IsString()
  mohapRegistration?: string;

  @ApiPropertyOptional({ example: 'JFDA-22222' })
  @IsOptional() @IsString()
  jfdaRegistration?: string;

  @ApiPropertyOptional({ description: 'Set to true when created by supplier — pending admin mapping' })
  @IsOptional() @IsBoolean()
  requiresMapping?: boolean;

  @ApiPropertyOptional({
    description:
      'Bypass the pre-creation similarity gate. Use only after the user has reviewed ' +
      'the suggested existing products and confirmed they want a brand-new entry anyway.',
  })
  @IsOptional() @IsBoolean()
  forceCreate?: boolean;

  @ApiPropertyOptional({ example: 15, description: 'VAT / tax rate % (0–100). Default 0 = tax-exempt.' })
  @IsOptional() @IsNumber() @Min(0) @Max(100)
  taxRate?: number;

  @ApiPropertyOptional({ description: 'False = product is archived/discontinued (hidden from POS and purchase orders). Default true.' })
  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Block this product from being sold at POS.' })
  @IsOptional() @IsBoolean()
  disablePOSSale?: boolean;

  @ApiPropertyOptional({ description: 'Block this product from appearing on purchase orders.' })
  @IsOptional() @IsBoolean()
  disablePurchase?: boolean;

  @ApiPropertyOptional({ description: 'Product is eligible for return/refund. Default true.' })
  @IsOptional() @IsBoolean()
  returnable?: boolean;

  @ApiPropertyOptional({ description: 'Discounts can be applied at POS checkout. Default true.' })
  @IsOptional() @IsBoolean()
  discountAllowed?: boolean;
}
