import {
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Free-text procurement intake.
 *
 * The user pastes (or speaks) something like:
 *   "محتاج ٥٠ أوجمنتين ١جم و٣٠ بانادول إكسترا"
 *   "50 augmentin 1g, 30 panadol extra + 20 voltaren"
 *
 * The backend parses it into structured items and resolves each line to a
 * Product. No DB writes happen — the response is a preview only.
 */
export class AskAgentDto {
  @IsString()
  @MinLength(2, { message: 'text must contain at least 2 characters' })
  @MaxLength(2000, { message: 'text must be 2000 characters or fewer' })
  text: string;
}

/** A single resolved item the user confirmed they want to add to the cart. */
export class AskApplyItemDto {
  @IsUUID('4', { message: 'productId must be a valid UUID' })
  productId: string;

  @IsInt()
  @Min(1)
  @Max(100_000)
  qty: number;
}

export class AskApplyDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'at least one item is required' })
  @ArrayMaxSize(50, { message: 'cannot apply more than 50 items at once' })
  @ValidateNested({ each: true })
  @Type(() => AskApplyItemDto)
  items: AskApplyItemDto[];
}
