import { Module } from '@nestjs/common';
import { RitualsService } from './rituals.service';
import { RitualsController } from './rituals.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RitualsController],
  providers: [RitualsService],
  exports: [RitualsService],
})
export class RitualsModule {}
