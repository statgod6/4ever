import { IsString, MinLength, MaxLength } from 'class-validator';

export class AddReactionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  emoji: string;
}
