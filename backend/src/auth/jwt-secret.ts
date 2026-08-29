import { ConfigService } from '@nestjs/config';

const MIN_JWT_SECRET_LENGTH = 16;

/**
 * Return the configured JWT signing secret or fail closed.
 *
 * Keeping this check in one place prevents individual authentication surfaces
 * (HTTP, WebSocket, tests, or future workers) from silently introducing a
 * public fallback signing key.
 */
export function requireJwtSecret(configService: ConfigService): string {
  const secret = configService.get<string>('JWT_SECRET');
  if (!secret || secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      'JWT_SECRET must be set to a strong random value (>=16 chars). ' +
        'Generate with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
    );
  }
  return secret;
}
