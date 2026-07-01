import {
  IsOptional, IsBoolean, IsInt, Min, Max, IsString, IsIn,
} from 'class-validator';

/** Common IANA timezones for the region; kept permissive but validated as string. */
export class UpsertNotificationPreferencesDto {
  @IsOptional() @IsBoolean() inApp?: boolean;
  @IsOptional() @IsBoolean() email?: boolean;
  @IsOptional() @IsBoolean() whatsapp?: boolean;
  @IsOptional() @IsBoolean() push?: boolean;

  @IsOptional() @IsBoolean() allowLow?: boolean;
  @IsOptional() @IsBoolean() allowMedium?: boolean;
  @IsOptional() @IsBoolean() allowHigh?: boolean;
  @IsOptional() @IsBoolean() allowCritical?: boolean;

  /** Minutes from local midnight [0..1439]. null clears quiet hours. */
  @IsOptional() @IsInt() @Min(0) @Max(1439) quietHoursStart?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(1439) quietHoursEnd?: number | null;

  @IsOptional() @IsString() quietHoursTimezone?: string;
}
