import { IsInt, Min } from 'class-validator';

export class StartCoolDownDto {
  @IsInt()
  @Min(1)
  minutes: number;
}
