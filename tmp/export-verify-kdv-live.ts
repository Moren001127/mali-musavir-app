import { PrismaClient } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { KdvControlService } from '../apps/api/src/kdv-control/kdv-control.service';
import { ExcelParserService } from '../apps/api/src/kdv-control/excel-parser.service';
import { ReconciliationEngine } from '../apps/api/src/kdv-control/reconciliation.engine';

const prisma = new PrismaClient();
const sessionId = process.env.KDV_SESSION_ID || 'cmpavghpa007ovfjf7aakksdj';
const outputPath = process.env.KDV_VERIFY_OUTPUT ||
  'C:/Users/moren/OneDrive/Desktop/kdv-kontrol-2026-04-BILANCO_SATIS-FARK-DOGRULANDI.xlsx';

async function main() {
  const session = await prisma.kdvControlSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const service = new KdvControlService(
    prisma as any,
    {} as any,
    new ExcelParserService(),
    {} as any,
    new ReconciliationEngine(prisma as any),
    {} as any,
    {} as any,
    { createEvent: async () => null } as any,
  );

  const stats = await service.getSessionStats(sessionId, session.tenantId);
  const buffer = await service.exportResultsToExcel(sessionId, session.tenantId, { autoArchive: false });
  await writeFile(outputPath, buffer);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const ws = wb.getWorksheet('KDV Kontrol');
  if (!ws) throw new Error('KDV Kontrol sheet not found');

  const header = ws.getCell('H15').value;
  const nonZeroFark: any[] = [];
  const dataLastRow = 15 + Number(stats.totalRecords || 0);
  for (let rowNum = 16; rowNum <= dataLastRow; rowNum++) {
    const row = ws.getRow(rowNum);
    const farkCell: any = row.getCell(8).value;
    const fark = typeof farkCell === 'object' && farkCell !== null && 'result' in farkCell
      ? Number(farkCell.result)
      : Number(farkCell || 0);
    if (Number.isFinite(fark) && Math.abs(fark) > 0.011) {
      nonZeroFark.push({
        rowNum,
        lucaDate: row.getCell(2).value,
        lucaNo: row.getCell(3).value,
        lucaKdv: row.getCell(4).value,
        faturaNo: row.getCell(6).value,
        faturaKdv: row.getCell(7).value,
        fark,
        durum: row.getCell(9).value,
        aciklama: row.getCell(10).value,
      });
    }
  }

  console.log(JSON.stringify({
    outputPath: path.normalize(outputPath),
    stats: {
      totalRecords: stats.totalRecords,
      totalImages: stats.totalImages,
      matched: stats.matched,
      partialMatch: stats.partialMatch,
      unmatched: stats.unmatched,
      needsReview: stats.needsReview,
      seriUyarilari: stats.seriUyarilari,
    },
    headerH15: header,
    nonZeroFark,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
