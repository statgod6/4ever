import { IsString, IsOptional, MinLength } from 'class-validator';

export class AddRelationshipNoteDto {
  @IsString()
  @MinLength(1)
  content: string;

  @IsString()
  @IsOptional()
  sentiment?: string;

  @IsString()
  @IsOptional()
  topic?: string;
}
