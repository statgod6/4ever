import { Injectable, OnModuleInit, Logger, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ChatOpenRouter } from '@langchain/openrouter';
import { createThoughtAnalysisGraph } from './graph/thought-analysis.graph';
import { invokeWithRetry } from './graph/nodes/run-personas.node';
import { generateEmbedding } from './graph/utils/embeddings';
import { storeMemoryWithDedup, trackMemoryAccess, logProfileChange } from './graph/utils/memory-utils';
import { createCoreChatAgent, getCoreChatToolList } from './graph/core-chat-agent';
import { PendingActionCreator } from './graph/tools/core-chat-tools';
import { runCoreChatStreamLoop } from './graph/core-chat-loop';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { MemoryConsolidationService } from './memory-consolidation.service';
import { OntologyService } from '../ontology/ontology.service';
import { createActionItemIfNew } from '../actions/action-dedup.util';
import { formatNowInTz, timeAgo, computeSessionGap, stripLeakedTimePrefix, TimeMeta, GapMeta } from './utils/time.util';
import { DimensionsService } from '../dimensions/dimensions.service';
import { LIFE_DIMENSIONS, isValidDimension } from '../dimensions/dimension.constants';
import { classifyContextScope, ContextScope } from './context-scope';
import { AgentActionsService } from '../agent-actions/agent-actions.service';
import { SkillsService } from '../skills/skills.service';

@Injectable()
export class OrchestrationService implements OnModuleInit {
  private readonly logger = new Logger(OrchestrationService.name);
  private graph: ReturnType<typeof createThoughtAnalysisGraph> | null = null;
  private openRouterApiKey: string;
  private defaultModel: string;
  private tavilyApiKey: string;
  private ontologyEnabled: boolean = false;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private knowledgeBaseService: KnowledgeBaseService,
    private memoryConsolidation: MemoryConsolidationService,
    private ontology: OntologyService,
    private dimensions: DimensionsService,
    private agentActions: AgentActionsService,
    private skillsService: SkillsService,
  ) {}

  /** Timeout for streaming LLM fetch calls (ms). */
  private readonly STREAM_TIMEOUT_MS = 300_000;

  onModuleInit() {
    this.openRouterApiKey = this.configService.get<string>('OPENROUTER_API_KEY') || '';
    this.defaultModel = this.configService.get<string>('OPENROUTER_DEFAULT_MODEL') || 'deepseek/deepseek-v3.2';
    this.tavilyApiKey = this.configService.get<string>('TAVILY_API_KEY') || '';
    this.ontologyEnabled =
      (this.configService.get<string>('ONTOLOGY_ENABLED') || 'false').toLowerCase() === 'true';
    if (this.ontologyEnabled) {
      this.logger.log('Ontology intelligence layer ENABLED for Core Chat + Personas');
    }

    if (!this.openRouterApiKey || this.openRouterApiKey === 'your-openrouter-api-key') {
      this.logger.warn(
        'OPENROUTER_API_KEY is not set. AI persona responses will fail. ' +
        'Please set a valid OpenRouter API key in your .env file.',
      );
    }

    // Compile the LangGraph once on startup
    this.graph = createThoughtAnalysisGraph(
      this.prisma,
      this.openRouterApiKey,
      this.defaultModel,
      this.knowledgeBaseService,
    );

    this.logger.log(
      `LangGraph compiled. Default model: ${this.defaultModel}`,
    );
  }

  /**
   * Fetches the user's planner tasks for today, tomorrow, and the next 5 days.
   * Returns a formatted string for injection into persona prompts.
   */
  private async fetchCalendarContext(userId: string): Promise<string | null> {
    const now = new Date();
    const dates: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      dates.push(d);
    }

    const startDate = new Date(Date.UTC(dates[0].getFullYear(), dates[0].getMonth(), dates[0].getDate()));
    const endDate = new Date(Date.UTC(dates[6].getFullYear(), dates[6].getMonth(), dates[6].getDate() + 1));

    const plans = await this.prisma.dayPlan.findMany({
      where: {
        userId,
        date: { gte: startDate, lt: endDate },
      },
      include: {
        tasks: { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (plans.length === 0) return null;

    const lines: string[] = [];
    const todayStr = now.toISOString().split('T')[0];
    const tomorrowD = new Date(now); tomorrowD.setDate(tomorrowD.getDate() + 1);
    const tomorrowStr = tomorrowD.toISOString().split('T')[0];

    for (const plan of plans) {
      if (plan.tasks.length === 0) continue;
      const dateStr = plan.date.toISOString().split('T')[0];
      const label = dateStr === todayStr ? 'Today'
        : dateStr === tomorrowStr ? 'Tomorrow'
        : plan.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

      const taskList = plan.tasks.map((t) => {
        const statusIcon = t.status === 'done' ? '[DONE]' : t.status === 'skipped' ? '[SKIPPED]' : '';
        return `  \u2022 ${t.timeSlot}: ${t.task} ${statusIcon}`.trim();
      }).join('\n');
      lines.push(`${label} (${dateStr}):\n${taskList}`);
    }

    if (lines.length === 0) return null;
    return lines.join('\n');
  }

  /**
   * Fetches recent mood/energy check-ins for persona context.
   */
  private async fetchMoodContext(userId: string): Promise<string | null> {
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const sinceDate = new Date(Date.UTC(since.getFullYear(), since.getMonth(), since.getDate()));

    const checkIns = await this.prisma.dailyCheckIn.findMany({
      where: { userId, date: { gte: sinceDate } },
      orderBy: { date: 'desc' },
    });

    if (checkIns.length === 0) return null;

    const todayStr = new Date().toISOString().split('T')[0];
    const lines = checkIns.map((c) => {
      const dateStr = c.date.toISOString().split('T')[0];
      const label = dateStr === todayStr ? 'Today' : c.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const note = c.note ? ` - "${c.note}"` : '';
      return `${label}: Mood ${c.mood}/5, Energy ${c.energy}/5${note}`;
    });

    return lines.join('\n');
  }

  /**
   * Fetches task completion statistics for persona awareness.
   */
  private async fetchCompletionStatsContext(userId: string): Promise<string | null> {
    const since = new Date();
    since.setDate(since.getDate() - 14);
    const sinceDate = new Date(Date.UTC(since.getFullYear(), since.getMonth(), since.getDate()));

    const plans = await this.prisma.dayPlan.findMany({
      where: { userId, date: { gte: sinceDate } },
      include: { tasks: true },
      orderBy: { date: 'asc' },
    });

    if (plans.length === 0) return null;

    const totalTasks = plans.reduce((s, p) => s + p.tasks.length, 0);
    const doneTasks = plans.reduce((s, p) => s + p.tasks.filter((t) => t.status === 'done').length, 0);
    const skippedTasks = plans.reduce((s, p) => s + p.tasks.filter((t) => t.status === 'skipped').length, 0);
    const pendingTasks = totalTasks - doneTasks - skippedTasks;

    if (totalTasks === 0) return null;

    const lines: string[] = [];
    lines.push(`Last 14 days: ${totalTasks} tasks planned, ${doneTasks} completed (${Math.round((doneTasks / totalTasks) * 100)}%), ${skippedTasks} skipped, ${pendingTasks} still pending`);

    // Track skipped/done task names for pattern detection
    const skippedTaskNames: Record<string, number> = {};
    const doneTaskNames: Record<string, number> = {};
    for (const plan of plans) {
      for (const task of plan.tasks) {
        const name = task.task.toLowerCase();
        if (task.status === 'skipped') {
          skippedTaskNames[name] = (skippedTaskNames[name] || 0) + 1;
        }
        if (task.status === 'done') {
          doneTaskNames[name] = (doneTaskNames[name] || 0) + 1;
        }
      }
    }

    const repeatedSkips = Object.entries(skippedTaskNames)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1]);
    if (repeatedSkips.length > 0) {
      lines.push('Repeatedly skipped: ' + repeatedSkips.map(([name, count]) => `"${name}" (${count}x)`).join(', '));
    }

    const repeatedDone = Object.entries(doneTaskNames)
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1]);
    if (repeatedDone.length > 0) {
      lines.push('Consistently completed: ' + repeatedDone.map(([name, count]) => `"${name}" (${count}x)`).join(', '));
    }

    return lines.join('\n');
  }

  /**
   * Fetches pending action items for persona awareness.
   */
  private async fetchPendingActionsContext(userId: string): Promise<string | null> {
    const items = await this.prisma.actionItem.findMany({
      where: { userId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (items.length === 0) return null;

    const lines = items.map((item) => {
      const age = Math.floor((Date.now() - item.createdAt.getTime()) / 86400000);
      const ageStr = age === 0 ? 'today' : age === 1 ? 'yesterday' : `${age} days ago`;
      const dim = item.dimension ? ` [${item.dimension}]` : '';
      return `\u2022 ${item.content}${dim} (added ${ageStr})`;
    });

    return `${items.length} pending action items:\n${lines.join('\n')}`;
  }

  /**
   * Fetches the user's 5 most recent thoughts (title, type, status, date).
   */
  private async fetchRecentThoughtsContext(userId: string): Promise<string | null> {
    const thoughts = await this.prisma.thought.findMany({
      where: { userId, status: { in: ['open', 'resolved'] } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { title: true, thoughtType: true, status: true, createdAt: true },
    });

    if (thoughts.length === 0) return null;

    const lines = thoughts.map((t) => {
      const dateStr = t.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `- [${t.thoughtType}] "${t.title}" (${t.status}, ${dateStr})`;
    });

    return lines.join('\n');
  }

  /**
   * Fetches the 5 most recently updated thread summaries so Core Chat
   * knows what the user has been actively working through with personas.
   */
  private async fetchRecentThreadSummaries(userId: string): Promise<string | null> {
    const summaries = await this.prisma.thoughtSummary.findMany({
      where: {
        thread: { thought: { userId } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      include: {
        thread: {
          include: { thought: { select: { title: true } } },
        },
      },
    });

    if (summaries.length === 0) return null;

    const lines = summaries.map((s) => {
      const title = s.thread.thought.title;
      const excerpt = s.runningSummary.length > 200
        ? s.runningSummary.substring(0, 200) + '...'
        : s.runningSummary;
      return `- "${title}": ${excerpt}`;
    });

    return lines.join('\n');
  }

  /**
   * Fetches the user's relationship circle for context injection.
   */
  private async fetchRelationshipContext(userId: string): Promise<string | null> {
    const people = await this.prisma.relationshipPerson.findMany({
      where: { userId, isActive: true },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      include: {
        notes: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (people.length === 0) return null;

    const DRIFT_DAYS = 14;
    const now = new Date();
    const driftDate = new Date();
    driftDate.setDate(driftDate.getDate() - DRIFT_DAYS);

    const lines = people.map((p) => {
      const desc = p.description ? ` — ${p.description.substring(0, 80)}` : '';
      const lastNote = p.notes[0]
        ? ` (last note: ${p.notes[0].createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
        : '';
      const loveLang = p.loveLanguage ? ` [love language: ${p.loveLanguage.replace(/_/g, ' ')}]` : '';
      return `- ${p.name} [${p.relationship}]${desc}${loveLang}${lastNote}`;
    });

    // Drift alerts: flag people with no interaction in 14+ days
    const drifting = people.filter(
      (p) => !p.lastInteractionAt || p.lastInteractionAt < driftDate,
    );

    let result = lines.join('\n');

    if (drifting.length > 0) {
      const driftLines = drifting.map((p) => {
        if (!p.lastInteractionAt) {
          return `- ⚠️ ${p.name} [${p.relationship}]: NEVER interacted — consider reaching out`;
        }
        const daysSince = Math.floor((now.getTime() - p.lastInteractionAt.getTime()) / (1000 * 60 * 60 * 24));
        return `- ⚠️ ${p.name} [${p.relationship}]: ${daysSince} days since last interaction — they may be drifting away`;
      });
      result += `\n\n--- Drift Alerts (14+ days without contact) ---\n${driftLines.join('\n')}`;
    }

    return result;
  }

  /**
   * Fetches upcoming life events and overdue rituals for context injection.
   */
  private async fetchUpcomingEventsContext(userId: string): Promise<string | null> {
    const parts: string[] = [];

    // Overdue rituals
    const rituals = await this.prisma.relationshipRitual.findMany({
      where: { userId, isActive: true },
      include: { person: { select: { name: true } } },
    });
    const now = new Date();
    const overdueRituals = rituals.filter((r) => {
      if (!r.lastDoneAt) return true;
      const days = (now.getTime() - r.lastDoneAt.getTime()) / (1000 * 60 * 60 * 24);
      switch (r.frequency) {
        case 'daily': return days >= 1.5;
        case 'weekly': return days >= 8;
        case 'biweekly': return days >= 15;
        case 'monthly': return days >= 32;
        default: return days >= 8;
      }
    });
    if (overdueRituals.length > 0) {
      const lines = overdueRituals.map((r) => {
        const personStr = r.person ? ` (with ${r.person.name})` : '';
        return `- ⏰ "${r.title}" [${r.frequency}]${personStr} — OVERDUE (streak: ${r.streak})`;
      });
      parts.push(`--- Overdue Rituals ---\n${lines.join('\n')}`);
    }

    // Upcoming life events (next 14 days)
    const future = new Date(now);
    future.setDate(future.getDate() + 14);
    const todayStr = now.toISOString().split('T')[0];
    const today = new Date(todayStr + 'T00:00:00.000Z');

    const events = await this.prisma.lifeEvent.findMany({
      where: { userId },
      include: { person: { select: { name: true } } },
    });

    const upcoming = events.filter((e) => {
      const evDate = new Date(e.eventDate);
      if (e.isRecurring) {
        const thisYear = new Date(Date.UTC(now.getFullYear(), evDate.getUTCMonth(), evDate.getUTCDate()));
        if (thisYear < today) thisYear.setFullYear(thisYear.getFullYear() + 1);
        return thisYear >= today && thisYear <= future;
      }
      return evDate >= today && evDate <= future;
    });

    if (upcoming.length > 0) {
      const lines = upcoming.map((e) => {
        const personStr = e.person ? ` (${e.person.name})` : '';
        return `- 🎉 ${e.title} [${e.eventType}]${personStr} — ${new Date(e.eventDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      });
      parts.push(`--- Upcoming Life Events (Next 14 Days) ---\n${lines.join('\n')}`);
    }

    return parts.length > 0 ? parts.join('\n\n') : null;
  }

  /**
   * Fetches recently completed action items from the last 14 days.
   */
  private async fetchCompletedActionsContext(userId: string): Promise<string | null> {
    const since = new Date();
    since.setDate(since.getDate() - 14);

    const items = await this.prisma.actionItem.findMany({
      where: { userId, status: 'done', createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (items.length === 0) return null;

    const lines = items.map((item) => {
      const age = Math.floor((Date.now() - item.createdAt.getTime()) / 86400000);
      const ageStr = age === 0 ? 'today' : age === 1 ? 'yesterday' : `${age} days ago`;
      const dim = item.dimension ? ` [${item.dimension}]` : '';
      return `\u2022 ${item.content}${dim} (completed ${ageStr})`;
    });

    return `${items.length} recently completed:\n${lines.join('\n')}`;
  }

  /**
   * Fetches the user's 4Ever connections for context injection.
   */
  private async fetchConnectionsContext(userId: string): Promise<string | null> {
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

    const people = connections.map((c) => {
      const other = c.requesterId === userId ? c.receiver : c.requester;
      return `- ${other.name}`;
    });

    return `${connections.length} connection(s) on 4Ever:\n${people.join('\n')}`;
  }

  /**
   * Fetches unread direct messages summary for context injection.
   */
  private async fetchUnreadMessagesContext(userId: string): Promise<string | null> {
    const unread = await this.prisma.directMessage.findMany({
      where: { receiverId: userId, isRead: false },
      include: { sender: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    if (unread.length === 0) return null;

    // Group by sender
    const bySender: Record<string, { count: number; latest: string }> = {};
    for (const msg of unread) {
      const name = msg.sender.name;
      if (!bySender[name]) bySender[name] = { count: 0, latest: '' };
      bySender[name].count++;
      if (!bySender[name].latest) bySender[name].latest = msg.content.substring(0, 80);
    }

    const lines = Object.entries(bySender).map(
      ([name, { count, latest }]) => `- ${name}: ${count} unread — latest: "${latest}"`,
    );

    return `${unread.length} unread message(s):\n${lines.join('\n')}`;
  }

  /**
   * Fetches recent shared notes across all connections.
   */
  private async fetchRecentSharedNotesContext(userId: string): Promise<string | null> {
    // Get connection IDs
    const connections = await this.prisma.connection.findMany({
      where: {
        status: 'accepted',
        OR: [{ requesterId: userId }, { receiverId: userId }],
      },
      select: { id: true, requesterId: true, receiverId: true },
    });

    if (connections.length === 0) return null;

    const connIds = connections.map((c) => c.id);
    const notes = await this.prisma.sharedNote.findMany({
      where: { connectionId: { in: connIds } },
      include: { author: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    if (notes.length === 0) return null;

    const lines = notes.map((n) => {
      const dateStr = n.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `- [${n.noteType}] [${dateStr}] by ${n.author.name}: ${n.content.substring(0, 100)}`;
    });

    return lines.join('\n');
  }

  /**
   * Fetches relevant memories for direct use (outside graph).
   */
  private async fetchRelevantMemories(userId: string, searchText: string): Promise<string | null> {
    try {
      const queryEmbedding = await generateEmbedding(searchText.substring(0, 1000), this.openRouterApiKey);
      if (queryEmbedding.length > 0) {
        const vectorStr = `[${queryEmbedding.join(',')}]`;
        const results: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT m.id, m.content, m.memory_type AS "memoryType", m.created_at AS "createdAt",
                  m.source, m.access_count AS "accessCount"
           FROM memories m
           JOIN memory_embeddings me ON me.memory_id = m.id
           WHERE m.user_id = $2 AND m.status = 'active'
           ORDER BY (
             0.50 * (1 - (me.embedding <=> $1::vector))
             + 0.20 * m.importance_score
             + 0.05 * LEAST(m.access_count::float / 10.0, 1.0)
             + 0.25 * GREATEST(1.0 - EXTRACT(EPOCH FROM (NOW() - m.created_at)) / 7776000.0, 0.0)
           ) DESC
           LIMIT 8`,
          vectorStr,
          userId,
        );
        if (results.length > 0) {
          trackMemoryAccess(this.prisma, results.map((r) => r.id));
          const lines = results.map((m) => {
            const dateStr = m.createdAt
              ? new Date(m.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : 'unknown';
            const ago = m.createdAt ? ` · ${timeAgo(m.createdAt)}` : '';
            const srcLabel = m.source && m.source !== 'thought' ? ` (via ${m.source.replace('_', ' ')})` : '';
            return `- [${m.memoryType}] [${dateStr}${ago}] ${m.content}${srcLabel}`;
          });
          return lines.join('\n');
        }
      }
    } catch (error) {
      this.logger.warn('Memory retrieval failed for replyToPersona:', error);
    }

    // Fallback: importance-based
    const memories = await this.prisma.memory.findMany({
      where: { userId, status: 'active' },
      orderBy: [{ importanceScore: 'desc' }, { createdAt: 'desc' }],
      take: 8,
    });
    if (memories.length === 0) return null;
    trackMemoryAccess(this.prisma, memories.map((m) => m.id));
    const lines = memories.map((m) => {
      const dateStr = m.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const ago = ` · ${timeAgo(m.createdAt)}`;
      const srcLabel = m.source !== 'thought' ? ` (via ${m.source.replace('_', ' ')})` : '';
      return `- [${m.memoryType}] [${dateStr}${ago}] ${m.content}${srcLabel}`;
    });
    return lines.join('\n');
  }

  /**
   * Shared context builder for persona prompts.
   * Fetches user profile, calendar, mood, completion stats, pending actions,
   * and relevant memories in parallel with error resilience.
   */
  private async buildPersonaContext(
    userId: string,
    searchText: string,
    threadId?: string,
  ): Promise<{
    userContext: any;
    summary: any;
    calendarContext: string | null;
    moodContext: string | null;
    completionStats: string | null;
    pendingActions: string | null;
    memoriesContext: string | null;
  }> {
    const [userContext, summary, calendarContext, moodContext, completionStats, pendingActions, memoriesContext] = await Promise.all([
      this.prisma.userContext.findUnique({ where: { userId } }).catch(() => null),
      threadId ? this.prisma.thoughtSummary.findUnique({ where: { threadId } }).catch(() => null) : Promise.resolve(null),
      this.fetchCalendarContext(userId).catch(() => null),
      this.fetchMoodContext(userId).catch(() => null),
      this.fetchCompletionStatsContext(userId).catch(() => null),
      this.fetchPendingActionsContext(userId).catch(() => null),
      this.fetchRelevantMemories(userId, searchText).catch(() => null),
    ]);

    let ontologyBlocks: string[] | undefined;
    if (this.ontologyEnabled) {
      try {
        const composed = await this.ontology.compose(userId, { relationalLimit: 3 });
        ontologyBlocks = this.ontology.formatForPrompt(composed);
      } catch (err: any) {
        this.logger.warn(`Ontology compose failed (persona): ${err?.message || err}`);
      }
    }

    return { userContext, summary, calendarContext, moodContext, completionStats, pendingActions, memoriesContext, __ontologyBlocks: ontologyBlocks } as any;
  }

  /**
   * Appends persona-level context sections to a system prompt string.
   * Used by replyToPersona, replyToPersonaStream, and buildPersonaChatSystemPrompt.
   */
  private appendPersonaContextToPrompt(
    systemContent: string,
    ctx: {
      userContext: any;
      summary: any;
      calendarContext: string | null;
      moodContext: string | null;
      completionStats: string | null;
      pendingActions: string | null;
      memoriesContext: string | null;
    },
  ): string {
    // Ontology Layer 0 — prepend when enabled.
    if (this.ontologyEnabled) {
      systemContent = this.injectOntologyIntoPersonaPrompt(systemContent, (ctx as any).__ontologyBlocks);
    }
    if (ctx.userContext) {
      const ctxParts: string[] = [];
      if (ctx.userContext.name) ctxParts.push(`Name: ${ctx.userContext.name}`);
      if (ctx.userContext.role) ctxParts.push(`Role: ${ctx.userContext.role}`);
      if (ctx.userContext.situation) ctxParts.push(`Situation: ${ctx.userContext.situation}`);
      if (ctx.userContext.goals) ctxParts.push(`Goals: ${ctx.userContext.goals}`);
      if (ctx.userContext.values) ctxParts.push(`Values: ${ctx.userContext.values}`);
      if (ctx.userContext.freeformContext) ctxParts.push(`Context: ${ctx.userContext.freeformContext}`);
      if (ctxParts.length > 0) {
        systemContent += `\n\n--- About the User ---\n${ctxParts.join('\n')}`;
      }
    }
    if (ctx.summary) systemContent += `\n\n--- Thread Summary ---\n${ctx.summary.runningSummary}`;
    if (ctx.calendarContext) systemContent += `\n\n--- User's Schedule ---\n${ctx.calendarContext}`;
    if (ctx.moodContext) systemContent += `\n\n--- Recent Mood & Energy ---\n${ctx.moodContext}`;
    if (ctx.completionStats) systemContent += `\n\n--- Task Completion Patterns ---\n${ctx.completionStats}`;
    if (ctx.pendingActions) systemContent += `\n\n--- Pending Action Items ---\n${ctx.pendingActions}`;
    if (ctx.memoriesContext) systemContent += `\n\n--- Relevant Past Context ---\n${ctx.memoriesContext}`;
    return systemContent;
  }

  /** Inject ontology blocks into a persona system prompt (between persona identity and context). */
  private injectOntologyIntoPersonaPrompt(systemContent: string, blocks?: string[]): string {
    if (!blocks || blocks.length === 0) return systemContent;
    return systemContent + `\n\n${blocks.join('\n\n')}`;
  }

  /**
   * Gathers all context needed for Core Chat (superset of persona context).
   * Fetches user profile, memories, calendar, mood, stats, relationships,
   * events, connections, messages, and shared notes — all in parallel.
   */
  private async buildCoreChatContext(userId: string, message: string): Promise<string[]> {
    const scope: ContextScope = classifyContextScope(message);

    const [
      userContext, recentMemories, completionStats, pendingActions,
      calendarContext, moodContext, recentThoughts, threadSummaries, completedActions,
      relationshipContext, upcomingEventsContext,
      connectionsContext, unreadMessagesContext, sharedNotesContext,
      sessionSummaries,
      availablePersonas,
    ] = await Promise.all([
      // Always load user profile
      this.prisma.userContext.findUnique({ where: { userId } }).catch(() => null),
      // Always load relevant memories (embedding-matched)
      this.fetchRelevantMemories(userId, message).catch(() => null),
      // Load planner/calendar only for planner scope
      (scope === 'planner') ? this.fetchCompletionStatsContext(userId).catch(() => null) : null,
      (scope === 'planner') ? this.fetchPendingActionsContext(userId).catch(() => null) : null,
      (scope === 'planner') ? this.fetchCalendarContext(userId).catch(() => null) : null,
      // Mood only for life_review
      (scope === 'life_review') ? this.fetchMoodContext(userId).catch(() => null) : null,
      // Thoughts only for memory_recall
      (scope === 'memory_recall') ? this.fetchRecentThoughtsContext(userId).catch(() => null) : null,
      (scope === 'memory_recall') ? this.fetchRecentThreadSummaries(userId).catch(() => null) : null,
      (scope === 'planner') ? this.fetchCompletedActionsContext(userId).catch(() => null) : null,
      // Relationships only for relationship scope
      (scope === 'relationship') ? this.fetchRelationshipContext(userId).catch(() => null) : null,
      (scope === 'relationship') ? this.fetchUpcomingEventsContext(userId).catch(() => null) : null,
      // Messaging/connections only for messaging scope
      (scope === 'messaging') ? this.fetchConnectionsContext(userId).catch(() => null) : null,
      (scope === 'messaging') ? this.fetchUnreadMessagesContext(userId).catch(() => null) : null,
      (scope === 'messaging') ? this.fetchRecentSharedNotesContext(userId).catch(() => null) : null,
      // Session summaries always (continuity)
      this.fetchRecentSessionSummaries(userId).catch(() => null),
      // Personas always
      this.fetchAvailablePersonasContext(userId).catch(() => null),
    ]);

    // Life Wheel snapshot (observed scores + weekly-checkin nudge) — only for life_review scope
    let lifeWheelContext: string | null = null;
    if (scope === 'life_review') {
    try {
      const wheel = await this.dimensions.getLifeWheel(userId);
      const lines = wheel.dimensions.map((d) => {
        const arrow = d.trend === 'up' ? '↑' : d.trend === 'down' ? '↓' : '→';
        const selfStr = d.selfScore !== null ? ` self ${d.selfScore}` : '';
        return `  • ${d.label}: observed ${d.observedScore}/10 ${arrow}${selfStr}`;
      });
      const nudge = wheel.needsWeeklyCheckin
        ? `\nNOTE: User has NOT completed this week's Life Wheel check-in (week of ${wheel.weekStart}). If the conversation has natural room, gently invite them — don't force it.`
        : '';
      lifeWheelContext = `Week of ${wheel.weekStart}:\n${lines.join('\n')}${nudge}`;
    } catch (err: any) {
      this.logger.warn(`Life Wheel context fetch failed: ${err?.message || err}`);
    }
    }

    const contextParts: string[] = [];

    // Ontology Layer 0 — prepended when ONTOLOGY_ENABLED=true.
    if (this.ontologyEnabled) {
      try {
        const composed = await this.ontology.compose(userId, { relationalLimit: 5 });
        const blocks = this.ontology.formatForPrompt(composed);
        for (const b of blocks) contextParts.push(b);
      } catch (err: any) {
        this.logger.warn(`Ontology compose failed (core chat): ${err?.message || err}`);
      }
    }

    if (userContext) {
      const fields = [
        userContext.name && `Name: ${userContext.name}`,
        userContext.age && `Age: ${userContext.age}`,
        userContext.role && `Role: ${userContext.role}`,
        userContext.location && `Location: ${userContext.location}`,
        userContext.background && `Background: ${userContext.background}`,
        userContext.goals && `Goals: ${userContext.goals}`,
        userContext.situation && `Current Situation: ${userContext.situation}`,
        userContext.values && `Values: ${userContext.values}`,
        userContext.pendingDecisions && `Pending Decisions: ${userContext.pendingDecisions}`,
        userContext.currentProjects && `Current Projects: ${userContext.currentProjects}`,
        userContext.freeformContext && `Additional Context: ${userContext.freeformContext}`,
      ].filter(Boolean);
      if (fields.length > 0) contextParts.push(`--- User Profile ---\n${fields.join('\n')}`);
    }
    if (relationshipContext) contextParts.push(`--- Relationship Circle ---\n${relationshipContext}`);
    if (recentMemories) contextParts.push(`--- Relevant Memories ---\n${recentMemories}`);
    if (completionStats) contextParts.push(`--- Task Completion Patterns (14 days) ---\n${completionStats}`);
    if (pendingActions) contextParts.push(`--- Pending Action Items ---\n${pendingActions}`);
    if (completedActions) contextParts.push(`--- Recently Completed Actions ---\n${completedActions}`);
    if (calendarContext) contextParts.push(`--- Today's Schedule & Upcoming ---\n${calendarContext}`);
    if (moodContext) contextParts.push(`--- Mood & Energy (Last 7 Days) ---\n${moodContext}`);
    if (recentThoughts) contextParts.push(`--- Recent Thoughts ---\n${recentThoughts}`);
    if (threadSummaries) contextParts.push(`--- Active Thread Summaries ---\n${threadSummaries}`);
    if (upcomingEventsContext) contextParts.push(upcomingEventsContext);
    if (connectionsContext) contextParts.push(`--- 4Ever Connections ---\n${connectionsContext}`);
    if (unreadMessagesContext) contextParts.push(`--- Unread Messages ---\n${unreadMessagesContext}`);
    if (sharedNotesContext) contextParts.push(`--- Recent Shared Notes ---\n${sharedNotesContext}`);
    if (sessionSummaries) contextParts.push(`--- Previous Session Context ---\n${sessionSummaries}`);
    if (lifeWheelContext) contextParts.push(`--- Life Wheel ---\n${lifeWheelContext}`);
    if (availablePersonas) contextParts.push(`--- Available Personas (use trigger_persona_analysis to delegate) ---\n${availablePersonas}`);

    return contextParts;
  }

  /**
   * Fetches all personas accessible to the user (their own + shared library templates)
   * as a single comma-separated list for Core's context.
   */
  private async fetchAvailablePersonasContext(userId: string): Promise<string | null> {
    const personas = await this.prisma.persona.findMany({
      where: { OR: [{ userId }, { isTemplate: true }], isActive: true },
      select: { name: true },
      orderBy: [{ isTemplate: 'asc' }, { name: 'asc' }],
    });

    if (personas.length === 0) return null;
    return personas.map((p) => p.name).join(', ');
  }

  /**
   * Fetches the last 2 session summaries for cross-session context injection.
   */
  private async fetchRecentSessionSummaries(userId: string): Promise<string | null> {
    const summaries = await this.prisma.coreChatSummary.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 2,
    });

    if (summaries.length === 0) return null;

    const lines = summaries.map((s) => {
      const dateStr = s.sessionEnd.toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
      });
      const topics = s.keyTopics ? ` [${s.keyTopics}]` : '';
      return `[${dateStr}]${topics} (${s.messageCount} msgs):\n${s.summary}`;
    });

    return lines.join('\n\n');
  }

  /**
   * Builds the Core Chat system prompt with context and tool instructions.
   */
  private buildCoreChatSystemPrompt(
    contextParts: string[],
    timeMeta: TimeMeta,
    gapMeta: GapMeta,
    recap?: string | null,
  ): string {
    const gapBanner = gapMeta.isReturning
      ? `\nThe user is returning after ${gapMeta.gapLabel} of silence — acknowledge the gap naturally if it's relevant, but don't force it.`
      : '';

    const recapBlock = recap && recap.trim()
      ? `\n\n## WHILE YOU WERE AWAY\n${recap.trim()}\nUse this to open the session with natural continuity if relevant — don't recite it verbatim, just let it inform the conversation.`
      : '';

    return `You are the 4Ever Core — the user's personal intelligence layer. You are their digital twin who knows everything about them: their goals, situation, values, patterns, moods, and history.

Current time: ${timeMeta.iso}  (${timeMeta.human}).
Timezone: ${timeMeta.tz}.${gapBanner}${recapBlock}

TIME AWARENESS: Each prior user/assistant message in history is prefixed with a bracketed age tag like [2 days ago] or [just now]. These tags are METADATA for your reasoning — they tell you how long ago each turn happened. Treat them as ground truth and use them to judge recency. Do NOT copy, echo, or include these bracketed tags in your reply — your output must be clean prose. If the last message was days ago, acknowledge the gap naturally in your own words; do not continue mid-thread as if no time passed.

${contextParts.join('\n\n')}

## ABSOLUTE RULE — PERSONA RESPONSES
When trigger_persona_analysis or fetch_persona_response returns content between [VERBATIM_START] and [VERBATIM_END] markers, you MUST copy the ENTIRE content between these markers into your response word-for-word. Do NOT summarize, shorten, paraphrase, or add commentary around it. Output it EXACTLY as-is. This is NON-NEGOTIABLE.

## TONE MIRRORING — ALWAYS ON
Match the user's register in real-time, turn by turn:
- Playful → be playful back. Crack the joke, keep it light.
- Serious → be serious. No jokes, no emojis, no filler.
- Sarcastic → match the sarcasm. Do NOT moralize or switch to earnest mode. (Sarcasm yes, contempt no — never mean.)
- Low / tired / venting → soften, slow down, validate first. Do NOT inject fake cheer.
- Excited / energetic → meet the energy, don't flatten it.
Read the latest 1–2 messages to detect tone, not the old history.

## GROWTH CLAUSE — NON-NEGOTIABLE
Regardless of which tone you mirror, every response must nudge the user one concrete step forward toward their stated goals, values, or growth. The tone is the wrapper; growth is the payload. Never become a yes-man just because they're playful. Never wallow just because they're low — validate, then point forward.

## LIFE WHEEL — THE NORTH STAR
The user's life is tracked across 6 frozen dimensions: health, financial, career, intellectual, relationships, purpose. This is your core model of where they are and where they are trying to go. The goal of every conversation — directly or indirectly — is to help them move from their current state toward a better state across these dimensions.

How to use it:
- A Life Wheel snapshot is included in the context above when available. Let it inform your understanding silently; don't recite the numbers unless the user asks.
- Treat it as a MIRROR, never a scorecard. No guilt, no pressure, no shame language around low scores. If something is low, be curious and warm, not alarmed.
- If a dimension is trending down or has been low for weeks, you MAY gently name it and ask what's going on — but only when the conversation gives a natural opening. Never hijack a happy moment to deliver hard truths.
- When the user tells you something that implies a dimension shifted (e.g. "got the promotion", "we broke up", "haven't slept", "paid off the card"), that signal is automatically captured in the background — you don't need to mention it or thank them for data.
- Small, steady investments beat dramatic overhauls. Frame progress as "what's one small thing this week" rather than "you need to fix X".

## WEEKLY RITUAL — INVITE, DON'T NAG
Once per ISO week the user can do a self check-in rating the 6 dimensions. A NOTE appears in the Life Wheel context when this week's check-in is missing.
- If you see that note AND the conversation has natural room (small talk end, Sunday/Monday, user mentions reflection or the week), warmly invite them: e.g. "If you've got a minute this week, the wheel check-in helps me see you clearly" or "Want to do your weekly self-read while we're here?"
- Do NOT nag. One invitation per session, max. If they decline, move on cheerfully and don't bring it up again that session.
- If they say yes, USE submit_weekly_checkin (confirm the values you heard first) or just point them to it: "Open your dashboard — top of Home."
- If they mention just one dimension they want to update, USE rate_dimension for that single one — don't insist on all six.

Guidelines:
- Give direct, personalized advice based on what you know about the user
- Reference their specific goals, situation, and patterns when relevant
- Be warm but honest — challenge them when needed
- Keep responses concise and actionable
- If they mention something new about themselves, acknowledge it
- You are not a generic AI — you are THEIR Core, speak like you truly know them

## CONFIRMATION RULE — ALWAYS ASK BEFORE WRITING
You have access to tools that let you take REAL actions in the user's data (planner, action items, circle, rituals, profile, memories, personas, check-ins, thoughts, tensions, life events, direct messages, etc.). You MUST ALWAYS confirm with the user BEFORE invoking any of these write/mutate tools, unless the user has ALREADY given an explicit, unambiguous instruction to do it in this same turn.

Read-only tools (search_memories, query_planner, search_relationships, get_checkin, list_tensions, list_upcoming_events, search_connections, get_unread_messages, search_knowledge_base, get_conversation_history, search_messages, get_evening_reflection, get_weekly_reflection, get_thinking_stats, get_life_dimensions, get_life_wheel, get_planner_stats, fetch_persona_response, get_relationship_health, web_search, calculator, url_reader, weather, wikipedia, news_search, suggest_conversation_starters) may be called freely without confirmation.

Write tools that REQUIRE explicit user confirmation before each call: create_action, create_thought, update_profile, create_checkin, add_relationship_note, add_to_circle, update_circle_person, add_ritual, add_life_event, add_plan_task, delete_plan_task, create_persona, delete_persona, delete_action, create_tension, resolve_tension, cooldown_tension, complete_ritual, delete_ritual, delete_life_event, update_thought_status, delete_thought, update_task_status, link_action_to_planner, update_memory, forget_memory, add_manual_memory, send_message, trigger_persona_analysis, rate_dimension, submit_weekly_checkin.

How to confirm:
- When you detect the user's intent might call for one of these write tools, FIRST reply in natural language describing exactly what you would do (what will be created/changed, with the specific values you intend to use) and ask them to confirm — e.g. "Want me to add 'Call Mom' to your planner tomorrow at 9 AM?" Do NOT call the tool yet.
- Only call the write tool on the NEXT turn, after the user gives a clear yes ("yes", "go ahead", "do it", "please", "sure", "add it", etc.).
- Exception — the user's current message is ALREADY an explicit, unambiguous write command (e.g. "add X to my planner at 9am", "remember that I hate cilantro", "mark the gym task as done"). In that case you may call the tool directly, then briefly confirm what you did afterward. When in doubt, ASK FIRST.
- If the user gives a vague hint (e.g. "I should probably call Mom sometime"), do NOT silently create an action — instead offer: "Want me to add that as an action item?" and wait.
- Never batch multiple write-tool calls without separate confirmation for each (or explicit bulk approval).

Use these tools when the user's intent clearly matches — BUT respect the confirmation rule above:
- When the user asks to add a task or action, USE create_action (after confirming)
- When they share mood/energy info, USE create_checkin (after confirming)
- When they want to explore something deeper with personas, USE create_thought (after confirming)
- When they ask about past context or "do you remember...", USE search_memories
- When they want to check their schedule, USE query_planner
- When they share new personal info (new job, moved cities, etc.), USE update_profile (after confirming what you'll save)
- When they want a specific persona's take on something, USE trigger_persona_analysis. Output the FULL content between the [VERBATIM_START] and [VERBATIM_END] markers EXACTLY as-is — see the ABSOLUTE RULE above.
- When the user asks "what did the persona say?", "show me the full response", "give me the complete analysis", "what it said?", or refers to a PREVIOUS persona response, USE fetch_persona_response to retrieve it from the database. Do NOT re-trigger trigger_persona_analysis. fetch_persona_response is instant (no LLM call) and returns the exact stored response.
- When they ask factual questions, want current news/info, or need real-time data, USE web_search
- When they need math calculations (finances, percentages, planning), USE calculator
- When they share a URL and want it read or summarized, USE url_reader
- When they ask about weather or plan outdoor activities, USE weather
- When they want definitions, facts, or general knowledge, USE wikipedia
- When they want recent news or current events on a topic, USE news_search
- When the user mentions someone from their Relationship Circle by name, USE search_relationships to recall details about that person
- When the user describes an interaction or event with someone in their circle, ALWAYS USE add_relationship_note to log it — you MUST detect and include the sentiment (positive/neutral/negative) and topic (career, family, conflict, support, casual, health, finances, plans, etc.) from the conversation context
- When the user asks for conversation starters, talking points, or what to say to someone, USE suggest_conversation_starters
- When you notice overdue rituals or upcoming life events in the context, proactively mention them to the user
- When the user asks "do I have messages?" or "any unread?", USE get_unread_messages
- When the user wants to message someone (e.g., "tell Bob...", "message Alice..."), USE send_message
- When the user asks about their connections or who they're connected with, USE search_connections
- When you see unread messages in the context, proactively mention them to the user
- When the user asks about their uploaded documents, reference materials, or knowledge base content, USE search_knowledge_base
- When the user asks a domain-specific question that might be answered by their persona's reference documents, USE search_knowledge_base
- When the user asks "what did X say?", "show me my chat with X", or wants to recall past messages, USE get_conversation_history
- When the user asks "has anyone talked to me about X?", "find messages about Y", or wants to search across all conversations by topic, USE search_messages
- When the user wants to add someone to their circle (e.g., "add X as my Y"), USE add_to_circle
- When the user wants to update someone's details in their circle, USE update_circle_person
- When the user wants a recurring reminder for a relationship (e.g., "remind me to call X every week"), USE add_ritual
- When the user mentions a birthday, anniversary, or life event, USE add_life_event (set isRecurring=true for birthdays/anniversaries)
- When the user wants to add a task to their planner/calendar for any date, USE add_plan_task with the date, time slot, and task description
- When the user wants to remove/cancel a task from their planner, USE delete_plan_task
- When the user mentions mood/energy for a specific past or future date (not just today), USE create_checkin with the date parameter
- When the user wants to create a new persona/advisor, USE create_persona — craft a detailed systemPrompt based on what they describe
- When the user wants to remove/delete a persona, USE delete_persona
- When the user wants to mark an action item as done or remove it, USE delete_action
- When the user asks for an evening reflection or "reflect on my day", USE get_evening_reflection
- When the user asks for a weekly review or "how was my week?", USE get_weekly_reflection
- When the user asks about their thinking patterns, stats, or thought distribution, USE get_thinking_stats
- When the user asks about life balance or what areas they focus on, USE get_life_dimensions
- When the user asks about their Life Wheel, how they're doing across dimensions, or wants to see the 6-dimension picture, USE get_life_wheel
- When the user wants to self-rate one specific dimension (e.g. "my health feels like a 6 this week"), USE rate_dimension (confirm the number first)
- When the user wants to do their full weekly check-in across all 6 dimensions, USE submit_weekly_checkin (confirm the numbers first)
- When the user asks about their planner completion rate, streak, or productivity, USE get_planner_stats
- When the user mentions a conflict, frustration, or tension with someone, USE create_tension
- When the user asks about their tensions or conflicts, USE list_tensions
- When the user says a tension is resolved or they worked things out, USE resolve_tension
- When the user needs to cool down before engaging with a conflict, USE cooldown_tension
- When the user says they completed a ritual or did their ritual, USE complete_ritual
- When the user wants to stop/remove a ritual, USE delete_ritual
- When the user asks about upcoming events, birthdays, or anniversaries, USE list_upcoming_events
- When the user wants to remove a life event, USE delete_life_event
- When the user says a thought is resolved or wants to close/archive it, USE update_thought_status
- When the user wants to delete a thought, USE delete_thought
- When the user says they completed a planner task or wants to skip it, USE update_task_status
- When the user asks about relationship health or who they are neglecting, USE get_relationship_health
- When the user wants to move an action item to their planner/schedule, USE link_action_to_planner
- When the user asks about their mood/energy for a specific date, USE get_checkin
- When the user says "remember this", "don't forget that", or explicitly asks you to remember something, USE add_manual_memory
- When the user corrects something you remembered wrong or says "actually it's X not Y", USE update_memory to fix the memory
- When the user says "forget this", "don't remember that", or asks you to remove a memory, USE forget_memory
- Only use tools when genuinely needed. Most conversations don't require tools.
- After using a tool, confirm what you did in your response.
- When you notice a memory that seems outdated or contradicts what the user is saying now, proactively mention it and ask if you should update your understanding.
- If the user corrects something you remembered, acknowledge the correction, update your memory using update_memory, and thank them for keeping you accurate.
- Periodically weave in what you remember about the user to show continuity — e.g., "Last time you mentioned X, how did that go?"`;
  }

  /**
   * Build a deterministic "while you were away" recap for a returning user.
   * Scans changes in the window (since, now) across memories, completed planner
   * tasks, resolved tensions, and life events. Returns null when nothing
   * substantive happened. No LLM call — pure DB + string formatting.
   */
  private async buildSessionRecap(
    userId: string,
    since: Date,
  ): Promise<string | null> {
    try {
      const [memories, planTasks, tensions, events] = await Promise.all([
        this.prisma.$queryRawUnsafe(
          `SELECT content FROM memories
             WHERE user_id = $1 AND created_at > $2 AND status = 'active'
             ORDER BY created_at DESC LIMIT 3`,
          userId, since,
        ).catch(() => [] as any[]) as Promise<Array<{ content: string }>>,
        this.prisma.$queryRawUnsafe(
          `SELECT pt.task FROM plan_tasks pt
             JOIN day_plans dp ON dp.id = pt.plan_id
             WHERE dp.user_id = $1 AND pt.status = 'done' AND pt.completed_at > $2
             ORDER BY pt.completed_at DESC LIMIT 3`,
          userId, since,
        ).catch(() => [] as any[]) as Promise<Array<{ task: string }>>,
        this.prisma.$queryRawUnsafe(
          `SELECT title FROM tension_entries
             WHERE user_id = $1 AND status = 'resolved' AND resolved_at > $2
             ORDER BY resolved_at DESC LIMIT 3`,
          userId, since,
        ).catch(() => [] as any[]) as Promise<Array<{ title: string }>>,
        this.prisma.$queryRawUnsafe(
          `SELECT title FROM life_events
             WHERE user_id = $1 AND event_date >= $2::date AND event_date <= CURRENT_DATE
             ORDER BY event_date DESC LIMIT 3`,
          userId, since,
        ).catch(() => [] as any[]) as Promise<Array<{ title: string }>>,
      ]);

      const truncate = (s: string, n: number) =>
        s && s.length > n ? s.slice(0, n - 1).trim() + '…' : s;

      const parts: string[] = [];
      if (memories.length > 0) {
        const sample = truncate(memories[0].content || '', 60);
        parts.push(
          memories.length === 1
            ? `captured 1 new memory ("${sample}")`
            : `captured ${memories.length} new memories (latest: "${sample}")`,
        );
      }
      if (planTasks.length > 0) {
        const sample = truncate(planTasks[0].task || '', 40);
        parts.push(
          planTasks.length === 1
            ? `finished a planner task ("${sample}")`
            : `finished ${planTasks.length} planner tasks (latest: "${sample}")`,
        );
      }
      if (tensions.length > 0) {
        const titles = tensions.map((t) => `"${truncate(t.title || '', 40)}"`).join(', ');
        parts.push(
          tensions.length === 1
            ? `resolved tension ${titles}`
            : `resolved ${tensions.length} tensions (${titles})`,
        );
      }
      if (events.length > 0) {
        const titles = events.map((e) => `"${truncate(e.title || '', 40)}"`).join(', ');
        parts.push(
          events.length === 1
            ? `life event happened: ${titles}`
            : `${events.length} life events happened (${titles})`,
        );
      }

      if (parts.length === 0) return null;
      return `Since we last spoke: ${parts.join('; ')}.`;
    } catch (err: any) {
      this.logger.warn(`buildSessionRecap failed: ${err?.message || err}`);
      return null;
    }
  }

  /**
   * Main analysis entry point.
   * Fetches the thought + thread + personas, then invokes the LangGraph.
   *
   * PRD Section 12.4 - Orchestration Flow:
   * 1. receive thought input
   * 2. identify selected personas
   * 3. retrieve thread history
   * 4. retrieve relevant long-term memory
   * 5. construct persona-specific prompts
   * 6. send request to orchestration layer
   * 7. generate persona responses
   * 8. store messages and outputs
   * 9. update summary
   * 10. save new memory if needed
   */
  async analyzeThought(
    userId: string,
    thoughtId: string,
    personaIds: string[],
  ) {
    // 1. Fetch the thought
    const thought = await this.prisma.thought.findFirst({
      where: { id: thoughtId, userId },
      include: {
        threads: true,
      },
    });

    if (!thought) {
      throw new NotFoundException('Thought not found');
    }

    const thread = thought.threads[0];
    if (!thread) {
      throw new NotFoundException('Thread not found for this thought');
    }

    // 2. Fetch selected personas (user's own + shared library templates)
    const personas = await this.prisma.persona.findMany({
      where: {
        id: { in: personaIds },
        OR: [{ userId }, { isTemplate: true }],
        isActive: true,
      },
    });

    if (personas.length === 0) {
      throw new NotFoundException('No active personas found for the given IDs');
    }

    this.logger.log(
      `Analyzing thought "${thought.title}" with ${personas.length} persona(s): ${personas.map((p) => p.name).join(', ')}`,
    );

    // Fetch user context for universal briefing
    const userContext = await this.prisma.userContext.findUnique({
      where: { userId },
    });

    // Fetch calendar/planner context
    const calendarContext = await this.fetchCalendarContext(userId);

    // Fetch mood/energy context
    const moodContext = await this.fetchMoodContext(userId);

    // Fetch completion stats and pending actions
    const completionStatsContext = await this.fetchCompletionStatsContext(userId);
    const pendingActionsContext = await this.fetchPendingActionsContext(userId);

    // 3-10. Invoke the LangGraph with the initial state
    try {
      const result = await this.graph.invoke({
        userId,
        calendarContext,
        moodContext,
        completionStatsContext,
        pendingActionsContext,
        userContext: userContext ? {
          name: userContext.name,
          age: userContext.age,
          location: userContext.location,
          role: userContext.role,
          background: userContext.background,
          currentProjects: userContext.currentProjects,
          goals: userContext.goals,
          situation: userContext.situation,
          values: userContext.values,
          pendingDecisions: userContext.pendingDecisions,
          freeformContext: userContext.freeformContext,
        } : null,
        thought: {
          id: thought.id,
          userId: thought.userId,
          title: thought.title,
          rawText: thought.rawText,
          thoughtType: thought.thoughtType,
          status: thought.status,
        },
        thread: {
          id: thread.id,
          thoughtId: thread.thoughtId,
          threadKey: thread.threadKey,
        },
        personas: personas.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          systemPrompt: p.systemPrompt,
          modelName: p.modelName,
          isActive: p.isActive,
        })),
      });

      this.logger.log(
        `Analysis complete. Generated ${result.personaResponses.length} responses. Summary updated: ${!!result.newSummary}`,
      );

      // Return the results to the controller
      return {
        thought: {
          id: thought.id,
          title: thought.title,
          thoughtType: thought.thoughtType,
        },
        responses: result.personaResponses.map((r) => ({
          personaId: r.personaId,
          personaName: r.personaName,
          response: r.response,
          modelUsed: r.modelUsed,
        })),
        summary: result.newSummary,
        memoriesStored: result.memoriesStored,
        coreSynthesis: result.coreSynthesis || null,
      };
    } catch (error: any) {
      this.logger.error(`LangGraph analysis failed for thought "${thought.title}":`, error.message);
      throw new InternalServerErrorException(
        `Analysis failed: ${error.message || 'Unknown orchestration error'}. Please try again.`,
      );
    }
  }

  /**
   * Per-persona reply: sends a follow-up message to a single persona
   * with isolated conversation context (only that persona's branch).
   */
  async replyToPersona(
    userId: string,
    thoughtId: string,
    personaId: string,
    message: string,
  ) {
    // 1. Fetch thought + thread
    const thought = await this.prisma.thought.findFirst({
      where: { id: thoughtId, userId },
      include: { threads: true },
    });
    if (!thought) throw new NotFoundException('Thought not found');
    const thread = thought.threads[0];
    if (!thread) throw new NotFoundException('Thread not found');

    // 2. Fetch the persona (user's own + shared library templates)
    const persona = await this.prisma.persona.findFirst({
      where: {
        id: personaId,
        OR: [{ userId }, { isTemplate: true }],
        isActive: true,
      },
    });
    if (!persona) throw new NotFoundException('Persona not found or inactive');

    // 3. Save the user's directed message (personaId marks it as targeted)
    await this.prisma.message.create({
      data: {
        threadId: thread.id,
        role: 'user',
        content: message,
        personaId: personaId,
      },
    });

    // 4. Load only this persona's conversation branch
    //    = global user messages (personaId IS NULL) + directed messages to this persona + this persona's responses
    const allMessages = await this.prisma.message.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: 'asc' },
    });

    const branchMessages = allMessages.filter((m) => {
      if (m.role === 'user') {
        // Include global user messages (no target) or messages directed at this persona
        return !m.personaId || m.personaId === personaId;
      }
      // Include only this persona's assistant responses
      return m.personaId === personaId;
    });

    // 5. Build the prompt with isolated context
    const langchainMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

    // System prompt
    let systemContent = persona.systemPrompt;

    // Add date awareness
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    systemContent += `\n\nToday's date is ${today}. When referencing past events, mention when they occurred.`;

    // Fetch all context in parallel with resilience
    const ctx = await this.buildPersonaContext(userId, `${thought.title} ${message}`, thread.id);
    systemContent = this.appendPersonaContextToPrompt(systemContent, ctx);

    // Add RAG knowledge base chunks from persona's uploaded documents
    try {
      const ragChunks = await this.knowledgeBaseService.retrieveRelevantChunks(personaId, message, 5);
      if (ragChunks.length > 0) {
        const ragContext = ragChunks.map((chunk, i) => `[${i + 1}] ${chunk}`).join('\n---\n');
        systemContent += `\n\n--- Reference Knowledge (from uploaded documents) ---\n${ragContext}\n\nUse the above reference material to inform your response when relevant. Cite specific information when applicable.`;
      }
    } catch (err) {
      this.logger.error(`RAG retrieval failed for persona ${personaId}:`, err);
    }

    langchainMessages.push({ role: 'system', content: systemContent });

    // Add conversation history (last 15 messages from this branch)
    const recentBranch = branchMessages.slice(-15);
    for (const msg of recentBranch) {
      langchainMessages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      });
    }

    // 6. Call LLM with retry
    this.logger.log(`Per-persona reply to ${persona.name} for thought "${thought.title}"`);

    try {
      const result = await invokeWithRetry(
        this.openRouterApiKey,
        persona.modelName || this.defaultModel,
        this.defaultModel,
        langchainMessages,
      );

      // 7. Save the persona's response
      await this.prisma.personaRun.create({
        data: {
          threadId: thread.id,
          personaId: persona.id,
          inputText: message,
          outputText: result.text,
          modelUsed: result.modelUsed,
        },
      });

      await this.prisma.message.create({
        data: {
          threadId: thread.id,
          role: 'assistant',
          content: result.text,
          personaId: persona.id,
          modelName: result.modelUsed,
        },
      });

      // 8. Fire-and-forget: extract memories from this follow-up exchange
      this.extractReplyMemory(
        userId, thought.title, thought.thoughtType,
        message, result.text, persona.name, thread.id,
      ).catch((err) => this.logger.warn('Reply memory extraction failed:', err));

      // 9. Fire-and-forget: extract action items from persona reply
      this.extractReplyActions(
        userId, thread.id, persona.id, thought.title, thought.thoughtType,
        message, result.text, persona.name,
      ).catch((err) => this.logger.warn('Reply action extraction failed:', err));

      return {
        personaId: persona.id,
        personaName: persona.name,
        response: result.text,
        modelUsed: result.modelUsed,
      };
    } catch (error: any) {
      this.logger.error(`Per-persona reply failed for ${persona.name}:`, error.message);
      return {
        personaId: persona.id,
        personaName: persona.name,
        response: `[Error] Failed to get response from ${persona.name}. Please try again.`,
        modelUsed: persona.modelName || this.defaultModel,
      };
    }
  }

  /**
   * Streaming variant of replyToPersona — emits SSE token events for real-time text display.
   */
  async *replyToPersonaStream(
    userId: string,
    thoughtId: string,
    personaId: string,
    message: string,
  ): AsyncGenerator<{ event: string; data: any }> {
    // 1. Fetch thought + thread
    const thought = await this.prisma.thought.findFirst({
      where: { id: thoughtId, userId },
      include: { threads: true },
    });
    if (!thought) throw new NotFoundException('Thought not found');
    const thread = thought.threads[0];
    if (!thread) throw new NotFoundException('Thread not found');

    // 2. Fetch persona (user's own + shared library templates)
    const persona = await this.prisma.persona.findFirst({
      where: {
        id: personaId,
        OR: [{ userId }, { isTemplate: true }],
        isActive: true,
      },
    });
    if (!persona) throw new NotFoundException('Persona not found or inactive');

    // 3. Save user's directed message
    await this.prisma.message.create({
      data: { threadId: thread.id, role: 'user', content: message, personaId },
    });

    yield { event: 'thinking', data: { status: 'loading_context' } };

    // 4. Load branch messages
    const allMessages = await this.prisma.message.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: 'asc' },
    });
    const branchMessages = allMessages.filter((m) => {
      if (m.role === 'user') return !m.personaId || m.personaId === personaId;
      return m.personaId === personaId;
    });

    // 5. Build prompt with context (same as replyToPersona)
    let systemContent = persona.systemPrompt;
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    systemContent += `\n\nToday's date is ${today}. When referencing past events, mention when they occurred.`;

    const ctx = await this.buildPersonaContext(userId, `${thought.title} ${message}`, thread.id);
    systemContent = this.appendPersonaContextToPrompt(systemContent, ctx);

    // RAG knowledge base
    try {
      const ragChunks = await this.knowledgeBaseService.retrieveRelevantChunks(personaId, message, 5);
      if (ragChunks.length > 0) {
        const ragContext = ragChunks.map((chunk, i) => `[${i + 1}] ${chunk}`).join('\n---\n');
        systemContent += `\n\n--- Reference Knowledge ---\n${ragContext}\n\nUse the above reference material to inform your response when relevant.`;
      }
    } catch (err) {
      this.logger.error(`RAG retrieval failed for persona ${personaId}:`, err);
    }

    const langchainMessages = [
      { role: 'system' as const, content: systemContent },
      ...branchMessages.slice(-15).map((msg) => ({
        role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: msg.content,
      })),
    ];

    yield { event: 'thinking', data: { status: 'reasoning' } };

    // 6. Stream LLM response token-by-token (raw fetch to capture reasoning)
    const modelName = persona.modelName || this.defaultModel;
    try {
      const messagesForApi = langchainMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const fetchBody = JSON.stringify({
        model: modelName,
        messages: messagesForApi,
        max_tokens: 50000,
        temperature: 0.7,
        stream: true,
        reasoning: { effort: 'high' },
      });

      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), this.STREAM_TIMEOUT_MS);

      const fetchRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openRouterApiKey}`,
        },
        body: fetchBody,
        signal: abortController.signal,
      });

      if (!fetchRes.ok || !fetchRes.body) {
        clearTimeout(timeoutId);
        throw new Error(`OpenRouter API error: ${fetchRes.status}`);
      }

      let fullText = '';
      const decoder = new TextDecoder();
      let buffer = '';

      for await (const rawChunk of fetchRes.body as any) {
        buffer += decoder.decode(rawChunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            // Emit reasoning tokens
            if (delta.reasoning && typeof delta.reasoning === 'string') {
              yield { event: 'thinking_delta', data: { chunk: delta.reasoning } };
            }

            // Emit content tokens
            if (delta.content && typeof delta.content === 'string') {
              fullText += delta.content;
              yield { event: 'token', data: { chunk: delta.content } };
            }
          } catch { /* skip malformed lines */ }
        }
      }

      if (!fullText) fullText = '[No response generated]';

      clearTimeout(timeoutId);
      yield { event: 'response', data: { text: fullText, personaName: persona.name, personaId: persona.id, modelUsed: modelName } };

      // 7. Save response to DB
      await this.prisma.personaRun.create({
        data: { threadId: thread.id, personaId: persona.id, inputText: message, outputText: fullText, modelUsed: modelName },
      });
      await this.prisma.message.create({
        data: { threadId: thread.id, role: 'assistant', content: fullText, personaId: persona.id, modelName },
      });

      // 8. Fire-and-forget learning extractions
      this.extractReplyMemory(userId, thought.title, thought.thoughtType, message, fullText, persona.name, thread.id)
        .catch((err) => this.logger.warn('Reply memory extraction failed:', err));
      this.extractReplyActions(userId, thread.id, persona.id, thought.title, thought.thoughtType, message, fullText, persona.name)
        .catch((err) => this.logger.warn('Reply action extraction failed:', err));

      yield { event: 'done', data: {} };
    } catch (error: any) {
      const isTimeout = error?.name === 'AbortError';
      const errorMsg = isTimeout
        ? `Response from ${persona.name} timed out after ${this.STREAM_TIMEOUT_MS / 1000}s. Please try again.`
        : `[Error] Failed to get response from ${persona.name}. Please try again.`;
      this.logger.error(`Persona stream failed for ${persona.name}:`, isTimeout ? 'TIMEOUT' : error.message);
      yield { event: 'response', data: { text: errorMsg, personaName: persona.name, personaId: persona.id, modelUsed: modelName } };
      yield { event: 'done', data: {} };
    }
  }

  /**
   * Extracts action items from per-persona follow-up replies (fire-and-forget).
   */
  private async extractReplyActions(
    userId: string, threadId: string, personaId: string,
    thoughtTitle: string, thoughtType: string,
    userMessage: string, personaResponse: string, personaName: string,
  ) {
    // Fetch existing pending actions to avoid duplicates
    const pending = await this.prisma.actionItem.findMany({
      where: { userId, status: 'pending' },
      select: { content: true },
      take: 20,
    });
    const existingActions = pending.map((a) => a.content);
    const existingStr = existingActions.length > 0
      ? `\nAlready existing pending actions (DO NOT re-suggest):\n${existingActions.map((a) => `- ${a}`).join('\n')}`
      : '';

    const model = new ChatOpenRouter({
      model: this.defaultModel,
      temperature: 0.2,
      maxTokens: 512,
      apiKey: this.openRouterApiKey,
    });

    const context = `Thought: "${thoughtTitle}" (${thoughtType})\nUser said: ${userMessage.substring(0, 500)}\n${personaName} replied: ${personaResponse.substring(0, 1000)}`;

    const response = await model.invoke([
      {
        role: 'system',
        content: `You extract action items from a conversation between a user and their AI advisor persona.

From the exchange below, extract 0-3 concrete, actionable tasks the user should do.
Rules:
- Only extract items if the persona gave clear actionable advice or the user committed to doing something
- Each action: {"content": "clear 1-sentence task", "dimension": "Health|Career|Relationships|Finance|Learning|Creativity|Spirituality|null"}
- Do NOT repeat existing pending actions
- If nothing actionable, return empty array
${existingStr}

Respond with ONLY a JSON array. No markdown fences, no explanation.
Example: [{"content": "Draft business proposal by Friday", "dimension": "Career"}]`,
      },
      { role: 'user', content: context },
    ]);

    const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    let actions: Array<{ content: string; dimension: string | null }>;
    try {
      const parsed = JSON.parse(text);
      actions = Array.isArray(parsed) ? parsed : [];
    } catch {
      const jsonMatch = text.match(/\[.*\]/s);
      if (jsonMatch) {
        actions = JSON.parse(jsonMatch[0]);
      } else {
        return;
      }
    }

    for (const action of actions.slice(0, 3)) {
      if (action.content && typeof action.content === 'string' && action.content.trim().length > 5) {
        const created = await createActionItemIfNew(this.prisma, {
          userId,
          threadId,
          personaId,
          content: action.content.trim(),
          dimension: action.dimension || null,
        });
        if (created) {
          this.logger.log(`Reply action extracted (${personaName}): ${action.content.trim().substring(0, 60)}`);
        } else {
          this.logger.log(`Reply action skipped as duplicate (${personaName}): ${action.content.trim().substring(0, 60)}`);
        }
      }
    }
  }

  /**
   * Extracts memories from per-persona follow-up replies (fire-and-forget).
   */
  private async extractReplyMemory(
    userId: string, thoughtTitle: string, thoughtType: string,
    userMessage: string, personaResponse: string, personaName: string, threadId: string,
  ) {
    const model = new ChatOpenRouter({
      model: this.defaultModel,
      temperature: 0.2,
      maxTokens: 512,
      apiKey: this.openRouterApiKey,
    });

    const context = `Thought: "${thoughtTitle}" (${thoughtType})\nUser said: ${userMessage.substring(0, 300)}\n${personaName} replied: ${personaResponse.substring(0, 500)}`;

    const response = await model.invoke([
      {
        role: 'system',
        content:
          'You are a memory extraction assistant. From this follow-up conversation, extract 0-2 key facts, decisions, or insights worth remembering. ' +
          'Return each as a separate line. If nothing notable, respond with "NONE".',
      },
      { role: 'user', content: context },
    ]);

    const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    if (text.trim().toUpperCase() === 'NONE') return;

    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && l.length < 500);
    for (const line of lines.slice(0, 2)) {
      await storeMemoryWithDedup(this.prisma, this.openRouterApiKey, {
        userId,
        content: line,
        memoryType: thoughtType,
        importanceScore: 0.7,
        sourceThreadId: threadId,
        source: 'persona_reply',
      });
    }
  }

  /**
   * Quick chat for Focus Mode - sends a message to an optional persona
   * or a general AI assistant for quick responses without creating a thought.
   */
  async quickChat(userId: string, message: string, personaId?: string) {
    let systemPrompt = 'You are a helpful thinking assistant. Help the user process their thoughts clearly and concisely.';

    if (personaId) {
      const persona = await this.prisma.persona.findFirst({
        where: {
          id: personaId,
          OR: [{ userId }, { isTemplate: true }],
          isActive: true,
        },
      });
      if (persona) {
        systemPrompt = persona.systemPrompt;
      }
    }

    try {
      const model = new ChatOpenRouter({
        model: this.defaultModel,
        temperature: 0.7,
        maxTokens: 1024,
        apiKey: this.openRouterApiKey,
      });

      const response = await model.invoke([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ]);

      const text = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      return { response: text };
    } catch (error: any) {
      this.logger.error('Quick chat failed:', error?.stack || error?.message || error);
      return { response: 'Sorry, I encountered an error. Please try again.' };
    }
  }

  /**
   * Core Chat: Direct conversation with the 4Ever Core.
   * The Core knows everything about the user — context, memories, mood,
   * completion patterns, pending actions — and provides direct advice.
   */
  async coreChat(
    userId: string,
    message: string,
  ) {
    // Capture 'now' BEFORE any DB writes so gap math is stable.
    const now = new Date();

    // Save user message to DB
    await this.prisma.coreChatMessage.create({
      data: { userId, role: 'user', content: message },
    });

    // Load conversation history from DB (last 20 messages, respecting session boundary)
    const sessionRows = await this.prisma.$queryRawUnsafe(
      `SELECT core_chat_session_start, timezone, last_session_recap, last_session_recap_for FROM user_contexts WHERE user_id = $1 LIMIT 1`,
      userId,
    ).catch(() => [] as any[]) as any[];
    const sessionStart = sessionRows?.[0]?.core_chat_session_start || null;
    const userTz: string | null = sessionRows?.[0]?.timezone || null;

    // Find the most recent PRIOR message (exclude the user message we just saved)
    // to measure idle gap. Look across all time, not just the current session.
    const priorMsg = await this.prisma.coreChatMessage.findFirst({
      where: { userId, createdAt: { lt: now } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }).catch(() => null);
    const gapMeta = computeSessionGap(priorMsg?.createdAt ?? null, now);

    // Auto-start a new session after 24h of silence (fire-and-forget so we don't block).
    // Only flip if the prior message predates the current session boundary as well —
    // otherwise the boundary was already just flipped manually.
    if (
      gapMeta.isNewSession &&
      priorMsg?.createdAt &&
      (!sessionStart || new Date(sessionStart).getTime() <= priorMsg.createdAt.getTime())
    ) {
      void this.newCoreChatSession(userId).catch((err) => {
        this.logger.warn(`Auto new-session failed: ${err?.message || err}`);
      });
    }

    // Build (or reuse cached) "while you were away" recap for returning users.
    let recap: string | null = null;
    if (gapMeta.isNewSession && priorMsg?.createdAt) {
      const cached = (sessionRows?.[0]?.last_session_recap as string | null) ?? null;
      const cachedFor = (sessionRows?.[0]?.last_session_recap_for as Date | null) ?? null;
      const anchorMs = priorMsg.createdAt.getTime();
      if (cached && cachedFor && new Date(cachedFor).getTime() >= anchorMs) {
        recap = cached;
      } else {
        recap = await this.buildSessionRecap(userId, priorMsg.createdAt);
        if (recap) {
          await this.prisma.$executeRawUnsafe(
            `UPDATE user_contexts SET last_session_recap = $1, last_session_recap_for = NOW() WHERE user_id = $2`,
            recap, userId,
          ).catch(() => {});
        }
      }
    }

    const historyWhere: any = { userId };
    if (sessionStart) {
      historyWhere.createdAt = { gte: new Date(sessionStart) };
    }
    const historyDesc = await this.prisma.coreChatMessage.findMany({
      where: historyWhere,
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { role: true, content: true, createdAt: true },
    });
    const history = historyDesc.reverse();

    // Gather all user context in parallel
    const contextParts = await this.buildCoreChatContext(userId, message);

    // V0 Skill System — shadow detection (logs matched skills, does not inject)
    this.skillsService.getRelevantSkillPrompt({ surface: 'core_chat', message });

    const timeMeta = formatNowInTz(userTz);
    const systemPrompt = this.buildCoreChatSystemPrompt(contextParts, timeMeta, gapMeta, recap);

    try {
      // Create per-request ReAct agent (tools need userId bound)
      const pendingCreator: PendingActionCreator | undefined =
        process.env.NODE_ENV === 'production'
          ? (toolName, payload, riskLevel) =>
              this.agentActions.createPending(userId, toolName, payload, riskLevel)
          : undefined;
      const agent = createCoreChatAgent(
        this.prisma,
        userId,
        this.openRouterApiKey,
        this.defaultModel,
        this.tavilyApiKey,
        this.dimensions,
        pendingCreator,
      );

      // Build messages for the agent — prefix each history message with its age
      const agentMessages: Array<{ role: string; content: string }> = [
        { role: 'system', content: systemPrompt },
        ...history.map((m) => ({
          role: m.role,
          content: `[${timeAgo(m.createdAt)}] ${m.content}`,
        })),
      ];

      // Invoke the ReAct agent with recursion limit
      const agentResult = await agent.invoke(
        { messages: agentMessages },
        { recursionLimit: 25 },
      );

      // Extract the final AI message from the agent's output
      const outputMessages = agentResult.messages || [];
      const lastAiMessage = [...outputMessages]
        .reverse()
        .find((m: any) => {
          if (m._getType?.() !== 'ai' && m.role !== 'assistant') return false;
          // Skip AI messages that only contain tool_calls (no text)
          const c = m.content;
          if (typeof c === 'string' && c.trim()) return true;
          if (Array.isArray(c)) {
            return c.some((part: any) => part.type === 'text' && part.text?.trim());
          }
          return false;
        });

      let text = '';
      if (lastAiMessage) {
        const content = lastAiMessage.content ?? lastAiMessage.text ?? '';
        if (typeof content === 'string') {
          text = content;
        } else if (Array.isArray(content)) {
          text = content
            .filter((part: any) => part.type === 'text' && part.text)
            .map((part: any) => part.text)
            .join('\n');
        } else {
          text = JSON.stringify(content);
        }
      }

      if (!text) {
        text = 'I processed your request but couldn\'t generate a response. Please try again.';
      }

      // Defensive: strip any leaked [time ago] metadata tag the model may have copied
      text = stripLeakedTimePrefix(text);

      // Fire-and-forget: extract profile updates + memories from this conversation
      this.extractCoreChatLearnings(userId, message, text).catch((err) =>
        this.logger.error('Core chat learning extraction failed:', err.message),
      );

      // Save assistant response to DB
      await this.prisma.coreChatMessage.create({
        data: { userId, role: 'assistant', content: text },
      });

      return { response: text };
    } catch (error: any) {
      this.logger.error('Core chat failed:', error?.stack || error?.message || error);
      return { response: 'Sorry, I encountered an error. Please try again.' };
    }
  }

  /**
   * Core Chat Stream: Same as coreChat but yields SSE events for real-time "thinking out loud" UX.
   * Emits: thinking, tool_start, tool_end, response, done
   */
  async *coreChatStream(
    userId: string,
    message: string,
  ): AsyncGenerator<{ event: string; data: any }> {
    // Capture 'now' BEFORE any DB writes so gap math is stable.
    const now = new Date();

    // Save user message to DB
    await this.prisma.coreChatMessage.create({
      data: { userId, role: 'user', content: message },
    });

    yield { event: 'thinking', data: { status: 'loading_context' } };

    // Load conversation history from DB (last 20 messages, respecting session boundary)
    const streamSessionRows = await this.prisma.$queryRawUnsafe(
      `SELECT core_chat_session_start, timezone, last_session_recap, last_session_recap_for FROM user_contexts WHERE user_id = $1 LIMIT 1`,
      userId,
    ).catch(() => [] as any[]) as any[];
    const streamSessionStart = streamSessionRows?.[0]?.core_chat_session_start || null;
    const streamUserTz: string | null = streamSessionRows?.[0]?.timezone || null;

    // Find the most recent PRIOR message to measure idle gap.
    const streamPriorMsg = await this.prisma.coreChatMessage.findFirst({
      where: { userId, createdAt: { lt: now } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }).catch(() => null);
    const streamGapMeta = computeSessionGap(streamPriorMsg?.createdAt ?? null, now);

    // Auto-start a new session after 24h of silence (fire-and-forget).
    if (
      streamGapMeta.isNewSession &&
      streamPriorMsg?.createdAt &&
      (!streamSessionStart || new Date(streamSessionStart).getTime() <= streamPriorMsg.createdAt.getTime())
    ) {
      void this.newCoreChatSession(userId).catch((err) => {
        this.logger.warn(`Auto new-session failed (stream): ${err?.message || err}`);
      });
    }

    // Build (or reuse cached) "while you were away" recap for returning users.
    let streamRecap: string | null = null;
    if (streamGapMeta.isNewSession && streamPriorMsg?.createdAt) {
      const cached = (streamSessionRows?.[0]?.last_session_recap as string | null) ?? null;
      const cachedFor = (streamSessionRows?.[0]?.last_session_recap_for as Date | null) ?? null;
      const anchorMs = streamPriorMsg.createdAt.getTime();
      if (cached && cachedFor && new Date(cachedFor).getTime() >= anchorMs) {
        streamRecap = cached;
      } else {
        streamRecap = await this.buildSessionRecap(userId, streamPriorMsg.createdAt);
        if (streamRecap) {
          await this.prisma.$executeRawUnsafe(
            `UPDATE user_contexts SET last_session_recap = $1, last_session_recap_for = NOW() WHERE user_id = $2`,
            streamRecap, userId,
          ).catch(() => {});
        }
      }
    }

    const streamHistoryWhere: any = { userId };
    if (streamSessionStart) {
      streamHistoryWhere.createdAt = { gte: new Date(streamSessionStart) };
    }
    const historyDesc = await this.prisma.coreChatMessage.findMany({
      where: streamHistoryWhere,
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { role: true, content: true, createdAt: true },
    });
    const history = historyDesc.reverse();

    // Gather all user context in parallel
    const contextParts = await this.buildCoreChatContext(userId, message);

    // V0 Skill System — shadow detection (logs matched skills, does not inject)
    this.skillsService.getRelevantSkillPrompt({ surface: 'core_chat', message });

    const streamTimeMeta = formatNowInTz(streamUserTz);
    const systemPrompt = this.buildCoreChatSystemPrompt(contextParts, streamTimeMeta, streamGapMeta, streamRecap);

    yield { event: 'thinking', data: { status: 'reasoning' } };

    try {
      const streamPendingCreator: PendingActionCreator | undefined =
        process.env.NODE_ENV === 'production'
          ? (toolName, payload, riskLevel) =>
              this.agentActions.createPending(userId, toolName, payload, riskLevel)
          : undefined;
      const tools = getCoreChatToolList(
        this.prisma,
        userId,
        this.openRouterApiKey,
        this.tavilyApiKey,
        this.dimensions,
        streamPendingCreator,
      );

      const agentMessages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> = [
        { role: 'system', content: systemPrompt },
        ...history.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: `[${timeAgo(m.createdAt)}] ${m.content}`,
        })),
      ];
      // The latest user message is already saved to DB above and included in `history`,
      // so we do NOT append it again here.

      let finalText = '';

      // Run the streaming ReAct loop. It yields:
      //   - thinking_delta: reasoning tokens from the thinking model
      //   - tool_start / tool_end: per tool call lifecycle
      //   - token / token_reset: visible content streaming
      //   - response: final assistant text
      const loop = runCoreChatStreamLoop({
        apiKey: this.openRouterApiKey,
        model: this.defaultModel,
        messages: agentMessages,
        tools,
        timeoutMs: this.STREAM_TIMEOUT_MS,
      });

      for await (const event of loop) {
        if (event.event === 'response') {
          finalText = event.data?.text || '';
          continue; // we'll emit our own response event after sanitisation
        }
        yield event;
      }

      if (!finalText) {
        finalText = 'I processed your request but couldn\'t generate a response. Please try again.';
      }

      // Defensive: strip any leaked [time ago] metadata tag the model may have copied
      finalText = stripLeakedTimePrefix(finalText);

      yield { event: 'response', data: { text: finalText } };

      // Fire-and-forget: extract profile updates + memories
      this.extractCoreChatLearnings(userId, message, finalText).catch((err) =>
        this.logger.error('Core chat learning extraction failed:', err.message),
      );

      // Save assistant response to DB
      await this.prisma.coreChatMessage.create({
        data: { userId, role: 'assistant', content: finalText },
      });

      yield { event: 'done', data: {} };
    } catch (error: any) {
      this.logger.error('Core chat stream failed:', error?.stack || error?.message || error);
      yield { event: 'response', data: { text: 'Sorry, I encountered an error. Please try again.' } };
      yield { event: 'done', data: {} };
    }
  }

  /**
   * Get Core Chat conversation history for a user.
   */
  async getCoreChatHistory(userId: string, limit = 50, cursor?: string) {
    const take = Math.min(limit, 200);
    const where: any = { userId };
    if (cursor) {
      where.createdAt = { lt: new Date(cursor) };
    }
    const messages = await this.prisma.coreChatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      select: { id: true, role: true, content: true, createdAt: true },
    });

    const hasMore = messages.length > take;
    if (hasMore) messages.pop();
    messages.reverse(); // return in chronological order

    // Also fetch session start for UI divider
    const sessRows = await this.prisma.$queryRawUnsafe(
      `SELECT core_chat_session_start FROM user_contexts WHERE user_id = $1 LIMIT 1`,
      userId,
    ).catch(() => [] as any[]) as any[];
    const sessionStartedAt = sessRows?.[0]?.core_chat_session_start
      ? new Date(sessRows[0].core_chat_session_start).toISOString()
      : null;

    return {
      messages,
      hasMore,
      nextCursor: hasMore && messages.length > 0 ? messages[0].createdAt.toISOString() : null,
      sessionStartedAt,
    };
  }

  /**
   * Clear Core Chat conversation history for a user.
   */
  async clearCoreChatHistory(userId: string) {
    await this.prisma.coreChatMessage.deleteMany({ where: { userId } });
    // Also reset session start
    await this.prisma.$executeRawUnsafe(
      `UPDATE user_contexts SET core_chat_session_start = NULL WHERE user_id = $1`,
      userId,
    ).catch(() => {});
    return { success: true };
  }

  /**
   * Start a new Core Chat session. Old messages remain in DB but LLM only sees new ones.
   * Before starting the new session, summarize the current session for cross-session context.
   */
  async newCoreChatSession(userId: string) {
    // 1. Fetch current session boundary
    const sessRows = await this.prisma.$queryRawUnsafe(
      `SELECT core_chat_session_start FROM user_contexts WHERE user_id = $1 LIMIT 1`,
      userId,
    ).catch(() => [] as any[]) as any[];
    const sessionStart = sessRows?.[0]?.core_chat_session_start || null;

    // 2. Flip the session boundary IMMEDIATELY so the user gets an instant response.
    const now = new Date();
    await this.prisma.$executeRawUnsafe(
      `UPDATE user_contexts SET core_chat_session_start = $1 WHERE user_id = $2`,
      now,
      userId,
    ).catch(() => {});

    // 3. Kick off session summarization in the background (truly fire-and-forget).
    //    Any LLM latency happens after the response is sent.
    void this.summarizePreviousSession(userId, sessionStart, now).catch((err) => {
      this.logger.warn(`Session summarization failed: ${err?.message || err}`);
    });

    return { success: true, sessionStartedAt: now.toISOString() };
  }

  // =================== VOICE (STT + TTS) ===================

  /**
   * Transcribe an audio clip to text using an OpenRouter multimodal model.
   * Accepts a raw buffer (e.g. m4a/mp3/webm/wav) and its MIME type.
   */
  async transcribeAudio(buffer: Buffer, mimeType: string): Promise<{ text: string }> {
    if (!buffer || buffer.length === 0) {
      throw new Error('Empty audio payload');
    }
    if (!this.openRouterApiKey) {
      throw new Error('OPENROUTER_API_KEY not configured');
    }

    // OpenRouter multimodal audio input: base64-encoded data URL-ish format.
    // Most OpenAI-compatible audio models accept { type: 'input_audio', input_audio: { data, format } }.
    const base64 = buffer.toString('base64');
    const format = (mimeType || '').includes('wav')
      ? 'wav'
      : (mimeType || '').includes('mp3') || (mimeType || '').includes('mpeg')
        ? 'mp3'
        : (mimeType || '').includes('webm')
          ? 'webm'
          : (mimeType || '').includes('m4a') || (mimeType || '').includes('mp4') || (mimeType || '').includes('aac')
            ? 'm4a'
            : 'm4a';

    const body = {
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Transcribe this audio verbatim. Return ONLY the transcript text with no preamble, quoting, or commentary.' },
            { type: 'input_audio', input_audio: { data: base64, format } },
          ],
        },
      ],
      temperature: 0,
    };

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.openRouterApiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      this.logger.warn(`Transcribe failed: ${res.status} ${errText.slice(0, 200)}`);
      throw new Error(`Transcription failed (${res.status})`);
    }

    const json: any = await res.json();
    const text: string = (json?.choices?.[0]?.message?.content || '').trim();
    return { text };
  }

  /**
   * Synthesize speech (TTS) via OpenRouter's audio/speech endpoint.
   * Returns raw audio bytes (mp3) that the controller streams back to the client.
   */
  async synthesizeSpeech(text: string, voice = 'nova'): Promise<Buffer> {
    const clean = (text || '').trim();
    if (!clean) {
      throw new Error('Empty text for TTS');
    }
    if (!this.openRouterApiKey) {
      throw new Error('OPENROUTER_API_KEY not configured');
    }

    // Cap length so TTS call stays bounded.
    const MAX_TTS_CHARS = 2000;
    const input = clean.length > MAX_TTS_CHARS ? clean.slice(0, MAX_TTS_CHARS) : clean;

    const res = await fetch('https://openrouter.ai/api/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.openRouterApiKey}`,
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini-tts-2025-12-15',
        input,
        voice,
        response_format: 'mp3',
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      this.logger.warn(`TTS failed: ${res.status} ${errText.slice(0, 200)}`);
      throw new Error(`TTS failed (${res.status})`);
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  private async summarizePreviousSession(
    userId: string,
    sessionStart: Date | string | null,
    sessionEnd: Date,
  ) {
    const historyWhere: any = { userId, createdAt: { lt: sessionEnd } };
    if (sessionStart) {
      historyWhere.createdAt = { gte: new Date(sessionStart), lt: sessionEnd };
    }
    const messages = await this.prisma.coreChatMessage.findMany({
      where: historyWhere,
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true, createdAt: true },
      take: 50,
    });

    if (messages.length < 2) return;

    const conversationText = messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Core'}: ${m.content.substring(0, 300)}`)
      .join('\n');

    const llm = new ChatOpenRouter({
      model: this.defaultModel,
      temperature: 0.2,
      maxTokens: 512,
      apiKey: this.openRouterApiKey,
    });

    const summaryResult = await llm.invoke([
      {
        role: 'system',
        content: `Summarize this chat session between a user and their personal AI advisor. Include:
- Key topics discussed
- Decisions made or advice given
- Emotional tone / mood
- Unresolved items or follow-ups needed
Keep it under 200 words. Also extract 3-5 key topic tags (comma-separated) on a separate last line prefixed with "Topics: ".`,
      },
      { role: 'user', content: conversationText.substring(0, 4000) },
    ]);

    const summaryText = typeof summaryResult.content === 'string'
      ? summaryResult.content
      : JSON.stringify(summaryResult.content);

    const topicsMatch = summaryText.match(/Topics?:\s*(.+)/i);
    const keyTopics = topicsMatch ? topicsMatch[1].trim() : null;
    const summaryBody = topicsMatch
      ? summaryText.substring(0, topicsMatch.index).trim()
      : summaryText.trim();

    const summary = await this.prisma.coreChatSummary.create({
      data: {
        userId,
        sessionStart: sessionStart ? new Date(sessionStart) : messages[0].createdAt,
        sessionEnd,
        summary: summaryBody,
        messageCount: messages.length,
        keyTopics,
      },
    });
    this.logger.log(`Session summary created (${messages.length} messages)`);
  }

  /**
   * Fire-and-forget: Extracts profile updates and memories from Core Chat messages.
   * This makes the Core "learn" from every conversation.
   */
  private async extractCoreChatLearnings(
    userId: string,
    userMessage: string,
    coreResponse: string,
  ) {
    const llm = new ChatOpenRouter({
      model: this.defaultModel,
      temperature: 0.1,
      maxTokens: 1024,
      apiKey: this.openRouterApiKey,
    });

    const result = await llm.invoke([
      {
        role: 'system',
        content: `Analyze this conversation between a user and their personal AI advisor. Extract three things:

1. "profileUpdates" — Any NEW information the user revealed about themselves. Valid fields:
   - situation, goals, pendingDecisions, currentProjects, values, role, background, location
   - Only include fields where the user explicitly shared something new
   - If nothing new, use empty object {}

2. "memories" — 0-2 important facts or insights worth remembering long-term. Each memory has:
   - content: A concise statement (1-2 sentences)
   - memoryType: one of "fact", "preference", "decision", "insight", "goal"
   - importanceScore: 1-10 (10 = life-changing, 1 = trivial)
   - Only include genuinely important things, not small talk

3. "actions" — 0-3 concrete action items suggested by the advisor or committed to by the user. Each action has:
   - content: A clear 1-sentence actionable task
   - dimension: one of "Health", "Career", "Relationships", "Finance", "Learning", "Creativity", "Spirituality", or null
   - Only include if the advisor gave clear actionable advice or the user committed to doing something
   - If nothing actionable, use empty array []

4. "dimensionSignals" — 0-4 passive signals about the user's life dimensions. Each signal has:
   - dimension: EXACTLY one of: "health" | "financial" | "career" | "intellectual" | "relationships" | "purpose"
     • health = body/mind, sleep, exercise, nutrition, mental wellbeing
     • financial = money, savings, security, spending, earning
     • career = work, craft, professional growth, meaningful contribution
     • intellectual = learning, reading, curiosity, creative thinking
     • relationships = family, friends, partner, social connection
     • purpose = values, meaning, long-term direction, spirituality
   - valence: integer -3..+3 (-3 = very drained/stuck, -1 = mild concern, +1 = small win, +3 = major breakthrough). NEVER 0.
   - summary: A short fragment (max 80 chars) describing the signal, e.g. "slept poorly 3 nights" or "closed a big deal"
   - Only include signals that reflect the user's actual state/events, NOT the advisor's suggestions
   - If the conversation was small-talk/neutral, use empty array []

Respond with ONLY valid JSON. No markdown fences.
Example: {"profileUpdates": {"situation": "Starting a new job next month"}, "memories": [{"content": "User decided to accept the job offer", "memoryType": "decision", "importanceScore": 8}], "actions": [{"content": "Draft resignation letter by Friday", "dimension": "Career"}], "dimensionSignals": [{"dimension": "career", "valence": 2, "summary": "accepted new job offer"}]}`,
      },
      {
        role: 'user',
        content: `User said: ${userMessage}\n\nCore responded: ${coreResponse}`,
      },
    ]);

    const text =
      typeof result.content === 'string'
        ? result.content
        : JSON.stringify(result.content);

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        return;
      }
    }

    // 1. Apply profile updates
    const validFields = [
      'situation', 'goals', 'pendingDecisions', 'currentProjects',
      'values', 'role', 'background', 'location',
    ];
    const updates: Record<string, string> = {};
    if (parsed.profileUpdates && typeof parsed.profileUpdates === 'object') {
      for (const [key, value] of Object.entries(parsed.profileUpdates)) {
        if (validFields.includes(key) && typeof value === 'string' && (value as string).trim()) {
          updates[key] = (value as string).trim();
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      const existing = await this.prisma.userContext.findUnique({
        where: { userId },
      });

      if (existing) {
        const mergedData: Record<string, string> = {};
        for (const [key, newVal] of Object.entries(updates)) {
          const existingVal = (existing as any)[key] as string | null;
          if (existingVal && !existingVal.includes(newVal)) {
            mergedData[key] = `${existingVal}; ${newVal}`;
          } else if (!existingVal) {
            mergedData[key] = newVal;
          }
        }
        if (Object.keys(mergedData).length > 0) {
          await this.prisma.userContext.update({
            where: { userId },
            data: mergedData,
          });
          // Log profile changes to audit trail
          for (const [key, newVal] of Object.entries(mergedData)) {
            const oldVal = (existing as any)[key] as string | null;
            logProfileChange(this.prisma, userId, key, oldVal, newVal, 'core_chat').catch(() => {});
          }
          this.logger.log(`Core Chat: Updated user profile fields: ${Object.keys(mergedData).join(', ')}`);
        }
      } else {
        await this.prisma.userContext.create({
          data: { userId, ...updates },
        });
        // Log profile creation to audit trail
        for (const [key, newVal] of Object.entries(updates)) {
          logProfileChange(this.prisma, userId, key, null, newVal, 'core_chat').catch(() => {});
        }
        this.logger.log(`Core Chat: Created user profile with fields: ${Object.keys(updates).join(', ')}`);
      }
    }

    // 2. Store memories
    const memories = Array.isArray(parsed.memories) ? parsed.memories.slice(0, 2) : [];
    for (const mem of memories) {
      if (
        mem.content &&
        typeof mem.content === 'string' &&
        mem.importanceScore &&
        mem.importanceScore >= 3
      ) {
        await storeMemoryWithDedup(this.prisma, this.openRouterApiKey, {
          userId,
          content: mem.content,
          memoryType: mem.memoryType || 'insight',
          importanceScore: mem.importanceScore / 10, // normalize to 0-1
          sourceThreadId: null,
          source: 'core_chat',
        });
        this.logger.log(`Core Chat: Stored memory (importance ${mem.importanceScore}): ${mem.content.substring(0, 60)}...`);
      }
    }

    // 3. Action items — DISABLED: do NOT auto-create action items in the background.
    // Core must always confirm with the user before creating an action item (see CONFIRMATION RULE
    // in buildCoreChatSystemPrompt). Action items are only created when the agent explicitly
    // invokes the create_action tool after user confirmation.

    // 4. Record dimension signals (passive Life Wheel inference).
    const rawSignals = Array.isArray(parsed.dimensionSignals) ? parsed.dimensionSignals.slice(0, 4) : [];
    for (const sig of rawSignals) {
      if (!sig || typeof sig !== 'object') continue;
      const dim = String(sig.dimension || '').toLowerCase().trim();
      if (!isValidDimension(dim)) continue;
      const valence = Math.round(Number(sig.valence));
      if (!Number.isFinite(valence) || valence === 0) continue;
      const summary = typeof sig.summary === 'string' ? sig.summary.slice(0, 200) : undefined;
      await this.dimensions.recordSignal({
        userId,
        dimension: dim,
        valence,
        source: 'core_chat',
        summary,
      }).catch((err) =>
        this.logger.warn(`recordSignal failed for ${dim}: ${err?.message || err}`),
      );
    }
    if (rawSignals.length > 0) {
      this.logger.log(`Core Chat: Recorded ${rawSignals.length} dimension signal(s)`);
    }

    // 5. Fire-and-forget: check if consolidation is needed
    this.memoryConsolidation.maybeConsolidate(userId).catch((err) =>
      this.logger.warn(`Memory consolidation check failed: ${err.message}`),
    );
  }

  // =================== PERSONA DIRECT CHAT ===================

  /**
   * Build a system prompt for direct persona chat, enriched with relationship context.
   */
  private async buildPersonaChatSystemPrompt(
    userId: string,
    persona: any,
    message: string,
  ): Promise<string> {
    let systemContent = persona.systemPrompt;

    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    systemContent += `\n\nToday's date is ${today}.`;

    // Find the relationship person linked to this persona
    const relationshipPerson = await this.prisma.relationshipPerson.findFirst({
      where: { userId, linkedPersonaId: persona.id, isActive: true },
      include: { notes: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });

    if (relationshipPerson) {
      const parts: string[] = [];
      parts.push(`You are roleplaying as ${relationshipPerson.name}, who is the user's ${relationshipPerson.relationship}.`);
      if (relationshipPerson.description) parts.push(`About you: ${relationshipPerson.description}`);
      if (relationshipPerson.dynamic) parts.push(`Your dynamic with the user: ${relationshipPerson.dynamic}`);
      if (relationshipPerson.keyContext) parts.push(`Key context: ${relationshipPerson.keyContext}`);
      if (relationshipPerson.communicationStyle) parts.push(`Your communication style: ${relationshipPerson.communicationStyle}`);
      if (relationshipPerson.loveLanguage) parts.push(`Love language: ${relationshipPerson.loveLanguage.replace(/_/g, ' ')}`);

      systemContent += `\n\n--- Relationship Context ---\n${parts.join('\n')}`;

      // Add recent interaction notes for continuity
      if (relationshipPerson.notes.length > 0) {
        const noteLines = relationshipPerson.notes.map((n) => {
          const dateStr = n.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const sentiment = n.sentiment ? ` [${n.sentiment}]` : '';
          return `- ${dateStr}${sentiment}: ${n.content}`;
        });
        systemContent += `\n\n--- Recent Interaction History ---\n${noteLines.join('\n')}`;
      }
    }

    // Add user context, memories, and standard context
    const ctx = await this.buildPersonaContext(userId, message);
    systemContent = this.appendPersonaContextToPrompt(systemContent, ctx);

    // RAG knowledge base from persona's uploaded documents
    try {
      const ragChunks = await this.knowledgeBaseService.retrieveRelevantChunks(persona.id, message, 5);
      if (ragChunks.length > 0) {
        const ragContext = ragChunks.map((chunk, i) => `[${i + 1}] ${chunk}`).join('\n---\n');
        systemContent += `\n\n--- Reference Knowledge ---\n${ragContext}`;
      }
    } catch (err) {
      this.logger.error(`RAG retrieval failed for persona ${persona.id}:`, err);
    }

    return systemContent;
  }

  /**
   * Streaming persona direct chat — used from My Circle to chat with a person's AI persona.
   */
  async *personaDirectChatStream(
    userId: string,
    personaId: string,
    message: string,
  ): AsyncGenerator<{ event: string; data: any }> {
    // 1. Fetch persona (user's own + shared library templates)
    const persona = await this.prisma.persona.findFirst({
      where: {
        id: personaId,
        OR: [{ userId }, { isTemplate: true }],
        isActive: true,
      },
    });
    if (!persona) throw new NotFoundException('Persona not found or inactive');

    // 2. Save user message
    await this.prisma.personaChatMessage.create({
      data: { userId, personaId, role: 'user', content: message },
    });

    yield { event: 'thinking', data: { status: 'loading_context' } };

    // 3. Load conversation history (last 20 messages, newest first then reverse)
    const historyDesc = await this.prisma.personaChatMessage.findMany({
      where: { userId, personaId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const history = historyDesc.reverse();

    // 4. Build system prompt with relationship context
    const systemContent = await this.buildPersonaChatSystemPrompt(userId, persona, message);

    const langchainMessages = [
      { role: 'system' as const, content: systemContent },
      ...history.slice(-15).map((msg) => ({
        role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: msg.content,
      })),
    ];

    yield { event: 'thinking', data: { status: 'reasoning' } };

    // 5. Stream LLM response
    const modelName = persona.modelName || this.defaultModel;
    try {
      const fetchBody = JSON.stringify({
        model: modelName,
        messages: langchainMessages.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: 50000,
        temperature: 0.7,
        stream: true,
        reasoning: { effort: 'high' },
      });

      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), this.STREAM_TIMEOUT_MS);

      const fetchRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openRouterApiKey}`,
        },
        body: fetchBody,
        signal: abortController.signal,
      });

      if (!fetchRes.ok || !fetchRes.body) {
        clearTimeout(timeoutId);
        throw new Error(`OpenRouter API error: ${fetchRes.status}`);
      }

      let fullText = '';
      const decoder = new TextDecoder();
      let buffer = '';

      for await (const rawChunk of fetchRes.body as any) {
        buffer += decoder.decode(rawChunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            if (delta.reasoning && typeof delta.reasoning === 'string') {
              yield { event: 'thinking_delta', data: { chunk: delta.reasoning } };
            }
            if (delta.content && typeof delta.content === 'string') {
              fullText += delta.content;
              yield { event: 'token', data: { chunk: delta.content } };
            }
          } catch { /* skip malformed lines */ }
        }
      }

      if (!fullText) fullText = '[No response generated]';

      clearTimeout(timeoutId);
      yield { event: 'response', data: { text: fullText, personaName: persona.name, personaId: persona.id, modelUsed: modelName } };

      // 6. Save assistant response
      await this.prisma.personaChatMessage.create({
        data: { userId, personaId, role: 'assistant', content: fullText },
      });

      yield { event: 'done', data: {} };
    } catch (error: any) {
      const isTimeout = error?.name === 'AbortError';
      const errorMsg = isTimeout
        ? `Response from ${persona.name} timed out after ${this.STREAM_TIMEOUT_MS / 1000}s. Please try again.`
        : `[Error] Failed to get response from ${persona.name}. Please try again.`;
      this.logger.error(`Persona direct chat stream failed for ${persona.name}:`, isTimeout ? 'TIMEOUT' : error.message);
      yield { event: 'response', data: { text: errorMsg, personaName: persona.name, personaId: persona.id, modelUsed: modelName } };
      yield { event: 'done', data: {} };
    }
  }

  /**
   * Get persona direct chat history.
   */
  async getPersonaChatHistory(userId: string, personaId: string) {
    return this.prisma.personaChatMessage.findMany({
      where: { userId, personaId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, createdAt: true },
    });
  }

  /**
   * Clear persona direct chat history.
   */
  async clearPersonaChatHistory(userId: string, personaId: string) {
    await this.prisma.personaChatMessage.deleteMany({
      where: { userId, personaId },
    });
    return { cleared: true };
  }

  // =================== MEMORY MANAGEMENT API ===================

  /**
   * List all memories with optional filters and pagination.
   */
  async listMemories(
    userId: string,
    options: { status?: string; memoryType?: string; source?: string; limit?: number; cursor?: string },
  ) {
    const take = Math.min(options.limit || 50, 200);
    const where: any = { userId };
    if (options.status) where.status = options.status;
    else where.status = 'active';
    if (options.memoryType) where.memoryType = options.memoryType;
    if (options.source) where.source = options.source;
    if (options.cursor) where.createdAt = { lt: new Date(options.cursor) };

    const memories = await this.prisma.memory.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
    });

    const hasMore = memories.length > take;
    if (hasMore) memories.pop();

    return {
      memories: memories.map((m) => ({
        id: m.id,
        content: m.content,
        memoryType: m.memoryType,
        importanceScore: m.importanceScore,
        source: (m as any).source,
        status: (m as any).status,
        accessCount: (m as any).accessCount,
        lastAccessedAt: (m as any).lastAccessedAt,
        category: (m as any).category,
        createdAt: m.createdAt,
      })),
      hasMore,
      nextCursor: hasMore && memories.length > 0 ? memories[memories.length - 1].createdAt.toISOString() : null,
    };
  }

  /**
   * Semantic search memories by query.
   */
  async searchMemories(userId: string, query: string, limit = 10) {
    const embedding = await generateEmbedding(query.substring(0, 1000), this.openRouterApiKey);
    if (embedding.length === 0) {
      return { memories: [] };
    }

    const vectorStr = `[${embedding.join(',')}]`;
    const results: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT m.id, m.content, m.memory_type AS "memoryType",
              m.importance_score AS "importanceScore",
              m.source, m.status, m.access_count AS "accessCount",
              m.last_accessed_at AS "lastAccessedAt",
              m.category, m.created_at AS "createdAt",
              1 - (me.embedding <=> $1::vector) AS similarity
       FROM memories m
       JOIN memory_embeddings me ON me.memory_id = m.id
       WHERE m.user_id = $2 AND m.status = 'active'
       ORDER BY me.embedding <=> $1::vector
       LIMIT $3`,
      vectorStr,
      userId,
      limit,
    );

    return {
      memories: results.map((m) => ({
        ...m,
        similarity: m.similarity ? parseFloat((m.similarity * 100).toFixed(1)) : null,
      })),
    };
  }

  /**
   * Get memory statistics.
   */
  async getMemoryStats(userId: string) {
    const [total, byType, bySource, byStatus] = await Promise.all([
      this.prisma.memory.count({ where: { userId } }),
      this.prisma.$queryRawUnsafe(
        `SELECT memory_type AS "type", COUNT(*)::int AS count FROM memories WHERE user_id = $1 AND status = 'active' GROUP BY memory_type ORDER BY count DESC`,
        userId,
      ) as Promise<any[]>,
      this.prisma.$queryRawUnsafe(
        `SELECT source, COUNT(*)::int AS count FROM memories WHERE user_id = $1 AND status = 'active' GROUP BY source ORDER BY count DESC`,
        userId,
      ) as Promise<any[]>,
      this.prisma.$queryRawUnsafe(
        `SELECT status, COUNT(*)::int AS count FROM memories WHERE user_id = $1 GROUP BY status ORDER BY count DESC`,
        userId,
      ) as Promise<any[]>,
    ]);

    const oldest = await this.prisma.memory.findFirst({
      where: { userId, status: 'active' as any },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });

    const newest = await this.prisma.memory.findFirst({
      where: { userId, status: 'active' as any },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    return {
      total,
      active: byStatus.find((s: any) => s.status === 'active')?.count || 0,
      byType,
      bySource,
      byStatus,
      oldestMemory: oldest?.createdAt || null,
      newestMemory: newest?.createdAt || null,
    };
  }

  /**
   * Update a memory's content (re-generates embedding).
   */
  async updateMemory(userId: string, memoryId: string, content: string) {
    const memory = await this.prisma.memory.findFirst({
      where: { id: memoryId, userId },
    });
    if (!memory) throw new NotFoundException('Memory not found');

    await this.prisma.memory.update({
      where: { id: memoryId },
      data: { content },
    });

    // Re-generate embedding
    const embedding = await generateEmbedding(content, this.openRouterApiKey);
    if (embedding.length > 0) {
      const vectorStr = `[${embedding.join(',')}]`;
      const existing = await this.prisma.memoryEmbedding.findUnique({ where: { memoryId } });
      if (existing) {
        await this.prisma.$executeRawUnsafe(
          `UPDATE memory_embeddings SET embedding = $1::vector WHERE memory_id = $2`,
          vectorStr,
          memoryId,
        );
      } else {
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO memory_embeddings (id, memory_id, embedding, created_at) VALUES (gen_random_uuid(), $1, $2::vector, NOW())`,
          memoryId,
          vectorStr,
        );
      }
    }

    return { success: true };
  }

  /**
   * Soft-delete a memory (set status to 'archived').
   */
  async deleteMemory(userId: string, memoryId: string) {
    const memory = await this.prisma.memory.findFirst({
      where: { id: memoryId, userId },
    });
    if (!memory) throw new NotFoundException('Memory not found');

    await this.prisma.memory.update({
      where: { id: memoryId },
      data: { status: 'archived' as any },
    });

    return { success: true };
  }

  /**
   * Manually create a memory.
   */
  async createMemory(userId: string, content: string, memoryType: string, category?: string) {
    return storeMemoryWithDedup(this.prisma, this.openRouterApiKey, {
      userId,
      content,
      memoryType,
      importanceScore: 0.8,
      source: 'manual',
      category: category || null,
    });
  }

  /**
   * Get profile change history.
   */
  async getProfileChangelog(userId: string, limit = 50, cursor?: string) {
    const take = Math.min(limit, 200);
    const where: any = { userId };
    if (cursor) where.createdAt = { lt: new Date(cursor) };

    const logs = await this.prisma.profileChangeLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
    });

    const hasMore = logs.length > take;
    if (hasMore) logs.pop();

    return { logs, hasMore };
  }

  /**
   * Get past session summaries.
   */
  async getSessionSummaries(userId: string, limit = 20) {
    return this.prisma.coreChatSummary.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 50),
    });
  }
}
