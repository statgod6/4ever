import { Module } from '@nestjs/common';
import { TensionsService } from './tensions.service';
import { TensionsController } from './tensions.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TensionsController],
  providers: [TensionsService],
  exports: [TensionsService],
})
export class TensionsModule {}
