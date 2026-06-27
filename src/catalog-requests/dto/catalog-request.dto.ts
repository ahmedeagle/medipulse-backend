import {
  IsOptional, IsString, IsUUID, MaxLength, IsIn,
  IsArray, ValidateNested, ArrayMaxSize, ArrayMinSize, ArrayNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCatalogRequestDto {
  @IsOptional() @IsUUID()
  inventoryItemId?: string;

  @IsOptional() @IsIn(['add', 'fix', 'merge'])
  type?: 'add' | 'fix' | 'merge';

  // Payload fields — at least one of (name|nameAr|barcode) must be supplied;
  // we validate that combination in the service layer to keep DTO simple.
  @IsOptional() @IsString() @MaxLength(255) name?: string;
  @IsOptional() @IsString() @MaxLength(255) nameAr?: string;
  @IsOptional() @IsString() @MaxLength(64)  barcode?: string;
  @IsOptional() @IsString() @MaxLength(255) manufacturer?: string;
  @IsOptional() @IsString() @MaxLength(64)  dosageForm?: string;
  @IsOptional() @IsString() @MaxLength(64)  strength?: string;
  @IsOptional() @IsString() @MaxLength(2048) imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateCatalogRequestDto {
  @IsOptional() @IsIn(['under_review', 'need_info', 'approved', 'rejected', 'closed'])
  status?: 'under_review' | 'need_info' | 'approved' | 'rejected' | 'closed';

  @IsOptional() @IsString() @MaxLength(2000) adminNotes?: string;
  @IsOptional() @IsString() @MaxLength(500)  rejectionReason?: string;

  @IsOptional() @IsUUID()
  resolvedCatalogProductId?: string;
}

/**
 * Bulk submission used during pharmacy onboarding / data-migration.
 * A single migration run can produce hundreds of unmatched SKUs — sending
 * them one-by-one would both swamp the admin queue and create a poor UX
 * for the pharmacy. 500 is high enough to handle a full chain branch in
 * one upload but low enough to fit in a single HTTP request.
 */
export class BulkCreateCatalogRequestDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CreateCatalogRequestDto)
  items!: CreateCatalogRequestDto[];

  /** Optional shared note appended to every line — e.g. "from migration batch X". */
  @IsOptional() @IsString() @MaxLength(500)
  batchNote?: string;
}

/**
 * Admin-side bulk decision. Lets a catalog reviewer clear a backlog from
 * the same pharmacy in one click — most decisions on a migration batch
 * are uniform (approve all that auto-matched, reject duplicates, etc.).
 */
export class BulkUpdateCatalogRequestDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  ids!: string[];

  @IsIn(['under_review', 'need_info', 'approved', 'rejected', 'closed'])
  status!: 'under_review' | 'need_info' | 'approved' | 'rejected' | 'closed';

  @IsOptional() @IsString() @MaxLength(2000) adminNotes?: string;
  @IsOptional() @IsString() @MaxLength(500)  rejectionReason?: string;
}
