import { IsEnum, IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';

export class InvoiceQueryDto {
  @IsOptional() @IsString()
  q?: string;

  @IsOptional() @IsEnum(['draft', 'received', 'paid', 'cancelled'])
  status?: string;

  @IsOptional() @IsEnum(['pending', 'paid'])
  paymentStatus?: string;

  @IsOptional() @IsUUID()
  supplierId?: string;

  @IsOptional() @IsString()
  dateFrom?: string;

  @IsOptional() @IsString()
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

  @IsOptional() @IsString()
  dateFrom?: string;

  @IsOptional() @IsString()
  dateTo?: string;

  @IsOptional() @IsNumberString()
  page?: string;

  @IsOptional() @IsNumberString()
  limit?: string;
}
