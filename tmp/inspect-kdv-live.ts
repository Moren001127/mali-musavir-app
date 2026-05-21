import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const sessionId = process.env.KDV_SESSION_ID || 'cmpavghpa007ovfjf7aakksdj';

function money(value: any): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickJson(value: any) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.slice(0, 4);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 8));
  }
  return value;
}

async function main() {
  const session = await prisma.kdvControlSession.findUnique({
    where: { id: sessionId },
    include: { taxpayer: true },
  });
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const [records, images, results, jobs, outputs] = await Promise.all([
    prisma.kdvRecord.findMany({
      where: { sessionId },
      orderBy: [{ rowIndex: 'asc' }, { createdAt: 'asc' }],
      take: 120,
    }),
    prisma.receiptImage.findMany({
      where: { sessionId },
      orderBy: { originalName: 'asc' },
      take: 120,
    }),
    prisma.reconciliationResult.findMany({
      where: { sessionId },
      include: { kdvRecord: true, image: true },
      orderBy: { createdAt: 'asc' },
      take: 220,
    }),
    prisma.lucaFetchJob.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.kdvControlOutput.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: 3,
    }),
  ]);

  const resultStatus = results.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});

  const sampleDocs = ['0619', '0622', '0647', '0635', 'AKG2026000000097', 'GKN2026000000038'];
  const recordSamples = records
    .filter((row) => sampleDocs.some((doc) => String(row.belgeNo || '').includes(doc)))
    .map((row) => ({
      id: row.id,
      rowIndex: row.rowIndex,
      belgeNo: row.belgeNo,
      belgeDate: row.belgeDate?.toISOString().slice(0, 10),
      kdvTutari: money(row.kdvTutari),
      kdvOrani: money(row.kdvOrani),
      aciklama: row.aciklama,
      rawData: pickJson(row.rawData),
    }));

  const imageSamples = images
    .filter((row) =>
      sampleDocs.some((doc) =>
        [
          row.originalName,
          row.ocrBelgeNo,
          row.confirmedBelgeNo,
          row.ocrRawText,
        ]
          .filter(Boolean)
          .join(' ')
          .includes(doc),
      ),
    )
    .map((row) => ({
      id: row.id,
      originalName: row.originalName,
      belgeNo: row.confirmedBelgeNo || row.ocrBelgeNo,
      date: row.confirmedDate || row.ocrDate,
      kdv: row.confirmedKdvTutari || row.ocrKdvTutari,
      engine: row.ocrEngine,
      status: row.ocrStatus,
      breakdown: pickJson(row.confirmedKdvBreakdown || row.ocrKdvBreakdown),
    }));

  const resultSamples = results.slice(0, 12).map((row) => ({
    status: row.status,
    score: row.matchScore,
    record: row.kdvRecord
      ? {
          belgeNo: row.kdvRecord.belgeNo,
          date: row.kdvRecord.belgeDate?.toISOString().slice(0, 10),
          kdv: money(row.kdvRecord.kdvTutari),
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
  }));

  console.log(JSON.stringify(
    {
      session: {
        id: session.id,
        status: session.status,
        type: session.type,
        periodLabel: session.periodLabel,
        taxpayer: session.taxpayer?.name,
        tenantId: session.tenantId,
      },
      counts: {
        records: await prisma.kdvRecord.count({ where: { sessionId } }),
        images: await prisma.receiptImage.count({ where: { sessionId } }),
        results: await prisma.reconciliationResult.count({ where: { sessionId } }),
      },
      resultStatus,
      jobs: jobs.map((job) => ({
        id: job.id,
        status: job.status,
        recordCount: job.recordCount,
        errorMsg: job.errorMsg,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
      })),
      outputs: outputs.map((output) => ({
        id: output.id,
        matchedCount: output.matchedCount,
        partialCount: output.partialCount,
        unmatchedCount: output.unmatchedCount,
        totalRecords: output.totalRecords,
        totalImages: output.totalImages,
        filename: output.filename,
        createdAt: output.createdAt,
      })),
      recordSamples,
      imageSamples,
      resultSamples,
    },
    null,
    2,
  ));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
