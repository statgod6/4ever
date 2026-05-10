import { IsString, IsOptional, MaxLength } from 'class-validator';

export class AppleSignInDto {
  /**
   * The `identityToken` returned by Apple on the device after the user
   * authorizes our app. A JWT signed by Apple — we verify it against Apple's
   * public JWKS on every call, so we never trust the client's claim about
   * who they are.
   */
  @IsString()
  identityToken!: string;

  /**
   * Optional display name returned by Apple on the FIRST sign-in only.
   * Apple will not return this on subsequent logins, so the client must
   * either send it here or let us fall back to empty. Max 80 chars —
   * Apple allows longer but our UI clamps it to a sane length.
   */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  fullName?: string;
}
