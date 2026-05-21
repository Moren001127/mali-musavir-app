import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const sessionId = process.env.KDV_SESSION_ID || 'cmpavghpa007ovfjf7aakksdj';

function parse(no: string): { prefix: string; num: number; cleaned: string } | null {
  const cleaned = no.trim().toUpperCase();
  const m = cleaned.match(/^(.*?)(\d+)$/);
  if (!m) return null;
  return { prefix: m[1], num: parseInt(m[2], 10), cleaned };
}

async function main() {
  const session = await prisma.kdvControlSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error('session not found');
  const records = await prisma.kdvRecord.findMany({
    where: { sessionId, belgeNo: { not: null } },
    select: { belgeNo: true, belgeDate: true, kdvTutari: true, kdvOrani: true, rawData: true },
    orderBy: [{ belgeDate: 'asc' }, { rowIndex: 'asc' }],
  });
  const grouped: Record<string, Array<{ no: string; num: number; date: string | null; kdv: string; rate: string | null }>> = {};
  for (const r of records) {
    const p = parse(String(r.belgeNo || ''));
    if (!p) continue;
    if (!grouped[p.prefix]) grouped[p.prefix] = [];
    grouped[p.prefix].push({
      no: String(r.belgeNo),
      num: p.num,
      date: r.belgeDate?.toISOString().slice(0, 10) || null,
      kdv: r.kdvTutari.toString(),
      rate: r.kdvOrani?.toString() || null,
    });
  }

  const warnings: any[] = [];
  for (const [prefix, rows] of Object.entries(grouped)) {
    const nums = rows.map((row) => row.num);
    const sorted = [...new Set(nums)].sort((a, b) => a - b);
    const missing: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      for (let n = sorted[i - 1] + 1; n < sorted[i]; n++) missing.push(n);
    }
    warnings.push({
      prefix: prefix || '(empty)',
      countRows: rows.length,
      unique: sorted.length,
      first: sorted[0],
      last: sorted[sorted.length - 1],
      missingCount: missing.length,
      missingFirst: missing.slice(0, 15),
      examples: rows.slice(0, 12),
    });
  }

  console.log(JSON.stringify({ session, warnings }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
