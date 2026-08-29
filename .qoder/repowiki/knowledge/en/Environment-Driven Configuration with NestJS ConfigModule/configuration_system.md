The 4Ever AI Life OS Platform employs an environment-driven configuration strategy, primarily leveraging the **NestJS `ConfigModule`** for the backend and build-time environment variable injection for the frontend and mobile clients. This approach ensures that sensitive credentials (API keys, database URLs, secrets) are decoupled from the codebase and managed via the deployment environment.

### Backend Configuration (NestJS)

*   **Core Mechanism**: The backend uses `@nestjs/config`'s `ConfigModule.forRoot({ isGlobal: true })` in `app.module.ts`. This makes the `ConfigService` available across all modules without needing to re-import the module.
*   **Environment Loading**: 
    *   In `main.ts`, `dotenv` is explicitly imported and configured with `override: true` at the very top of the file. This ensures that values in `backend/.env` take precedence over any shell environment variables, preventing accidental pollution from the host system during development.
    *   In production (Docker/Fly.io), environment variables are injected directly into the container runtime, bypassing the `.env` file.
*   **Validation & Fail-Closed Strategy**: 
    *   Critical secrets like `JWT_SECRET` are validated at boot time in `auth.module.ts` and `jwt.strategy.ts`. If the secret is missing or too short (<16 chars), the application throws an error and refuses to start. This prevents the app from running with insecure defaults.
    *   The `HealthController` (`/api/readyz`) performs a readiness check that verifies the presence of required environment variables (`DATABASE_URL`, `JWT_SECRET`, `OPENROUTER_API_KEY`) before marking the service as ready to accept traffic.
*   **Dynamic Configuration**: 
    *   **CORS**: Origins are parsed from `CORS_ORIGINS` (comma-separated string) in `main.ts`. In production, if `CORS_ORIGINS` is not set, the app crashes on startup to prevent wildcard exposure.
    *   **Logging**: Log levels and transport (pretty-print vs. JSON) are determined by `NODE_ENV` and `LOG_LEVEL` in `app.module.ts` via `nestjs-pino`.
    *   **Rate Limiting**: Throttler TTLs and limits are hardcoded in `app.module.ts` but could be externalized; currently, they use static defaults for different buckets (`default`, `auth_short`, `auth_long`).

### Frontend Configuration (Vite + React)

*   **Proxy-Based Dev Config**: The `vite.config.ts` uses a dev server proxy to forward `/api` requests to `http://localhost:3001`. This avoids CORS issues during local development and means the frontend doesn't need an explicit API URL env var in dev.
*   **Production Build**: The frontend is built as a static SPA. API endpoints are relative (`/api`), relying on the web server (Nginx in Docker) to proxy or serve them from the same origin. No explicit `VITE_` env vars are currently used for API routing in the provided config, suggesting a same-origin deployment pattern.

### Mobile Configuration (Expo + React Native)

*   **Build-Time Injection**: The mobile app uses `EXPO_PUBLIC_API_URL` for configuration. Expo only exposes env vars prefixed with `EXPO_PUBLIC_` to the client bundle.
*   **Resolution Logic** (`mobile/src/constants/config.ts`):
    1.  **Env Var**: If `EXPO_PUBLIC_API_URL` is set (e.g., in `.env` or EAS build env), it is used. This is the standard for production/staging builds.
    2.  **Dev Auto-Detect**: If unset and in `__DEV__`, it auto-detects the host IP based on the platform (Android emulator uses `10.0.2.2`, iOS simulator uses `localhost`, Expo Go uses a hardcoded `DEV_MACHINE_IP`).
    3.  **Fail-Safe**: In production builds, if `EXPO_PUBLIC_API_URL` is missing, the app throws a fatal error at runtime to prevent connecting to a wrong or default host.
*   **Derived Endpoints**: `BASE_URL` and `WS_URL` (for WebSockets) are derived programmatically from `API_URL`, ensuring consistency.

### Infrastructure & Secrets Management

*   **Docker Compose**: Uses variable substitution (`${VAR:-default}`) from the host environment. Critical secrets like `JWT_SECRET` are marked as required (`${JWT_SECRET:?error}`) to fail fast if missing.
*   **Fly.io**: Secrets are managed via `fly secrets set` and injected into the runtime environment. The `fly.toml` file contains only non-sensitive defaults (e.g., `NODE_ENV=production`).
*   **Prisma**: The `DATABASE_URL` is passed directly from the environment to the Prisma Client via `process.env`, adhering to Prisma's standard convention.

### Developer Conventions

1.  **Never Hardcode Secrets**: All API keys, DB URLs, and secrets must be in `.env` (gitignored) or the deployment environment.
2.  **Prefix Mobile Env Vars**: Use `EXPO_PUBLIC_` prefix for any env var needed in the mobile client.
3.  **Validate Early**: Critical config should be validated at module initialization or bootstrap (e.g., `JwtStrategy`) to fail fast.
4.  **Use `ConfigService`**: In NestJS services, inject `ConfigService` to read env vars rather than accessing `process.env` directly. This improves testability and aligns with NestJS patterns.
5.  **CORS Safety**: Always define `CORS_ORIGINS` explicitly in production. The app will crash if this is missing in prod mode.