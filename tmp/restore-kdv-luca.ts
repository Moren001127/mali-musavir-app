import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { ExcelParserService } from '../apps/api/src/kdv-control/excel-parser.service';
import { ReconciliationEngine } from '../apps/api/src/kdv-control/reconciliation.engine';

const prisma = new PrismaClient();
const sessionId = 'cmpavghpa007ovfjf7aakksdj';
const repoRoot = path.resolve(__dirname, '..');
const backupPath = path.join(
  repoRoot,
  'tmp/kdv-recovery-20260518-124149/cmpavghpa007ovfjf7aakksdj-before-recompute.json',
);

function normalizeKey(value: string) {
  return String(value || '')
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function pick(raw: any, patterns: string[]) {
  const keys = Object.keys(raw || {});
  for (const pattern of patterns) {
    const normalizedPattern = normalizeKey(pattern);
    const key = keys.find((k) => normalizeKey(k).includes(normalizedPattern));
    if (key && raw[key] != null && String(raw[key]).trim() !== '') return raw[key];
  }
  return null;
}

async function main() {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const outDir = path.join(repoRoot, 'tmp', `kdv-live-luca-restore-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  const current = {
    backedUpAt: new Date().toISOString(),
    sessionId,
    session: await prisma.kdvControlSession.findUnique({ where: { id: sessionId } }),
    records: await prisma.kdvRecord.findMany({ where: { sessionId } }),
    results: await prisma.reconciliationResult.findMany({ where: { sessionId } }),
    jobs: await (prisma as any).lucaFetchJob.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  };
  fs.writeFileSync(path.join(outDir, 'before-restore.json'), JSON.stringify(current, null, 2));

  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  const excel = new ExcelParserService();
  const rows = (backup.records || []).map((record: any) => {
    const raw = record.rawData || {};
    const aciklamaRaw = pick(raw, ['aciklama', 'iklama']) ?? record.karsiTaraf ?? null;
    const hesapKoduRaw = pick(raw, ['hesap kodu']) ?? record.aciklama ?? null;
    const rawDate = pick(raw, ['tarih', 'tar']) ?? record.belgeDate ?? null;
    const belgeNo =
      excel.extractBelgeNoFromDescription(aciklamaRaw) ||
      (record.belgeNo ? String(record.belgeNo).trim() : null);
    const parsedDate =
      excel.parseDate(rawDate, { expectedYear: 2026, expectedMonth: 4 }) ||
      (record.belgeDate ? new Date(record.belgeDate) : null);
    const kdvOrani = hesapKoduRaw
      ? excel.extractKdvOraniFromHesapKodu(String(hesapKoduRaw))
      : record.kdvOrani == null
        ? null
        : Number(record.kdvOrani);

    return {
      id: record.id,
      sessionId,
      rowIndex: Number(record.rowIndex || 0),
      belgeNo,
      belgeDate: parsedDate,
      karsiTaraf: aciklamaRaw == null ? null : String(aciklamaRaw),
      kdvMatrahi: record.kdvMatrahi == null ? null : record.kdvMatrahi,
      kdvTutari: record.kdvTutari,
      kdvOrani: kdvOrani == null ? null : kdvOrani,
      aciklama: hesapKoduRaw == null ? null : String(hesapKoduRaw),
      rawData: raw,
      createdAt: record.createdAt ? new Date(record.createdAt) : new Date(),
    };
  });

  const existing = await prisma.kdvRecord.count({ where: { sessionId } });
  if (existing > 0) throw new Error(`Restore iptal: session'da zaten ${existing} Luca satiri var`);

  await prisma.kdvRecord.createMany({ data: rows as any, skipDuplicates: true });

  const reconciliation = new ReconciliationEngine(prisma as any);
  const summary = await reconciliation.runReconciliation(sessionId);
  await prisma.kdvControlSession.update({ where: { id: sessionId }, data: { status: 'REVIEWING' } });

  const activeJob = await (prisma as any).lucaFetchJob.findFirst({
    where: { sessionId, status: { in: ['pending', 'running'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (activeJob) {
    const time = new Date().toLocaleTimeString('tr-TR', { hour12: false, timeZone: 'Europe/Istanbul' });
    const prev = String(activeJob.errorMsg || '');
    const line = `[${time}] Koruma: job Luca klasik ekraninda takildi; mevcut Luca satirlari backup'tan geri yuklendi, job iptal edildi`;
    await (prisma as any).lucaFetchJob.update({
      where: { id: activeJob.id },
      data: {
        status: 'cancelled',
        finishedAt: new Date(),
        errorMsg: prev ? `${prev}\n${line}` : line,
      },
    });
  }

  const after = {
    records: await prisma.kdvRecord.count({ where: { sessionId } }),
    images: await prisma.receiptImage.count({ where: { sessionId } }),
    results: await prisma.reconciliationResult.count({ where: { sessionId } }),
    summary,
    activeJobCancelled: activeJob?.id || null,
    backupDir: outDir,
    samples: await prisma.kdvRecord.findMany({
      where: {
        sessionId,
        belgeNo: { in: ['0622', '0647', 'AKG2026000000097', 'GKN2026000000038'] },
      },
      orderBy: { rowIndex: 'asc' },
      select: { rowIndex: true, belgeNo: true, belgeDate: true, kdvTutari: true, kdvOrani: true },
    }),
  };
  console.log(JSON.stringify(after, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
