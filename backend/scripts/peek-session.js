const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.$queryRawUnsafe("SELECT core_chat_session_start FROM user_contexts WHERE user_id = '3b471ed2-1059-4fc1-ba25-f5998ca2b2f4'")
  .then(r => console.log(JSON.stringify(r)))
  .finally(() => p.$disconnect());
