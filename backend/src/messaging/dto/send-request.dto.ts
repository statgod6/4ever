import { IsString, IsUUID } from 'class-validator';

export class SendRequestDto {
  @IsString()
  @IsUUID()
  receiverId: string;
}
