import { Module } from '@nestjs/common';
import { OrchestrationService } from './orchestration.service';
import { OrchestrationController } from './orchestration.controller';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { MemoryConsolidationService } from './memory-consolidation.service';
import { OntologyModule } from '../ontology/ontology.module';
import { DimensionsModule } from '../dimensions/dimensions.module';
import { AgentActionsModule } from '../agent-actions/agent-actions.module';
import { SkillsModule } from '../skills/skills.module';
import { MemoryOsModule } from '../memory-os/memory-os.module';

@Module({
  imports: [KnowledgeBaseModule, OntologyModule, DimensionsModule, AgentActionsModule, SkillsModule, MemoryOsModule],
  providers: [OrchestrationService, MemoryConsolidationService],
  controllers: [OrchestrationController],
  exports: [OrchestrationService, MemoryConsolidationService],
})
export class OrchestrationModule {}
