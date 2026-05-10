import { Module } from '@nestjs/common';
import { LifeEventsService } from './life-events.service';
import { LifeEventsController } from './life-events.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [LifeEventsController],
  providers: [LifeEventsService],
  exports: [LifeEventsService],
})
export class LifeEventsModule {}
