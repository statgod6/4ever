import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import * as compression from 'compression';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Keep default Nest logger; replaced by Pino later (P4).
    bufferLogs: false,
  });

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

  app.setGlobalPrefix('api');

  // ─── Static uploads (avatars, KW generated assets) ────────────────────────
  // TODO(P2): replace with signed short-lived URLs to authorize access.
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads/',
  });

  // ─── Health check (no auth, bypasses /api prefix) ─────────────────────────
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/api/health', (_req: any, res: any) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ─── Graceful shutdown (SIGTERM / SIGINT) ─────────────────────────────────
  // Enables Nest lifecycle hooks so modules can drain in-flight work (LLM
  // streams, DB connections) before the container is killed during rolling
  // deploys or autoscaler scale-in events.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT) || 3001;
  await app.listen(port);
  Logger.log(`4Ever API listening on http://localhost:${port} (env=${process.env.NODE_ENV || 'development'})`, 'Bootstrap');
}
bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
