import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsNumber, IsOptional, IsDateString, IsString, Min, Max, MaxLength } from 'class-validator';

export class CreateInventoryItemDto {
  @ApiProperty({ example: 'uuid-of-product' })
  @IsUUID()
  productId: string;

  @ApiProperty({ example: 100, minimum: 0 })
  @IsNumber() @Min(0)
  quantity: number;

  @ApiProperty({ example: 20, minimum: 0 })
  @IsNumber() @Min(0)
  minThreshold: number;

  @ApiPropertyOptional({ example: '2025-12-31' })
  @IsOptional() @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional({ example: 'LOT-2024-001' })
  @IsOptional() @IsString() @MaxLength(100)
  batchNumber?: string;

  @ApiPropertyOptional({ example: 'Main Warehouse' })
  @IsOptional() @IsString() @MaxLength(100)
  location?: string;

  @ApiPropertyOptional({ example: 35.00 })
  @IsOptional() @IsNumber() @Min(0) @Max(999999)
  costPrice?: number;

  @ApiPropertyOptional({ example: 45.00 })
  @IsOptional() @IsNumber() @Min(0) @Max(999999)
  sellingPrice?: number;
}
