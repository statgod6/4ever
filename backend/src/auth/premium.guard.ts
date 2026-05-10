import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Blocks access to premium-only features (e.g. Knowledge Worker agent).
 *
 * Must run AFTER JwtAuthGuard — expects `req.user.userId` to already be populated.
 * Usage:  `@UseGuards(JwtAuthGuard, PremiumGuard)`
 */
@Injectable()
export class PremiumGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userId = req?.user?.userId;
    if (!userId) {
      throw new ForbiddenException('Authentication required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionTier: true, subscriptionExpiresAt: true },
    });

    if (!user) throw new ForbiddenException('User not found');
    if (user.subscriptionTier !== 'premium') {
      throw new ForbiddenException('Premium subscription required');
    }
    if (user.subscriptionExpiresAt && user.subscriptionExpiresAt.getTime() < Date.now()) {
      throw new ForbiddenException('Premium subscription expired');
    }
    return true;
  }
}
