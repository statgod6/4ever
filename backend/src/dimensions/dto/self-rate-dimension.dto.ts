import { IsString, IsInt, Min, Max, IsOptional, IsIn } from 'class-validator';
import { LIFE_DIMENSIONS } from '../dimension.constants';

export class SelfRateDimensionDto {
  @IsString()
  @IsIn(LIFE_DIMENSIONS as unknown as string[])
  dimension: string;

  @IsInt()
  @Min(1)
  @Max(10)
  score: number;

  @IsOptional()
  @IsString()
  note?: string;
}
