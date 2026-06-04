import { IsOptional, IsString, IsUUID, MaxLength, IsIn } from 'class-validator';

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
