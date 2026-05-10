import { IsString, IsOptional, IsBoolean, IsNumber } from 'class-validator';

export class CreateLifeEventDto {
  @IsString()
  title: string;

  @IsString()
  eventDate: string; // YYYY-MM-DD

  @IsString()
  eventType: string; // birthday, anniversary, surgery, interview, move, etc.

  @IsString()
  @IsOptional()
  personId?: string;

  @IsBoolean()
  @IsOptional()
  isRecurring?: boolean;

  @IsNumber()
  @IsOptional()
  remindDaysBefore?: number;

  @IsString()
  @IsOptional()
  note?: string;
}
