import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
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
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
