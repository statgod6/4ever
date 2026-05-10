import { IsString, IsOptional } from 'class-validator';

export class CreatePersonaDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  systemPrompt: string;

  @IsString()
  @IsOptional()
  modelName?: string;

  @IsString()
  @IsOptional()
  category?: string;
}
