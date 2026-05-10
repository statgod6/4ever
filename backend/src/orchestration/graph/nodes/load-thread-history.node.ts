import { PrismaService } from '../../../prisma/prisma.service';
import { ThoughtAnalysisStateType } from '../state';

/**
 * Node: load_thread_history
 * Loads prior messages and running summary from the thread.
 * This provides continuity for the persona responses.
 */
export function createLoadThreadHistoryNode(prisma: PrismaService) {
  return async (state: ThoughtAnalysisStateType): Promise<Partial<ThoughtAnalysisStateType>> => {
    // Load all messages in this thread
    const threadMessages = await prisma.message.findMany({
      where: { threadId: state.thread.id },
      orderBy: { createdAt: 'asc' },
    });

    // Load existing summary if any
    const summary = await prisma.thoughtSummary.findUnique({
      where: { threadId: state.thread.id },
    });

    return {
      threadMessages,
      existingSummary: summary?.runningSummary || null,
    };
  };
}
