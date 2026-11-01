// Explicit demo-only entry point; never point this at a production database.
const url = new URL(process.env.DATABASE_URL || 'postgresql://localhost/unknown');
if (process.env.NODE_ENV === 'production' || !/(?:^|[_-])(?:test|demo)(?:$|[_-])/i.test(decodeURIComponent(url.pathname).slice(1))) {
  console.error('seed:demo requires a test/demo database and non-production NODE_ENV');
  process.exitCode = 1;
} else {
  process.env.SEED_DEMO = 'true';
  require('./seed');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  require('./seed').seed(prisma).then(
    result => { console.log(JSON.stringify({ level: 'info', msg: 'demo_seed_done', ...result })); },
    error => { console.error(error.message); process.exitCode = 1; },
  ).finally(() => prisma.$disconnect());
}
