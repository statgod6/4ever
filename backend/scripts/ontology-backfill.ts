/**
 * Ontology backfill — runs synthesis for all active users across Self,
 * Emotional, and every Relational person.
 *
 * Usage: npx ts-node backend/scripts/ontology-backfill.ts
 * or add to package.json: "ontology:backfill": "ts-node scripts/ontology-backfill.ts"
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OntologySynthesisService } from '../src/ontology/synthesis.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const prisma = app.get(PrismaService);
  const synth = app.get(OntologySynthesisService);

  const users = await prisma.user.findMany({ select: { id: true, phoneNumber: true, name: true } });
  console.log(`[backfill] Found ${users.length} users`);

  for (const u of users) {
    console.log(`\n[backfill] User ${u.id} (${u.name || u.phoneNumber})`);

    // Self
    try {
      await synth.runSynthesis(u.id, 'self', null);
      console.log('  - self OK');
    } catch (e: any) {
      console.error('  - self FAIL', e?.message || e);
    }

    // Emotional
    try {
      await synth.runSynthesis(u.id, 'emotional', null);
      console.log('  - emotional OK');
    } catch (e: any) {
      console.error('  - emotional FAIL', e?.message || e);
    }

    // Relational per person
    const people = await prisma.relationshipPerson.findMany({
      where: { userId: u.id, isActive: true },
      select: { id: true, name: true },
    });
    console.log(`  - ${people.length} active people`);
    for (const p of people) {
      try {
        await synth.runSynthesis(u.id, 'relational', p.id);
        console.log(`    - relational OK (${p.name})`);
      } catch (e: any) {
        console.error(`    - relational FAIL (${p.name})`, e?.message || e);
      }
    }
  }

  console.log('\n[backfill] Done.');
  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('[backfill] FATAL', err);
  process.exit(1);
});
