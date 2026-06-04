import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, Matches, MinLength } from 'class-validator';
import { TenantType } from '../../common/enums/tenant-type.enum';

export class CreateTenantDto {
  @ApiProperty({ example: 'Al-Shifa Pharmacy' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: 'al-shifa-pharmacy', description: 'Lowercase, hyphens only' })
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must be lowercase letters, numbers, and hyphens only',
  })
  slug: string;

  @ApiProperty({ enum: TenantType, example: TenantType.PHARMACY })
  @IsEnum(TenantType)
  type: TenantType;
}
