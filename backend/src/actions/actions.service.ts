import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { ONTOLOGY_EVENTS } from '../ontology/events';
import { dedupePendingActions } from './action-dedup.util';

@Injectable()
export class ActionsService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  async getActionItems(userId: string, status?: string) {
    // Auto-clean: dismiss any existing pending duplicates (keeps earliest).
    // Fire-and-forget so the fetch stays fast even if cleanup errors.
    try {
      await dedupePendingActions(this.prisma, userId);
    } catch {
      // non-fatal; proceed with fetch
    }

    const where: Record<string, any> = { userId };
    if (status) where.status = status;

    const items = await this.prisma.actionItem.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Batch fetch related threads and personas to avoid N+1
    const threadIds = [...new Set(items.filter((i) => i.threadId).map((i) => i.threadId!))];
    const personaIds = [...new Set(items.filter((i) => i.personaId).map((i) => i.personaId!))];

    const [threads, personas] = await Promise.all([
      threadIds.length > 0
        ? this.prisma.thoughtThread.findMany({
            where: { id: { in: threadIds } },
            include: { thought: { select: { id: true, title: true } } },
          })
        : [],
      personaIds.length > 0
        ? this.prisma.persona.findMany({
            where: { id: { in: personaIds } },
            select: { id: true, name: true },
          })
        : [],
    ]);

    const threadMap = new Map(threads.map((t) => [t.id, t] as const));
    const personaMap = new Map(personas.map((p) => [p.id, p.name] as const));

    return items.map((item) => {
      let thoughtTitle: string = 'Core Chat';
      let thoughtId: string | null = null;
      if (item.threadId) {
        const thread = threadMap.get(item.threadId);
        thoughtTitle = thread?.thought?.title || 'Unknown';
        thoughtId = thread?.thought?.id || null;
      }
      const personaName = item.personaId ? personaMap.get(item.personaId) || null : null;
      return {
        ...item,
        thoughtTitle,
        thoughtId,
        personaName: personaName || (item.threadId ? null : '4Ever Core'),
      };
    });
  }

  async updateActionStatus(
    userId: string,
    itemId: string,
    status: 'done' | 'dismissed',
  ) {
    const item = await this.prisma.actionItem.findFirst({
      where: { id: itemId, userId },
    });

    if (!item) throw new NotFoundException('Action item not found');

    const updated = await this.prisma.actionItem.update({
      where: { id: itemId },
      data: { status },
    });

    this.events.emit(ONTOLOGY_EVENTS.SELF_INPUT, {
      userId,
      eventType: 'action.status_changed',
      payload: { itemId, status },
    });

    return updated;
  }

  async linkToPlanner(
    userId: string,
    itemId: string,
    date: string,
    timeSlot: string,
  ) {
    const item = await this.prisma.actionItem.findFirst({
      where: { id: itemId, userId },
    });

    if (!item) throw new NotFoundException('Action item not found');

    const dateObj = new Date(date + 'T00:00:00.000Z');

    // Upsert the day plan
    const plan = await this.prisma.dayPlan.upsert({
      where: { userId_date: { userId, date: dateObj } },
      create: { userId, date: dateObj },
      update: { updatedAt: new Date() },
    });

    // Count existing tasks to set sort order
    const existingCount = await this.prisma.planTask.count({
      where: { planId: plan.id },
    });

    // Create the task
    const task = await this.prisma.planTask.create({
      data: {
        planId: plan.id,
        timeSlot,
        task: item.content,
        sortOrder: existingCount,
      },
    });

    // Mark action item as done
    await this.prisma.actionItem.update({
      where: { id: itemId },
      data: { status: 'done' },
    });

    this.events.emit(ONTOLOGY_EVENTS.SELF_INPUT, {
      userId,
      eventType: 'action.linked_to_planner',
      payload: { itemId, date, timeSlot },
    });

    return task;
  }
}
