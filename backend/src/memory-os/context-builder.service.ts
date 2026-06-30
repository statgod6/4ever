import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryManagerService, MemoryType, RetrievedMemory } from './memory-manager.service';
import { classifyContextScope, ContextScope } from '../orchestration/context-scope';
import { timeAgo } from '../orchestration/utils/time.util';

export interface ContextBlock {
  section: string;
  content: string;
}

/**
 * Context Builder — the "I need context" abstraction layer.
 *
 * Called before every agent invocation. Decides:
 *  - What to retrieve (goals, identity, memories, patterns)
 *  - What to ignore (low-strength, archived)
 *  - What to summarize (sessions, episodes)
 *  - What to always-inject (goals, identity, patterns)
 *
 * Replaces the old buildCoreChatContext() in OrchestrationService.
 */
@Injectable()
export class ContextBuilderService {
  private readonly logger = new Logger(ContextBuilderService.name);

  constructor(
    private prisma: PrismaService,
    private memoryManager: MemoryManagerService,
  ) {}

  /**
   * Build full context for a Core Chat request.
   * Returns formatted context blocks ready for system prompt injection.
   */
  async build(
    userId: string,
    message: string,
    opts?: { includeOntology?: boolean; ontologyBlocks?: string[] },
  ): Promise<ContextBlock[]> {
    const scope = classifyContextScope(message);
    const blocks: ContextBlock[] = [];

    // ── Ontology Layer 0 (prepended when provided) ─────────────────────
    if (opts?.includeOntology && opts.ontologyBlocks && opts.ontologyBlocks.length > 0) {
      for (const b of opts.ontologyBlocks) {
        blocks.push({ section: 'ONTOLOGY', content: b });
      }
    }

    // ── ALWAYS-INJECT layer (every request) ────────────────────────────
    const [goals, identity, patterns, userProfile] = await Promise.all([
      this.fetchGoals(userId),
      this.fetchIdentity(userId),
      this.fetchPatterns(userId),
      this.fetchUserProfile(userId),
    ]);

    if (goals) blocks.push({ section: 'YOUR GOALS', content: goals });
    if (identity) blocks.push({ section: 'WHO YOU ARE', content: identity });
    if (userProfile) blocks.push({ section: 'USER PROFILE', content: userProfile });

    // ── CONTEXTUAL layer (based on message content / scope) ────────────
    const relevantMemories = await this.fetchRelevantMemories(userId, message);
    if (relevantMemories) blocks.push({ section: 'WHAT YOU KNOW', content: relevantMemories });

    if (patterns) blocks.push({ section: 'BEHAVIORAL PATTERNS', content: patterns });

    // ── SCOPE-SPECIFIC layers ──────────────────────────────────────────
    if (scope === 'relationship' || scope === 'general') {
      const relContext = await this.fetchRelationshipContext(userId);
      if (relContext) blocks.push({ section: 'RELATIONSHIP CONTEXT', content: relContext });
    }

    if (scope === 'planner') {
      const [pending, calendar, completionStats, completed] = await Promise.all([
        this.fetchPendingActions(userId),
        this.fetchCalendar(userId),
        this.fetchCompletionStats(userId),
        this.fetchCompletedActions(userId),
      ]);
      if (completionStats) blocks.push({ section: 'TASK COMPLETION PATTERNS', content: completionStats });
      if (pending) blocks.push({ section: 'PENDING ACTION ITEMS', content: pending });
      if (completed) blocks.push({ section: 'RECENTLY COMPLETED ACTIONS', content: completed });
      if (calendar) blocks.push({ section: 'TODAY\'S SCHEDULE & UPCOMING', content: calendar });
    }

    if (scope === 'life_review') {
      const mood = await this.fetchMood(userId);
      if (mood) blocks.push({ section: 'MOOD & ENERGY (LAST 7 DAYS)', content: mood });
    }

    if (scope === 'memory_recall') {
      const [thoughts, threads] = await Promise.all([
        this.fetchRecentThoughts(userId),
        this.fetchThreadSummaries(userId),
      ]);
      if (thoughts) blocks.push({ section: 'RECENT THOUGHTS', content: thoughts });
      if (threads) blocks.push({ section: 'ACTIVE THREAD SUMMARIES', content: threads });
    }

    if (scope === 'messaging' || scope === 'general') {
      const [connections, unread, sharedNotes] = await Promise.all([
        this.fetchConnections(userId),
        this.fetchUnreadMessages(userId),
        this.fetchSharedNotes(userId),
      ]);
      if (connections) blocks.push({ section: '4EVER CONNECTIONS', content: connections });
      if (unread) blocks.push({ section: 'UNREAD MESSAGES', content: unread });
      if (sharedNotes) blocks.push({ section: 'RECENT SHARED NOTES', content: sharedNotes });
    }

    if (scope === 'relationship') {
      const events = await this.fetchUpcomingEvents(userId);
      if (events) blocks.push({ section: 'UPCOMING RELATIONSHIP EVENTS', content: events });
    }

    // ── ALWAYS: Session summaries for continuity ───────────────────────
    const sessions = await this.fetchSessionSummaries(userId);
    if (sessions) blocks.push({ section: 'PREVIOUS SESSION CONTEXT', content: sessions });

    // ── ALWAYS: Available personas ─────────────────────────────────────
    const personas = await this.fetchAvailablePersonas(userId);
    if (personas) blocks.push({ section: 'AVAILABLE PERSONAS', content: personas });

    return blocks;
  }

  /**
   * Format context blocks into a string array for system prompt injection.
   */
  formatForPrompt(blocks: ContextBlock[]): string[] {
    return blocks.map(b => `--- ${b.section} ---\n${b.content}`);
  }

  // ── ALWAYS-INJECT fetchers ─────────────────────────────────────────────

  private async fetchGoals(userId: string): Promise<string | null> {
    try {
      const goals = await this.memoryManager.getByType(userId, 'goal', { limit: 5 });
      if (goals.length === 0) {
        // Fallback: check user_contexts.goals
        const ctx = await this.prisma.userContext.findUnique({ where: { userId } });
        if (ctx?.goals) return `Goals: ${ctx.goals}`;
        return null;
      }
      return goals.map((g, i) =>
        `${i + 1}. ${g.content} (importance: ${(g.importanceScore * 100).toFixed(0)}%, confidence: ${(g.confidence * 100).toFixed(0)}%)`
      ).join('\n');
    } catch (err: any) {
      this.logger.warn(`Goal fetch failed: ${err.message}`);
      return null;
    }
  }

  private async fetchIdentity(userId: string): Promise<string | null> {
    try {
      const identity = await this.memoryManager.getByType(userId, 'identity', { limit: 3 });
      if (identity.length === 0) {
        // Fallback: user_context fields
        const ctx = await this.prisma.userContext.findUnique({ where: { userId } });
        if (!ctx) return null;
        const parts = [
          ctx.name && `Name: ${ctx.name}`,
          ctx.role && `Role: ${ctx.role}`,
          ctx.background && `Background: ${ctx.background}`,
          ctx.values && `Values: ${ctx.values}`,
        ].filter(Boolean);
        return parts.length > 0 ? parts.join('\n') : null;
      }
      return identity.map(m => `- ${m.content}`).join('\n');
    } catch (err: any) {
      this.logger.warn(`Identity fetch failed: ${err.message}`);
      return null;
    }
  }

  private async fetchPatterns(userId: string): Promise<string | null> {
    try {
      const patterns = await this.prisma.memoryPattern.findMany({
        where: { userId, isActive: true },
        orderBy: { confidence: 'desc' },
        take: 5,
      });
      if (patterns.length === 0) return null;
      return patterns.map(p =>
        `- ${p.pattern} (confidence: ${(p.confidence * 100).toFixed(0)}%)`
      ).join('\n');
    } catch (err: any) {
      this.logger.warn(`Pattern fetch failed: ${err.message}`);
      return null;
    }
  }

  private async fetchUserProfile(userId: string): Promise<string | null> {
    try {
      const ctx = await this.prisma.userContext.findUnique({ where: { userId } });
      if (!ctx) return null;

      const fields = [
        ctx.name && `Name: ${ctx.name}`,
        ctx.age && `Age: ${ctx.age}`,
        ctx.role && `Role: ${ctx.role}`,
        ctx.location && `Location: ${ctx.location}`,
        ctx.background && `Background: ${ctx.background}`,
        ctx.goals && `Goals: ${ctx.goals}`,
        ctx.situation && `Current Situation: ${ctx.situation}`,
        ctx.values && `Values: ${ctx.values}`,
        ctx.pendingDecisions && `Pending Decisions: ${ctx.pendingDecisions}`,
        ctx.currentProjects && `Current Projects: ${ctx.currentProjects}`,
        ctx.freeformContext && `Additional Context: ${ctx.freeformContext}`,
      ].filter(Boolean);

      return fields.length > 0 ? fields.join('\n') : null;
    } catch (err: any) {
      this.logger.warn(`User profile fetch failed: ${err.message}`);
      return null;
    }
  }

  // ── CONTEXTUAL fetchers ────────────────────────────────────────────────

  private async fetchRelevantMemories(userId: string, message: string): Promise<string | null> {
    try {
      const memories = await this.memoryManager.retrieve(userId, message, {
        limit: 8,
        // Exclude goals and identity — already in always-inject layer
        types: ['episodic', 'semantic', 'procedural', 'reflection', 'relationship', 'skill', 'episode', 'collective'],
      });

      if (memories.length === 0) return null;

      return memories.map(m => {
        const dateStr = m.createdAt
          ? new Date(m.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : 'unknown';
        const ago = m.createdAt ? ` · ${timeAgo(m.createdAt)}` : '';
        const srcLabel = m.source && m.source !== 'thought' ? ` (via ${m.source.replace('_', ' ')})` : '';
        return `- [${m.memoryType}] [${dateStr}${ago}] ${m.content}${srcLabel}`;
      }).join('\n');
    } catch (err: any) {
      this.logger.warn(`Relevant memories fetch failed: ${err.message}`);
      return null;
    }
  }

  // ── SCOPE-SPECIFIC fetchers (delegate to existing DB queries) ──────────

  private async fetchRelationshipContext(userId: string): Promise<string | null> {
    try {
      const people = await this.prisma.relationshipPerson.findMany({
        where: { userId, isActive: true },
        include: { notes: { take: 3, orderBy: { createdAt: 'desc' } } },
        orderBy: { lastInteractionAt: 'desc' },
        take: 10,
      });
      if (people.length === 0) return null;

      return people.map(p => {
        const lines = [
          `• ${p.name}${p.relationship ? ` (${p.relationship})` : ''}`,
          p.loveLanguage ? `  Love Language: ${p.loveLanguage}` : null,
          p.dynamic ? `  Dynamic: ${p.dynamic}` : null,
          ...p.notes.map(n => `  Note: ${n.content}`),
        ].filter(Boolean);
        return lines.join('\n');
      }).join('\n');
    } catch (err: any) {
      this.logger.warn(`Relationship context fetch failed: ${err.message}`);
      return null;
    }
  }

  private async fetchPendingActions(userId: string): Promise<string | null> {
    try {
      const actions = await this.prisma.actionItem.findMany({
        where: { userId, status: 'pending' },
        orderBy: { dueDate: 'asc' },
        take: 10,
      });
      if (actions.length === 0) return null;
      return actions.map(a => {
        const due = a.dueDate ? ` (due: ${new Date(a.dueDate).toLocaleDateString()})` : '';
        return `- ${a.content}${due}`;
      }).join('\n');
    } catch (err: any) {
      this.logger.warn(`Pending actions fetch failed: ${err.message}`);
      return null;
    }
  }

  private async fetchCalendar(userId: string): Promise<string | null> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 2);

      const plans = await this.prisma.dayPlan.findMany({
        where: { userId, date: { gte: today, lt: tomorrow } },
        include: { tasks: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { date: 'asc' },
      });
      if (plans.length === 0) return null;

      return plans.map(p => {
        const dateStr = new Date(p.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const tasks = p.tasks.map(t =>
          `  ${t.status === 'done' ? '✓' : '○'} ${t.task}${t.timeSlot ? ` (${t.timeSlot})` : ''}`
        ).join('\n');
        return `${dateStr}:\n${tasks}`;
      }).join('\n');
    } catch (err: any) {
      this.logger.warn(`Calendar fetch failed: ${err.message}`);
      return null;
    }
  }

  private async fetchCompletionStats(userId: string): Promise<string | null> {
    try {
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

      const actions = await this.prisma.actionItem.findMany({
        where: { userId, createdAt: { gte: fourteenDaysAgo } },
        select: { status: true },
      });

      if (actions.length === 0) return null;
      const completed = actions.filter(a => a.status === 'done').length;
      const total = actions.length;
      return `Last 14 days: ${completed}/${total} tasks completed (${((completed / total) * 100).toFixed(0)}% completion rate)`;
    } catch (err: any) {
      this.logger.warn(`Completion stats fetch failed: ${err.message}`);
      return null;
    }
  }

  private async fetchCompletedActions(userId: string): Promise<string | null> {
    try {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const actions = await this.prisma.actionItem.findMany({
        where: { userId, status: 'done' },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      if (actions.length === 0) return null;
      return actions.map(a => `- ✓ ${a.content}`).join('\n');
    } catch (err: any) {
      this.logger.warn(`Completed actions fetch failed: ${err.message}`);
      return null;
    }
  }

  private async fetchMood(userId: string): Promise<string | null> {
    try {
      const checkins = await this.prisma.dailyCheckIn.findMany({
        where: { userId },
        orderBy: { date: 'desc' },
        take: 7,
      });
      if (checkins.length === 0) return null;
      return checkins.map(c => {
        const dateStr = new Date(c.date).toLocaleDateString('en-US', { weekday: 'short' });
        const parts = [
          `Mood: ${c.mood}/5`,
          `Energy: ${c.energy}/5`,
          c.note ? `Note: ${c.note.substring(0, 80)}` : null,
        ].filter(Boolean);
        return `${dateStr}: ${parts.join(' | ')}`;
      }).join('\n');
    } catch (err: any) {
      this.logger.warn(`Mood fetch failed: ${err.message}`);
      return null;
    }
  }

  private async fetchRecentThoughts(userId: string): Promise<string | null> {
    try {
      const thoughts = await this.prisma.thought.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      if (thoughts.length === 0) return null;
      return thoughts.map(t => {
        const ago = timeAgo(t.createdAt);
        return `- [${ago}] ${t.title}`;
      }).join('\n');
    } catch (err: any) {
      this.logger.warn(`Recent thoughts fetch failed: ${err.message}`);
      return null;
    }
  }

  private async fetchThreadSummaries(userId: string): Promise<string | null> {
    try {
      const summaries = await this.prisma.thoughtSummary.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 5,
        include: { thread: { select: { thought: { select: { userId: true, title: true } } } } },
      });
      // Filter to only this user's threads
      const userSummaries = summaries.filter(s => s.thread?.thought?.userId === userId);
      if (userSummaries.length === 0) return null;
      return userSummaries.map(s => {
        const ago = timeAgo(s.updatedAt);
        return `- [${ago}] ${s.runningSummary}`;
      }).join('\n');
    } catch (err: any) {
      this.logger.warn(`Thread summaries fetch failed: ${err.message}`);
      return null;
    }
  }

  private async fetchConnections(userId: string): Promise<string | null> {
    try {
      const connections = await this.prisma.connection.findMany({
        where: {
          status: 'accepted',
          OR: [{ requesterId: userId }, { receiverId: userId }],
        },
        include: {
          requester: { select: { id: true, name: true } },
          receiver: { select: { id: true, name: true } },
        },
      });
      if (connections.length === 0) return null;

      const people = connections.map(c => {
        const other = c.requesterId === userId ? c.receiver : c.requester;
        return `- ${other.name}`;
      });
      return `${connections.length} connection(s) on 4Ever:\n${people.join('\n')}`;
    } catch (err: any) {
      this.logger.warn(`Connections fetch failed: ${err.message}`);
      return null;
    }
  }

  private async fetchUnreadMessages(userId: string): Promise<string | null> {
    try {
      const messages = await this.prisma.directMessage.findMany({
        where: { receiverId: userId, isRead: false },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { sender: { select: { name: true } } },
      });
      if (messages.length === 0) return null;

      // Group by sender
      const bySender: Record<string, { count: number; latest: string }> = {};
      for (const msg of messages) {
        const name = msg.sender.name;
        if (!bySender[name]) bySender[name] = { count: 0, latest: '' };
        bySender[name].count++;
        if (!bySender[name].latest) bySender[name].latest = msg.content.substring(0, 80);
      }

      return Object.entries(bySender).map(
        ([name, { count, latest }]) => `- ${name}: ${count} unread — latest: "${latest}"`,
      ).join('\n');
    } catch (err: any) {
      this.logger.warn(`Unread messages fetch failed: ${err.message}`);
      return null;
    }
  }

  private async fetchSharedNotes(userId: string): Promise<string | null> {
    try {
      const connections = await this.prisma.connection.findMany({
        where: {
          status: 'accepted',
          OR: [{ requesterId: userId }, { receiverId: userId }],
        },
        select: { id: true },
      });
      if (connections.length === 0) return null;

      const connIds = connections.map(c => c.id);
      const notes = await this.prisma.sharedNote.findMany({
        where: { connectionId: { in: connIds } },
        include: { author: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      if (notes.length === 0) return null;
      return notes.map(n =>
        `- By ${n.author.name}: ${n.content.substring(0, 100)} (${timeAgo(n.createdAt)})`
      ).join('\n');
    } catch (err: any) {
      this.logger.warn(`Shared notes fetch failed: ${err.message}`);
      return null;
    }
  }

  private async fetchUpcomingEvents(userId: string): Promise<string | null> {
    try {
      const now = new Date();
      const thirtyDays = new Date();
      thirtyDays.setDate(thirtyDays.getDate() + 30);

      const [rituals, lifeEvents] = await Promise.all([
        this.prisma.relationshipRitual.findMany({
          where: { userId, isActive: true },
          take: 5,
        }),
        this.prisma.lifeEvent.findMany({
          where: { userId, eventDate: { gte: now, lte: thirtyDays } },
          orderBy: { eventDate: 'asc' },
          take: 5,
        }),
      ]);

      const lines: string[] = [];
      for (const r of rituals) {
        lines.push(`- Ritual: ${r.title} (${r.frequency})`);
      }
      for (const e of lifeEvents) {
        lines.push(`- ${e.title}: ${new Date(e.eventDate).toLocaleDateString()}${e.note ? ` — ${e.note}` : ''}`);
      }

      return lines.length > 0 ? lines.join('\n') : null;
    } catch (err: any) {
      this.logger.warn(`Upcoming events fetch failed: ${err.message}`);
      return null;
    }
  }

  private async fetchSessionSummaries(userId: string): Promise<string | null> {
    try {
      const summaries = await this.prisma.coreChatSummary.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 2,
      });
      if (summaries.length === 0) return null;

      return summaries.map(s => {
        const dateStr = s.sessionEnd.toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        });
        return `- [Session ended ${dateStr}]: ${s.summary}`;
      }).join('\n');
    } catch (err: any) {
      this.logger.warn(`Session summaries fetch failed: ${err.message}`);
      return null;
    }
  }

  private async fetchAvailablePersonas(userId: string): Promise<string | null> {
    try {
      const personas = await this.prisma.persona.findMany({
        where: { OR: [{ userId }, { isTemplate: true }], isActive: true },
        select: { name: true },
        orderBy: [{ isTemplate: 'asc' }, { name: 'asc' }],
      });
      if (personas.length === 0) return null;
      return personas.map(p => p.name).join(', ') + ' — use trigger_persona_analysis to delegate';
    } catch (err: any) {
      this.logger.warn(`Available personas fetch failed: ${err.message}`);
      return null;
    }
  }
}
