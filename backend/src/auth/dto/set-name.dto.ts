import { IsString, MinLength } from 'class-validator';

export class SetNameDto {
  @IsString()
  @MinLength(1)
  name: string;
}
