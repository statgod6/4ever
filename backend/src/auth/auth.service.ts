import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  private twilioClient: any;
  private twilioPhone: string;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    this.twilioPhone = this.configService.get<string>('TWILIO_PHONE_NUMBER') || '';

    if (accountSid && authToken && !accountSid.startsWith('your-')) {
      const twilio = require('twilio');
      this.twilioClient = twilio(accountSid, authToken);
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

    // Send via Twilio if configured and from/to are different
    if (this.twilioClient && this.twilioPhone !== normalized) {
      try {
        await this.twilioClient.messages.create({
          body: `Your 4Ever verification code is: ${code}`,
          from: this.twilioPhone,
          to: normalized,
        });
      } catch (err: any) {
        console.error('Twilio SMS error:', err.message);
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
   * Normalize phone number: ensure it starts with + and strip spaces/dashes.
   */
  private normalizePhone(phone: string): string {
    let cleaned = phone.replace(/[\s\-\(\)]/g, '');
    if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    }
    return cleaned;
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
