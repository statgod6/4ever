import { IsString, IsOptional } from 'class-validator';

export class ResolveTensionDto {
  @IsString()
  @IsOptional()
  resolution?: string;
}
