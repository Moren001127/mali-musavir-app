import { PrismaClient } from '@prisma/client';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ReconciliationEngine } from '../apps/api/src/kdv-control/reconciliation.engine';

const prisma = new PrismaClient();
const sessionId = process.env.KDV_SESSION_ID || 'cmpavghpa007ovfjf7aakksdj';

async function main() {
  const backupDir = path.join(
    process.cwd(),
    'tmp',
    `kdv-live-recompute-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`,
  );
  await mkdir(backupDir, { recursive: true });

  const before = await prisma.reconciliationResult.findMany({
    where: { sessionId },
    include: { kdvRecord: true, image: true },
    orderBy: { createdAt: 'asc' },
  });
  await writeFile(path.join(backupDir, 'results-before.json'), JSON.stringify(before, null, 2), 'utf8');

  const engine = new ReconciliationEngine(prisma as any);
  const summary = await engine.runReconciliation(sessionId);

  const counts = await prisma.reconciliationResult.groupBy({
    by: ['status'],
    where: { sessionId },
    _count: { _all: true },
  });

  const partials = await prisma.reconciliationResult.findMany({
    where: { sessionId, status: { in: ['PARTIAL_MATCH', 'NEEDS_REVIEW', 'UNMATCHED'] } },
    include: { kdvRecord: true, image: true },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });

  console.log(JSON.stringify({
    summary,
    counts,
    backupDir,
    issues: partials.map((row) => ({
      status: row.status,
      score: row.matchScore,
      record: row.kdvRecord
        ? {
            belgeNo: row.kdvRecord.belgeNo,
            date: row.kdvRecord.belgeDate?.toISOString().slice(0, 10),
            kdv: row.kdvRecord.kdvTutari?.toString(),
            oran: row.kdvRecord.kdvOrani?.toString(),
          }
        : null,
      image: row.image
        ? {
            name: row.image.originalName,
            belgeNo: row.image.confirmedBelgeNo || row.image.ocrBelgeNo,
            date: row.image.confirmedDate || row.image.ocrDate,
            kdv: row.image.confirmedKdvTutari || row.image.ocrKdvTutari,
          }
        : null,
      reasons: row.mismatchReasons,
    })),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
