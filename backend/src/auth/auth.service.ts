import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  private snsClient: SNSClient | null = null;
  private snsSenderId: string;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    const awsRegion = this.configService.get<string>('AWS_REGION') || 'ap-south-1';
    const awsKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const awsSecretKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
    this.snsSenderId = this.configService.get<string>('AWS_SNS_SENDER_ID') || '';

    // Initialize SNS client only if credentials are present and not placeholders
    if (awsKeyId && awsSecretKey && !awsKeyId.startsWith('replace-')) {
      this.snsClient = new SNSClient({
        region: awsRegion,
        credentials: {
          accessKeyId: awsKeyId,
          secretAccessKey: awsSecretKey,
        },
      });
    }
  }

  /**
   * Request OTP — generates a 6-digit code, stores in DB, sends via SMS.
   * Rate limited: max 3 requests per phone per 10 minutes.
   */
  async requestOtp(phoneNumber: string) {
    const normalized = this.normalizePhone(phoneNumber);

    // Rate limit: max 3 OTP requests per phone in last 10 minutes
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentCount = await this.prisma.otpCode.count({
      where: {
        phoneNumber: normalized,
        createdAt: { gte: tenMinAgo },
      },
    });

    if (recentCount >= 3) {
      throw new BadRequestException('Too many OTP requests. Please wait before trying again.');
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min expiry

    // Store OTP
    await this.prisma.otpCode.create({
      data: {
        phoneNumber: normalized,
        code,
        expiresAt,
      },
    });

    // Log OTP only in non-production environments. Never log live OTP codes in prod.
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[OTP] ${normalized}: ${code}`);
    }

    // Send via AWS SNS if configured
    if (this.snsClient) {
      try {
        const messageAttributes: Record<string, any> = {};
        if (this.snsSenderId) {
          // AWS.SNS.SMS.SenderID — required for India (DLT-registered)
          messageAttributes['AWS.SNS.SMS.SenderID'] = {
            DataType: 'String',
            StringValue: this.snsSenderId,
          };
          messageAttributes['AWS.SNS.SMS.SMSType'] = {
            DataType: 'String',
            StringValue: 'Transactional',
          };
        }
        await this.snsClient.send(new PublishCommand({
          Message: `Your 4Ever verification code is: ${code}`,
          PhoneNumber: normalized,
          MessageAttributes: messageAttributes,
        }));
      } catch (err: any) {
        console.error('AWS SNS SMS error:', err.message);
      }
    }

    return { message: 'OTP sent successfully', phoneNumber: normalized };
  }

  /**
   * Verify OTP — checks code, creates user if new, returns JWT.
   * Max 3 wrong attempts per code.
   */
  async verifyOtp(phoneNumber: string, code: string) {
    const normalized = this.normalizePhone(phoneNumber);

    // Find the latest unexpired, unverified OTP for this phone
    const otpRecord = await this.prisma.otpCode.findFirst({
      where: {
        phoneNumber: normalized,
        verified: false,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      throw new UnauthorizedException('No valid OTP found. Please request a new one.');
    }

    // Check max attempts
    if (otpRecord.attempts >= 3) {
      throw new UnauthorizedException('Too many failed attempts. Please request a new OTP.');
    }

    // Verify code
    if (otpRecord.code !== code) {
      await this.prisma.otpCode.update({
        where: { id: otpRecord.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Invalid OTP code.');
    }

    // Mark as verified
    await this.prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { verified: true },
    });

    // Find or create user
    let user = await this.prisma.user.findUnique({
      where: { phoneNumber: normalized },
    });

    let isNewUser = false;
    if (!user) {
      user = await this.prisma.user.create({
        data: { phoneNumber: normalized, name: '' },
      });
      isNewUser = true;
    }

    // Generate JWT
    const payload = { sub: user.id, phone: user.phoneNumber };
    const token = this.jwtService.sign(payload);

    return {
      access_token: token,
      user: {
        id: user.id,
        phoneNumber: user.phoneNumber,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
      isNewUser,
    };
  }

  /**
   * Set name for a user (typically called after first OTP verification).
   */
  async setName(userId: string, name: string) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { name },
    });

    return {
      id: user.id,
      phoneNumber: user.phoneNumber,
      name: user.name,
      avatarUrl: user.avatarUrl,
    };
  }

  /**
   * Verify an OTP code without minting a JWT — used for high-risk actions
   * that require re-authentication (account deletion, future subscription
   * cancellations, etc.). Throws the same errors as verifyOtp so callers
   * get consistent UX. Does NOT create a user: the caller must already be
   * authenticated and pass in their own phone number.
   */
  async verifyOtpForAction(phoneNumber: string, code: string): Promise<{ verified: true }> {
    const normalized = this.normalizePhone(phoneNumber);
    const otpRecord = await this.prisma.otpCode.findFirst({
      where: {
        phoneNumber: normalized,
        verified: false,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!otpRecord) {
      throw new UnauthorizedException('No valid OTP found. Please request a new one.');
    }
    if (otpRecord.attempts >= 3) {
      throw new UnauthorizedException('Too many failed attempts. Please request a new OTP.');
    }
    if (otpRecord.code !== code) {
      await this.prisma.otpCode.update({
        where: { id: otpRecord.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Invalid OTP code.');
    }
    await this.prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { verified: true },
    });
    return { verified: true };
  }

  /**
   * Normalize phone number: ensure it starts with + and strip spaces/dashes.
   */
  private normalizePhone(phone: string): string {
    let cleaned = phone.replace(/[\s\-\(\)]/g, '');
    if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    }
    return cleaned;
  }

  // ─── Sign in with Apple ────────────────────────────────────────────────────
  // Apple's JWKS is served at a stable URL and rotates its keys periodically;
  // `createRemoteJWKSet` caches them and handles refresh automatically.
  private readonly appleJwks = createRemoteJWKSet(
    new URL('https://appleid.apple.com/auth/keys'),
  );

  /**
   * Sign in with Apple. Accepts the `identityToken` returned by Apple on the
   * device, verifies it against Apple's public JWKS, and either mints a JWT
   * for an existing account or creates a new one.
   *
   * Security notes:
   *   - `aud` must match our iOS bundle identifier (APPLE_CLIENT_ID env)
   *   - `iss` must be `https://appleid.apple.com`
   *   - `exp` validation is handled by jose automatically
   *   - `sub` is the stable user identifier; we key on this forever
   *   - `email` is optional (user may use Apple private relay) and we never
   *     rely on it for identity — only display.
   */
  async signInWithApple(identityToken: string, fullName?: string | null) {
    if (!identityToken) {
      throw new BadRequestException('identityToken is required');
    }
    const expectedAudience = this.configService.get<string>('APPLE_CLIENT_ID');
    if (!expectedAudience) {
      // Fail closed: if server is mis-configured, do not fall back to
      // "accept any audience" — that would let any Apple-issued token in.
      throw new UnauthorizedException(
        'Sign in with Apple is not configured on this server.',
      );
    }

    let payload: any;
    try {
      const verified = await jwtVerify(identityToken, this.appleJwks, {
        issuer: 'https://appleid.apple.com',
        audience: expectedAudience,
      });
      payload = verified.payload;
    } catch (err: any) {
      throw new UnauthorizedException(
        `Invalid Apple identity token: ${err?.message || 'verification failed'}`,
      );
    }

    const appleSub: string | undefined = payload?.sub;
    const email: string | undefined = payload?.email;
    if (!appleSub) {
      throw new UnauthorizedException('Apple token missing subject');
    }

    // Look up existing user by Apple id first; fall back to email match so
    // someone who signed up with phone and later added Apple doesn't end up
    // with a duplicate account.
    let user = await this.prisma.user.findUnique({
      where: { appleUserId: appleSub },
    });
    let isNewUser = false;

    if (!user && email) {
      const byEmail = await this.prisma.user.findFirst({
        where: { email },
      });
      if (byEmail) {
        user = await this.prisma.user.update({
          where: { id: byEmail.id },
          data: { appleUserId: appleSub },
        });
      }
    }

    if (!user) {
      // Brand new SIWA user. We don't have a phone number yet, so we stash a
      // deterministic placeholder in the required `phoneNumber` column
      // (prefixed to avoid collision with real E.164 numbers). The user can
      // later add a real phone via the OTP flow; at that point we update this
      // row rather than create a duplicate.
      user = await this.prisma.user.create({
        data: {
          phoneNumber: `apple:${appleSub}`,
          appleUserId: appleSub,
          email: email || null,
          name: (fullName || '').trim(),
        },
      });
      isNewUser = true;
    }

    const token = this.jwtService.sign({
      sub: user.id,
      phone: user.phoneNumber,
    });

    return {
      access_token: token,
      user: {
        id: user.id,
        phoneNumber: user.phoneNumber.startsWith('apple:') ? '' : user.phoneNumber,
        name: user.name,
        avatarUrl: user.avatarUrl,
        email: user.email,
      },
      isNewUser,
    };
  }

  /**
   * Cleanup expired OTPs. Runs automatically every hour via @Cron (see
   * ScheduleModule.forRoot() in AppModule) and can also be invoked manually
   * from admin tooling or tests.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredOtps() {
    const result = await this.prisma.otpCode.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0 && process.env.NODE_ENV !== 'production') {
      console.log(`[OTP cleanup] removed ${result.count} expired codes`);
    }
    return result;
  }
}
