import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { ChatOpenRouter } from '@langchain/openrouter';
import { ONTOLOGY_EVENTS } from '../ontology/events';

interface SaveTaskInput {
  timeSlot: string;
  task: string;
  sortOrder: number;
  insight?: string | null;
}

const TASK_INSIGHT_SYSTEM_PROMPT = `You are a world-class task strategist and workflow designer.
Given a task and its time slot, break it down into a clear, actionable workflow.

For each step:
1. What exactly to do
2. How long it should take (within the time slot)
3. Pro tips or common pitfalls to avoid

Format as a numbered workflow with clear headers. Be specific, practical, and encouraging.
Keep it concise — this is for quick reference during the day. Use markdown formatting.`;

@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name);
  private openRouterApiKey: string;
  private defaultModel: string;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private events: EventEmitter2,
  ) {
    this.openRouterApiKey = this.configService.get<string>('OPENROUTER_API_KEY') || '';
    this.defaultModel = this.configService.get<string>('OPENROUTER_DEFAULT_MODEL') || 'deepseek/deepseek-v3.2';
  }

  /**
   * Get dates that have plans for a given month (for calendar dots)
   */
  async getPlannedDates(userId: string, year: number, month: number) {
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1));

    const plans = await this.prisma.dayPlan.findMany({
      where: {
        userId,
        date: { gte: startDate, lt: endDate },
      },
      include: {
        _count: { select: { tasks: true } },
      },
    });

    return plans
      .filter((p) => p._count.tasks > 0)
      .map((p) => ({
        date: p.date.toISOString().split('T')[0],
        taskCount: p._count.tasks,
      }));
  }

  /**
   * Get day plan + tasks for a specific date
   */
  async getPlan(userId: string, date: string) {
    const dateObj = new Date(date + 'T00:00:00.000Z');

    const plan = await this.prisma.dayPlan.findUnique({
      where: {
        userId_date: { userId, date: dateObj },
      },
      include: {
        tasks: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    return plan;
  }

  /**
   * Create or update a day plan with tasks.
   * Replaces all tasks for that date with the new set.
   */
  async savePlan(userId: string, date: string, tasks: SaveTaskInput[]) {
    const dateObj = new Date(date + 'T00:00:00.000Z');

    // Upsert the day plan
    const plan = await this.prisma.dayPlan.upsert({
      where: {
        userId_date: { userId, date: dateObj },
      },
      create: {
        userId,
        date: dateObj,
      },
      update: {
        updatedAt: new Date(),
      },
    });

    // Delete existing tasks and recreate
    await this.prisma.planTask.deleteMany({
      where: { planId: plan.id },
    });

    // Create new tasks
    if (tasks.length > 0) {
      await this.prisma.planTask.createMany({
        data: tasks.map((t, i) => ({
          planId: plan.id,
          timeSlot: t.timeSlot,
          task: t.task,
          insight: t.insight || null,
          sortOrder: t.sortOrder ?? i,
        })),
      });
    }

    // Return the full plan with tasks
    const full = await this.prisma.dayPlan.findUnique({
      where: { id: plan.id },
      include: {
        tasks: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    this.events.emit(ONTOLOGY_EVENTS.SELF_INPUT, {
      userId,
      eventType: 'planner.plan_saved',
      payload: { date, taskCount: tasks.length },
    });

    return full;
  }

  /**
   * Update a task's completion status.
   */
  async updateTaskStatus(userId: string, taskId: string, status: 'done' | 'skipped' | 'pending') {
    const task = await this.prisma.planTask.findUnique({
      where: { id: taskId },
      include: { plan: true },
    });

    if (!task || task.plan.userId !== userId) {
      throw new NotFoundException('Task not found');
    }

    const updated = await this.prisma.planTask.update({
      where: { id: taskId },
      data: {
        status,
        completedAt: status === 'done' ? new Date() : null,
      },
    });

    this.events.emit(ONTOLOGY_EVENTS.SELF_INPUT, {
      userId,
      eventType: 'planner.task_status_changed',
      payload: { taskId, status },
    });

    return updated;
  }

  /**
   * Get completion stats over the last N days.
   */
  async getCompletionStats(userId: string, days: number = 7) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceDate = new Date(Date.UTC(since.getFullYear(), since.getMonth(), since.getDate()));

    const plans = await this.prisma.dayPlan.findMany({
      where: {
        userId,
        date: { gte: sinceDate },
      },
      include: { tasks: true },
    });

    const allTasks = plans.flatMap((p) => p.tasks);
    const total = allTasks.length;
    const done = allTasks.filter((t) => t.status === 'done').length;
    const skipped = allTasks.filter((t) => t.status === 'skipped').length;
    const pending = allTasks.filter((t) => t.status === 'pending').length;
    const completionRate = total > 0 ? Math.round((done / total) * 100) : 0;

    // Calculate streak (consecutive days with all tasks done)
    const today = new Date();
    let streak = 0;
    for (let i = 1; i <= days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const plan = plans.find((p) => p.date.toISOString().split('T')[0] === dateStr);
      if (plan && plan.tasks.length > 0 && plan.tasks.every((t) => t.status === 'done')) {
        streak++;
      } else if (plan && plan.tasks.length > 0) {
        break;
      }
    }

    return { total, done, skipped, pending, completionRate, streak, days };
  }

  /**
   * Generate an AI-powered workflow breakdown for a task.
   * Caches the result in the task's insight field.
   */
  async getTaskInsight(userId: string, taskId: string) {
    // Verify the task belongs to this user
    const task = await this.prisma.planTask.findUnique({
      where: { id: taskId },
      include: {
        plan: true,
      },
    });

    if (!task || task.plan.userId !== userId) {
      throw new NotFoundException('Task not found');
    }

    // Return cached insight if available
    if (task.insight) {
      return { taskId: task.id, insight: task.insight, cached: true };
    }

    // Generate insight via LLM
    const model = new ChatOpenRouter({
      model: this.defaultModel,
      temperature: 0.5,
      maxTokens: 1024,
      apiKey: this.openRouterApiKey,
    });

    const response = await model.invoke([
      { role: 'system', content: TASK_INSIGHT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Time Slot: ${task.timeSlot}\nTask: ${task.task}\n\nBreak this down into an actionable workflow I can follow step by step.`,
      },
    ]);

    const insight = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    // Cache the insight
    await this.prisma.planTask.update({
      where: { id: taskId },
      data: { insight },
    });

    return { taskId: task.id, insight, cached: false };
  }
}
