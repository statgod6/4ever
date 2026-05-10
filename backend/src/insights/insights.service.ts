import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { ChatOpenRouter } from '@langchain/openrouter';
import { ONTOLOGY_EVENTS } from '../ontology/events';

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);
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
   * Get all stats in one call: topic distribution, timeline, status flow, persona effectiveness
   */
  async getStats(userId: string) {
    const [topicDistribution, timeline, statusFlow, personaEffectiveness] = await Promise.all([
      this.getTopicDistribution(userId),
      this.getThinkingTimeline(userId),
      this.getStatusFlow(userId),
      this.getPersonaEffectiveness(userId),
    ]);

    return { topicDistribution, timeline, statusFlow, personaEffectiveness };
  }

  /**
   * Count of thoughts grouped by thought_type
   */
  async getTopicDistribution(userId: string) {
    const results: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT thought_type AS "type", COUNT(*)::int AS count
       FROM thoughts
       WHERE user_id = $1
       GROUP BY thought_type
       ORDER BY count DESC`,
      userId,
    );

    const total = results.reduce((sum, r) => sum + r.count, 0);
    return results.map((r) => ({
      type: r.type,
      count: r.count,
      percentage: total > 0 ? Math.round((r.count / total) * 100) : 0,
    }));
  }

  /**
   * Thoughts per week for the last 12 weeks
   */
  async getThinkingTimeline(userId: string, weeks = 12) {
    const results: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT
         date_trunc('week', created_at)::date AS week,
         COUNT(*)::int AS count,
         array_agg(DISTINCT thought_type) AS types
       FROM thoughts
       WHERE user_id = $1
         AND created_at >= NOW() - INTERVAL '${weeks} weeks'
       GROUP BY date_trunc('week', created_at)
       ORDER BY week ASC`,
      userId,
    );

    return results.map((r) => ({
      week: r.week,
      count: r.count,
      types: r.types || [],
    }));
  }

  /**
   * Status breakdown + resolution rate
   */
  async getStatusFlow(userId: string) {
    const results: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT status, COUNT(*)::int AS count
       FROM thoughts
       WHERE user_id = $1
       GROUP BY status`,
      userId,
    );

    const total = results.reduce((sum, r) => sum + r.count, 0);
    const resolved = results.find((r) => r.status === 'resolved')?.count || 0;

    return {
      statuses: results,
      total,
      resolutionRate: total > 0 ? Math.round((resolved / total) * 100) : 0,
    };
  }

  /**
   * Per-persona engagement, depth, and resolution metrics
   */
  async getPersonaEffectiveness(userId: string) {
    // Get all personas for this user
    const personas = await this.prisma.persona.findMany({
      where: { userId },
      select: { id: true, name: true },
    });

    if (personas.length === 0) return [];

    const results = [];

    for (const persona of personas) {
      // Total runs (responses) from this persona
      const runCount: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS count
         FROM persona_runs
         WHERE persona_id = $1`,
        persona.id,
      );

      // Directed user replies to this persona (engagement)
      const replyCount: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS count
         FROM messages
         WHERE persona_id = $1 AND role = 'user'`,
        persona.id,
      );

      // Thoughts where this persona participated that reached 'resolved'
      const resolvedCount: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT COUNT(DISTINCT t.id)::int AS count
         FROM thoughts t
         JOIN thought_threads tt ON tt.thought_id = t.id
         JOIN persona_runs pr ON pr.thread_id = tt.id
         WHERE pr.persona_id = $1 AND t.status = 'resolved'`,
        persona.id,
      );

      const totalParticipated: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT COUNT(DISTINCT t.id)::int AS count
         FROM thoughts t
         JOIN thought_threads tt ON tt.thought_id = t.id
         JOIN persona_runs pr ON pr.thread_id = tt.id
         WHERE pr.persona_id = $1`,
        persona.id,
      );

      const totalRuns = runCount[0]?.count || 0;
      const totalReplies = replyCount[0]?.count || 0;
      const totalResolved = resolvedCount[0]?.count || 0;
      const totalThoughts = totalParticipated[0]?.count || 0;

      results.push({
        personaId: persona.id,
        personaName: persona.name,
        totalResponses: totalRuns,
        directReplies: totalReplies,
        thoughtsParticipated: totalThoughts,
        thoughtsResolved: totalResolved,
        resolutionRate: totalThoughts > 0 ? Math.round((totalResolved / totalThoughts) * 100) : 0,
        engagementScore: totalRuns > 0 ? Math.round((totalReplies / totalRuns) * 100) : 0,
      });
    }

    // Sort by engagement score descending
    results.sort((a, b) => b.engagementScore - a.engagementScore);
    return results;
  }

  /**
   * Find clusters of semantically similar thoughts using pgvector
   */
  async getRecurringTopics(userId: string) {
    // Find thought pairs with high similarity
    const pairs: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT
         t1.id AS "thoughtId1",
         t1.title AS "title1",
         t1.thought_type AS "type1",
         t1.created_at AS "date1",
         t2.id AS "thoughtId2",
         t2.title AS "title2",
         t2.thought_type AS "type2",
         t2.created_at AS "date2",
         1 - (te1.embedding <=> te2.embedding) AS similarity
       FROM thought_embeddings te1
       JOIN thought_embeddings te2 ON te1.thought_id < te2.thought_id
       JOIN thoughts t1 ON t1.id = te1.thought_id
       JOIN thoughts t2 ON t2.id = te2.thought_id
       WHERE t1.user_id = $1 AND t2.user_id = $1
         AND 1 - (te1.embedding <=> te2.embedding) > 0.7
       ORDER BY similarity DESC
       LIMIT 100`,
      userId,
    );

    // Cluster using union-find
    const parentMap = new Map<string, string>();
    const thoughtMeta = new Map<string, { id: string; title: string; type: string; date: string }>();

    function find(id: string): string {
      if (!parentMap.has(id)) parentMap.set(id, id);
      if (parentMap.get(id) !== id) {
        parentMap.set(id, find(parentMap.get(id)!));
      }
      return parentMap.get(id)!;
    }

    function union(a: string, b: string) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parentMap.set(ra, rb);
    }

    for (const pair of pairs) {
      union(pair.thoughtId1, pair.thoughtId2);
      thoughtMeta.set(pair.thoughtId1, { id: pair.thoughtId1, title: pair.title1, type: pair.type1, date: pair.date1 });
      thoughtMeta.set(pair.thoughtId2, { id: pair.thoughtId2, title: pair.title2, type: pair.type2, date: pair.date2 });
    }

    // Group by cluster root
    const clusters = new Map<string, Set<string>>();
    for (const id of thoughtMeta.keys()) {
      const root = find(id);
      if (!clusters.has(root)) clusters.set(root, new Set());
      clusters.get(root)!.add(id);
    }

    // Build result — only clusters with 2+ thoughts
    const result = [];
    for (const [, memberIds] of clusters) {
      if (memberIds.size < 2) continue;
      const thoughts = [...memberIds].map((id) => thoughtMeta.get(id)!).sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      );
      result.push({
        thoughtIds: thoughts.map((t) => t.id),
        thoughts,
        size: thoughts.length,
      });
    }

    result.sort((a, b) => b.size - a.size);
    return result;
  }

  /**
   * LLM-generated evolution analysis for a cluster of related thoughts
   */
  async generateEvolutionAnalysis(userId: string, thoughtIds: string[]) {
    // Load thoughts with summaries, ordered by date
    const thoughts = await this.prisma.thought.findMany({
      where: { id: { in: thoughtIds }, userId },
      orderBy: { createdAt: 'asc' },
      include: {
        threads: {
          include: {
            summary: true,
            messages: {
              orderBy: { createdAt: 'asc' },
              take: 5,
            },
          },
        },
      },
    });

    if (thoughts.length < 2) {
      throw new Error('Need at least 2 thoughts for evolution analysis');
    }

    // Build context for the LLM
    const contextParts = thoughts.map((t, i) => {
      const date = t.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const summary = t.threads[0]?.summary?.runningSummary || 'No summary available';
      const keyMessages = t.threads[0]?.messages
        ?.slice(0, 3)
        .map((m) => `${m.role}: ${m.content.substring(0, 200)}`)
        .join('\n') || '';

      return `--- Thought ${i + 1}: "${t.title}" (${date}) ---\nType: ${t.thoughtType}\nContent: ${t.rawText}\nDiscussion Summary: ${summary}\n${keyMessages ? `Key messages:\n${keyMessages}` : ''}`;
    });

    const model = new ChatOpenRouter({
      model: this.defaultModel,
      temperature: 0.5,
      maxTokens: 1024,
      apiKey: this.openRouterApiKey,
    });

    const response = await model.invoke([
      {
        role: 'system',
        content:
          'You are a personal thinking analyst. Analyze how this person\'s thinking has evolved across related thoughts over time. ' +
          'Focus on:\n' +
          '1. How their core position or understanding shifted\n' +
          '2. What new insights emerged over time\n' +
          '3. What patterns or recurring themes you notice\n' +
          '4. What seems unresolved or still evolving\n' +
          'Be specific, reference dates, and be empathetic. Write in second person ("You started by..."). ' +
          'Format with markdown headers and bullet points. Keep it concise but insightful.',
      },
      {
        role: 'user',
        content: `Analyze the evolution of thinking across these ${thoughts.length} related thoughts:\n\n${contextParts.join('\n\n')}`,
      },
    ]);

    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    const title = `Evolution: ${thoughts[0].title} → ${thoughts[thoughts.length - 1].title}`;

    // Cache the report
    const report = await this.prisma.insightReport.create({
      data: {
        userId,
        reportType: 'evolution',
        title,
        content,
        metadata: JSON.stringify({ thoughtIds }),
      },
    });

    this.events.emit(ONTOLOGY_EVENTS.SELF_INPUT, {
      userId,
      eventType: 'insight.generated',
      payload: { reportType: 'evolution', reportId: report.id },
    });

    return report;
  }

  /**
   * Generate a weekly insight report summarizing the last 7 days
   */
  async generateWeeklyInsight(userId: string) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Get recent thoughts
    const recentThoughts = await this.prisma.thought.findMany({
      where: { userId, createdAt: { gte: sevenDaysAgo } },
      orderBy: { createdAt: 'asc' },
      include: {
        threads: {
          include: {
            summary: true,
            runs: { include: { persona: true } },
          },
        },
      },
    });

    // Get persona stats for the week
    const recentRuns: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT p.name, COUNT(*)::int AS count
       FROM persona_runs pr
       JOIN personas p ON p.id = pr.persona_id
       WHERE pr.created_at >= $1
         AND p.user_id = $2
       GROUP BY p.name
       ORDER BY count DESC`,
      sevenDaysAgo,
      userId,
    );

    // Get status changes
    const resolvedThisWeek = await this.prisma.thought.count({
      where: { userId, status: 'resolved', updatedAt: { gte: sevenDaysAgo } },
    });

    const contextParts: string[] = [];
    contextParts.push(`Period: Last 7 days (ending ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})`);
    contextParts.push(`Total new thoughts: ${recentThoughts.length}`);
    contextParts.push(`Thoughts resolved: ${resolvedThisWeek}`);

    if (recentRuns.length > 0) {
      contextParts.push(`Most active personas: ${recentRuns.map((r) => `${r.name} (${r.count} responses)`).join(', ')}`);
    }

    for (const t of recentThoughts) {
      const summary = t.threads[0]?.summary?.runningSummary || t.rawText.substring(0, 200);
      contextParts.push(`\nThought: "${t.title}" (${t.thoughtType}, ${t.status})\nSummary: ${summary}`);
    }

    if (recentThoughts.length === 0) {
      // No thoughts this week — generate a light report
      const report = await this.prisma.insightReport.create({
        data: {
          userId,
          reportType: 'weekly',
          title: `Weekly Insight — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
          content: 'No new thoughts were recorded this week. Take a moment to capture what\'s on your mind — even small reflections compound over time.',
        },
      });
      this.events.emit(ONTOLOGY_EVENTS.SELF_INPUT, {
        userId,
        eventType: 'insight.generated',
        payload: { reportType: 'weekly', reportId: report.id, empty: true },
      });
      return report;
    }

    const model = new ChatOpenRouter({
      model: this.defaultModel,
      temperature: 0.5,
      maxTokens: 1024,
      apiKey: this.openRouterApiKey,
    });

    const response = await model.invoke([
      {
        role: 'system',
        content:
          'You are a personal thinking analyst generating a weekly insight report. ' +
          'Analyze the user\'s thinking patterns from the past week. Include:\n' +
          '1. A brief overview of what they focused on\n' +
          '2. Key themes or patterns you notice\n' +
          '3. Any shifts in thinking or new directions\n' +
          '4. Which topics seem to need more attention\n' +
          '5. A brief encouraging observation\n' +
          'Write in second person. Use markdown formatting. Be concise but insightful (under 300 words).',
      },
      {
        role: 'user',
        content: `Generate a weekly thinking insight report:\n\n${contextParts.join('\n')}`,
      },
    ]);

    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    const report = await this.prisma.insightReport.create({
      data: {
        userId,
        reportType: 'weekly',
        title: `Weekly Insight — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
        content,
        metadata: JSON.stringify({
          thoughtCount: recentThoughts.length,
          resolvedCount: resolvedThisWeek,
          topPersonas: recentRuns.slice(0, 3).map((r) => r.name),
        }),
      },
    });

    this.events.emit(ONTOLOGY_EVENTS.SELF_INPUT, {
      userId,
      eventType: 'insight.generated',
      payload: { reportType: 'weekly', reportId: report.id },
    });

    return report;
  }

  /**
   * Get all cached insight reports for a user
   */
  async getReports(userId: string) {
    return this.prisma.insightReport.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  /**
   * v2 Mediator: aggregated relationship-health report per connection.
   * Guards on user.relationshipHealthOptIn. Aggregates mediation sessions,
   * events, action-card creation/acceptance, DM counts, top topics, trend.
   */
  async getRelationshipHealth(
    userId: string,
    opts: { connectionId?: string; days?: number } = {},
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { relationshipHealthOptIn: true },
    });
    if (!user?.relationshipHealthOptIn) {
      return { optIn: false, reports: [] };
    }

    const days = Math.max(1, Math.min(365, opts.days || 30));
    const now = Date.now();
    const periodStart = new Date(now - days * 24 * 60 * 60 * 1000);
    const prevStart = new Date(now - 2 * days * 24 * 60 * 60 * 1000);

    const connections = await this.prisma.connection.findMany({
      where: {
        status: 'accepted',
        OR: [{ requesterId: userId }, { receiverId: userId }],
        ...(opts.connectionId ? { id: opts.connectionId } : {}),
      },
      select: {
        id: true,
        requesterId: true,
        receiverId: true,
        requester: { select: { id: true, name: true, avatarUrl: true } },
        receiver: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    const reports = [] as any[];

    for (const c of connections) {
      const partner = c.requesterId === userId ? c.receiver : c.requester;

      const sessions = await this.prisma.mediationSession.findMany({
        where: { connectionId: c.id, startedAt: { gte: prevStart } },
        orderBy: { startedAt: 'desc' },
        include: {
          events: { select: { eventType: true, acceptedBy: true, createdAt: true } },
        },
      });

      const sessionsCurrent = sessions.filter((s) => s.startedAt >= periodStart);
      const sessionsPrevious = sessions.filter((s) => s.startedAt < periodStart);

      const topicCounts = new Map<string, number>();
      for (const s of sessionsCurrent) {
        if (s.topic) topicCounts.set(s.topic, (topicCounts.get(s.topic) || 0) + 1);
      }
      const topTopics = [...topicCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([topic, count]) => ({ topic, count }));

      const eventCounts: Record<string, { created: number; accepted: number }> = {};
      for (const s of sessionsCurrent) {
        for (const e of s.events) {
          if (!eventCounts[e.eventType]) {
            eventCounts[e.eventType] = { created: 0, accepted: 0 };
          }
          eventCounts[e.eventType].created += 1;
          if (e.acceptedBy) eventCounts[e.eventType].accepted += 1;
        }
      }

      const dmPairWhere = {
        OR: [
          { senderId: c.requesterId, receiverId: c.receiverId },
          { senderId: c.receiverId, receiverId: c.requesterId },
        ],
      };
      const dmCountCurrent = await this.prisma.directMessage.count({
        where: { ...dmPairWhere, createdAt: { gte: periodStart } },
      });
      const dmCountPrevious = await this.prisma.directMessage.count({
        where: { ...dmPairWhere, createdAt: { gte: prevStart, lt: periodStart } },
      });

      const lastSession = sessions[0];
      const sessionsTrend =
        sessionsPrevious.length === 0
          ? sessionsCurrent.length > 0
            ? 1
            : 0
          : (sessionsCurrent.length - sessionsPrevious.length) / sessionsPrevious.length;
      const messagesTrend =
        dmCountPrevious === 0
          ? dmCountCurrent > 0
            ? 1
            : 0
          : (dmCountCurrent - dmCountPrevious) / dmCountPrevious;

      reports.push({
        connectionId: c.id,
        partner,
        periodDays: days,
        summary: {
          totalSessions: sessionsCurrent.length,
          totalMessages: dmCountCurrent,
          lastMediationAt: lastSession?.startedAt || null,
          lastMediationSummary: lastSession?.summary || null,
          lastMediationTopic: lastSession?.topic || null,
        },
        topTopics,
        actions: eventCounts,
        trend: {
          sessions: { current: sessionsCurrent.length, previous: sessionsPrevious.length, change: sessionsTrend },
          messages: { current: dmCountCurrent, previous: dmCountPrevious, change: messagesTrend },
        },
      });
    }

    return { optIn: true, reports };
  }

  /**
   * Classify thoughts into life dimensions using LLM.
   */
  async getLifeDimensions(userId: string) {
    const DIMENSIONS = ['Health', 'Career', 'Relationships', 'Finance', 'Learning', 'Creativity', 'Spirituality'];

    // Get all thoughts (limit to recent 100)
    const thoughts = await this.prisma.thought.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, title: true, rawText: true, thoughtType: true, createdAt: true },
    });

    if (thoughts.length === 0) {
      return DIMENSIONS.map((d) => ({ dimension: d, thoughtCount: 0, lastThoughtDate: null, percentage: 0 }));
    }

    // Build a batch classification prompt
    const thoughtList = thoughts.map((t, i) => `${i + 1}. [${t.thoughtType}] ${t.title}: ${t.rawText.substring(0, 100)}`).join('\n');

    try {
      const model = new ChatOpenRouter({
        model: this.defaultModel,
        temperature: 0.1,
        maxTokens: 2048,
        apiKey: this.openRouterApiKey,
      });

      const response = await model.invoke([
        {
          role: 'system',
          content: `You are a life dimensions classifier. Classify each thought into EXACTLY ONE of these dimensions: ${DIMENSIONS.join(', ')}, Other.\nRespond with ONLY a JSON array of strings, one per thought, in the same order. Example: ["Health", "Career", "Learning"]`,
        },
        {
          role: 'user',
          content: `Classify these ${thoughts.length} thoughts:\n${thoughtList}`,
        },
      ]);

      const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      // Extract JSON array from response
      const jsonMatch = text.match(/\[([\s\S]*?)\]/);
      const classifications: string[] = jsonMatch ? JSON.parse(`[${jsonMatch[1]}]`) : [];

      // Build dimension stats
      const dimMap: Record<string, { count: number; lastDate: Date | null }> = {};
      for (const d of [...DIMENSIONS, 'Other']) {
        dimMap[d] = { count: 0, lastDate: null };
      }

      thoughts.forEach((t, i) => {
        const dim = classifications[i] && dimMap[classifications[i]] ? classifications[i] : 'Other';
        dimMap[dim].count++;
        if (!dimMap[dim].lastDate || t.createdAt > dimMap[dim].lastDate) {
          dimMap[dim].lastDate = t.createdAt;
        }
      });

      const total = thoughts.length;
      return Object.entries(dimMap)
        .filter(([key, v]) => v.count > 0 || DIMENSIONS.includes(key))
        .map(([dimension, v]) => ({
          dimension,
          thoughtCount: v.count,
          lastThoughtDate: v.lastDate?.toISOString() || null,
          percentage: total > 0 ? Math.round((v.count / total) * 100) : 0,
        }))
        .sort((a, b) => b.thoughtCount - a.thoughtCount);
    } catch (error) {
      this.logger.error('Life dimensions classification failed:', error);
      // Fallback: classify by thought type
      const typeMap: Record<string, number> = {};
      thoughts.forEach((t) => {
        typeMap[t.thoughtType] = (typeMap[t.thoughtType] || 0) + 1;
      });
      return Object.entries(typeMap).map(([dimension, count]) => ({
        dimension,
        thoughtCount: count,
        lastThoughtDate: null,
        percentage: Math.round((count / thoughts.length) * 100),
      }));
    }
  }
}
