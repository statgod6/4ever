import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Previously blocked access to premium-only features (e.g. Knowledge Worker).
 * Now passes all authenticated users through — kept as a hook for future
 * rate-limiting or usage-based gating without removing guard wiring.
 *
 * Must run AFTER JwtAuthGuard — expects `req.user.userId` to already be populated.
 * Usage:  `@UseGuards(JwtAuthGuard, PremiumGuard)`
 */
@Injectable()
export class PremiumGuard implements CanActivate {
  private readonly logger = new Logger(PremiumGuard.name);

  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userId = req?.user?.userId;
    if (!userId) {
      throw new ForbiddenException('Authentication required');
    }

    // Universal access — log tier for observability but allow all users
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionTier: true },
    });

    if (!user) throw new ForbiddenException('User not found');

    if (user.subscriptionTier !== 'premium') {
      this.logger.debug(`Non-premium user ${userId} accessing KW (allowed)`);
    }

    return true;
  }
}
