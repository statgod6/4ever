import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { OntologyController } from './ontology.controller';
import { OntologyService } from './ontology.service';
import { OntologySynthesisService } from './synthesis.service';
import { OntologyEventsListener } from './events.listener';
import { SelfSynthesizer } from './synthesizers/self.synthesizer';
import { RelationalSynthesizer } from './synthesizers/relational.synthesizer';
import { EmotionalSynthesizer } from './synthesizers/emotional.synthesizer';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
  ],
  controllers: [OntologyController],
  providers: [
    OntologyService,
    OntologySynthesisService,
    OntologyEventsListener,
    SelfSynthesizer,
    RelationalSynthesizer,
    EmotionalSynthesizer,
  ],
  exports: [OntologyService, OntologySynthesisService],
})
export class OntologyModule {}
