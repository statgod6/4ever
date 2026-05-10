import { IsString, IsOptional, MinLength } from 'class-validator';

export class CreateThoughtDto {
  @IsString()
  @MinLength(1)
  title: string;

  @IsString()
  @MinLength(1)
  rawText: string;

  @IsString()
  @IsOptional()
  thoughtType?: string;
}
