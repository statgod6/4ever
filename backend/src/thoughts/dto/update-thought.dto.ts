import { IsString, IsOptional } from 'class-validator';

export class UpdateThoughtDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  rawText?: string;

  @IsString()
  @IsOptional()
  thoughtType?: string;

  @IsString()
  @IsOptional()
  status?: string;
}
