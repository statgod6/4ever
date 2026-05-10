import { IsString, MinLength } from 'class-validator';

export class LinkToPlannerDto {
  @IsString()
  @MinLength(1)
  date: string;

  @IsString()
  @MinLength(1)
  timeSlot: string;
}
