import { IsEmail, IsEnum, IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TenantType } from '../../common/enums/tenant-type.enum';

/**
 * Used by system_admin to onboard a new pharmacy or supplier.
 * No password — Keycloak sends a "set password" email to the user.
 */
export class RegisterDto {
  @ApiProperty({ example: 'ahmed@alshifa.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Ahmed' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Emam' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @ApiProperty({ example: 'Al Shifa Pharmacy' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  tenantName: string;

  @ApiProperty({ enum: TenantType })
  @IsEnum(TenantType)
  tenantType: TenantType;
}
