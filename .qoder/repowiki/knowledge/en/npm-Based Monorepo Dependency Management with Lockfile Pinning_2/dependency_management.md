## Overview
The 4Ever AI Life OS Platform employs a **multi-project npm strategy** rather than a unified monorepo tool (such as npm workspaces, pnpm, or Lerna). The repository consists of three independent Node.js projects—`backend`, `frontend`, and `mobile`—each maintaining its own `package.json` and `package-lock.json`. A root-level `package.json` exists but is largely orphaned, containing duplicate dependencies that do not reflect the active project structures.

## Package Manager & Versioning Strategy
- **Manager**: npm (Node Package Manager) with **lockfileVersion 3** across all sub-projects.
- **Version Ranges**: 
  - **Backend/Frontend**: Uses caret ranges (`^`) for minor/patch updates (e.g., `"@nestjs/common": "^10.3.0"`).
  - **Mobile**: Uses Expo's tilde-pinned SDK pattern (`~54.0.34`) to ensure strict compatibility with native modules, while some core libraries like `react-native` are pinned to exact versions (`0.81.5`).
- **Deterministic Builds**: Reliance on `package-lock.json` ensures that `npm ci` installs the exact dependency tree recorded during development, preventing "works on my machine" drift in CI/CD pipelines.

## Key Dependency Categories
### Backend (NestJS + LangGraph)
- **Core Framework**: NestJS 10.x (`@nestjs/*`).
- **AI/LLM Orchestration**: LangChain Core 1.x, LangGraph 1.2.x, and OpenRouter integration.
- **Data Layer**: Prisma Client 5.7.1 with pgvector support for semantic search.
- **Real-time Communication**: Socket.IO 4.8.x for WebSocket-based messaging.
- **Security & Auth**: Passport JWT, bcryptjs, helmet, and `@nestjs/throttler`.
- **Observability**: Sentry Node 9.x for error tracking and Pino for structured logging.
- **Document Processing**: Specialized libraries for PDF (`pdf-parse`), Word (`mammoth`, `docx`), Excel (`xlsx`), and PowerPoint (`pptxgenjs`).

### Frontend (React + Vite)
- **Build Tool**: Vite 5.x with React 18.2.x.
- **State Management**: Zustand 4.4.x for lightweight global state.
- **Styling**: Tailwind CSS 3.4.x with PostCSS.
- **Networking**: Axios 1.6.x for REST and socket.io-client 4.8.x for real-time updates.

### Mobile (Expo + React Native)
- **SDK**: Expo SDK 54.x managing the React Native 0.81.5 runtime.
- **Navigation**: React Navigation 7.x (bottom-tabs, native-stack).
- **Native Features**: Expo modules for secure storage, contacts, image picking, and audio.
- **Styling**: NativeWind 4.2.x, enabling Tailwind CSS utility classes in React Native.

## Build & Deployment Integration
### Docker Multi-Stage Builds
Both backend and frontend utilize hardened multi-stage Dockerfiles to optimize for security and build speed:
- **Pinned Base Images**: `node:20.17.0-alpine` is used consistently to avoid floating tag drift.
- **Cache Optimization**: `RUN --mount=type=cache,target=/root/.npm npm ci` leverages Docker BuildKit caching for faster dependency installation.
- **Production Minimization**: Runtime stages use `npm ci --omit=dev` to exclude development dependencies, reducing image size and attack surface.
- **Non-Root Execution**: Containers run as the unprivileged `node` user (uid 1000/1001) with `dumb-init` for proper signal handling.

### Platform-Specific Deployment
- **Backend**: Deployed to **Railway** (via `railway.json`) and **Fly.io** (via `fly.toml`). Both platforms trigger `npx prisma migrate deploy` before starting the application to ensure database schema consistency.
- **Mobile**: Managed via **Expo Application Services (EAS)**. The `eas.json` configuration defines three channels: `development` (on-device debug), `preview` (staging/QA), and `production` (store-ready AAB/IPA with auto-incrementing build numbers).
- **Frontend**: Built into static assets and served via an `nginx-unprivileged` container, configured with security headers and reverse-proxy rules for the backend API.

## Developer Conventions & Risks
- **Installation**: Use `npm ci` in CI/CD and Docker environments; use `npm install` for local development to update the lockfile.
- **Dependency Drift**: Since projects are siloed, shared libraries (e.g., `axios`, `socket.io-client`, `zustand`) may diverge in versions across the backend, frontend, and mobile apps. Developers should manually align these versions when possible.
- **Root Manifest Confusion**: The root `package.json` contains outdated NestJS 11.x dependencies that conflict with the backend's 10.x usage. It should be treated as a legacy artifact and ignored for active development.
- **No Automated Updates**: The repository lacks tools like Dependabot or Renovate, meaning dependency updates and security patches must be managed manually.