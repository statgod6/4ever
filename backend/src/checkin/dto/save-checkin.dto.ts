import { IsInt, IsOptional, IsString, Min, Max } from 'class-validator';

export class SaveCheckInDto {
  @IsInt()
  @Min(1)
  @Max(5)
  mood: number;

  @IsInt()
  @Min(1)
  @Max(5)
  energy: number;

  @IsString()
  @IsOptional()
  note?: string;
}
