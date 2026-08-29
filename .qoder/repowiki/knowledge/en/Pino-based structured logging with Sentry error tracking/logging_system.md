# Logging System

## Overview

The 4Ever AI Life OS Platform uses a dual-layer observability strategy:

1. **Structured application logging** via [Pino](https://getpino.io/) (through `nestjs-pino`)
2. **Error tracking and exception monitoring** via [Sentry](https://sentry.io/)

This combination provides JSON-structured log output for aggregation/analysis and centralized error reporting for production incident management.

---

## Architecture

### Pino (Application Logging)

Pino is configured globally in `backend/src/app.module.ts` via the `LoggerModule.forRoot()` call. Key characteristics:

- **Integration**: Uses `nestjs-pino` to replace NestJS's default console logger
- **Bootstrap wiring**: In `main.ts`, `app.useLogger(app.get(PinoLogger))` swaps Nest's internal logger so all framework-level logs (guards, pipes, controllers) flow through Pino
- **Buffering**: `bufferLogs: true` during bootstrap ensures early startup logs are captured once Pino is initialized

### Sentry (Error Tracking)

Sentry is initialized in `backend/src/sentry.ts` via `initSentry()`, called at the very top of `main.ts` before any other imports. This ensures early crashes during module evaluation are captured.

- **Zero-config off switch**: When `SENTRY_DSN` is unset (local dev, CI), `initSentry()` returns immediately — no network calls, no hooks, no CPU cost
- **Global exception filter**: `SentryExceptionFilter` (registered in `main.ts`) catches unhandled exceptions and forwards only 5xx errors to Sentry, preserving Nest's default response contract

---

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/app.module.ts` | Pino `LoggerModule.forRoot()` configuration — log levels, redaction rules, serializers, auto-logging filters |
| `backend/src/main.ts` | Bootstrap: initializes Sentry, wires Pino as app logger, registers global exception filter |
| `backend/src/sentry.ts` | Sentry initialization with PII redaction (`beforeSend` hook strips auth headers, OTP codes, phone numbers, tokens) |
| `backend/src/common/sentry-exception.filter.ts` | Global exception filter — sends 5xx errors to Sentry, logs them locally, preserves 4xx client-error responses |
| `backend/package.json` | Declares dependencies: `pino`, `pino-http`, `nestjs-pino`, `@sentry/node`, `pino-pretty` (dev) |

---

## Configuration Details

### Log Levels

- **Production**: `info` (configurable via `LOG_LEVEL` env var)
- **Development**: `debug`
- **Custom level logic** (HTTP requests):
  - `error` for 5xx responses or thrown errors
  - `warn` for 4xx responses
  - `info` for successful requests

### Output Format

- **Production**: Raw JSON lines (no transport configured) — suitable for log aggregators (e.g., CloudWatch, Datadog, ELK)
- **Development**: Pretty-printed via `pino-pretty` with colorized output, timestamp format `HH:MM:ss.l`, single-line mode

### Request Correlation

Every HTTP request gets a correlation ID:
- Honors incoming `x-request-id` or `x-correlation-id` headers for distributed tracing
- Falls back to generated UUID via `randomUUID()`
- Flows through child loggers for end-to-end traceability

### Auto-Logging Filters

Health probe endpoints are excluded from automatic HTTP request logging to reduce noise:
- `/api/livez`
- `/api/readyz`
- `/api/health`

---

## PII Redaction (Mandatory)

Both Pino and Sentry enforce mandatory PII redaction. Missing a redaction path = GDPR violation risk.

### Pino Redaction Paths

Configured in `app.module.ts` via `redact.paths`:

```
req.headers.authorization
req.headers.cookie
req.headers["x-api-key"]
req.headers["x-admin-secret"]
res.headers["set-cookie"]
*.password, *.otp, *.otpCode, *.phone, *.phoneNumber
*.token, *.accessToken, *.refreshToken, *.jwt, *.apiKey, *.secret
req.body.phone, req.body.phoneNumber, req.body.otp, req.body.otpCode, req.body.password
```

All redacted values are replaced with `[REDACTED]`.

### Sentry Redaction

The `beforeSend` hook in `sentry.ts` strips:
- Request body fields: `phone`, `phoneNumber`, `otp`, `otpCode`, `password`, `token`, `identityToken`
- Headers: `authorization`, `cookie`, `x-api-key`, `x-admin-secret`

---

## HTTP Request Serializers

Lean serializers prevent full response bodies from appearing in logs:

```typescript
req: { id, method, url (query string stripped), remoteAddress, userAgent }
res: { statusCode }
```

Query strings are dropped from URLs to avoid leaking tokens passed as query parameters.

---

## Developer Conventions

### Using the Logger in Services

Inject NestJS's standard `Logger` class — it automatically routes through Pino:

```typescript
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MyService {
  private readonly logger = new Logger(MyService.name);

  someMethod() {
    this.logger.log('Operation completed');
    this.logger.warn('Something unexpected happened');
    this.logger.error('Failure occurred', errorStack);
  }
}
```

Available methods: `log()`, `debug()`, `warn()`, `error()`, `verbose()`, `fatal()`.

### Error Handling Pattern

1. **4xx errors** (validation, bad input): Throw `HttpException` subclasses — these are NOT sent to Sentry (expected client errors)
2. **5xx errors** (server bugs, external failures): Let them propagate — `SentryExceptionFilter` captures them and sends to Sentry
3. **Non-critical failures**: Use `try/catch` with `this.logger.warn()` or `this.logger.error()` for graceful degradation (see `context-builder.service.ts` pattern)

### What NOT to Do

- **Never** log raw OTP codes, phone numbers, JWT tokens, passwords, or API keys — Pino redaction covers common paths but custom log statements bypass it
- **Never** use `console.log()` / `console.error()` for application logging — these bypass Pino's structured output, correlation IDs, and redaction
- **Never** include full request/response bodies in manual log statements — serializers already capture essential metadata
- **Do not** call `Sentry.captureException()` directly in service code — let the global filter handle it unless you have a specific reason

### Exception: OTP Debug Logging

`auth.service.ts` contains a deliberate exception for non-production environments:

```typescript
if (process.env.NODE_ENV !== 'production') {
  console.log(`[OTP] ${normalized}: ${code}`);
}
```

This is acceptable because it is gated behind `NODE_ENV !== 'production'` and serves local development debugging. Never replicate this pattern for other sensitive data.

---

## Frontend/Mobile Clients

The React web frontend (`frontend/`) and React Native mobile app (`mobile/`) do not have dedicated logging frameworks. They rely on:

- Browser/dev console output via `console.*` (development only)
- Backend API error responses for user-facing feedback
- Sentry backend tracking for server-side issues

No client-side error tracking SDK (e.g., `@sentry/react`, `@sentry/react-native`) is currently integrated.
