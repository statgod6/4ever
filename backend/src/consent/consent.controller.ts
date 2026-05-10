import {
  Body,
  Controller,
  Get,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ConsentService } from './consent.service';

@Controller('consent')
@UseGuards(JwtAuthGuard)
export class ConsentController {
  constructor(private consent: ConsentService) {}

  /**
   * GET /api/consent — returns the user's full consent state. Mobile calls
   * this on launch to decide whether to show the legal acceptance screen.
   */
  @Get()
  async status(@Request() req) {
    return this.consent.getStatus(req.user.userId);
  }

  /**
   * POST /api/consent — record acceptance of one or more legal notices.
   * Body: { kind: string | string[], version?: string }
   * Short-window throttle prevents tap-spam.
   */
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post()
  async accept(
    @Request() req,
    @Body() body: { kind: string | string[]; version?: string },
  ) {
    const kinds = Array.isArray(body.kind) ? body.kind : [body.kind];
    const ip =
      (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      req.connection?.remoteAddress ||
      null;
    const ua = req.headers?.['user-agent'] || null;
    const recorded: any[] = [];
    for (const kind of kinds) {
      if (!kind) continue;
      const row = await this.consent.record(req.user.userId, kind, {
        version: body.version,
        ipAddress: ip,
        userAgent: ua,
      });
      recorded.push({ kind: row.kind, version: row.version, acceptedAt: row.acceptedAt });
    }
    return { recorded, status: await this.consent.getStatus(req.user.userId) };
  }
}
