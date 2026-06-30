The 4Ever AI Life OS Platform employs a polyglot, container-centric build system designed for independent scaling and deployment of its backend, web frontend, and mobile clients. The architecture leverages Docker for server-side consistency, Expo Application Services (EAS) for mobile distribution, and platform-specific Infrastructure-as-Code (IaC) for cloud orchestration.

### 1. Backend Build & Runtime (NestJS)
- **Compilation**: Uses `nest build` to transpile TypeScript into optimized JavaScript. The build process is tightly coupled with Prisma ORM, requiring `prisma generate` to create type-safe database clients before compilation.
- **Containerization**: Implements a hardened multi-stage Dockerfile using `node:20.17.0-alpine`. 
  - **Stage 1 (deps)**: Installs all dependencies with cache mounting.
  - **Stage 2 (build)**: Generates Prisma clients and compiles the application.
  - **Stage 3 (runtime)**: A minimal production image that installs only production dependencies (`npm ci --omit=dev`), runs as a non-root user (`node`), and uses `dumb-init` for proper PID 1 signal handling (graceful shutdowns).
- **Health Checks**: Integrated liveness probes (`/api/livez`) using Node's native `fetch` to avoid extra binary dependencies in the Alpine image.

### 2. Frontend Build & Serving (React/Vite)
- **Compilation**: Utilizes Vite for fast development and optimized production builds (`tsc && vite build`).
- **Containerization**: A two-stage Docker pipeline where the first stage builds the static assets, and the second stage serves them via `nginxinc/nginx-unprivileged`. This ensures the web server runs without root privileges and listens on port 8080.
- **Reverse Proxy**: The Nginx configuration includes a reverse proxy for `/api` requests to the backend service, handling WebSocket upgrades for real-time features and setting security headers (HSTS, X-Frame-Options).

### 3. Mobile Distribution (Expo/EAS)
- **Build Pipeline**: Relies on Expo Application Services (EAS) for cross-platform builds. The `eas.json` configuration defines three distinct profiles:
  - **Development**: On-device debug builds with the Expo dev menu.
  - **Preview**: Staging/QA builds pointing to the staging API, distributed internally.
  - **Production**: Store-ready artifacts (AAB for Android, IPA for iOS) with auto-incrementing build numbers and remote versioning.
- **Environment Management**: API endpoints are injected at build time via `EXPO_PUBLIC_API_URL`, allowing different builds to target local, staging, or production backends.

### 4. Orchestration & Deployment
- **Local Development**: `docker-compose.yml` orchestrates the PostgreSQL (with `pgvector`), backend, and frontend services. It uses an override file for hot-reload bind mounts during development.
- **Cloud Deployment**:
  - **Fly.io**: The backend uses `fly.toml` for region-specific deployment (Singapore), automated machine scaling, and rolling updates. Database migrations are executed as a `release_command` (`npx prisma migrate deploy`) before new instances go live.
  - **Railway**: A `railway.json` provides an alternative deployment path, defining Docker-based builds and health-check-driven restart policies.
- **Secrets Management**: Secrets are strictly excluded from version control. Fly.io deployments use `fly secrets set`, while local development relies on `.env` files managed via `.env.example` templates.

### 5. Testing & Quality Assurance
- **Backend**: Jest is configured for unit testing with `ts-jest` and isolated modules for performance. End-to-end tests are supported via a separate Jest configuration.
- **Load Testing**: A basic smoke test suite exists in `tests/loadtest/smoke.js` to validate endpoint responsiveness under load.