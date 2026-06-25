import { IsDateString, IsEnum, IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';

export class InvoiceQueryDto {
  @IsOptional() @IsString()
  q?: string;

  @IsOptional() @IsEnum(['draft', 'received', 'paid', 'cancelled'])
  status?: string;

  @IsOptional() @IsEnum(['pending', 'paid'])
  paymentStatus?: string;

  @IsOptional() @IsUUID()
  supplierId?: string;

  @IsOptional() @IsDateString()
  dateFrom?: string;

  @IsOptional() @IsDateString()
  dateTo?: string;

  @IsOptional() @IsNumberString()
  page?: string;

  @IsOptional() @IsNumberString()
  limit?: string;
}

export class ReturnQueryDto {
  @IsOptional() @IsString()
  q?: string;

  @IsOptional() @IsEnum(['draft', 'confirmed', 'cancelled'])
  status?: string;

  @IsOptional() @IsUUID()
  supplierId?: string;

  @IsOptional() @IsDateString()
  dateFrom?: string;

  @IsOptional() @IsDateString()
  dateTo?: string;

  @IsOptional() @IsNumberString()
  page?: string;

  @IsOptional() @IsNumberString()
  limit?: string;
}
