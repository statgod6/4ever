import { ConfigService } from '@nestjs/config';
import { requireJwtSecret } from './jwt-secret';

function configWith(secret?: string): ConfigService {
  return {
    get: jest.fn().mockReturnValue(secret),
  } as unknown as ConfigService;
}

describe('requireJwtSecret', () => {
  it('returns a sufficiently long configured secret', () => {
    const secret = 'a-strong-test-secret';

    expect(requireJwtSecret(configWith(secret))).toBe(secret);
  });

  it.each([undefined, '', 'too-short'])(
    'rejects a missing or weak secret (%p)',
    (secret) => {
      expect(() => requireJwtSecret(configWith(secret))).toThrow(
        'JWT_SECRET must be set to a strong random value',
      );
    },
  );
});
