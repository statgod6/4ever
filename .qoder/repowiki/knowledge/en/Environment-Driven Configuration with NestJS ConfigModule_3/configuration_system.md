The Memory Operating System employs an environment-driven configuration strategy, primarily leveraging the **NestJS `ConfigModule`** for the backend and build-time environment variable injection for the frontend and mobile clients. The system is designed to be secure by default, failing closed when critical secrets are missing in production.

### Backend Configuration (NestJS)

1.  **Core Mechanism**: The backend uses `@nestjs/config`'s `ConfigModule.forRoot()` in `AppModule`. It is configured as `isGlobal: true`, making the `ConfigService` available across all modules without explicit imports.
2.  **Environment File Loading**: The system supports a monorepo structure by searching for `.env` files in multiple locations:
    *   Project root (`../.env` relative to `backend/`)
    *   Backend directory (`backend/.env`)
    *   Compiled output directories (`dist/`, `dist/src/`)
    *   This ensures configuration works consistently during local development (`ts-node`) and production builds.
3.  **Early Loading & Overrides**: In `main.ts`, `dotenv` is explicitly invoked *before* NestJS bootstrap to ensure environment variables are available for early initialization logic (e.g., Sentry, AWS SNS). It loads the root `.env` first, then `backend/.env` with `override: true`, allowing backend-specific values to take precedence.
4.  **Secret Management & Validation**:
    *   **Fail-Closed Strategy**: Critical secrets like `JWT_SECRET` are validated at module initialization (`AuthModule`). If missing or too short, the application throws an error and refuses to start, preventing insecure defaults in production.
    *   **Health Checks**: The `/api/readyz` endpoint verifies the presence of required environment variables (`DATABASE_URL`, `JWT_SECRET`, `OPENROUTER_API_KEY`) and reports their status without exposing values.
    *   **Redaction**: Structured logging (Pino) and error tracking (Sentry) are configured to redact sensitive fields (API keys, tokens, OTPs, phone numbers) from logs and error payloads.
5.  **Feature Flags**: Boolean feature flags (e.g., `ONTOLOGY_ENABLED`, `SKILLS_ENABLED`) are parsed from environment strings, allowing runtime toggling of experimental features.

### Frontend & Mobile Configuration

1.  **Frontend (Vite)**: Uses Vite's built-in environment variable handling. API endpoints are proxied via `vite.config.ts` during development (`/api` -> `http://localhost:3001`). Production builds rely on the browser's same-origin policy or explicit CORS configuration.
2.  **Mobile (Expo)**: 
    *   **Build-Time Injection**: Uses `EXPO_PUBLIC_` prefixed environment variables, which are embedded into the JavaScript bundle at build time (via EAS or `.env`).
    *   **Dev Auto-Detection**: In development, if no explicit API URL is set, the app auto-detects the host IP for Expo Go or uses emulator-specific loopbacks (`10.0.2.2` for Android, `localhost` for iOS).
    *   **Fail-Safe**: Production builds throw a runtime error if `EXPO_PUBLIC_API_URL` is not defined, preventing silent misconfiguration.

### Infrastructure & Deployment

*   **Docker Compose**: Orchestrates services (Postgres, Backend, Frontend) and passes environment variables from the host `.env` file into containers. Critical variables like `JWT_SECRET` are marked as required (`:?`) in the compose file.
*   **Platform Config**: Includes `fly.toml` and `railway.json` for platform-specific deployment configurations, which typically inject secrets via their respective dashboards/CLIs.

### Developer Conventions

*   **Access Pattern**: Use `ConfigService.get<T>('KEY')` in NestJS services/controllers. Avoid direct `process.env` access in business logic to maintain testability and dependency injection benefits, except in early bootstrap phases (`main.ts`, `auth.service.ts` constructor for AWS SDK).
*   **Security**: Never commit `.env` files. Use `.env.example` for documenting required variables. All new secrets must be added to the health check's required list if they are critical for operation.