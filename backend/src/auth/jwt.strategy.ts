import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private configService: ConfigService) {
    // Fail-closed: auth.module.ts already validates JWT_SECRET at boot, but
    // we re-check here so a misconfigured test harness can never sign with
    // the literal string 'default-secret'.
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret || secret.length < 16) {
      throw new Error('JWT_SECRET must be set to a strong random value (>=16 chars).');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: any) {
    return { userId: payload.sub, phone: payload.phone };
  }
}
