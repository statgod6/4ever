import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Gates admin endpoints with a shared secret header (`x-admin-secret`).
 * Dev-only convenience for flipping subscription tiers before Stripe lands.
 * In production this module should be removed or re-gated more strictly.
 */
@Injectable()
export class AdminSecretGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const provided = (req.headers?.['x-admin-secret'] || '').toString();
    const expected = this.config.get<string>('ADMIN_SECRET') || '';
    if (!expected) {
      // Fail closed: if ADMIN_SECRET isn't configured, deny access.
      throw new ForbiddenException('Admin endpoints disabled');
    }
    if (provided !== expected) {
      throw new ForbiddenException('Invalid admin secret');
    }
    return true;
  }
}
