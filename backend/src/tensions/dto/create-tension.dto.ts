import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';

export class CreateTensionDto {
  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsString()
  personId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  intensity?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  coolDownMinutes?: number;
}
