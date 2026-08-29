The 4Ever Cognitive Companion Platform uses an **environment-driven configuration system** centered on the **NestJS `ConfigModule`** for the backend, **Vite environment variables** for the web frontend, and **Expo public environment variables** for the mobile client. Configuration is layered across local `.env` files, container orchestration (`docker-compose.yml`), and cloud platform secrets (Fly.io, Railway).

### Backend Configuration (NestJS)

- **Core Mechanism**: The backend relies on `@nestjs/config`'s `ConfigModule.forRoot({ isGlobal: true })` in `app.module.ts`. This makes environment variables available via `process.env` throughout the application.
- **Bootstrap Loading**: In `main.ts`, `dotenv` is explicitly loaded with `override: true` before any other imports. This ensures that values in `backend/.env` always take precedence over potentially polluted shell environment variables, a critical safeguard for local development.
- **Key Environment Variables**:
  - `DATABASE_URL`: PostgreSQL connection string (required).
  - `JWT_SECRET` & `JWT_EXPIRATION`: Authentication token signing and validity.
  - `OPENROUTER_API_KEY` & `OPENROUTER_DEFAULT_MODEL`: LLM provider credentials.
  - `CORS_ORIGINS`: Comma-separated list of allowed origins. In production, this variable is **mandatory**; the application throws an error if it is unset to prevent accidental wildcard exposure.
  - `SENTRY_DSN`: Optional. If set, Sentry error tracking is initialized; if unset, Sentry remains a no-op.
  - `NODE_ENV`: Controls logging verbosity (Pino) and feature toggles (e.g., static file serving, compression).
  - `PORT`: Server listening port (default 3001).

### Frontend Configuration (Web)

- **Mechanism**: The React frontend uses **Vite**'s built-in environment variable handling. 
- **API Proxy**: During development, `vite.config.ts` proxies `/api` requests to `http://localhost:3001`. In production, the frontend is served as static assets by Nginx (via Docker), and API calls are made directly to the backend's public URL (configured via environment or build-time injection).
- **Client-Side Config**: The API client (`frontend/src/api/client.ts`) uses a relative base URL (`/api`), relying on the hosting environment's proxy or CORS configuration.

### Mobile Configuration (React Native/Expo)

- **Mechanism**: The mobile app uses **Expo's `EXPO_PUBLIC_` prefixed environment variables**. These are baked into the JavaScript bundle at build time.
- **API URL Resolution**: `mobile/src/constants/config.ts` implements a robust resolution strategy:
  1. **Explicit Env Var**: `EXPO_PUBLIC_API_URL` (highest priority, used for production/staging builds).
  2. **Dev Auto-Detect**: If unset in dev mode, it auto-detects the host IP based on the runtime (Expo Go on physical device → LAN IP; Android Emulator → `10.0.2.2`; iOS Simulator → `localhost`).
  3. **Fail-Loud**: Production builds without `EXPO_PUBLIC_API_URL` throw an error at startup to prevent silent misconfiguration.
- **Derived URLs**: `BASE_URL` and `WS_URL` (for WebSockets) are derived from `API_URL` to ensure consistency.

### Infrastructure & Deployment Configuration

- **Docker Compose**: `docker-compose.yml` orchestrates local and containerized environments. It injects environment variables from the host (or `.env`) into the `backend` service. Critical secrets like `JWT_SECRET` are marked as required (`${JWT_SECRET:?...}`) to fail fast if missing.
- **Fly.io**: `fly.toml` defines production deployment settings. Secrets (DB URLs, API keys) are managed via `fly secrets set` and injected as environment variables. Health checks (`/api/livez`, `/api/readyz`) are configured here.
- **Railway**: `railway.json` provides an alternative deployment manifest, specifying the start command (`npx prisma migrate deploy && node dist/main.js`) and health check paths.

### Security & Secrets Management

- **Redaction**: Both Pino logging (`app.module.ts`) and Sentry error reporting (`sentry.ts`) implement strict redaction rules to strip PII (phone numbers, OTPs, JWTs, passwords) from logs and error payloads.
- **No Hardcoded Secrets**: The repository uses `.env` for local dev (gitignored) and platform-specific secret stores for production. `fly.toml` and `docker-compose.yml` explicitly avoid hardcoding sensitive values.
- **CORS Enforcement**: Production builds enforce explicit `CORS_ORIGINS` to prevent open-cross-origin vulnerabilities.

### Developer Conventions

1. **Backend Env Vars**: Add new backend configuration variables to `backend/.env` for local dev. Ensure they are documented in `README.md` or relevant module docs.
2. **Mobile Env Vars**: Use `EXPO_PUBLIC_` prefix for any variable needed in the mobile client. Add to `.env` in the mobile root.
3. **Production Secrets**: Never commit secrets. Use `fly secrets set` for Fly.io deployments or the Railway dashboard for Railway deployments.
4. **Fail-Fast**: Critical configuration errors (like missing `JWT_SECRET` or `CORS_ORIGINS` in prod) should throw errors at startup, not fail silently.