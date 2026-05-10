import { IsString, IsOptional, IsNumber } from 'class-validator';

export class CreateRitualDto {
  @IsString()
  title: string;

  @IsString()
  frequency: string; // daily, weekly, biweekly, monthly

  @IsString()
  @IsOptional()
  personId?: string;

  @IsNumber()
  @IsOptional()
  dayOfWeek?: number; // 0-6 for weekly
}
