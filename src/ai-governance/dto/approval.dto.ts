import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

import type {
  ApprovalPriority,
  ApprovalStatus,
} from '../entities/approval.entity';

export const APPROVAL_STATUSES: ApprovalStatus[] = [
  'pending',
  'modified',
  'approved',
  'rejected',
  'executed',
  'expired',
];

export const APPROVAL_PRIORITIES: ApprovalPriority[] = [
  'low',
  'medium',
  'high',
  'critical',
];

export class CreateApprovalDto {
  @ApiProperty() @IsString() @MaxLength(50)            agentCode!: string;
  @ApiProperty() @IsString() @MaxLength(40)            subjectType!: string;
  @ApiProperty() @IsUUID()                             subjectId!: string;
  @ApiProperty() @IsString() @MaxLength(200)           title!: string;
  @ApiProperty() @IsString()                           summary!: string;
  @ApiProperty() @IsString()                           rationale!: string;
  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional() @Type(() => Number) @Min(0) @Max(1)    confidence?: number;
  @ApiPropertyOptional({ enum: APPROVAL_PRIORITIES })
  @IsOptional() @IsEnum(APPROVAL_PRIORITIES)           priority?: ApprovalPriority;
  @ApiPropertyOptional() @IsOptional() @IsObject()     payload?: Record<string, any>;
  @ApiPropertyOptional() @IsOptional() @IsString()     expiresAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString()     confidenceReason?: string;
  @ApiPropertyOptional({ description: 'Central-orchestration dedup key, e.g. restock::<productId>.' })
  @IsOptional() @IsString() @MaxLength(120)            needKey?: string;
}

export class ListApprovalsQueryDto {
  @ApiPropertyOptional({ enum: APPROVAL_STATUSES })
  @IsOptional() @IsEnum(APPROVAL_STATUSES)             status?: ApprovalStatus;
  @ApiPropertyOptional() @IsOptional() @IsString()     agentCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString()     subjectType?: string;
  @ApiPropertyOptional({ enum: APPROVAL_PRIORITIES })
  @IsOptional() @IsEnum(APPROVAL_PRIORITIES)           priority?: ApprovalPriority;
  @ApiPropertyOptional({ default: 25 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @ApiPropertyOptional({ default: 0 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)   offset?: number;
}

export class ModifyApprovalDto {
  @ApiProperty()      @IsObject()                      payload!: Record<string, any>;
  @ApiPropertyOptional() @IsOptional() @IsString()     note?: string;
}

export class DecideApprovalDto {
  @ApiPropertyOptional() @IsOptional() @IsString()     note?: string;
}

export class BulkDecideDto {
  @ApiProperty({ type: [String] }) @IsUUID('4', { each: true }) ids!: string[];
  @ApiPropertyOptional() @IsOptional() @IsString()     note?: string;
}
