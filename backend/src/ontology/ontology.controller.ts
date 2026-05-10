import { Controller, Get, Param, UseGuards, Request, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OntologyService } from './ontology.service';
import { OntologySynthesisService } from './synthesis.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('ontology')
@UseGuards(JwtAuthGuard)
export class OntologyController {
  private readonly logger = new Logger(OntologyController.name);

  constructor(
    private readonly ontology: OntologyService,
    private readonly synthesis: OntologySynthesisService,
    private readonly prisma: PrismaService,
  ) {}

  /** Compact snapshot for the Home screen card. */
  @Get('snapshot')
  async getSnapshot(@Request() req: any) {
    return this.ontology.getHomeSnapshot(req.user.userId);
  }

  /** Full composed view (Self + Emotional + Relational). */
  @Get('compose')
  async compose(@Request() req: any) {
    return this.ontology.compose(req.user.userId);
  }

  /**
   * Fire-and-forget ontology refresh. Queues self + emotional + relational
   * synthesis for all active people in the background and returns immediately.
   * The client should NOT await this expecting fresh data — it's an async
   * heavy LLM operation (~60–120s end-to-end). Fresh data shows up on the
   * next /snapshot fetch after synthesis completes.
   */
  @Get('refresh')
  async refresh(@Request() req: any) {
    const userId = req.user.userId;
    // Pre-count people so the response tells the client how many relational
    // refreshes are queued. Cheap single query.
    const people = await this.prisma.relationshipPerson.findMany({
      where: { userId, isActive: true },
      select: { id: true },
    });
    // Kick off background work — do NOT await.
    setImmediate(() => {
      this.runBackgroundRefresh(userId, people.map((p) => p.id)).catch(
        (err) =>
          this.logger.error(
            `Background refresh failed for ${userId}: ${err?.message || err}`,
          ),
      );
    });
    return { ok: true, queued: true, relationalCount: people.length };
  }

  private async runBackgroundRefresh(
    userId: string,
    personIds: string[],
  ): Promise<void> {
    await this.synthesis.runSynthesis(userId, 'self', null);
    await this.synthesis.runSynthesis(userId, 'emotional', null);
    for (const id of personIds) {
      await this.synthesis.runSynthesis(userId, 'relational', id);
    }
    this.logger.log(
      `Background refresh done for ${userId} (people=${personIds.length})`,
    );
  }

  /** Self ontology (identity + trajectory + goals). */
  @Get('self')
  async getSelf(@Request() req: any) {
    return this.ontology.getSelf(req.user.userId);
  }

  /** Emotional ontology (weather + trends + tensions). */
  @Get('emotional')
  async getEmotional(@Request() req: any) {
    return this.ontology.getEmotional(req.user.userId);
  }

  /** Relational snapshot for a single person, or null if no snapshot yet. */
  @Get('relational/:personId')
  async getRelationalOne(
    @Request() req: any,
    @Param('personId') personId: string,
  ) {
    const results = await this.ontology.getRelational(req.user.userId, {
      personIds: [personId],
    });
    return results[0] || null;
  }
}
