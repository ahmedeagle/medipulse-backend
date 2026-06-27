import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';

/**
 * Query params for GET /supplier/catalog.
 * Extends pagination with optional fuzzy search and supplier filter.
 * Required because the global ValidationPipe runs with `forbidNonWhitelisted: true`,
 * which otherwise rejects any extra query keys with 400.
 */
export class CatalogQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsUUID()
  supplierId?: string;
}
