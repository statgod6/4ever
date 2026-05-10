import { Module } from '@nestjs/common';
import { ThoughtsService } from './thoughts.service';
import { ThoughtsController } from './thoughts.controller';

@Module({
  providers: [ThoughtsService],
  controllers: [ThoughtsController],
  exports: [ThoughtsService],
})
export class ThoughtsModule {}
