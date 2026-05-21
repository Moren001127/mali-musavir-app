import { PrismaClient } from '@prisma/client';
import { ReconciliationEngine } from '../apps/api/src/kdv-control/reconciliation.engine';

const prisma = new PrismaClient();
const sessionId = process.env.KDV_SESSION_ID || 'cmpavghpa007ovfjf7aakksdj';

async function main() {
  const engine = new ReconciliationEngine(prisma as any) as any;
  const docs = ['0619', '0622', 'AKG2026000000097', 'GKN2026000000038'];
  for (const doc of docs) {
    const records = await prisma.kdvRecord.findMany({
      where: { sessionId, belgeNo: { contains: doc } },
      orderBy: { rowIndex: 'asc' },
    });
    const image = await prisma.receiptImage.findFirst({
      where: {
        sessionId,
        OR: [
          { originalName: { contains: doc } },
          { ocrBelgeNo: { contains: doc } },
          { confirmedBelgeNo: { contains: doc } },
        ],
      },
      orderBy: { originalName: 'asc' },
    });
    console.log(`\nDOC ${doc}`);
    console.log('image', image && {
      id: image.id,
      name: image.originalName,
      belge: image.confirmedBelgeNo || image.ocrBelgeNo,
      date: image.confirmedDate || image.ocrDate,
      kdv: image.confirmedKdvTutari || image.ocrKdvTutari,
      breakdown: image.confirmedKdvBreakdown || image.ocrKdvBreakdown,
    });
    for (const record of records) {
      const score = image ? engine.calculateScore(record, image, null, null, false, null, false, false) : null;
      console.log('record', {
        id: record.id,
        rowIndex: record.rowIndex,
        belgeNo: record.belgeNo,
        date: record.belgeDate?.toISOString(),
        kdv: record.kdvTutari?.toString(),
        oran: record.kdvOrani?.toString(),
        aciklama: record.aciklama,
        sameBelgeNo: image ? engine.sameBelgeNo(record.belgeNo || '', image.confirmedBelgeNo || image.ocrBelgeNo || '') : null,
        parsedDate: image ? engine.parseTrDate(image.confirmedDate || image.ocrDate || '') : null,
        score,
      });
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
