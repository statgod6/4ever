import * as Sentry from '@sentry/node';

/**
 * Initialize Sentry if (and only if) SENTRY_DSN is set.
 *
 * Must be called BEFORE any other import that might throw during module
 * evaluation — that way early crashes surface in Sentry rather than just
 * dying silently in the container. main.ts wires this at the very top.
 *
 * When SENTRY_DSN is unset (local dev, CI), Sentry.init is a complete no-op:
 * no network calls, no global hooks, no CPU cost. This is the "zero-config,
 * zero-runtime-cost off switch" pattern — safe to ship unconditionally.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || process.env.GIT_SHA || undefined,
    // Sample everything in non-prod so devs can verify wiring, 20% in prod.
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    // Filter out PII the same way our Pino redactor does. Sentry receives
    // whatever our app gives it; we must not let phone numbers, OTP codes,
    // or JWT tokens reach a third-party error tracker.
    beforeSend(event) {
      try {
        // Strip known-sensitive keys from request bodies.
        const req = event.request as any;
        if (req?.data && typeof req.data === 'object') {
          for (const k of ['phone', 'phoneNumber', 'otp', 'otpCode', 'password', 'token', 'identityToken']) {
            if (req.data[k]) req.data[k] = '[REDACTED]';
          }
        }
        // Drop Authorization / cookie headers.
        if (req?.headers) {
          for (const k of Object.keys(req.headers)) {
            if (/^(authorization|cookie|x-api-key|x-admin-secret)$/i.test(k)) {
              req.headers[k] = '[REDACTED]';
            }
          }
        }
      } catch {
        // Never block error reporting because of a redaction glitch.
      }
      return event;
    },
  });
}

/**
 * Re-export Sentry so other modules (e.g. a future global exception filter)
 * can call Sentry.captureException directly without a second import.
 */
export { Sentry };
