# 4Ever Security Audit & Launch Checklist

**Last run:** May 10, 2026

## 1. Dependency audit summary

### Backend (`backend/npm audit` after auto-fix)
- **4 low · 15 moderate · 7 high · 0 critical**
- Auto-fix applied: axios (CVE-2025-62718 NO_PROXY bypass) + 2 others.
- Remaining high-severity are all transitive dependencies of `@nestjs/*`
  packages. Fixing them requires `npm audit fix --force` which bumps:
  - `@nestjs/cli` → 11.0.21 (same major, safe)
  - `@nestjs/config` → 4.0.4 (same major, safe)
  - `@nestjs/platform-express` → 11.1.19 (same major, safe)
  - `@nestjs/schedule` → 6.1.3 (⚠️ semver-major bump from 4.x; test cron jobs after)
  - `@nestjs/schematics` → 11.1.0 (tooling only)
  - `multer` → 2.x via platform-express (breaking API; our usage is simple so safe)

  **Recommendation:** run `npm audit fix --force` after TestFlight phase when
  you have a stable regression baseline, then re-run the full smoke suite.

- **`xlsx` (no fix available, high severity)** — transitive, not used in our
  source code (`grep -r "xlsx" src/` returns 0). Can be safely ignored; if
  npm audit noise bothers you, add `xlsx` to `overrides` as `"npm:@e965/xlsx"`
  which is the community fork with patches.

- **Multer DoS (high)** — we already mitigate via:
  - `app.use(bodyParser.json({ limit: '2mb' }))` in main.ts
  - `MulterModule.register({ limits: { fileSize: 5 * 1024 * 1024 } })` for avatars
  - PremiumGuard + @Throttle on upload endpoints

### Mobile (`mobile/npm audit`)
- **0 low · 6 moderate · 0 high · 0 critical**
- All moderate issues are in `@expo/cli`/`@expo/metro-config` dev-time tooling
  (no production runtime impact; Hermes-bundled code doesn't ship these).

## 2. OWASP Top-10 checklist

| # | Risk | Mitigation | Status |
|---|---|---|---|
| A01 | Broken Access Control | `@UseGuards(JwtAuthGuard)` + `PremiumGuard` on all user routes; admin routes require `X-Admin-Secret` | ✅ |
| A02 | Cryptographic Failures | TLS-only (`force_https` in fly.toml), JWT signed with `JWT_SECRET` (fail-closed if unset), bcrypt not needed (OTP-only auth) | ✅ |
| A03 | Injection | Prisma parameterized queries everywhere; 25 `$executeRawUnsafe` sites audited — all use positional `$N` params, no string concat | ✅ |
| A04 | Insecure Design | Rate-limited OTP, OTP TTL 10 min, OTP cleanup cron, KW quota enforcement, account deletion requires OTP re-auth | ✅ |
| A05 | Security Misconfiguration | `helmet()`, CORS locked to `CORS_ORIGINS` env, no wildcard fallback, Dockerfile runs as non-root, graceful shutdown | ✅ |
| A06 | Vulnerable Components | `npm audit` run; known issues documented above | ⚠️ see §1 |
| A07 | Authentication Failures | Per-IP + per-phone OTP throttle, layered throttle on `/auth/*`, SIWA with Apple JWKS verification + audience check | ✅ |
| A08 | Software/Data Integrity | Signed Docker images (via Fly registry), Prisma migration lock, no `eval` in codebase | ✅ |
| A09 | Logging & Monitoring | Pino structured logs with PII redaction, per-request correlation id, Sentry on backend + mobile, `/livez` + `/readyz` probes | ✅ |
| A10 | SSRF | Tavily/OpenRouter/E2B are HTTPS-only, no user-controlled URLs fetched server-side | ✅ |

## 3. PII redaction verified

Pino `redact.paths` covers: `authorization`, `cookie`, `x-api-key`,
`x-admin-secret`, `set-cookie`, `*.password`, `*.otp`, `*.otpCode`, `*.phone`,
`*.phoneNumber`, `*.token`, `*.accessToken`, `*.refreshToken`, `*.jwt`,
`*.apiKey`, `*.secret`, and request bodies for `/auth/*` routes.

Custom serializers strip request/response bodies and query strings entirely
to prevent accidental leakage of message content into logs.

## 4. Secrets inventory

All production secrets must be set via `fly secrets set` (or your host's
equivalent), **never** committed. See [fly.toml](../backend/fly.toml) comment
header for the full list. `.env.example` at repo root is the canonical
template (placeholders only).

## 5. Pre-submission manual review

- [ ] Rotate every API key listed in §1 of launch checklist (P1-rotate)
- [ ] Verify CORS_ORIGINS is set to production domain only (no `*`)
- [ ] Verify APPLE_CLIENT_ID matches the ios.bundleIdentifier exactly
- [ ] Run full smoke regression (auth → OTP, SIWA, core chat, personas, KW,
      circle, planner, privacy-export, account-delete)
- [ ] Load-test with k6 (p8-loadtest): 50 concurrent LLM streams, verify
      quotas + throttles hold
- [ ] Monitor Sentry error budget for 7 days of TestFlight before Play
      production rollout

## 6. Incident response

- `support@4ever.app` — triage queue
- `security@4ever.app` — responsible disclosure
- Rotate JWT_SECRET via `fly secrets set JWT_SECRET=$(openssl rand -base64 48)`
  which invalidates all tokens and forces re-login (rollback in < 1 minute).
