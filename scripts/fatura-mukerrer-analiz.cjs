#!/usr/bin/env node
/**
 * MÜKERRER GRUP ANALİZİ (SALT OKUMA) — 2026-09-25 denetim bulgusu 4, şema kısıtı kararı için.
 *
 * fatura-mukerrer-tespit.cjs "kaç grup var" diyor; bu betik "bu gruplar GERÇEKTEN mükerrer mi"
 * sorusunu yanıtlar. Aynı (mükellef, yön, belge no, satıcı VKN) grubundaki belgeleri yan yana koyup
 * sınıflandırır:
 *
 *   MÜKERRER   : tarih AYNI + tutar AYNI → aynı belge iki kez girilmiş.
 *   MEŞRU      : tarih FARKLI → fiş/belge numarası satıcı bazlı tekrar ediyor (ÖKC fişlerinde olağan).
 *                Bu gruplar varsa tekillik kısıtına FATURA TARİHİ de girmelidir.
 *   İNCELE     : tarih aynı, tutar farklı (ya da tarih boş) → elle bakmak gerekir.
 *
 * Ayrıca her kopyanın Luca durumunu yazar: iki kopya da POSTED ise Luca'da ÇİFT FİŞ vardır.
 *
 * GÜVENLİK: Yalnız SELECT. Hiçbir kayıt değiştirilmez.
 * Kullanım: node scripts/fatura-mukerrer-analiz.cjs   (canlı için: railway run ... ile)
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

(() => {
  const envYol = path.join(ROOT, 'apps', 'api', '.env');
  try {
    require(path.join(ROOT, 'apps', 'api', 'node_modules', 'dotenv')).config({ path: envYol });
    if (process.env.DATABASE_URL) return;
  } catch { /* elle oku */ }
  try {
    const metin = require('fs').readFileSync(envYol, 'utf8');
    for (const satir of metin.split(/\r?\n/)) {
      const m = satir.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* yoksay */ }
})();

const { PrismaClient } = require(path.join(ROOT, 'apps', 'api', 'node_modules', '@prisma', 'client'));

const gun = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const para = (v) => (v == null ? '—' : Number(v).toLocaleString('tr-TR', { minimumFractionDigits: 2 }));

(async () => {
  const prisma = new PrismaClient();
  try {
    const gruplar = await prisma.$queryRawUnsafe(`
      SELECT "taxpayerId", "invoiceKind", "belgeNo", "sellerVkn", COUNT(*)::int AS adet
      FROM invoice_accounting_documents
      WHERE "belgeNo" IS NOT NULL AND "belgeNo" <> '' AND "sellerVkn" IS NOT NULL AND "sellerVkn" <> ''
      GROUP BY "tenantId", "taxpayerId", "invoiceKind", "belgeNo", "sellerVkn"
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
    `);
    console.log(`MÜKERRER GRUP ANALİZİ — ${gruplar.length} grup\n`);

    const mukellefler = await prisma.$queryRawUnsafe('SELECT id, "unvan" FROM taxpayers').catch(() => []);
    const adOf = new Map((mukellefler || []).map((t) => [t.id, t.unvan || t.id]));

    const sayac = { MUKERRER: 0, MESRU: 0, INCELE: 0 };
    const luca = { ciftPosted: 0, birPosted: 0, hicbiri: 0 };
    const detay = [];

    for (const g of gruplar) {
      const belgeler = await prisma.$queryRawUnsafe(`
        SELECT id, "faturaTarihi", "totalAmount", "lucaStatus", "status", "source", "createdAt", "documentType"
        FROM invoice_accounting_documents
        WHERE "taxpayerId" = $1 AND "invoiceKind" = $2 AND "belgeNo" = $3 AND "sellerVkn" = $4
        ORDER BY "createdAt" ASC
      `, g.taxpayerId, g.invoiceKind, g.belgeNo, g.sellerVkn);

      const tarihler = new Set(belgeler.map((b) => gun(b.faturaTarihi)));
      const tutarlar = new Set(belgeler.map((b) => String(b.totalAmount ?? '')));
      const tarihBos = belgeler.some((b) => !b.faturaTarihi);

      let sinif;
      if (tarihler.size > 1) sinif = 'MESRU';
      else if (!tarihBos && tutarlar.size === 1) sinif = 'MUKERRER';
      else sinif = 'INCELE';
      sayac[sinif]++;

      const postedAdet = belgeler.filter((b) => ['POSTED', 'MANUAL_DONE'].includes(String(b.lucaStatus))).length;
      if (postedAdet > 1) luca.ciftPosted++;
      else if (postedAdet === 1) luca.birPosted++;
      else luca.hicbiri++;

      detay.push({ g, belgeler, sinif, postedAdet });
    }

    console.log('SINIFLANDIRMA');
    console.log(`  MEŞRU (tarih farklı — fiş no tekrarı)   : ${sayac.MESRU}`);
    console.log(`  MÜKERRER (tarih+tutar aynı)             : ${sayac.MUKERRER}`);
    console.log(`  İNCELE (tarih aynı/boş, tutar farklı)   : ${sayac.INCELE}`);
    console.log('\nLUCA DURUMU (grup başına)');
    console.log(`  İki+ kopya Luca'da (ÇİFT FİŞ RİSKİ)     : ${luca.ciftPosted}`);
    console.log(`  Tek kopya Luca'da                       : ${luca.birPosted}`);
    console.log(`  Hiçbiri Luca'da değil                   : ${luca.hicbiri}`);

    for (const sinif of ['MUKERRER', 'INCELE', 'MESRU']) {
      const liste = detay.filter((d) => d.sinif === sinif);
      if (!liste.length) continue;
      console.log(`\n═══ ${sinif} (${liste.length} grup) ═══`);
      for (const d of liste.slice(0, sinif === 'MESRU' ? 8 : 40)) {
        const ad = adOf.get(d.g.taxpayerId) || d.g.taxpayerId;
        console.log(`\n  ${d.g.belgeNo} · VKN ${d.g.sellerVkn} · ${d.g.invoiceKind} · ${ad}${d.postedAdet > 1 ? '  ⚠ LUCA\'DA ÇİFT' : ''}`);
        for (const b of d.belgeler) {
          console.log(`    - ${gun(b.faturaTarihi)} | ${para(b.totalAmount)} ₺ | ${b.documentType || '—'} | ${b.status}/${b.lucaStatus} | ${b.source || '—'} | girildi ${gun(b.createdAt)}`);
        }
      }
      if (sinif === 'MESRU' && liste.length > 8) console.log(`\n  … ve ${liste.length - 8} grup daha (aynı desen)`);
    }

    console.log('\n── KISIT KARARI İÇİN SONUÇ ──');
    if (sayac.MESRU > 0) {
      console.log(`  ${sayac.MESRU} grup MEŞRU → (mükellef, yön, belge no, satıcı VKN) kısıtı bu kayıtları REDDEDERDİ.`);
      console.log('  Kısıta FATURA TARİHİ eklenmeli.');
    }
    const kalan = sayac.MUKERRER + sayac.INCELE;
    console.log(`  Tarih eklendikten sonra engel kalır mı: ${kalan > 0 ? `EVET — ${kalan} grup (önce bunlar temizlenmeli)` : 'HAYIR, kısıt eklenebilir'}`);
    console.log('\nBitti. Hiçbir kayıt değiştirilmedi.');
  } catch (e) {
    console.error(`HATA: ${(e && e.message) || e}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
})();
