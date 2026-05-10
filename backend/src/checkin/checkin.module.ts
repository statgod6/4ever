import { Module } from '@nestjs/common';
import { CheckInController } from './checkin.controller';
import { CheckInService } from './checkin.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [CheckInController],
  providers: [CheckInService, PrismaService],
  exports: [CheckInService],
})
export class CheckInModule {}
