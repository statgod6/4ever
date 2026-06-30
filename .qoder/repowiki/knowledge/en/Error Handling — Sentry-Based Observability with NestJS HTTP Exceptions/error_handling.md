## Overview

The 4Ever AI Life OS Platform uses a **Sentry-centric error observability system** combined with **NestJS built-in HTTP exception classes** for structured error propagation. Error handling is split across three layers: backend API (NestJS), web frontend (React), and mobile client (React Native).

---

## Backend Error Handling Architecture

### 1. Global Exception Filter (`SentryExceptionFilter`)

Located at `backend/src/common/sentry-exception.filter.ts`, this is the cornerstone of backend error handling:

- **Selective Sentry reporting**: Only 5xx errors and unhandled exceptions are sent to Sentry. 4xx errors (validation failures, bad requests) are intentionally excluded to avoid noise.
- **Preserves Nest default response shape**: The filter does not alter the HTTP response contract — clients receive standard NestJS error responses.
- **PII redaction**: User ID is attached to Sentry scope when available; sensitive data is stripped via the `beforeSend` hook in `sentry.ts`.
- **Fail-safe design**: If Sentry itself fails, the request still completes normally — error reporting never blocks user-facing functionality.

```typescript
// Only ship 5xx + unknown to Sentry; 4xx noise would drown out real signals.
if (status >= 500) {
  Sentry.withScope((scope) => {
    scope.setTag('path', req?.url);
    scope.setTag('method', req?.method);
    if (userId) scope.setUser({ id: userId });
    Sentry.captureException(exception);
  });
}
```

### 2. Sentry Initialization (`backend/src/sentry.ts`)

- **Zero-config off switch**: When `SENTRY_DSN` is unset (local dev, CI), `initSentry()` returns immediately — no network calls, no hooks, no CPU cost.
- **PII redaction in `beforeSend`**: Strips phone numbers, OTP codes, passwords, tokens, authorization headers, cookies, and admin secrets before they reach Sentry.
- **Sampling strategy**: 100% trace sampling in non-production, 20% in production.
- **Fatal bootstrap protection**: `main.ts` wraps the bootstrap call in a `.catch()` that reports to Sentry before `process.exit(1)`.

### 3. NestJS HTTP Exception Classes

Services throw standard NestJS exceptions rather than custom error types:

| Exception | Usage Pattern |
|---|---|
| `BadRequestException` | Validation failures, rate limits, business rule violations (e.g., "Too many OTP requests") |
| `UnauthorizedException` | Authentication failures (invalid OTP, expired sessions) |
| `NotFoundException` | Resource not found (missing action items, personas, documents) |
| `ForbiddenException` | Authorization failures (admin guard, premium guard) |
| `InternalServerErrorException` | Rare — used sparingly for unexpected internal failures |

**No custom error classes exist** in this codebase. All error signaling goes through NestJS's built-in exception hierarchy.

### 4. Service-Level Error Patterns

- **Direct throws**: Services throw exceptions inline without wrapping in try-catch blocks. Example from `auth.service.ts`:
  ```typescript
  if (!otpRecord) {
    throw new UnauthorizedException('No valid OTP found.');
  }
  ```
- **External service resilience**: Third-party calls (Twilio SMS) are wrapped in try-catch with silent failure — SMS delivery failure does not block OTP generation.
- **No centralized error codes**: Errors use human-readable string messages only; there is no error code enumeration or machine-parseable error taxonomy.

### 5. Logging Pipeline

- **Pino structured logging**: All logs flow through `nestjs-pino` with JSON formatting and redaction.
- **Logger integration**: The global exception filter logs 5xx errors via `this.logger.error()` with stack traces.

---

## Frontend Error Handling (Web)

### 1. Axios Interceptor (`frontend/src/api/client.ts`)

- **401 auto-logout**: Any 401 response triggers `useAuthStore.getState().logout()`, clearing session state.
- **Error pass-through**: All other errors are re-thrown as rejected promises for component-level handling.

### 2. React Error Boundary (`frontend/src/components/ErrorBoundary.tsx`)

- **Class-based boundary**: Catches rendering errors in the React tree.
- **User-facing fallback**: Displays a generic "Something went wrong" message with a retry button.
- **Console-only logging**: Errors are logged to `console.error` but NOT sent to any external tracker (no Sentry integration on the frontend).

### 3. Component-Level Error Display

- **Inline error state**: Pages like `Login.tsx` use local `error` state to display API error messages in a styled banner.
- **Toast notifications**: The `toast` store (`frontend/src/components/Toast.tsx`) provides success/error/warning/info toasts with auto-dismiss. Error toasts persist for 5 seconds.

---

## Mobile Client Error Handling

### 1. Axios Interceptor (`mobile/src/api/client.ts`)

- Mirrors the web client: 401 responses trigger logout via a registered callback (`setLogoutFn`).
- Token caching avoids async SecureStore reads on every request.

### 2. Toast System (`mobile/src/components/Toast.tsx`)

- **Global toast provider**: `ToastProvider` wraps the app root; `showToast(message, type)` is called from anywhere.
- **Three types**: `success`, `error`, `info` — each with distinct colors.
- **Auto-dismiss**: 3-second duration with fade animation.

### 3. Screen-Level Error Handling

- **Try-catch with toast feedback**: Every async operation in screens (e.g., `LoginScreen.tsx`) wraps API calls in try-catch and displays errors via `showToast()`.
- **Silent cancellation**: Apple sign-in cancellations (`ERR_CANCELED`) are silently ignored.
- **Error message extraction**: `err.response?.data?.message || err?.message || fallback` pattern is used consistently.

---

## Key Design Decisions

1. **No custom error types**: The codebase relies entirely on NestJS built-in exceptions and string messages. There is no error code system, no domain-specific error classes, and no error serialization protocol.

2. **Sentry is backend-only**: The frontend and mobile clients do NOT send errors to Sentry. Only the NestJS backend has observability integration.

3. **4xx errors are not bugs**: The exception filter explicitly excludes 4xx errors from Sentry reporting, treating them as expected client-side validation failures rather than actionable incidents.

4. **Fail-safe error reporting**: Both the Sentry filter and the `beforeSend` hook wrap their logic in try-catch to ensure Sentry failures never impact request processing.

5. **PII protection at multiple layers**: Phone numbers, OTP codes, tokens, and auth headers are redacted both in Pino logs and in Sentry's `beforeSend` hook.

---

## Rules Developers Should Follow

1. **Use NestJS HTTP exceptions for all API errors**: Throw `BadRequestException`, `UnauthorizedException`, `NotFoundException`, or `ForbiddenException` — do not create custom error classes.

2. **Write descriptive error messages**: Since there are no error codes, the message string is the only signal clients receive. Make it clear and actionable.

3. **Wrap third-party calls in try-catch**: External services (Twilio, OpenRouter, Tavily) should fail gracefully without crashing the request.

4. **Frontend: extract `err.response?.data?.message`**: Always fall back to `err.message` and then a hardcoded default when displaying API errors.

5. **Do not log sensitive data**: Never log phone numbers, OTP codes, tokens, or JWT payloads — the redaction systems are a safety net, not a substitute for careful logging.

6. **Mobile: use `showToast()` for user feedback**: Do not use `alert()` or console-only errors — always provide visible feedback via the toast system.

7. **401 handling is automatic**: Both web and mobile clients auto-logout on 401 — do not add redundant logout logic in individual components.
