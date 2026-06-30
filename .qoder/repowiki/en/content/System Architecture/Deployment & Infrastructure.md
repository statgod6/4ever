# Deployment & Infrastructure

<cite>
**Referenced Files in This Document**
- [backend/Dockerfile](file://backend/Dockerfile)
- [frontend/Dockerfile](file://frontend/Dockerfile)
- [docker-compose.yml](file://docker-compose.yml)
- [docker-compose.override.yml](file://docker-compose.override.yml)
- [backend/fly.toml](file://backend/fly.toml)
- [backend/railway.json](file://backend/railway.json)
- [backend/package.json](file://backend/package.json)
- [frontend/package.json](file://frontend/package.json)
- [backend/src/health/health.controller.ts](file://backend/src/health/health.controller.ts)
- [backend/src/sentry.ts](file://backend/src/sentry.ts)
- [backend/src/main.ts](file://backend/src/main.ts)
- [backend/src/app.module.ts](file://backend/src/app.module.ts)
- [backend/prisma/schema.prisma](file://backend/prisma/schema.prisma)
- [backend/check-db.sql](file://backend/check-db.sql)
- [scripts/scan-secrets.js](file://scripts/scan-secrets.js)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)
10. [Appendices](#appendices)

## Introduction
This document provides comprehensive deployment and infrastructure guidance for the 4Ever application. It covers containerization with Docker multi-stage builds, orchestration via docker-compose for local development and multi-container deployment, cloud platform configurations for Fly.io and Railway, database provisioning with PostgreSQL and pgvector, monitoring and logging with Sentry and Pino, health checks, security hardening, environment variable management, scaling strategies, and operational procedures including rollouts and rollbacks.

## Project Structure
The repository is organized into three primary areas:
- backend: NestJS API with Prisma ORM, Dockerfile, docker-compose orchestration, platform deployment configs (Fly.io, Railway), health endpoints, Sentry initialization, and Pino logging configuration.
- frontend: React SPA built with Vite and served by nginx in a multi-stage Dockerfile; includes a reverse proxy to the backend.
- scripts: Pre-push secret scanning tool to prevent committing sensitive values.

```mermaid
graph TB
subgraph "Local Dev"
DC["docker-compose.yml"]
DCOverride["docker-compose.override.yml"]
end
subgraph "Backend"
BDF["backend/Dockerfile"]
BMain["backend/src/main.ts"]
BHealth["backend/src/health/health.controller.ts"]
BSentry["backend/src/sentry.ts"]
BApp["backend/src/app.module.ts"]
BPrisma["backend/prisma/schema.prisma"]
end
subgraph "Frontend"
FDF["frontend/Dockerfile"]
end
subgraph "Cloud"
Fly["backend/fly.toml"]
Rail["backend/railway.json"]
end
DC --> BDF
DC --> FDF
DCOverride --> BDF
DC --> BMain
DC --> BHealth
DC --> BSentry
DC --> BApp
DC --> BPrisma
Fly --> BDF
Rail --> BDF
```

**Diagram sources**
- [docker-compose.yml:1-68](file://docker-compose.yml#L1-L68)
- [docker-compose.override.yml:1-33](file://docker-compose.override.yml#L1-L33)
- [backend/Dockerfile:1-83](file://backend/Dockerfile#L1-L83)
- [frontend/Dockerfile:1-63](file://frontend/Dockerfile#L1-L63)
- [backend/src/main.ts:1-143](file://backend/src/main.ts#L1-L143)
- [backend/src/health/health.controller.ts:1-121](file://backend/src/health/health.controller.ts#L1-L121)
- [backend/src/sentry.ts:1-57](file://backend/src/sentry.ts#L1-L57)
- [backend/src/app.module.ts:1-172](file://backend/src/app.module.ts#L1-L172)
- [backend/prisma/schema.prisma:1-10](file://backend/prisma/schema.prisma#L1-L10)
- [backend/fly.toml:1-70](file://backend/fly.toml#L1-L70)
- [backend/railway.json:1-15](file://backend/railway.json#L1-L15)

**Section sources**
- [docker-compose.yml:1-68](file://docker-compose.yml#L1-L68)
- [docker-compose.override.yml:1-33](file://docker-compose.override.yml#L1-L33)
- [backend/Dockerfile:1-83](file://backend/Dockerfile#L1-L83)
- [frontend/Dockerfile:1-63](file://frontend/Dockerfile#L1-L63)

## Core Components
- Containerization
  - Backend multi-stage Dockerfile produces a hardened runtime image with non-root user, minimal dependencies, and health checks.
  - Frontend multi-stage Dockerfile compiles a static bundle and serves it via nginx with reverse proxy to the backend.
- Orchestration
  - docker-compose defines services for Postgres with pgvector, backend, and frontend, including environment variables, health checks, and persistent volumes.
  - docker-compose.override enables development features like hot reload and development environment.
- Cloud Deployment
  - Fly.io configuration specifies VM sizing, health checks, rolling deploys, and secrets management.
  - Railway configuration defines Docker build, health checks, and restart policies.
- Database
  - Prisma schema configures PostgreSQL with the vector extension for embeddings; migrations are applied during deploy.
- Monitoring and Logging
  - Sentry initialization with redaction and sampling; Pino structured logging with redaction and correlation IDs.
  - Health endpoints (/api/livez, /api/readyz, /api/health) for liveness and readiness probes.
- Security and Secrets
  - Environment hardening enforced by requiring secrets at startup; pre-push secret scanning script.
  - CORS origins enforced in production; Helmet security headers; upload serving disabled in production.

**Section sources**
- [backend/Dockerfile:1-83](file://backend/Dockerfile#L1-L83)
- [frontend/Dockerfile:1-63](file://frontend/Dockerfile#L1-L63)
- [docker-compose.yml:1-68](file://docker-compose.yml#L1-L68)
- [docker-compose.override.yml:1-33](file://docker-compose.override.yml#L1-L33)
- [backend/fly.toml:1-70](file://backend/fly.toml#L1-L70)
- [backend/railway.json:1-15](file://backend/railway.json#L1-L15)
- [backend/prisma/schema.prisma:1-10](file://backend/prisma/schema.prisma#L1-L10)
- [backend/src/sentry.ts:1-57](file://backend/src/sentry.ts#L1-L57)
- [backend/src/app.module.ts:48-124](file://backend/src/app.module.ts#L48-L124)
- [backend/src/health/health.controller.ts:14-121](file://backend/src/health/health.controller.ts#L14-L121)
- [scripts/scan-secrets.js:1-132](file://scripts/scan-secrets.js#L1-L132)

## Architecture Overview
The deployment architecture supports local development and cloud production with clear separation of concerns:
- Local development uses docker-compose to spin up Postgres with pgvector, the backend API, and the frontend with reverse proxy.
- Cloud platforms (Fly.io, Railway) run the backend containerized with health checks and rolling deploys.
- Database migrations are executed at deploy time; uploads are configured for persistence or migration to object storage in production.

```mermaid
graph TB
Client["Browser / Mobile App"] --> FE["Nginx Frontend<br/>Reverse Proxy /api -> backend"]
FE --> BE["NestJS Backend"]
BE --> DB["PostgreSQL + pgvector"]
BE --> Sentry["Sentry Error Tracking"]
BE --> Pino["Pino Structured Logs"]
subgraph "Orchestrators"
DC["docker-compose"]
Fly["Fly.io"]
Rail["Railway"]
end
DC --> FE
DC --> BE
Fly --> BE
Rail --> BE
```

**Diagram sources**
- [docker-compose.yml:1-68](file://docker-compose.yml#L1-L68)
- [frontend/Dockerfile:23-56](file://frontend/Dockerfile#L23-L56)
- [backend/src/main.ts:37-94](file://backend/src/main.ts#L37-L94)
- [backend/src/sentry.ts:14-50](file://backend/src/sentry.ts#L14-L50)
- [backend/src/app.module.ts:48-124](file://backend/src/app.module.ts#L48-L124)
- [backend/fly.toml:32-54](file://backend/fly.toml#L32-L54)
- [backend/railway.json:7-14](file://backend/railway.json#L7-L14)

## Detailed Component Analysis

### Backend Containerization Strategy
The backend Dockerfile implements a hardened multi-stage build:
- deps stage installs all dependencies (including dev) to optimize caching.
- build stage generates Prisma client and compiles TypeScript to dist.
- runtime stage produces a minimal image with production-only dependencies, non-root user, dumb-init for signal handling, health checks, and exposed port.

```mermaid
flowchart TD
A["deps: node:20.17.0-alpine"] --> B["build: generate Prisma client + nest build"]
B --> C["runtime: npm ci --omit=dev + copy dist + set user + healthcheck"]
C --> D["ENTRYPOINT dumb-init + CMD node dist/main.js"]
```

**Diagram sources**
- [backend/Dockerfile:22-83](file://backend/Dockerfile#L22-L83)

**Section sources**
- [backend/Dockerfile:1-83](file://backend/Dockerfile#L1-L83)

### Frontend Containerization Strategy
The frontend Dockerfile:
- builder stage compiles the Vite bundle.
- runtime stage serves the bundle via nginxinc/nginx-unprivileged with security headers and a reverse proxy to the backend’s /api path.
- Health check probes the root path.

```mermaid
flowchart TD
F1["builder: node:20.17.0-alpine + npm run build"] --> F2["runtime: nginx-unprivileged + reverse proxy /api -> backend:3001"]
F2 --> F3["HEALTHCHECK on :8080"]
```

**Diagram sources**
- [frontend/Dockerfile:6-63](file://frontend/Dockerfile#L6-L63)

**Section sources**
- [frontend/Dockerfile:1-63](file://frontend/Dockerfile#L1-L63)

### Orchestration with docker-compose
docker-compose defines:
- postgres service with pgvector image, environment variables, health check, and persistent volume.
- backend service with environment variables (including JWT_SECRET requirement), dependency on postgres, uploads volume, and port mapping.
- frontend service with reverse proxy to backend and port mapping.
- docker-compose.override enables development mode with hot reload and development environment.

```mermaid
sequenceDiagram
participant User as "Developer"
participant Compose as "docker-compose"
participant Postgres as "postgres : ankane/pgvector"
participant Backend as "backend : 3001"
participant Frontend as "frontend : 8080"
User->>Compose : docker compose up
Compose->>Postgres : start service
Compose->>Backend : start service (depends on postgres healthy)
Compose->>Frontend : start service (depends on backend)
Frontend->>Backend : proxy /api requests
```

**Diagram sources**
- [docker-compose.yml:1-68](file://docker-compose.yml#L1-L68)
- [docker-compose.override.yml:19-33](file://docker-compose.override.yml#L19-L33)

**Section sources**
- [docker-compose.yml:1-68](file://docker-compose.yml#L1-L68)
- [docker-compose.override.yml:1-33](file://docker-compose.override.yml#L1-L33)

### Cloud Deployment: Fly.io
Fly.io configuration:
- App name, primary region, Dockerfile path, environment variables (NODE_ENV, PORT, LOG_LEVEL).
- HTTP service with forced HTTPS, auto-stop/start, minimum machines running, and rolling strategy.
- Health checks mapped to /api/livez and /api/readyz.
- VM sizing guidance and notes on scaling and Redis for rate limiting.

```mermaid
flowchart TD
Dev["Developer"] --> Launch["fly launch --no-deploy"]
Launch --> Secrets["fly secrets set ..."]
Secrets --> Deploy["fly deploy"]
Deploy --> Migrate["release_command: prisma migrate deploy"]
Migrate --> Serve["Serve traffic with rolling updates"]
```

**Diagram sources**
- [backend/fly.toml:1-70](file://backend/fly.toml#L1-L70)

**Section sources**
- [backend/fly.toml:1-70](file://backend/fly.toml#L1-L70)

### Cloud Deployment: Railway
Railway configuration:
- Dockerfile build specification.
- Start command runs Prisma migrations then starts the server.
- Health check path and restart policy.

```mermaid
flowchart TD
Push["Git push"] --> Build["Railway build Dockerfile"]
Build --> ReleaseCmd["StartCommand: prisma migrate deploy && node dist/main.js"]
ReleaseCmd --> Health["Health check on /api/livez"]
Health --> Run["Run instances"]
```

**Diagram sources**
- [backend/railway.json:1-15](file://backend/railway.json#L1-L15)

**Section sources**
- [backend/railway.json:1-15](file://backend/railway.json#L1-L15)

### Database Provisioning and Schema
Prisma schema:
- PostgreSQL datasource with vector extension for embeddings.
- Models define entities and relationships; vector columns are handled via raw SQL in migrations.
- Migration commands are available in package.json for development and production.

```mermaid
erDiagram
USER {
string id PK
string phone_number
string apple_user_id
string email
string name
string avatar_url
datetime created_at
datetime updated_at
}
THOUGHT {
string id PK
string user_id FK
string title
string raw_text
string thought_type
string status
datetime created_at
datetime updated_at
}
MEMORY {
string id PK
string user_id FK
string memory_type
string content
float importance_score
string source_thread_id
datetime last_accessed_at
int access_count
string status
string superseded_by_id
string category
string source
datetime created_at
datetime updated_at
}
THOUGHT ||--o{ THOUGHT_THREAD : "has"
USER ||--o{ THOUGHT : "writes"
USER ||--o{ MEMORY : "owns"
```

**Diagram sources**
- [backend/prisma/schema.prisma:12-74](file://backend/prisma/schema.prisma#L12-L74)
- [backend/prisma/schema.prisma:76-91](file://backend/prisma/schema.prisma#L76-L91)
- [backend/prisma/schema.prisma:170-191](file://backend/prisma/schema.prisma#L170-L191)

**Section sources**
- [backend/prisma/schema.prisma:1-10](file://backend/prisma/schema.prisma#L1-L10)
- [backend/check-db.sql:1-8](file://backend/check-db.sql#L1-L8)
- [backend/package.json:21-25](file://backend/package.json#L21-L25)

### Monitoring and Logging Setup
- Sentry
  - Initialized early in main.ts; configured with environment, release, sampling, and beforeSend redaction for sensitive fields.
  - Global exception filter forwards unhandled errors to Sentry.
- Pino
  - Structured logging via LoggerModule.forRoot with redaction, correlation IDs, and lean serializers.
  - Auto-logging excludes health endpoints to reduce noise.
- Health Checks
  - /api/livez for liveness, /api/readyz for readiness, and legacy /api/health retained for compatibility.

```mermaid
sequenceDiagram
participant Client as "Client"
participant Backend as "NestJS Backend"
participant Pino as "Pino Logger"
participant Sentry as "Sentry"
Client->>Backend : Request
Backend->>Pino : Log request (redacted)
Backend-->>Client : Response
Note over Backend,Sentry : Unhandled errors captured and sent to Sentry
```

**Diagram sources**
- [backend/src/main.ts:16-94](file://backend/src/main.ts#L16-L94)
- [backend/src/sentry.ts:14-50](file://backend/src/sentry.ts#L14-L50)
- [backend/src/app.module.ts:48-124](file://backend/src/app.module.ts#L48-L124)
- [backend/src/health/health.controller.ts:27-106](file://backend/src/health/health.controller.ts#L27-L106)

**Section sources**
- [backend/src/main.ts:1-143](file://backend/src/main.ts#L1-L143)
- [backend/src/sentry.ts:1-57](file://backend/src/sentry.ts#L1-L57)
- [backend/src/app.module.ts:48-124](file://backend/src/app.module.ts#L48-L124)
- [backend/src/health/health.controller.ts:1-121](file://backend/src/health/health.controller.ts#L1-L121)

### Security Considerations
- SSL/TLS and Headers
  - Fly.io forces HTTPS for the HTTP service.
  - Helmet sets security headers; CSP is configured in report-only mode initially.
- Environment Hardening
  - JWT_SECRET is required and must not be empty; backend fails to start if missing.
  - CORS_ORIGINS must be set in production; otherwise the app throws an error.
  - Uploads are served locally only in non-production environments.
- Secrets Management
  - fly secrets set is used to manage environment variables.
  - Pre-push secret scanner scans for high-confidence secret patterns and exits non-zero on findings.

```mermaid
flowchart TD
Start(["Startup"]) --> CheckSecrets["Check required env vars (JWT_SECRET, DB URL, etc.)"]
CheckSecrets --> SecretsOK{"All present?"}
SecretsOK --> |No| Fail["Fail fast: exit non-zero"]
SecretsOK --> |Yes| Init["Initialize Sentry + Pino + Guards"]
Init --> Serve["Listen on PORT with security headers"]
```

**Diagram sources**
- [backend/src/main.ts:68-75](file://backend/src/main.ts#L68-L75)
- [backend/src/main.ts:20-22](file://backend/src/main.ts#L20-L22)
- [backend/Dockerfile:29-40](file://backend/Dockerfile#L29-L40)
- [scripts/scan-secrets.js:24-39](file://scripts/scan-secrets.js#L24-L39)

**Section sources**
- [backend/src/main.ts:68-75](file://backend/src/main.ts#L68-L75)
- [backend/Dockerfile:29-40](file://backend/Dockerfile#L29-L40)
- [scripts/scan-secrets.js:1-132](file://scripts/scan-secrets.js#L1-L132)

### Environment Variable Management
- docker-compose
  - Required: DATABASE_URL, JWT_SECRET (fails if empty).
  - Optional: OPENROUTER_API_KEY, TWILIO_* credentials, TAVILY_API_KEY, E2B_API_KEY, ADMIN_SECRET, CORS_ORIGINS, TTS_MODEL.
- fly.toml
  - Sets NODE_ENV, PORT, LOG_LEVEL, CORS_ORIGINS via secrets, and forces HTTPS.
- railway.json
  - Uses environment variables via secrets and health checks.

**Section sources**
- [docker-compose.yml:24-40](file://docker-compose.yml#L24-L40)
- [backend/fly.toml:26-30](file://backend/fly.toml#L26-L30)
- [backend/railway.json:1-15](file://backend/railway.json#L1-L15)

### Scaling Strategies
- Fly.io guidance:
  - Start with 1 shared-cpu-1x VM; scale horizontally as LLM streaming is I/O bound.
  - Add Redis for shared rate-limit state when running multiple machines.
- Railway:
  - Restart policy set to ON_FAILURE with retries; health checks ensure availability.

**Section sources**
- [backend/fly.toml:61-69](file://backend/fly.toml#L61-L69)
- [backend/railway.json:10-13](file://backend/railway.json#L10-L13)

### Deployment Workflows and Rollback Procedures
- Local Development
  - Use docker-compose with or without docker-compose.override for hot reload.
- Production Deployment
  - Fly.io: fly launch, fly secrets set, fly deploy; release_command runs Prisma migrations.
  - Railway: Git push triggers build; start command runs migrations then server.
- Rollback
  - Fly.io: redeploy previous release image/tag; adjust min_machines_running as needed.
  - Railway: redeploy previous commit or use rollback feature if available.

**Section sources**
- [docker-compose.yml:1-68](file://docker-compose.yml#L1-L68)
- [docker-compose.override.yml:1-33](file://docker-compose.override.yml#L1-L33)
- [backend/fly.toml:67-70](file://backend/fly.toml#L67-L70)
- [backend/railway.json:7-14](file://backend/railway.json#L7-L14)

### Infrastructure Maintenance Practices
- Database Maintenance
  - Use Prisma migrate commands for schema changes; verify with check-db.sql queries.
- Logging and Observability
  - Pino redacts sensitive fields; Sentry captures exceptions with beforeSend redaction.
- Security Audits
  - Run scripts/scan-secrets.js locally before pushing to detect potential leaks.

**Section sources**
- [backend/check-db.sql:1-8](file://backend/check-db.sql#L1-L8)
- [backend/src/sentry.ts:27-48](file://backend/src/sentry.ts#L27-L48)
- [scripts/scan-secrets.js:68-95](file://scripts/scan-secrets.js#L68-L95)

## Dependency Analysis
The backend module composition integrates logging, scheduling, throttling, Prisma, and feature modules. Health endpoints are provided by HealthModule.

```mermaid
graph LR
App["AppModule"] --> Logger["LoggerModule (Pino)"]
App --> Schedule["ScheduleModule"]
App --> Throttler["ThrottlerModule"]
App --> Prisma["PrismaModule"]
App --> Health["HealthModule"]
App --> Features["Feature Modules (Auth, Users, etc.)"]
```

**Diagram sources**
- [backend/src/app.module.ts:34-172](file://backend/src/app.module.ts#L34-L172)
- [backend/src/health/health.controller.ts:14-121](file://backend/src/health/health.controller.ts#L14-L121)

**Section sources**
- [backend/src/app.module.ts:1-172](file://backend/src/app.module.ts#L1-L172)
- [backend/src/health/health.controller.ts:1-121](file://backend/src/health/health.controller.ts#L1-L121)

## Performance Considerations
- Container Images
  - Runtime image uses npm ci --omit=dev to minimize size and attack surface.
  - dumb-init ensures graceful shutdown for streaming endpoints.
- Logging
  - Pino structured logging reduces overhead; autoLogging excludes health endpoints.
- Database
  - Prisma client is generated in the build stage; migrations run at deploy time.
- CDN and Assets
  - Frontend nginx serves static assets efficiently; reverse proxy preserves streaming.

**Section sources**
- [backend/Dockerfile:49-82](file://backend/Dockerfile#L49-L82)
- [frontend/Dockerfile:59-63](file://frontend/Dockerfile#L59-L63)
- [backend/src/app.module.ts:117-123](file://backend/src/app.module.ts#L117-L123)

## Troubleshooting Guide
- Health Probes
  - Verify /api/livez and /api/readyz endpoints; readiness probe checks database connectivity and required environment variables.
- Database Connectivity
  - Ensure DATABASE_URL points to a Postgres instance with pgvector enabled; confirm migrations have been applied.
- CORS Issues
  - In production, set CORS_ORIGINS explicitly; otherwise the app throws an error.
- Sentry
  - If SENTRY_DSN is unset, Sentry.init is a no-op; otherwise ensure beforeSend redaction is effective.
- Secret Exposure
  - Run scripts/scan-secrets.js to detect high-confidence patterns; rotate credentials and remove from history if needed.

**Section sources**
- [backend/src/health/health.controller.ts:52-106](file://backend/src/health/health.controller.ts#L52-L106)
- [backend/src/main.ts:68-75](file://backend/src/main.ts#L68-L75)
- [backend/src/sentry.ts:14-50](file://backend/src/sentry.ts#L14-L50)
- [scripts/scan-secrets.js:97-132](file://scripts/scan-secrets.js#L97-L132)

## Conclusion
The 4Ever application employs robust containerization, orchestrated local development, and production-grade cloud deployments on Fly.io and Railway. Its database leverages PostgreSQL with pgvector for embeddings, while monitoring and logging are implemented with Sentry and Pino. Security is enforced through environment hardening, strict CORS controls, and proactive secret scanning. Health checks and structured logging facilitate reliable operations, and the documented workflows support efficient rollouts and maintenance.

## Appendices
- Environment Variables Reference
  - Required: DATABASE_URL, JWT_SECRET
  - Optional: OPENROUTER_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, TAVILY_API_KEY, E2B_API_KEY, ADMIN_SECRET, CORS_ORIGINS, TTS_MODEL
- Health Endpoints
  - /api/livez (liveness), /api/readyz (readiness), /api/health (legacy)

[No sources needed since this section summarizes previously cited information]