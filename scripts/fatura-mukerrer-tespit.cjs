#!/usr/bin/env node
/**
 * MÜKERRER BELGE TESPİTİ (SALT OKUMA) — 2026-09-25 denetim bulgusu 4 hazırlığı.
 *
 * Ne yapar: invoice_accounting_documents tablosunda aynı mükellefte aynı (yön, belge no, satıcı VKN)
 * üçlüsüne sahip belge gruplarını sayar; ayrıca satıcı VKN'si BOŞ olan ve belge numarası birden çok
 * belgede geçen kayıtları ayrı listeler.
 *
 * Neden gerekli: Bulgu 4'ün kalıcı çözümü şemaya
 *   @@unique([tenantId, taxpayerId, invoiceKind, belgeNo, sellerVkn])
 * eklemektir. Ama mevcut veride çift kayıt varsa migration P2002 ile PATLAR. Bu yüzden kısıt
 * eklenmeden ÖNCE çiftlerin sayısı ve niteliği bilinmeli. Bu betik o ölçümü yapar.
 *
 * GÜVENLİK: Yalnız SELECT çalıştırır. Hiçbir kayıt değiştirmez/silmez. Çıktı özet + örnek satırlardır.
 * Bağlantı apps/api/.env içindeki DATABASE_URL'i kullanır (canlı veritabanı) — çalıştırmadan önce
 * sahibin onayı alınmalıdır.
 *
 * Kullanım: node scripts/fatura-mukerrer-tespit.cjs [--ornek 20]
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

// dotenv kök node_modules'ta olmayabilir → api paketinden yükle, o da yoksa .env'i elle oku.
(() => {
  const envYol = path.join(ROOT, 'apps', 'api', '.env');
  try {
    require(path.join(ROOT, 'apps', 'api', 'node_modules', 'dotenv')).config({ path: envYol });
    if (process.env.DATABASE_URL) return;
  } catch { /* elle okumaya düş */ }
  try {
    const metin = require('fs').readFileSync(envYol, 'utf8');
    for (const satir of metin.split(/\r?\n/)) {
      const m = satir.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const deger = m[2].trim().replace(/^["']|["']$/g, '');
      if (!(m[1] in process.env)) process.env[m[1]] = deger;
    }
  } catch (e) {
    console.error(`.env okunamadı (${envYol}): ${(e && e.message) || e}`);
  }
})();

const { PrismaClient } = require(path.join(ROOT, 'apps', 'api', 'node_modules', '@prisma', 'client'));

const ornekSayisi = (() => {
  const i = process.argv.indexOf('--ornek');
  const v = i >= 0 ? parseInt(process.argv[i + 1], 10) : NaN;
  return Number.isFinite(v) && v > 0 ? Math.min(v, 200) : 20;
})();

(async () => {
  const prisma = new PrismaClient();
  try {
    console.log('MÜKERRER BELGE TESPİTİ (salt okuma)\n');

    const toplam = await prisma.$queryRawUnsafe(
      'SELECT COUNT(*)::int AS adet FROM invoice_accounting_documents',
    );
    console.log(`Toplam belge: ${toplam[0].adet}\n`);

    // 1) Tam üçlü çakışma: aynı mükellef + yön + belge no + satıcı VKN
    console.log('1) Aynı (mükellef, yön, belge no, satıcı VKN) — tekillik kısıtını ENGELLEYECEK gruplar');
    const tamCakisma = await prisma.$queryRawUnsafe(`
      SELECT "tenantId", "taxpayerId", "invoiceKind", "belgeNo", "sellerVkn", COUNT(*)::int AS adet
      FROM invoice_accounting_documents
      WHERE "belgeNo" IS NOT NULL AND "belgeNo" <> '' AND "sellerVkn" IS NOT NULL AND "sellerVkn" <> ''
      GROUP BY "tenantId", "taxpayerId", "invoiceKind", "belgeNo", "sellerVkn"
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT ${ornekSayisi}
    `);
    const tamCakismaSayi = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS grup, COALESCE(SUM(adet) - COUNT(*), 0)::int AS fazla FROM (
        SELECT COUNT(*)::int AS adet
        FROM invoice_accounting_documents
        WHERE "belgeNo" IS NOT NULL AND "belgeNo" <> '' AND "sellerVkn" IS NOT NULL AND "sellerVkn" <> ''
        GROUP BY "tenantId", "taxpayerId", "invoiceKind", "belgeNo", "sellerVkn"
        HAVING COUNT(*) > 1
      ) t
    `);
    console.log(`   Çakışan grup: ${tamCakismaSayi[0].grup} · fazla kayıt: ${tamCakismaSayi[0].fazla}`);
    if (tamCakismaSayi[0].grup > 0) {
      console.log('   ⚠ Tekillik kısıtı bu hâliyle EKLENEMEZ — önce bu gruplar incelenip temizlenmeli.');
      for (const r of tamCakisma) {
        console.log(`   · ${r.belgeNo} | VKN ${r.sellerVkn} | ${r.invoiceKind} | mükellef ${r.taxpayerId} → ${r.adet} kayıt`);
      }
    } else {
      console.log('   ✓ Engel yok — kısıt eklenebilir.');
    }

    // 2) Bulgu 4'ün asıl riski: aynı belge no, FARKLI satıcı. Eski kod bunları "aynı kayıt" sayıyordu.
    console.log('\n2) Aynı mükellefte aynı belge no ama FARKLI satıcı VKN (bulgu 4\'ün hedefi)');
    const farkliSatici = await prisma.$queryRawUnsafe(`
      SELECT "taxpayerId", "belgeNo", COUNT(DISTINCT "sellerVkn")::int AS satici, COUNT(*)::int AS adet
      FROM invoice_accounting_documents
      WHERE "belgeNo" IS NOT NULL AND "belgeNo" <> '' AND "sellerVkn" IS NOT NULL AND "sellerVkn" <> ''
      GROUP BY "taxpayerId", "belgeNo"
      HAVING COUNT(DISTINCT "sellerVkn") > 1
      ORDER BY COUNT(DISTINCT "sellerVkn") DESC
      LIMIT ${ornekSayisi}
    `);
    console.log(`   Bulunan: ${farkliSatici.length}${farkliSatici.length === ornekSayisi ? ' (örnek sınırı)' : ''}`);
    for (const r of farkliSatici) {
      console.log(`   · ${r.belgeNo} | ${r.satici} ayrı satıcı | ${r.adet} kayıt | mükellef ${r.taxpayerId}`);
    }
    if (farkliSatici.length) {
      console.log('   → Bu numaralar satıcı bazlıdır; eski belge-no eşleşmesi bunları karıştırabilirdi.');
    }

    // 3) Satıcı VKN boş olan belgeler: eşleşmede belge-no'ya düşülürse risk burada
    console.log('\n3) Satıcı VKN boş, belge no birden çok belgede geçiyor');
    const vknBos = await prisma.$queryRawUnsafe(`
      SELECT "taxpayerId", "belgeNo", COUNT(*)::int AS adet
      FROM invoice_accounting_documents
      WHERE "belgeNo" IS NOT NULL AND "belgeNo" <> '' AND ("sellerVkn" IS NULL OR "sellerVkn" = '')
      GROUP BY "taxpayerId", "belgeNo"
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT ${ornekSayisi}
    `);
    console.log(`   Bulunan: ${vknBos.length}`);
    for (const r of vknBos) console.log(`   · ${r.belgeNo} | ${r.adet} kayıt | mükellef ${r.taxpayerId}`);

    // 4) Aynı ETTN birden çok mükellefte (bulgu 5'in gerçek ölçüsü)
    console.log('\n4) Aynı ETTN (sourceRefId) birden çok MÜKELLEFTE (bulgu 5)');
    const ettnCapraz = await prisma.$queryRawUnsafe(`
      SELECT "sourceRefId", COUNT(DISTINCT "taxpayerId")::int AS mukellef, COUNT(*)::int AS adet
      FROM invoice_accounting_documents
      WHERE "sourceRefId" IS NOT NULL AND "sourceRefId" <> ''
      GROUP BY "sourceRefId"
      HAVING COUNT(DISTINCT "taxpayerId") > 1
      ORDER BY COUNT(DISTINCT "taxpayerId") DESC
      LIMIT ${ornekSayisi}
    `);
    console.log(`   Bulunan: ${ettnCapraz.length}`);
    for (const r of ettnCapraz) console.log(`   · ${r.sourceRefId} | ${r.mukellef} mükellef | ${r.adet} kayıt`);
    if (ettnCapraz.length) {
      console.log('   → Aynı ETTN iki mükellefte gerçekten var: bulgu 5 varsayım değil.');
    }

    // 5) Bulgu 11'in olası izi: kodu boş ama kaynağı dolu satırlar
    console.log('\n5) Hesap kodu boş ama kaynağı dolu satırlar (bulgu 11\'in olası izi — kesin kanıt değil)');
    const kodsuz = await prisma.$queryRawUnsafe(`
      SELECT "kaynak", COUNT(*)::int AS adet
      FROM invoice_accounting_lines
      WHERE "accountCode" IS NULL AND "kaynak" IS NOT NULL AND "kaynak" <> ''
      GROUP BY "kaynak"
      ORDER BY COUNT(*) DESC
    `);
    for (const r of kodsuz) console.log(`   · kaynak=${r.kaynak} → ${r.adet} satır`);
    console.log('   NOT: Aynı deseni yazma anındaki plan kapısı da üretir; iki sebep ayırt edilemez.');
    console.log('        kaynak=KULLANICI satırları varsa elle girilen kodun silinmiş olma ihtimali yüksektir.');

    console.log('\nBitti. Hiçbir kayıt değiştirilmedi.');
  } catch (e) {
    console.error(`HATA: ${(e && e.message) || e}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
})();
