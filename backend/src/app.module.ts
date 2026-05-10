import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ThoughtsModule } from './thoughts/thoughts.module';
import { PersonasModule } from './personas/personas.module';
import { PrismaModule } from './prisma/prisma.module';
import { OrchestrationModule } from './orchestration/orchestration.module';
import { InsightsModule } from './insights/insights.module';
import { PlannerModule } from './planner/planner.module';
import { CheckInModule } from './checkin/checkin.module';
import { ActionsModule } from './actions/actions.module';
import { ReflectionsModule } from './reflections/reflections.module';
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module';
import { RelationshipsModule } from './relationships/relationships.module';
import { RitualsModule } from './rituals/rituals.module';
import { LifeEventsModule } from './life-events/life-events.module';
import { TensionsModule } from './tensions/tensions.module';
import { DimensionsModule } from './dimensions/dimensions.module';
import { MessagingModule } from './messaging/messaging.module';
import { KnowledgeWorkerModule } from './knowledge-worker/knowledge-worker.module';
import { AdminModule } from './admin/admin.module';
import { UsageModule } from './usage/usage.module';
import { ConsentModule } from './consent/consent.module';
import { HealthModule } from './health/health.module';
import { SupportModule } from './support/support.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // ─── Structured logging (Pino) ──────────────────────────────────────────
    // Replaces Nest's default console logger with JSON-line output in prod and
    // pretty-printed output in dev. Every HTTP request gets a correlation id
    // (x-request-id header or generated UUID) that flows through child loggers
    // so we can trace a single user action across multiple services.
    //
    // Redaction is MANDATORY: we strip auth headers, OTP codes, phone numbers,
    // and JWT tokens from any log line before it's written. Missing a single
    // redact path = PII in log aggregator = GDPR violation.
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
        // Pretty-print in dev only; prod ships raw JSON lines to the log collector.
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  translateTime: 'SYS:HH:MM:ss.l',
                  ignore: 'pid,hostname,req,res,responseTime',
                  singleLine: true,
                },
              },
        // Per-request correlation id — honors upstream x-request-id for tracing
        // across a reverse proxy → api → worker chain.
        genReqId: (req: any) =>
          (req.headers['x-request-id'] as string) ||
          (req.headers['x-correlation-id'] as string) ||
          randomUUID(),
        // Strip PII from every log line. Paths use pino's dotted syntax; wildcards
        // cover nested headers on both request and response serializers.
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-api-key"]',
            'req.headers["x-admin-secret"]',
            'res.headers["set-cookie"]',
            '*.password',
            '*.otp',
            '*.otpCode',
            '*.phone',
            '*.phoneNumber',
            '*.token',
            '*.accessToken',
            '*.refreshToken',
            '*.jwt',
            '*.apiKey',
            '*.secret',
            'req.body.phone',
            'req.body.phoneNumber',
            'req.body.otp',
            'req.body.otpCode',
            'req.body.password',
          ],
          censor: '[REDACTED]',
        },
        // Lean serializers — we never want full response bodies in logs.
        serializers: {
          req: (req: any) => ({
            id: req.id,
            method: req.method,
            url: req.url?.split('?')[0], // drop query string — may contain tokens
            remoteAddress: req.remoteAddress,
            userAgent: req.headers?.['user-agent'],
          }),
          res: (res: any) => ({
            statusCode: res.statusCode,
          }),
        },
        customLogLevel: (_req: any, res: any, err?: Error) => {
          if (err || res.statusCode >= 500) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'info';
        },
        // Skip health-probe noise — k8s hits /livez every 10s.
        autoLogging: {
          ignore: (req: any) =>
            req.url === '/api/livez' ||
            req.url === '/api/readyz' ||
            req.url === '/api/health',
        },
      },
    }),
    // ScheduleModule enables @Cron decorators (used for OTP cleanup, future
    // subscription renewals, memory decay, etc.). Must be forRoot() once.
    ScheduleModule.forRoot(),
    // Named throttler buckets — @Throttle decorators can reference these by
    // name to layer multiple rate limits (e.g. short-window + long-window).
    //   default    — global fallback for any route without its own @Throttle
    //   auth_short — tight per-minute limit for OTP / login endpoints
    //   auth_long  — anti-enumeration 15-min window
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 30 },
      { name: 'auth_short', ttl: 60_000, limit: 3 },
      { name: 'auth_long', ttl: 900_000, limit: 10 },
    ]),
    PrismaModule,
    AuthModule,
    UsersModule,
    ThoughtsModule,
    PersonasModule,
    OrchestrationModule,
    InsightsModule,
    PlannerModule,
    CheckInModule,
    ActionsModule,
    ReflectionsModule,
    KnowledgeBaseModule,
    RelationshipsModule,
    RitualsModule,
    LifeEventsModule,
    TensionsModule,
    DimensionsModule,
    MessagingModule,
    KnowledgeWorkerModule,
    AdminModule,
    UsageModule,
    ConsentModule,
    HealthModule,
    SupportModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
