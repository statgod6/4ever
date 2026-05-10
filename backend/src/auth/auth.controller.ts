import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { SetNameDto } from './dto/set-name.dto';

// Layered rate limits for OTP endpoints — two buckets stack so attackers
// can't work around the short-window limit with a slow trickle.
//   auth_short : 3 requests per minute  (per IP)
//   auth_long  : 10 requests per 15 min (per IP)
// Phone-number-level throttling is done inside AuthService (maxAttempts on
// the OtpCode row) as a second layer.
// TODO(P3): attach user-quota middleware once LlmUsage/TokenQuota ships.
const AUTH_THROTTLE = {
  auth_short: { limit: 3, ttl: 60_000 },
  auth_long: { limit: 10, ttl: 900_000 },
} as const;

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Throttle(AUTH_THROTTLE)
  @Post('request-otp')
  async requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestOtp(dto.phoneNumber);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('verify-otp')
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.phoneNumber, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @Post('set-name')
  async setName(@Request() req, @Body() dto: SetNameDto) {
    return this.authService.setName(req.user.userId, dto.name);
  }
}
