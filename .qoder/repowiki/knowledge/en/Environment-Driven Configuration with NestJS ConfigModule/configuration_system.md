## Overview

The 4Ever AI Life OS Platform uses an **environment-variable-driven configuration system** built on `@nestjs/config` (NestJS ConfigModule) for the backend, with build-time environment injection for frontend and mobile clients. There is no centralized config file format (YAML/JSON/TOML); all runtime configuration flows through `.env` files and platform-specific secret management.

---

## Core Approach

### Backend: NestJS ConfigModule + dotenv

- **Framework**: `@nestjs/config` v3.x with `isGlobal: true`, making `ConfigService` injectable across all modules without per-module imports.
- **Loading order**: `dotenv` is explicitly loaded in `backend/src/main.ts` **before** any NestJS bootstrap, with `override: true` to ensure `backend/.env` values always win over polluted shell environment variables.
- **No default secrets**: Critical values like `JWT_SECRET`, `DATABASE_URL`, and `OPENROUTER_API_KEY` are validated at boot time; missing or weak values throw errors and prevent startup (fail-closed posture).

### Frontend: Vite Build-Time Injection

- No runtime config loading. The frontend proxies `/api` requests to `http://localhost:3001` via `vite.config.ts` during development.
- Production builds rely on nginx reverse-proxy configuration in the Dockerfile (`proxy_pass http://backend:3001/api`).

### Mobile: Expo Public Env Vars

- Uses `EXPO_PUBLIC_API_URL` (Expo's convention for client-exposed env vars) resolved at **build time** into the JS bundle.
- Dev auto-detection logic in `mobile/src/constants/config.ts` resolves the API host based on runtime context (Expo Go on physical device → LAN IP, Android emulator → `10.0.2.2`, iOS simulator → `localhost`).
- Production builds **fail loudly** if `EXPO_PUBLIC_API_URL` is unset — no hardcoded fallbacks.

---

## Key Files

| File | Purpose |
|------|---------|
| `.env.example` | Root-level template documenting all required and optional env vars with generation instructions |
| `backend/src/main.ts` | Explicit dotenv loading with `override: true`; CORS validation; port resolution |
| `backend/src/app.module.ts` | `ConfigModule.forRoot({ isGlobal: true })`; Pino logger config driven by `LOG_LEVEL` and `NODE_ENV` |
| `backend/src/auth/auth.module.ts` | JWT module async factory using `ConfigService`; validates `JWT_SECRET` length >= 16 chars |
| `backend/src/auth/jwt.strategy.ts` | Re-validates `JWT_SECRET` in strategy constructor (defensive double-check) |
| `backend/src/health/health.controller.ts` | Readiness probe checks presence of required env vars (`DATABASE_URL`, `JWT_SECRET`, `OPENROUTER_API_KEY`) |
| `backend/prisma.config.ts` | Prisma CLI config reading `DATABASE_URL` from `process.env` via dotenv |
| `backend/fly.toml` | Fly.io deployment config; secrets injected via `fly secrets set` (never committed) |
| `backend/railway.json` | Railway deployment config with healthcheck path and start command |
| `docker-compose.yml` | Local dev orchestration; env var interpolation with defaults and required-var enforcement (`${JWT_SECRET:?...}`) |
| `mobile/src/constants/config.ts` | API URL resolution with precedence chain: env var > dev auto-detect > error |
| `frontend/vite.config.ts` | Dev proxy config pointing to backend |

---

## Architecture & Conventions

### Environment Variable Categories

The `.env.example` file organizes vars into clear sections:

1. **Database**: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DATABASE_URL`
2. **Auth/Security**: `JWT_SECRET` (min 64 hex chars), `JWT_EXPIRATION`, `OTP_PEPPER` (min 32 chars)
3. **AI Providers**: `OPENROUTER_API_KEY`, `OPENROUTER_DEFAULT_MODEL`, `TTS_MODEL`, `TAVILY_API_KEY`, `E2B_API_KEY`
4. **Infrastructure**: `PORT`, `NODE_ENV`, `CORS_ORIGINS`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`
5. **Feature Flags**: `ONTOLOGY_ENABLED`, `SKILLS_ENABLED`, `SKILLS_SHADOW_MODE`, `SKILLS_MAX_SELECTED`
6. **Admin/Ops**: `ADMIN_SECRET`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`
7. **SMS**: `AWS_SNS_SENDER_ID` (with India DLT registration notes)

### Validation Strategy

- **Boot-time validation**: `auth.module.ts` throws if `JWT_SECRET` is missing or < 16 chars. `jwt.strategy.ts` re-checks this.
- **Readiness probe validation**: `health.controller.ts` `/readyz` endpoint checks presence of `DATABASE_URL`, `JWT_SECRET`, `OPENROUTER_API_KEY` and returns 503 if any are missing.
- **Production CORS enforcement**: `main.ts` throws `CORS_ORIGINS must be set in production` if `NODE_ENV === 'production'` and `CORS_ORIGINS` is unset.
- **Docker Compose enforcement**: `${JWT_SECRET:?JWT_SECRET is required and must not be empty}` syntax causes compose to fail if the var is empty.

### Secret Management by Platform

| Platform | Method |
|----------|--------|
| Local dev | `.env` file (gitignored) copied from `.env.example` |
| Docker Compose | Host env vars interpolated into container; `.env` file support |
| Fly.io | `fly secrets set KEY=VALUE` (encrypted at rest, injected at runtime) |
| Railway | Environment variables set in Railway dashboard or via `railway up` |
| EAS (Mobile) | `EXPO_PUBLIC_API_URL` set via `eas.json` env or `.env` at build time |

### Logging Configuration

- Pino logger level controlled by `LOG_LEVEL` env var, defaulting to `info` in production and `debug` in development.
- Transport: `pino-pretty` in dev (colorized, single-line), raw JSON in production.
- PII redaction configured in `app.module.ts` via Pino's `redact.paths` — strips auth headers, OTP codes, phone numbers, tokens from all log lines.

---

## Rules Developers Should Follow

1. **Never commit `.env`**: Only `.env.example` (placeholders) is tracked. Use `scripts/scan-secrets.js` to detect accidental secret commits.
2. **Generate strong secrets**: Use the provided `node -e` commands in `.env.example` comments to generate `JWT_SECRET` (64 hex chars) and `OTP_PEPPER` (64 hex chars).
3. **Add new env vars to `.env.example`**: Document the purpose, generation method, and whether it's required or optional.
4. **Validate critical vars at boot**: If a new module requires a secret, add validation in its module's `useFactory` or service constructor — fail closed, never default to a placeholder.
5. **Use `ConfigService.get<T>()` for type safety**: Inject `ConfigService` and use typed getters rather than raw `process.env` access in services.
6. **Frontend/mobile env vars must use `EXPO_PUBLIC_` prefix**: Expo only exposes vars with this prefix to client code. Backend-only vars stay in backend `.env`.
7. **Platform-specific secrets go through platform secret stores**: Never hardcode API keys in `fly.toml`, `railway.json`, or `eas.json`. Use `fly secrets set`, Railway dashboard, or EAS secrets.
8. **CORS origins must be explicit in production**: Never use wildcards. Set `CORS_ORIGINS` to comma-separated list of owned domains.
9. **Feature flags default to safe values**: `SKILLS_ENABLED=false`, `SKILLS_SHADOW_MODE=true` — new features should ship disabled or in shadow mode.
10. **Health probes reflect config state**: If adding a new required integration, add its presence check to `/readyz` in `health.controller.ts`.