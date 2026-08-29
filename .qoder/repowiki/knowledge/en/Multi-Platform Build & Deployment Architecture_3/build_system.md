The Memory Operating System employs a polyglot, multi-stage build system centered around Docker for backend/frontend services and Expo Application Services (EAS) for the mobile client. The architecture prioritizes security hardening, minimal runtime footprints, and environment-specific configuration management.

### Backend Build (NestJS)
- **Tooling**: NestJS CLI, Prisma ORM, TypeScript.
- **Docker Strategy**: A three-stage `Dockerfile` using `node:20.17.0-alpine`.
  1. **deps**: Installs all dependencies with `npm ci` for cache efficiency.
  2. **build**: Generates the Prisma client and compiles TypeScript to `dist/`.
  3. **runtime**: A minimal production image installing only `--omit=dev` dependencies. It uses `dumb-init` as PID 1 for proper signal handling (SIGTERM) and runs as a non-root user (`node`).
- **Health Checks**: Built-in `HEALTHCHECK` instructions probe `/api/livez` using Node's native `fetch`.
- **Database Migrations**: Executed via `npx prisma migrate deploy` as a release command in deployment configs.

### Frontend Build (React + Vite)
- **Tooling**: Vite, TypeScript, Tailwind CSS.
- **Docker Strategy**: A two-stage build.
  1. **builder**: Compiles the static assets using `npm run build`.
  2. **runtime**: Serves the `dist/` folder using `nginxinc/nginx-unprivileged:1.27-alpine`. This avoids root privileges and listens on port 8080. Includes an Nginx config for SPA fallback and API reverse-proxying to the backend.

### Mobile Build (Expo/React Native)
- **Tooling**: Expo SDK 54, EAS Build.
- **Configuration**: `eas.json` defines three build profiles:
  - **development**: On-device debug builds with the dev menu.
  - **preview**: Staging/QA builds pointing to the staging API.
  - **production**: Store-ready AAB/IPA with auto-incrementing build numbers.
- **Submission**: Automated submission configurations for Apple App Store and Google Play Store are defined but require secret injection.

### Orchestration & Deployment
- **Local Development**: `docker-compose.yml` orchestrates PostgreSQL (with `pgvector`), the NestJS backend, and the Nginx frontend. It uses `.env` for configuration and named volumes for data persistence.
- **Cloud Platforms**:
  - **Fly.io**: The primary production host for the backend, configured via `fly.toml`. It uses rolling deployments, automatic HTTPS, and machine-based scaling (shared-cpu-1x).
  - **Railway**: An alternative deployment target configured via `railway.json`, focusing on Dockerfile-based builds and health-check-driven restarts.

### Developer Rules
- **Secrets Management**: Never commit secrets. Use `fly secrets set` or local `.env` files (gitignored). 
- **Dependency Pinning**: `package-lock.json` is used across all modules to ensure deterministic builds.
- **Image Hardening**: Production images must use non-root users and minimal base images (Alpine/unprivileged Nginx).
- **Signal Handling**: Backend containers must use an init process (like `dumb-init`) to ensure graceful shutdowns of LLM streams and database connections.