import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ example: 'Amoxicillin 500mg Capsules' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Amoxicillin' })
  @IsOptional() @IsString()
  genericName?: string;

  @ApiProperty({ example: 'antibiotic' })
  @IsString()
  category: string;

  @ApiProperty({ example: 'capsule' })
  @IsString()
  unit: string;

  @ApiPropertyOptional({ example: '6901234567890' })
  @IsOptional() @IsString()
  barcode?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  description?: string;

  @ApiPropertyOptional({ example: '500mg' })
  @IsOptional() @IsString()
  strength?: string;

  @ApiPropertyOptional({ example: 'J01CA04' })
  @IsOptional() @IsString()
  atcCode?: string;

  @ApiPropertyOptional({ example: 'Pfizer' })
  @IsOptional() @IsString()
  manufacturer?: string;

  // Country registration numbers
  @ApiPropertyOptional({ example: 'SA-SFDA-12345', description: 'Saudi Arabia SFDA registration' })
  @IsOptional() @IsString()
  sfdaRegistration?: string;

  @ApiPropertyOptional({ example: 'EDA-67890', description: 'Egypt EDA registration' })
  @IsOptional() @IsString()
  edaRegistration?: string;

  @ApiPropertyOptional({ example: 'MOHAP-11111', description: 'UAE MOHAP registration' })
  @IsOptional() @IsString()
  mohapRegistration?: string;

  @ApiPropertyOptional({ example: 'JFDA-22222', description: 'Jordan JFDA registration' })
  @IsOptional() @IsString()
  jfdaRegistration?: string;

  @ApiPropertyOptional({ description: 'Set to true when created by supplier — pending admin mapping' })
  @IsOptional() @IsBoolean()
  requiresMapping?: boolean;
}
