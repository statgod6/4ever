import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Param,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { AdminSecretGuard } from './admin-secret.guard';

/**
 * Dev-only admin endpoints.
 * Auth: provide `x-admin-secret: <ADMIN_SECRET>` header.
 */
@Controller('admin')
@UseGuards(AdminSecretGuard)
export class AdminController {
  constructor(private users: UsersService) {}

  /**
   * Flip a user's subscription tier. Body: { tier: "free" | "premium", expiresAt?: ISO string }
   */
  @Post('users/:id/tier')
  async setTier(
    @Param('id') userId: string,
    @Body() body: { tier?: string; expiresAt?: string | null },
  ) {
    const tier = body?.tier;
    if (tier !== 'free' && tier !== 'premium') {
      throw new BadRequestException('tier must be "free" or "premium"');
    }
    const expiresAt = body?.expiresAt ? new Date(body.expiresAt) : null;
    if (expiresAt && isNaN(expiresAt.getTime())) {
      throw new BadRequestException('expiresAt must be a valid ISO date string');
    }
    return this.users.setSubscriptionTier(userId, tier, expiresAt);
  }
}
