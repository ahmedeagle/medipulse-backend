import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsNumber, IsOptional, IsDateString, IsString, Min } from 'class-validator';

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
  @IsOptional() @IsString()
  batchNumber?: string;

  @ApiPropertyOptional({ example: 'Main Warehouse' })
  @IsOptional() @IsString()
  location?: string;

  @ApiPropertyOptional({ example: 35.00 })
  @IsOptional() @IsNumber()
  costPrice?: number;

  @ApiPropertyOptional({ example: 45.00 })
  @IsOptional() @IsNumber()
  sellingPrice?: number;
}
