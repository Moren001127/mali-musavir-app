// Sahte API eklentisi — "ofis grubu" ikinci tur beyaz tema görüntüleri (2026-09-21):
// Cari Kasa & Tahsilat (ozet / ajanda / hizmet / ekstre / istatistik / otomasyon planı / hesaplar),
// Mükellef Portal Erişimi (portal/admin/taxpayers/:id/access), HGS İhlal (galeri/*), Duyurular gönderim ucu.
// Yerleşik uçlara (/cari-kasa/hareket, /cari-kasa/bakiye/:id, /taxpayers, /aylik-odeme*, /akilli-bildirim/*) dokunulmaz;
// bunlar mock-api.cjs'te. Eşleşmezse `false` döner.
const gun = (n) => new Date(Date.now() + n * 86400000).toISOString();
const ay = (n) => { const d = new Date(); d.setMonth(d.getMonth() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

// ── Cari Kasa: özet satırları (id'ler /taxpayers ile uyumlu: m1..m8 + ek tx-*) ──
const CARI = [
  { id: 'm1', ad: 'Öz Ela Gıda San. ve Tic. Ltd. Şti.', taxNumber: '6420011234', phone: '0533 111 22 33', email: 'info@ozela.com', ucret: 8000, tahakkuk: 96000, tahsilat: 84000, buAy: 0, sonTahsilat: -41, aging: { current: 0, d1_30: 4000, d31_60: 8000, d61_90: 0, d90plus: 0 }, wa: true },
  { id: 'm2', ad: 'Erdoğan Balçık', taxNumber: '14523698745', phone: '0533 923 36 74', email: 'erdogan@ornek.com', ucret: 4500, tahakkuk: 54000, tahsilat: 54000, buAy: 4500, sonTahsilat: -3, aging: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 }, wa: true },
  { id: 'm3', ad: 'Ayşegül Kaya', taxNumber: '25874136982', phone: null, email: null, ucret: 3500, tahakkuk: 42000, tahsilat: 24500, buAy: 0, sonTahsilat: -160, aging: { current: 0, d1_30: 3500, d31_60: 3500, d61_90: 3500, d90plus: 7000 }, wa: false },
  { id: 'm4', ad: 'Mert Reklam Ajansı Ltd. Şti.', taxNumber: '6170045678', phone: '0532 444 55 66', email: 'mert@reklam.com', ucret: 6500, tahakkuk: 78000, tahsilat: 52000, buAy: 0, sonTahsilat: -120, aging: { current: 0, d1_30: 6500, d31_60: 6500, d61_90: 6500, d90plus: 6500 }, wa: true },
  { id: 'm5', ad: 'Famcoffee Kahve A.Ş.', taxNumber: '3850098765', phone: '0535 777 88 99', email: 'muhasebe@famcoffee.com', ucret: 12000, tahakkuk: 144000, tahsilat: 132000, buAy: 12000, sonTahsilat: -6, aging: { current: 12000, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 }, wa: true },
  { id: 'm6', ad: 'Ela Tekstil Ltd. Şti.', taxNumber: '3250076543', phone: '0536 222 33 44', email: null, ucret: 7000, tahakkuk: 84000, tahsilat: 70000, buAy: 0, sonTahsilat: -65, aging: { current: 0, d1_30: 7000, d31_60: 7000, d61_90: 0, d90plus: 0 }, wa: true },
  { id: 'm7', ad: 'Balçık İnşaat A.Ş.', taxNumber: '1400032109', phone: '0533 923 36 74', email: 'info@balcik.com', ucret: 15000, tahakkuk: 180000, tahsilat: 180000, buAy: 15000, sonTahsilat: -2, aging: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 }, wa: true },
  { id: 'm8', ad: 'Dilek Bayageldi', taxNumber: '36985214778', phone: '0537 999 00 11', email: 'dilek@ornek.com', ucret: 3000, tahakkuk: 36000, tahsilat: 33000, buAy: 3000, sonTahsilat: -9, aging: { current: 3000, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 }, wa: true },
  { id: 'tx-14', ad: 'KAYATAN MİMARLIK İNŞAAT SANAYİ TİCARET LİMİTED ŞİRKETİ', taxNumber: '5310098821', phone: '0532 100 20 30', email: null, ucret: 9500, tahakkuk: 114000, tahsilat: 1000, buAy: 0, sonTahsilat: -400, aging: { current: 0, d1_30: 9500, d31_60: 9500, d61_90: 9500, d90plus: 84500 }, wa: true },
  { id: 'tx-15', ad: 'YGS PLASTİK GIDA EMLAK SANAYİ İÇ VE DIŞ TİCARET LİMİTED ŞİRKETİ', taxNumber: '9440012345', phone: null, email: 'ygs@plastik.com', ucret: 8500, tahakkuk: 102000, tahsilat: 0, buAy: 0, sonTahsilat: null, aging: { current: 0, d1_30: 8500, d31_60: 8500, d61_90: 8500, d90plus: 76500 }, wa: false },
  { id: 'tx-4', ad: 'NMS LOJİSTİK TİCARET VE SANAYİ LİMİTED ŞİRKETİ', taxNumber: '6310077654', phone: '0538 300 40 50', email: null, ucret: 11000, tahakkuk: 132000, tahsilat: 38500, buAy: 0, sonTahsilat: -95, aging: { current: 0, d1_30: 11000, d31_60: 11000, d61_90: 11000, d90plus: 60500 }, wa: true },
  { id: 'tx-2', ad: 'YILMAZ GÖKTAŞ İNŞAAT VE GIDA SANAYİ TİCARET LİMİTED ŞİRKETİ', taxNumber: '9650011122', phone: '0539 400 50 60', email: null, ucret: 6000, tahakkuk: 72000, tahsilat: 60000, buAy: 0, sonTahsilat: -48, aging: { current: 0, d1_30: 6000, d31_60: 6000, d61_90: 0, d90plus: 0 }, wa: true },
  { id: 'tx-10', ad: 'SABRİ AKSOY', taxNumber: '12345678901', phone: '0531 500 60 70', email: 'sabri@aksoy.com', ucret: 2500, tahakkuk: 30000, tahsilat: 27500, buAy: 2500, sonTahsilat: -4, aging: { current: 2500, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 }, wa: true },
  { id: 'tx-21', ad: 'ARNAVUTKÖY OTO YIKAMA — HÜSEYİN DEMİR', taxNumber: '23456789012', phone: '0534 600 70 80', email: null, ucret: 2000, tahakkuk: 24000, tahsilat: 22000, buAy: 0, sonTahsilat: -20, aging: { current: 0, d1_30: 2000, d31_60: 0, d61_90: 0, d90plus: 0 }, wa: true },
];
const bucket = (a) => (a.d90plus > 0 ? '90+' : a.d61_90 > 0 ? '61-90' : a.d31_60 > 0 ? '31-60' : a.d1_30 > 0 ? '1-30' : a.current > 0 ? 'Güncel' : 'Yok');
const ozet = () => CARI.map((c) => ({ id: c.id, ad: c.ad, taxNumber: c.taxNumber, phone: c.phone, email: c.email, aylikMuhasebeUcreti: c.ucret, tahakkuk: c.tahakkuk, tahsilat: c.tahsilat, bakiye: c.tahakkuk - c.tahsilat, buAyTahsilat: c.buAy }));
const ajanda = () => {
  const rows = CARI.map((c) => ({ id: c.id, ad: c.ad, taxNumber: c.taxNumber, phone: c.phone, bakiye: c.tahakkuk - c.tahsilat, maxBucket: bucket(c.aging), aging: c.aging, sonTahsilatTarihi: c.sonTahsilat == null ? null : gun(c.sonTahsilat), sonHatirlatmaTarihi: c.aging.d31_60 > 0 ? gun(-12) : null, telefonVar: !!c.phone, whatsappUygun: c.wa }));
  const totals = rows.reduce((t, r) => { for (const k of Object.keys(t)) t[k] += r.aging[k]; return t; }, { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 });
  return { toplamBakiye: rows.reduce((t, r) => t + Math.max(r.bakiye, 0), 0), totals, rows };
};
const HIZMETLER = [
  { id: 'hz1', hizmetAdi: 'Aylık muhasebe ücreti', tutar: 8000, periyot: 'AYLIK', baslangicAy: '2024-01', bitisAy: null, aktif: true, sonTahakkukAy: ay(0), notlar: null },
  { id: 'hz2', hizmetAdi: 'Kurumlar vergisi beyanı', tutar: 12000, periyot: 'YILLIK', baslangicAy: '2024-04', bitisAy: null, aktif: true, sonTahakkukAy: `${new Date().getFullYear()}-04`, notlar: 'Nisan ayında tahakkuk eder' },
  { id: 'hz3', hizmetAdi: 'Bordro hizmeti (eski)', tutar: 1500, periyot: 'AYLIK', baslangicAy: '2023-01', bitisAy: '2024-06', aktif: false, sonTahakkukAy: '2024-06', notlar: null },
];
const ekstre = (id) => {
  const c = CARI.find((x) => x.id === id) || CARI[0];
  const acilis = 4000;
  let bakiye = acilis;
  const satirlar = [];
  const kalemler = [
    [-88, 'TAHAKKUK', c.ucret, `${ay(-3)} muhasebe ücreti`, 'Aylık muhasebe ücreti'],
    [-80, 'TAHSILAT', c.ucret, 'Havale — Ziraat', null, 'HAVALE'],
    [-58, 'TAHAKKUK', c.ucret, `${ay(-2)} muhasebe ücreti`, 'Aylık muhasebe ücreti'],
    [-47, 'TAHSILAT', c.ucret + 4000, 'Havale — Garanti', null, 'HAVALE'],
    [-27, 'TAHAKKUK', c.ucret, `${ay(-1)} muhasebe ücreti`, 'Aylık muhasebe ücreti'],
    [-12, 'TAHSILAT', 5000, 'Nakit — elden', null, 'NAKIT'],
    [-2, 'TAHAKKUK', c.ucret, `${ay(0)} muhasebe ücreti`, 'Aylık muhasebe ücreti'],
  ];
  let i = 0;
  for (const [g, tip, tutar, aciklama, hizmet, yontem] of kalemler) {
    bakiye += tip === 'TAHAKKUK' ? tutar : -tutar;
    satirlar.push({ id: `e${++i}`, tarih: gun(g), tip, tutar, aciklama, odemeYontemi: yontem || null, hizmet: hizmet ? { hizmetAdi: hizmet } : null, otoOlusturuldu: tip === 'TAHAKKUK', runningBakiye: bakiye });
  }
  return { acilisBakiye: acilis, satirlar, toplamTahakkuk: satirlar.filter((s) => s.tip === 'TAHAKKUK').reduce((t, s) => t + s.tutar, 0), toplamTahsilat: satirlar.filter((s) => s.tip === 'TAHSILAT').reduce((t, s) => t + s.tutar, 0), kapanisBakiye: bakiye };
};
const istatistik = () => {
  const trend = [];
  for (let k = 11; k >= 0; k--) trend.push({ ay: ay(-k), tahakkuk: 96000 + ((k * 7) % 5) * 3500, tahsilat: 78000 + ((k * 11) % 7) * 4200 });
  return {
    kpi: { aylikHedef: 99000, buAyTahakkuk: 99000, buAyTahsilat: 37000, gecenAyTahsilat: 91500, toplamTahakkuk12Ay: trend.reduce((t, x) => t + x.tahakkuk, 0), toplamTahsilat12Ay: trend.reduce((t, x) => t + x.tahsilat, 0), tahsilatOrani: 84.6, toplamAktifBorc: CARI.reduce((t, c) => t + Math.max(c.tahakkuk - c.tahsilat, 0), 0), borcluMukellefAdet: CARI.filter((c) => c.tahakkuk - c.tahsilat > 0).length },
    trend,
    odemeYontemi: [{ yontem: 'HAVALE', tutar: 612000 }, { yontem: 'NAKIT', tutar: 168000 }, { yontem: 'KREDI_KARTI', tutar: 84000 }, { yontem: 'CEK', tutar: 21000 }],
    enBorclular: CARI.map((c) => ({ id: c.id, ad: c.ad, taxNumber: c.taxNumber, bakiye: c.tahakkuk - c.tahsilat })).filter((x) => x.bakiye > 0).sort((a, b) => b.bakiye - a.bakiye).slice(0, 6),
  };
};
const plan = () => {
  const karar = (c, kademe, gonderilebilir, sebep, onay) => ({ taxpayerId: c.id, ad: c.ad, kademe, gonderilebilir, sebep, onayGerekli: onay, mesaj: gonderilebilir ? `Sayın ${c.ad},\n\n${ay(0)} dönemi muhasebe hizmet bedeliniz olan ${(c.tahakkuk - c.tahsilat).toLocaleString('tr-TR')} ₺ tutarındaki bakiyenizi hatırlatmak isteriz. Ödeme yaptıysanız lütfen dikkate almayınız.\n\nMoren Mali Müşavirlik` : null, ekstreEkle: kademe === 'K2' });
  const g = (id) => CARI.find((c) => c.id === id);
  const gonderilecek = [karar(g('m1'), 'K1', true, null, false), karar(g('m6'), 'K1', true, null, false), karar(g('tx-2'), 'K2', true, null, false)];
  const onayBekleyen = [karar(g('m4'), 'K3', false, null, true)];
  const elleGorusulecek = [karar(g('tx-14'), 'ELLE', false, '90+ gün açık bakiye — bot susar', false), karar(g('tx-4'), 'ELLE', false, '90+ gün açık bakiye — bot susar', false)];
  const atlanan = [karar(g('m3'), null, false, 'Telefon numarası yok', false), karar(g('tx-15'), null, false, 'WhatsApp izni yok', false), karar(g('m2'), null, false, 'Açık bakiye yok', false), karar(g('m7'), null, false, 'Açık bakiye yok', false), karar(g('tx-21'), null, false, '14 gün içinde yazıldı', false)];
  return { otomasyonAcik: false, testModu: true, kuruTest: true, tarih: new Date().toISOString(), ozet: { gonderilecek: gonderilecek.length, onayBekleyen: onayBekleyen.length, elleGorusulecek: elleGorusulecek.length, atlanan: atlanan.length, yarinaKalan: 0, toplamAday: CARI.length }, gonderilecek, onayBekleyen, elleGorusulecek, atlanan, yarinaKalan: [] };
};
const HESAPLAR = [
  { id: 'NAKIT_KASA', name: 'Nakit Kasa', type: 'NAKIT', color: '#f08c00', isActive: true },
  { id: 'hs-ziraat', name: 'Ziraat Bankası — Vadesiz', type: 'BANKA', color: '#2f9e44', isActive: true },
  { id: 'hs-garanti', name: 'Garanti BBVA — Vadesiz', type: 'BANKA', color: '#0ca678', isActive: true },
];

// ── Portal erişimi (bellekte) ──
const ERISIM = { m1: { portalEnabled: true, portalEmail: 'info@ozela.com', hasPassword: true }, m7: { portalEnabled: true, portalEmail: 'info@balcik.com', hasPassword: true } };

// ── HGS İhlal ──
const ARACLAR = [
  { id: 'a1', plaka: '34HYE99', plakaGorunum: '34 HYE 99', marka: 'Ford', model: 'Transit', sahipAd: 'Selim Motors', taxpayerId: null, aktif: true, notlar: null, sonSorgu: { id: 's1', aracId: 'a1', sorguTarihi: gun(-1), durum: 'basarili', ihlalSayisi: 3, toplamTutar: 1240, detaylar: null, hataMesaji: null, kaynak: 'cron_pazartesi' } },
  { id: 'a2', plaka: '34ABC123', plakaGorunum: '34 ABC 123', marka: 'Renault', model: 'Clio', sahipAd: 'Selim Motors', taxpayerId: null, aktif: true, notlar: null, sonSorgu: { id: 's2', aracId: 'a2', sorguTarihi: gun(-1), durum: 'basarili', ihlalSayisi: 0, toplamTutar: 0, detaylar: null, hataMesaji: null, kaynak: 'cron_pazartesi' } },
  { id: 'a3', plaka: '34KLM456', plakaGorunum: '34 KLM 456', marka: 'Fiat', model: 'Egea', sahipAd: 'Ahmet Yılmaz', taxpayerId: null, aktif: true, notlar: null, sonSorgu: { id: 's3', aracId: 'a3', sorguTarihi: gun(-8), durum: 'basarili', ihlalSayisi: 1, toplamTutar: 310, detaylar: null, hataMesaji: null, kaynak: 'manuel' } },
  { id: 'a4', plaka: '06DEF789', plakaGorunum: '06 DEF 789', marka: 'Toyota', model: 'Corolla', sahipAd: null, taxpayerId: null, aktif: true, notlar: null, sonSorgu: { id: 's4', aracId: 'a4', sorguTarihi: gun(-1), durum: 'hatali', ihlalSayisi: 0, toplamTutar: null, detaylar: null, hataMesaji: 'CAPTCHA çözülemedi', kaynak: 'cron_pazartesi' } },
  { id: 'a5', plaka: '34ZZZ001', plakaGorunum: '34 ZZZ 001', marka: 'Mercedes', model: 'Sprinter', sahipAd: 'Selim Motors', taxpayerId: null, aktif: true, notlar: null, sonSorgu: null },
  { id: 'a6', plaka: '41NMS042', plakaGorunum: '41 NMS 042', marka: 'Volkswagen', model: 'Crafter', sahipAd: 'NMS Lojistik', taxpayerId: 'tx-4', aktif: true, notlar: null, sonSorgu: { id: 's6', aracId: 'a6', sorguTarihi: gun(-1), durum: 'beklemede', ihlalSayisi: 0, toplamTutar: null, detaylar: null, hataMesaji: null, kaynak: 'tek_sefer' } },
];
const galeriOzet = () => ({ toplamArac: ARACLAR.length, ihlalliArac: ARACLAR.filter((a) => (a.sonSorgu?.ihlalSayisi || 0) > 0).length, toplamIhlal: ARACLAR.reduce((t, a) => t + (a.sonSorgu?.ihlalSayisi || 0), 0), toplamTutar: ARACLAR.reduce((t, a) => t + (a.sonSorgu?.toplamTutar || 0), 0) });
let HGS_ALICILAR = ['0535 058 74 75', '0532 111 22 33'];

function uclar(yol, yontem, q, govde, jsonGonder, res) {
  // Cari Kasa
  if (yontem === 'GET' && yol === '/cari-kasa/ozet') return jsonGonder(res, 200, ozet());
  if (yontem === 'GET' && yol === '/cari-kasa/tahsilat-ajandasi') return jsonGonder(res, 200, ajanda());
  if (yontem === 'GET' && yol === '/cari-kasa/hizmet') return jsonGonder(res, 200, HIZMETLER);
  if (yontem === 'GET' && /^\/cari-kasa\/ekstre\/[^/]+$/.test(yol)) return jsonGonder(res, 200, ekstre(yol.split('/')[3]));
  if (yontem === 'GET' && yol === '/cari-kasa/istatistikler') return jsonGonder(res, 200, istatistik());
  if (yontem === 'GET' && yol === '/cari-kasa/tahsilat-otomasyon/plan') return jsonGonder(res, 200, plan());
  if (yontem === 'GET' && yol === '/cari-kasa/tahsilat-hesaplari') return jsonGonder(res, 200, HESAPLAR);
  if (yontem === 'POST' && yol === '/cari-kasa/tahsilat') return jsonGonder(res, 201, { id: 'yeni-' + Date.now(), ...govde });
  if (yontem === 'POST' && yol === '/cari-kasa/tahsilat-hatirlatma/preview') return jsonGonder(res, 200, { adet: (govde.taxpayerIds || []).length, mesajlar: [] });
  // Portal erişimi
  {
    const m = /^\/portal\/admin\/taxpayers\/([^/]+)\/access$/.exec(yol);
    if (m && yontem === 'GET') return jsonGonder(res, 200, ERISIM[m[1]] || { portalEnabled: false, portalEmail: null, hasPassword: false });
    if (m && yontem === 'POST') {
      const eski = ERISIM[m[1]] || { portalEnabled: false, portalEmail: null, hasPassword: false };
      ERISIM[m[1]] = { portalEnabled: !!govde.enabled, portalEmail: govde.portalEmail || eski.portalEmail, hasPassword: eski.hasPassword || !!govde.password };
      return jsonGonder(res, 200, ERISIM[m[1]]);
    }
  }
  // HGS İhlal (galeri)
  if (yontem === 'GET' && yol === '/galeri/araclar') {
    const s = String(q.search || '').toLocaleLowerCase('tr-TR');
    return jsonGonder(res, 200, s ? ARACLAR.filter((a) => [a.plaka, a.plakaGorunum, a.marka, a.model, a.sahipAd].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR').includes(s)) : ARACLAR);
  }
  if (yontem === 'POST' && yol === '/galeri/araclar') { const a = { id: 'a' + Date.now(), plakaGorunum: govde.plaka, aktif: true, sonSorgu: null, marka: null, model: null, sahipAd: null, taxpayerId: null, notlar: null, ...govde }; ARACLAR.push(a); return jsonGonder(res, 201, a); }
  if (yontem === 'DELETE' && /^\/galeri\/araclar\/[^/]+$/.test(yol)) { const i = ARACLAR.findIndex((a) => a.id === yol.split('/')[3]); if (i >= 0) ARACLAR.splice(i, 1); return jsonGonder(res, 200, { ok: true }); }
  if (yontem === 'GET' && /^\/galeri\/araclar\/[^/]+\/hgs-sorgu-gecmisi$/.test(yol)) {
    const id = yol.split('/')[3];
    return jsonGonder(res, 200, [
      { id: 'g1', aracId: id, sorguTarihi: gun(-1), durum: 'basarili', ihlalSayisi: 3, toplamTutar: 1240, detaylar: null, hataMesaji: null, kaynak: 'cron_pazartesi' },
      { id: 'g2', aracId: id, sorguTarihi: gun(-8), durum: 'basarili', ihlalSayisi: 2, toplamTutar: 820, detaylar: null, hataMesaji: null, kaynak: 'cron_pazartesi' },
      { id: 'g3', aracId: id, sorguTarihi: gun(-15), durum: 'hatali', ihlalSayisi: 0, toplamTutar: null, detaylar: null, hataMesaji: 'CAPTCHA', kaynak: 'manuel' },
    ]);
  }
  if (yontem === 'POST' && /^\/galeri\/araclar\/[^/]+\/hgs-sorgu-sonuc$/.test(yol)) return jsonGonder(res, 201, { id: 'g' + Date.now(), aracId: yol.split('/')[3], sorguTarihi: new Date().toISOString(), ...govde });
  if (yontem === 'GET' && yol === '/galeri/ozet') return jsonGonder(res, 200, galeriOzet());
  if (yontem === 'GET' && yol === '/galeri/agent-durumu') return jsonGonder(res, 200, { status: { running: true, lastPing: gun(0), meta: {} }, canli: true, pingYasiSaniye: 12, aktifKomut: null, sonKomut: { id: 'k1', status: 'done', createdAt: gun(-1), finishedAt: gun(-1) } });
  if (yontem === 'GET' && yol === '/galeri/hgs-alicilar') return jsonGonder(res, 200, { numaralar: HGS_ALICILAR });
  if (yontem === 'PUT' && yol === '/galeri/hgs-alicilar') { HGS_ALICILAR = Array.isArray(govde.numaralar) ? govde.numaralar : HGS_ALICILAR; return jsonGonder(res, 200, { ok: true, numaralar: HGS_ALICILAR }); }
  if (yontem === 'POST' && yol === '/galeri/toplu-sorgu-baslat') return jsonGonder(res, 200, { ok: true, komutId: 'k' + Date.now(), aracSayisi: ARACLAR.length, mesaj: 'Toplu sorgu komutu oluşturuldu (sahte)' });
  if (yontem === 'POST' && yol === '/galeri/kgm-sunucu-test') return jsonGonder(res, 200, { ok: true, jobId: 'j1', plaka: govde.plaka });
  // Duyurular gönderim (sahte — mesaj gitmez)
  if (yontem === 'POST' && yol === '/whatsapp/portal-message/send') return jsonGonder(res, 200, { basarili: (govde.taxpayerIds || []).length, hatali: 0, sonuclar: [] });
  return false;
}
module.exports = { uclar };
