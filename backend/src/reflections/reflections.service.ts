import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { ChatOpenRouter } from '@langchain/openrouter';
import { ONTOLOGY_EVENTS } from '../ontology/events';

@Injectable()
export class ReflectionsService {
  private readonly logger = new Logger(ReflectionsService.name);
  private openRouterApiKey: string;
  private defaultModel: string;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private events: EventEmitter2,
  ) {
    this.openRouterApiKey =
      this.configService.get<string>('OPENROUTER_API_KEY') || '';
    this.defaultModel =
      this.configService.get<string>('OPENROUTER_DEFAULT_MODEL') ||
      'deepseek/deepseek-v3.2';
  }

  /**
   * Evening reflection: reviews today's plan completion, mood, and recent thoughts.
   */
  async generateEveningReflection(userId: string) {
    const todayStr = new Date().toISOString().split('T')[0];
    const todayDate = new Date(todayStr + 'T00:00:00Z');

    // Fetch today's plan + tasks
    const dayPlan = await this.prisma.dayPlan.findUnique({
      where: { userId_date: { userId, date: todayDate } },
      include: { tasks: { orderBy: { sortOrder: 'asc' } } },
    });

    // Fetch today's check-in
    const checkIn = await this.prisma.dailyCheckIn.findUnique({
      where: { userId_date: { userId, date: todayDate } },
    });

    // Fetch today's thoughts
    const startOfDay = new Date(todayStr + 'T00:00:00Z');
    const endOfDay = new Date(todayStr + 'T23:59:59Z');
    const todayThoughts = await this.prisma.thought.findMany({
      where: { userId, createdAt: { gte: startOfDay, lte: endOfDay } },
      select: { title: true, thoughtType: true, rawText: true },
      take: 10,
    });

    // Build context
    const parts: string[] = [];
    parts.push(`Date: ${todayStr}`);

    if (dayPlan && dayPlan.tasks.length > 0) {
      const total = dayPlan.tasks.length;
      const done = dayPlan.tasks.filter((t) => t.status === 'done').length;
      const skipped = dayPlan.tasks.filter((t) => t.status === 'skipped').length;
      const pending = total - done - skipped;
      parts.push(`\nPlan: ${total} tasks — ${done} done, ${skipped} skipped, ${pending} still pending`);
      parts.push(
        'Tasks:\n' +
          dayPlan.tasks
            .map(
              (t) =>
                `  • ${t.timeSlot}: ${t.task} [${t.status.toUpperCase()}]`,
            )
            .join('\n'),
      );
    } else {
      parts.push('\nNo plan was set for today.');
    }

    if (checkIn) {
      parts.push(
        `\nMood: ${checkIn.mood}/5, Energy: ${checkIn.energy}/5${checkIn.note ? `, Note: "${checkIn.note}"` : ''}`,
      );
    }

    if (todayThoughts.length > 0) {
      parts.push(
        `\nThoughts captured today (${todayThoughts.length}):\n` +
          todayThoughts
            .map((t) => `  • [${t.thoughtType}] ${t.title}`)
            .join('\n'),
      );
    }

    const model = new ChatOpenRouter({
      model: this.defaultModel,
      temperature: 0.7,
      maxTokens: 512,
      apiKey: this.openRouterApiKey,
    });

    const response = await model.invoke([
      {
        role: 'system',
        content:
          'You are a warm, thoughtful evening reflection coach. Generate a brief evening reflection prompt (3-5 sentences) based on the user\'s day. ' +
          'Reference specific tasks, mood, or thoughts. Ask 1-2 gentle questions to encourage reflection. ' +
          'Be encouraging but honest. If tasks were skipped, be curious not judgmental. Write in second person. Use markdown.',
      },
      {
        role: 'user',
        content: `Generate an evening reflection for this day:\n\n${parts.join('\n')}`,
      },
    ]);

    const text =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    this.events.emit(ONTOLOGY_EVENTS.EMOTIONAL_INPUT, {
      userId,
      eventType: 'reflection.saved',
      payload: { kind: 'evening', date: todayStr },
    });
    this.events.emit(ONTOLOGY_EVENTS.SELF_INPUT, {
      userId,
      eventType: 'reflection.saved',
      payload: { kind: 'evening', date: todayStr },
    });

    return { reflection: text, date: todayStr };
  }

  /**
   * Weekly reflection: reviews the past 7 days of plans, check-ins, and thinking patterns.
   */
  async generateWeeklyReflection(userId: string) {
    const now = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(now.getDate() - 7);
    const sinceDate = new Date(
      Date.UTC(
        sevenDaysAgo.getFullYear(),
        sevenDaysAgo.getMonth(),
        sevenDaysAgo.getDate(),
      ),
    );

    // Fetch week's plans with tasks
    const plans = await this.prisma.dayPlan.findMany({
      where: { userId, date: { gte: sinceDate } },
      include: { tasks: true },
      orderBy: { date: 'asc' },
    });

    // Fetch week's check-ins
    const checkIns = await this.prisma.dailyCheckIn.findMany({
      where: { userId, date: { gte: sinceDate } },
      orderBy: { date: 'asc' },
    });

    // Fetch week's thoughts count and types
    const thoughts = await this.prisma.thought.findMany({
      where: { userId, createdAt: { gte: sevenDaysAgo } },
      select: { title: true, thoughtType: true },
    });

    // Compute stats
    const totalTasks = plans.reduce((s, p) => s + p.tasks.length, 0);
    const doneTasks = plans.reduce(
      (s, p) => s + p.tasks.filter((t) => t.status === 'done').length,
      0,
    );
    const skippedTasks = plans.reduce(
      (s, p) => s + p.tasks.filter((t) => t.status === 'skipped').length,
      0,
    );
    const avgMood =
      checkIns.length > 0
        ? (checkIns.reduce((s, c) => s + c.mood, 0) / checkIns.length).toFixed(1)
        : 'N/A';
    const avgEnergy =
      checkIns.length > 0
        ? (checkIns.reduce((s, c) => s + c.energy, 0) / checkIns.length).toFixed(1)
        : 'N/A';

    const parts: string[] = [];
    parts.push(`Week ending: ${now.toISOString().split('T')[0]}`);
    parts.push(`Days planned: ${plans.length}/7`);
    parts.push(`Total tasks: ${totalTasks} — ${doneTasks} done, ${skippedTasks} skipped, ${totalTasks - doneTasks - skippedTasks} pending`);
    parts.push(`Completion rate: ${totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0}%`);
    parts.push(`Check-ins logged: ${checkIns.length}/7`);
    parts.push(`Average mood: ${avgMood}/5, Average energy: ${avgEnergy}/5`);
    parts.push(`Thoughts captured: ${thoughts.length}`);

    if (thoughts.length > 0) {
      const typeCount: Record<string, number> = {};
      thoughts.forEach((t) => {
        typeCount[t.thoughtType] = (typeCount[t.thoughtType] || 0) + 1;
      });
      parts.push(
        `Thinking topics: ${Object.entries(typeCount).map(([k, v]) => `${k} (${v})`).join(', ')}`,
      );
    }

    // Mood trend
    if (checkIns.length >= 2) {
      const firstHalf = checkIns.slice(0, Math.ceil(checkIns.length / 2));
      const secondHalf = checkIns.slice(Math.ceil(checkIns.length / 2));
      const firstAvg = firstHalf.reduce((s, c) => s + c.mood, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((s, c) => s + c.mood, 0) / secondHalf.length;
      const trend = secondAvg > firstAvg ? 'improving' : secondAvg < firstAvg ? 'declining' : 'stable';
      parts.push(`Mood trend: ${trend}`);
    }

    const model = new ChatOpenRouter({
      model: this.defaultModel,
      temperature: 0.7,
      maxTokens: 768,
      apiKey: this.openRouterApiKey,
    });

    const response = await model.invoke([
      {
        role: 'system',
        content:
          'You are a thoughtful weekly reflection coach. Generate a weekly reflection (5-8 sentences) based on the user\'s week data. ' +
          'Highlight patterns: What went well? Where did they struggle? How was their energy/mood? ' +
          'End with 2 questions: one backward-looking ("What\'s one thing you\'d do differently?") and one forward-looking ("What\'s your intention for next week?"). ' +
          'Be warm, honest, and specific. Write in second person. Use markdown.',
      },
      {
        role: 'user',
        content: `Generate a weekly reflection:\n\n${parts.join('\n')}`,
      },
    ]);

    const text =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    this.events.emit(ONTOLOGY_EVENTS.EMOTIONAL_INPUT, {
      userId,
      eventType: 'reflection.saved',
      payload: { kind: 'weekly' },
    });
    this.events.emit(ONTOLOGY_EVENTS.SELF_INPUT, {
      userId,
      eventType: 'reflection.saved',
      payload: { kind: 'weekly' },
    });

    return {
      reflection: text,
      stats: {
        totalTasks,
        doneTasks,
        skippedTasks,
        completionRate: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
        avgMood,
        avgEnergy,
        thoughtCount: thoughts.length,
        daysPlanned: plans.length,
        checkInsLogged: checkIns.length,
      },
    };
  }
}
