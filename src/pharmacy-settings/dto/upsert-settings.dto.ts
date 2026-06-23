import { IsBoolean, IsNumber, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import { ReceiptSettings, LabelSettings, InventorySettings, AiAnalysisSettings, NotificationSettings } from '../entities/pharmacy-settings.entity';

export class UpsertPharmacySettingsDto {
  @IsOptional() @IsString() language?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() dateFormat?: string;
  @IsOptional() @IsString() timeFormat?: string;
  @IsOptional() @IsBoolean() taxEnabled?: boolean;

  @IsOptional() @IsString() pharmacyNameAr?: string;
  @IsOptional() @IsString() pharmacyNameEn?: string;
  @IsOptional() @IsString() licenseNumber?: string;
  @IsOptional() @IsString() pharmacyType?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() contactEmail?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() gpsLocation?: string;
  @IsOptional() @IsString() logoUrl?: string;

  @IsOptional() @IsObject() receiptSettings?: ReceiptSettings;
  @IsOptional() @IsObject() labelSettings?: LabelSettings;
  @IsOptional() @IsObject() inventorySettings?: InventorySettings;
  @IsOptional() @IsObject() aiAnalysisSettings?: AiAnalysisSettings;
  @IsOptional() @IsObject() notificationSettings?: NotificationSettings;

  @IsOptional() @IsBoolean() allowInventoryDiscovery?: boolean;
}

export class CreateWarehouseDto {
  @IsString() name: string;
  @IsOptional() @IsString() type?: 'storage' | 'expiry';
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateWarehouseDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() type?: 'storage' | 'expiry';
  @IsOptional() @IsBoolean() isActive?: boolean;
}
