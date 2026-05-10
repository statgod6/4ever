# 4Ever Launch Playbook — What YOU Need To Do

This document is your human-only checklist. Everything a code change could do
has already been done in the `release/launch-hardening` branch. This file
tracks the things only you can do (dashboards, domains, payments, legal).

Last updated: May 10, 2026. Commits from this hardening pass:

- `0c4a2cb` · P0 init (.gitignore, release branch)
- `83b3d9a` · P2 security (JWT fail-closed, OTP throttle, KW filename validation)
- `1b6b998` · P2 avatar random filenames + Cache-Control
- `ee82d48` · P3 LlmUsage + TokenQuota + quota enforcement
- `3f75ef2` · P3 data export + account delete + consent
- `fbd08da` · P4 /livez /readyz + hardened Dockerfiles
- `8b8f817` · P4 Pino structured logger + PII redaction
- `f94fd36` · P6 mobile store-ready config + EAS profiles
- `bd67c83` · P6 Privacy & Data screen (export + delete + consent)
- `3014988` · P6 Sign in with Apple (backend + mobile)
- *(+ the commit that adds this doc)*

---

## 🟥 BLOCKERS — must do before any submission

### 1. Rotate every leaked credential
The original `.env` contained live keys that existed in the repo prior to this
cleanup. Even though history is now clean, **assume all of these are
compromised** and rotate them in the provider dashboard:

| Provider | Dashboard | New var → where |
|---|---|---|
| OpenRouter | https://openrouter.ai/keys | `OPENROUTER_API_KEY` → `fly secrets set` |
| Twilio | https://console.twilio.com | `TWILIO_AUTH_TOKEN` (keep SID, rotate token) |
| Tavily | https://app.tavily.com | `TAVILY_API_KEY` |
| E2B | https://e2b.dev/dashboard | `E2B_API_KEY` |
| JWT secret | generate: `openssl rand -base64 48` | `JWT_SECRET` |
| Admin secret | generate: `openssl rand -base64 32` | `ADMIN_SECRET` |

### 2. Register the 4ever.app domain and set up DNS
- Buy `4ever.app` (Cloudflare Registrar recommended — at-cost pricing + free DNS).
- Create these records:
  - `A` / `AAAA` for `api.4ever.app` → your Fly app (or `CNAME` to `4ever.fly.dev`)
  - `A` / `AAAA` for `app.4ever.app` → your frontend host
  - `MX` for `@` → email forwarder (ImprovMX free, or use Google Workspace)
- Enable Cloudflare proxy + "Full (strict)" SSL once certs are issued.

### 3. Set up the mailboxes
Create forwarders (ImprovMX works fine for launch):
- `support@4ever.app` → your personal inbox
- `privacy@4ever.app` → your personal inbox
- `security@4ever.app` → your personal inbox
- `legal@4ever.app` → your personal inbox
- `dpo@4ever.app` → your personal inbox

### 4. Provision managed Postgres with pgvector
**Recommended: Neon** (free tier has pgvector, serverless, auto-pauses when idle).
- Create a project, enable the `vector` extension: `CREATE EXTENSION vector;`
- Copy the pooled connection string → `DATABASE_URL` in Fly secrets.
- First deploy will auto-run all Prisma migrations.

Alternative: Supabase (also has pgvector), or Fly Postgres with `CREATE EXTENSION vector;` manually.

### 5. Host the legal pages
The files in [`docs/PRIVACY.md`](./PRIVACY.md) and [`docs/TERMS.md`](./TERMS.md)
are drafts — they're legally reasonable but **not a substitute for a lawyer
reviewing them**. Especially check:
- Governing-law clause in Terms §14 (currently Singapore — change if you're
  incorporating elsewhere)
- The company name "4Ever Labs" — update to your actual registered entity
- Children's age threshold for your markets

Once reviewed, publish them at:
- `https://4ever.app/privacy`
- `https://4ever.app/terms`

These URLs are required by both stores and by the in-app consent screen.

### 6. Create App Store Connect + Google Play Console records
**Apple:**
- Enroll in the Apple Developer Program ($99/yr).
- Create app record with bundle id `app.fourever.ios`.
- In Certificates → Identifiers → App IDs, enable **Sign in with Apple**
  capability for `app.fourever.ios`.
- Once approved, set `APPLE_CLIENT_ID=app.fourever.ios` in Fly secrets.

**Google:**
- Pay the one-time $25 Play Console fee.
- Create app with package `app.fourever.android`.
- Complete the **Data Safety form** using §2 of `docs/PRIVACY.md` as your
  source of truth (it lists exactly what we collect and share).

### 7. Get your EAS projectId and update mobile/app.json
```
cd mobile
npx eas init
```
This writes the real `extra.eas.projectId` — commit the result (replaces the
`REPLACE_WITH_EAS_PROJECT_ID` placeholder).

### 8. Set up Sentry
- Create two projects on https://sentry.io: `4ever-backend` and `4ever-mobile`.
- Copy each DSN into:
  - Backend: `SENTRY_DSN` in Fly secrets
  - Mobile: `EXPO_PUBLIC_SENTRY_DSN` in `mobile/eas.json` under each profile's
    `env` block

---

## 🟧 DEPLOYMENT — do after blockers

### 9. Backend on Fly.io
```
cd backend
fly launch --no-deploy     # accept the generated name or use "fourever-backend"
fly secrets set \
  DATABASE_URL="postgresql://..." \
  JWT_SECRET="$(openssl rand -base64 48)" \
  OPENROUTER_API_KEY="..." \
  TWILIO_ACCOUNT_SID="..." \
  TWILIO_AUTH_TOKEN="..." \
  TWILIO_FROM_NUMBER="+1..." \
  CORS_ORIGINS="https://app.4ever.app" \
  ADMIN_SECRET="$(openssl rand -base64 32)" \
  APPLE_CLIENT_ID="app.fourever.ios" \
  SENTRY_DSN="https://...@sentry.io/..." \
  TAVILY_API_KEY="..." \
  E2B_API_KEY="..."
fly deploy
fly status     # verify /livez and /readyz both green
```
Then `fly certs add api.4ever.app` and point your DNS.

### 10. First EAS production builds
```
cd mobile
eas build --platform ios --profile production
eas build --platform android --profile production
```
The iOS build will prompt for App Store Connect credentials — this uploads
directly to TestFlight.
The Android build produces an AAB — download and upload to Play Console's
internal testing track.

### 11. TestFlight (1 week bug bash)
- Invite yourself + 4 trusted testers.
- Focus testing on: first-time OTP sign-in, Sign in with Apple, account
  deletion OTP re-auth flow, data export (verify file opens in any JSON viewer),
  consent screen acceptance.

### 12. Play Internal Testing (parallel)
- Upload AAB to internal track.
- Add 5 testers via email list.
- Fix any rejections from the Data Safety form review.

---

## 🟩 STORE LISTING — do in parallel with §11/§12

### 13. Store assets you need to produce
- **App icon:** 1024×1024 PNG (no transparency, no rounded corners — Apple
  rounds automatically). Regenerate `mobile/assets/icon.png` at this size if not already.
- **iOS screenshots** (required sizes):
  - 6.7" (iPhone 15 Pro Max): 1290×2796
  - 6.5" (iPhone 11 Pro Max): 1242×2688
  - 5.5" (iPhone 8 Plus): 1242×2208
  - 12.9" iPad Pro (3rd gen): 2048×2732
- **Android screenshots:**
  - Phone: at least 2, 1080×1920 or similar
  - Feature graphic: 1024×500
  - Optional tablet: 1536×2048
- **Promo video** (optional, strongly recommended for Play): 30s, 1080p.

### 14. Listing copy
Draft in your language of choice, then translate for at least English.
Required fields:
- **Name (30 chars):** `4Ever — AI Life OS`
- **Subtitle (30 chars):** `Think. Journal. Grow.`
- **Short description (80 chars, Play only):** one-sentence pitch
- **Long description (4000 chars):** use `idea_thinking_os_prd.md` §1-3 as source
- **Keywords (100 chars, Apple only):** `ai,journal,thoughts,life,coach,personas,knowledge,productivity`
- **Category:** Productivity (primary), Lifestyle (secondary)
- **Age rating:** 12+ (contains "Infrequent/Mild Mature/Suggestive Themes"
  because LLM can discuss emotional topics)

---

## 🟦 LAUNCH — final submission

### 15. App Store submission
- Upload production build through EAS (done in §10).
- Fill out the **App Review Information**:
  - Demo account: create a pre-populated account (`+91XXXXXXXXXX` / OTP:
    give them one that works; you may need to whitelist Apple's IP in Twilio
    Verify logs).
  - Review notes: explain that OTP is the primary auth, SIWA is the
    alternative, and the AI is a thinking assistant not a medical service.
- Expect 24–48h review. Common rejections: missing Sign in with Apple
  (we have it), no privacy policy URL (you have one), unclear in-app
  purchases (none currently).

### 16. Play Store submission
- Complete Data Safety form using `docs/PRIVACY.md` as source.
- Promote closed → open testing after 14 days of stable TestFlight data.
- Stage production rollout: 10% → 50% → 100% over 2 weeks.
- Monitor Sentry crash-free-sessions > 99% at each stage.

### 17. Day-1 monitoring
Set up alerts before you flip to 100%:
- **Sentry:** error rate > 1%/min → email
- **Fly:** `/readyz` fails for 2 min → email + phone
- **OpenRouter:** spend > $X/day → alert
- **Twilio:** SMS spend > $X/day → alert (OTP spam protection)
- **Cloudflare:** abnormal traffic spike → review

---

## 🔧 OPTIONAL POLISH — safe to do post-launch

These are P5/P6/P8 tasks marked as deferred. They're not launch-blockers but
make sense in the first 30 days:

- [ ] **S3/R2 storage migration** — replace the local `backend/uploads/`
      directory with signed URLs to S3 or Cloudflare R2. Right now uploads
      live on Fly's ephemeral filesystem and are lost on redeploy.
- [ ] **Refresh tokens** — migrate from 7-day JWT to 15-minute access +
      30-day rotating refresh. Requires coordinated mobile interceptor
      changes; the task is intentionally deferred.
- [ ] **npm audit fix --force** — after TestFlight bakes in, apply the safe
      non-semver-major upgrades (@nestjs/config, @nestjs/platform-express,
      multer). See `docs/SECURITY.md` §1 for the list.
- [ ] **k6 load test** — 50 concurrent LLM streams against the production
      API. Validates that throttles + quotas hold under load.
- [ ] **Redis-backed throttler** — when you scale past 1 Fly machine,
      `@nestjs/throttler` needs a shared store or rate limits will drift.

---

## ❓ Your final question: should you push to GitHub immediately?

**Yes. Push now.** Here's why it's safe:

1. The `release/launch-hardening` branch was the **first ever commit** of this
   repo (per your `.git` history) — there's no leaked-secret history to purge.
2. The current `.gitignore` blocks `.env`, `.env.*.local`, all upload
   directories, and node_modules — already verified with `git status --ignored`.
3. Every secret in committed code is a placeholder in `.env.example` only.
4. Push to a **private** GitHub repo. You can make it public later if you
   open-source, but there's zero reason to do so today.

Commands:
```powershell
cd d:\ThinkingOS
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin release/launch-hardening
# then on GitHub, set release/launch-hardening as the default branch (temporarily)
# or open a PR: release/launch-hardening -> main
```

If you want an extra belt-and-braces check before pushing, run this first:
```powershell
cd d:\ThinkingOS
git ls-files | Select-String -Pattern "\.env$" -NotMatch | Select-String "\.env"
# should return nothing; if anything shows up that's not .env.example, stop and investigate
```

---

## 📞 Emergency rollback

If production explodes:
```
fly deploy --image registry.fly.io/fourever-backend:<previous-sha>
# or simply:
fly releases
fly rollback <release-id>
```
Both take ~30 seconds and are zero-downtime.
