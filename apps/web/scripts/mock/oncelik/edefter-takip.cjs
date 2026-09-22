// e-Defter berat takibi — öncelikli sahte uçlar (2026-09-22). Yerleşik `/beyanname-takip/ozet` ucunu EZER.
//   GET  /beyanname-takip/ozet?donem=YYYY-MM       → EDEFTER satırı `donemler` ile (Eylül 2026: 2026-05 + 2026-Q2)
//   GET  /beyanname-takip/edefter?donem=&donemTuru= → E-Defter Detayı penceresi verisi (5 mükellef: 3 verildi, 2 verilmedi)
//   POST /portal-automation/dvd-sorgu               → { created, skipped, message } (bellekte iş üretir)
//   GET  /portal-automation/jobs?jobType=DVD_SORGU  → işler; her sorguda zamanla ilerler (pending → running → done)
// Kural: Sıra No 5 Tebliğ — şahıs aylık Mayıs → 10.09, firma aylık Mayıs → 14.09, şahıs 3 aylık Nis–Haz → 10.09, firma → 14.09.

const ISLER = []; // { id, taxpayerId, jobType, status, createdAt, taxpayer, payload }
let isSayaci = 0;

const paket = (vkn, ay, tur, sira, islemOid, alinma, durumKodu = 0, durumAciklama = 'Başarılı') => ({
  belgeTuru: tur,
  etiket: { KB: 'Kebir Beratı', YB: 'Yevmiye Beratı', Y: 'Yevmiye Defteri', K: 'Kebir Defteri' }[tur],
  paketId: `${vkn}-${ay.replace('-', '')}-${tur}-${String(sira).padStart(6, '0')}`,
  islemOid,
  alinmaZamani: alinma,
  durumKodu,
  durumAciklama,
});

/** Bir ay için tam paket seti (KB + YB + Y + K). */
function tamAy(vkn, ay, oidKok, alinma) {
  return {
    ay,
    etiket: ayEtiketi(ay),
    verildi: true,
    belgeler: [
      paket(vkn, ay, 'KB', 0, `${oidKok}01`, alinma),
      paket(vkn, ay, 'YB', 0, `${oidKok}02`, alinma),
      paket(vkn, ay, 'Y', 0, `${oidKok}03`, alinma),
      paket(vkn, ay, 'K', 0, `${oidKok}04`, alinma),
    ],
  };
}

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
function ayEtiketi(ay) {
  const [y, m] = ay.split('-');
  return `${AYLAR[parseInt(m, 10) - 1]} ${y}`;
}

const Q2 = { donem: '2026-Q2', etiket: 'Nis–Haz 2026', tercih: 'UCAYLIK', tebligTarihi: '2026-09-10', uzatildi: false, uzatmaKaynagi: null };
const MAYIS = { donem: '2026-05', etiket: 'Mayıs 2026', tercih: 'AYLIK', tebligTarihi: '2026-09-14', uzatildi: false, uzatmaKaynagi: null };

function mukellefler() {
  return [
    // 1) Perihan Şahin — şahıs, 3 aylık, Nis–Haz 2026 verildi (10.09)
    {
      taxpayerId: 'edf-perihan', ad: 'PERİHAN ŞAHİN', taxNumber: '27412345678', tip: 'SAHIS', tipEtiketi: 'Gelir Vergisi',
      tercih: 'UCAYLIK', tercihEtiketi: '3 Aylık', baslangic: null,
      donemler: [{
        ...Q2, sonGun: '2026-09-10', verildi: true, elleIsaretli: false, sonYukleme: '2026-09-08T13:05:00.000Z',
        aylar: [
          tamAy('27412345678', '2026-04', '20260908-7A1', '2026-09-08T12:41:00.000Z'),
          tamAy('27412345678', '2026-05', '20260908-7A2', '2026-09-08T12:52:00.000Z'),
          tamAy('27412345678', '2026-06', '20260908-7A3', '2026-09-08T13:05:00.000Z'),
        ],
      }],
      verildi: true,
      sonSorgu: { sorguTarihi: '2026-09-22T03:12:00.000Z', hata: null, paketSayisi: 12, kaynak: 'nightly' },
      sonYukleme: '2026-09-08T13:05:00.000Z',
    },
    // 2) Petravet Ltd — firma, 3 aylık, Nis–Haz 2026 verildi (14.09)
    {
      taxpayerId: 'edf-petravet', ad: 'PETRAVET VETERİNER HİZMETLERİ LTD. ŞTİ.', taxNumber: '7290456123', tip: 'FIRMA', tipEtiketi: 'Kurumlar Vergisi',
      tercih: 'UCAYLIK', tercihEtiketi: '3 Aylık', baslangic: null,
      donemler: [{
        ...Q2, tebligTarihi: '2026-09-14', sonGun: '2026-09-14', verildi: true, elleIsaretli: false, sonYukleme: '2026-09-12T09:18:00.000Z',
        aylar: [
          tamAy('7290456123', '2026-04', '20260912-3C1', '2026-09-12T08:47:00.000Z'),
          tamAy('7290456123', '2026-05', '20260912-3C2', '2026-09-12T09:02:00.000Z'),
          tamAy('7290456123', '2026-06', '20260912-3C3', '2026-09-12T09:18:00.000Z'),
        ],
      }],
      verildi: true,
      sonSorgu: { sorguTarihi: '2026-09-22T03:14:00.000Z', hata: null, paketSayisi: 12, kaynak: 'nightly' },
      sonYukleme: '2026-09-12T09:18:00.000Z',
    },
    // 3) Edeler Yemek Ltd — firma, aylık, Mayıs 2026 verildi (14.09 14:42)
    {
      taxpayerId: 'edf-edeler', ad: 'EDELER YEMEK ÜRETİM GIDA LTD. ŞTİ.', taxNumber: '3241199696', tip: 'FIRMA', tipEtiketi: 'Kurumlar Vergisi',
      tercih: 'AYLIK', tercihEtiketi: 'Aylık', baslangic: '2025-01',
      donemler: [{
        ...MAYIS, sonGun: '2026-09-14', verildi: true, elleIsaretli: false, sonYukleme: '2026-09-14T11:42:00.000Z',
        aylar: [tamAy('3241199696', '2026-05', '20260914-9F0', '2026-09-14T11:42:00.000Z')],
      }],
      verildi: true,
      sonSorgu: { sorguTarihi: '2026-09-22T03:16:00.000Z', hata: null, paketSayisi: 4, kaynak: 'nightly' },
      sonYukleme: '2026-09-14T11:42:00.000Z',
    },
    // 4) Ak Yapı — firma, aylık, Mayıs 2026 VERİLMEDİ (hiç paket yok; son sorgu hatalı)
    {
      taxpayerId: 'edf-akyapi', ad: 'AK YAPI İNŞAAT TAAHHÜT LTD. ŞTİ.', taxNumber: '0120987654', tip: 'FIRMA', tipEtiketi: 'Kurumlar Vergisi',
      tercih: 'AYLIK', tercihEtiketi: 'Aylık', baslangic: null,
      donemler: [{
        ...MAYIS, sonGun: '2026-09-14', verildi: false, elleIsaretli: false, sonYukleme: null,
        aylar: [{ ay: '2026-05', etiket: 'Mayıs 2026', verildi: false, belgeler: [] }],
      }],
      verildi: false,
      sonSorgu: { sorguTarihi: '2026-09-22T03:18:00.000Z', hata: 'Dijital Vergi Dairesi girişi başarısız: kullanıcı kodu veya şifre hatalı', paketSayisi: 0, kaynak: 'nightly' },
      sonYukleme: null,
    },
    // 5) Mehmet Kaya — şahıs, 3 aylık, Nis–Haz 2026 VERİLMEDİ (Nisan + Mayıs tam, Haziran yevmiye beratı eksik)
    {
      taxpayerId: 'edf-mkaya', ad: 'MEHMET KAYA', taxNumber: '12345678901', tip: 'SAHIS', tipEtiketi: 'Gelir Vergisi',
      tercih: 'UCAYLIK', tercihEtiketi: '3 Aylık', baslangic: null,
      donemler: [{
        ...Q2, sonGun: '2026-09-10', verildi: false, elleIsaretli: false, sonYukleme: '2026-09-10T16:20:00.000Z',
        aylar: [
          tamAy('12345678901', '2026-04', '20260910-5B1', '2026-09-10T15:40:00.000Z'),
          tamAy('12345678901', '2026-05', '20260910-5B2', '2026-09-10T15:58:00.000Z'),
          {
            ay: '2026-06', etiket: 'Haziran 2026', verildi: false,
            belgeler: [
              paket('12345678901', '2026-06', 'KB', 0, '20260910-5B301', '2026-09-10T16:20:00.000Z'),
              paket('12345678901', '2026-06', 'YB', 0, '20260910-5B302', '2026-09-10T16:21:00.000Z', 2, 'Şema doğrulama hatası: imza geçersiz'),
              paket('12345678901', '2026-06', 'Y', 0, '20260910-5B303', '2026-09-10T16:19:00.000Z'),
            ],
          },
        ],
      }],
      verildi: false,
      sonSorgu: null,
      sonYukleme: '2026-09-10T16:20:00.000Z',
    },
  ];
}

function edefterDetay(donem, donemTuru) {
  const liste = mukellefler();
  let toplam = 0;
  let verilen = 0;
  for (const m of liste) for (const d of m.donemler) { toplam++; if (d.verildi) verilen++; }
  return {
    donem: donem || '2026-09',
    donemTuru: donemTuru === 'VERGI' ? 'VERGI' : 'VERILME',
    mukellefler: liste,
    ozet: { toplam, verilen, kalan: toplam - verilen, mukellef: liste.length, verilenMukellef: liste.filter((m) => m.verildi).length },
  };
}

/** İş durumu: yaşına göre ilerler (0–4 sn bekliyor, 4–9 sn sürüyor, sonra bitti; 'edf-akyapi' hatalı biter). */
function isGorunumu(is) {
  const yas = Date.now() - is.createdAt;
  let status = 'pending';
  if (yas > 9000) status = is.taxpayerId === 'edf-akyapi' ? 'failed' : 'done';
  else if (yas > 4000) status = 'running';
  return {
    ...is,
    status,
    payload: { sorgular: ['eDefter'], progress: { message: status === 'running' ? 'e-Defter paket listesi çekiliyor (2026-04 … 2026-06)' : status === 'done' ? 'Tamamlandı' : status === 'failed' ? 'Giriş başarısız' : 'Sırada' } },
    errorMessage: status === 'failed' ? 'Dijital Vergi Dairesi girişi başarısız: kullanıcı kodu veya şifre hatalı' : null,
    finishedAt: status === 'done' || status === 'failed' ? new Date(is.createdAt + 9000).toISOString() : null,
  };
}

function uclar(yol, yontem, q, govde, jsonGonder, res) {
  if (yontem === 'GET' && yol === '/beyanname-takip/ozet') {
    const donem = q.donem || '2026-09';
    const donemTuru = q.donemTuru === 'VERGI' ? 'VERGI' : 'VERILME';
    const vergiDonem = donemTuru === 'VERGI' ? donem : '2026-08';
    const satir = (beyanTipi, toplam, onaylanan, bekleyen, hatali, kalan) => ({
      beyanTipi, toplam, onaylanan, bekleyen, hatali, muaf: 0, kalan, vergiDonem, donemler: [vergiDonem],
      yuzde: toplam > 0 ? Math.round((onaylanan / toplam) * 100) : 0,
    });
    return jsonGonder(res, 200, {
      donem, donemTuru,
      rows: [
        satir('KDV1', 65, 33, 4, 1, 27),
        satir('KDV2', 3, 3, 0, 0, 0),
        satir('DAMGA', 1, 0, 0, 0, 1),
        satir('MUHSGK', 33, 19, 2, 0, 12),
        satir('BILDIRGE', 39, 11, 0, 0, 28),
        // e-Defter (berat takvimi): Eylül 2026 → aylık Mayıs 2026 + 3 aylık Nis–Haz 2026; 5 mükellef, 3 verildi, 2 kalan
        { beyanTipi: 'EDEFTER', toplam: 5, onaylanan: 3, bekleyen: 0, hatali: 0, muaf: 0, kalan: 2, vergiDonem: donemTuru === 'VERGI' ? donem : '2026-05', donemler: donemTuru === 'VERGI' ? [donem, `${donem.slice(0, 4)}-Q${Math.ceil(parseInt(donem.slice(5), 10) / 3)}`] : ['2026-05', '2026-Q2'], yuzde: 60 },
        satir('GGECICI', 0, 0, 0, 0, 0),
      ],
    });
  }

  if (yontem === 'GET' && yol === '/beyanname-takip/edefter') {
    return jsonGonder(res, 200, edefterDetay(q.donem, q.donemTuru));
  }

  if (yontem === 'POST' && yol === '/portal-automation/dvd-sorgu') {
    const ids = Array.isArray(govde.taxpayerIds) && govde.taxpayerIds.length ? govde.taxpayerIds : mukellefler().map((m) => m.taxpayerId);
    const adlar = Object.fromEntries(mukellefler().map((m) => [m.taxpayerId, m.ad]));
    const created = [];
    const skipped = [];
    for (const taxpayerId of ids) {
      if (taxpayerId === 'edf-mkaya') { skipped.push({ taxpayerId, reason: 'Dijital Vergi Dairesi şifresi tanımlı değil' }); continue; }
      const is = { id: `dvd-${++isSayaci}`, taxpayerId, jobType: 'DVD_SORGU', createdAt: Date.now(), taxpayer: { companyName: adlar[taxpayerId] || taxpayerId, firstName: null, lastName: null } };
      ISLER.unshift(is);
      created.push({ id: is.id, taxpayerId, jobType: 'DVD_SORGU' });
    }
    return jsonGonder(res, 201, { created, skipped, message: `${created.length} mükellef için e-Defter sorgusu kuyruğa alındı` });
  }

  if (yontem === 'GET' && yol === '/portal-automation/jobs' && q.jobType === 'DVD_SORGU') {
    const limit = Math.max(1, Math.min(200, Number(q.limit) || 50));
    return jsonGonder(res, 200, ISLER.slice(0, limit).map(isGorunumu));
  }

  return false;
}

module.exports = { uclar };
