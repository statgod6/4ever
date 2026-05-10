import { Module } from '@nestjs/common';
import {
  KnowledgeWorkerController,
  KnowledgeWorkerAssetsController,
} from './knowledge-worker.controller';
import { KnowledgeWorkerService } from './knowledge-worker.service';
import { DocumentStorageService } from './services/document-storage.service';
import { DocumentExtractionService } from './services/document-extraction.service';

@Module({
  controllers: [KnowledgeWorkerController, KnowledgeWorkerAssetsController],
  providers: [
    KnowledgeWorkerService,
    DocumentStorageService,
    DocumentExtractionService,
  ],
  exports: [KnowledgeWorkerService],
})
export class KnowledgeWorkerModule {}
