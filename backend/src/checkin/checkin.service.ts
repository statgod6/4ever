import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { ONTOLOGY_EVENTS } from '../ontology/events';

@Injectable()
export class CheckInService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  async saveCheckIn(
    userId: string,
    date: string,
    mood: number,
    energy: number,
    note?: string,
  ) {
    const dateObj = new Date(date + 'T00:00:00.000Z');

    const result = await this.prisma.dailyCheckIn.upsert({
      where: {
        userId_date: { userId, date: dateObj },
      },
      create: {
        userId,
        date: dateObj,
        mood,
        energy,
        note: note || null,
      },
      update: {
        mood,
        energy,
        note: note || null,
      },
    });

    this.events.emit(ONTOLOGY_EVENTS.EMOTIONAL_INPUT, {
      userId,
      eventType: 'checkin.saved',
      payload: { date, mood, energy },
    });

    return result;
  }

  async getCheckIn(userId: string, date: string) {
    const dateObj = new Date(date + 'T00:00:00.000Z');
    return this.prisma.dailyCheckIn.findUnique({
      where: {
        userId_date: { userId, date: dateObj },
      },
    });
  }

  async getRecentCheckIns(userId: string, days: number = 14) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceDate = new Date(
      Date.UTC(since.getFullYear(), since.getMonth(), since.getDate()),
    );

    return this.prisma.dailyCheckIn.findMany({
      where: {
        userId,
        date: { gte: sinceDate },
      },
      orderBy: { date: 'desc' },
    });
  }
}
