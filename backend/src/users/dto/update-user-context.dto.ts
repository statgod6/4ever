import { IsString, IsOptional } from 'class-validator';

export class UpdateUserContextDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  age?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsString()
  @IsOptional()
  role?: string;

  @IsString()
  @IsOptional()
  background?: string;

  @IsString()
  @IsOptional()
  currentProjects?: string;

  @IsString()
  @IsOptional()
  goals?: string;

  @IsString()
  @IsOptional()
  situation?: string;

  @IsString()
  @IsOptional()
  values?: string;

  @IsString()
  @IsOptional()
  pendingDecisions?: string;

  @IsString()
  @IsOptional()
  freeformContext?: string;
}
