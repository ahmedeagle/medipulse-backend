import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsNumber,
  IsIn,
  Min,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

class DeliveryZoneDto {
  @IsIn([3, 5, 10])
  radiusKm: 3 | 5 | 10;

  @IsNumber()
  @Min(0)
  price: number;

  @IsBoolean()
  isFree: boolean;
}

class SellerAutomationsDto {
  @IsOptional() @IsBoolean() autoListNearExpiry?: boolean;
  @IsOptional() @IsBoolean() autoUpdateDiscounts?: boolean;
  @IsOptional() @IsBoolean() autoDownloadInvoice?: boolean;
  @IsOptional() @IsBoolean() autoProcurement?: boolean;
}

class SellerNotificationPrefsDto {
  @IsOptional() @IsBoolean() newOrders?: boolean;
  @IsOptional() @IsBoolean() orderActivity?: boolean;
  @IsOptional() @IsBoolean() autoListings?: boolean;
  @IsOptional() @IsBoolean() priceAlerts?: boolean;
  @IsOptional() @IsBoolean() expiryWarnings?: boolean;
  @IsOptional() @IsBoolean() aiRecommendations?: boolean;
}

export class UpsertSellerProfileDto {
  @IsString()
  legalName: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  gpsLocation?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveryZoneDto)
  deliveryZones?: DeliveryZoneDto[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SellerAutomationsDto)
  automations?: SellerAutomationsDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SellerNotificationPrefsDto)
  notificationPrefs?: SellerNotificationPrefsDto;
}

export class RejectSellerDto {
  @IsString()
  reason: string;
}
