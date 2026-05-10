# 4Ever Privacy Policy

**Effective date:** May 10, 2026
**Last updated:** May 10, 2026

4Ever ("we", "us", "the app") is an AI-powered personal life OS operated by
4Ever Labs. This policy explains what we collect, why, who we share it with,
and the controls you have over it. If you have questions email
**privacy@4ever.app**.

## 1. Who we are

- Controller: 4Ever Labs (entity name pending registration).
- Contact: privacy@4ever.app
- Data Protection Officer: dpo@4ever.app

## 2. What we collect

### 2.1 You provide directly

| Category | Examples | Purpose |
|---|---|---|
| Account | Phone number, (optional) email, name, avatar image | Identify you, deliver service, Sign in with Apple |
| Content | Thoughts, chat messages, journal entries, rituals, relationships, life events, voice transcripts, uploaded files | Core product functionality |
| Consent records | Your acceptance of this policy, Terms, and AI-usage disclosure (timestamped) | Legal basis tracking |
| Support | Messages you send to support@4ever.app | Respond to you |

### 2.2 Collected automatically

| Category | Examples | Purpose |
|---|---|---|
| Technical | Device type, OS version, app version, IP address, crash logs | Stability, debugging, abuse prevention |
| Usage | Feature events, LLM token usage per feature, latency metrics | Product analytics, quota enforcement |
| Logs | Request correlation ids, error traces (PII redacted) | Debugging, security |

We **do not** collect:
- Precise GPS location (Android location permissions are blocked)
- Advertising identifiers
- Behavioral data across other apps
- Health records, HealthKit data, biometric identifiers

### 2.3 Permissions we may request

- **Microphone** — for voice conversations with the AI (audio is transcribed on
  our servers and not retained beyond the transcript unless you explicitly save).
- **Camera / Photo library** — only when you set a profile picture or attach an
  image to a knowledge-base document.
- **Contacts** — only when you choose to import contacts into your Circle. We
  hash phone numbers before matching and never upload the full address book.
- **Notifications** — for reminders you schedule.

## 3. How we use your data (legal basis — GDPR Art. 6)

| Purpose | Legal basis |
|---|---|
| Provide the app's core features | Performance of contract (Art. 6(1)(b)) |
| Send OTP codes via SMS | Performance of contract |
| Generate AI responses about your own content | Performance of contract |
| Crash and error logging | Legitimate interest (Art. 6(1)(f)) |
| Abuse prevention, rate limiting | Legitimate interest |
| Marketing emails (if you opt-in) | Consent (Art. 6(1)(a)) |
| Complying with legal requests | Legal obligation (Art. 6(1)(c)) |

We do **not** sell your personal information. We do **not** use your content to
train third-party foundation models beyond what is strictly needed to generate
the response you asked for.

## 4. Who we share it with (sub-processors)

We send minimum-necessary data to these service providers. Each is bound by a
data-processing agreement.

| Provider | Purpose | Data sent | Location |
|---|---|---|---|
| **Twilio** | SMS OTP delivery | Your phone number, 6-digit code | US |
| **OpenRouter** (and upstream LLM providers it routes to) | Generating AI replies, analysis, summarization | The prompt content for the current turn (may include snippets of your thoughts / messages) | US/EU |
| **E2B** | Sandboxed code execution when the AI needs to run code for you | Code snippets you generate during a session | US |
| **Tavily** | Web search when you ask the AI to look something up | Your search query | US |
| **Sentry** | Crash and error reporting | Error stack traces, redacted request context | US/EU |
| **Cloudflare** | DNS, DDoS protection | IP address, request metadata | Global |
| **Neon / Supabase** (managed Postgres) | Database hosting | All application data, encrypted at rest | US/EU region of your choice |
| **Apple** | Sign in with Apple (if you use it) | Apple's signed identity token | US |

Individual LLM upstreams accessed via OpenRouter (OpenAI, Anthropic, Google,
DeepSeek, etc.) may retain prompts for up to 30 days for abuse monitoring
per their published policies. We never opt into their training datasets.

## 5. International transfers

Data may be processed in the United States and the European Union. For EU/UK
residents we rely on Standard Contractual Clauses.

## 6. Retention

- Active account data: kept for the life of your account.
- OTP codes: deleted within 10 minutes (unused) or immediately after use.
- Server logs with PII redacted: 30 days.
- Backups: 30 days rolling.
- After account deletion: all personal content is removed within 30 days. We
  may retain minimal records (e.g. deletion timestamp, billing history) for up
  to 7 years where tax or anti-fraud law requires.

## 7. Your rights

Under GDPR, UK-GDPR, CCPA/CPRA and similar laws you can:

- **Access / Export** — *Settings → Privacy & Data → Export My Data*. Returns a
  machine-readable JSON of everything we hold.
- **Correct** — edit your profile in-app, or email us.
- **Delete** — *Settings → Privacy & Data → Delete My Account*. Requires OTP
  re-verification. All personal content is cascade-deleted; this is not
  reversible.
- **Object / Restrict processing** — email privacy@4ever.app.
- **Withdraw consent** — revoke AI-usage consent in *Settings → Privacy & Data*;
  note that withdrawing consent disables features that depend on it.
- **Lodge a complaint** — with your local supervisory authority (for EU users,
  see https://edpb.europa.eu/about-edpb/about-edpb/members_en).

We will respond within 30 days.

## 8. Security

- All traffic is TLS 1.2+.
- Database is encrypted at rest.
- Secrets are stored in a managed vault, not in source.
- Passwords do not exist — authentication is via SMS OTP or Sign in with Apple.
- JWTs are short-lived (7 days currently, migrating to 15-minute access + 30-day
  refresh).
- We rate-limit OTP requests, LLM endpoints, and file uploads.

No system is perfectly secure. If you discover a vulnerability please email
**security@4ever.app**; we operate a good-faith disclosure policy.

## 9. Children

4Ever is not directed at children under 13 (under 16 in the EEA). We do not
knowingly collect data from them. If you believe a child has an account,
email privacy@4ever.app and we will delete it.

## 10. AI-specific disclosures

- AI responses are generated by large language models and may be wrong,
  biased, or hallucinated. Do not rely on them for medical, legal, or
  financial decisions.
- The AI is **not a licensed therapist, physician, or lawyer.** If you are in
  crisis please contact your local emergency services.
- The AI sees the content you send in the current session plus relevant
  memories we retrieved on your behalf. You can inspect and delete memories
  in *Memory Lifecycle* settings.

## 11. Changes

We will notify you in-app for material changes and ask you to re-accept. The
"Last updated" date at the top will always reflect the current version.
