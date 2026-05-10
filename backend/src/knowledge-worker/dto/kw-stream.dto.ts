import { IsOptional, IsString, IsUUID } from 'class-validator';

export class KwStreamDto {
  /** User's message text. */
  @IsString()
  message!: string;

  /** Optional existing conversation id; if omitted, a new conversation is created. */
  @IsOptional()
  @IsUUID()
  conversationId?: string;
}
