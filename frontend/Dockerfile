# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# 4Ever web admin — static build served by nginx. Multi-stage, non-root, pinned.
# ─────────────────────────────────────────────────────────────────────────────

# ----- 1) builder: compile Vite bundle ---------------------------------------
FROM node:20.17.0-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run build

# ----- 2) runtime: nginx-unprivileged serves the static bundle ---------------
# nginxinc/nginx-unprivileged runs as uid 101 out of the box and listens on
# :8080 instead of :80, so no CAP_NET_BIND_SERVICE is required.
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY --from=builder /app/dist /usr/share/nginx/html

# Nginx config: serve the SPA with correct fallback, proxy /api to backend.
# Written to a file instead of `RUN echo` so it survives linters and review.
COPY <<'NGINX_CONF' /etc/nginx/conf.d/default.conf
server {
    listen 8080;
    server_name _;

    # Security headers — defence in depth with helmet on the API.
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # SPA root
    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # API reverse-proxy — the `backend` hostname is resolved by the compose
    # network; in cloud deployments this is overridden at the ingress layer.
    location /api {
        proxy_pass http://backend:3001/api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Streaming endpoints need long timeouts + no buffering.
        proxy_read_timeout 10m;
        proxy_send_timeout 10m;
        proxy_buffering off;
    }
}
NGINX_CONF

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null 2>&1 || exit 1
