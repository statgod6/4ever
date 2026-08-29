## Overview
The 4Ever Cognitive Companion Platform uses **npm** as its primary package manager across three independent projects (backend, frontend, mobile), each maintaining separate `package.json` and `package-lock.json` files. There is no workspace orchestration tool (e.g., npm workspaces, Lerna, Nx, or pnpm) — each project manages dependencies independently.

## Package Manager & Version Strategy

### npm with Lockfile v3
- All three projects use **npm** with **lockfileVersion 3**, which supports modern dependency resolution and cross-platform compatibility.
- Each project maintains its own `package-lock.json` for deterministic builds:
  - `backend/package-lock.json` (~12,621 lines)
  - `frontend/package-lock.json` (~4,588 lines)
  - `mobile/package-lock.json` (~11,530 lines)
  - Root `package-lock.json` (~5,929 lines) — appears to be an orphaned or legacy artifact.

### Version Pinning Approach
Dependencies use **caret ranges** (`^`) for minor/patch updates rather than exact pinning:
- Backend: `"@nestjs/common": "^10.3.0"`, `"@prisma/client": "^5.7.1"`
- Frontend: `"react": "^18.2.0"`, `"axios": "^1.6.2"`
- Mobile: `"expo": "~54.0.34"` (tilde for patch-only), `"react-native": "0.81.5"` (exact)

The mobile project uses Expo's tilde-pinned SDK versioning pattern (`~54.0.34`) to ensure compatible native module versions.

## Key Dependency Categories

### Backend (NestJS + LangGraph)
- **Framework**: NestJS 10.x (`@nestjs/*` packages)
- **AI/LLM**: LangChain Core 1.x, LangGraph 1.2.x, OpenRouter integration
- **Database**: Prisma Client 5.7.1 with pgvector support
- **Real-time**: Socket.IO 4.8.x
- **Security**: Passport JWT, bcryptjs, helmet, throttler
- **Observability**: Sentry Node 9.x, Pino logging
- **Document Processing**: pdf-parse, mammoth, docx, xlsx, pptxgenjs
- **Code Execution**: @e2b/code-interpreter for sandboxed Python execution

### Frontend (React + Vite)
- **Framework**: React 18.2.x with Vite 5.x bundler
- **State Management**: Zustand 4.4.x
- **Routing**: React Router DOM 6.21.x
- **Styling**: Tailwind CSS 3.4.x with PostCSS
- **HTTP/WebSocket**: Axios 1.6.x, socket.io-client 4.8.x
- **UI Components**: Lucide React icons, react-markdown

### Mobile (Expo + React Native)
- **Framework**: Expo SDK 54.x with React Native 0.81.5
- **Navigation**: React Navigation 7.x (bottom-tabs, native-stack)
- **State Management**: Zustand 5.0.x
- **Native Modules**: expo-secure-store, expo-contacts, expo-image-picker, expo-audio
- **Styling**: NativeWind 4.2.x (Tailwind for React Native)
- **UI**: React Native Reanimated 4.1.x, gesture-handler 2.28.x

## Build & Deployment Integration

### Docker Multi-Stage Builds
Both backend and frontend use hardened multi-stage Dockerfiles with explicit dependency installation strategies:

**Backend Dockerfile:**
```dockerfile
# deps stage: full install with npm cache mount
RUN --mount=type=cache,target=/root/.npm npm ci

# runtime stage: production-only deps
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev
```

**Frontend Dockerfile:**
```dockerfile
FROM node:20.17.0-alpine AS builder
RUN --mount=type=cache,target=/root/.npm npm ci
```

Key practices:
- **Pinned base image**: `node:20.17.0-alpine` (not floating tags)
- **npm ci** instead of `npm install` for CI/CD reproducibility
- **Build cache mounts** for faster subsequent builds
- **Production-only installs** in runtime stages (`--omit=dev`)
- Non-root user execution (uid 1000/1001)

### Deployment Platforms
- **Backend**: Railway (via `railway.json`) and Fly.io (via `fly.toml`)
- **Mobile**: Expo Application Services (EAS) with channel-based builds (development, preview, production)
- **Frontend**: Self-hosted nginx container or static hosting

## Notable Absences

1. **No `.npmrc` configuration**: No custom registry, no private package setup, no engine-strict enforcement
2. **No monorepo tooling**: Projects are siloed; shared dependencies (e.g., axios, socket.io-client, zustand) are duplicated across projects
3. **No automated dependency updates**: No Dependabot, Renovate, or similar tooling detected
4. **No vulnerability scanning**: No `npm audit` scripts or SCA tooling in CI
5. **Root package.json is orphaned**: Contains duplicate NestJS dependencies at different major versions (11.x vs backend's 10.x), suggesting incomplete refactoring

## Developer Conventions

### Installation Commands
- Use `npm ci` in CI/CD and Docker builds (respects lockfile exactly)
- Use `npm install` for local development (allows safe updates within semver ranges)

### Version Management
- Backend NestJS packages should stay aligned at same major version (^10.3.0)
- Mobile Expo SDK version dictates compatible React Native and native module versions
- Prisma client and CLI versions must match (`^5.7.1` in backend)

### Adding Dependencies
- Install in the specific project directory (`cd backend && npm install <pkg>`)
- Commit both `package.json` and `package-lock.json` changes together
- Verify Docker builds still succeed after dependency changes

### Known Risks
- **Dependency drift**: Three separate lockfiles mean shared libraries (axios, socket.io-client) may diverge in versions
- **Root package.json confusion**: The root-level manifest contains outdated/duplicate dependencies that could mislead developers
- **No peer dependency enforcement**: Missing `.npmrc` with `engine-strict=true` means Node.js version mismatches won't fail fast