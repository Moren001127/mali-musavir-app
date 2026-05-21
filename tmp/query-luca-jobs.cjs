const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const jobs = await prisma.lucaFetchJob.findMany({
    where: { tip: 'ISLETME_GIDER' },
    orderBy: { createdAt: 'desc' },
    take: 12,
    select: {
      id: true,
      sessionId: true,
      mukellefId: true,
      donem: true,
      tip: true,
      status: true,
      recordCount: true,
      retryCount: true,
      nextRetryAt: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      errorMsg: true,
    },
  });
  console.log(JSON.stringify(jobs, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
