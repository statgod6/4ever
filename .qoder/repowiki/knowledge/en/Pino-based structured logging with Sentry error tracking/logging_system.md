## Overview

The backend uses **nestjs-pino** (built on [pino](https://getpino.io/)) as its structured JSON logging framework, paired with **Sentry** (`@sentry/node`) for error tracking and exception capture. This dual-layer approach separates routine operational logging from actionable error monitoring.

## Core Components

### Pino HTTP Logger (nestjs-pino)

Configured globally in `app.module.ts` via `LoggerModule.forRoot()`. Key characteristics:

- **Log levels**: Environment-driven — `debug` in development, `info` in production (via `LOG_LEVEL` env var or `NODE_ENV` fallback).
- **Output format**: Pretty-printed with colors in dev (using `pino-pretty`), raw JSON lines in production for log aggregator ingestion.
- **Correlation IDs**: Every HTTP request gets a unique ID from `x-request-id` / `x-correlation-id` headers, or a generated UUID. This flows through child loggers for distributed tracing.
- **Auto-logging**: HTTP request/response logging is automatic but skips health probe endpoints (`/api/livez`, `/api/readyz`, `/api/health`) to reduce noise.
- **Custom log level routing**: Responses with status >= 500 are logged at `error`, 400-499 at `warn`, everything else at `info`.

### Request/Response Serializers

Lean serializers prevent log bloat:
- **Request**: Only logs `id`, `method`, URL path (query strings stripped to avoid token leakage), `remoteAddress`, and `user-agent`.
- **Response**: Only logs `statusCode`.

### PII Redaction (Mandatory)

A comprehensive `redact` configuration strips sensitive data from every log line before it is written. Redacted fields include:
- Auth headers: `authorization`, `cookie`, `x-api-key`, `x-admin-secret`
- Set-cookie response headers
- Body fields: `phone`, `phoneNumber`, `otp`, `otpCode`, `password`
- Generic patterns: any nested field named `password`, `otp`, `token`, `accessToken`, `refreshToken`, `jwt`, `apiKey`, `secret`
- Censor value: `[REDACTED]`

This is explicitly documented as a GDPR compliance requirement — missing a single redact path constitutes a PII leak.

### NestJS Logger Integration

In `main.ts`, the default Nest logger is replaced:
```typescript
app.useLogger(app.get(PinoLogger));
```
This ensures all logs — including those from framework internals, guards, pipes, and service classes using `new Logger()` — flow through the Pino pipeline with redaction applied.

Services use the standard NestJS `Logger` class:
```typescript
private readonly logger = new Logger(OrchestrationService.name);
this.logger.log('message');
this.logger.warn('message');
this.logger.error('message', stackTrace);
```

### Sentry Error Tracking

Initialized in `main.ts` before any other code runs via `initSentry()`. Key behaviors:

- **Zero-config off switch**: When `SENTRY_DSN` is unset (local dev, CI), `initSentry()` returns immediately — no network calls, no hooks, no CPU cost.
- **Sampling**: 100% trace sampling in non-prod, 20% in production.
- **PII filtering**: The `beforeSend` hook strips phone numbers, OTP codes, passwords, tokens, authorization headers, and cookies from events before they reach Sentry.
- **Global exception filter**: `SentryExceptionFilter` (registered globally) captures only 5xx errors and unknown exceptions. 4xx errors (validation failures, bad requests) are intentionally excluded to avoid drowning real signals in noise.
- **User context**: When available, `req.user.userId` is attached to Sentry events for user-level error correlation.
- **Bootstrap crash capture**: Fatal bootstrap errors are sent to Sentry before process exit.

## Log Level Strategy

| Level | Trigger |
|-------|---------|
| `error` | HTTP 5xx responses, caught exceptions with stack traces, fatal bootstrap errors |
| `warn` | HTTP 4xx responses, missing API keys, ontology compose failures, memory retrieval failures |
| `info` | Successful HTTP requests, service lifecycle events (module init, graph compilation), bootstrap completion |
| `debug` | Development-only verbose output |

## Developer Conventions

1. **Use NestJS `Logger`**, not `console.log`: All services should instantiate `new Logger(ServiceName)` and call `.log()`, `.warn()`, `.error()`. This ensures logs flow through Pino's redaction pipeline.

2. **Never log PII directly**: Even though Pino has redaction rules, do not rely on them as a safety net. Avoid logging phone numbers, OTP codes, tokens, or passwords in message text.

3. **Use `console.log` only for dev-only OTP debugging**: The auth service uses `console.log` for OTP codes in non-production environments. This bypasses Pino but is acceptable because it is gated by `NODE_ENV !== 'production'`.

4. **Error logging includes stack traces**: When calling `logger.error()`, pass the error's stack trace as the second argument for proper Sentry integration.

5. **Health probes are silent**: Do not add custom logging to `/api/livez`, `/api/readyz`, or `/api/health` endpoints — these are auto-ignored by Pino to prevent log spam from Kubernetes probes.

6. **Sentry is opt-in**: Code can safely call `Sentry.captureException()` without checking if Sentry is configured — it is a no-op when DSN is unset.

## Key Files

- `backend/src/app.module.ts` — Pino configuration, redaction rules, serializers
- `backend/src/main.ts` — Logger wiring, Sentry initialization, bootstrap logging
- `backend/src/sentry.ts` — Sentry setup, PII filtering, sampling config
- `backend/src/common/sentry-exception.filter.ts` — Global error filter routing 5xx to Sentry
- `backend/package.json` — Dependencies: `nestjs-pino`, `pino`, `pino-http`, `pino-pretty`, `@sentry/node`