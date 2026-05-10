import { IsBoolean, IsOptional, IsDateString } from 'class-validator';

export class ConversationSettingsDto {
  @IsBoolean()
  @IsOptional()
  pinned?: boolean;

  @IsDateString()
  @IsOptional()
  mutedUntil?: string;

  @IsBoolean()
  @IsOptional()
  archived?: boolean;
}
