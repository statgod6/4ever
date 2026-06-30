/**
 * Memory OS Backfill Script
 *
 * One-time migration to populate new Memory OS fields for existing data:
 *  1. Map existing memoryType values to new types
 *  2. Set initial confidence = importanceScore for existing memories
 *  3. Set initial strength = 1.0 for all existing active memories
 *  4. Scan user_contexts.goals and create goal-type memories
 *  5. Set lastReinforcedAt = createdAt for existing memories
 *
 * Usage: npx ts-node backend/scripts/memory-os-backfill.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Memory type mapping: old types → new Memory OS types
const TYPE_MAP: Record<string, string> = {
  fact: 'semantic',
  preference: 'semantic',
  decision: 'episodic',
  insight: 'reflection',
  goal: 'goal',
  explicit: 'semantic',
  thought: 'episodic',
  reflection: 'reflection',
  semantic: 'semantic',
  episodic: 'episodic',
  procedural: 'procedural',
  relationship: 'relationship',
  identity: 'identity',
  skill: 'skill',
  collective: 'collective',
};

async function main() {
  console.log('🔄 Memory OS Backfill — Starting...\n');

  // ── Step 1: Update existing memories with new fields ───────────────
  const totalMemories = await prisma.memory.count({ where: { status: 'active' } });
  console.log(`Found ${totalMemories} active memories to backfill.`);

  const BATCH_SIZE = 500;
  let processed = 0;
  let typeRemapped = 0;
  let confidenceSet = 0;
  let strengthSet = 0;

  while (processed < totalMemories) {
    const batch = await prisma.memory.findMany({
      where: { status: 'active' },
      skip: processed,
      take: BATCH_SIZE,
      select: {
        id: true,
        memoryType: true,
        importanceScore: true,
        confidence: true,
        strength: true,
        lastReinforcedAt: true,
        createdAt: true,
      },
    });

    for (const mem of batch) {
      const updates: any = {};

      // Remap memory type if needed
      const newType = TYPE_MAP[mem.memoryType];
      if (newType && newType !== mem.memoryType) {
        updates.memoryType = newType;
        typeRemapped++;
      }

      // Set confidence = importanceScore if not already set (or default 0.5)
      if (mem.confidence === 0.5 && mem.importanceScore > 0) {
        updates.confidence = mem.importanceScore;
        confidenceSet++;
      }

      // Set strength = 1.0 if not already set
      if (mem.strength === 1.0) {
        // Already correct default, but ensure lastReinforcedAt is set
        if (!mem.lastReinforcedAt) {
          updates.lastReinforcedAt = mem.createdAt;
          strengthSet++;
        }
      }

      if (Object.keys(updates).length > 0) {
        await prisma.memory.update({
          where: { id: mem.id },
          data: updates,
        });
      }
    }

    processed += batch.length;
    console.log(`  Processed ${processed}/${totalMemories} memories...`);
  }

  console.log(`\n✅ Memory backfill complete:`);
  console.log(`   Types remapped: ${typeRemapped}`);
  console.log(`   Confidence set: ${confidenceSet}`);
  console.log(`   Strength/lastReinforcedAt set: ${strengthSet}`);

  // ── Step 2: Create goal memories from user_contexts.goals ──────────
  console.log('\n🔄 Scanning user_contexts for goals...');

  const userContexts = await prisma.userContext.findMany({
    where: {
      goals: { not: null },
    },
    select: { userId: true, goals: true },
  });

  let goalsCreated = 0;
  for (const ctx of userContexts) {
    if (!ctx.goals || ctx.goals.trim().length === 0) continue;

    // Check if goals already exist as memories
    const existing = await prisma.memory.findMany({
      where: {
        userId: ctx.userId,
        memoryType: 'goal',
        status: 'active',
      },
      select: { content: true },
    });

    const existingText = existing.map(m => m.content.toLowerCase()).join(' ');

    // Split goals by semicolons, newlines, or numbered lists
    const goals = ctx.goals
      .split(/[;\n]/)
      .map(g => g.replace(/^\d+[\.\)]\s*/, '').trim())
      .filter(g => g.length > 5);

    for (const goal of goals) {
      // Skip if a similar goal already exists
      if (existingText.includes(goal.toLowerCase().substring(0, 30))) continue;

      await prisma.memory.create({
        data: {
          userId: ctx.userId,
          memoryType: 'goal',
          content: goal,
          importanceScore: 0.85,
          confidence: 0.85,
          strength: 1.0,
          source: 'system',
          lastReinforcedAt: new Date(),
        },
      });
      goalsCreated++;
    }
  }

  console.log(`✅ Goals created from user_contexts: ${goalsCreated}`);

  // ── Step 3: Summary ────────────────────────────────────────────────
  console.log('\n📊 Backfill Summary:');
  console.log(`   Memories processed: ${totalMemories}`);
  console.log(`   Types remapped: ${typeRemapped}`);
  console.log(`   Confidence updated: ${confidenceSet}`);
  console.log(`   Strength/lastReinforcedAt set: ${strengthSet}`);
  console.log(`   Goals created from user_contexts: ${goalsCreated}`);
  console.log('\n🎉 Memory OS backfill complete!');
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
