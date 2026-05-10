import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { OntologySynthesisService } from './synthesis.service';
import {
  ONTOLOGY_EVENTS,
  OntologyDomain,
  OntologyInputEvent,
} from './events';

/**
 * Subscribes to domain events, persists them to ontology_events, and schedules
 * debounced synthesis. Fire-and-forget — listener failures never break the
 * calling request.
 */
@Injectable()
export class OntologyEventsListener {
  private readonly logger = new Logger(OntologyEventsListener.name);

  constructor(
    private prisma: PrismaService,
    private synthesis: OntologySynthesisService,
  ) {}

  @OnEvent(ONTOLOGY_EVENTS.SELF_INPUT, { async: true })
  handleSelf(ev: OntologyInputEvent) {
    this.record(ev, 'self');
  }

  @OnEvent(ONTOLOGY_EVENTS.RELATIONAL_INPUT, { async: true })
  handleRelational(ev: OntologyInputEvent) {
    this.record(ev, 'relational');
  }

  @OnEvent(ONTOLOGY_EVENTS.EMOTIONAL_INPUT, { async: true })
  handleEmotional(ev: OntologyInputEvent) {
    this.record(ev, 'emotional');
  }

  private async record(ev: OntologyInputEvent, domain: OntologyDomain) {
    if (!ev?.userId) return;
    try {
      await this.prisma.ontologyEvent.create({
        data: {
          userId: ev.userId,
          domain,
          eventType: ev.eventType || 'unknown',
          scopeId: ev.scopeId || null,
          payload: JSON.stringify(ev.payload || {}),
        },
      });
      this.synthesis.scheduleSynthesis(
        ev.userId,
        domain,
        ev.scopeId || null,
      );
    } catch (err: any) {
      this.logger.warn(
        `Failed to record ontology event (${domain}/${ev.eventType}): ${err?.message || err}`,
      );
    }
  }
}
