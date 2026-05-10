import { IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';

/**
 * Weekly check-in: one rating per dimension in a single call.
 * Body shape: { ratings: { health: 7, financial: 6, ... }, note?: "..." }
 * Missing dimensions are simply skipped (user rates what they want).
 */
export class WeeklyCheckinDto {
  @IsObject()
  ratings: Record<string, number>;

  @IsOptional()
  @IsString()
  note?: string;
}
