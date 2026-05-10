const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.user.findMany({
  select: {
    id: true,
    name: true,
    phoneNumber: true,
    subscriptionTier: true,
    subscriptionExpiresAt: true,
  },
}).then((u) => {
  console.log(JSON.stringify(u, null, 2));
  return p.$disconnect();
});
