import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SupportReportDto } from './dto/support-report.dto';

/**
 * Support / abuse report endpoint.
 *
 * Required by the Play Data Safety form and generally expected by App Store
 * review: "users can report abusive content from within the app." This is the
 * launch-minimum implementation — reports are written to the structured log
 * stream (Pino → log aggregator / Sentry breadcrumb) at `warn` level with a
 * stable `event: 'support_report'` tag so ops can grep for them.
 *
 * No DB table yet by design: keeps the migration blast-radius zero. When
 * volume justifies it (post-launch), replace the `logger.warn` with an insert
 * into a `support_reports` table and fan out to email.
 *
 * Rate-limited to 3 reports / hour / user to prevent spam.
 */
@Controller('support')
export class SupportController {
  constructor(
    @InjectPinoLogger(SupportController.name)
    private readonly logger: PinoLogger,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60 * 60_000, limit: 3 } })
  @Post('report')
  async report(@Request() req, @Body() dto: SupportReportDto) {
    const userId: string = req.user.userId;

    // Log at `warn` so the report is visible in default prod log levels and
    // flagged by any alerting rule watching for `event: support_report`.
    // Message body is included as-is because we already redact PII at the
    // Pino serializer layer for known-sensitive paths; a free-form user
    // message is legitimate audit content.
    this.logger.warn(
      {
        event: 'support_report',
        category: dto.category,
        reporterUserId: userId,
        targetUserId: dto.targetUserId ?? null,
        messageLength: dto.message.length,
        message: dto.message,
      },
      `Support report received: ${dto.category}`,
    );

    return {
      ok: true,
      message:
        'Thanks — your report has been received. If you need a personal reply, email support@4ever.app.',
    };
  }
}
