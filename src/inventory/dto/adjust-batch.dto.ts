import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class AdjustBatchDto {
  @IsNumber()
  @Min(-100_000)
  @Max(100_000)
  delta: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
