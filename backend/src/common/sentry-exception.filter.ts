import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Sentry } from '../sentry';

/**
 * Global exception filter that forwards 5xx and unknown errors to Sentry,
 * while leaving client (4xx) errors alone — those are normal validation
 * failures, not actionable bugs.
 *
 * Registered in main.ts via app.useGlobalFilters(new SentryExceptionFilter()).
 *
 * The filter preserves Nest's default response shape so existing clients are
 * unaffected; it only adds observability as a side effect.
 */
@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SentryExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();

    // Derive HTTP status.
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // Only ship 5xx + unknown to Sentry; 4xx noise would drown out real signals.
    if (status >= 500) {
      try {
        Sentry.withScope((scope) => {
          scope.setTag('path', req?.url?.split('?')[0] ?? 'unknown');
          scope.setTag('method', req?.method ?? 'unknown');
          const userId = req?.user?.userId;
          if (userId) scope.setUser({ id: userId });
          Sentry.captureException(exception);
        });
      } catch {
        // Sentry down? We still want the request to complete normally.
      }
      this.logger.error(
        `Unhandled ${status} on ${req?.method} ${req?.url}`,
        (exception as any)?.stack || String(exception),
      );
    }

    // Preserve Nest's default error response shape.
    const body =
      exception instanceof HttpException
        ? exception.getResponse()
        : { statusCode: status, message: 'Internal server error' };

    res.status(status).json(typeof body === 'string' ? { message: body } : body);
  }
}
