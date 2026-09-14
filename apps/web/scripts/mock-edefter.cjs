/**
 * SAHTE API — e-Defter Kontrol uçları (yalnız tarayıcı önizlemesi; mock-api.cjs bunu yükler).
 *
 *   Gerçek veriyle çalıştırmak için (üretim DB'den salt-okunur dökülmüş JSON):
 *     SAHTE_EDEFTER_FIXTURE=C:\...\oturum.json   → { taxpayer, session:{...,findings,lines,kontrolOzeti}, mizan:{...,anomaliler,hesapCount} }
 *     SAHTE_EDEFTER_KATALOG=C:\...\katalog.json  → KURAL_KATALOGU dizisi (apps/api/src/edefter-control/kural-katalogu.ts)
 *   Tanımsızsa küçük yerleşik örnek servis edilir.
 *
 * Kapsam: GET /edefter-control?taxpayerId · GET /edefter-control/rule-settings · PATCH rule-settings/:code
 *         GET /edefter-control/:id · PATCH /edefter-control/:sid/findings/:fid · POST /edefter-control/:id/reanalyze
 *         Bulgu durumu bellek içinde değişir; sunucu yeniden başlayınca sıfırlanır.
 */
const fs = require('node:fs');

function jsonOku(yol) {
  if (!yol) return null;
  try { return JSON.parse(fs.readFileSync(yol, 'utf8')); } catch (e) { console.error('[mock-edefter] okunamadı', yol, e.message); return null; }
}

// ── Yerleşik küçük örnek (fixture yoksa) ──
function yerlesikOrnek() {
  const simdi = new Date().toISOString();
  const taxpayer = { id: 'm-edefter', type: 'TUZEL_KISI', companyName: 'Örnek Nakliyat Ltd. Şti.', firstName: null, lastName: null, taxNumber: '0000000000', defterTuru: 'BILANCO', status: 'active' };
  const session = {
    id: 's-ornek', tenantId: 'moren', taxpayerId: taxpayer.id, donem: '2026-Q2', donemTipi: 'GECICI_Q2', kaynak: 'LUCA', status: 'READY',
    totalLines: 3, totalVouchers: 2, findingCount: 3, rawExcelSize: 0, notes: null, createdBy: 'sahte', createdAt: simdi, updatedAt: simdi,
    kontrolOzeti: null, lines: [], taxpayer,
    findings: [
      { id: 'f1', sessionId: 's-ornek', severity: 'INFO', category: 'OZELLIKLI_549_YENILEME_FONU', hesapKodu: '549', message: "549 Ozel Fonlar'da 988.131,88 TL bakiye var. Yenileme fonu ise 3 yil icinde kullanilmali.", detail: { tutar: 988131.88 }, status: 'OPEN', createdAt: simdi },
      { id: 'f2', sessionId: 's-ornek', severity: 'WARN', category: 'CARI_320_ODEME_YOK', hesapKodu: '320.01.001', message: '320.01.001 ÖRNEK SATICI: dönemde 4 alış faturası (510.400,00 TL) işlenmiş, ödeme kaydı yok', detail: { tutar: 510400, hesapAdi: 'ÖRNEK SATICI' }, status: 'OPEN', createdAt: simdi },
      { id: 'f3', sessionId: 's-ornek', severity: 'ERROR', category: 'DEFTER_GENELI_DENGESIZ', hesapKodu: null, message: 'Toplam borç ile alacak eşit değil (fark 12,00 TL)', detail: { tutar: 12 }, status: 'OPEN', createdAt: simdi },
    ],
  };
  const mizan = { id: 'mz-ornek', donem: '2026-Q2', donemTipi: 'GECICI_Q2', status: 'READY', createdAt: simdi, updatedAt: simdi, hesapCount: 12, anomaliler: [
    { id: 'a1', mizanId: 'mz-ornek', hesapKodu: '191.03.001', tip: 'ZIT_BAKIYE', seviye: 'WARN', mesaj: '191.03.001 "SATIŞTAN İADE İND KDV %20" normalde borç bakiyesi verir ama alacak bakiyesi var', detay: null },
  ] };
  return { taxpayer, session, mizan };
}

const fixture = jsonOku(process.env.SAHTE_EDEFTER_FIXTURE) || yerlesikOrnek();
const katalog = jsonOku(process.env.SAHTE_EDEFTER_KATALOG) || [];
const ayarlar = new Map(); // kod → active
// Manuel (ofis) kuralları — bellek içi; katalogda MANUEL:<id> olarak da görünür (ekran gruplama/etiket)
const manuelKurallar = [];
let manuelSayac = 0;
function manuelTanim(k) {
  return { kod: `MANUEL:${k.id}`, ad: k.ad, aciklama: `${k.hesap} hesabında ${k.kosul}`, oneri: '', siddet: k.seviye, alan: 'Manuel Kurallar', mevzuat: 'Ofis kuralı', varsayilanAktif: k.aktif, mizanGerekli: k.kaynak === 'MIZAN', motor: 'MANUEL' };
}

function ozet(s) {
  const { findings, lines, kontrolOzeti, ...rest } = s;
  return { ...rest, _count: { lines: (lines || []).length, findings: (findings || []).length } };
}

/** /taxpayers yanıtına eklenecek mükellef (Bilanço türü şart — ekran süzüyor) */
function edefterMukellefler() {
  return [fixture.taxpayer];
}

/** Eşleşirse yanıt verir, eşleşmezse false döner (mock-api.cjs akışı devam eder). */
function edefterUclari(yol, yontem, q, govde, jsonGonder, res) {
  if (yontem === 'GET' && yol === '/edefter-control') {
    const liste = !q.taxpayerId || q.taxpayerId === fixture.session.taxpayerId ? [ozet(fixture.session)] : [];
    return jsonGonder(res, 200, liste);
  }
  if (yontem === 'GET' && yol === '/edefter-control/rule-settings') {
    return jsonGonder(res, 200, {
      settings: [...ayarlar.entries()].map(([code, active]) => ({ code, active })),
      defaultDisabledCodes: katalog.filter((k) => k && k.varsayilanAktif === false).map((k) => k.kod),
      catalog: [...katalog, ...manuelKurallar.map(manuelTanim)],
      manuelKurallar,
    });
  }
  // ── Manuel kurallar (bellek içi CRUD) ──
  if (yol === '/edefter-control/manuel-kurallar') {
    if (yontem === 'GET') return jsonGonder(res, 200, manuelKurallar);
    if (yontem === 'POST') {
      if (!String(govde.ad || '').trim()) return jsonGonder(res, 400, { message: 'Kural adı boş olamaz' });
      if (!String(govde.hesap || '').trim()) return jsonGonder(res, 400, { message: 'Hesap kodu boş olamaz (örn. 500 veya 320.01)' });
      const k = { id: `mk${++manuelSayac}`, aktif: true, ...govde, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      manuelKurallar.push(k);
      return jsonGonder(res, 200, k);
    }
  }
  {
    const m = /^\/edefter-control\/manuel-kurallar\/([^/]+)$/.exec(yol);
    if (m) {
      const i = manuelKurallar.findIndex((k) => k.id === m[1]);
      if (i < 0) return jsonGonder(res, 404, { message: 'Manuel kural bulunamadi' });
      if (yontem === 'PATCH') { Object.assign(manuelKurallar[i], govde, { updatedAt: new Date().toISOString() }); return jsonGonder(res, 200, manuelKurallar[i]); }
      if (yontem === 'DELETE') { const [k] = manuelKurallar.splice(i, 1); return jsonGonder(res, 200, { ok: true, id: k.id }); }
    }
  }
  {
    const m = /^\/edefter-control\/rule-settings\/([^/]+)$/.exec(yol);
    if (yontem === 'PATCH' && m) { ayarlar.set(decodeURIComponent(m[1]), Boolean(govde.active)); return jsonGonder(res, 200, { ok: true }); }
  }
  {
    const m = /^\/edefter-control\/([^/]+)\/findings\/([^/]+)$/.exec(yol);
    if (yontem === 'PATCH' && m) {
      const f = (fixture.session.findings || []).find((x) => x.id === m[2]);
      if (!f) return jsonGonder(res, 404, { message: 'bulgu yok' });
      f.status = govde.status || 'OPEN';
      if (govde.note != null) f.detail = { ...(f.detail || {}), note: govde.note };
      return jsonGonder(res, 200, f);
    }
  }
  {
    const m = /^\/edefter-control\/([^/]+)\/reanalyze$/.exec(yol);
    if (yontem === 'POST' && m) return jsonGonder(res, 200, { ...fixture.session, companionMizan: fixture.mizan });
  }
  if (yontem === 'GET' && yol.startsWith('/edefter-control/luca-job/')) return jsonGonder(res, 404, { message: 'sahte: luca işi yok' });
  {
    const m = /^\/edefter-control\/([^/]+)$/.exec(yol);
    if (yontem === 'GET' && m) {
      if (m[1] !== fixture.session.id) return jsonGonder(res, 404, { message: 'oturum yok' });
      return jsonGonder(res, 200, { ...fixture.session, companionMizan: fixture.mizan });
    }
  }
  return false;
}

module.exports = { edefterUclari, edefterMukellefler };
