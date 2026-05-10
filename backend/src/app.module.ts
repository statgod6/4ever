import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 30 }]),
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
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
