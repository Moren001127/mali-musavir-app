#!/usr/bin/env node
/**
 * MÜKERRER / GÖRSEL BENZERLİK + GERİ AL regresyonu — PLAN/16 §C ve §G (2026-09-12).
 *   apps/api/src/fatura-muhasebelestirme/{gorsel-hash,mukerrer-fis,uyari-katmani}.ts + service
 *   (findDuplicate, uploadAndOcr "zaten yüklü", createDocumentFromProviderXml ETTN, revalidateDocument
 *   MUKERRER_FIS/MUKERRER_GORSEL, approveBatch şüphe atlama, reopen/lucaElleDuzeltildi/approve MANUAL_DONE)
 *   + vendor-memory.service revertDecision.
 *
 * Kilitler:
 *   1) dHash saf: bilinen piksel dizisi → sabit hex; aynı → Hamming 0; tek bit → 1; geçersiz → Infinity; eşik 6.
 *   2) sharp ile gerçek görsel: aynı/PNG yeniden-kodlama → 0; gürültülü+karanlık → ≤ 6; hafif kırpık → ≤ 6;
 *      90° döndürülmüş → > 6 (farklı sayılır); bambaşka fiş → > 6; PDF çöpü → null (hata yutulur).
 *   3) Fiş eşleşme anahtarı: uzun no → 'uzun' (tutar/gün şartsız); kısa no → 'kisa' (gün + tutar şart, yoksa null);
 *      no yok → 'saat' (VKN + gün + saat + tutar; saat yoksa null); yer tutucu/uuid → no yok sayılır; VKN geçersiz → null.
 *      saatAyikla: "SAAT: 18:30" / "05.08.2026 18:30" / "18:30:45" / geçersiz 25:70 → null. ettnAyikla: UBL UUID; JPEG → null.
 *   4) revalidate: kısa fiş no + aynı gün → MUKERRER_FIS (uyarı, ENGEL DEĞİL, status OK, duplicateSeverity WARNING,
 *      uyariOzet.mukerrerSuphe); sahip 'mukerrer' teyidi → MUKERRER engel + INVALID; 'mukerrer_degil' → hiçbiri.
 *      fiş no yok + aynı VKN/gün/saat/tutar → MUKERRER_FIS (tur saat); saat farklı → yok.
 *      imagePhash Hamming ≤ 6 (daha eski belge) → MUKERRER_GORSEL uyarı (meta.hamming, ilkBelgeId); ilk belge temiz;
 *      Hamming 20 → yok; farklı yön → yok.
 *   5) uploadAndOcr: SHA-256 aynı dosya (aynı mükellef) → belge OLUŞMAZ, depoya yazılmaz, {created:false, zatenYuklu:true,
 *      mevcutId, mesaj 'Zaten yüklü: belge X (tarih)', atlananlar[1], skipped[1]}; yeni dosya → belge oluşur + imagePhash dolu.
 *   6) createDocumentFromProviderXml: ETTN mevcut belgeyle eşleşince {created:false, zatenYuklu:true, document=mevcut}.
 *   7) approveBatch: MUKERRER_GORSEL/MUKERRER_FIS uyarılı belge toplu onayda 'mukerrer-suphe' ile atlanır (force geçirir).
 *   8) reopen: APPROVED/QUEUED → NEEDS_REVIEW + NOT_STARTED + satırlar korunur + revertDecision (boost) + ogrenmeKayitlari
 *      temizlenir (ikinci geri alma reddedilir → idempotent); POSTING → 400; POSTED onay yok → 409 {teyitGerekli, lucaFisNo};
 *      POSTED onay:true → lucaElleDuzeltilecek + eskiLucaFisNo, lucaFisNo kolonu temiz, AuditLog REOPEN alanları;
 *      approve (lucaElleDuzeltilecek) → lucaStatus MANUAL_DONE (Luca'ya gitmez) + ogrenmeKayitlari yazılır;
 *      luca-elle-duzeltildi → bayrak lucaElleDuzeltildi'ye döner, APPROVED ise MANUAL_DONE.
 *   9) revertDecision: onayAdedi boost kadar düşer; 0'a inince silinir; toplamOnay 1 düşer (0 altına inmez).
 *  10) Kaynak metin kilitleri: controller reopen body + luca-elle-duzeltildi + phash-doldur; batchPostToLuca/buildBatchExcel
 *      lucaElleYolu süzgeci; schema imagePhash + migration; package.json zinciri.
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

const gh = require(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/gorsel-hash.ts'));
const mf = require(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/mukerrer-fis.ts'));
const uk = require(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/uyari-katmani.ts'));
const { FaturaMuhasebelestirmeService } = require(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts'));
const { VendorMemoryService } = require(path.join(ROOT, 'apps/api/src/vendor-memory/vendor-memory.service.ts'));

let failed = 0;
function assert(ok, msg) { if (!ok) { failed++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); }

// ── Basit Prisma taklidi: where eşleyici (eq / not / in / notIn / gte-lt-lte / startsWith / OR / NOT / json path) ──
function eslesir(doc, where) {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === 'OR') { if (!v.some((w) => eslesir(doc, w))) return false; continue; }
    if (k === 'AND') { if (!v.every((w) => eslesir(doc, w))) return false; continue; }
    if (k === 'NOT') { if (eslesir(doc, v)) return false; continue; }
    const d = doc[k];
    if (v === null) { if (d != null) return false; continue; }
    if (v instanceof Date) { if (!(d instanceof Date) || d.getTime() !== v.getTime()) return false; continue; }
    if (typeof v !== 'object') { if (String(d ?? '') !== String(v)) return false; continue; }
    if ('path' in v) { let cur = d; for (const p of v.path) cur = cur ? cur[p] : undefined; if (String(cur ?? '') !== String(v.equals)) return false; continue; }
    if ('not' in v) { if (v.not === null ? d == null : String(d ?? '') === String(v.not)) return false; }
    if ('in' in v) { if (!v.in.map(String).includes(String(d ?? ''))) return false; }
    if ('notIn' in v) { if (v.notIn.map(String).includes(String(d ?? ''))) return false; }
    if ('equals' in v) { const a = String(d ?? ''), b = String(v.equals); if (v.mode === 'insensitive' ? a.toLowerCase() !== b.toLowerCase() : a !== b) return false; }
    if ('startsWith' in v) { if (!String(d ?? '').startsWith(v.startsWith)) return false; }
    const num = (x) => (x instanceof Date ? x.getTime() : Number(x));
    if ('gte' in v) { if (d == null || num(d) < num(v.gte)) return false; }
    if ('gt' in v) { if (d == null || num(d) <= num(v.gt)) return false; }
    if ('lte' in v) { if (d == null || num(d) > num(v.lte)) return false; }
    if ('lt' in v) { if (d == null || num(d) >= num(v.lt)) return false; }
  }
  return true;
}
function sirala(list, orderBy) {
  if (!orderBy) return list;
  const [[k, dir]] = Object.entries(Array.isArray(orderBy) ? orderBy[0] : orderBy);
  return [...list].sort((a, b) => { const x = a[k] instanceof Date ? a[k].getTime() : a[k]; const y = b[k] instanceof Date ? b[k].getTime() : b[k]; return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1); });
}

function makeService(db = {}) {
  const state = {
    docs: db.docs || [],
    taxpayer: db.taxpayer || null,
    vendorMemory: db.vendorMemory || null,
    updates: [], creates: [], audits: [], raw: [], reverts: [], records: [], storagePuts: [],
  };
  const docTable = {
    findFirst: async ({ where, orderBy }) => sirala(state.docs.filter((d) => eslesir(d, where)), orderBy)[0] || null,
    findMany: async ({ where, orderBy, take }) => sirala(state.docs.filter((d) => eslesir(d, where)), orderBy).slice(0, take || 10000),
    count: async ({ where }) => state.docs.filter((d) => eslesir(d, where)).length,
    update: async ({ where, data }) => { state.updates.push({ id: where.id, data }); const d = state.docs.find((x) => x.id === where.id); if (d) Object.assign(d, data); return d; },
    updateMany: async ({ where, data }) => { const hits = state.docs.filter((d) => eslesir(d, where)); for (const d of hits) { state.updates.push({ id: d.id, data }); Object.assign(d, data); } return { count: hits.length }; },
    create: async ({ data }) => { const d = { id: `yeni${state.creates.length + 1}`, createdAt: new Date(), lines: [], ...data }; state.creates.push(d); state.docs.push(d); return d; },
  };
  const prisma = {
    taxpayer: { findFirst: async () => state.taxpayer },
    vendorMemory: { findUnique: async () => state.vendorMemory },
    vendorMemoryDecision: { findFirst: async () => null, findMany: async () => [] },
    invoiceAccountingDocument: docTable,
    invoiceAccountingLine: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    lucaAccountPlanSnapshot: { findFirst: async () => null },
    lucaAccountPlanLine: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    auditLog: { create: async ({ data }) => { state.audits.push(data); return data; } },
    eFaturaInbox: { updateMany: async () => ({ count: 0 }) },
    $executeRawUnsafe: async (...a) => { state.raw.push(a); },
    $transaction: async (fn) => fn(prisma),
  };
  const storage = { putBuffer: async (k, b) => { state.storagePuts.push(k); }, getBuffer: async () => null, deleteObject: async () => {} };
  const ocr = { computeImageHash: (b) => require('crypto').createHash('sha256').update(b).digest('hex'), extractFromImage: async () => { throw new Error('mock ocr'); } };
  const vendorMemory = {
    recordDecision: async (p) => { state.records.push(p); },
    revertDecision: async (p) => { state.reverts.push(p); return { geriAlindi: true, silindi: false }; },
  };
  const svc = new FaturaMuhasebelestirmeService(prisma, storage, ocr, {}, {}, vendorMemory, {}, {}, {}, {});
  svc.logger = { log() {}, warn() {}, error() {}, debug() {} };
  svc.uploadOcrConcurrency = 0; // arka plan OCR kuyruğu çalışmasın
  // 2026-09-25 (denetim bulgusu 11 sonrası): HESAP PLANI SABİTLENDİ. get() artık plan kapısını
  //   BELLEKTE uyguluyor (eskiden list() bunu kalıcı updateMany ile yapıyordu). Sahte prisma'da plan
  //   snapshot'ı olmadığı için kapı "plan yok" sanıp bütün hesap kodlarını gizliyor ve approve()
  //   "Gelir/gider hesabı boş" diyerek reddediyordu — test gerçek kullanıcı akışını taklit etmiyordu:
  //   ekran her zaman list() çağırır ve ESKİ kod da orada kodları silerdi, yani plansız mükellefte
  //   onay eskiden de reddediliyordu. Fixture kodlarını içeren bir plan verip gerçek akışı kuruyoruz.
  svc.getPlanCodeSet = async () => new Set([
    '770.01.001', '191.01.020', '320.01.001', '191.01.001', '600.01.001',
    '153.01.001', '740.01.001', '760.01.001', '391.01.020', '120.01.001',
  ]);
  if (!svc.planCodeCache) svc.planCodeCache = new Map();
  return { svc, state, prisma };
}
const T0 = new Date('2026-08-01T10:00:00Z');
const TP = { faaliyetAciklama: 'lokanta işletmeciliği', naceKodu: '561001', companyName: 'DEMO LOKANTA LTD', kurumTuru: 'diger', defterTuru: 'BILANCO' };
function fis(over = {}) {
  return {
    id: 'd1', tenantId: 't', taxpayerId: 'tp', invoiceKind: 'ALIS', status: 'READY', lucaStatus: 'NOT_STARTED', documentType: 'OKC_FIS',
    belgeNo: '0049', sellerVkn: '1111111111', buyerVkn: '9999999999', vendorName: 'MARKET AŞ', customerName: null,
    totalAmount: 240, faturaTarihi: new Date('2026-08-05T00:00:00Z'), createdAt: T0, duplicateOfId: null, duplicateReason: null, duplicateSeverity: null,
    ocrData: { matrah: 200, kdvTutari: 40, kdvOrani: 20, kdvBreakdown: [{ oran: 20, matrah: 200, tutar: 40 }], kalemler: [{ ad: 'Yemek', tutar: 200, oran: 20 }], giderTuru: 'yemek', matrahKategori: 'genel_gider' },
    lines: [
      { group: 'matrah', accountCode: '770.01.001', description: 'Genel gider', debit: 200, credit: 0, rate: '%20', kaynak: 'KULLANICI' },
      { group: 'vergi', accountCode: '191.01.020', description: 'İndirilecek KDV %20', debit: 40, credit: 0, rate: '%20' },
      { group: 'cari', accountCode: '320.01.001', description: 'MARKET AŞ', debit: 0, credit: 240, kaynak: 'KULLANICI' },
    ],
    ...over,
  };
}
const uyOf = (state, id = 'd1') => { const d = state.docs.find((x) => x.id === id); return Array.isArray(d.ocrData.uyarilar) ? d.ocrData.uyarilar : []; };
const kodlar = (list) => list.map((u) => u.kod);

(async () => {
  console.log('1) dHash saf fonksiyon');
  {
    // 9x8: her satırda soldan sağa artan → tüm bitler 1 → ffffffffffffffff
    const artan = []; for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) artan.push(x * 10);
    assert(gh.dHashFromGray(artan) === 'ffffffffffffffff', 'artan piksel satırları → ffffffffffffffff');
    const azalan = artan.map((v) => 100 - v);
    assert(gh.dHashFromGray(azalan) === '0000000000000000', 'azalan → 0000000000000000');
    assert(gh.hamming('ffffffffffffffff', '0000000000000000') === 64 && gh.hamming('abcd', 'abcd') === 0 && gh.hamming('0', '1') === 1, 'Hamming: 64 / 0 / 1');
    assert(gh.hamming('abc', 'abcd') === Infinity && gh.hamming('', '') === Infinity && gh.hamming('zz', 'zz') === Infinity, 'geçersiz/uzunluk farklı → Infinity (asla benzer değil)');
    assert(gh.benzerMi('ffffffffffffffff', 'ffffffffffffffc0') === true && gh.benzerMi('ffffffffffffffff', 'ffffffffffffff80') === false, 'eşik 6: 6 bit fark benzer, 7 bit değil');
    const tekBit = [...artan]; tekBit[1] = -5; // satır 0: p[0]=0 < p[1]=-5 yanlış → 1 bit değişir
    assert(gh.hamming(gh.dHashFromGray(artan), gh.dHashFromGray(tekBit)) === 1, 'tek piksel değişimi → Hamming 1');
    let hata = null; try { gh.dHashFromGray(new Uint8Array(10)); } catch (e) { hata = e; }
    assert(!!hata, 'eksik piksel → hata fırlatır');
    assert(gh.phashDenenirMi('image/jpeg') && gh.phashDenenirMi('application/pdf') && !gh.phashDenenirMi('application/xml') && !gh.phashDenenirMi('text/html'), 'phashDenenirMi: görsel/PDF evet, xml/html hayır');
    assert(gh.phashDejenereMi('0000000000000000') && gh.phashDejenereMi('ffffffffffffffff') && !gh.phashDejenereMi('3e2f2f272f37332f'), 'dejenere hash (düz beyaz/siyah) tanınır — mükerrer aramasına girmez');
  }

  console.log('2) sharp ile gerçek görsel');
  let sharp = null;
  try { sharp = require(path.join(ROOT, 'apps/api/node_modules/sharp')); } catch { /* yok */ }
  if (!sharp) {
    console.log('  (sharp bulunamadı — görsel testleri atlandı)');
  } else {
    const W = 600, H = 900;
    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/>
      ${Array.from({ length: 24 }, (_, i) => `<rect x="${40 + (i % 3) * 30}" y="${60 + i * 34}" width="${300 + (i * 37) % 200}" height="14" fill="#222"/>`).join('')}
      <rect x="380" y="700" width="180" height="40" fill="#000"/><circle cx="120" cy="820" r="40" fill="#555"/></svg>`;
    const base = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
    const h0 = await gh.computeImagePhash(base, 'image/jpeg');
    assert(typeof h0 === 'string' && /^[0-9a-f]{16}$/.test(h0), `görselden 16 haneli hex phash (${h0})`);
    const png = await sharp(base).png().toBuffer();
    assert(gh.hamming(h0, await gh.computeImagePhash(png, 'image/png')) === 0, 'PNG yeniden kodlama → Hamming 0');
    const noisy = await sharp(base).modulate({ brightness: 0.85 }).blur(1.2).jpeg({ quality: 55 }).toBuffer();
    const hN = gh.hamming(h0, await gh.computeImagePhash(noisy, 'image/jpeg'));
    assert(hN <= 6, `karanlık + bulanık + düşük kalite → Hamming ${hN} ≤ 6 (aynı fiş)`);
    const cropped = await sharp(base).extract({ left: 12, top: 18, width: W - 30, height: H - 40 }).resize(520).jpeg({ quality: 80 }).toBuffer();
    const hC = gh.hamming(h0, await gh.computeImagePhash(cropped, 'image/jpeg'));
    assert(hC <= 6, `hafif kırpık + küçültülmüş → Hamming ${hC} ≤ 6`);
    const rotated = await sharp(base).rotate(90).jpeg().toBuffer();
    const hR = gh.hamming(h0, await gh.computeImagePhash(rotated, 'image/jpeg'));
    assert(hR > 6, `90° döndürülmüş → Hamming ${hR} > 6 (farklı; EXIF yönü değil fiziksel döndürme)`);
    const svg2 = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/>
      ${Array.from({ length: 24 }, (_, i) => `<rect x="${200 - (i % 4) * 40}" y="${40 + i * 35}" width="${100 + (i * 53) % 350}" height="10" fill="#111"/>`).join('')}
      <rect x="60" y="720" width="300" height="60" fill="#000"/></svg>`;
    const other = await sharp(Buffer.from(svg2)).jpeg().toBuffer();
    const hO = gh.hamming(h0, await gh.computeImagePhash(other, 'image/jpeg'));
    assert(hO > 6, `bambaşka fiş → Hamming ${hO} > 6`);
    assert((await gh.computeImagePhash(Buffer.from('%PDF-1.4 çöp'), 'application/pdf')) === null, 'PDF raster üretilemez → null (hata yutuldu)');
    assert((await gh.computeImagePhash(Buffer.from('<xml/>'), 'application/xml')) === null && (await gh.computeImagePhash(null, 'image/jpeg')) === null, 'XML / boş buffer → null');
  }

  console.log('3) Fiş eşleşme anahtarı + saat + ETTN');
  {
    const uzun = mf.fisEslesmeAnahtari({ belgeNo: 'ABC2026000000123', vkn: '1111111111' });
    assert(uzun && uzun.tur === 'uzun' && uzun.anahtar === 'uzun|1111111111|ABC2026000000123' && uzun.tutar === null, 'uzun belge no → tur uzun (tutar/gün şartsız)');
    const kisa = mf.fisEslesmeAnahtari({ belgeNo: '0049', vkn: '111 111 11 11', tutar: '240,00', tarih: '05.08.2026' });
    assert(kisa && kisa.tur === 'kisa' && kisa.anahtar === 'kisa|1111111111|0049|2026-08-05|240.00', 'kısa fiş no + VKN + tutar + gün → tur kisa (VKN/tutar normalize)');
    assert(mf.fisEslesmeAnahtari({ belgeNo: '0049', vkn: '1111111111', tutar: 240 }) === null && mf.fisEslesmeAnahtari({ belgeNo: '0049', vkn: '1111111111', tarih: new Date() }) === null, 'kısa no: gün ya da tutar yoksa aranmaz (null)');
    const saat = mf.fisEslesmeAnahtari({ belgeNo: 'BILINMIYOR', vkn: '1111111111', tutar: 240, tarih: new Date('2026-08-05T00:00:00Z'), rawText: 'MARKET AŞ\nTARİH: 05.08.2026 SAAT: 18:30\nTOPLAM 240,00' });
    assert(saat && saat.tur === 'saat' && saat.saat === '18:30' && saat.anahtar === 'saat|1111111111|2026-08-05|18:30|240.00', 'belge no yok/yer tutucu → VKN + gün + saat + tutar (saat rawText\'ten)');
    assert(mf.fisEslesmeAnahtari({ belgeNo: '', vkn: '1111111111', tutar: 240, tarih: new Date(), rawText: 'saat yok' }) === null, 'saat bulunamazsa aranmaz');
    assert(mf.fisEslesmeAnahtari({ belgeNo: '22222222-2222-2222-2222-222222222222', vkn: '1111111111', tutar: 240, tarih: new Date(), saat: '9.5' })?.tur === 'saat', 'uuid belge no yer tutucu sayılır; saat "9.5" → 09:05');
    assert(mf.fisEslesmeAnahtari({ belgeNo: 'ABC2026000000123', vkn: '123' }) === null, 'geçersiz VKN → null');
    assert(mf.saatAyikla('SAAT 18.30') === '18:30' && mf.saatAyikla('05/08/2026 8:05 FİŞ') === '08:05' && mf.saatAyikla('x 18:30:45 y') === '18:30' && mf.saatAyikla('25:70') === null && mf.saatAyikla('1.234,56') === null, 'saatAyikla varyantları');
    assert(mf.belgeNoUzunMu('ABC2026000000123') && !mf.belgeNoUzunMu('0049') && mf.belgeNoYerTutucuMu('-') && mf.belgeNoYerTutucuMu('') && !mf.belgeNoYerTutucuMu('0049'), 'belgeNoUzunMu / belgeNoYerTutucuMu');
    assert(mf.gunAnahtari('05.08.2026') === '2026-08-05' && mf.gunAnahtari(new Date('2026-08-05T23:59:00Z')) === '2026-08-05' && mf.gunAnahtari('bozuk') === null, 'gunAnahtari');
    const ar = mf.tutarAraligi(240); assert(ar.gte === 239.99 && ar.lte === 240.01, 'tutarAraligi ±0,01');
    assert(mf.tutarNormalize('1.234,56') === 1234.56 && mf.tutarNormalize(0) === null && mf.tutarNormalize({ toNumber: () => 12.345 }) === 12.35, 'tutarNormalize (TR biçim, Decimal, ≤0 → null)');
    const xml = '<?xml version="1.0"?><Invoice xmlns:cbc="x"><cbc:UBLVersionID>2.1</cbc:UBLVersionID><cbc:ID>ABC2026000000123</cbc:ID><cbc:UUID>ABCDEF12-3456-7890-ABCD-EF1234567890</cbc:UUID></Invoice>';
    assert(mf.ettnAyikla(Buffer.from(xml)) === 'abcdef12-3456-7890-abcd-ef1234567890' && mf.ettnAyikla(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x55, 0x55])) === null && mf.ettnAyikla('<html><body>UUID</body></html>') === null, 'ettnAyikla: UBL UUID küçük harf; JPEG/HTML → null');
    assert(uk.UYARI_KOD.MUKERRER_GORSEL === 'MUKERRER_GORSEL' && uk.UYARI_KOD.MUKERRER_FIS === 'MUKERRER_FIS', 'UYARI_KOD yeni kodlar');
    const oz = uk.uyariOzet([uk.uyariYap({ kod: 'MUKERRER_GORSEL', seviye: 'uyari', baslik: 'a', aciklama: 'b' })]);
    assert(oz.mukerrerSuphe === true && oz.mukerrer === false && oz.engel === false, 'uyariOzet.mukerrerSuphe (şüphe engel değil)');
  }

  console.log('4) revalidate — MUKERRER_FIS / MUKERRER_GORSEL / sahip kararı');
  {
    const ayniGun = makeService({ docs: [fis({ id: 'd0', createdAt: new Date('2026-07-30T10:00:00Z'), faturaTarihi: new Date('2026-08-05T09:00:00Z') }), fis({ id: 'd1', faturaTarihi: new Date('2026-08-05T18:30:00Z') })], taxpayer: TP });
    const v1 = await ayniGun.svc.revalidateDocument('t', 'd1');
    const uF = uyOf(ayniGun.state).find((u) => u.kod === 'MUKERRER_FIS');
    assert(!v1.issues.some((i) => i.code === 'MUKERRER') && v1.status === 'OK', 'kısa fiş no + aynı gün → MUKERRER ENGELİ YOK, status OK');
    assert(uF && uF.seviye === 'uyari' && uF.meta.ilkBelgeId === 'd0' && uF.meta.tur === 'kisa' && uF.eylemler.some((e) => e.id === 'ilk-belgeyi-ac') && uF.eylemler.some((e) => e.id === 'mukerrer:mukerrer_degil'), 'MUKERRER_FIS uyarı (tur kisa, ilkBelgeId, ilk belgeyi aç / mükerrer değil)');
    assert(uk.uyariOzet(uyOf(ayniGun.state)).mukerrerSuphe === true && !uk.uyariOzet(uyOf(ayniGun.state)).mukerrer, 'uyariOzet: şüphe var, kesin mükerrer yok');
    const kol = ayniGun.state.updates.find((u) => u.id === 'd1' && u.data.duplicateOfId === 'd0');
    assert(kol && kol.data.duplicateSeverity === 'WARNING', 'kolon: duplicateOfId d0 + duplicateSeverity WARNING');
    assert(!(await ayniGun.svc.revalidateDocument('t', 'd0')).issues.some((i) => i.code === 'MUKERRER') && !kodlar(uyOf(ayniGun.state, 'd0')).includes('MUKERRER_FIS'), 'ilk (eski) belge temiz');
    // sahip teyidi → engel
    const teyit = makeService({ docs: [fis({ id: 'd0', createdAt: new Date('2026-07-30T10:00:00Z') }), fis({ id: 'd1', ocrData: { ...fis().ocrData, mukerrerKarar: { karar: 'mukerrer' } } })], taxpayer: TP });
    const vT = await teyit.svc.revalidateDocument('t', 'd1');
    const uT = uyOf(teyit.state).find((u) => u.kod === 'MUKERRER');
    assert(vT.status === 'INVALID' && vT.issues.some((i) => i.code === 'MUKERRER' && /teyit/.test(i.message)) && uT && uT.seviye === 'engel' && uT.meta.tur === 'kisa' && !kodlar(uyOf(teyit.state)).includes('MUKERRER_FIS'), "sahip 'mukerrer' teyidi → MUKERRER engel + INVALID (şüphe değil)");
    // mükerrer değil → hiçbiri
    const degil = makeService({ docs: [fis({ id: 'd0', createdAt: new Date('2026-07-30T10:00:00Z') }), fis({ id: 'd1', duplicateOfId: 'd0', duplicateSeverity: 'WARNING', ocrData: { ...fis().ocrData, mukerrerKarar: { karar: 'mukerrer_degil' } } })], taxpayer: TP });
    await degil.svc.revalidateDocument('t', 'd1');
    assert(!kodlar(uyOf(degil.state)).some((k) => /^MUKERRER/.test(k)) && degil.state.docs.find((d) => d.id === 'd1').duplicateOfId === null, "'mukerrer_degil' → MUKERRER_FIS yok, kolon temiz");
    // farklı gün → yok
    const farkli = makeService({ docs: [fis({ id: 'd0', createdAt: new Date('2026-07-30T10:00:00Z'), faturaTarihi: new Date('2026-08-04T09:00:00Z') }), fis({ id: 'd1' })], taxpayer: TP });
    await farkli.svc.revalidateDocument('t', 'd1');
    assert(!kodlar(uyOf(farkli.state)).includes('MUKERRER_FIS'), 'farklı gün → şüphe yok');
    // uzun no → engel (mevcut kural korunur)
    const uzun = makeService({ docs: [fis({ id: 'd0', belgeNo: 'ABC2026000000001', createdAt: new Date('2026-07-30T10:00:00Z'), faturaTarihi: new Date('2026-07-01T00:00:00Z') }), fis({ id: 'd1', belgeNo: 'ABC2026000000001' })], taxpayer: TP });
    const vU = await uzun.svc.revalidateDocument('t', 'd1');
    assert(vU.status === 'INVALID' && uyOf(uzun.state).find((u) => u.kod === 'MUKERRER')?.meta.tur === 'uzun', 'uzun belge no → MUKERRER engel (gün farklı olsa da)');
    // fiş no yok + saat
    const saatRaw = { ...fis().ocrData, rawText: 'MARKET AŞ VKN 1111111111\n05.08.2026 SAAT: 18:30\nTOPLAM 240,00' };
    const saatli = makeService({ docs: [fis({ id: 'd0', belgeNo: null, createdAt: new Date('2026-07-30T10:00:00Z'), ocrData: saatRaw, ocrRawText: saatRaw.rawText }), fis({ id: 'd1', belgeNo: 'BILINMIYOR', ocrData: saatRaw })], taxpayer: TP });
    await saatli.svc.revalidateDocument('t', 'd1');
    const uS = uyOf(saatli.state).find((u) => u.kod === 'MUKERRER_FIS');
    assert(uS && uS.meta.tur === 'saat' && uS.meta.saat === '18:30' && uS.meta.ilkBelgeId === 'd0', 'fiş no yok: VKN + gün + saat + tutar → MUKERRER_FIS (tur saat)');
    const saatFarkli = makeService({ docs: [fis({ id: 'd0', belgeNo: null, createdAt: new Date('2026-07-30T10:00:00Z'), ocrData: { ...saatRaw, rawText: '05.08.2026 SAAT: 12:10' } }), fis({ id: 'd1', belgeNo: '', ocrData: saatRaw })], taxpayer: TP });
    await saatFarkli.svc.revalidateDocument('t', 'd1');
    assert(!kodlar(uyOf(saatFarkli.state)).includes('MUKERRER_FIS'), 'saat farklı → şüphe yok');
    // görsel benzerlik
    const gor = makeService({ docs: [fis({ id: 'd0', belgeNo: '0001', createdAt: new Date('2026-07-30T10:00:00Z'), imagePhash: '3e2f2f272f37332f' }), fis({ id: 'd1', belgeNo: '', imagePhash: '0e2f2f272f27336f' })], taxpayer: TP });
    const vG = await gor.svc.revalidateDocument('t', 'd1');
    const uG = uyOf(gor.state).find((u) => u.kod === 'MUKERRER_GORSEL');
    assert(vG.status === 'OK' && uG && uG.seviye === 'uyari' && uG.meta.hamming === 4 && uG.meta.ilkBelgeId === 'd0' && /ikinci fotoğrafı/.test(uG.baslik), 'imagePhash Hamming 4 + tutar/gün aynı + fiş no okunamamış → MUKERRER_GORSEL uyarı (meta.hamming=4, ilkBelgeId)');
    assert(gor.state.updates.some((u) => u.id === 'd1' && u.data.duplicateSeverity === 'WARNING' && /ikinci fotoğrafı/.test(u.data.duplicateReason)), 'görsel şüphe kolonlara WARNING yazıldı');
    await gor.svc.revalidateDocument('t', 'd0');
    assert(!kodlar(uyOf(gor.state, 'd0')).includes('MUKERRER_GORSEL'), 'ilk (eski) görsel temiz');
    // CANLI BULGU (2026-09-12): aynı satıcının FARKLI faturaları aynı şablonla Hamming=0 çıkıyor → tutar (±0,01) ya da
    //   belge no aynı değilse görsel şüphe ÜRETİLMEZ (kullanıcı kararı 7: görsel + tutar/tarih/VKN birlikte).
    const ayniGorselFarkliTutar = makeService({ docs: [fis({ id: 'd0', belgeNo: '4489', totalAmount: 9323.83, createdAt: new Date('2026-07-30T10:00:00Z'), imagePhash: '3e2f2f272f37332f' }), fis({ id: 'd1', belgeNo: '6157', totalAmount: 6232.44, imagePhash: '3e2f2f272f37332f' })], taxpayer: TP });
    await ayniGorselFarkliTutar.svc.revalidateDocument('t', 'd1');
    assert(!kodlar(uyOf(ayniGorselFarkliTutar.state)).includes('MUKERRER_GORSEL'), 'Hamming 0 ama tutar ve belge no FARKLI → görsel şüphe yok (aynı şablon ≠ aynı fiş)');
    const ayniGorselAyniNo = makeService({ docs: [fis({ id: 'd0', belgeNo: '7707', totalAmount: 5557.32, createdAt: new Date('2026-07-30T10:00:00Z'), imagePhash: '3e2f2f272f37332f' }), fis({ id: 'd1', belgeNo: '7707', totalAmount: 5557.99, imagePhash: '3e2f2f272f37332f' })], taxpayer: TP });
    await ayniGorselAyniNo.svc.revalidateDocument('t', 'd1');
    assert(!kodlar(uyOf(ayniGorselAyniNo.state)).includes('MUKERRER_GORSEL'), 'Hamming 0 + belge no aynı ama TUTAR farklı → görsel şüphe YOK (kullanıcı kuralı: tutar da aynı olmalı)');
    const ayniHerSey = makeService({ docs: [fis({ id: 'd0', belgeNo: '7707', totalAmount: 5557.32, createdAt: new Date('2026-07-30T10:00:00Z'), imagePhash: '3e2f2f272f37332f' }), fis({ id: 'd1', belgeNo: '7707', totalAmount: 5557.32, imagePhash: '3e2f2f272f37332f' })], taxpayer: TP });
    await ayniHerSey.svc.revalidateDocument('t', 'd1');
    assert(kodlar(uyOf(ayniHerSey.state)).includes('MUKERRER_FIS') || kodlar(uyOf(ayniHerSey.state)).includes('MUKERRER_GORSEL'), 'aynı gün + aynı VKN + aynı fiş no + aynı tutar → mükerrer şüphesi VAR (fiş kuralı önce yakalar)');
    const gunFarkli = makeService({ docs: [fis({ id: 'd0', belgeNo: '', totalAmount: 240, faturaTarihi: new Date('2026-08-01T00:00:00Z'), createdAt: new Date('2026-07-30T10:00:00Z'), imagePhash: '3e2f2f272f37332f' }), fis({ id: 'd1', belgeNo: '', totalAmount: 240, imagePhash: '3e2f2f272f37332f' })], taxpayer: TP });
    await gunFarkli.svc.revalidateDocument('t', 'd1');
    assert(!kodlar(uyOf(gunFarkli.state)).includes('MUKERRER_GORSEL'), 'Hamming 0 + tutar aynı ama TARİH farklı → görsel şüphe yok');
    const uzak = makeService({ docs: [fis({ id: 'd0', belgeNo: '0001', createdAt: new Date('2026-07-30T10:00:00Z'), imagePhash: '3e2f2f272f37332f' }), fis({ id: 'd1', belgeNo: '0002', imagePhash: '1a1b0f0e1d170f1d' })], taxpayer: TP });
    await uzak.svc.revalidateDocument('t', 'd1');
    assert(!kodlar(uyOf(uzak.state)).includes('MUKERRER_GORSEL'), 'Hamming 20 → şüphe yok');
    const dejenere = makeService({ docs: [fis({ id: 'd0', belgeNo: '0001', createdAt: new Date('2026-07-30T10:00:00Z'), imagePhash: '0000000000000000' }), fis({ id: 'd1', belgeNo: '0002', imagePhash: '0000000000000000' })], taxpayer: TP });
    await dejenere.svc.revalidateDocument('t', 'd1');
    assert(!kodlar(uyOf(dejenere.state)).includes('MUKERRER_GORSEL'), 'iki düz (dejenere) görsel → şüphe üretilmez');
    const yonFarkli = makeService({ docs: [fis({ id: 'd0', belgeNo: '0001', invoiceKind: 'SATIS', createdAt: new Date('2026-07-30T10:00:00Z'), imagePhash: '3e2f2f272f37332f' }), fis({ id: 'd1', belgeNo: '0002', imagePhash: '3e2f2f272f37332f' })], taxpayer: TP });
    await yonFarkli.svc.revalidateDocument('t', 'd1');
    assert(!kodlar(uyOf(yonFarkli.state)).includes('MUKERRER_GORSEL'), 'farklı yön (SATIS/ALIS) → görsel şüphe aranmaz');
    // mukerrerKarari ucu şüpheyi kapatır
    const mk = makeService({ docs: [fis({ id: 'd0', belgeNo: '0001', createdAt: new Date('2026-07-30T10:00:00Z'), imagePhash: '3e2f2f272f37332f' }), fis({ id: 'd1', belgeNo: '', imagePhash: '3e2f2f272f37332f' })], taxpayer: TP });
    await mk.svc.revalidateDocument('t', 'd1');
    assert(kodlar(uyOf(mk.state)).includes('MUKERRER_GORSEL'), 'ön koşul: görsel şüphe var');
    const rk = await mk.svc.mukerrerKarari('t', 'd1', { karar: 'mukerrer_degil' }, 'u');
    assert(rk.ok && !kodlar(uyOf(mk.state)).includes('MUKERRER_GORSEL') && mk.state.docs.find((d) => d.id === 'd1').ocrData.mukerrerKarar.kod === 'MUKERRER_GORSEL', "mukerrerKarari('mukerrer_degil') görsel şüpheyi kapatır (karar kaydı kod=MUKERRER_GORSEL)");
  }

  console.log('5) uploadAndOcr — zaten yüklü (SHA-256) / yeni dosya + phash');
  {
    const jpeg = sharp ? await sharp({ create: { width: 64, height: 48, channels: 3, background: '#ccc' } }).jpeg().toBuffer() : Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);
    const sha = require('crypto').createHash('sha256').update(jpeg).digest('hex');
    const { svc, state } = makeService({ docs: [fis({ id: 'eski', belgeNo: 'F-77', imageHash: sha, faturaTarihi: new Date('2026-08-05T00:00:00Z') })], taxpayer: TP });
    const r = await svc.uploadAndOcr('t', 'u', [{ originalname: 'fis.jpg', mimetype: 'image/jpeg', size: jpeg.length, buffer: jpeg }], { taxpayerId: 'tp', invoiceKind: 'ALIS' });
    assert(r.uploaded === 0 && r.created === false && r.zatenYuklu === true && r.mevcutId === 'eski' && r.mevcutBelgeNo === 'F-77' && /^Zaten yüklü: belge F-77 \(05\.08\.2026\)/.test(r.mesaj), `aynı dosya → belge oluşmadı, mesaj "${r.mesaj}"`);
    assert(r.atlananlar.length === 1 && r.atlananlar[0].tur === 'sha256' && r.skipped.length === 1 && r.skipped[0].zatenYuklu === true && state.creates.length === 0 && state.storagePuts.length === 0, 'atlananlar[1] + skipped[1]; create/depo yazımı YOK');
    // başka mükellefte aynı dosya → oluşur ama UYARI sinyali
    const r2 = await svc.uploadAndOcr('t', 'u', [{ originalname: 'fis.jpg', mimetype: 'image/jpeg', size: jpeg.length, buffer: jpeg }], { taxpayerId: 'tp2', invoiceKind: 'ALIS' });
    assert(r2.uploaded === 1 && r2.zatenYuklu === false && state.creates[0].duplicateSeverity === 'WARNING' && /başka bir mükellefte/.test(state.creates[0].duplicateReason), 'aynı dosya BAŞKA mükellefte → belge oluşur, SHA256_BASKA_MUKELLEF uyarı sinyali');
    // yeni dosya → oluşur, phash dolu (sharp varsa)
    const jpeg2 = sharp ? await sharp({ create: { width: 64, height: 48, channels: 3, background: '#333' } }).jpeg().toBuffer() : Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9]);
    const r3 = await svc.uploadAndOcr('t', 'u', [{ originalname: 'yeni.jpg', mimetype: 'image/jpeg', size: jpeg2.length, buffer: jpeg2 }], { taxpayerId: 'tp', invoiceKind: 'ALIS' });
    const yeni = state.creates[state.creates.length - 1];
    assert(r3.uploaded === 1 && r3.created === true && r3.documents.length === 1 && state.storagePuts.length === 2, 'yeni dosya → belge oluştu, depoya yazıldı, eski alanlar (uploaded/documents/skipped) korunur');
    if (sharp) assert(/^[0-9a-f]{16}$/.test(String(yeni.imagePhash)), `yeni görselde imagePhash dolu (${yeni.imagePhash})`);
    // toplu: biri zaten yüklü, biri yeni → diğeri devam eder
    const jpeg3 = sharp ? await sharp({ create: { width: 64, height: 48, channels: 3, background: '#888' } }).jpeg().toBuffer() : Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7]);
    const r4 = await svc.uploadAndOcr('t', 'u', [{ originalname: 'fis.jpg', mimetype: 'image/jpeg', size: jpeg.length, buffer: jpeg }, { originalname: 'ucuncu.jpg', mimetype: 'image/jpeg', size: jpeg3.length, buffer: jpeg3 }], { taxpayerId: 'tp', invoiceKind: 'ALIS' });
    assert(r4.uploaded === 1 && r4.zatenYuklu === true && r4.atlananlar.length === 1 && r4.created === true, 'toplu yüklemede zaten yüklü olan atlanır, diğeri devam eder');
    // XML ETTN → zaten yüklü
    const xml = '<?xml version="1.0"?><Invoice xmlns:cbc="x"><cbc:ID>ABC2026000000123</cbc:ID><cbc:UUID>abcdef12-3456-7890-abcd-ef1234567890</cbc:UUID></Invoice>';
    state.docs.push(fis({ id: 'xmlEski', belgeNo: 'ABC2026000000123', invoiceKind: 'ALIS', ocrData: { ettn: 'ABCDEF12-3456-7890-ABCD-EF1234567890' } }));
    const r5 = await svc.uploadAndOcr('t', 'u', [{ originalname: 'f.xml', mimetype: 'application/xml', size: xml.length, buffer: Buffer.from(xml) }], { taxpayerId: 'tp', invoiceKind: 'ALIS' });
    assert(r5.zatenYuklu === true && r5.mevcutId === 'xmlEski' && r5.atlananlar[0].tur === 'ettn', 'XML yükleme: ETTN mevcut belgeyle (ocrData.ettn, harf farkı) eşleşti → oluşturulmadı');
  }

  console.log('6) createDocumentFromProviderXml — ETTN eşleşmesi');
  {
    const NS = 'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"';
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Invoice ${NS}><cbc:ProfileID>TEMELFATURA</cbc:ProfileID><cbc:ID>ETN2026000000001</cbc:ID><cbc:UUID>33333333-3333-3333-3333-333333333333</cbc:UUID><cbc:IssueDate>2026-08-01</cbc:IssueDate><cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
<cac:AccountingSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="VKN">1111111111</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>SATICI</cbc:Name></cac:PartyName></cac:Party></cac:AccountingSupplierParty>
<cac:AccountingCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="VKN">9999999999</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>ALICI</cbc:Name></cac:PartyName></cac:Party></cac:AccountingCustomerParty>
<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">200</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="TRY">1000</cbc:TaxableAmount><cbc:TaxAmount currencyID="TRY">200</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>20</cbc:Percent><cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="TRY">1000</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="TRY">1000</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="TRY">1200</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="TRY">1200</cbc:PayableAmount></cac:LegalMonetaryTotal>
<cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="TRY">1000</cbc:LineExtensionAmount><cac:Item><cbc:Name>Deneme</cbc:Name></cac:Item><cac:Price><cbc:PriceAmount currencyID="TRY">1000</cbc:PriceAmount></cac:Price></cac:InvoiceLine></Invoice>`;
    const mevcut = fis({ id: 'gibDoc', source: 'gib-portal-api', sourceRefId: '33333333-3333-3333-3333-333333333333', belgeNo: 'ETN2026000000001', invoiceKind: 'ALIS' });
    const { svc, state } = makeService({ docs: [mevcut], taxpayer: TP });
    const r = await svc.createDocumentFromProviderXml('t', 'u', { id: 'tp', taxNumber: '9999999999' }, { provider: 'ELOGO', label: 'eLogo' }, 'ALIS', { xml, externalId: 'elogo-77' }, {});
    assert(r && r.created === false && r.zatenYuklu === true && r.mevcutId === 'gibDoc' && r.document && r.document.id === 'gibDoc' && state.creates.length === 0 && state.storagePuts.length === 0, 'aynı ETTN başka kaynakta (sourceRefId) mevcut → yeni belge OLUŞMAZ, mevcut döner');
    // farklı yönde aynı ETTN (mükellef hem alıcı hem satıcı olamaz ama aynı ofiste iki taraf farklı mükellef) → yön farklıysa engel değil
    const svc2 = makeService({ docs: [fis({ id: 'satisDoc', source: 'gib-portal-api', sourceRefId: '33333333-3333-3333-3333-333333333333', invoiceKind: 'SATIS' })], taxpayer: TP });
    let r2 = null; let threw = null;
    try { r2 = await svc2.svc.createDocumentFromProviderXml('t', 'u', { id: 'tp', taxNumber: '9999999999' }, { provider: 'ELOGO', label: 'eLogo' }, 'ALIS', { xml, externalId: 'elogo-78' }, {}); } catch (e) { threw = e; }
    assert((r2 && r2.created === true && !r2.zatenYuklu && svc2.state.creates.length === 1) || (threw && !/zatenYuklu/.test(String(threw.message))), 'aynı ETTN ama FARKLI yön → ETTN kapısı geçilir, yeni belge oluşur');
  }

  console.log('7) approveBatch — mükerrer şüphesi atlanır');
  {
    const { svc } = makeService({ docs: [fis({ id: 'd1', ocrData: { ...fis().ocrData, uyarilar: [uk.uyariYap({ kod: 'MUKERRER_GORSEL', seviye: 'uyari', baslik: 'a', aciklama: 'b', kaynak: 'dogrulama' })] } })], taxpayer: TP });
    const r = await svc.approveBatch('t', ['d1'], 'u', false);
    assert(r.approved === 0 && r.skipped.length === 1 && r.skipped[0].reason === 'mukerrer-suphe', "MUKERRER_GORSEL uyarılı belge toplu onayda 'mukerrer-suphe' ile atlanır");
  }

  console.log('8) reopen / lucaElleDuzeltildi / approve MANUAL_DONE');
  {
    // onay → öğrenme kayıtları yazılır (mock recordDecision) → geri al → revert + temizlik
    const { svc, state } = makeService({ docs: [fis({ id: 'd1', status: 'READY' })], taxpayer: TP });
    const onay = await svc.approve('t', 'd1', 'u');
    const d1 = state.docs.find((d) => d.id === 'd1');
    assert(onay.status === 'APPROVED' && d1.lucaStatus === 'QUEUED' && Array.isArray(d1.ocrData.ogrenmeKayitlari) && d1.ocrData.ogrenmeKayitlari.length === state.records.length && state.records.length >= 2, `approve → APPROVED/QUEUED, ocrData.ogrenmeKayitlari (${d1.ocrData.ogrenmeKayitlari.length} kayıt = recordDecision çağrısı)`);
    const k0 = d1.ocrData.ogrenmeKayitlari[0];
    assert(k0.kararTipi === 'fatura' && k0.firmaKimlikNo === '1111111111' && k0.taxpayerId === 'tp' && k0.boost === 2 && 'icerikImza' in k0 && 'altKategori' in k0, 'ogrenme kaydı anahtarı: kararTipi/kategori/altKategori/icerikImza/firmaKimlikNo/taxpayerId/boost');
    const geri = await svc.reopen('t', 'd1', 'u', {});
    assert(geri.status === 'NEEDS_REVIEW' && geri.lucaStatus === 'NOT_STARTED' && geri.approvedBy === null && geri.approvedAt === null && geri.lines.length === 3, 'reopen (QUEUED) → NEEDS_REVIEW + NOT_STARTED, satırlar korunur');
    assert(state.reverts.length === state.records.length && state.reverts[0].onayBoost === 2 && state.reverts[0].firmaKimlikNo === '1111111111', `revertDecision ${state.reverts.length} kez (boost ile) çağrıldı`);
    assert(!('ogrenmeKayitlari' in d1.ocrData) && geri.geriAlma.ogrenmeGeriAlindi === state.records.length && geri.geriAlma.elleDuzeltilecek === false, 'ogrenmeKayitlari temizlendi; yanıt geriAlma.ogrenmeGeriAlindi');
    const audit = state.audits.find((a) => a.action === 'REOPEN');
    assert(audit && audit.newData.lucaStatusEski === 'QUEUED' && audit.newData.elleDuzeltilecek === false && audit.newData.ogrenmeGeriAlindi === state.records.length && 'lucaFisNo' in audit.newData, 'AuditLog REOPEN: lucaStatusEski / lucaFisNo / elleDuzeltilecek / ogrenmeGeriAlindi');
    let ikinci = null; try { await svc.reopen('t', 'd1', 'u', {}); } catch (e) { ikinci = e; }
    assert(ikinci && state.reverts.length === state.records.length, 'ikinci geri alma reddedilir, revert bir daha çağrılmaz (idempotent)');
    // POSTING → 400
    const posting = makeService({ docs: [fis({ id: 'd1', status: 'APPROVED', lucaStatus: 'POSTING' })], taxpayer: TP });
    let e1 = null; try { await posting.svc.reopen('t', 'd1', 'u', { onay: true }); } catch (e) { e1 = e; }
    assert(e1 && /aktarılıyor/.test(String(e1.message)), 'POSTING → reddedilir (aktarım sürüyor)');
    // POSTED onay yok → 409 teyit
    const posted = makeService({ docs: [fis({ id: 'd1', status: 'APPROVED', lucaStatus: 'POSTED', lucaFisNo: 'YF-123', lucaPostedAt: new Date('2026-08-10T00:00:00Z'), ocrData: { ...fis().ocrData, ogrenmeKayitlari: [{ kararTipi: 'fatura', kategori: '770.01.001', altKategori: '20', icerikImza: null, firmaKimlikNo: '1111111111', taxpayerId: 'tp', boost: 2 }] } })], taxpayer: TP });
    let e2 = null; try { await posted.svc.reopen('t', 'd1', 'u', {}); } catch (e) { e2 = e; }
    const body = e2 && typeof e2.getResponse === 'function' ? e2.getResponse() : null;
    assert(e2 && e2.getStatus && e2.getStatus() === 409 && body && body.teyitGerekli === true && body.lucaFisNo === 'YF-123' && /Luca'ya gitmiş/.test(body.mesaj), 'POSTED + onay yok → 409 { teyitGerekli:true, mesaj, lucaFisNo }');
    assert(posted.state.docs.find((d) => d.id === 'd1').status === 'APPROVED' && posted.state.reverts.length === 0, 'teyit reddinde belge ve hafıza DEĞİŞMEZ');
    // POSTED onay:true → geri al + elle düzeltilecek
    const g2 = await posted.svc.reopen('t', 'd1', 'u', { onay: true, not: 'tutar yanlış' });
    const p1 = posted.state.docs.find((d) => d.id === 'd1');
    assert(g2.status === 'NEEDS_REVIEW' && p1.lucaStatus === 'NOT_STARTED' && p1.lucaFisNo === null && p1.lucaPostedAt === null, 'POSTED + onay:true → NEEDS_REVIEW, lucaStatus NOT_STARTED, lucaFisNo/lucaPostedAt temiz');
    assert(p1.ocrData.lucaElleDuzeltilecek && p1.ocrData.lucaElleDuzeltilecek.lucaFisNo === 'YF-123' && p1.ocrData.lucaElleDuzeltilecek.userId === 'u' && p1.ocrData.lucaElleDuzeltilecek.not === 'tutar yanlış' && p1.ocrData.eskiLucaFisNo === 'YF-123', 'ocrData.lucaElleDuzeltilecek {tarih, lucaFisNo, userId, not} + eskiLucaFisNo');
    assert(posted.state.reverts.length === 1 && g2.geriAlma.elleDuzeltilecek === true && g2.geriAlma.lucaStatusEski === 'POSTED', 'öğrenme geri alındı (1); yanıt geriAlma.elleDuzeltilecek=true');
    const a2 = posted.state.audits.find((a) => a.action === 'REOPEN');
    assert(a2 && a2.newData.lucaStatusEski === 'POSTED' && a2.newData.lucaFisNo === 'YF-123' && a2.newData.elleDuzeltilecek === true && a2.newData.ogrenmeGeriAlindi === 1, 'AuditLog REOPEN (POSTED): lucaStatusEski POSTED, lucaFisNo, elleDuzeltilecek true, ogrenmeGeriAlindi 1');
    // yeniden onay → MANUAL_DONE (Luca'ya gitmez)
    const onay2 = await posted.svc.approve('t', 'd1', 'u');
    assert(onay2.status === 'APPROVED' && onay2.lucaStatus === 'MANUAL_DONE' && onay2.lucaErrorMessage === null, 'lucaElleDuzeltilecek belge yeniden onaylanınca lucaStatus MANUAL_DONE (Luca\'ya otomatik GİTMEZ)');
    let e3 = null; try { await posted.svc.retryLucaPost('t', 'd1', 'u'); } catch (e) { e3 = e; }
    assert(e3 && /elle/.test(String(e3.message)), 'retryLucaPost: geri alınmış belge yeniden gönderilmez');
    // luca-elle-duzeltildi → bayrak kapanır
    const r = await posted.svc.lucaElleDuzeltildi('t', 'd1', { not: 'düzelttim' }, 'u');
    const p2 = posted.state.docs.find((d) => d.id === 'd1');
    assert(r.ok && !p2.ocrData.lucaElleDuzeltilecek && p2.ocrData.lucaElleDuzeltildi && p2.ocrData.lucaElleDuzeltildi.lucaFisNo === 'YF-123' && p2.ocrData.lucaElleDuzeltildi.not === 'düzelttim' && p2.lucaStatus === 'MANUAL_DONE', 'luca-elle-duzeltildi → lucaElleDuzeltilecek kalkar, lucaElleDuzeltildi yazılır, MANUAL_DONE kalır');
    let e4 = null; try { await posted.svc.lucaElleDuzeltildi('t', 'd1', {}, 'u'); } catch (e) { e4 = e; }
    assert(e4 && /işareti yok/.test(String(e4.message)), 'ikinci "elle düzelttim" → işaret yok hatası');
    // isletme dalında da MANUAL_DONE
    const isl = makeService({ docs: [fis({ id: 'd1', status: 'NEEDS_REVIEW', ocrData: { ...fis().ocrData, lucaElleDuzeltilecek: { tarih: 'x', lucaFisNo: 'YF-9' }, isletme: { belgeTuruKod: '1', kayitTuruKod: '2', kayitAltKod: '2.1', userEdited: true } } })], taxpayer: { ...TP, defterTuru: 'ISLETME' } });
    let onayIsl = null; let eIsl = null; try { onayIsl = await isl.svc.approve('t', 'd1', 'u'); } catch (e) { eIsl = e; }
    assert((onayIsl && onayIsl.lucaStatus === 'MANUAL_DONE') || (eIsl && /onaylanamaz/.test(String(eIsl.message))), `işletme dalı: elle yolu → MANUAL_DONE ya da işletme hazırlık hatası (${onayIsl ? onayIsl.lucaStatus : eIsl.message.slice(0, 60)})`);
  }

  console.log('9) VendorMemoryService.revertDecision');
  {
    const st = { decision: { id: 'k1', onayAdedi: 3 }, memory: { id: 'm1', toplamOnay: 2 }, updates: [], deletes: [], memUpdates: [] };
    const prisma = {
      vendorMemory: { findUnique: async () => st.memory, updateMany: async ({ where, data }) => { st.memUpdates.push({ where, data }); if (st.memory.toplamOnay > 0) st.memory.toplamOnay -= 1; return { count: 1 }; } },
      vendorMemoryDecision: {
        findFirst: async () => st.decision,
        update: async ({ where, data }) => { st.updates.push({ where, data }); st.decision.onayAdedi = data.onayAdedi; return st.decision; },
        delete: async ({ where }) => { st.deletes.push(where); st.decision = null; return {}; },
      },
    };
    const vm = new VendorMemoryService(prisma);
    const p = { tenantId: 't', firmaKimlikNo: '1111111111', kararTipi: 'fatura', kategori: '770.01.001', altKategori: '20', icerikImza: null, taxpayerId: 'tp', onayBoost: 2 };
    const r1 = await vm.revertDecision(p);
    assert(r1.geriAlindi && !r1.silindi && st.decision.onayAdedi === 1 && st.memory.toplamOnay === 1, 'onayAdedi 3 → 1 (boost 2), toplamOnay 2 → 1');
    const r2 = await vm.revertDecision(p);
    assert(r2.geriAlindi && r2.silindi && st.decision === null && st.deletes.length === 1 && st.memory.toplamOnay === 0, "1 - 2 ≤ 0 → karar SİLİNDİ, toplamOnay 0");
    const r3 = await vm.revertDecision(p);
    assert(!r3.geriAlindi && st.memory.toplamOnay === 0 && st.memUpdates[2].where.toplamOnay.gt === 0, 'karar yok → geriAlindi false; toplamOnay 0 altına inmez (gt:0 şartı)');
    assert(!(await vm.revertDecision({ ...p, firmaKimlikNo: '12' })).geriAlindi && !(await vm.revertDecision({ ...p, taxpayerId: null })).geriAlindi, 'geçersiz VKN / mükellef yok → no-op');
  }

  console.log('10) Kaynak metin kilitleri');
  {
    const svcSrc = fs.readFileSync(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts'), 'utf8');
    const ctl = fs.readFileSync(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.controller.ts'), 'utf8');
    const schema = fs.readFileSync(path.join(ROOT, 'apps/api/prisma/schema.prisma'), 'utf8');
    const pkg = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
    assert(ctl.includes("@Post('documents/:id/reopen')") && /reopen\(@Req\(\) req: any, @Param\('id'\) id: string, @Body\(\) body\?/.test(ctl) && ctl.includes("@Post('documents/:id/luca-elle-duzeltildi')") && ctl.includes("@Post('documents/phash-doldur')"), 'controller: reopen body + luca-elle-duzeltildi + phash-doldur uçları');
    assert((svcSrc.match(/this\.lucaElleYolu\(d\.ocrData\)/g) || []).length >= 2 && svcSrc.includes("'MANUAL_DONE' : doc.taxpayerId ? 'QUEUED'"), 'batchPostToLuca + buildBatchExcel lucaElleYolu süzgeci; approve MANUAL_DONE');
    assert(svcSrc.includes("reason: 'mukerrer-suphe'") && svcSrc.includes('mode === \'phash-doldur\'') && svcSrc.includes('zatenYukluMu('), 'approveBatch mukerrer-suphe; phash-doldur modu; zatenYukluMu');
    assert(/imagePhash\s+String\?\s+@db\.VarChar\(16\)/.test(schema) && schema.includes('@@index([tenantId, imagePhash])'), 'schema.prisma: imagePhash VarChar(16) + index');
    const mig = path.join(ROOT, 'apps/api/prisma/migrations/20260912_image_phash/migration.sql');
    assert(fs.existsSync(mig) && /ADD COLUMN IF NOT EXISTS "imagePhash" VARCHAR\(16\)/.test(fs.readFileSync(mig, 'utf8')), 'migration 20260912_image_phash (nullable, IF NOT EXISTS)');
    const zincir = (pkg.match(/"test:regression": "([^"]+)"/) || [])[1] || '';
    assert(zincir.indexOf('uyari-katmani-regression.cjs') >= 0 && zincir.indexOf('mukerrer-gorsel-regression.cjs') > zincir.indexOf('uyari-katmani-regression.cjs'), 'package.json test:regression zinciri: mukerrer-gorsel, uyari-katmani\'den sonra');
  }

  console.log(failed ? `\n${failed} KİLİT KIRILDI` : '\nTÜM KİLİTLER GEÇTİ');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
