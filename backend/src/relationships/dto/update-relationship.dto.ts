import { IsString, IsOptional, MaxLength } from 'class-validator';

export class UpdateRelationshipDto {
  @IsString()
  @IsOptional()
  @MaxLength(80)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  relationship?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  dynamic?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  keyContext?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  communicationStyle?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  loveLanguage?: string;

  @IsString()
  @IsOptional()
  @MaxLength(24)
  phoneNumber?: string;
}
