#!/usr/bin/env node
/**
 * BELGE AKIŞI + KDV TEYİT regresyonu — PLAN/16 §D/§E.
 *   apps/api/src/fatura-muhasebelestirme/{belge-akisi-kurallari,belge-akisi.service,kdv-teyit.service}.ts
 *
 * Kilitler:
 *   1) Durum sözlüğü önceliği: iptal → hata → okunuyor → lucada → onaylı → karar bekliyor → okundu
 *      (DEMIRBAS karar verilmişse karar bekliyor DEĞİL; MUKERRER/ALICI_TIPI_GEREKLI/engel → karar bekliyor).
 *   2) Sekme eşlemesi: integration-* / mihsap → entegratör; earsiv / gib-* → GİB; manual-web / fatura-merkezi /
 *      mobile-ocr / bilinmeyen → yüklenen. Etiketler: TÜRMOB · Turkcell · Paraşüt · eLogo · Mihsap · GİB · Yükleme · Mobil.
 *   3) Prisma where: yuklenen = NOT[entegratör, gib]; durum where'leri pozitif süzgeç (NOT yok — nullable kolon tuzağı).
 *   4) kdvFark: ±1 TL eşik, yüzde, null güvenli; kdvSonuc KDV Kontrol formülüyle aynı.
 *   5) mizanKdvOku: yaprak bakiye → sıfırsa hareket → tam kod; 391 alacak / 191 borç / 190 borç.
 *   6) BelgeAkisiService.akis (sahte prisma): satır sözleşmesi, silinen sekmesi (AuditLog + silen kişi eşleme), sayaçlar, akış durmuş.
 *   7) KdvTeyitService.teyit (sahte servisler): farklar tevkifat tabanı, KDV Kontrol yoksa {yok:true}, drilldown geçer.
 */
const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

const K = require(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/belge-akisi-kurallari.ts'));
const { BelgeAkisiService } = require(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/belge-akisi.service.ts'));
const { KdvTeyitService } = require(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/kdv-teyit.service.ts'));

let failed = 0;
function ok(cond, msg) { if (!cond) { failed++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); }
function eq(a, b, msg) { try { assert.deepStrictEqual(a, b); ok(true, msg); } catch { failed++; console.error(`  ✗ ${msg}\n     beklenen=${JSON.stringify(b)} gelen=${JSON.stringify(a)}`); } }

// ── 1) DURUM SÖZLÜĞÜ ──
console.log('1) belgeDurumu');
const d = (o) => K.belgeDurumu({ status: 'NEEDS_REVIEW', ocrStatus: 'SUCCESS', lucaStatus: 'NOT_STARTED', validationStatus: 'OK', ocrData: {}, ...o });
eq(d({ status: 'CANCELLED', ocrStatus: 'FAILED' }), 'iptal', 'CANCELLED + okuma hatası → iptal (iptal önce)');
eq(d({ status: 'REJECTED' }), 'iptal', 'REJECTED → iptal');
eq(d({ ocrStatus: 'FAILED' }), 'hata', 'ocrStatus FAILED → hata');
eq(d({ lucaStatus: 'FAILED', status: 'APPROVED' }), 'hata', 'lucaStatus FAILED (onaylı olsa da) → hata');
eq(d({ validationStatus: 'INVALID' }), 'hata', 'validationStatus INVALID → hata');
eq(d({ ocrStatus: 'PENDING' }), 'okunuyor', 'PENDING → okunuyor');
eq(d({ ocrStatus: 'IN_PROGRESS' }), 'okunuyor', 'IN_PROGRESS → okunuyor');
eq(d({ lucaStatus: 'POSTED', status: 'APPROVED' }), 'lucada', 'POSTED → lucada');
eq(d({ lucaStatus: 'MANUAL_DONE' }), 'lucada', 'MANUAL_DONE → lucada');
eq(d({ status: 'APPROVED' }), 'onayli', 'APPROVED → onaylı');
eq(d({ lucaStatus: 'QUEUED' }), 'onayli', 'QUEUED → onaylı');
eq(d({ duplicateOfId: 'x' }), 'karar_bekliyor', 'duplicateOfId dolu → karar bekliyor');
eq(d({ ocrData: { uyarilar: [{ kod: 'DEMIRBAS', seviye: 'uyari', baslik: 'D', aciklama: 'a' }] } }), 'karar_bekliyor', 'DEMIRBAS kararsız → karar bekliyor');
eq(d({ ocrData: { uyarilar: [{ kod: 'DEMIRBAS', seviye: 'bilgi', baslik: 'D', aciklama: 'a', meta: { karar: 'yine_de_isle' } }] } }), 'okundu', 'DEMIRBAS karar verilmiş → okundu');
eq(d({ ocrData: { uyarilar: [{ kod: 'TEVKIFAT_EKSIK', seviye: 'uyari', baslik: 'T', aciklama: 'a' }] } }), 'karar_bekliyor', 'TEVKIFAT_EKSIK → karar bekliyor');
eq(d({ ocrData: { uyarilar: [{ kod: 'TUTAR_TUTARSIZ', siddet: 'hata', baslik: 'T', mesaj: 'a' }] } }), 'karar_bekliyor', 'eski model siddet=hata (engel) → karar bekliyor');
eq(d({ ocrData: { uyarilar: [{ kod: 'KKEG_SUPHESI', seviye: 'bilgi', baslik: 'K', aciklama: 'a' }] } }), 'okundu', 'bilgi uyarısı → okundu');
eq(d({ status: 'READY' }), 'okundu', 'READY uyarısız → okundu');
eq(K.DURUM_ETIKET.karar_bekliyor, 'Karar bekliyor', 'etiket sözlüğü');
const oz = K.uyariOzetListesi([{ kod: 'A', seviye: 'bilgi', baslik: 'a', aciklama: '' }, { kod: 'B', seviye: 'engel', baslik: 'b', aciklama: '' }, { kod: 'C', seviye: 'uyari', baslik: 'c', aciklama: '' }, { kod: 'D', seviye: 'bilgi', baslik: 'd', aciklama: '' }, { kod: 'E', seviye: 'bilgi', baslik: 'e', aciklama: '' }], 4);
eq(oz.map((u) => u.kod), ['B', 'C', 'A', 'D'], 'uyarı özeti engel→uyarı→bilgi, en fazla 4');
ok(K.KARAR_SQL_KOSULU.includes("'MUKERRER_GORSEL'") && K.KARAR_SQL_KOSULU.includes("u->>'siddet' = 'hata'") && K.KARAR_SQL_KOSULU.includes('"duplicateOfId" IS NOT NULL'), 'KARAR_SQL_KOSULU sözlükle aynı kodları içerir');

// ── 2) SEKME / KAYNAK ──
console.log('2) sekmeKaynagi');
const sk = (source, extra) => K.sekmeKaynagi({ source, ...(extra || {}) });
eq(sk('integration-turmob_efatura'), { sekme: 'entegrator', etiket: 'TÜRMOB', kod: 'integration-turmob_efatura' }, 'TÜRMOB');
eq(sk('integration-turkcell').etiket, 'Turkcell', 'Turkcell');
eq(sk('integration-parasut').etiket, 'Paraşüt', 'Paraşüt');
eq(sk('integration-elogo').etiket, 'eLogo', 'eLogo');
eq(sk('integration-uyumsoft').etiket, 'Uyumsoft', 'Uyumsoft');
eq(sk('integration-yeni_saglayici').sekme, 'entegrator', 'bilinmeyen integration-* → entegratör');
eq(sk('mihsap'), { sekme: 'entegrator', etiket: 'Mihsap', kod: 'mihsap' }, 'mihsap → entegratör/Mihsap');
eq(sk('earsiv'), { sekme: 'gib', etiket: 'GİB', kod: 'earsiv' }, 'earsiv → GİB');
eq(sk('earsiv', { documentType: 'E_FATURA' }).etiket, 'GİB e-Fatura', 'earsiv + E_FATURA → GİB e-Fatura');
eq(sk('gib-earsiv-api').sekme, 'gib', 'gib-earsiv-api → GİB');
eq(sk('gib-portal-api').sekme, 'gib', 'gib-portal-api → GİB');
eq(sk('fatura-merkezi'), { sekme: 'yuklenen', etiket: 'Yükleme', kod: 'fatura-merkezi' }, 'fatura-merkezi → yüklenen');
eq(sk('manual-web').etiket, 'Yükleme', 'manual-web → Yükleme');
eq(sk('mobile-ocr'), { sekme: 'yuklenen', etiket: 'Mobil', kod: 'mobile-ocr' }, 'mobile-ocr → Mobil');
eq(sk('').sekme, 'yuklenen', 'boş kaynak → yüklenen');
eq(sk('luca').sekme, 'yuklenen', 'bilinmeyen kaynak yüklenen sekmesine düşer (hiçbir belge kaybolmaz)');

// ── 3) PRISMA WHERE ──
console.log('3) sekmeWhere / durumWhere');
const yw = K.sekmeWhere('yuklenen');
ok(Array.isArray(yw.NOT) && yw.NOT.length === 2, 'yuklenen = NOT[entegratör, gib]');
ok(K.sekmeWhere('entegrator').OR.some((o) => o.source && o.source.startsWith === 'integration-'), 'entegratör where integration- prefix');
ok(K.sekmeWhere('gib').OR.some((o) => o.source && Array.isArray(o.source.in) && o.source.in.includes('earsiv')), 'gib where earsiv');
const kararW = K.durumWhere('karar_bekliyor', ['a', 'b']);
ok(JSON.stringify(kararW).includes('"in":["a","b"]') && !JSON.stringify(kararW).includes('"NOT"'), 'karar_bekliyor where id in + pozitif süzgeç (NOT yok)');
ok(JSON.stringify(K.durumWhere('hata')).includes('"OR":[{"validationStatus":null}') === false && JSON.stringify(K.durumWhere('okunuyor')).includes('{"validationStatus":null}'), 'hata-değil süzgeci nullable validationStatus için null şıkkını içerir');
eq(K.durumWhere('iptal'), { status: { in: ['CANCELLED', 'REJECTED'] } }, 'iptal where');

// ── 4) KDV FARK / SONUÇ ──
console.log('4) kdvFark / kdvSonuc');
eq(K.kdvFark(100, 100.5), { fark: -0.5, mutlak: 0.5, yuzde: 0.5, uyari: false }, '0,50 TL fark eşik altı');
eq(K.kdvFark(102, 100), { fark: 2, mutlak: 2, yuzde: 1.96, uyari: true }, '2 TL fark uyarı');
eq(K.kdvFark(100, 101), { fark: -1, mutlak: 1, yuzde: 0.99, uyari: false }, 'tam 1 TL eşikte uyarı yok');
eq(K.kdvFark(0, 0), { fark: 0, mutlak: 0, yuzde: 0, uyari: false }, 'iki taraf 0 → yüzde 0');
eq(K.kdvFark(null, 5), null, 'null → null');
eq(K.kdvSonuc(1000, 400, 100), { odenecek: 500, sonrakiDevreden: 0 }, 'ödenecek = hesaplanan − indirilecek − devreden');
eq(K.kdvSonuc(300, 400, 100), { odenecek: 0, sonrakiDevreden: 200 }, 'sonraki devreden = indirilecek + devreden − hesaplanan');

// ── 5) MİZAN ──
console.log('5) mizanKdvOku');
const rows = [
  { kod: '191', borcBakiye: 1000, alacakBakiye: 0, borcToplami: 1000, alacakToplami: 0 },
  { kod: '191.01', borcBakiye: 600, alacakBakiye: 0, borcToplami: 600, alacakToplami: 0 },
  { kod: '191.01.020', borcBakiye: 600, alacakBakiye: 0, borcToplami: 600, alacakToplami: 0 },
  { kod: '191.02', borcBakiye: 400, alacakBakiye: 0, borcToplami: 400, alacakToplami: 0 },
  { kod: '191.02.001', borcBakiye: 400, alacakBakiye: 0, borcToplami: 400, alacakToplami: 0 },
  { kod: '391', borcBakiye: 0, alacakBakiye: 0, borcToplami: 2500, alacakToplami: 2500 },
  { kod: '391.01.020', borcBakiye: 0, alacakBakiye: 0, borcToplami: 2500, alacakToplami: 2500 },
  { kod: '190', borcBakiye: 350, alacakBakiye: 0, borcToplami: 350, alacakToplami: 0 },
];
eq(K.mizanKdvOku(rows), { hesaplanan: 2500, indirilecek: 1000, devreden: 350 }, 'yaprak bakiye toplanır (191.01.020 + 191.02.001), 391 kapanmışsa hareket, 190 borç');
eq(K.mizanKdvOku([]).hesaplanan, null, 'satır yoksa null');
eq(K.mizanKdvOku([{ hesapKodu: '391', alacakBakiye: '123.45' }]).hesaplanan, 123.45, 'hesapKodu/string tutar (mizanlar tablosu) da okunur');

// ── 6) BelgeAkisiService (sahte prisma) ──
console.log('6) BelgeAkisiService.akis');
const simdi = Date.now();
const gun = (n) => new Date(simdi - n * 86400000);
const belgeler = [
  { id: 'b1', taxpayerId: 'tp1', source: 'fatura-merkezi', documentType: 'OKC_FIS', invoiceKind: 'ALIS', status: 'NEEDS_REVIEW', duplicateOfId: null, belgeNo: '123', faturaTarihi: gun(1), createdAt: gun(0), sellerVkn: '1111111111', buyerVkn: null, vendorName: 'Kırtasiye AŞ', customerName: null, totalAmount: '120.00', ocrStatus: 'SUCCESS', ocrData: { uyarilar: [{ kod: 'DEMIRBAS', seviye: 'uyari', baslik: 'Demirbaş?', aciklama: 'x' }] }, lucaStatus: 'NOT_STARTED', lucaFisNo: null, validationStatus: 'OK', validationIssues: null, lines: [{ group: 'matrah', accountCode: '770.01', kaynak: 'AI' }, { group: 'cari', accountCode: '320.01', kaynak: 'AI' }] },
  { id: 'b2', taxpayerId: 'tp1', source: 'integration-turmob_efatura', documentType: 'E_FATURA', invoiceKind: 'SATIS', status: 'APPROVED', duplicateOfId: null, belgeNo: 'ABC2026000000001', faturaTarihi: gun(3), createdAt: gun(2), sellerVkn: null, buyerVkn: '2222222222', vendorName: null, customerName: 'Müşteri Ltd', totalAmount: '1200.00', ocrStatus: 'SUCCESS', ocrData: {}, lucaStatus: 'POSTED', lucaFisNo: '77', validationStatus: 'OK', validationIssues: null, lines: [] },
];
function sahtePrisma(o = {}) {
  const state = { count: 0, findMany: [], raw: [] };
  const prisma = {
    invoiceAccountingDocument: {
      count: async ({ where }) => { state.count++; return (o.count || ((w) => 0))(where); },
      findMany: async (args) => { state.findMany.push(args); return o.docs || []; },
      groupBy: async (args) => (args.by[0] === 'source' ? (o.kaynakGrup || []) : (o.sonBelge || [])),
    },
    taxpayer: { findMany: async () => o.taxpayers || [] },
    $queryRawUnsafe: async (sql, ...params) => { state.raw.push({ sql, params }); return (o.raw || (() => []))(sql, params); },
  };
  return { prisma, state };
}
const fmSahte = { docGuven: (doc) => ({ seviye: (doc.lines || []).length ? 'orta' : 'dusuk', neden: 'test' }) };

(async () => {
  // 6a) yüklenen sekmesi
  {
    const { prisma, state } = sahtePrisma({
      docs: belgeler, count: () => 2,
      taxpayers: [{ id: 'tp1', companyName: 'Demo Ltd', firstName: null, lastName: null, createdAt: gun(400) }, { id: 'tp2', companyName: null, firstName: 'Ayşe', lastName: 'Yılmaz', createdAt: gun(400) }, { id: 'tp3', companyName: 'Yeni Ltd', createdAt: gun(5) }],
      sonBelge: [{ taxpayerId: 'tp1', _max: { createdAt: gun(0) } }, { taxpayerId: 'tp2', _max: { createdAt: gun(45) } }],
      kaynakGrup: [{ source: 'fatura-merkezi', _count: { _all: 9 } }, { source: 'mobile-ocr', _count: { _all: 2 } }],
      raw: (sql) => (sql.includes('"duplicateOfId" IS NOT NULL') ? [{ id: 'b1' }] : []),
    });
    const svc = new BelgeAkisiService(prisma, fmSahte);
    const r = await svc.akis('t1', { sekme: 'yuklenen', q: 'kırt', from: '2026-09-01', to: '2026-09-12', page: '1', limit: '50' });
    eq(r.sekme, 'yuklenen', 'sekme varsayılan/normalize');
    eq([r.toplam, r.sayfa, r.limit], [2, 1, 50], 'toplam/sayfa/limit');
    const s1 = r.satirlar[0];
    eq(Object.keys(s1).sort(), ['belgeNo', 'belgeTuru', 'durum', 'durumEtiketi', 'faturaTarihi', 'gelisZamani', 'guven', 'id', 'karsiTaraf', 'karsiVkn', 'kaynak', 'kaynakKod', 'lucaFisNo', 'lucaStatus', 'mukellefAd', 'mukerrerBagi', 'ocrStatus', 'sekme', 'status', 'taxpayerId', 'tutar', 'uyariSayisi', 'uyarilar', 'yon'].sort(), 'satır alanları (FE sözleşmesi)');
    eq([s1.mukellefAd, s1.kaynak, s1.yon, s1.karsiTaraf, s1.karsiVkn, s1.tutar, s1.durum, s1.durumEtiketi], ['Demo Ltd', 'Yükleme', 'ALIS', 'Kırtasiye AŞ', '1111111111', 120, 'karar_bekliyor', 'Karar bekliyor'], 'satır değerleri (alış, karar bekliyor)');
    eq(s1.uyarilar, [{ kod: 'DEMIRBAS', seviye: 'uyari', baslik: 'Demirbaş?' }], 'uyarı çipleri özet');
    eq(s1.guven, { seviye: 'orta', neden: 'test' }, 'güven docGuven üzerinden');
    const s2 = r.satirlar[1];
    eq([s2.kaynak, s2.sekme, s2.yon, s2.karsiTaraf, s2.durum, s2.lucaFisNo], ['TÜRMOB', 'entegrator', 'SATIS', 'Müşteri Ltd', 'lucada', '77'], 'satış satırı TÜRMOB / Luca\'da');
    eq(r.kaynaklar, [{ kod: 'fatura-merkezi', etiket: 'Yükleme', adet: 9 }, { kod: 'mobile-ocr', etiket: 'Mobil', adet: 2 }], 'kaynaklar listesi (dropdown)');
    eq(Object.keys(r.sayaclar).sort(), ['bugunGelen', 'hata', 'kararBekleyen', 'okunuyor'], 'sayaç anahtarları');
    eq(r.akisDurmus.map((a) => [a.taxpayerId, a.ad, a.gunSayisi >= 30, a.sonBelgeTarihi === null]), [['tp2', 'Ayşe Yılmaz', true, false]], 'akış durmuş: tp2 45 gün; tp1 bugün; tp3 5 günlük kayıt hiç belge yok → listelenmez');
    const fm = state.findMany[0];
    ok(fm.where.tenantId === 't1' && Array.isArray(fm.where.AND) && fm.where.AND[0].NOT && fm.where.createdAt.gte instanceof Date && fm.where.createdAt.lt instanceof Date, 'where: tenant + sekme NOT + tarih aralığı');
    ok(fm.where.AND.some((a) => a.OR && a.OR.some((x) => x.vendorName && x.vendorName.contains === 'kırt')), 'q araması vendorName/customerName/belgeNo');
    ok(!fm.include && fm.select.lines && fm.select.lines.select.group === true && !fm.select.ocrRawText, 'lines include edilmez; yalnız group/accountCode/kaynak; ocrRawText seçilmez');
    ok(fm.skip === 0 && fm.take === 50 && fm.orderBy.createdAt === 'desc', 'sayfalama + geliş zamanı sırası');
    const gelisTo = fm.where.createdAt.lt.toISOString();
    ok(gelisTo === '2026-09-12T21:00:00.000Z', `to=2026-09-12 → ertesi gün TR başlangıcı (UTC 21:00) (${gelisTo})`);
  }
  // 6b) durum süzgeci karar_bekliyor → ham SQL id listesi + pozitif where
  {
    const { prisma, state } = sahtePrisma({ docs: [], count: () => 0, raw: (sql) => (sql.includes('"duplicateOfId" IS NOT NULL') ? [{ id: 'k1' }, { id: 'k2' }] : []) });
    const svc = new BelgeAkisiService(prisma, fmSahte);
    const r = await svc.akis('t1', { sekme: 'entegrator', durum: 'karar_bekliyor', taxpayerId: 'tp1', yon: 'ALIS', kaynak: 'integration-turmob_efatura,mihsap' });
    const w = state.findMany[0].where;
    ok(w.taxpayerId === 'tp1' && w.invoiceKind === 'ALIS', 'taxpayerId + yon süzgeci');
    ok(JSON.stringify(w.AND).includes('"in":["k1","k2"]'), 'karar bekliyor id listesi where\'e girdi');
    ok(JSON.stringify(w.AND).includes('"in":["integration-turmob_efatura","mihsap"]'), 'kaynak çoklu süzgeç');
    ok(state.raw.some((x) => x.sql.includes('"taxpayerId" = $2') && x.params[1] === 'tp1'), 'karar SQL mükellefe daraltıldı');
    eq(r.toplam, 0, 'boş sonuç');
    let hata = null;
    try { await svc.akis('t1', { durum: 'bilinmeyen' }); } catch (e) { hata = e; }
    ok(hata && /durum geçersiz/.test(hata.message), 'geçersiz durum → 400');
    hata = null;
    try { await svc.akis('t1', { yon: 'X' }); } catch (e) { hata = e; }
    ok(hata && /yon/.test(hata.message), 'geçersiz yon → 400');
  }
  // 6c) silinen sekmesi — AuditLog + silen kişi eşleme
  {
    const t0 = gun(2).getTime();
    const { prisma, state } = sahtePrisma({
      docs: [], count: () => 0,
      taxpayers: [{ id: 'tp1', companyName: 'Demo Ltd' }],
      raw: (sql, params) => {
        if (sql.includes('count(*)::int AS n FROM "audit_logs"')) return [{ n: 2 }];
        if (sql.includes("a.\"resource\" = 'fatura-belge'")) return [
          { id: 'a1', userId: 'u1', resourceId: 'doc-1', oldData: { belgeNo: '9341', invoiceKind: 'ALIS', totalAmount: '4127.43', status: 'READY', taxpayerId: 'tp1', vendorName: 'Satıcı AŞ', source: 'integration-turmob_efatura' }, createdAt: new Date(t0 + 5000), firstName: 'Muzaffer', lastName: 'Ören', email: 'm@x' },
          { id: 'a2', userId: null, resourceId: 'doc-2', oldData: { belgeNo: '55', invoiceKind: 'SATIS', totalAmount: '10.00', status: 'NEEDS_REVIEW' }, createdAt: new Date(t0), firstName: null, lastName: null, email: null },
        ];
        if (sql.includes("a.\"resource\" = 'fatura-muhasebelestirme'")) return [{ userId: 'u9', createdAt: new Date(t0 + 20), firstName: 'Elif', lastName: 'K', email: 'e@x' }];
        return [];
      },
    });
    const svc = new BelgeAkisiService(prisma, fmSahte);
    const r = await svc.akis('t1', { sekme: 'silinen', from: '2026-09-01', q: '93' });
    eq(r.toplam, 2, 'silinen toplam (count sorgusu)');
    const a1 = r.satirlar[0], a2 = r.satirlar[1];
    eq([a1.durum, a1.durumEtiketi, a1.belgeId, a1.belgeNo, a1.yon, a1.tutar, a1.eskiDurum, a1.mukellefAd, a1.kaynak, a1.karsiTaraf, a1.silen], ['silindi', 'Silindi', 'doc-1', '9341', 'ALIS', 4127.43, 'READY', 'Demo Ltd', 'TÜRMOB', 'Satıcı AŞ', { id: 'u1', ad: 'Muzaffer Ören' }], 'silinen satırı (oldData + silen kişi)');
    eq(a2.silen, { id: 'u9', ad: 'Elif K' }, 'userId boş → genel denetim kaydıyla (≤3 sn) eşlenen silen kişi');
    ok(typeof a1.silinmeZamani === 'string' && a1.gelisZamani === null && a1.uyarilar.length === 0 && a1.guven === null, 'silinen satırı: silinmeZamani var, güven/uyarı yok');
    const liste = state.raw.find((x) => x.sql.includes('LEFT JOIN "users"') && x.sql.includes("'fatura-belge'"));
    ok(liste && liste.sql.includes('ILIKE') && liste.params.includes('%93%') && liste.sql.includes('a."createdAt" >= $'), 'silinen: belge no ILIKE + tarih süzgeci parametreli');
  }

  // ── 7) KdvTeyitService (sahte servisler) ──
  console.log('7) KdvTeyitService.teyit');
  const rapor = {
    taxpayer: { id: 'tp1', name: 'Demo' }, periodLabel: 'Mayıs 2026',
    totals: { calculatedVat: 2400, calculatedVatBeyan: 1400, tevkifEdilenVat: 1000, deductibleVat: 1070, deductibleVatTevkifatHaric: 670, kdv2SorumluVat: 400, otherTaxesTotal: 150, salesBase: 12000, purchaseBase: 5600 },
    kaynak: { belge: 6, onaysiz: 2, iptalHaric: 1, mukerrerHaric: 0 },
    drilldown: { hesaplananBelgeler: ['s1'], indirilecekBelgeler: ['a1', 'a2'], onaysizBelgeler: ['a2'], iptalHaricBelgeler: ['x'] },
    hesapAtanmamis: { count: 1, base: 100, vat: 20, total: 120, belgeler: ['a2'] },
    notlar: ['rapor notu'],
  };
  const fmT = { kdvClientReport: async () => rapor };
  const beyanT = { getSonrakiDonemeDevreden: async (t, tp, donem) => (donem === '2026-04' ? { tutar: 300, beyanKaydiId: 'bk1' } : null) };
  const kdvSvc = { kdv1OnHazirlik: async () => ({ sonuc: { hesaplananKdv: 1400, indirilecekKdv: 670, devredenKdv: 300, odenecekKdv: 430, sonrakiAyaDevreden: 0 }, devreden: { kaynak: 'beyanname_pdf' }, satis: { faturaAdet: 3 }, alis: { faturaAdet: 4, tevkifatli: { adet: 1 } }, veriGuveni: 80, eksikVeriler: [] }) };
  const moduleRefT = { get: () => kdvSvc };
  const prismaT = (opts = {}) => ({
    kdvControlSession: { findFirst: async () => (opts.oturumYok ? null : { id: 's1' }) },
    kdvLucaSnapshot: { findUnique: async () => (opts.snapshot === undefined ? { id: 'snap', cekildiAt: new Date(), toplamHesapAdet: 8, hamMizan: rows } : opts.snapshot) },
    mizan: { findFirst: async () => opts.mizan || null },
  });
  {
    const svc = new KdvTeyitService(prismaT(), fmT, beyanT, moduleRefT);
    const r = await svc.teyit('t1', { taxpayerId: 'tp1', period: '2026-05' });
    eq(r.oncekiDonem, '2026-04', 'önceki dönem');
    eq([r.faturaMerkezi.hesaplanan, r.faturaMerkezi.hesaplananBeyan, r.faturaMerkezi.tevkifEdilen, r.faturaMerkezi.indirilecek, r.faturaMerkezi.kdv2Sorumlu, r.faturaMerkezi.devreden, r.faturaMerkezi.odenecek, r.faturaMerkezi.sonrakiDevreden], [2400, 1400, 1000, 1070, 400, 300, 30, 0], 'FM sütunu: ödenecek = 1400 − 1070 − 300 = 30');
    eq([r.kdvKontrol.yok, r.kdvKontrol.hesaplanan, r.kdvKontrol.indirilecek, r.kdvKontrol.devreden, r.kdvKontrol.odenecek], [false, 1400, 670, 300, 430], 'KDV Kontrol sütunu kdv1OnHazirlik.sonuc');
    eq([r.lucaMizan.yok, r.lucaMizan.kaynak, r.lucaMizan.hesaplanan, r.lucaMizan.indirilecek, r.lucaMizan.devreden], [false, 'kdv_luca_snapshot', 2500, 1000, 350], 'Luca mizan sütunu snapshot 391/191/190');
    eq(r.oncekiBeyanname, { yok: false, donem: '2026-04', devreden: 300, beyanKaydiId: 'bk1' }, 'önceki beyanname devreden');
    eq(r.farklar.map((f) => f.satir), ['hesaplanan', 'indirilecek', 'devreden', 'odenecek', 'sonrakiDevreden'], 'fark satırları');
    const hes = r.farklar[0], ind = r.farklar[1], dev = r.farklar[2], od = r.farklar[3];
    eq([hes.fm, hes.kdvKontrol, hes.fark.kdvKontrol.fmEsas, hes.fark.kdvKontrol.uyari, hes.fark.lucaMizan.fmEsas, hes.fark.lucaMizan.mutlak, hes.fark.lucaMizan.uyari], [2400, 1400, 1400, false, 1400, 1100, true], 'hesaplanan: KDV Kontrol/Luca ile beyan tabanı (TAM − tevkif) karşılaştırılır; Luca 2500 → uyarı');
    eq([ind.fm, ind.kdvKontrol, ind.fark.kdvKontrol.fmEsas, ind.fark.kdvKontrol.uyari, ind.fark.kdvKontrol.aciklama, ind.fark.lucaMizan.fmEsas, ind.fark.lucaMizan.mutlak, ind.fark.lucaMizan.uyari], [1070, 670, 670, false, 'FM tevkifat (KDV2) hariç tutarla karşılaştırıldı', 1070, 70, true], 'indirilecek: KDV Kontrol tevkifat-hariç tabanla (fark 0), Luca TAM ile (fark 70)');
    eq([dev.fm, dev.kdvKontrol, dev.lucaMizan, dev.oncekiBeyanname, dev.fark.lucaMizan.mutlak, dev.fark.lucaMizan.uyari, dev.fark.oncekiBeyanname.uyari], [300, 300, 350, 300, 50, true, false], 'devreden satırı 4 kaynak');
    eq([od.fm, od.kdvKontrol, od.fark.kdvKontrol.mutlak, od.fark.kdvKontrol.uyari, od.lucaMizan], [30, 430, 400, true, null], 'ödenecek farkı = KDV2 kısmı (400) → uyarı + not');
    ok(r.notlar.includes('rapor notu') && r.notlar.some((n) => n.includes('KDV2 kısmını')) && r.notlar.some((n) => n.includes('tevkifat SONRASI')), 'notlar: rapor notu + KDV Kontrol tevkifat + Luca 391 notu');
    eq(r.drilldown, rapor.drilldown, 'drilldown rapordan geçer');
    eq([r.uyariSayisi > 0, r.esikTL], [true, 1], 'uyarı sayısı + eşik');
    ok(JSON.stringify(r).length < 200 * 1024, 'yanıt 200 KB altı');
  }
  {
    const svc = new KdvTeyitService(prismaT({ oturumYok: true, snapshot: { id: 'x', cekildiAt: new Date(), hamMizan: { __isletmeGg: true, gelirKdvToplam: 12870, giderKdvToplam: 18846.21 } } }), fmT, { getSonrakiDonemeDevreden: async () => null }, { get: () => { throw new Error('olmamalı'); } });
    const r = await svc.teyit('t1', { taxpayerId: 'tp1', period: '2026-05' });
    eq(r.kdvKontrol, { yok: true, neden: 'KDV Kontrol oturumu yok' }, 'oturum yoksa KDV Kontrol {yok:true} (servis çağrılmaz)');
    eq([r.lucaMizan.tur, r.lucaMizan.hesaplanan, r.lucaMizan.indirilecek, r.lucaMizan.devreden], ['isletme', 12870, 18846.21, null], 'işletme snapshot gelir/gider KDV');
    eq([r.oncekiBeyanname.yok, r.faturaMerkezi.devreden, r.faturaMerkezi.odenecek], [true, null, 330], 'beyanname yok → devreden null, sonuç devreden 0 ile (1400 − 1070)');
    ok(r.farklar[0].kdvKontrol === null && r.farklar[0].fark.kdvKontrol === null && r.farklar[2].fark.oncekiBeyanname === null, 'kaynak yoksa fark null');
    ok(r.notlar.some((n) => n.includes('beyannamesi sistemde yok')), 'devreden yok notu');
  }
  {
    const svc = new KdvTeyitService(prismaT({ snapshot: null, mizan: { id: 'm1', kaynak: 'EXCEL', donemTipi: 'AY', createdAt: new Date(), hesaplar: [{ hesapKodu: '391', alacakBakiye: '99.5' }, { hesapKodu: '191', borcBakiye: '10' }] } }), fmT, beyanT, moduleRefT);
    const r = await svc.teyit('t1', { taxpayerId: 'tp1', period: '2026-05' });
    eq([r.lucaMizan.kaynak, r.lucaMizan.hesaplanan, r.lucaMizan.indirilecek, r.lucaMizan.devreden], ['mizan:EXCEL', 99.5, 10, null], 'snapshot yoksa mizanlar tablosuna düşer');
    let hata = null;
    try { await svc.teyit('t1', { taxpayerId: 'tp1', period: '2026/5' }); } catch (e) { hata = e; }
    ok(hata && /YYYY-MM/.test(hata.message), 'dönem biçimi doğrulanır');
  }

  if (failed) { console.error(`\nbelge-akisi-regression: ${failed} kontrol BAŞARISIZ`); process.exit(1); }
  console.log('\nbelge-akisi-regression ok');
})().catch((e) => { console.error(e); process.exit(1); });
