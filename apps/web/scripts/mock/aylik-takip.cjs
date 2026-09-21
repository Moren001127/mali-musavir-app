// Aylık Takip Listesi (/panel/mukellefler) — beyaz tema önizlemesi için sahte veri (2026-09-21).
//
// Yerleşik `GET /taxpayers` ucu monthlyStatus döndürmediği için aşama verili liste
// `GET /sahte/aylik-takip/taxpayers?year&month&search` olarak sunulur; önizleme betiği
// (scripts/onizleme/aylik-takip-goruntule.cjs) tarayıcı isteğini bu uca yönlendirir.
// Aşama işaretleri ve notlar (PATCH /taxpayers/:id/monthly-status) bellekte tutulur.

const { MUKELLEFLER, mukellefAdi } = require('./mukellef-listesi.cjs');

const BOS = () => ({
  evraklarGeldi: false, yuklendi: false, evraklarIslendi: false, kontrolEdildi: false, beyannameVerildi: false,
  kdvKontrolEdildi: false, indirilecekKdvKontrol: false, hesaplananKdvKontrol: false, eArsivKontrol: false, notes: null,
});
const asama = (seviye, notes = null) => {
  const s = BOS();
  if (seviye >= 1) s.evraklarGeldi = true;
  if (seviye >= 2) s.yuklendi = true;
  if (seviye >= 3) s.evraklarIslendi = true;
  if (seviye >= 4) { s.indirilecekKdvKontrol = true; s.hesaplananKdvKontrol = true; }
  if (seviye >= 5) { s.eArsivKontrol = true; s.kontrolEdildi = true; s.kdvKontrolEdildi = true; }
  if (seviye >= 6) s.beyannameVerildi = true;
  s.notes = notes;
  return s;
};

/** Gerçekçi dağılım: evrak bekleniyor 5 · yükleme 3 · işleme 4 · kontrol 2 · beyanname verilebilir 2 · verildi 5 */
const DURUM = {
  m1: asama(6), m2: asama(0, 'Evrak WhatsApp ile istendi'), m3: asama(2), m4: asama(3), m5: asama(6),
  m7: asama(4, 'Hesaplanan KDV tutarı Luca ile uyuşmuyor'), m8: asama(1), m9: asama(6), m10: asama(0), m11: asama(3),
  m12: asama(5), m13: asama(1), m16: asama(6), m17: asama(0), m18: asama(3),
  m19: asama(2), m20: asama(5, 'Beyanname için onay bekleniyor'), m21: asama(6), m22: asama(0), m23: asama(3),
  m25: asama(4),
};

/** Profil tamamlık özeti — birkaç eksik/kritik kayıt */
const TAMLIK = {
  m3: { score: 62, durum: 'EKSIK', eksikSayisi: 4, kritikEksikSayisi: 0 },
  m8: { score: 48, durum: 'KRITIK_EKSIK', eksikSayisi: 6, kritikEksikSayisi: 2 },
  m9: { score: 74, durum: 'EKSIK', eksikSayisi: 3, kritikEksikSayisi: 0 },
  m13: { score: 86, durum: 'IYI', eksikSayisi: 2, kritikEksikSayisi: 0 },
  m18: { score: 70, durum: 'EKSIK', eksikSayisi: 3, kritikEksikSayisi: 0 },
  m22: { score: 55, durum: 'EKSIK', eksikSayisi: 5, kritikEksikSayisi: 1 },
};

function aramaUyar(m, arama) {
  if (!arama) return true;
  const a = String(arama).toLocaleLowerCase('tr-TR');
  return [mukellefAdi(m), m.taxNumber, m.taxOffice].some((v) => String(v || '').toLocaleLowerCase('tr-TR').includes(a));
}

function uclar(yol, yontem, q, govde, jsonGonder, res) {
  if (yontem === 'GET' && yol === '/sahte/aylik-takip/taxpayers') {
    const liste = MUKELLEFLER.filter((m) => m.isActive && aramaUyar(m, q.search)).map((m) => ({ ...m, monthlyStatus: DURUM[m.id] || null }));
    return jsonGonder(res, 200, liste);
  }
  if (yontem === 'GET' && yol === '/taxpayers/completeness/summary') {
    return jsonGonder(res, 200, {
      taxpayers: MUKELLEFLER.map((m) => ({ id: m.id, ...(TAMLIK[m.id] || { score: 100, durum: 'TAM', eksikSayisi: 0, kritikEksikSayisi: 0 }) })),
    });
  }
  const ms = /^\/taxpayers\/([^/]+)\/monthly-status$/.exec(yol);
  if (ms && yontem === 'PATCH') {
    const id = ms[1];
    const { year, month, ...yama } = govde || {};
    DURUM[id] = { ...(DURUM[id] || BOS()), ...yama };
    console.log('[mock] aylık takip', id, `${year}-${month}`, JSON.stringify(yama));
    return jsonGonder(res, 200, { id: `ms-${id}`, taxpayerId: id, year, month, ...DURUM[id] });
  }
  return false;
}

module.exports = { uclar };
