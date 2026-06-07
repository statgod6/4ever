import { Module } from '@nestjs/common';
import { SkillsService } from './skills.service';

/**
 * Skills Module — V0
 *
 * Provides the SkillsService as a shared, reusable backend layer.
 * Can be imported by OrchestrationModule, KnowledgeWorkerModule,
 * or any other module that needs skill selection.
 */
@Module({
  providers: [SkillsService],
  exports: [SkillsService],
})
export class SkillsModule {}
