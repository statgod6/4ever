The 4Ever Cognitive Companion Platform employs a poly-repository build strategy with distinct toolchains for its backend (NestJS), web frontend (React/Vite), and mobile client (React Native/Expo). The system relies on containerization for server-side components and managed cloud services for mobile distribution.

### Backend Build & Deployment (NestJS)
- **Build System**: Uses `nest-cli` for TypeScript compilation. The build process is encapsulated in a multi-stage Dockerfile (`backend/Dockerfile`) that separates dependency installation, compilation (including Prisma client generation), and runtime execution.
- **Containerization**: 
  - **Base Image**: Pinned to `node:20.17.0-alpine` for consistency and security.
  - **Hardening**: Implements `dumb-init` as PID 1 for proper signal handling (SIGTERM), runs as a non-root user (`node`), and installs only production dependencies in the final layer.
  - **Health Checks**: Includes a `HEALTHCHECK` instruction probing `/api/livez` using Node's native `fetch`.
- **Deployment Targets**:
  - **Fly.io**: Primary production host configured via `backend/fly.toml`. Features auto-scaling, rolling deployments, and a release command (`npx prisma migrate deploy`) to ensure database schema consistency before new instances start.
  - **Railway**: Supported via `backend/railway.json`, offering an alternative PaaS deployment path with similar health-check and restart policies.
  - **Docker Compose**: Used for local development and self-hosted scenarios. `docker-compose.yml` orchestrates the backend, frontend, and a `pgvector`-enabled PostgreSQL instance. An override file (`docker-compose.override.yml`) injects development-specific behaviors like source bind-mounts and hot-reload commands.

### Frontend Build & Deployment (React/Vite)
- **Build System**: Driven by Vite (`frontend/vite.config.ts`). The build script (`npm run build`) compiles TypeScript and bundles assets into a static `dist` directory.
- **Containerization**: A multi-stage Dockerfile (`frontend/Dockerfile`) builds the static assets and serves them via `nginxinc/nginx-unprivileged`. The Nginx configuration includes SPA fallback routing (`try_files $uri $uri/ /index.html`) and reverse-proxies `/api` requests to the backend service.
- **Local Development**: Vite's dev server proxies API requests to `localhost:3001` to avoid CORS issues during development.

### Mobile Build & Deployment (React Native/Expo)
- **Build System**: Managed by Expo Application Services (EAS) via `mobile/eas.json`. 
- **Build Profiles**:
  - **Development**: Creates debug builds with the Expo dev menu for internal testing.
  - **Preview**: Generates release-mode builds pointing to the staging API for QA.
  - **Production**: Produces store-ready artifacts (AAB for Android, IPA for iOS) with auto-incrementing build numbers.
- **Submission**: EAS Submit is configured for automated submission to the Apple App Store and Google Play Store, though credentials require manual setup.

### Dependency Management
- **Strategy**: Each project root (`backend/`, `frontend/`, `mobile/`) maintains its own `package.json` and `package-lock.json`. A top-level `package.json` exists but appears largely unused for orchestration, indicating a "loose monorepo" structure where components are built and versioned independently.
- **Lockfiles**: Strict pinning via `package-lock.json` ensures reproducible builds across environments.

### Key Conventions & Rules
1. **Secrets Management**: Secrets (e.g., `JWT_SECRET`, `DATABASE_URL`) are never committed. They are injected via environment variables in Docker Compose, `fly secrets`, or EAS environment configurations.
2. **Database Migrations**: Prisma migrations are executed automatically during deployment via the `release_command` in Fly.io or the `startCommand` in Railway.
3. **Non-Root Execution**: All production containers run as non-root users to minimize security risks.
4. **Signal Handling**: The backend uses `dumb-init` to ensure graceful shutdowns, allowing active LLM streams to complete before termination.