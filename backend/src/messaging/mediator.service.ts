import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { OntologyService } from '../ontology/ontology.service';
import { createMediatorAgent } from './graph/mediator-agent';

// ─── Constants ──────────────────────────────────────────────────
const CONTEXT_WINDOW = 20;          // recent DMs pulled for prompt
const MAX_CTX_CHARS = 12_000;       // soft cap
const FREE_MONTHLY_TURNS = 10;
const MEDIATOR_MODEL = 'deepseek/deepseek-v3.2';
const SUMMON_RATE_LIMIT = 2;        // per connection, per 10s
const SUMMON_WINDOW_MS = 10_000;
const SESSION_IDLE_MS = 10 * 60 * 1000; // 10 minutes
const PRIOR_SESSIONS_RECALLED = 3;
const MEDIATOR_RECURSION_LIMIT = 8;  // analyze_moods + reply + ≤2 action tools

// ─── Output sanitizer ──────────────────────────────────────────
// Despite strict prompt rules, the model occasionally leaks tool-side
// artefacts into the final reply — raw analyze_moods JSON, fenced code
// blocks, or meta-narration like "let me try a more direct search". This
// defense-in-depth pass scrubs those patterns from the buffered reply
// before it is streamed to the socket or persisted.
function sanitizeMediatorReply(raw: string): string {
  if (!raw) return '';
  let s = raw;

  // 1. Strip triple-backtick fenced blocks (```json ... ```, ``` ... ```, ~~~ ~~~).
  s = s.replace(/```[\s\S]*?```/g, '');
  s = s.replace(/~~~[\s\S]*?~~~/g, '');
  // Unterminated fence — drop from the opening fence to end of string.
  s = s.replace(/```[\s\S]*$/g, '');
  s = s.replace(/~~~[\s\S]*$/g, '');

  // 2. Strip bare JSON-ish objects that dump analyze_moods fields. Greedy
  //    on the known keys so we catch partial / malformed dumps too.
  const jsonKey =
    /"(summoner_mood|other_mood|dynamic|intervention|last_speaker_tone|rationale)"\s*:/i;
  s = s.replace(/\{[\s\S]*?\}/g, (m) => (jsonKey.test(m) ? '' : m));
  // Unterminated object starting with a known key.
  s = s.replace(/\{\s*"(summoner_mood|other_mood|dynamic|intervention|last_speaker_tone|rationale)"[\s\S]*$/gi, '');

  // 3. Strip meta-narration sentences about tool use. Match whole
  //    sentences (up to the next sentence terminator) that open with
  //    one of the known leak phrases.
  const metaPhrases = [
    'let me check',
    'let me search',
    'let me try',
    'let me look',
    'let me see',
    'looking at the analyze',
    'looking at analyze',
    'according to the tool',
    'according to analyze',
    'the analysis shows',
    'the analyze_moods',
    'analyze_moods output',
    'per the tool',
    'from the tool',
    'based on the tool',
    'based on analyze',
    'wait, that didn',
    'wait that didn',
    'that didn\'t answer',
  ];
  for (const phrase of metaPhrases) {
    const re = new RegExp(
      '(^|[.!?\\n]\\s*)' +
        phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
        '[^.!?\\n]*[.!?]?',
      'gi',
    );
    s = s.replace(re, (_m, lead) => lead || '');
  }

  // 4. Collapse whitespace runs left behind by the removals.
  s = s.replace(/[ \t]+\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.trim();

  return s;
}

// Standard include (mirrors messaging.service.ts MESSAGE_INCLUDE)
const MESSAGE_INCLUDE = {
  sender: { select: { id: true, name: true, phoneNumber: true, avatarUrl: true } },
  receiver: { select: { id: true, name: true, phoneNumber: true, avatarUrl: true } },
  replyTo: {
    select: {
      id: true, content: true, senderId: true,
      sender: { select: { id: true, name: true } },
    },
  },
  reactions: {
    select: { id: true, emoji: true, userId: true, user: { select: { id: true, name: true } } },
  },
} as const;

// ─── Types ─────────────────────────────────────────────────────
export interface TriChatStatus {
  selfEnabled: boolean;
  otherEnabled: boolean;
  bothEnabled: boolean;
  premium: boolean;
  turnsLeft: number | null;
  activeSessionId: string | null;
  hasClearedHistory: boolean;
  mediatorName: string;
}

export interface MediatorActionCard {
  type: 'suggested_ritual' | 'suggested_task' | 'suggested_tension' | 'agreement';
  payload: any;
  acceptedByUserIds: string[];
}

export interface MediatorStreamResult {
  message: any;                       // final DirectMessage (placeholder)
  replyMessage?: any;                  // persisted user reply DM (only when replyText was given)
  sessionId: string;
  stream: AsyncGenerator<string>;     // yields token deltas
}

@Injectable()
export class MediatorService {
  private readonly logger = new Logger('MediatorService');
  private readonly openRouterApiKey: string;
  private readonly tavilyApiKey: string;

  private summonTimestamps = new Map<string, number[]>();

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private ontology: OntologyService,
  ) {
    this.openRouterApiKey = this.config.get<string>('OPENROUTER_API_KEY') || '';
    this.tavilyApiKey = this.config.get<string>('TAVILY_API_KEY') || '';

    setInterval(() => {
      const cutoff = Date.now() - 2 * SUMMON_WINDOW_MS;
      for (const [k, arr] of this.summonTimestamps) {
        const filtered = arr.filter((t) => t > cutoff);
        if (filtered.length === 0) this.summonTimestamps.delete(k);
        else this.summonTimestamps.set(k, filtered);
      }
    }, 60_000).unref?.();
  }

  // ─── Helpers ───────────────────────────────────────────────

  private async loadConnection(userId: string, connectionId: string) {
    const conn = await this.prisma.connection.findUnique({
      where: { id: connectionId },
    });
    if (!conn) throw new NotFoundException('Connection not found');
    if (conn.requesterId !== userId && conn.receiverId !== userId) {
      throw new ForbiddenException('You are not part of this conversation');
    }
    if (conn.status !== 'accepted') {
      throw new ForbiddenException('Connection is not accepted');
    }
    return conn;
  }

  private otherPartyId(conn: any, userId: string): string {
    return conn.requesterId === userId ? conn.receiverId : conn.requesterId;
  }

  private isRequester(conn: any, userId: string): boolean {
    return conn.requesterId === userId;
  }

  private checkSummonRate(connectionId: string): boolean {
    const now = Date.now();
    const arr = this.summonTimestamps.get(connectionId) || [];
    const recent = arr.filter((t) => now - t < SUMMON_WINDOW_MS);
    if (recent.length >= SUMMON_RATE_LIMIT) {
      this.summonTimestamps.set(connectionId, recent);
      return false;
    }
    recent.push(now);
    this.summonTimestamps.set(connectionId, recent);
    return true;
  }

  private sameMonth(a: Date, b: Date): boolean {
    return (
      a.getUTCFullYear() === b.getUTCFullYear() &&
      a.getUTCMonth() === b.getUTCMonth()
    );
  }

  // ─── Toggle / Status ──────────────────────────────────────

  async toggleTriChat(userId: string, connectionId: string, enabled: boolean) {
    const conn = await this.loadConnection(userId, connectionId);
    const isReq = this.isRequester(conn, userId);
    const data = isReq
      ? { triChatEnabledByRequester: enabled }
      : { triChatEnabledByReceiver: enabled };
    const updated = await this.prisma.connection.update({
      where: { id: connectionId },
      data,
    });
    return {
      connectionId,
      userId,
      enabled,
      bothEnabled:
        updated.triChatEnabledByRequester && updated.triChatEnabledByReceiver,
      otherUserId: this.otherPartyId(conn, userId),
    };
  }

  async getTriChatStatus(
    userId: string,
    connectionId: string,
  ): Promise<TriChatStatus> {
    const conn = await this.loadConnection(userId, connectionId);
    const isReq = this.isRequester(conn, userId);
    const selfEnabled = isReq
      ? conn.triChatEnabledByRequester
      : conn.triChatEnabledByReceiver;
    const otherEnabled = isReq
      ? conn.triChatEnabledByReceiver
      : conn.triChatEnabledByRequester;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        subscriptionTier: true,
        triChatTurnsUsedMonth: true,
        triChatPeriodStart: true,
      },
    });
    const premium = user?.subscriptionTier === 'premium';
    const now = new Date();
    const periodStart = user?.triChatPeriodStart;
    const expired = !periodStart || !this.sameMonth(periodStart, now);
    const used = expired ? 0 : user?.triChatTurnsUsedMonth ?? 0;
    const turnsLeft = premium ? null : Math.max(0, FREE_MONTHLY_TURNS - used);

    const activeSession = await this.prisma.mediationSession.findFirst({
      where: { connectionId, status: 'active' },
      orderBy: { startedAt: 'desc' },
      select: { id: true, lastTurnAt: true },
    });
    const activeSessionId =
      activeSession &&
      Date.now() - new Date(activeSession.lastTurnAt).getTime() < SESSION_IDLE_MS
        ? activeSession.id
        : null;

    return {
      // Per-user mediator on/off. A user who turns it off cannot summon the
      // mediator and does not see the summon button on their side. The
      // other party can still summon independently; any mediator messages
      // that the other party triggers stay visible in the shared thread.
      selfEnabled,
      otherEnabled,
      bothEnabled: selfEnabled && otherEnabled,
      premium,
      turnsLeft,
      activeSessionId,
      hasClearedHistory: !!(isReq
        ? (conn as any).triChatClearedAtRequester
        : (conn as any).triChatClearedAtRecipient),
      mediatorName: ((conn as any).mediatorName as string | undefined) || '4Ever',
    };
  }

  // ─── Rename mediator (shared, per-connection) ───────────────

  async renameMediator(
    userId: string,
    connectionId: string,
    rawName: string,
  ): Promise<{ connectionId: string; mediatorName: string; otherUserId: string }> {
    const conn = await this.loadConnection(userId, connectionId);
    const trimmed = (rawName || '').trim();
    if (!trimmed) {
      throw new BadRequestException('Mediator name cannot be empty');
    }
    // Keep it short — DB column is VarChar(40). Strip control chars / newlines.
    const cleaned = trimmed.replace(/[\r\n\t]+/g, ' ').slice(0, 40);
    await this.prisma.connection.update({
      where: { id: conn.id },
      data: { mediatorName: cleaned } as any,
    });
    return {
      connectionId: conn.id,
      mediatorName: cleaned,
      otherUserId: this.otherPartyId(conn, userId),
    };
  }

  // ─── Quota ─────────────────────────────────────────────────

  private async consumeQuota(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        subscriptionTier: true,
        triChatTurnsUsedMonth: true,
        triChatPeriodStart: true,
      },
    });
    if (!user) return;
    if (user.subscriptionTier === 'premium') return;

    const now = new Date();
    const periodStart = user.triChatPeriodStart;
    if (!periodStart || !this.sameMonth(periodStart, now)) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { triChatTurnsUsedMonth: 1, triChatPeriodStart: now },
      });
    } else {
      await this.prisma.user.update({
        where: { id: userId },
        data: { triChatTurnsUsedMonth: { increment: 1 } },
      });
    }
  }

  // ─── One-sided clear chat history (with mediator-continuity summary) ──

  /**
   * Clear the chat history for THIS user only. The other party keeps their
   * full view. Before clearing, summarize the pre-clear transcript so the
   * mediator can warm-start its next turn with continuity
   * ("EARLIER CONVERSATION (summary): …") instead of feeling amnesiac.
   *
   * No messages are deleted — we only record a per-user `clearedAt` timestamp
   * that gates visibility in `getConversation()` and transcript lookup in
   * `buildContextBlock()`.
   */
  async clearMyHistory(userId: string, connectionId: string) {
    const conn = await this.loadConnection(userId, connectionId);
    const isReq = this.isRequester(conn, userId);
    const otherId = this.otherPartyId(conn, userId);
    const now = new Date();

    // 1. Pull everything currently visible to this user (respecting any
    //    prior clear they've already done, so we summarize incrementally).
    const priorClearedAt: Date | null = isReq
      ? (conn as any).triChatClearedAtRequester
      : (conn as any).triChatClearedAtRecipient;

    const rows = await this.prisma.directMessage.findMany({
      where: {
        OR: [
          { senderId: userId, receiverId: otherId },
          { senderId: otherId, receiverId: userId },
        ],
        deletedAt: null,
        ...(priorClearedAt ? { createdAt: { gt: priorClearedAt } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: { senderId: true, content: true, messageType: true },
    });

    // 2. Generate a fresh summary segment. Prepended to any existing cleared
    //    summary so continuity compounds across repeated clears.
    let newSegment = '';
    if (rows.length && this.openRouterApiKey) {
      const [me, other] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
        this.prisma.user.findUnique({ where: { id: otherId }, select: { name: true } }),
      ]);
      const meName = me?.name || 'You';
      const otherName = other?.name || 'They';
      const transcript = rows
        .map((r) =>
          r.messageType === 'mediator'
            ? `Mediator: ${r.content}`
            : `${r.senderId === userId ? meName : otherName}: ${r.content}`,
        )
        .join('\n')
        .slice(0, 8000);

      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.openRouterApiKey}`,
            'HTTP-Referer': 'https://4ever.app',
            'X-Title': '4Ever Clear-History Summary',
          },
          body: JSON.stringify({
            model: MEDIATOR_MODEL,
            stream: false,
            temperature: 0.3,
            max_tokens: 220,
            messages: [
              {
                role: 'system',
                content:
                  `You are compressing a chat between ${meName} and ${otherName} so a future mediator can stay continuous without seeing the raw messages. Return ONE short paragraph (3–5 sentences, past tense, neutral, no quotes, no names-shaming) covering: topics they've discussed, any recurring tensions, recent emotional tone, and any agreements or plans. No headers, no bullets.`,
              },
              { role: 'user', content: transcript },
            ],
          }),
        });
        if (res.ok) {
          const j: any = await res.json();
          newSegment = (j?.choices?.[0]?.message?.content || '').trim().slice(0, 1200);
        }
      } catch (e: any) {
        this.logger.warn(`clearMyHistory summary failed: ${e.message}`);
      }
    }

    const priorSummary = ((conn as any).triChatClearedSummary as string | null) || '';
    const mergedSummary =
      [priorSummary.trim(), newSegment.trim()].filter(Boolean).join('\n\n').slice(0, 4000) || null;

    // 3. Persist: timestamp + merged summary (shared summary column; either
    //    user may be the next summoner).
    const data: any = { triChatClearedSummary: mergedSummary };
    if (isReq) data.triChatClearedAtRequester = now;
    else data.triChatClearedAtRecipient = now;

    await this.prisma.connection.update({
      where: { id: connectionId },
      data,
    });

    return {
      connectionId,
      clearedAt: now.toISOString(),
      summarized: !!newSegment,
      otherUserId: otherId,
    };
  }

  // ─── Context gathering ────────────────────────────────────

  private async findCircleEntryFor(
    ownerId: string,
    otherId: string,
    otherName: string,
  ) {
    const explicit = await this.prisma.relationshipPerson.findFirst({
      where: { userId: ownerId, isActive: true, linkedUserId: otherId },
      select: {
        id: true, name: true, relationship: true,
        communicationStyle: true, loveLanguage: true, dynamic: true,
      },
    });
    if (explicit) return explicit;
    const firstName = otherName?.split(' ')[0];
    if (!firstName) return null;
    return this.prisma.relationshipPerson.findFirst({
      where: {
        userId: ownerId,
        isActive: true,
        linkedUserId: null,
        name: { contains: firstName, mode: 'insensitive' },
      },
      select: {
        id: true, name: true, relationship: true,
        communicationStyle: true, loveLanguage: true, dynamic: true,
      },
    });
  }

  private async buildContextBlock(
    summonerId: string,
    otherId: string,
    connectionId: string,
    sessionId: string | null,
  ): Promise<{
    userPrompt: string;
    transcript: string;
    summonerName: string;
    otherName: string;
    mediatorName: string;
  }> {
    const [summoner, other, conn] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: summonerId },
        select: { id: true, name: true },
      }),
      this.prisma.user.findUnique({
        where: { id: otherId },
        select: { id: true, name: true },
      }),
      this.prisma.connection.findUnique({
        where: { id: connectionId },
      }),
    ]);
    if (!summoner || !other) throw new NotFoundException('User not found');

    const summonerName = summoner.name || 'They';
    const otherName = other.name || 'They';
    const mediatorName: string = conn
      ? ((conn as any).mediatorName as string | undefined) || '4Ever'
      : '4Ever';

    // Per-user cleared-history state: the summoner's view is gated by their
    // own clearedAt so freshly-cleared chats feel like a clean slate to them,
    // while the shared cleared-summary keeps the mediator from feeling amnesiac.
    const summonerClearedAt: Date | null = conn
      ? (conn.requesterId === summonerId
          ? (conn as any).triChatClearedAtRequester
          : (conn as any).triChatClearedAtRecipient)
      : null;
    const clearedSummary: string | null = conn
      ? ((conn as any).triChatClearedSummary as string | null)
      : null;

    // PRIVACY LOCKDOWN
    // ----------------
    // The mediator prompt intentionally contains NO pre-injected personal
    // context about either party — no ontology, no Circle notes, no values,
    // no trajectory, no weather, no communication-style briefs. Those fields
    // are private memory that each user keeps separately; mixing them into a
    // single prompt creates cross-contact leakage surface area regardless of
    // how strict the system prompt is.
    //
    // The mediator is allowed to reference ONLY:
    //   1. EARLIER CONVERSATION     — a short neutral summary written when
    //                                  the summoner last cleared their view
    //   2. RECENT CONVERSATION      — the last ~20 messages post-clear
    //   3. CURRENT MEDIATION SESSION — this turn's ongoing back-and-forth
    //   4. PRIOR MEDIATION HISTORY   — past mediator-written summaries both
    //                                   parties already saw (shared artefacts)
    //
    // Everything else is withheld. The `analyze_moods` tool still infers
    // emotion, but from the transcript alone — not from private ontology.

    // Last N non-mediator messages for primary transcript (post-clear only)
    const recent = await this.prisma.directMessage.findMany({
      where: {
        OR: [
          { senderId: summonerId, receiverId: otherId },
          { senderId: otherId, receiverId: summonerId },
        ],
        messageType: { not: 'mediator' },
        deletedAt: null,
        ...(summonerClearedAt ? { createdAt: { gt: summonerClearedAt } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: CONTEXT_WINDOW,
      select: { senderId: true, content: true, createdAt: true },
    });
    const transcript = [...recent].reverse();

    // Prior ended sessions (memory)
    const priorSessions = await this.prisma.mediationSession.findMany({
      where: { connectionId, status: 'ended', NOT: { summary: null } },
      orderBy: { startedAt: 'desc' },
      take: PRIOR_SESSIONS_RECALLED,
      select: { startedAt: true, topic: true, summary: true },
    });

    // Current-session transcript (if multi-turn) — include mediator + user turns from this session
    let currentSessionTurns: Array<{ senderId: string; content: string; isMediator: boolean }> = [];
    if (sessionId) {
      const rows = await this.prisma.directMessage.findMany({
        where: { mediatorSessionId: sessionId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { senderId: true, content: true, messageType: true },
      });
      currentSessionTurns = rows.map((r) => ({
        senderId: r.senderId,
        content: r.content,
        isMediator: r.messageType === 'mediator',
      }));
    }

    const header = `${summonerName} and ${otherName} are chatting privately.`;

    // Cleared-history continuity: a neutral recap of everything from before
    // the summoner's last clear, so the mediator doesn't feel amnesiac.
    let earlierBlock = '';
    if (clearedSummary && clearedSummary.trim()) {
      earlierBlock =
        '\n\nEARLIER CONVERSATION (summary, from before the most recent chat-clear):\n' +
        clearedSummary.trim();
    }

    // Ontology + Circle notes are intentionally NOT injected — see privacy
    // lockdown comment above. No BACKGROUND block is sent to the model.

    let priorBlock = '';
    if (priorSessions.length) {
      priorBlock =
        '\n\nPRIOR MEDIATION HISTORY (most recent first):\n' +
        priorSessions
          .map((s) => {
            const when = new Date(s.startedAt).toISOString().slice(0, 10);
            const label = s.topic ? `"${s.topic}"` : '(untitled)';
            return `- ${when} ${label}: ${s.summary}`;
          })
          .join('\n');
    }

    const transcriptBlock = transcript
      .map((m) => {
        const who = m.senderId === summonerId ? summonerName : otherName;
        return `${who}: ${m.content}`;
      })
      .join('\n');

    let currentBlock = '';
    if (currentSessionTurns.length) {
      currentBlock =
        '\n\nCURRENT MEDIATION SESSION SO FAR:\n' +
        currentSessionTurns
          .map((t) => {
            if (t.isMediator) return `Mediator: ${t.content}`;
            const who = t.senderId === summonerId ? summonerName : otherName;
            return `${who}: ${t.content}`;
          })
          .join('\n');
    }

    let ctx =
      header +
      earlierBlock +
      priorBlock +
      `\n\nRECENT CONVERSATION:\n${transcriptBlock}` +
      currentBlock +
      `\n\n[${summonerName} summoned you]\n\nYou (as ${mediatorName}, one short chat message):`;

    let finalTranscript = transcriptBlock;
    if (ctx.length > MAX_CTX_CHARS) {
      const overage = ctx.length - MAX_CTX_CHARS;
      const truncated = transcriptBlock.slice(overage);
      finalTranscript = truncated;
      ctx =
        header +
        earlierBlock +
        priorBlock +
        `\n\nRECENT CONVERSATION (truncated):\n${truncated}` +
        currentBlock +
        `\n\n[${summonerName} summoned you]\n\nYou (as ${mediatorName}, one short chat message):`;
    }
    return {
      userPrompt: ctx,
      transcript: finalTranscript,
      summonerName,
      otherName,
      mediatorName,
    };
  }

  // ─── Summon (or continue a session) ────────────────────────

  async summonMediator(
    userId: string,
    connectionId: string,
    opts?: { sessionId?: string; replyText?: string },
  ): Promise<MediatorStreamResult> {
    const conn = await this.loadConnection(userId, connectionId);
    const otherId = this.otherPartyId(conn, userId);

    // Per-user on/off check: a user who has disabled the mediator cannot
    // summon it. (The other party is unaffected — they can still summon
    // on their side.)
    const isReq = this.isRequester(conn, userId);
    const selfEnabled = isReq
      ? (conn as any).triChatEnabledByRequester
      : (conn as any).triChatEnabledByReceiver;
    if (selfEnabled === false) {
      throw new ForbiddenException(
        'Mediator is turned off for you. Turn it back on to summon.',
      );
    }

    // One-sided mediator: any participant can summon; response is visible to both
    // in the shared conversation. No mutual-consent gate.

    if (!this.checkSummonRate(connectionId)) {
      throw new BadRequestException(
        'Too fast — please wait a few seconds before summoning the mediator again.',
      );
    }

    const status = await this.getTriChatStatus(userId, connectionId);
    if (!status.premium && status.turnsLeft !== null && status.turnsLeft <= 0) {
      throw new ForbiddenException(
        'You have used all 10 free mediator turns this month. Upgrade to premium for unlimited.',
      );
    }

    if (!this.openRouterApiKey) {
      throw new BadRequestException('Mediator is not configured (missing API key).');
    }

    // Resolve or create session
    let sessionId = opts?.sessionId || null;
    let session = sessionId
      ? await this.prisma.mediationSession.findUnique({ where: { id: sessionId } })
      : null;
    if (session && session.connectionId !== connectionId) {
      throw new ForbiddenException('Session does not belong to this connection');
    }
    if (session && session.status !== 'active') {
      session = null;
      sessionId = null;
    }
    if (session) {
      // idle check
      const idle = Date.now() - new Date(session.lastTurnAt).getTime() > SESSION_IDLE_MS;
      if (idle) {
        await this.prisma.mediationSession.update({
          where: { id: session.id },
          data: { status: 'ended', endedAt: new Date() },
        });
        session = null;
        sessionId = null;
      }
    }
    if (!session) {
      session = await this.prisma.mediationSession.create({
        data: {
          connectionId,
          startedByUserId: userId,
          status: 'active',
        },
      });
      sessionId = session.id;
    }

    // If this is a reply, persist the user's reply text as a normal DM tied to the session
    let replyMessage: any = null;
    if (opts?.replyText) {
      replyMessage = await this.prisma.directMessage.create({
        data: {
          senderId: userId,
          receiverId: otherId,
          content: opts.replyText,
          status: 'sent',
          messageType: 'text',
          mediatorSessionId: session.id,
        } as any,
        include: MESSAGE_INCLUDE,
      });
    }

    const ctxBlock = await this.buildContextBlock(
      userId,
      otherId,
      connectionId,
      session.id,
    );
    const { userPrompt, transcript, summonerName, otherName, mediatorName } = ctxBlock;

    // Placeholder mediator message
    const placeholder = await this.prisma.directMessage.create({
      data: {
        senderId: userId,
        receiverId: otherId,
        content: '',
        status: 'sent',
        messageType: 'mediator',
        mediatorSessionId: session.id,
        metadata: JSON.stringify({
          mediator: true,
          summonedBy: userId,
          streaming: true,
          sessionId: session.id,
        }),
      } as any,
      include: MESSAGE_INCLUDE,
    });

    // Consume quota up front
    this.consumeQuota(userId).catch((err) =>
      this.logger.warn(`consumeQuota failed: ${err.message}`),
    );

    // Bump session lastTurnAt
    await this.prisma.mediationSession.update({
      where: { id: session.id },
      data: { lastTurnAt: new Date() },
    });

    const service = this;
    const sid = session.id;

    // Action cards populated by the ReAct agent's tool calls (closure array).
    // No style flag — personality is purely prompt-driven (tone-mirror the user).
    const collectedActions: MediatorActionCard[] = [];
    const { agent, systemPrompt } = createMediatorAgent({
      openRouterApiKey: this.openRouterApiKey,
      model: MEDIATOR_MODEL,
      summonerName,
      otherName,
      mediatorName,
      transcript,
      collectedActions,
      tavilyApiKey: this.tavilyApiKey,
    });

    async function* streamAndPersist(): AsyncGenerator<string> {
      let streamedText = '';  // tokens yielded to the caller
      let finalText = '';     // fallback text extracted from LangGraph chain end

      // Per-LLM-turn buffer. In a ReAct loop, the model runs multiple times:
      // some turns produce tool_calls (analyze_moods, wikipedia_lookup,
      // web_search, action cards) and some turns produce the final reply.
      // We NEVER want internal reasoning or tool-invocation thinking to leak
      // into the chat — only the final reply turn (the one with zero
      // tool_calls in its output) should be surfaced to the user.
      //
      // Strategy: buffer every text chunk per turn. At on_chat_model_end,
      // inspect the output message — if it has tool_calls, discard the
      // buffer; otherwise flush it as the user-facing reply.
      let turnBuffer = '';
      let turnHasToolCall = false;
      try {
        const stream = agent.streamEvents(
          {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
          },
          { version: 'v2', recursionLimit: MEDIATOR_RECURSION_LIMIT },
        );

        for await (const event of stream as any) {
          if (event.event === 'on_chat_model_start') {
            // New LLM turn begins — reset per-turn state.
            turnBuffer = '';
            turnHasToolCall = false;
          } else if (event.event === 'on_chat_model_stream') {
            const chunk = event.data?.chunk;
            if (!chunk) continue;
            const hasToolCalls =
              (chunk.tool_calls?.length ?? 0) > 0 ||
              (chunk.tool_call_chunks?.length ?? 0) > 0;
            if (hasToolCalls) {
              // This turn is invoking a tool — discard anything buffered
              // (model sometimes emits a short preamble like "Let me check…"
              // before the tool_call chunk). Nothing from a tool-calling
              // turn ever reaches the user.
              turnHasToolCall = true;
              turnBuffer = '';
              continue;
            }
            if (turnHasToolCall) continue;

            let text = '';
            const content = chunk.content;
            if (typeof content === 'string' && content) {
              text = content;
            } else if (Array.isArray(content)) {
              text = content
                .filter((p: any) => p.type === 'text' && p.text)
                .map((p: any) => p.text)
                .join('');
            }
            if (!text) continue;
            // Buffer — do NOT emit yet. We only know this turn is the final
            // reply once on_chat_model_end confirms no tool_calls.
            turnBuffer += text;
          } else if (event.event === 'on_chat_model_end') {
            // Inspect the finished message: does it carry tool_calls?
            const out = event.data?.output;
            const outToolCalls =
              (out?.tool_calls?.length ?? 0) > 0 ||
              (out?.additional_kwargs?.tool_calls?.length ?? 0) > 0 ||
              (out?.kwargs?.tool_calls?.length ?? 0) > 0;
            if (!outToolCalls && !turnHasToolCall && turnBuffer) {
              // Final reply turn — flush the buffered reply to the user,
              // but sanitize first: the model sometimes echoes tool JSON
              // or narrates its own process despite prompt rules.
              const cleaned = sanitizeMediatorReply(turnBuffer);
              if (cleaned) {
                streamedText += cleaned;
                yield cleaned;
              }
            }
            turnBuffer = '';
            turnHasToolCall = false;
          } else if (event.event === 'on_chain_end' && event.name === 'LangGraph') {
            // Fallback: extract the last AIMessage from the graph output
            try {
              const messages = event.data?.output?.messages;
              if (Array.isArray(messages) && messages.length > 0) {
                const lastMsg = [...messages].reverse().find((m: any) => {
                  const c = m?.content || m?.kwargs?.content;
                  if (typeof c === 'string' && c.trim()) return true;
                  if (Array.isArray(c)) {
                    return c.some((p: any) => p.type === 'text' && p.text?.trim());
                  }
                  return false;
                });
                if (lastMsg) {
                  const c = lastMsg.content || lastMsg.kwargs?.content;
                  if (typeof c === 'string') finalText = c;
                  else if (Array.isArray(c)) {
                    finalText = c
                      .filter((p: any) => p.type === 'text' && p.text)
                      .map((p: any) => p.text)
                      .join('');
                  }
                }
              }
            } catch {
              /* ignore parse errors */
            }
          }
        }

        // Streaming path preferred; fall back to chain-end extract if needed
        if (!streamedText && finalText) {
          // Late-arriving text never made it through on_chat_model_stream —
          // emit it now so the placeholder isn't empty on the client.
          const cleaned = sanitizeMediatorReply(finalText);
          if (cleaned) {
            yield cleaned;
            streamedText = cleaned;
          }
        }

        const actionCards = collectedActions;
        const finalPersistText =
          (streamedText || finalText).trim() ||
          (actionCards.length
            ? '(see suggestions below)'
            : '(the mediator had nothing to add right now)');

        await service.prisma.directMessage.update({
          where: { id: placeholder.id },
          data: {
            content: finalPersistText,
            mediatorActions: actionCards.length ? JSON.stringify(actionCards) : null,
            metadata: JSON.stringify({
              mediator: true,
              summonedBy: userId,
              sessionId: sid,
              toolCount: actionCards.length,
            }),
          } as any,
        });

        // Persist MediationEvent rows for 'agreement' immediately;
        // others only become events when accepted.
        for (const card of actionCards) {
          if (card.type === 'agreement') {
            await service.prisma.mediationEvent.create({
              data: {
                sessionId: sid,
                eventType: 'agreement',
                payload: JSON.stringify(card.payload),
              },
            });
          }
        }

        await service.prisma.mediationSession.update({
          where: { id: sid },
          data: { lastTurnAt: new Date() },
        });
      } catch (err: any) {
        service.logger.warn(`Mediator stream failed: ${err.message}`);
        const produced = (streamedText || finalText).trim();
        if (!produced) {
          // Empty-bubble cleanup: delete placeholder so clients can cancel
          // the empty bubble on their side (see 'mediator_cancelled' event).
          await service.prisma.directMessage
            .delete({ where: { id: placeholder.id } })
            .catch(() => {});
          (err as any).placeholderCancelled = true;
          (err as any).cancelledMessageId = placeholder.id;
        } else {
          await service.prisma.directMessage
            .update({
              where: { id: placeholder.id },
              data: {
                content: produced,
                metadata: JSON.stringify({
                  mediator: true,
                  summonedBy: userId,
                  sessionId: sid,
                  error: true,
                  partial: true,
                }),
              },
            })
            .catch(() => {});
        }
        throw err;
      }
    }

    return {
      message: placeholder,
      replyMessage,
      sessionId: session.id,
      stream: streamAndPersist(),
    };
  }

  // ─── Reply to mediator (alias that forwards to summonMediator) ──

  async replyToMediator(
    userId: string,
    connectionId: string,
    sessionId: string,
    text: string,
  ): Promise<MediatorStreamResult> {
    const trimmed = (text || '').trim();
    if (!trimmed) throw new BadRequestException('Reply text is empty');
    return this.summonMediator(userId, connectionId, { sessionId, replyText: trimmed });
  }

  // ─── Non-streaming variant (REST summon) ───────────────────

  async summonMediatorSync(
    userId: string,
    connectionId: string,
    opts?: { sessionId?: string; replyText?: string },
  ) {
    const { message, stream } = await this.summonMediator(userId, connectionId, opts);
    for await (const _ of stream) {
      // drain silently
    }
    const finalMsg = await this.prisma.directMessage.findUnique({
      where: { id: message.id },
      include: MESSAGE_INCLUDE,
    });
    return finalMsg;
  }

  // ─── End mediator session (writes summary + topic) ─────────

  async endMediatorSession(
    userId: string,
    connectionId: string,
    sessionId: string,
  ) {
    const conn = await this.loadConnection(userId, connectionId);
    const session = await this.prisma.mediationSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.connectionId !== connectionId) {
      throw new NotFoundException('Session not found');
    }
    if (session.status === 'ended') {
      return {
        sessionId,
        connectionId,
        topic: session.topic,
        summary: session.summary,
        otherUserId: this.otherPartyId(conn, userId),
      };
    }

    // Collect session transcript
    const rows = await this.prisma.directMessage.findMany({
      where: { mediatorSessionId: sessionId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { senderId: true, content: true, messageType: true },
    });

    let summary = '(no content)';
    let topic = 'Quick check-in';

    if (rows.length && this.openRouterApiKey) {
      const [a, b] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: conn.requesterId },
          select: { name: true },
        }),
        this.prisma.user.findUnique({
          where: { id: conn.receiverId },
          select: { name: true },
        }),
      ]);
      const nameFor = (sid: string) =>
        sid === conn.requesterId ? a?.name || 'A' : b?.name || 'B';
      const transcript = rows
        .map((r) =>
          r.messageType === 'mediator'
            ? `Mediator: ${r.content}`
            : `${nameFor(r.senderId)}: ${r.content}`,
        )
        .join('\n');

      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.openRouterApiKey}`,
            'HTTP-Referer': 'https://4ever.app',
            'X-Title': '4Ever Mediator Summary',
          },
          body: JSON.stringify({
            model: MEDIATOR_MODEL,
            stream: false,
            temperature: 0.3,
            max_tokens: 180,
            messages: [
              {
                role: 'system',
                content:
                  'You summarize a brief mediation session between two friends. Return ONLY strict JSON: {"topic": "<max 6 words>", "summary": "<1-2 neutral sentences, no names-shaming, past tense>"}. No prose outside JSON.',
              },
              { role: 'user', content: transcript.slice(0, 6000) },
            ],
          }),
        });
        if (res.ok) {
          const j: any = await res.json();
          const raw: string = j?.choices?.[0]?.message?.content || '';
          const match = raw.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            if (parsed.topic) topic = String(parsed.topic).slice(0, 60);
            if (parsed.summary) summary = String(parsed.summary).slice(0, 400);
          } else {
            summary = raw.slice(0, 400) || summary;
          }
        }
      } catch (e: any) {
        this.logger.warn(`Session summary failed: ${e.message}`);
      }
    }

    await this.prisma.mediationSession.update({
      where: { id: sessionId },
      data: {
        status: 'ended',
        endedAt: new Date(),
        summary,
        topic,
      },
    });

    return {
      sessionId,
      connectionId,
      topic,
      summary,
      otherUserId: this.otherPartyId(conn, userId),
    };
  }

  // ─── Accept an action card ─────────────────────────────────

  async acceptMediatorAction(
    userId: string,
    messageId: string,
    actionIndex: number,
  ) {
    const msg = await this.prisma.directMessage.findUnique({
      where: { id: messageId },
    });
    if (!msg) throw new NotFoundException('Message not found');
    if (msg.senderId !== userId && msg.receiverId !== userId) {
      throw new ForbiddenException('You are not part of this conversation');
    }
    if (msg.messageType !== 'mediator') {
      throw new BadRequestException('Not a mediator message');
    }
    const raw = (msg as any).mediatorActions as string | null;
    if (!raw) throw new BadRequestException('No actions attached to this message');
    let cards: MediatorActionCard[];
    try {
      cards = JSON.parse(raw);
    } catch {
      throw new BadRequestException('Corrupt action payload');
    }
    if (actionIndex < 0 || actionIndex >= cards.length) {
      throw new BadRequestException('Invalid action index');
    }
    const card = cards[actionIndex];
    if (card.acceptedByUserIds?.includes(userId)) {
      return { messageId, actionIndex, alreadyAccepted: true };
    }

    const sessionId = (msg as any).mediatorSessionId as string | null;

    // Find personId in the tapping user's Circle that points to the other party
    const otherId = msg.senderId === userId ? msg.receiverId : msg.senderId;
    const other = await this.prisma.user.findUnique({
      where: { id: otherId },
      select: { name: true },
    });
    const circleEntry = await this.findCircleEntryFor(
      userId,
      otherId,
      other?.name || '',
    );
    const personId = circleEntry?.id ?? null;

    // Create the downstream entity for the tapping user only
    if (card.type === 'suggested_ritual') {
      const cadence = ['daily', 'weekly', 'monthly'].includes(card.payload?.cadence)
        ? card.payload.cadence
        : 'weekly';
      await this.prisma.relationshipRitual.create({
        data: {
          userId,
          personId,
          title: String(card.payload?.label || 'Ritual').slice(0, 120),
          frequency: cadence,
        },
      });
    } else if (card.type === 'suggested_task') {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const plan = await this.prisma.dayPlan.upsert({
        where: { userId_date: { userId, date: today } },
        create: { userId, date: today },
        update: {},
      });
      await this.prisma.planTask.create({
        data: {
          planId: plan.id,
          timeSlot: 'anytime',
          task: String(card.payload?.label || 'Task').slice(0, 200),
          insight: card.payload?.description
            ? String(card.payload.description).slice(0, 400)
            : null,
        },
      });
    } else if (card.type === 'suggested_tension') {
      await this.prisma.tensionEntry.create({
        data: {
          userId,
          personId,
          title: String(card.payload?.title || 'Tension').slice(0, 120),
          description: String(card.payload?.description || '').slice(0, 500),
          intensity:
            typeof card.payload?.intensity === 'number'
              ? Math.min(10, Math.max(1, Math.round(card.payload.intensity)))
              : 5,
        },
      });
    }
    // 'agreement' → already logged at stream end; just mark accepted.

    // Mark accepted on the card + record event
    card.acceptedByUserIds = [...(card.acceptedByUserIds || []), userId];
    cards[actionIndex] = card;
    await this.prisma.directMessage.update({
      where: { id: messageId },
      data: { mediatorActions: JSON.stringify(cards) } as any,
    });

    if (sessionId && card.type !== 'agreement') {
      await this.prisma.mediationEvent.create({
        data: {
          sessionId,
          eventType: card.type,
          payload: JSON.stringify(card.payload),
          acceptedBy: userId,
        },
      });
    }

    return {
      messageId,
      actionIndex,
      type: card.type,
      acceptedByUserIds: card.acceptedByUserIds,
      otherUserId: otherId,
    };
  }
}
