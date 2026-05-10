import { Global, Module } from '@nestjs/common';
import { UsageService } from './usage.service';

/**
 * Global usage module — any module (orchestration, knowledge-worker, messaging,
 * ontology) can inject UsageService without explicit imports. This keeps the
 * instrumentation lightweight and avoids a spiderweb of module dependencies.
 */
@Global()
@Module({
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
