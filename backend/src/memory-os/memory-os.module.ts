import { Module } from '@nestjs/common';
import { MemoryManagerService } from './memory-manager.service';
import { ContextBuilderService } from './context-builder.service';
import { DecayService } from './decay.service';
import { PatternDetectorService } from './pattern-detector.service';

/**
 * Memory OS Module — wires all memory system services together.
 *
 * Exports MemoryManagerService and ContextBuilderService for use
 * by OrchestrationModule and any other modules that need memory access.
 */
@Module({
  providers: [
    MemoryManagerService,
    ContextBuilderService,
    DecayService,
    PatternDetectorService,
  ],
  exports: [
    MemoryManagerService,
    ContextBuilderService,
    PatternDetectorService,
    DecayService,
  ],
})
export class MemoryOsModule {}
