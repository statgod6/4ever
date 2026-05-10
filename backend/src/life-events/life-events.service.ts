import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLifeEventDto } from './dto/create-life-event.dto';
import { ONTOLOGY_EVENTS } from '../ontology/events';

@Injectable()
export class LifeEventsService {
  private readonly logger = new Logger(LifeEventsService.name);

  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  async create(userId: string, dto: CreateLifeEventDto) {
    const event = await this.prisma.lifeEvent.create({
      data: {
        userId,
        title: dto.title,
        eventDate: new Date(dto.eventDate + 'T00:00:00.000Z'),
        eventType: dto.eventType,
        personId: dto.personId || null,
        isRecurring: dto.isRecurring ?? false,
        remindDaysBefore: dto.remindDaysBefore ?? 1,
        note: dto.note || null,
      },
      include: { person: { select: { id: true, name: true, relationship: true } } },
    });

    if (dto.personId) {
      this.events.emit(ONTOLOGY_EVENTS.RELATIONAL_INPUT, {
        userId,
        eventType: 'lifeevent.created',
        scopeId: dto.personId,
        payload: { title: dto.title, eventType: dto.eventType, eventDate: dto.eventDate },
      });
    }
    return event;
  }

  async findAll(userId: string) {
    return this.prisma.lifeEvent.findMany({
      where: { userId },
      orderBy: { eventDate: 'asc' },
      include: { person: { select: { id: true, name: true, relationship: true } } },
    });
  }

  async findUpcoming(userId: string, days = 30) {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const today = new Date(todayStr + 'T00:00:00.000Z');
    const future = new Date(today);
    future.setDate(future.getDate() + days);

    const events = await this.prisma.lifeEvent.findMany({
      where: {
        userId,
        eventDate: { gte: today, lte: future },
      },
      orderBy: { eventDate: 'asc' },
      include: { person: { select: { id: true, name: true, relationship: true } } },
    });

    // Also check recurring events (same month/day in any year)
    const allRecurring = await this.prisma.lifeEvent.findMany({
      where: { userId, isRecurring: true },
      include: { person: { select: { id: true, name: true, relationship: true } } },
    });

    const upcomingRecurring = allRecurring.filter((e) => {
      const evDate = new Date(e.eventDate);
      // Check if the month/day falls within the upcoming window
      const thisYearDate = new Date(Date.UTC(now.getFullYear(), evDate.getUTCMonth(), evDate.getUTCDate()));
      if (thisYearDate < today) {
        // Try next year
        thisYearDate.setFullYear(thisYearDate.getFullYear() + 1);
      }
      return thisYearDate >= today && thisYearDate <= future;
    }).map((e) => {
      const evDate = new Date(e.eventDate);
      const thisYearDate = new Date(Date.UTC(now.getFullYear(), evDate.getUTCMonth(), evDate.getUTCDate()));
      if (thisYearDate < today) thisYearDate.setFullYear(thisYearDate.getFullYear() + 1);
      return { ...e, nextOccurrence: thisYearDate.toISOString().split('T')[0] };
    });

    // Merge, deduplicate by id, sort
    const eventMap = new Map<string, any>();
    for (const e of events) eventMap.set(e.id, e);
    for (const e of upcomingRecurring) {
      if (!eventMap.has(e.id)) eventMap.set(e.id, e);
    }

    const merged = Array.from(eventMap.values());
    merged.sort((a: any, b: any) => {
      const dateA = a.nextOccurrence || a.eventDate;
      const dateB = b.nextOccurrence || b.eventDate;
      return new Date(dateA).getTime() - new Date(dateB).getTime();
    });

    return merged;
  }

  async findByPerson(userId: string, personId: string) {
    return this.prisma.lifeEvent.findMany({
      where: { userId, personId },
      orderBy: { eventDate: 'asc' },
    });
  }

  async remove(userId: string, id: string) {
    const event = await this.prisma.lifeEvent.findFirst({
      where: { id, userId },
    });
    if (!event) throw new NotFoundException('Life event not found');

    await this.prisma.lifeEvent.delete({ where: { id } });
    return { success: true };
  }
}
