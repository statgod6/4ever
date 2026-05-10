import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTensionDto } from './dto/create-tension.dto';
import { ONTOLOGY_EVENTS } from '../ontology/events';

@Injectable()
export class TensionsService {
  private readonly logger = new Logger(TensionsService.name);

  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  private emitTension(userId: string, eventType: string, personId?: string | null) {
    this.events.emit(ONTOLOGY_EVENTS.EMOTIONAL_INPUT, {
      userId,
      eventType,
      payload: { personId: personId || null },
    });
    if (personId) {
      this.events.emit(ONTOLOGY_EVENTS.RELATIONAL_INPUT, {
        userId,
        eventType,
        scopeId: personId,
        payload: {},
      });
    }
  }

  async create(userId: string, dto: CreateTensionDto) {
    const coolDownUntil = dto.coolDownMinutes
      ? new Date(Date.now() + dto.coolDownMinutes * 60 * 1000)
      : null;

    const entry = await this.prisma.tensionEntry.create({
      data: {
        userId,
        title: dto.title,
        description: dto.description,
        personId: dto.personId || null,
        intensity: dto.intensity ?? 5,
        status: coolDownUntil ? 'cooling_down' : 'active',
        coolDownUntil,
      },
      include: { person: { select: { id: true, name: true, relationship: true } } },
    });
    this.emitTension(userId, 'tension.created', dto.personId || null);
    return entry;
  }

  async findAll(userId: string) {
    const entries = await this.prisma.tensionEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { person: { select: { id: true, name: true, relationship: true } } },
    });

    // Auto-update cooling_down -> active if timer expired
    const now = new Date();
    const updates: Promise<any>[] = [];
    for (const entry of entries) {
      if (entry.status === 'cooling_down' && entry.coolDownUntil && entry.coolDownUntil <= now) {
        entry.status = 'active';
        entry.coolDownUntil = null;
        updates.push(
          this.prisma.tensionEntry.update({
            where: { id: entry.id },
            data: { status: 'active', coolDownUntil: null },
          }),
        );
      }
    }
    if (updates.length > 0) await Promise.all(updates);

    return entries;
  }

  async startCoolDown(userId: string, id: string, minutes: number) {
    const entry = await this.prisma.tensionEntry.findFirst({
      where: { id, userId },
    });
    if (!entry) throw new NotFoundException('Tension entry not found');

    const coolDownUntil = new Date(Date.now() + minutes * 60 * 1000);
    const updated = await this.prisma.tensionEntry.update({
      where: { id },
      data: { status: 'cooling_down', coolDownUntil },
      include: { person: { select: { id: true, name: true, relationship: true } } },
    });
    this.emitTension(userId, 'tension.cooldown', entry.personId);
    return updated;
  }

  async resolve(userId: string, id: string, resolution?: string) {
    const entry = await this.prisma.tensionEntry.findFirst({
      where: { id, userId },
    });
    if (!entry) throw new NotFoundException('Tension entry not found');

    const updated = await this.prisma.tensionEntry.update({
      where: { id },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
        resolution: resolution || null,
        coolDownUntil: null,
      },
      include: { person: { select: { id: true, name: true, relationship: true } } },
    });
    this.emitTension(userId, 'tension.resolved', entry.personId);
    return updated;
  }

  async remove(userId: string, id: string) {
    const entry = await this.prisma.tensionEntry.findFirst({
      where: { id, userId },
    });
    if (!entry) throw new NotFoundException('Tension entry not found');

    await this.prisma.tensionEntry.delete({ where: { id } });
    return { success: true };
  }
}
