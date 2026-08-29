The 4Ever AI Life OS Platform employs a poly-repository-style monorepo structure with distinct build pipelines for its Backend (NestJS), Frontend (React/Vite), and Mobile (Expo/React Native) applications. The build system is characterized by containerized production deployments for web services and cloud-native managed builds for mobile.

### 1. Backend Build & Deployment (NestJS)
- **Compilation**: Uses `nest-cli` to compile TypeScript into JavaScript (`npm run build`).
- **Containerization**: A hardened, multi-stage `Dockerfile` is used:
  - **Stage 1 (deps)**: Installs all dependencies using `npm ci` with cache mounting.
  - **Stage 2 (build)**: Generates the Prisma client and compiles the application.
  - **Stage 3 (runtime)**: Uses `node:20.17.0-alpine` with `dumb-init` for proper signal handling (SIGTERM). It installs only production dependencies (`--omit=dev`) and runs as a non-root user (`node`).
- **Database Migrations**: Integrated into the deployment lifecycle via `npx prisma migrate deploy` as a release command in both Fly.io and Railway configurations.
- **Deployment Targets**:
  - **Fly.io**: Configured via `fly.toml` with rolling deployments, health checks (`/api/livez`, `/api/readyz`), and secret management via `fly secrets`.
  - **Railway**: Configured via `railway.json` with automatic restart policies and health check paths.
  - **Docker Compose**: Used for local development and self-hosted environments, orchestrating PostgreSQL (with `pgvector`), Backend, and Frontend.

### 2. Frontend Build & Deployment (React/Vite)
- **Compilation**: Uses Vite for bundling (`npm run build`), producing static assets in `dist/`.
- **Containerization**: A multi-stage `Dockerfile` serves the static bundle via `nginxinc/nginx-unprivileged:1.27-alpine`.
  - **Nginx Configuration**: Custom `default.conf` handles SPA routing (`try_files $uri /index.html`) and proxies `/api` requests to the backend service.
  - **Security**: Includes security headers like `X-Content-Type-Options` and `X-Frame-Options`.
- **Deployment**: Typically deployed alongside the backend via `docker-compose.yml` or as a standalone static site behind a CDN/Ingress.

### 3. Mobile Build & Deployment (Expo/React Native)
- **Build System**: Relies on **EAS Build** (Expo Application Services) configured via `eas.json`.
- **Build Profiles**:
  - **Development**: On-device debug builds with the Expo dev menu, distributed internally.
  - **Preview**: Staging/QA builds pointing to the staging API, distributed internally.
  - **Production**: Store-ready AAB (Android) and IPA (iOS) builds with auto-incrementing version numbers.
- **Configuration**: `app.json` defines app metadata, permissions (Camera, Contacts, Microphone), and runtime versions. 
- **Submission**: EAS Submit is configured for automated submission to Apple App Store Connect and Google Play Console, though credentials are currently placeholders.

### 4. Dependency Management
- **Strategy**: Each project (backend, frontend, mobile) maintains its own `package.json` and `package-lock.json`, indicating a "loose monorepo" approach rather than a unified workspace (e.g., npm workspaces or pnpm).
- **Versioning**: Root `package.json` exists but appears minimal; actual dependency resolution happens within each sub-project.

### Key Developer Rules
- **Secrets Management**: Never commit secrets. Use `fly secrets set` for production and `.env` files (gitignored) for local development.
- **Database Changes**: Always run `npx prisma migrate dev` locally to generate migrations. In production, migrations are applied automatically during deployment via the release command.
- **Mobile Builds**: Use `eas build --profile [development|preview|production]` to trigger cloud builds. Local builds are discouraged for production artifacts.
- **Docker Hardening**: Backend images must use `dumb-init` and non-root users to ensure graceful shutdowns and security compliance.