const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 1. Memory type distribution
  const typeStats = await prisma.$queryRaw`
    SELECT memory_type, COUNT(*)::int as count,
           ROUND(AVG(confidence)::numeric, 2) as avg_confidence,
           ROUND(AVG(strength)::numeric, 2) as avg_strength
    FROM memories GROUP BY memory_type ORDER BY count DESC
  `;
  console.log('\n=== Memory OS — Type Distribution ===');
  console.table(typeStats);

  // 2. Overall summary
  const summary = await prisma.$queryRaw`
    SELECT COUNT(*)::int as total_memories,
           COUNT(DISTINCT memory_type)::int as unique_types,
           COUNT(*) FILTER (WHERE strength < 1.0)::int as decayed_memories,
           COUNT(*) FILTER (WHERE entities IS NOT NULL AND entities != '[]')::int as with_entities,
           COUNT(*) FILTER (WHERE links IS NOT NULL AND links != '[]')::int as with_links
    FROM memories
  `;
  console.log('\n=== Memory OS — Summary ===');
  console.table(summary);

  // 3. Memory patterns table
  const patterns = await prisma.$queryRaw`
    SELECT COUNT(*)::int as total_patterns FROM memory_patterns
  `;
  console.log('\n=== Memory OS — Patterns ===');
  console.table(patterns);

  // 4. Sample memories (first 5)
  const samples = await prisma.memory.findMany({
    take: 5,
    select: {
      id: true,
      memoryType: true,
      content: true,
      confidence: true,
      strength: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  console.log('\n=== Memory OS — Latest 5 Memories ===');
  samples.forEach((m, i) => {
    console.log(`\n[${i + 1}] Type: ${m.memoryType} | Confidence: ${m.confidence} | Strength: ${m.strength}`);
    console.log(`    Content: ${m.content?.substring(0, 120)}...`);
    console.log(`    Created: ${m.createdAt}`);
  });

  console.log('\n✅ Memory OS is operational!\n');
}

main().catch(console.error).finally(() => prisma.$disconnect());
