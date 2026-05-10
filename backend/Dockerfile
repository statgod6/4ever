# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# 4Ever backend — hardened multi-stage Dockerfile for production builds.
#
# Stages:
#   deps     → install full deps (incl. dev) for building
#   build    → compile TypeScript + generate Prisma client
#   runtime  → minimal image; only prod deps, non-root user, real signal handling
#
# Hardening choices:
#   • Pinned node:20.17.0-alpine (bumped manually; avoids silent breakage on tag drift).
#   • dumb-init as PID 1 so SIGTERM reaches Node → app.enableShutdownHooks() fires.
#   • Non-root uid 1001 (the shipping `node` user); /app owned by it.
#   • `npm ci --omit=dev` in runtime — dev deps never reach the production layer.
#   • HEALTHCHECK hits /api/livez through the Node fetch shim (no curl needed).
#   • Tini-style tini would also work; dumb-init is lighter (no subreaper).
#
# Build:   docker build -t 4ever-backend:<sha> ./backend
# Run:     docker run --env-file .env.prod -p 3001:3001 4ever-backend:<sha>
# ─────────────────────────────────────────────────────────────────────────────

# ----- 1) deps: install ALL dependencies (cache-friendly) --------------------
FROM node:20.17.0-alpine AS deps
WORKDIR /app
# Copy only manifests first to maximize layer cache hits between builds.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# ----- 2) build: compile TS + generate Prisma client -------------------------
FROM node:20.17.0-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY tsconfig.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
# Generate Prisma client (compiles native engines for Alpine/musl).
RUN npx prisma generate
# Nest build → ./dist
RUN npm run build

# ----- 3) runtime: minimal, non-root, production-only ------------------------
FROM node:20.17.0-alpine AS runtime
# dumb-init wraps node so shell signals propagate (SIGTERM → graceful shutdown).
# openssl is required by Prisma's query engine on alpine; already present but
# pinned here for clarity.
RUN apk add --no-cache dumb-init openssl

ENV NODE_ENV=production \
    PORT=3001 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

WORKDIR /app

# Install ONLY production deps (smaller image, fewer CVEs).
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# Bring in the pre-generated Prisma client + built JS output.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma

# Create uploads dir + hand everything to the unprivileged `node` user.
# The `node` user is baked into node:alpine as uid 1000 / gid 1000.
RUN mkdir -p /app/uploads/avatars /app/uploads/kw-docs /app/uploads/kw-generated \
    && chown -R node:node /app

USER node

EXPOSE 3001

# Liveness check — probes the livez endpoint every 30s. Five retries before
# the orchestrator marks the container unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/livez').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# dumb-init as PID 1 → proper signal forwarding → graceful LLM-stream drain.
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/main.js"]
