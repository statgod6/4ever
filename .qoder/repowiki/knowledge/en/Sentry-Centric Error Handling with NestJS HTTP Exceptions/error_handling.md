## Overview

The Memory Operating System employs a **Sentry-based observability strategy** for backend error tracking, combined with standard **NestJS HTTP exceptions** for client-facing errors. The frontend and mobile clients use **React Error Boundaries** and **Axios interceptors** for local error management.

## Backend Architecture (NestJS)

### Global Exception Filter (`SentryExceptionFilter`)

Located in `backend/src/common/sentry-exception.filter.ts`, this filter is registered globally in `main.ts` via `app.useGlobalFilters(new SentryExceptionFilter())`.

**Strategy**: It distinguishes between client errors (4xx) and server errors (5xx):

- **4xx Errors**: Treated as expected validation or business logic failures (e.g., `BadRequestException`, `UnauthorizedException`). These are **not** sent to Sentry to avoid noise. The filter preserves Nest's default JSON response shape.
- **5xx Errors**: Treated as actionable bugs. The filter captures the exception in Sentry, enriching the scope with request metadata (path, method, user ID) before returning a generic "Internal server error" response to the client.

**Resilience**: The filter includes a `try/catch` around Sentry calls to ensure that if Sentry itself is down, the request still completes normally.

### Sentry Initialization & PII Redaction

Initialized in `backend/src/sentry.ts` at the very top of `main.ts` to catch early bootstrap crashes:

```typescript
initSentry(); // Called before NestFactory.create()
```

**Zero-Cost Dev Mode**: If `SENTRY_DSN` is not set (local development), Sentry is a complete no-op — no network calls, no global hooks, no CPU cost.

**PII Protection**: A `beforeSend` hook redacts sensitive fields before they reach Sentry:
- Request body keys: `phone`, `phoneNumber`, `otp`, `otpCode`, `password`, `token`, `identityToken`
- Headers: `authorization`, `cookie`, `x-api-key`, `x-admin-secret`

### Service-Level Error Propagation

Services throw standard NestJS exceptions for business logic violations:

- `BadRequestException` — invalid input (e.g., malformed phone number, missing required field)
- `UnauthorizedException` — authentication failures (e.g., invalid OTP, expired token)
- `NotFoundException` — resource not found (e.g., action item missing)
- `ForbiddenException` — authorization failures (e.g., non-premium user accessing premium feature)

These exceptions are caught by the global filter, which maps them to appropriate HTTP status codes without logging them to Sentry.

### WebSocket Error Handling

The `MessagingGateway` handles errors locally within `@SubscribeMessage` handlers. Errors are emitted back to the specific client via `client.emit('message_error', { error, code })` rather than crashing the gateway or triggering the global HTTP filter.

### Bootstrap Error Handling

Fatal bootstrap errors are captured in `main.ts`:

```typescript
bootstrap().catch((err) => {
  try {
    Sentry.captureException(err);
  } catch {
    // ignore — Sentry is a no-op when DSN is unset
  }
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
```

## Frontend & Mobile Architecture

### React Error Boundary

The web frontend uses a class-based `ErrorBoundary` component (`frontend/src/components/ErrorBoundary.tsx`) to catch rendering errors in the React tree. It displays a fallback UI with a "Try Again" button and logs the error to the console. It does not currently integrate with Sentry on the client side.

### API Client Interceptors

Both web (`frontend/src/api/client.ts`) and mobile (`mobile/src/api/client.ts`) use Axios interceptors:

- **401 Handling**: Automatically triggers a logout flow if a `401 Unauthorized` response is received, ensuring consistent session management across clients.
- Errors are otherwise propagated as rejected promises for individual components to handle (e.g., showing toast notifications).

## Developer Conventions

### Rules to Follow

1. **Throw 4xx for Business Logic**: Use `BadRequestException` for invalid input and `UnauthorizedException` for auth failures. Do not throw 5xx errors manually unless a genuine infrastructure failure occurs.
   - Example: `throw new UnauthorizedException('Invalid OTP code.');`

2. **Do Not Catch 4xx in Filters**: Let Nest's default pipe/validation handle 4xx errors. The global filter intentionally ignores them for Sentry reporting.

3. **Protect PII**: Never log sensitive user data (phones, tokens) directly. Rely on the Sentry `beforeSend` redaction for any error context that might inadvertently include them.

4. **WebSocket Resilience**: Always wrap async WebSocket handler logic in `try/catch` blocks and emit structured error events to the client to prevent socket disconnections.

5. **Bootstrap Safety**: Ensure `initSentry()` is called before any other imports that might throw during module evaluation.

6. **Graceful Degradation**: Wrap Sentry calls in `try/catch` blocks so that Sentry downtime never blocks request completion.
