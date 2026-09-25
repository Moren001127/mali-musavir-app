#!/usr/bin/env node
/**
 * OTOMASYON ADIMINA onError:'continue' ISARETLE (portal denetimi bulgu 31 ardili).
 *
 * Bulgu 31 ile "hatali adimdan sonra DUR" varsayilan oldu. Bu dogru varsayilan ama
 * "Evraklar Hazir -> Fatura Cek & Drive'a Yedekle" akisinda istenmeyen bir yan etki
 * yaratiyordu: cekim patlayinca (son 20 kismi kosunun 4'u) Drive yedegi de calismiyordu.
 * Oysa daha once indirilmis belgelerin yedegi cekimden bagimsiz alinmali.
 *
 * Bu betik YALNIZ `fetch_invoices_for_period` -> `backup_to_drive` sirasindaki yedek
 * adimini isaretler. Baska hicbir alana dokunmaz. VARSAYILAN KURU CALISMA.
 *
 * Muzaffer Bey 25.09.2026'da onayladi; ayni gun uygulandi (1 otomasyon, 1 adim).
 *
 * Calistirma (apps/api icinden):
 *   railway run --service Postgres sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" node ../../scripts/otomasyon-onerror-isaretle.cjs'
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const UYGULA = process.argv.includes('--uygula');
(async () => {
  const list = await p.automation.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, title: true, steps: true },
  });
  let degisecek = [];
  for (const a of list) {
    const blob = a.steps || {};
    const st = Array.isArray(blob.steps) ? blob.steps : [];
    // Hedef: fetch_invoices_for_period'dan SONRA gelen backup_to_drive adimi.
    const idx = st.findIndex((s, i) => s && s.tool === 'backup_to_drive' && i > 0 && st[i-1] && st[i-1].tool === 'fetch_invoices_for_period');
    if (idx < 0) continue;
    if (st[idx].onError === 'continue') { console.log(`  zaten isaretli: ${a.title}`); continue; }
    degisecek.push({ a, idx, blob, st });
  }
  if (!degisecek.length) { console.log('Degisecek adim yok.'); return; }
  console.log(`${degisecek.length} otomasyonda adim isaretlenecek:\n`);
  for (const d of degisecek) {
    console.log(`  ${d.a.title}`);
    console.log(`    adim ${d.idx}: ${d.st[d.idx].tool} (id: ${d.st[d.idx].id || '-'})  onError: ${d.st[d.idx].onError || '(yok -> stop)'} -> 'continue'`);
    console.log(`    tum adimlar: ${d.st.map(s => s.tool).join(' -> ')}`);
  }
  if (!UYGULA) { console.log('\n>>> KURU CALISMA. Hicbir sey yazilmadi. Uygulamak icin: --uygula'); return; }
  for (const d of degisecek) {
    const yeni = d.st.map((s, i) => (i === d.idx ? { ...s, onError: 'continue' } : s));
    await p.automation.update({ where: { id: d.a.id }, data: { steps: { ...d.blob, steps: yeni } } });
    console.log(`  ✓ ${d.a.title}: adim ${d.idx} isaretlendi`);
  }
  console.log('\nBitti. Baska alana dokunulmadi.');
  await p.$disconnect();
})().catch(e => { console.error(e.message.slice(0,300)); process.exit(1); });
