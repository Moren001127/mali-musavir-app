// SGK Bildirge "çalışan var / yok" — öncelikli sahte uçlar (2026-09-22).
//   GET /beyanname-takip/detay?donem=&donemTuru=              → mükellef başına beyanlar (BILDIRGE + KDV1 + MUHSGK)
//   PUT /beyanname-takip/bildirge-calisan/:taxpayerId/:donem  { calisanVar } → bellekte işaret (Yok → onaylandi + calisanYok)
// Gerçek mantık: apps/api/src/beyanname-takip/beyanname-takip.service.ts bildirgeCalisanDurumu.
const MUKELLEFLER = [
  ['bc1', 'ADEM CAN'], ['bc2', 'AYHAN BOZOĞLU'], ['bc3', 'DOĞAN ÖZKAN'], ['bc4', 'ERCAN ÖZTAMUR'],
  ['bc5', 'ERCAN SANLAV'], ['bc6', 'ERDOĞAN BALÇIK'], ['bc7', 'FAMCOFFEE GIDA SANAYİ VE TİCARET LTD. ŞTİ.'], ['bc8', 'SEDA İŞ GÜVENLİĞİ LTD. ŞTİ.'],
];
// Gerçekten verilmiş (SGK fişi inmiş) mükellefler
const VERILMIS = new Set(['bc7', 'bc8']);
// taxpayerId::donem → çalışan yok işareti
const CALISAN_YOK = new Set(['bc5::2026-08']);

function vergiDonemi(donem, donemTuru) {
  if (donemTuru === 'VERGI') return donem;
  const [y, m] = donem.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function uclar(yol, yontem, q, govde, jsonGonder, res) {
  if (yontem === 'GET' && yol === '/beyanname-takip/detay') {
    const donem = q.donem || '2026-09';
    const vd = vergiDonemi(donem, q.donemTuru === 'VERGI' ? 'VERGI' : 'VERILME');
    const rows = MUKELLEFLER.map(([id, ad], i) => {
      const calisanYok = CALISAN_YOK.has(`${id}::${vd}`);
      const verildi = VERILMIS.has(id) || calisanYok;
      return {
        taxpayerId: id,
        ad,
        beyanlar: [
          { beyanTipi: 'KDV1', durum: i % 3 === 0 ? 'kalan' : 'onaylandi', vergiDonem: vd, tahakkukTutari: i % 3 === 0 ? null : 1250.5 * (i + 1), onayTarihi: i % 3 === 0 ? null : `${donem}-18T10:00:00.000Z` },
          { beyanTipi: 'MUHSGK', durum: i % 2 === 0 ? 'kalan' : 'onaylandi', vergiDonem: vd, tahakkukTutari: null, onayTarihi: null },
          {
            beyanTipi: 'BILDIRGE',
            durum: verildi ? 'onaylandi' : 'kalan',
            vergiDonem: vd,
            tahakkukTutari: VERILMIS.has(id) ? 18420.75 : null,
            onayTarihi: VERILMIS.has(id) ? `${donem}-20T09:30:00.000Z` : calisanYok ? `${donem}-21T14:05:00.000Z` : null,
            calisanYok,
          },
        ],
      };
    });
    return jsonGonder(res, 200, rows);
  }

  const m = /^\/beyanname-takip\/bildirge-calisan\/([^/]+)\/(\d{4}-\d{2})$/.exec(yol);
  if (m && yontem === 'PUT') {
    const anahtar = `${m[1]}::${m[2]}`;
    if (govde.calisanVar === false) {
      if (VERILMIS.has(m[1])) return jsonGonder(res, 200, { calisanYok: false, degisti: false, neden: 'Bu dönemin bildirgesi zaten verilmiş görünüyor.' });
      CALISAN_YOK.add(anahtar);
      return jsonGonder(res, 200, { calisanYok: true, degisti: true });
    }
    const vardi = CALISAN_YOK.delete(anahtar);
    return jsonGonder(res, 200, { calisanYok: false, degisti: vardi });
  }
  return false;
}

module.exports = { uclar };
