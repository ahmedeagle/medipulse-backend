import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Standard pagination query parameters used by every list endpoint.
 *
 * Conventions:
 *   - Default page size: 25 items
 *   - Maximum page size: 200 items (hard ceiling to protect the DB)
 *   - Zero-based offset (skip N rows before returning the page)
 *
 * Usage in controllers:
 *   @Get()
 *   findAll(@Query() pagination: PaginationQueryDto) { ... }
 */
export class PaginationQueryDto {
  /** Number of rows to return. Default 25, max 200. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 25;

  /** Zero-based offset. Default 0. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

/** Default limit applied when caller omits `limit`. */
export const DEFAULT_PAGE_SIZE = 25;
/** Hard ceiling that protects the DB from accidental large reads. */
export const MAX_PAGE_SIZE = 200;

/**
 * Standard envelope returned by every paginated list endpoint.
 * Keeps the frontend pagination contract stable across the API.
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

/** Clamp + apply defaults in one place so every endpoint stays consistent. */
export function normalizePagination(input: Partial<PaginationQueryDto> = {}): {
  limit: number;
  offset: number;
} {
  const rawLimit = Number(input.limit ?? DEFAULT_PAGE_SIZE);
  const rawOffset = Number(input.offset ?? 0);
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : DEFAULT_PAGE_SIZE),
  );
  const offset = Math.max(0, Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : 0);
  return { limit, offset };
}
