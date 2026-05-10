/**
 * Clean up assistant messages that leaked the [time ago] prefix into their content.
 * Safe: matches only messages whose content STARTS with a bracketed token like
 * [just now], [5 minutes ago], [2 days ago], [1 week ago], [in 3 days], etc.
 */
const { PrismaClient } = require('@prisma/client');

const LEAK_PREFIX = /^\[(just now|in a moment|unknown|(\d+\s+(minute|hour|day|week|month|year)s?\s+(ago|from now))|in\s+\d+\s+(minute|hour|day|week|month|year)s?)\]\s*/i;

async function run() {
  const p = new PrismaClient();
  try {
    const rows = await p.$queryRawUnsafe(
      `SELECT id, user_id, role, content, created_at
         FROM core_chat_messages
        WHERE role = 'assistant'
          AND content ~ '^\\['
        ORDER BY created_at DESC`,
    );
    console.log(`Found ${rows.length} assistant message(s) with a leading [bracket]`);

    let fixed = 0, skipped = 0;
    for (const r of rows) {
      const m = LEAK_PREFIX.exec(r.content);
      if (!m) { skipped++; continue; }
      const cleaned = r.content.slice(m[0].length);
      console.log(`  - ${r.id}  "${r.content.slice(0, 60)}…" -> "${cleaned.slice(0, 60)}…"`);
      await p.$executeRawUnsafe(
        `UPDATE core_chat_messages SET content = $1 WHERE id = $2`,
        cleaned, r.id,
      );
      fixed++;
    }
    console.log(`\nDone. fixed=${fixed} skipped=${skipped}`);
  } finally {
    await p.$disconnect();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
