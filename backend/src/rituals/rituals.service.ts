import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRitualDto } from './dto/create-ritual.dto';
import { ONTOLOGY_EVENTS } from '../ontology/events';

@Injectable()
export class RitualsService {
  private readonly logger = new Logger(RitualsService.name);

  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  async create(userId: string, dto: CreateRitualDto) {
    const ritual = await this.prisma.relationshipRitual.create({
      data: {
        userId,
        title: dto.title,
        frequency: dto.frequency,
        personId: dto.personId || null,
        dayOfWeek: dto.dayOfWeek ?? null,
      },
      include: { person: { select: { id: true, name: true, relationship: true } } },
    });
    if (dto.personId) {
      this.events.emit(ONTOLOGY_EVENTS.RELATIONAL_INPUT, {
        userId,
        eventType: 'ritual.created',
        scopeId: dto.personId,
        payload: { title: dto.title, frequency: dto.frequency },
      });
    }
    return ritual;
  }

  async findAll(userId: string) {
    const rituals = await this.prisma.relationshipRitual.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
      include: { person: { select: { id: true, name: true, relationship: true } } },
    });

    // Compute overdue status for each ritual
    const now = new Date();
    return rituals.map((r) => ({
      ...r,
      isOverdue: this.isOverdue(r, now),
      nextDue: this.getNextDue(r),
    }));
  }

  async complete(userId: string, id: string) {
    const ritual = await this.prisma.relationshipRitual.findFirst({
      where: { id, userId },
    });
    if (!ritual) throw new NotFoundException('Ritual not found');

    const now = new Date();
    const wasOverdue = this.isOverdue(ritual, now);
    // If the ritual was completed on time (not overdue), increment streak; otherwise reset to 1
    const newStreak = wasOverdue ? 1 : ritual.streak + 1;

    const updated = await this.prisma.relationshipRitual.update({
      where: { id },
      data: {
        lastDoneAt: now,
        streak: newStreak,
      },
      include: { person: { select: { id: true, name: true, relationship: true } } },
    });
    if (ritual.personId) {
      this.events.emit(ONTOLOGY_EVENTS.RELATIONAL_INPUT, {
        userId,
        eventType: 'ritual.completed',
        scopeId: ritual.personId,
        payload: { streak: newStreak },
      });
    }
    return updated;
  }

  async remove(userId: string, id: string) {
    const ritual = await this.prisma.relationshipRitual.findFirst({
      where: { id, userId },
    });
    if (!ritual) throw new NotFoundException('Ritual not found');

    await this.prisma.relationshipRitual.update({
      where: { id },
      data: { isActive: false },
    });
    return { success: true };
  }

  private isOverdue(ritual: { frequency: string; lastDoneAt: Date | null }, now: Date): boolean {
    if (!ritual.lastDoneAt) return true;
    const elapsed = now.getTime() - ritual.lastDoneAt.getTime();
    const days = elapsed / (1000 * 60 * 60 * 24);

    switch (ritual.frequency) {
      case 'daily': return days >= 1.5;
      case 'weekly': return days >= 8;
      case 'biweekly': return days >= 15;
      case 'monthly': return days >= 32;
      default: return days >= 8;
    }
  }

  private getNextDue(ritual: { frequency: string; lastDoneAt: Date | null }): string | null {
    if (!ritual.lastDoneAt) return 'now';
    const last = new Date(ritual.lastDoneAt);

    switch (ritual.frequency) {
      case 'daily': last.setDate(last.getDate() + 1); break;
      case 'weekly': last.setDate(last.getDate() + 7); break;
      case 'biweekly': last.setDate(last.getDate() + 14); break;
      case 'monthly': last.setMonth(last.getMonth() + 1); break;
      default: last.setDate(last.getDate() + 7);
    }

    return last.toISOString().split('T')[0];
  }
}
