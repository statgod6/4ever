import { IsString, IsOptional, MinLength } from 'class-validator';

export class AddSharedNoteDto {
  @IsString()
  @MinLength(1)
  content: string;

  @IsString()
  @IsOptional()
  noteType?: string;
}
