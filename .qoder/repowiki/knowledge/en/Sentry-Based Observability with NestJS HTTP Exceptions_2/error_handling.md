## Error Handling Architecture

The 4Ever AI Life OS Platform uses a **dual-layer error handling strategy** combining NestJS's built-in `HttpException` mechanism for client-facing errors and **Sentry** for server-side observability and crash reporting.

### Backend: Global Exception Filter + Sentry Integration

#### Core Components

1. **`SentryExceptionFilter`** (`backend/src/common/sentry-exception.filter.ts`) — A global `@Catch()` exception filter registered in `main.ts` via `app.useGlobalFilters()`. It implements these rules:
   - **5xx errors** (and unknown exceptions): Captured by Sentry with request context (path, method, userId) and logged via Pino. The original response shape is preserved so clients are unaffected.
   - **4xx errors**: Passed through without Sentry noise — these are expected validation failures, not actionable bugs.
   - **Sentry failure resilience**: If Sentry itself fails, the filter catches the error silently to avoid blocking the request.

2. **`initSentry()`** (`backend/src/sentry.ts`) — Initializes Sentry at the very top of `main.ts`, before any other imports. Key behaviors:
   - **Zero-config off switch**: When `SENTRY_DSN` is unset (local dev, CI), `initSentry()` returns immediately — no network calls, no hooks, no CPU cost.
   - **PII redaction**: A `beforeSend` hook strips sensitive fields from request bodies (`phone`, `otp`, `password`, `token`) and headers (`authorization`, `cookie`, `x-api-key`, `x-admin-secret`) before events reach Sentry.
   - **Sampling**: 100% trace sampling in non-prod for debugging; 20% in production.

3. **Bootstrap error capture** (`backend/src/main.ts:132-142`) — Fatal startup crashes that occur before the Nest app is fully initialized are caught in the `.catch()` block and sent to Sentry before `process.exit(1)`.

#### Error Throwing Conventions

Services throw standard NestJS HTTP exceptions throughout the codebase:
- `BadRequestException` — Invalid input, rate limits exceeded, business rule violations (e.g., "Too many OTP requests", "Unknown dimension")
- `UnauthorizedException` — Authentication failures (invalid OTP, expired tokens, Apple sign-in failures)
- `NotFoundException` — Missing resources (action items, personas, documents)
- `ForbiddenException` — Authorization failures (admin secret mismatch, premium feature access denied)

No custom error classes or error codes are defined. The pattern relies entirely on HTTP status semantics.

### Frontend: React Error Boundary + Axios Interceptors

#### Web Client (`frontend/`)

1. **`ErrorBoundary`** (`frontend/src/components/ErrorBoundary.tsx`) — A class-component error boundary wrapping all routes in `App.tsx`. It:
   - Catches React rendering errors via `getDerivedStateFromError`
   - Displays a user-friendly fallback UI with retry button
   - Logs the error to `console.error` (no Sentry integration on the frontend)

2. **Axios response interceptor** (`frontend/src/api/client.ts:19-26`) — Automatically logs out the user on `401 Unauthorized` responses by calling `useAuthStore.getState().logout()`. All other errors are re-thrown for individual API call sites to handle.

#### Mobile Client (`mobile/`)

1. **Axios response interceptor** (`mobile/src/api/client.ts:32-40`) — Mirrors the web client's behavior: auto-logout on `401`, re-throw everything else. Uses a `setLogoutFn()` indirection to avoid circular imports with the auth store.

2. No equivalent React Error Boundary exists in the mobile app — unhandled component errors will crash the screen but not the entire app (React Native's default behavior).

### Logging Integration

Pino structured logging (`nestjs-pino`) is wired as the global Nest logger in `main.ts` and configured in `app.module.ts`. The log level is dynamically set based on `NODE_ENV` (debug in dev, info in prod). Request-level correlation IDs flow through child loggers for distributed tracing. Health probe endpoints (`/livez`, `/readyz`, `/health`) are excluded from auto-logging to reduce noise.

### Rules for Developers

1. **Throw HTTP exceptions, don't catch them in services** — Let errors bubble up to the global filter. Only use `try/catch` when you need to perform cleanup or transform an error into a different HTTP status.
2. **Never send PII to Sentry** — The `beforeSend` hook in `sentry.ts` handles redaction, but avoid logging sensitive data in service methods since Pino also flows to log aggregators.
3. **Use specific exception types** — Prefer `BadRequestException`, `UnauthorizedException`, etc. over generic `HttpException` so the filter can correctly classify 4xx vs 5xx.
4. **Frontend errors are not tracked** — Neither the web nor mobile client sends errors to Sentry. Console logging and user-visible error boundaries are the only mechanisms.
5. **Do not wrap the global filter** — The `SentryExceptionFilter` is registered globally in `main.ts`. Do not add module-level or controller-level exception filters unless you have a specific reason to override the default behavior.
