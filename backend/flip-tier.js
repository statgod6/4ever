const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const userId = process.argv[2];
const tier = process.argv[3] || 'premium';
if (!userId) {
  console.error('Usage: node flip-tier.js <userId> [premium|free]');
  process.exit(1);
}
p.user
  .update({ where: { id: userId }, data: { subscriptionTier: tier } })
  .then((u) => {
    console.log('Flipped', u.name, '->', u.subscriptionTier);
    return p.$disconnect();
  })
  .catch((e) => {
    console.error('Error:', e.message);
    return p.$disconnect();
  });
