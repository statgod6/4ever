# Logging System Architecture

The 4Ever Cognitive Companion Platform uses a **dual-layer observability strategy** combining structured application logging via Pino and error tracking via Sentry.

## Core Components

### 1. Pino Structured Logging (nestjs-pino)

**Framework**: `nestjs-pino` v4.6.1 wrapping `pino` v10.3.1 and `pino-http` v11.0.0

**Configuration location**: `backend/src/app.module.ts` (lines 48-124)

The logging system is initialized globally in the root `AppModule` using `LoggerModule.forRoot()`, replacing NestJS's default console logger across all modules, guards, pipes, and services.

#### Environment-Based Output Strategy

- **Development**: Pretty-printed output via `pino-pretty` with colorization, human-readable timestamps (`SYS:HH:MM:ss.l`), and single-line formatting
- **Production**: Raw JSON lines for ingestion by log aggregators (no transport configured)

```typescript
transport:
  process.env.NODE_ENV === 'production'
    ? undefined  // raw JSON for prod log collectors
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ... }
      }
```

#### Log Level Strategy

Controlled via `LOG_LEVEL` environment variable with sensible defaults:
- **Production**: `info` level (suppresses debug noise)
- **Development**: `debug` level (verbose for troubleshooting)

```typescript
level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')
```

#### Mandatory PII Redaction

The system enforces GDPR-compliant redaction at the logging layer before any line is written. Redacted fields include:

- **Auth credentials**: `authorization` headers, cookies, API keys, admin secrets
- **User identifiers**: phone numbers, OTP codes, passwords, JWT tokens
- **Request bodies**: `req.body.phone`, `req.body.phoneNumber`, `req.body.otp`, etc.
- **Nested objects**: Wildcard patterns (`*.password`, `*.token`, `*.secret`) catch deeply nested sensitive data

All redacted values are replaced with `[REDACTED]`.

#### Request Correlation & Tracing

Every HTTP request receives a correlation ID for distributed tracing:
- Honors upstream `x-request-id` or `x-correlation-id` headers
- Falls back to generated UUID via `randomUUID()`
- Flows through child loggers automatically via pino-http context binding

#### Lean Serializers

To prevent log bloat and accidental PII leakage:
- **Request serializer**: Strips query strings (may contain tokens), captures only method, URL path, remote address, user agent
- **Response serializer**: Captures only `statusCode` — never response bodies

#### Auto-Logging Configuration

Health probe endpoints are excluded from automatic request logging to reduce noise:
- `/api/livez` (liveness probe)
- `/api/readyz` (readiness probe)
- `/api/health` (legacy health endpoint)

Custom log levels based on response status:
- 5xx errors → `error` level
- 4xx client errors → `warn` level
- Successful requests → `info` level

### 2. Sentry Error Tracking

**Framework**: `@sentry/node` v9.47.1

**Initialization**: `backend/src/sentry.ts`

Sentry is initialized conditionally — when `SENTRY_DSN` is unset (local dev, CI), it becomes a complete no-op with zero runtime cost.

#### Configuration

- **Environment tagging**: Uses `SENTRY_ENVIRONMENT` or falls back to `NODE_ENV`
- **Release tracking**: Uses `SENTRY_RELEASE` or `GIT_SHA`
- **Sampling rates**: 100% in non-prod (for verification), 20% in production

#### PII Protection in Error Reports

Sentry's `beforeSend` hook applies the same redaction logic as Pino:
- Strips sensitive request body fields (phone, OTP, password, token)
- Redacts auth headers, cookies, API keys
- Never blocks error reporting if redaction fails (fail-safe design)

### 3. Global Exception Filter

**Location**: `backend/src/common/sentry-exception.filter.ts`

Registered globally in `main.ts` via `app.useGlobalFilters(new SentryExceptionFilter())`.

#### Filtering Strategy

- **5xx errors + unknown exceptions**: Forwarded to Sentry with contextual metadata (path, method, user ID)
- **4xx client errors**: Silently handled — these are validation failures, not actionable bugs
- **Response preservation**: Maintains NestJS's default error response shape for backward compatibility

#### Context Enrichment

Before capturing exceptions, the filter attaches:
- Request path (query string stripped)
- HTTP method
- User ID (from authenticated request context)

### 4. Application Bootstrap Integration

**Location**: `backend/src/main.ts`

Key integration points:

1. **Early Sentry initialization** (line 22): Called before Nest factory creation to capture bootstrap-time crashes
2. **Buffer logs during startup** (line 27): `bufferLogs: true` prevents early framework logs from being lost
3. **Logger swap** (line 33): `app.useLogger(app.get(PinoLogger))` replaces Nest's default logger with Pino
4. **Fatal error handling** (lines 132-142): Bootstrap failures are captured by Sentry before process exit

## Developer Conventions

### Using the Logger in Services

Services should inject and use NestJS's standard `Logger` class, which automatically routes through Pino:

```typescript
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MyService {
  private readonly logger = new Logger(MyService.name);
  
  someMethod() {
    this.logger.log('Operation completed');
    this.logger.warn('Something unexpected happened');
    this.logger.error('Critical failure', errorStack);
  }
}
```

**Evidence**: Multiple services follow this pattern (e.g., `OrchestrationService`, `MessagingService`).

### Avoid Direct Console Usage

Direct `console.log/error/warn` calls bypass the structured logging pipeline and PII redaction. The codebase shows minimal console usage, primarily in:
- Auth service OTP logging (development-only, guarded by `NODE_ENV !== 'production'`)
- Fatal bootstrap error fallback in `main.ts`

### Health Probe Design

Health endpoints (`/livez`, `/readyz`, `/health`) are designed to be lightweight and exclude themselves from auto-logging to avoid polluting logs with high-frequency probe traffic.

## Key Files

- `backend/src/app.module.ts` — Pino configuration, redaction rules, serializers
- `backend/src/main.ts` — Bootstrap integration, logger swap, fatal error handling
- `backend/src/sentry.ts` — Conditional Sentry initialization, PII filtering
- `backend/src/common/sentry-exception.filter.ts` — Global exception handling, selective error reporting
- `backend/package.json` — Dependency declarations (`nestjs-pino`, `pino`, `pino-http`, `pino-pretty`, `@sentry/node`)

## Rules for Developers

1. **Always use NestJS `Logger` class** — never `console.log` in business logic
2. **Never log sensitive data directly** — the redaction layer is a safety net, not a substitute for careful logging
3. **Use appropriate log levels** — `debug` for verbose diagnostics, `info` for normal operations, `warn` for recoverable issues, `error` for failures requiring attention
4. **Include context in error logs** — pass error stacks to `logger.error()` for proper stack trace capture
5. **Don't log request/response bodies** — Pino's lean serializers intentionally strip these; respect that design
6. **Test with LOG_LEVEL=debug locally** — verify your log messages appear and contain useful context
7. **Verify redaction works** — check that phone numbers, OTP codes, and tokens never appear in logs during development
