import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsUUID,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
  IsNumber,
  IsBoolean,
  Min,
} from 'class-validator';

export class OrderItemDto {
  @ApiProperty({ example: 'uuid-of-product' })
  @IsUUID()
  productId: string;

  @ApiProperty({ example: 10, minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ example: 45.5, minimum: 0 })
  @IsNumber()
  @Min(0)
  unitPrice: number;
}

export class CreateOrderDto {
  @ApiProperty({ example: 'uuid-of-supplier-tenant' })
  @IsUUID()
  supplierTenantId: string;

  @ApiPropertyOptional({ example: 'Urgent order - please expedite' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [OrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  /**
   * Override the duplicate-order guard. Set to `true` for explicit reorder
   * scenarios where the user knowingly wants to place a second open PO for
   * the same product+supplier (e.g. the "إعادة الطلب" button on the orders
   * list). Without this flag, the backend returns a 409 to prevent
   * accidental double-ordering.
   */
  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  allowDuplicate?: boolean;

  /**
   * Pharmacist sign-off for orders containing Saudi MOH-controlled
   * substances. Required when any item has `controlledSubstanceSchedule`.
   */
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  pharmacistAcknowledged?: boolean;

  /**
   * Acknowledgement of drug-interaction risk for orders containing items
   * flagged with `hasDrugInteractionRisk`.
   */
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  interactionRiskAcknowledged?: boolean;
}
