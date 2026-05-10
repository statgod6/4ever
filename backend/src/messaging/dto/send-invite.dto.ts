import { IsString, Matches } from 'class-validator';

export class SendInviteDto {
  @IsString()
  @Matches(/^\+?[1-9]\d{6,14}$/, {
    message: 'Please provide a valid phone number with country code',
  })
  phoneNumber: string;
}
