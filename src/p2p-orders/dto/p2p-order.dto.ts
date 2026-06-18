import {
  IsUUID,
  IsInt,
  IsOptional,
  IsString,
  IsIn,
  IsDateString,
  Min,
  IsArray,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';

export class ListP2pOrdersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['buyer', 'seller', 'both'])
  role?: 'buyer' | 'seller' | 'both' = 'both';

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsIn(['pending', 'accepted', 'shipped', 'rejected', 'completed', 'cancelled'])
  status?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  q?: string;
}

export class CreateP2pOrderDto {
  @IsUUID()
  listingId: string;

  @IsInt()
  @Min(1)
  requestedQty: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsIn(['normal', 'urgent', 'critical'])
  urgencyLevel?: 'normal' | 'urgent' | 'critical';
}

export class AcceptP2pOrderDto {
  @IsOptional()
  @IsDateString()
  expectedDeliveryAt?: string;
}

export class ShipP2pOrderDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class RejectP2pOrderDto {
  @IsString()
  reason: string;
}

export class OpenDisputeDto {
  @IsIn(['wrong_qty', 'wrong_product', 'damaged', 'expired'])
  type: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsArray()
  evidenceUrls?: string[];
}
