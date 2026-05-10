import { PrismaService } from '../prisma/prisma.service';

/**
 * Normalize action content for dedup comparison.
 * Lowercases, strips punctuation, collapses whitespace.
 */
export function normalizeActionContent(s: string): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CreateActionData {
  userId: string;
  content: string;
  threadId?: string | null;
  personaId?: string | null;
  dimension?: string | null;
  dueDate?: Date | null;
}

/**
 * Create an action item only if no duplicate pending item exists.
 * Duplicates = same userId, status='pending', matching normalized content,
 * created within the last 30 days.
 * Returns the created item, or null if a duplicate was found.
 */
export async function createActionItemIfNew(
  prisma: PrismaService,
  data: CreateActionData,
): Promise<{ id: string; content: string } | null> {
  const normalized = normalizeActionContent(data.content);
  if (!normalized) return null;

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const existing = await prisma.actionItem.findMany({
    where: {
      userId: data.userId,
      status: 'pending',
      createdAt: { gte: cutoff },
    },
    select: { id: true, content: true },
    take: 100,
  });

  const duplicate = existing.find(
    (e) => normalizeActionContent(e.content) === normalized,
  );
  if (duplicate) return null;

  const created = await prisma.actionItem.create({
    data: {
      userId: data.userId,
      content: data.content,
      threadId: data.threadId ?? null,
      personaId: data.personaId ?? null,
      dimension: data.dimension ?? null,
      dueDate: data.dueDate ?? null,
    },
    select: { id: true, content: true },
  });

  return created;
}

/**
 * Auto-dismiss pending action items that duplicate an earlier pending item
 * for the same user. Keeps the earliest by createdAt, dismisses the rest.
 * Returns the number of items dismissed.
 */
export async function dedupePendingActions(
  prisma: PrismaService,
  userId: string,
): Promise<number> {
  const pending = await prisma.actionItem.findMany({
    where: { userId, status: 'pending' },
    select: { id: true, content: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const seen = new Map<string, string>(); // normalized -> earliest id
  const dupIds: string[] = [];
  for (const item of pending) {
    const key = normalizeActionContent(item.content);
    if (!key) continue;
    if (seen.has(key)) {
      dupIds.push(item.id);
    } else {
      seen.set(key, item.id);
    }
  }

  if (dupIds.length === 0) return 0;

  await prisma.actionItem.updateMany({
    where: { id: { in: dupIds } },
    data: { status: 'dismissed' },
  });

  return dupIds.length;
}
