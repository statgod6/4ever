import { Injectable, NotFoundException, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRelationshipDto } from './dto/create-relationship.dto';
import { UpdateRelationshipDto } from './dto/update-relationship.dto';
import { ChatOpenRouter } from '@langchain/openrouter';
import { ONTOLOGY_EVENTS } from '../ontology/events';

@Injectable()
export class RelationshipsService implements OnModuleInit {
  private readonly logger = new Logger(RelationshipsService.name);
  private llm: ChatOpenRouter;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private events: EventEmitter2,
  ) {}

  onModuleInit() {
    const apiKey = this.configService.get<string>('OPENROUTER_API_KEY') || '';
    const model = this.configService.get<string>('OPENROUTER_DEFAULT_MODEL') || 'deepseek/deepseek-v3.2';
    this.llm = new ChatOpenRouter({ apiKey, model, temperature: 0.3, maxTokens: 2048 });
  }

  async create(userId: string, dto: CreateRelationshipDto) {
    const person = await this.prisma.relationshipPerson.create({
      data: {
        userId,
        name: dto.name,
        relationship: dto.relationship,
        description: dto.description || null,
        dynamic: dto.dynamic || null,
        keyContext: dto.keyContext || null,
        communicationStyle: dto.communicationStyle || null,
        loveLanguage: dto.loveLanguage || null,
        linkedUserId: dto.linkedUserId || null,
        phoneNumber: dto.phoneNumber?.trim() || null,
      },
    });
    this.events.emit(ONTOLOGY_EVENTS.RELATIONAL_INPUT, {
      userId,
      eventType: 'relationship.created',
      scopeId: person.id,
      payload: { name: person.name, relationship: person.relationship },
    });
    return person;
  }

  async findAll(userId: string) {
    return this.prisma.relationshipPerson.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { notes: true } },
      },
    });
  }

  async findOne(userId: string, id: string) {
    const person = await this.prisma.relationshipPerson.findFirst({
      where: { id, userId },
      include: {
        notes: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!person) throw new NotFoundException('Person not found');
    return person;
  }

  async update(userId: string, id: string, dto: UpdateRelationshipDto) {
    const person = await this.prisma.relationshipPerson.findFirst({
      where: { id, userId },
    });
    if (!person) throw new NotFoundException('Person not found');

    const updated = await this.prisma.relationshipPerson.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.relationship !== undefined && { relationship: dto.relationship }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.dynamic !== undefined && { dynamic: dto.dynamic }),
        ...(dto.keyContext !== undefined && { keyContext: dto.keyContext }),
        ...(dto.communicationStyle !== undefined && { communicationStyle: dto.communicationStyle }),
        ...(dto.loveLanguage !== undefined && { loveLanguage: dto.loveLanguage }),
        ...(dto.phoneNumber !== undefined && { phoneNumber: dto.phoneNumber?.trim() || null }),
      },
    });
    this.events.emit(ONTOLOGY_EVENTS.RELATIONAL_INPUT, {
      userId,
      eventType: 'relationship.updated',
      scopeId: id,
      payload: {},
    });
    return updated;
  }

  async remove(userId: string, id: string) {
    const person = await this.prisma.relationshipPerson.findFirst({
      where: { id, userId },
    });
    if (!person) throw new NotFoundException('Person not found');

    await this.prisma.relationshipPerson.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Link a Circle person to a registered 4Ever User (authoritative link).
   * Pass linkedUserId = null to clear an existing link.
   */
  async linkUser(userId: string, personId: string, linkedUserId: string | null) {
    const person = await this.prisma.relationshipPerson.findFirst({
      where: { id: personId, userId },
    });
    if (!person) throw new NotFoundException('Person not found');

    if (linkedUserId) {
      const target = await this.prisma.user.findUnique({
        where: { id: linkedUserId },
        select: { id: true },
      });
      if (!target) throw new NotFoundException('User not found');
      if (target.id === userId) {
        throw new NotFoundException('Cannot link a Circle person to yourself');
      }
    }

    return this.prisma.relationshipPerson.update({
      where: { id: personId },
      data: { linkedUserId },
    });
  }

  async addNote(
    userId: string,
    personId: string,
    content: string,
    source = 'manual',
    sentiment?: string,
    topic?: string,
  ) {
    const person = await this.prisma.relationshipPerson.findFirst({
      where: { id: personId, userId },
    });
    if (!person) throw new NotFoundException('Person not found');

    const note = await this.prisma.relationshipNote.create({
      data: {
        personId,
        content,
        source,
        ...(sentiment && { sentiment }),
        ...(topic && { topic }),
      },
    });

    // Update interaction tracking on the person
    await this.prisma.relationshipPerson.update({
      where: { id: personId },
      data: {
        lastInteractionAt: new Date(),
        interactionCount: { increment: 1 },
      },
    });

    this.events.emit(ONTOLOGY_EVENTS.RELATIONAL_INPUT, {
      userId,
      eventType: 'relationship.note_added',
      scopeId: personId,
      payload: { source, sentiment, topic },
    });

    return note;
  }

  async getHealth(userId: string) {
    const DRIFT_DAYS = 14;
    const driftDate = new Date();
    driftDate.setDate(driftDate.getDate() - DRIFT_DAYS);

    const allPeople = await this.prisma.relationshipPerson.findMany({
      where: { userId, isActive: true },
      select: {
        id: true,
        name: true,
        relationship: true,
        description: true,
        dynamic: true,
        lastInteractionAt: true,
        interactionCount: true,
      },
    });

    if (allPeople.length === 0) {
      return {
        totalPeople: 0, healthyCount: 0, driftingCount: 0,
        overallScore: 0, driftingPeople: [], peopleWithScores: [], recentActivity: [],
      };
    }

    // Gather all connections for this user (to match circle people → DM users)
    const connections = await this.prisma.connection.findMany({
      where: { status: 'accepted', OR: [{ requesterId: userId }, { receiverId: userId }] },
      include: {
        requester: { select: { id: true, name: true } },
        receiver: { select: { id: true, name: true } },
      },
    });

    const connectedUsers = connections.map((c) => {
      const other = c.requesterId === userId ? c.receiver : c.requester;
      return { userId: other.id, name: other.name };
    });

    // --- Batch fetch all related data to avoid N+1 ---
    const personIds = allPeople.map((p) => p.id);

    // Match connected users: prefer authoritative linkedUserId, fall back to fuzzy name
    const matchedUserMap = new Map<string, { userId: string; name: string }>();
    const peopleWithLink = await this.prisma.relationshipPerson.findMany({
      where: { id: { in: personIds } },
      select: { id: true, linkedUserId: true },
    });
    const linkById = new Map(peopleWithLink.map((p) => [p.id, p.linkedUserId]));
    for (const person of allPeople) {
      const explicit = linkById.get(person.id);
      if (explicit) {
        const c = connectedUsers.find((u) => u.userId === explicit);
        if (c) {
          matchedUserMap.set(person.id, c);
          continue;
        }
      }
      const matched = connectedUsers.find(
        (u) => u.name.toLowerCase().includes(person.name.toLowerCase()) ||
               person.name.toLowerCase().includes(u.name.toLowerCase()),
      );
      if (matched) matchedUserMap.set(person.id, matched);
    }

    // Batch fetch DMs for all matched users
    const matchedConnUserIds = [...new Set([...matchedUserMap.values()].map((u) => u.userId))];
    const allDms = matchedConnUserIds.length > 0
      ? await this.prisma.directMessage.findMany({
          where: {
            OR: [
              { senderId: userId, receiverId: { in: matchedConnUserIds } },
              { senderId: { in: matchedConnUserIds }, receiverId: userId },
            ],
          },
          orderBy: { createdAt: 'desc' },
          include: { sender: { select: { name: true } } },
        })
      : [];

    // Group DMs by the "other" user ID, keep last 15 per user
    const dmsByUser = new Map<string, typeof allDms>();
    for (const dm of allDms) {
      const otherId = dm.senderId === userId ? dm.receiverId : dm.senderId;
      if (!dmsByUser.has(otherId)) dmsByUser.set(otherId, []);
      const arr = dmsByUser.get(otherId)!;
      if (arr.length < 15) arr.push(dm); // already sorted desc
    }

    // Batch fetch notes and rituals for all person IDs
    const [allNotes, allRituals] = await Promise.all([
      this.prisma.relationshipNote.findMany({
        where: { personId: { in: personIds } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.relationshipRitual.findMany({
        where: { personId: { in: personIds }, isActive: true },
        select: { personId: true, title: true, frequency: true, lastDoneAt: true, streak: true },
      }),
    ]);

    // Group notes by personId (keep last 5)
    const notesByPerson = new Map<string, typeof allNotes>();
    for (const note of allNotes) {
      if (!notesByPerson.has(note.personId)) notesByPerson.set(note.personId, []);
      const arr = notesByPerson.get(note.personId)!;
      if (arr.length < 5) arr.push(note);
    }

    // Group rituals by personId
    const ritualsByPerson = new Map<string, typeof allRituals>();
    for (const r of allRituals) {
      if (!r.personId) continue;
      if (!ritualsByPerson.has(r.personId)) ritualsByPerson.set(r.personId, []);
      ritualsByPerson.get(r.personId)!.push(r);
    }

    // Build context per person using pre-fetched data
    const personContexts = allPeople.map((person) => {
      const matchedUser = matchedUserMap.get(person.id);

      let messagesSummary = 'No direct messages (not connected on 4Ever or no messages yet).';
      let lastMsgDate: Date | null = null;
      if (matchedUser) {
        const dms = dmsByUser.get(matchedUser.userId) || [];
        if (dms.length > 0) {
          lastMsgDate = dms[0].createdAt;
          messagesSummary = [...dms].reverse().map((m) => {
            const date = m.createdAt.toISOString().split('T')[0];
            return `[${date}] ${m.sender.name}: ${m.content.substring(0, 150)}`;
          }).join('\n');
        } else {
          messagesSummary = 'Connected on 4Ever but no messages exchanged yet.';
        }
      }

      const notes = notesByPerson.get(person.id) || [];
      const notesSummary = notes.length > 0
        ? notes.map((n) => `[${n.createdAt.toISOString().split('T')[0]}] (${n.sentiment || 'neutral'}) ${n.content.substring(0, 150)}`).join('\n')
        : 'No interaction notes logged.';

      const rituals = ritualsByPerson.get(person.id) || [];
      const ritualsSummary = rituals.length > 0
        ? rituals.map((r) => `"${r.title}" (${r.frequency}, streak: ${r.streak}, last: ${r.lastDoneAt?.toISOString().split('T')[0] || 'never'})`).join('; ')
        : 'No rituals set.';

      const lastInteraction = person.lastInteractionAt || lastMsgDate || (notes.length > 0 ? notes[0].createdAt : null);
      const daysSince = lastInteraction
        ? Math.floor((Date.now() - new Date(lastInteraction).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      // Backfill: fire-and-forget
      if (!person.lastInteractionAt && lastMsgDate) {
        this.prisma.relationshipPerson.update({
          where: { id: person.id },
          data: { lastInteractionAt: lastMsgDate },
        }).catch(() => {});
      }

      return {
        id: person.id,
        name: person.name,
        relationship: person.relationship,
        daysSinceInteraction: daysSince,
        context: `## ${person.name} (${person.relationship})
${person.description ? `Description: ${person.description}` : ''}
${person.dynamic ? `Dynamic: ${person.dynamic}` : ''}
Last interaction: ${daysSince !== null ? `${daysSince} days ago` : 'Never'}
Total interactions logged: ${person.interactionCount}

### Recent Messages:
${messagesSummary}

### Relationship Notes:
${notesSummary}

### Rituals:
${ritualsSummary}`,
      };
    });

    // Single LLM call to score ALL relationships at once
    const prompt = `You are a relationship health analyst for a personal relationship management app called 4Ever.
Today is ${new Date().toISOString().split('T')[0]}.

The user has ${allPeople.length} people in their relationship circle. Based on the evidence below, rate EACH relationship's health from 0-100 and explain why in 1-2 sentences.

Consider these factors:
- Message frequency, tone, and reciprocity
- Whether conversations feel warm, engaged, or one-sided
- How recently they communicated
- Relationship notes and their sentiment
- Whether rituals are being maintained
- For new relationships with little data, be optimistic (score 50-60) rather than harsh

IMPORTANT: Respond ONLY with valid JSON. No markdown, no code fences.
Format:
[{"name": "PersonName", "score": 75, "reason": "Brief explanation", "status": "healthy|needs_attention|drifting"}]

Status rules: healthy = score >= 60, needs_attention = score 35-59, drifting = score < 35

---
${personContexts.map((p) => p.context).join('\n\n---\n')}`;

    let llmScores: Array<{ name: string; score: number; reason: string; status: string }> = [];

    try {
      const response = await this.llm.invoke(prompt);
      const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      // Extract JSON from response (handle possible markdown wrapping)
      const jsonMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (jsonMatch) {
        llmScores = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON array found in LLM response');
      }
    } catch (err: any) {
      this.logger.warn(`LLM health analysis failed, using fallback: ${err.message}`);
      // Fallback to simple formula if LLM fails
      llmScores = personContexts.map((p) => {
        const person = allPeople.find((ap) => ap.id === p.id);
        let score = 50;
        if (person?.lastInteractionAt) {
          const days = (Date.now() - person.lastInteractionAt.getTime()) / (1000 * 60 * 60 * 24);
          if (days <= 3) score += 30;
          else if (days <= 7) score += 20;
          else if (days <= 14) score += 10;
          else if (days <= 30) score -= 10;
          else score -= 25;
        } else score -= 30;
        if ((person?.interactionCount || 0) >= 10) score += 15;
        else if ((person?.interactionCount || 0) >= 5) score += 10;
        else if ((person?.interactionCount || 0) >= 2) score += 5;
        score = Math.max(0, Math.min(100, score));
        return {
          name: p.name,
          score,
          reason: 'Score computed from interaction recency and frequency (LLM unavailable).',
          status: score >= 60 ? 'healthy' : score >= 35 ? 'needs_attention' : 'drifting',
        };
      });
    }

    // Merge LLM scores with person data
    const peopleWithScores = personContexts.map((pc) => {
      const llmResult = llmScores.find(
        (s) => s.name.toLowerCase() === pc.name.toLowerCase(),
      ) || { score: 50, reason: 'No LLM analysis available.', status: 'needs_attention' };
      return {
        id: pc.id,
        name: pc.name,
        relationship: pc.relationship,
        healthScore: Math.max(0, Math.min(100, llmResult.score)),
        reason: llmResult.reason,
        status: llmResult.status,
        daysSinceInteraction: pc.daysSinceInteraction,
      };
    });

    const overallScore = peopleWithScores.length > 0
      ? Math.round(peopleWithScores.reduce((s, p) => s + p.healthScore, 0) / peopleWithScores.length)
      : 0;

    const driftingPeople = peopleWithScores.filter((p) => p.status === 'drifting' || p.status === 'needs_attention');
    const healthyCount = peopleWithScores.filter((p) => p.status === 'healthy').length;

    // Recent activity: last 5 notes across all people
    const recentActivity = await this.prisma.relationshipNote.findMany({
      where: {
        person: { userId, isActive: true },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        person: { select: { name: true, relationship: true } },
      },
    });

    return {
      totalPeople: allPeople.length,
      healthyCount,
      driftingCount: driftingPeople.length,
      overallScore,
      driftingPeople,
      peopleWithScores: peopleWithScores.sort((a, b) => a.healthScore - b.healthScore),
      recentActivity: recentActivity.map((n) => ({
        id: n.id,
        personName: n.person.name,
        personRelationship: n.person.relationship,
        content: n.content,
        sentiment: n.sentiment,
        topic: n.topic,
        source: n.source,
        createdAt: n.createdAt,
      })),
    };
  }

  async getAnnualReview(userId: string) {
    const yearStart = new Date();
    yearStart.setFullYear(yearStart.getFullYear() - 1);

    const allPeople = await this.prisma.relationshipPerson.findMany({
      where: { userId, isActive: true },
      include: {
        notes: {
          where: { createdAt: { gte: yearStart } },
          orderBy: { createdAt: 'desc' },
        },
        _count: { select: { notes: true } },
      },
    });

    const totalNotes = allPeople.reduce((sum, p) => sum + p.notes.length, 0);

    // Most active relationships (by notes in last year)
    const mostActive = allPeople
      .map((p) => ({
        id: p.id,
        name: p.name,
        relationship: p.relationship,
        noteCount: p.notes.length,
        sentimentBreakdown: {
          positive: p.notes.filter((n) => n.sentiment === 'positive').length,
          neutral: p.notes.filter((n) => n.sentiment === 'neutral').length,
          negative: p.notes.filter((n) => n.sentiment === 'negative').length,
        },
      }))
      .sort((a, b) => b.noteCount - a.noteCount)
      .slice(0, 10);

    // People added this year
    const newPeople = allPeople.filter((p) => p.createdAt >= yearStart).map((p) => ({
      id: p.id,
      name: p.name,
      relationship: p.relationship,
      addedAt: p.createdAt,
    }));

    // Neglected relationships (no notes in past year)
    const neglected = allPeople
      .filter((p) => p.notes.length === 0)
      .map((p) => ({ id: p.id, name: p.name, relationship: p.relationship }));

    // Tension stats
    const tensionCount = await this.prisma.tensionEntry.count({
      where: { userId, createdAt: { gte: yearStart } },
    });
    const resolvedCount = await this.prisma.tensionEntry.count({
      where: { userId, status: 'resolved', createdAt: { gte: yearStart } },
    });

    // Ritual stats
    const ritualCount = await this.prisma.relationshipRitual.count({
      where: { userId, isActive: true },
    });

    // Life events this year
    const eventsThisYear = await this.prisma.lifeEvent.count({
      where: { userId, eventDate: { gte: yearStart } },
    });

    // Monthly interaction trend
    const monthlyTrend: { month: string; count: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const monthStart = new Date();
      monthStart.setMonth(monthStart.getMonth() - i, 1);
      monthStart.setHours(0, 0, 0, 0);
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      const count = allPeople.reduce(
        (sum, p) => sum + p.notes.filter((n) => n.createdAt >= monthStart && n.createdAt < monthEnd).length,
        0,
      );
      monthlyTrend.push({
        month: monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        count,
      });
    }

    return {
      period: { from: yearStart, to: new Date() },
      totalPeople: allPeople.length,
      totalInteractions: totalNotes,
      mostActive,
      newPeople,
      neglected,
      tensionStats: { total: tensionCount, resolved: resolvedCount },
      ritualCount,
      eventsThisYear,
      monthlyTrend,
    };
  }

  async createPersonaFromPerson(userId: string, personId: string) {
    const person = await this.prisma.relationshipPerson.findFirst({
      where: { id: personId, userId },
    });
    if (!person) throw new NotFoundException('Person not found');

    if (person.linkedPersonaId) {
      // Check if persona still exists
      const existing = await this.prisma.persona.findFirst({
        where: { id: person.linkedPersonaId, userId },
      });
      if (existing) {
        return { persona: existing, alreadyExists: true };
      }
    }

    // Build a system prompt from the person's data
    const promptParts: string[] = [];
    promptParts.push(`You are ${person.name}, the user's ${person.relationship.toLowerCase()}.`);
    promptParts.push(`You are role-playing as this real person in the user's life. Respond as ${person.name} would — with their personality, values, and communication style.`);

    if (person.description) {
      promptParts.push(`\nAbout you: ${person.description}`);
    }
    if (person.communicationStyle) {
      promptParts.push(`\nYour communication style: ${person.communicationStyle}`);
    }
    if (person.dynamic) {
      promptParts.push(`\nYour dynamic with the user: ${person.dynamic}`);
    }
    if (person.keyContext) {
      promptParts.push(`\nRelevant context: ${person.keyContext}`);
    }

    promptParts.push(`\nGuidelines:`);
    promptParts.push(`- Stay in character as ${person.name} at all times`);
    promptParts.push(`- Respond the way ${person.name} would actually respond — including their biases, concerns, and warmth`);
    promptParts.push(`- If the user asks for advice, give it from ${person.name}'s perspective, not as a neutral AI`);
    promptParts.push(`- Reference shared history and your relationship dynamic when relevant`);
    promptParts.push(`- Be authentic, not a caricature — real people are nuanced`);

    const systemPrompt = promptParts.join('\n');

    const persona = await this.prisma.persona.create({
      data: {
        userId,
        name: person.name,
        description: `Persona based on ${person.name} (${person.relationship}) from your Relationship Circle`,
        systemPrompt,
        modelName: 'deepseek/deepseek-v3.2',
        isActive: true,
      },
    });

    // Link persona back to the person
    await this.prisma.relationshipPerson.update({
      where: { id: personId },
      data: { linkedPersonaId: persona.id },
    });

    this.logger.log(`Created persona "${persona.name}" from relationship person ${personId}`);
    return { persona, alreadyExists: false };
  }
}
