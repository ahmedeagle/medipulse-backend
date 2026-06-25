import {
  IsBoolean,
  IsString,
  IsOptional,
  IsInt,
  IsNumber,
  IsDateString,
  Min,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBatchDto {
  @ApiProperty({ example: 'LOT-2026-001' })
  @IsString()
  @MaxLength(100)
  batchNumber: string;

  @ApiProperty({ example: 200, description: 'Units received in this lot' })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({ description: 'Set true for medical devices / consumables that have no expiry date (gloves, syringes, etc.). When true, expiryDate is ignored.' })
  @IsOptional()
  @IsBoolean()
  noExpiry?: boolean;

  @ApiPropertyOptional({ example: '2027-12-31' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional({ example: '2026-01-15' })
  @IsOptional()
  @IsDateString()
  manufacturingDate?: string;

  @ApiPropertyOptional({ example: 'Main Warehouse' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  location?: string;

  @ApiPropertyOptional({ example: 12.5, description: 'Cost per unit (SAR)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  costPerUnit?: number;

  @ApiPropertyOptional({ example: 18.0, description: 'Selling price per unit (SAR)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  sellingPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
