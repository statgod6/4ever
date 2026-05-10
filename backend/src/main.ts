import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import * as compression from 'compression';
import { join } from 'path';
import { Logger as PinoLogger } from 'nestjs-pino';
import { initSentry, Sentry } from './sentry';
import { SentryExceptionFilter } from './common/sentry-exception.filter';
import { AppModule } from './app.module';

// Sentry must be initialized before *anything* Nest does — a silent no-op
// when SENTRY_DSN is unset.
initSentry();

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Buffer early logs until Pino is wired in as the app logger below.
    bufferLogs: true,
  });

  // Swap Nest's default logger for Pino so every log line — including those
  // emitted by framework internals, guards, pipes, and service classes using
  // the standard Nest Logger — flows through our redaction + JSON pipeline.
  app.useLogger(app.get(PinoLogger));

  const isProd = process.env.NODE_ENV === 'production';

  // ─── Security headers ─────────────────────────────────────────────────────
  // Helmet adds CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, etc.
  // CSP is set in report-only mode initially to avoid breaking the web admin frontend
  // while we refine the policy during beta.
  app.use(
    helmet({
      contentSecurityPolicy: false, // TODO(P4): enable report-only then enforce
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow mobile to fetch /uploads/*
    }),
  );

  // ─── Response compression ─────────────────────────────────────────────────
  app.use(compression());

  // ─── Body size limits (prevent payload-based abuse) ───────────────────────
  // JSON endpoints: 2 MB is plenty for chat + planner payloads.
  // File uploads go through multer with their own per-route limits.
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ extended: true, limit: '2mb' }));

  // ─── CORS (production must set CORS_ORIGINS explicitly) ───────────────────
  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : ['http://localhost:3000', 'http://localhost:5173'];
  if (isProd && !process.env.CORS_ORIGINS) {
    // Fail loud in production to prevent wildcard exposure by accident.
    throw new Error('CORS_ORIGINS must be set in production');
  }
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  // ─── Validation ───────────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false, // tolerate extra fields; reject unknown types via DTO
    }),
  );

  // Global error filter (Sentry) — forwards unhandled 5xx errors to Sentry
  // (no-op when SENTRY_DSN is unset) while preserving Nest's default 4xx
  // response contract.
  app.useGlobalFilters(new SentryExceptionFilter());

  app.setGlobalPrefix('api');

  // ─── Static uploads (avatars, KW generated assets) ────────────────────────
  // Mobile <Image uri> and browser <a download> cannot attach Authorization
  // headers, so /uploads is public. Security posture:
  //   1. Avatar filenames use randomUUID (no user id leak — see users.controller).
  //   2. KW generated filenames embed server-generated UUIDs and go through an
  //      explicit controller with filename validation.
  //   3. Cache-Control: private prevents CDN / shared-cache storage.
  // TODO(P5-storage): replace local disk with S3/R2 + HMAC-signed URLs so we
  // can gate every fetch on a short-lived cryptographic token.
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads/',
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:");
    },
  });

  // ─── Health / probe endpoints ─────────────────────────────────────────────
  // Now provided by HealthModule (/api/health + /api/livez + /api/readyz).
  // HealthModule includes DB connectivity probe + required-config check;
  // the old inline /api/health is superseded but the path still works.

  // ─── Graceful shutdown (SIGTERM / SIGINT) ─────────────────────────────────
  // Enables Nest lifecycle hooks so modules can drain in-flight work (LLM
  // streams, DB connections) before the container is killed during rolling
  // deploys or autoscaler scale-in events.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT) || 3001;
  await app.listen(port);
  const logger = app.get(PinoLogger);
  logger.log(
    `4Ever API listening on http://localhost:${port} (env=${process.env.NODE_ENV || 'development'})`,
    'Bootstrap',
  );
}
bootstrap().catch((err) => {
  // Make sure fatal bootstrap crashes reach Sentry before the process dies.
  try {
    Sentry.captureException(err);
  } catch {
    // ignore — Sentry is a no-op when DSN is unset
  }
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
