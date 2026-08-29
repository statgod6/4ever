## Overview

The Memory Operating System (4Ever) uses an **npm-based monorepo architecture** with separate `package.json` and `package-lock.json` files for each platform component (backend, frontend, mobile) plus a root-level package manifest. The project relies on npm's lockfile v3 format for deterministic dependency resolution across all environments.

## Architecture

### Monorepo Structure (Non-Workspaces)

The repository is organized as a **loose monorepo** without npm workspaces or Lerna/Pnpm/Yarn workspace tooling:

- **Root**: Contains shared NestJS dependencies (likely unused or legacy), TypeScript, Prisma CLI
- **backend/**: NestJS API server with full dependency tree (~12,981 locked packages)
- **frontend/**: React + Vite SPA (~minimal dependency footprint)
- **mobile/**: Expo/React Native app with native module dependencies

Each subproject maintains **independent `node_modules/` directories** and **separate lockfiles**, meaning:
- No shared dependency hoisting across projects
- Each project resolves its own transitive dependencies independently
- Potential for version drift between projects using the same library (e.g., `socket.io-client` appears in all three)

### Lockfile Strategy

All three subprojects use **lockfileVersion 3** (npm v7+ format):
- Root: `package-lock.json` (5,929 lines)
- Backend: `package-lock.json` (12,981 lines)
- Frontend: `package-lock.json`
- Mobile: `package-lock.json`

Lockfiles pin exact versions via `resolved` URLs pointing to the public npm registry (`https://registry.npmjs.org/`), ensuring reproducible builds.

## Key Files

| File | Purpose |
|------|---------|
| `package.json` (root) | Top-level metadata; contains duplicate NestJS deps (likely stale) |
| `backend/package.json` | Primary backend dependencies: NestJS v10, Prisma v5, LangChain/LangGraph, Sentry, Socket.IO |
| `frontend/package.json` | Frontend stack: React 18, Vite 5, Tailwind 3, Zustand 4 |
| `mobile/package.json` | Mobile stack: Expo ~54, React Native 0.81, React Navigation 7, nativewind |
| `backend/package-lock.json` | Largest lockfile; pins all backend transitive dependencies |
| `frontend/package-lock.json` | Pins frontend dependency tree |
| `mobile/package-lock.json` | Pins mobile/native dependency tree |

## Version Constraints

Dependencies use **caret (^) and tilde (~) ranges**:

- **Backend**: `@nestjs/common: ^10.3.0`, `@prisma/client: ^5.7.1`, `@sentry/node: ^9.47.1`
- **Frontend**: `react: ^18.2.0`, `vite: ^5.0.8`, `zustand: ^4.4.7`
- **Mobile**: `expo: ~54.0.34` (tilde for patch-only updates), `react-native: 0.81.5` (exact pin)

The mobile project uses **tighter constraints** for Expo SDK compatibility (`~54.0.34`) and exact pins for React Native core (`0.81.5`), reflecting Expo's strict version requirements.

## Dependency Categories

### Backend Core Dependencies
- **Framework**: NestJS v10 ecosystem (`@nestjs/*`)
- **Database**: Prisma ORM v5 (`@prisma/client`, `prisma`)
- **AI/LLM**: LangChain Core v1, LangGraph v1, OpenRouter integration
- **Observability**: Sentry v9, Pino logging (`nestjs-pino`, `pino`, `pino-http`)
- **Real-time**: Socket.IO v4 (`@nestjs/platform-socket.io`, `socket.io`)
- **Security**: Helmet v8, bcryptjs, passport/JWT strategies
- **Document Processing**: pdf-parse, mammoth, docx, xlsx, pptxgenjs
- **External Services**: AWS SNS SDK, Twilio, Tavily search

### Frontend Core Dependencies
- **Framework**: React 18, React DOM
- **Build Tool**: Vite 5 with `@vitejs/plugin-react`
- **Styling**: Tailwind CSS 3, tailwind-merge, clsx
- **State Management**: Zustand 4
- **HTTP/WebSocket**: Axios 1.6, socket.io-client 4.8
- **Routing**: React Router DOM 6.21
- **Markdown**: react-markdown 10, remark-gfm 4

### Mobile Core Dependencies
- **Framework**: Expo SDK ~54, React Native 0.81
- **Navigation**: React Navigation 7 (bottom-tabs, native-stack)
- **Styling**: nativewind 4, Tailwind CSS 3
- **State Management**: Zustand 5 (newer than frontend)
- **Expo Modules**: async-storage, secure-store, contacts, image-picker, document-picker, audio, linear-gradient, etc.
- **UI Components**: @expo/vector-icons, react-native-svg, react-native-reanimated

## Notable Patterns

### Shared Dependencies Across Projects
Several libraries appear in multiple projects but may resolve to different versions:
- `socket.io-client`: v4.8.3 in all three projects (consistent)
- `axios`: v1.6.2 (frontend) vs v1.15.2 (mobile) — **version drift detected**
- `zustand`: v4.4.7 (frontend) vs v5.0.12 (mobile) — **major version difference**
- `typescript`: v5.2.2 (frontend), v5.3.3 (backend), ~5.9.2 (mobile) — **version drift**
- `tailwindcss`: v3.4.0 (frontend) vs v3.4.19 (mobile)

### No Private Registry Configuration
All dependencies resolve from the **public npm registry** (`registry.npmjs.org`). No evidence of:
- `.npmrc` files configuring private registries
- `GOPRIVATE`-equivalent npm configuration
- Scoped package overrides for internal packages
- Verdaccio or Artifactory integration

### No Dependency Update Automation
No evidence of automated dependency update tools:
- No Renovate configuration (`renovate.json`)
- No Dependabot configuration (`.github/dependabot.yml`)
- No npm-check-updates scripts in package.json

Manual updates are performed via standard npm commands (`npm install <pkg>@latest`).

## Developer Rules

### Installation Workflow
```bash
# Install dependencies per-project (not from root)
cd backend && npm install
cd ../frontend && npm install
cd ../mobile && npm install
```

### Adding New Dependencies
```bash
# Always run from the specific project directory
cd backend
npm install <package>          # production dependency
npm install -D <package>       # dev dependency
```

### Lockfile Discipline
- **Commit all `package-lock.json` files** to version control
- Never manually edit lockfiles
- Run `npm install` (not `npm update`) to respect existing lockfile pins
- Use `npm audit` periodically to check for security vulnerabilities

### Version Constraint Guidelines
- Use `^` for most dependencies (allows minor/patch updates)
- Use `~` for frameworks with strict compatibility requirements (Expo SDK)
- Use exact versions (`x.y.z`) only when required by platform constraints (React Native core)

### Known Risks
1. **Dependency duplication**: Same library at different versions across projects increases bundle size and potential for inconsistent behavior
2. **No workspace hoisting**: Each project downloads its own copy of shared dependencies (e.g., TypeScript, axios)
3. **Manual update burden**: Without automation, security patches and feature updates require manual tracking
4. **Root package.json staleness**: Root-level dependencies appear unused or outdated compared to backend-specific versions

## Build Integration

Dependencies are consumed through:
- **Backend**: NestJS CLI build (`nest build`), ts-node for development
- **Frontend**: Vite build pipeline with TypeScript compilation
- **Mobile**: Expo CLI with Metro bundler
- **Docker**: Each project has its own `Dockerfile` running `npm ci` (uses lockfile for CI-safe installs)
