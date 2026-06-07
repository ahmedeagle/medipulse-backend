import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';

/**
 * Filter parameters for `GET /inventory`. Extends the shared pagination DTO.
 * All filters are optional and combine with AND semantics.
 *
 * `statFilter` mirrors the frontend tab buttons (all / low / expiring / expired
 * / dead / review). It is intentionally a single-select enum to keep server
 * planner choices predictable; for compound queries combine `statFilter` with
 * `stockStatus` or `expiryWithinDays`.
 */
export class ListInventoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Match product name, barcode, SKU, or batch number (ILIKE).' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['all', 'low', 'expiring', 'expired', 'dead', 'review'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'low', 'expiring', 'expired', 'dead', 'review'])
  statFilter?: 'all' | 'low' | 'expiring' | 'expired' | 'dead' | 'review';

  @ApiPropertyOptional({ description: 'Exact product category match.' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Exact storage location match.' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ enum: ['in', 'low', 'out'] })
  @IsOptional()
  @IsIn(['in', 'low', 'out'])
  stockStatus?: 'in' | 'low' | 'out';

  @ApiPropertyOptional({ description: 'Items expiring within N days (and not yet expired).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expiryWithinDays?: number;
}
