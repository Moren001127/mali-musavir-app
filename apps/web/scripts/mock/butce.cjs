// Kişisel Bütçe (/panel/butce) — beyaz tema önizlemesi için sahte veri (2026-09-21).
//
// Yerleşik `/butce/erisim` ucu {yetkili:false} döndürdüğü ve önce eşleştiği için gerçek `/butce/*`
// yolları burada YOK; veriler `/butce-sahte/*` altında sunulur. Önizleme betiği
// (scripts/onizleme/tur2-butce.cjs) tarayıcı isteklerini page.route ile buraya yönlendirir ve
// `/butce/erisim`i {yetkili:true} olarak kendisi yanıtlar. Sayfa kodunun beklediği alanlar
// apps/web/src/lib/butce.ts tiplerinden çıkarıldı. Şahıs firması modeli: gelir tek havuz,
// ofis/kişisel ayrımı yalnız giderde; kart harcaması nakit değildir.

const ONEK = '/butce-sahte';
const BUGUN = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const gunEkle = (n, temel = BUGUN) => { const d = new Date(temel); d.setDate(d.getDate() + n); return iso(d); };
const donemStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const BU_DONEM = donemStr(BUGUN);
const donemKaydir = (donem, n) => { const [y, a] = donem.split('-').map(Number); const d = new Date(Date.UTC(y, a - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const YIL = BUGUN.getFullYear();
const AY = BUGUN.getMonth() + 1;

/* ── Kategoriler ─────────────────────────────────────────────────────────────────────────── */
const KATEGORILER = [
  { id: 'kg1', ad: 'Müşavirlik Ücreti', tur: 'GELIR', defter: 'OFIS', renk: '#5ad18a', zorunlu: false, aktif: true, sira: 1 },
  { id: 'kg2', ad: 'Danışmanlık', tur: 'GELIR', defter: 'OFIS', renk: '#8cbde8', zorunlu: false, aktif: true, sira: 2 },
  { id: 'kg3', ad: 'Kira Geliri', tur: 'GELIR', defter: 'SAHSI', renk: '#b0a0e0', zorunlu: false, aktif: true, sira: 3 },
  { id: 'kg4', ad: 'Diğer Gelir', tur: 'GELIR', defter: 'SAHSI', renk: '#9da8b7', zorunlu: false, aktif: true, sira: 4 },
  { id: 'ko1', ad: 'Ofis Kira', tur: 'GIDER', defter: 'OFIS', renk: '#e0697a', zorunlu: true, aktif: true, sira: 10 },
  { id: 'ko2', ad: 'Personel Maaşı', tur: 'GIDER', defter: 'OFIS', renk: '#d9a06c', zorunlu: true, aktif: true, sira: 11 },
  { id: 'ko3', ad: 'SGK ve Vergi', tur: 'GIDER', defter: 'OFIS', renk: '#b0a0e0', zorunlu: true, aktif: true, sira: 12 },
  { id: 'ko4', ad: 'Yazılım / Abonelik', tur: 'GIDER', defter: 'OFIS', renk: '#8cbde8', zorunlu: false, aktif: true, sira: 13 },
  { id: 'ko5', ad: 'Ofis Giderleri', tur: 'GIDER', defter: 'OFIS', renk: '#9da8b7', zorunlu: false, aktif: true, sira: 14 },
  { id: 'ko6', ad: 'Ulaşım / Yakıt', tur: 'GIDER', defter: 'OFIS', renk: '#e6c878', zorunlu: false, aktif: true, sira: 15 },
  { id: 'ks1', ad: 'Market', tur: 'GIDER', defter: 'SAHSI', renk: '#5ad18a', zorunlu: false, aktif: true, sira: 20 },
  { id: 'ks2', ad: 'Ev Kira / Aidat', tur: 'GIDER', defter: 'SAHSI', renk: '#e0697a', zorunlu: true, aktif: true, sira: 21 },
  { id: 'ks3', ad: 'Faturalar', tur: 'GIDER', defter: 'SAHSI', renk: '#d9a06c', zorunlu: true, aktif: true, sira: 22 },
  { id: 'ks4', ad: 'Eğitim', tur: 'GIDER', defter: 'SAHSI', renk: '#8cbde8', zorunlu: false, aktif: true, sira: 23 },
  { id: 'ks5', ad: 'Sağlık', tur: 'GIDER', defter: 'SAHSI', renk: '#f09aa8', zorunlu: false, aktif: true, sira: 24 },
  { id: 'ks6', ad: 'Giyim', tur: 'GIDER', defter: 'SAHSI', renk: '#b0a0e0', zorunlu: false, aktif: true, sira: 25 },
  { id: 'ks7', ad: 'Yemek / Eğlence', tur: 'GIDER', defter: 'SAHSI', renk: '#e6c878', zorunlu: false, aktif: true, sira: 26 },
  { id: 'ks8', ad: 'Araç', tur: 'GIDER', defter: 'SAHSI', renk: '#9da8b7', zorunlu: false, aktif: true, sira: 27 },
];
const kat = (id) => { const k = KATEGORILER.find((x) => x.id === id); return k ? { id: k.id, ad: k.ad, renk: k.renk, zorunlu: k.zorunlu } : null; };

/* ── Banka hesapları ─────────────────────────────────────────────────────────────────────── */
const HESAPLAR = [
  { id: 'h1', varsayilanDefter: 'OFIS', ad: 'İş hesabı', bankaAdi: 'Ziraat', iban4: '4821', tur: 'VADESIZ', acilisBakiye: 62000, acilisTarihi: `${YIL}-01-02`, kmhLimiti: 0, kmhAylikFaiz: 0, renk: '#e6c878', aktif: true, tahsilataAcik: true, sira: 1, bakiye: 84250, kmhBorcu: 0, kmhKalanLimit: 0, kmhDoluluk: 0, kullanilabilir: 84250 },
  { id: 'h2', varsayilanDefter: 'SAHSI', ad: 'Kişisel hesap', bankaAdi: 'İş Bankası', iban4: '1107', tur: 'VADESIZ', acilisBakiye: 18000, acilisTarihi: `${YIL}-01-02`, kmhLimiti: 0, kmhAylikFaiz: 0, renk: '#8cbde8', aktif: true, tahsilataAcik: false, sira: 2, bakiye: 23640, kmhBorcu: 0, kmhKalanLimit: 0, kmhDoluluk: 0, kullanilabilir: 23640 },
  { id: 'h3', varsayilanDefter: 'OFIS', ad: 'Ek hesap', bankaAdi: 'Garanti', iban4: '5590', tur: 'KMH', acilisBakiye: 0, acilisTarihi: `${YIL}-03-01`, kmhLimiti: 50000, kmhAylikFaiz: 4.25, renk: '#5ad18a', aktif: true, tahsilataAcik: true, sira: 3, bakiye: -12500, kmhBorcu: 12500, kmhKalanLimit: 37500, kmhDoluluk: 25, kullanilabilir: 37500 },
  { id: 'h4', varsayilanDefter: 'SAHSI', ad: 'Eski maaş hesabı', bankaAdi: 'Yapı Kredi', iban4: '2204', tur: 'VADESIZ', acilisBakiye: 0, acilisTarihi: `${YIL - 1}-06-01`, kmhLimiti: 0, kmhAylikFaiz: 0, renk: '#9da8b7', aktif: false, tahsilataAcik: false, sira: 4, bakiye: 0, kmhBorcu: 0, kmhKalanLimit: 0, kmhDoluluk: 0, kullanilabilir: 0 },
];
const KASA = { bakiye: 6400, giris: 9400, cikis: 3000, hareketSayisi: 7, kirilim: [{ ad: 'Diğer Gelir', renk: '#9da8b7', tur: 'GELIR', tutar: 9400 }, { ad: 'Yemek / Eğlence', renk: '#e6c878', tur: 'GIDER', tutar: 1980 }, { ad: 'Market', renk: '#5ad18a', tur: 'GIDER', tutar: 1020 }] };

/* ── Kredi kartları ve ekstreler ─────────────────────────────────────────────────────────── */
const kartTemel = (id, bankaAdi, kartAdi, renk) => ({ id, varsayilanDefter: 'SAHSI', bankaAdi, kartAdi, renk, aktif: true, asgariOran: 20, aylikFaizOrani: 4.25, gecikmeFaizOrani: 4.75, sonOdemeGunFarki: 10 });
const K1 = { ...kartTemel('k1', 'Ziraat', 'Bankkart Combo', '#e6c878'), sonDortHane: '3391', kartLimiti: 120000, kesimGunu: 8 };
const K2 = { ...kartTemel('k2', 'Garanti', 'Bonus Platinum', '#b0a0e0'), sonDortHane: '7720', kartLimiti: 80000, kesimGunu: 25 };
const K3 = { ...kartTemel('k3', 'Akbank', 'Axess', '#e0697a'), sonDortHane: '0456', kartLimiti: 45000, kesimGunu: 15 };
const kartOzet = (k) => ({ id: k.id, bankaAdi: k.bankaAdi, kartAdi: k.kartAdi, renk: k.renk });
const ekstreYap = (id, k, donem, kesimGun, borc, odenen, durum, ek = {}) => {
  const [y, a] = donem.split('-').map(Number);
  const kesim = new Date(Date.UTC(y, a - 1, kesimGun));
  const sonOdeme = new Date(kesim); sonOdeme.setUTCDate(sonOdeme.getUTCDate() + 10);
  const bas = new Date(kesim); bas.setUTCMonth(bas.getUTCMonth() - 1); bas.setUTCDate(bas.getUTCDate() + 1);
  const kalanGun = Math.round((sonOdeme.getTime() - Date.UTC(BUGUN.getFullYear(), BUGUN.getMonth(), BUGUN.getDate())) / 86400000);
  return {
    id, kartId: k.id, donem, kesimTarihi: iso(kesim), sonOdemeTarihi: iso(sonOdeme), borcTutari: borc,
    asgariTutar: borc === null ? null : Math.round(borc * 0.2), odenenTutar: odenen, kalanTutar: borc === null ? null : borc - odenen,
    durum, kalanGun, harcamaBaslangic: iso(bas), harcamaBitis: iso(kesim), kart: kartOzet(k), ...ek,
  };
};
const onceki = donemKaydir(BU_DONEM, -1), onceki2 = donemKaydir(BU_DONEM, -2), onceki3 = donemKaydir(BU_DONEM, -3);
const E = {
  k1_bu: ekstreYap('e11', K1, BU_DONEM, 8, 38420, 20000, 'KISMI'),
  k1_o1: ekstreYap('e12', K1, onceki, 8, 41260, 41260, 'ODENDI'),
  k1_o2: ekstreYap('e13', K1, onceki2, 8, 27980, 27980, 'ODENDI'),
  k1_o3: ekstreYap('e14', K1, onceki3, 8, 33150, 33150, 'ODENDI'),
  k2_bu: ekstreYap('e21', K2, BU_DONEM, 25, null, 0, 'TUTAR_BEKLENIYOR', { kesilmedi: true }),
  k2_o1: ekstreYap('e22', K2, onceki, 25, 19870, 19870, 'ODENDI'),
  k2_o2: ekstreYap('e23', K2, onceki2, 25, 22410, 22410, 'ODENDI'),
  k3_bu: ekstreYap('e31', K3, BU_DONEM, 15, 21750, 0, 'ODENMEDI'),
  k3_o1: ekstreYap('e32', K3, onceki, 15, 16480, 9000, 'KISMI', { devretti: true }),
  k3_o2: ekstreYap('e33', K3, onceki2, 15, 12300, 12300, 'ODENDI'),
};
const KARTLAR = [
  { ...K1, ekstreler: [E.k1_bu, E.k1_o1, E.k1_o2], guncelEkstre: E.k1_bu, borcEkstresi: E.k1_bu, ekstreBorcu: 18420, donemIciHarcama: 9870, donemIciBaslangic: E.k1_bu.kesimTarihi, guncelBorc: 28290, kalanBorc: 28290, kullanilabilirLimit: 91710, limitDoluluk: 23.6 },
  { ...K2, ekstreler: [E.k2_bu, E.k2_o1, E.k2_o2], guncelEkstre: E.k2_bu, borcEkstresi: E.k2_o1, ekstreBorcu: 0, donemIciHarcama: 14360, donemIciBaslangic: E.k2_o1.kesimTarihi, guncelBorc: 14360, kalanBorc: 14360, kullanilabilirLimit: 65640, limitDoluluk: 18 },
  { ...K3, ekstreler: [E.k3_bu, E.k3_o1, E.k3_o2], guncelEkstre: E.k3_bu, borcEkstresi: E.k3_bu, ekstreBorcu: 21750, donemIciHarcama: 2140, donemIciBaslangic: E.k3_bu.kesimTarihi, guncelBorc: 23890, kalanBorc: 23890, kullanilabilirLimit: 21110, limitDoluluk: 53.1 },
];
const EKSTRELER = [E.k3_bu, E.k1_bu, E.k2_bu, E.k1_o1, E.k2_o1, E.k3_o1, E.k1_o2, E.k2_o2, E.k3_o2, E.k1_o3];

const KART_HAREKETLERI = {
  e11: [
    { id: 'kh1', ekstreId: 'e11', tarih: gunEkle(-30), aciklama: 'MIGROS SAKARYA', satici: 'MIGROS', tutar: 2140.5, kategoriId: 'ks1', kategori: kat('ks1'), kategoriKaynak: 'HAFIZA', onaylandi: true, defter: 'SAHSI' },
    { id: 'kh2', ekstreId: 'e11', tarih: gunEkle(-27), aciklama: 'SHELL ADAPAZARI', satici: 'SHELL', tutar: 3200, kategoriId: 'ko6', kategori: kat('ko6'), kategoriKaynak: 'HAFIZA', onaylandi: true, defter: 'OFIS' },
    { id: 'kh3', ekstreId: 'e11', tarih: gunEkle(-24), aciklama: 'MICROSOFT 365 ABONELİK', satici: 'MICROSOFT', tutar: 1890, kategoriId: 'ko4', kategori: kat('ko4'), kategoriKaynak: 'AI', onaylandi: false, defter: 'OFIS' },
    { id: 'kh4', ekstreId: 'e11', tarih: gunEkle(-21), aciklama: 'LC WAIKIKI 2/3', satici: 'LC WAIKIKI', tutar: 1150, taksitBilgi: '2/3', kategoriId: 'ks6', kategori: kat('ks6'), kategoriKaynak: 'AI', onaylandi: false, defter: 'SAHSI' },
    { id: 'kh5', ekstreId: 'e11', tarih: gunEkle(-19), aciklama: 'TRENDYOL', satici: 'TRENDYOL', tutar: 2480, kategoriId: null, kategori: null, kategoriKaynak: 'AI', onaylandi: false, defter: 'SAHSI' },
    { id: 'kh6', ekstreId: 'e11', tarih: gunEkle(-16), aciklama: 'ÖZEL DERSHANE EYLÜL', satici: 'DERSHANE', tutar: 12000, kategoriId: 'ks4', kategori: kat('ks4'), kategoriKaynak: 'ELLE', onaylandi: false, defter: 'SAHSI' },
    { id: 'kh7', ekstreId: 'e11', tarih: gunEkle(-14), aciklama: 'İADE - TRENDYOL', satici: 'TRENDYOL', tutar: -640, kategoriId: null, kategori: null, kategoriKaynak: 'AI', onaylandi: false, defter: 'SAHSI' },
  ],
};

/* ── Borçlar ─────────────────────────────────────────────────────────────────────────────── */
const BORCLAR = [
  { id: 'b1', defter: 'SAHSI', ad: 'Araç kredisi', tur: 'TASIT', kurum: 'Ziraat', toplamTutar: 480000, kalanAnapara: 312000, yillikFaiz: 42, aylikFaiz: 3.5, taksitTutari: 14850, toplamTaksit: 36, odenenTaksit: 14, kalanTaksit: 22, odemeGunu: 10, bitisTarihi: `${YIL + 2}-07-10`, durum: 'AKTIF', notlar: null },
  { id: 'b2', defter: 'OFIS', ad: 'İhtiyaç kredisi', tur: 'IHTIYAC', kurum: 'Garanti', toplamTutar: 150000, kalanAnapara: 61200, yillikFaiz: 48, aylikFaiz: 4, taksitTutari: 8420, toplamTaksit: 24, odenenTaksit: 16, kalanTaksit: 8, odemeGunu: 5, bitisTarihi: `${YIL + 1}-05-05`, durum: 'AKTIF', notlar: 'Ofis tadilatı için' },
  { id: 'b3', defter: 'SAHSI', ad: 'Beyaz eşya senedi', tur: 'SENET', kurum: 'Arçelik bayii', toplamTutar: 24000, kalanAnapara: 0, yillikFaiz: 0, aylikFaiz: 0, taksitTutari: 2000, toplamTaksit: 12, odenenTaksit: 12, kalanTaksit: 0, odemeGunu: 20, bitisTarihi: `${YIL}-06-20`, durum: 'KAPANDI', notlar: null },
];

/* ── İşlemler (bu dönem) ─────────────────────────────────────────────────────────────────── */
const g = (n) => `${BU_DONEM}-${String(n).padStart(2, '0')}`;
const islem = (id, tarih, tur, tutar, kategoriId, aciklama, ek = {}) => ({
  id, defter: ek.defter || (KATEGORILER.find((k) => k.id === kategoriId) || {}).defter || 'SAHSI', bankaHesapId: ek.bankaHesapId || null,
  bankaHesap: ek.bankaHesapId ? { id: ek.bankaHesapId, ad: HESAPLAR.find((h) => h.id === ek.bankaHesapId).ad, bankaAdi: HESAPLAR.find((h) => h.id === ek.bankaHesapId).bankaAdi } : null,
  transferGrupId: ek.transferGrupId || null, tarih, donem: tarih.slice(0, 7), tur, tutar, kategoriId, kategori: kat(kategoriId), aciklama,
  kaynak: ek.kaynak || 'BANKA', kartId: ek.kartId || null, planlanan: !!ek.planlanan, kaynakTur: ek.kaynakTur || 'BUTCE', duzenlenebilir: ek.kaynakTur !== 'CARI_TAHSILAT',
});
const ISLEMLER = [
  islem('i1', g(2), 'GELIR', 48500, 'kg1', 'Ağustos müşavirlik tahsilatı (12 mükellef)', { bankaHesapId: 'h1', kaynakTur: 'CARI_TAHSILAT' }),
  islem('i2', g(5), 'GELIR', 36200, 'kg1', 'Ağustos müşavirlik tahsilatı (9 mükellef)', { bankaHesapId: 'h1', kaynakTur: 'CARI_TAHSILAT' }),
  islem('i3', g(9), 'GELIR', 41800, 'kg1', 'Ağustos müşavirlik tahsilatı (11 mükellef)', { bankaHesapId: 'h3', kaynakTur: 'CARI_TAHSILAT' }),
  islem('i4', g(12), 'GELIR', 25000, 'kg2', 'Famcoffee şube açılış danışmanlığı', { bankaHesapId: 'h1' }),
  islem('i5', g(3), 'GELIR', 22000, 'kg3', 'Dükkan kirası — Eylül', { bankaHesapId: 'h2' }),
  islem('i6', g(15), 'GELIR', 13000, 'kg4', 'Eski alacak tahsilatı', { kaynak: 'NAKIT' }),
  islem('i7', g(28), 'GELIR', 15000, 'kg1', 'Balçık İnşaat — bekleyen tahsilat', { bankaHesapId: 'h1', planlanan: true }),
  islem('i8', g(1), 'GIDER', 25000, 'ko1', 'Ofis kirası — Eylül', { bankaHesapId: 'h1' }),
  islem('i9', g(1), 'GIDER', 42000, 'ko2', 'Personel maaşları (3 kişi)', { bankaHesapId: 'h1' }),
  islem('i10', g(4), 'GIDER', 18600, 'ko3', 'SGK primi + muhtasar', { bankaHesapId: 'h1' }),
  islem('i11', g(6), 'GIDER', 3200, 'ko4', 'Luca + Microsoft 365', { kaynak: 'KART', kartId: 'k1' }),
  islem('i12', g(11), 'GIDER', 4100, 'ko6', 'Yakıt — mükellef ziyaretleri', { kaynak: 'KART', kartId: 'k1' }),
  islem('i13', g(2), 'GIDER', 3500, 'ks2', 'Site aidatı', { bankaHesapId: 'h2' }),
  islem('i14', g(7), 'GIDER', 2870, 'ks3', 'Elektrik + doğalgaz + internet', { bankaHesapId: 'h2' }),
  islem('i15', g(8), 'GIDER', 8450, 'ks1', 'Market alışverişi (haftalık)', { kaynak: 'KART', kartId: 'k3' }),
  islem('i16', g(10), 'GIDER', 12000, 'ks4', 'Dershane taksiti', { kaynak: 'KART', kartId: 'k1' }),
  islem('i17', g(14), 'GIDER', 2400, 'ks6', 'Giyim', { kaynak: 'KART', kartId: 'k2' }),
  islem('i18', g(17), 'GIDER', 1980, 'ks7', 'Hafta sonu yemek', { kaynak: 'NAKIT' }),
  islem('i19', g(19), 'GIDER', 5130, 'ks8', 'Araç bakımı + lastik', { kaynak: 'KART', kartId: 'k2' }),
  islem('i20', g(20), 'GIDER', 1000, 'ks5', 'Eczane', { kaynak: 'NAKIT' }),
  islem('i21', g(13), 'GIDER', 20000, null, 'Ziraat → İş Bankası aktarım', { bankaHesapId: 'h1', transferGrupId: 't1', defter: 'OFIS' }),
  islem('i22', g(13), 'GELIR', 20000, null, 'Ziraat → İş Bankası aktarım', { bankaHesapId: 'h2', transferGrupId: 't1' }),
];
const gelirToplam = ISLEMLER.filter((i) => i.tur === 'GELIR' && !i.planlanan && !i.transferGrupId).reduce((t, i) => t + i.tutar, 0);
const giderToplam = (defter) => ISLEMLER.filter((i) => i.tur === 'GIDER' && !i.planlanan && !i.transferGrupId && (!defter || i.defter === defter)).reduce((t, i) => t + i.tutar, 0);
const GELIR = gelirToplam, OFIS_GIDER = giderToplam('OFIS'), SAHSI_GIDER = giderToplam('SAHSI'), GIDER = OFIS_GIDER + SAHSI_GIDER;
const KART_GIDERI = ISLEMLER.filter((i) => i.tur === 'GIDER' && i.kaynak === 'KART').reduce((t, i) => t + i.tutar, 0);

/* ── Özet ────────────────────────────────────────────────────────────────────────────────── */
const BANKA = HESAPLAR.filter((h) => h.aktif).reduce((t, h) => t + h.bakiye, 0);
const NAKIT_VARLIK = BANKA + KASA.bakiye;
const KART_BORCU = KARTLAR.reduce((t, k) => t + k.ekstreBorcu, 0);
const KART_DONEM_ICI = KARTLAR.reduce((t, k) => t + k.donemIciHarcama, 0);
const KREDI = BORCLAR.filter((b) => b.durum === 'AKTIF').reduce((t, b) => t + b.kalanAnapara, 0);
const KMH = HESAPLAR.reduce((t, h) => t + h.kmhBorcu, 0);
const TOPLAM_BORC = KART_BORCU + KART_DONEM_ICI + KREDI + KMH;
const AYLIK_ZORUNLU = 7684 + 4350 + 14850 + 8420;
const NAKIT_YASTIGI = 25000;
const kategoriKirilim = () => {
  const m = new Map();
  for (const i of ISLEMLER) {
    if (i.tur !== 'GIDER' || i.planlanan || i.transferGrupId || !i.kategori) continue;
    const k = m.get(i.kategoriId) || { ad: i.kategori.ad, renk: i.kategori.renk, tutar: 0, zorunlu: !!i.kategori.zorunlu, defter: i.defter };
    k.tutar += i.tutar; m.set(i.kategoriId, k);
  }
  return [...m.values()].sort((a, b) => b.tutar - a.tutar);
};
const TREND = [5, 4, 3, 2, 1, 0].map((n, idx) => {
  const d = donemKaydir(BU_DONEM, -n);
  const gelirler = [168400, 174900, 159200, 181300, 176800, GELIR];
  const giderler = [121500, 128300, 117900, 134600, 126100, GIDER];
  return { donem: d, gelir: gelirler[idx], gider: giderler[idx] };
});
const ozet = (donem) => {
  const buAy = donem === BU_DONEM;
  const carp = buAy ? 1 : 0.92;
  const gelir = Math.round(GELIR * carp), gider = Math.round(GIDER * carp);
  return {
    donem, gelir, gider, meslekiGider: Math.round(OFIS_GIDER * carp), kisiselGider: Math.round(SAHSI_GIDER * carp),
    meslekiKazanc: gelir - Math.round(OFIS_GIDER * carp), cepteKalan: gelir - gider, kartGideri: Math.round(KART_GIDERI * carp),
    nakitGider: gider - Math.round(KART_GIDERI * carp), bankaBakiyesi: BANKA, nakitKasasi: KASA.bakiye,
    odemeKapasitesi: NAKIT_VARLIK - NAKIT_YASTIGI, net: gelir - gider, nakitNet: gelir - (gider - Math.round(KART_GIDERI * carp)),
    nakitYastigi: NAKIT_YASTIGI, defter: 'TUMU', nakitVarlik: NAKIT_VARLIK, netVarlik: NAKIT_VARLIK - TOPLAM_BORC,
    hesapOzet: HESAPLAR.filter((h) => h.aktif).map((h) => ({ id: h.id, ad: h.ad, bankaAdi: h.bankaAdi, bakiye: h.bakiye, kmhBorcu: h.kmhBorcu, renk: h.renk })),
    borcOzet: { kart: KART_BORCU, kartDonemIci: KART_DONEM_ICI, kredi: KREDI, kmh: KMH, toplam: TOPLAM_BORC, aylikZorunluOdeme: AYLIK_ZORUNLU },
    kategoriKirilim: kategoriKirilim(), trend: TREND,
    yaklasanOdemeler: [E.k3_bu, E.k1_bu, E.k2_bu],
    aktarimGiris: 20000, aktarimCikis: 20000, toplamNakitGirisi: gelir + 20000,
    uyarilar: buAy ? [
      { seviye: 'KRITIK', baslik: 'Ziraat Bankkart ekstresi 3 gün gecikti', mesaj: `Kalan ${(18420).toLocaleString('tr-TR')} ₺ için gecikme faizi işliyor; bugün ödeyip zararı durdurun.` },
      { seviye: 'UYARI', baslik: 'Akbank Axess son ödeme 4 gün sonra', mesaj: `${(21750).toLocaleString('tr-TR')} ₺ borcun tamamı ${E.k3_bu.sonOdemeTarihi.split('-').reverse().join('.')} tarihinde ödenmeli; asgari ${(4350).toLocaleString('tr-TR')} ₺.` },
      { seviye: 'BILGI', baslik: 'Garanti ek hesap %25 kullanımda', mesaj: 'Günlük yaklaşık 17,71 ₺ faiz işliyor; Ziraat bakiyesiyle kapatmak bu ay 531 ₺ kazandırır.' },
    ] : [],
  };
};

/* ── Nakit akışı ─────────────────────────────────────────────────────────────────────────── */
const nakitAkis = (gunSayisi = 30) => {
  const baslangic = NAKIT_VARLIK;
  const sabit = [
    { gun: E.k3_bu.sonOdemeTarihi, ad: 'Akbank Axess ekstre', tutar: 21750, tur: 'KART_ODEME', kesin: true },
    { gun: gunEkle(1), ad: 'Ziraat Bankkart kalan', tutar: 18420, tur: 'KART_ODEME', kesin: true },
    { gun: gunEkle(7), ad: 'Balçık İnşaat tahsilat', tutar: 15000, tur: 'GELIR', kesin: false },
    { gun: gunEkle(9), ad: 'Personel maaşları', tutar: 42000, tur: 'GIDER', kesin: true },
    { gun: gunEkle(9), ad: 'Ofis kirası', tutar: 25000, tur: 'GIDER', kesin: true },
    { gun: gunEkle(10), ad: 'Geçici vergi + KDV ödemesi', tutar: 24000, tur: 'GIDER', kesin: true },
    { gun: gunEkle(12), ad: 'Ekim müşavirlik tahsilatı', tutar: 88000, tur: 'GELIR', kesin: false },
    { gun: gunEkle(13), ad: 'SGK + muhtasar', tutar: 18600, tur: 'GIDER', kesin: true },
    { gun: gunEkle(14), ad: 'İhtiyaç kredisi taksiti', tutar: 8420, tur: 'KREDI_TAKSIT', kesin: true },
    { gun: gunEkle(14), ad: 'Garanti Bonus ekstre (tahmini)', tutar: 14360, tur: 'KART_ODEME', kesin: false },
    { gun: gunEkle(19), ad: 'Araç kredisi taksiti', tutar: 14850, tur: 'KREDI_TAKSIT', kesin: true },
    { gun: gunEkle(12), ad: 'Dükkan kirası', tutar: 22000, tur: 'GELIR', kesin: false },
    { gun: gunEkle(24), ad: 'Ek hesap faizi', tutar: 531, tur: 'KMH_FAIZ', kesin: true },
    { gun: gunEkle(40), ad: 'Kasım müşavirlik tahsilatı', tutar: 90000, tur: 'GELIR', kesin: false },
    { gun: gunEkle(39), ad: 'Personel maaşları', tutar: 42000, tur: 'GIDER', kesin: true },
    { gun: gunEkle(39), ad: 'Ofis kirası', tutar: 25000, tur: 'GIDER', kesin: true },
    { gun: gunEkle(44), ad: 'İhtiyaç kredisi taksiti', tutar: 8420, tur: 'KREDI_TAKSIT', kesin: true },
    { gun: gunEkle(49), ad: 'Araç kredisi taksiti', tutar: 14850, tur: 'KREDI_TAKSIT', kesin: true },
    { gun: gunEkle(70), ad: 'Aralık müşavirlik tahsilatı', tutar: 92000, tur: 'GELIR', kesin: false },
    { gun: gunEkle(69), ad: 'Personel maaşları + ikramiye', tutar: 58000, tur: 'GIDER', kesin: true },
    { gun: gunEkle(69), ad: 'Ofis kirası', tutar: 25000, tur: 'GIDER', kesin: true },
    { gun: gunEkle(79), ad: 'Araç kredisi taksiti', tutar: 14850, tur: 'KREDI_TAKSIT', kesin: true },
  ];
  let bakiye = baslangic; const gunler = []; let toplamGiris = 0, toplamCikis = 0;
  for (let i = 0; i < gunSayisi; i++) {
    const tarih = gunEkle(i);
    const hareketler = sabit.filter((h) => h.gun === tarih).map((h) => ({ ad: h.ad, tutar: h.tutar, tur: h.tur, kesin: h.kesin }));
    const giris = hareketler.filter((h) => h.tur === 'GELIR').reduce((t, h) => t + h.tutar, 0);
    const cikis = hareketler.filter((h) => h.tur !== 'GELIR').reduce((t, h) => t + h.tutar, 0);
    bakiye += giris - cikis; toplamGiris += giris; toplamCikis += cikis;
    gunler.push({ tarih, giris, cikis, bakiye, hareketler, acik: bakiye < 0 ? -bakiye : 0 });
  }
  const enDusuk = gunler.reduce((m, g) => (g.bakiye < m.bakiye ? g : m), gunler[0]);
  const acikGunler = gunler.filter((g) => g.bakiye < 0);
  const oneriler = acikGunler.slice(0, 2).map((g, i) => ({
    tarih: g.tarih, acik: g.acik, toplamAcik: g.acik, devredenAcik: i === 0 ? 0 : acikGunler[0].acik, baslik: `${g.tarih.split('-').reverse().join('.')} günü açığı`,
    secenekler: [
      { ad: 'Garanti ek hesabı kullan', aciklama: `Kalan ${(37500).toLocaleString('tr-TR')} ₺ limit açığı karşılar; aylık %4,25 faiz.`, maliyet: Math.round(g.acik * 0.0425 * 0.5), onerilen: true },
      { ad: 'Ekstreyi asgariden öde', aciklama: 'Akbank ekstresine yalnız asgari ödenir; kalan bakiyeye %4,25 akdi faiz işler.', maliyet: Math.round(17400 * 0.0425), onerilen: false, maliyetTahmini: true },
      { ad: 'Beklenen tahsilatı öne çek', aciklama: 'Balçık İnşaat tahsilatı erken gelirse açık kapanır; maliyeti yok.', maliyet: 0, onerilen: false },
    ],
  }));
  return {
    baslangicNakit: baslangic, gunler, enDusuk: { tarih: enDusuk.tarih, tutar: enDusuk.bakiye }, acikGunler, kmhIleKarsilanir: acikGunler.every((g) => g.acik <= 37500),
    toplamGiris, toplamCikis, kmhLimitToplam: 37500, oneriler,
    hesaplar: HESAPLAR.filter((h) => h.aktif).map((h) => ({ id: h.id, ad: h.ad, bankaAdi: h.bankaAdi, bakiye: h.bakiye, renk: h.renk })),
  };
};

/* ── Ödeme planı ─────────────────────────────────────────────────────────────────────────── */
const plan = (q) => {
  const kapasite = q.kapasite ? Number(q.kapasite) : 46000;
  const strateji = q.strateji || 'CIG';
  const birikim = NAKIT_VARLIK - NAKIT_YASTIGI - kapasite;
  const kalemler = [
    { id: 'k3', ad: 'Akbank Axess', tip: 'KART', kalan: 23890, aylikFaiz: 4.25 },
    { id: 'k1', ad: 'Ziraat Bankkart Combo', tip: 'KART', kalan: 28290, aylikFaiz: 4.25 },
    { id: 'h3', ad: 'Garanti ek hesap', tip: 'KREDI', kalan: 12500, aylikFaiz: 4.25 },
    { id: 'b2', ad: 'İhtiyaç kredisi (Garanti)', tip: 'KREDI', kalan: 61200, aylikFaiz: 4 },
    { id: 'b1', ad: 'Araç kredisi (Ziraat)', tip: 'KREDI', kalan: 312000, aylikFaiz: 3.5 },
  ];
  const sonuc = (st) => ({
    strateji: st, ayAdedi: st === 'CIG' ? 11 : 12, toplamFaiz: st === 'CIG' ? 68420 : 74960, toplamOdeme: st === 'CIG' ? 506300 : 512840,
    ilkAy: [
      { id: 'k1', ad: 'Ziraat Bankkart Combo', tip: 'KART', zorunlu: 18420, odenen: 18420, eksik: 0, ekstra: 9870, toplam: 28290, kalanSonra: 0 },
      { id: 'k3', ad: 'Akbank Axess', tip: 'KART', zorunlu: 4350, odenen: 4350, eksik: 0, ekstra: st === 'CIG' ? 19540 : 6000, toplam: st === 'CIG' ? 23890 : 10350, kalanSonra: st === 'CIG' ? 0 : 13540 },
      { id: 'h3', ad: 'Garanti ek hesap', tip: 'KREDI', zorunlu: 531, odenen: 531, eksik: 0, ekstra: st === 'CIG' ? 0 : 12500, toplam: st === 'CIG' ? 531 : 13031, kalanSonra: st === 'CIG' ? 12500 : 0 },
      { id: 'b2', ad: 'İhtiyaç kredisi (Garanti)', tip: 'KREDI', zorunlu: 8420, odenen: 8420, eksik: 0, ekstra: 0, toplam: 8420, kalanSonra: 52780 },
      { id: 'b1', ad: 'Araç kredisi (Ziraat)', tip: 'KREDI', zorunlu: 14850, odenen: 14850, eksik: 0, ekstra: 0, toplam: 14850, kalanSonra: 297150 },
    ],
    kapanisSirasi: st === 'CIG'
      ? [{ id: 'k1', ad: 'Ziraat Bankkart Combo', ay: 1 }, { id: 'k3', ad: 'Akbank Axess', ay: 1 }, { id: 'h3', ad: 'Garanti ek hesap', ay: 2 }, { id: 'b2', ad: 'İhtiyaç kredisi (Garanti)', ay: 4 }, { id: 'b1', ad: 'Araç kredisi (Ziraat)', ay: 11 }]
      : [{ id: 'h3', ad: 'Garanti ek hesap', ay: 1 }, { id: 'k1', ad: 'Ziraat Bankkart Combo', ay: 1 }, { id: 'k3', ad: 'Akbank Axess', ay: 2 }, { id: 'b2', ad: 'İhtiyaç kredisi (Garanti)', ay: 4 }, { id: 'b1', ad: 'Araç kredisi (Ziraat)', ay: 12 }],
    acik: 0, kapanmiyor: false,
  });
  const cig = sonuc('CIG'), kartopu = sonuc('KARTOPU');
  return {
    donem: q.donem || BU_DONEM, defter: 'TUMU', gelir: GELIR, gider: GIDER, nakitYastigi: NAKIT_YASTIGI, nakitVarlik: NAKIT_VARLIK, bankaBakiyesi: BANKA, nakitKasasi: KASA.bakiye,
    kullanilabilirNakit: NAKIT_VARLIK, birikim, ortalamaAySayisi: 6, ortalamaGelir: 172900, ortalamaGider: 126300, buAyToplam: kapasite + birikim, otomatikKapasite: 46000,
    kapasite, strateji, kalemler, secilen: strateji === 'CIG' ? cig : kartopu,
    karsilastirma: { onerilen: 'CIG', cig, kartopu, faizFarki: 6540, ayFarki: 1 },
    fayda: [{ id: 'k3', ad: 'Akbank Axess', kazanc: 4130, ay: 1 }],
    not: 'Kart borçları önce ödendi çünkü aylık %4,25 ile en pahalı borç onlar; artan para İhtiyaç kredisine gidecek.',
  };
};

/* ── Kırılım (yıl) ───────────────────────────────────────────────────────────────────────── */
const kirilim = (yil) => {
  const donemler = Array.from({ length: 12 }, (_, i) => `${yil}-${String(i + 1).padStart(2, '0')}`);
  const satir = (k, temel, dalga) => {
    const aylar = {};
    donemler.forEach((d, i) => { if (Number(d.slice(5)) <= AY) aylar[d] = Math.round(temel * (1 + Math.sin(i + dalga) * 0.18)); });
    return { ad: k.ad, renk: k.renk, aylar, toplam: Object.values(aylar).reduce((t, v) => t + v, 0) };
  };
  return {
    yil, donemler,
    gelir: [satir(KATEGORILER[0], 118000, 0), satir(KATEGORILER[1], 21000, 1), satir(KATEGORILER[2], 22000, 5), satir(KATEGORILER[3], 6000, 2)],
    giderOfis: [satir(KATEGORILER[5], 40500, 1), satir(KATEGORILER[4], 25000, 4), satir(KATEGORILER[6], 18200, 2), satir(KATEGORILER[9], 4300, 3), satir(KATEGORILER[7], 3100, 0), satir(KATEGORILER[8], 2600, 5)],
    giderSahsi: [satir(KATEGORILER[13], 11500, 2), satir(KATEGORILER[10], 8100, 1), satir(KATEGORILER[17], 4900, 3), satir(KATEGORILER[11], 3500, 0), satir(KATEGORILER[12], 2700, 4), satir(KATEGORILER[15], 2100, 1), satir(KATEGORILER[16], 1900, 2), satir(KATEGORILER[14], 900, 5)],
  };
};

/* ── Hesap / kasa hareketleri ─────────────────────────────────────────────────────────────── */
const hesapHareketleri = (id) => {
  const h = HESAPLAR.find((x) => x.id === id);
  if (!h) return [];
  const kayit = (i, tarih, aciklama, kategori, defter, tutar, kayitTuru = 'ISLEM') => ({ id: `${id}-hh${i}`, tarih, aciklama, kategori, defter, tutar, kayitTuru });
  if (id === 'h1') return [
    kayit(1, g(1), 'Ofis kirası — Eylül', 'Ofis Kira', 'OFIS', -25000),
    kayit(2, g(1), 'Personel maaşları (3 kişi)', 'Personel Maaşı', 'OFIS', -42000),
    kayit(3, g(2), 'Ağustos müşavirlik tahsilatı (12 mükellef)', 'Müşavirlik Ücreti', null, 48500, 'CARI_TAHSILAT'),
    kayit(4, g(4), 'SGK primi + muhtasar', 'SGK ve Vergi', 'OFIS', -18600),
    kayit(5, g(5), 'Ağustos müşavirlik tahsilatı (9 mükellef)', 'Müşavirlik Ücreti', null, 36200, 'CARI_TAHSILAT'),
    kayit(6, g(12), 'Famcoffee şube açılış danışmanlığı', 'Danışmanlık', null, 25000),
    kayit(7, g(13), 'Ziraat → İş Bankası aktarım', null, 'OFIS', -20000, 'TRANSFER'),
    kayit(8, g(18), 'Ziraat Bankkart ekstre ödemesi', null, 'SAHSI', -20000, 'ODEME'),
  ];
  if (id === 'h2') return [
    kayit(1, g(2), 'Site aidatı', 'Ev Kira / Aidat', 'SAHSI', -3500),
    kayit(2, g(3), 'Dükkan kirası — Eylül', 'Kira Geliri', null, 22000),
    kayit(3, g(7), 'Elektrik + doğalgaz + internet', 'Faturalar', 'SAHSI', -2870),
    kayit(4, g(13), 'Ziraat → İş Bankası aktarım', null, 'SAHSI', 20000, 'TRANSFER'),
  ];
  return [kayit(1, g(9), 'Ağustos müşavirlik tahsilatı (11 mükellef)', 'Müşavirlik Ücreti', null, 41800, 'CARI_TAHSILAT'), kayit(2, g(10), 'Araç kredisi taksiti', null, 'SAHSI', -14850, 'ODEME')];
};
const KASA_HAREKETLERI = [
  { id: 'kh-1', tarih: g(15), donem: BU_DONEM, tur: 'GELIR', tutar: 13000, aciklama: 'Eski alacak tahsilatı', defter: 'SAHSI', kategori: { ad: 'Diğer Gelir', renk: '#9da8b7' } },
  { id: 'kh-2', tarih: g(17), donem: BU_DONEM, tur: 'GIDER', tutar: 1980, aciklama: 'Hafta sonu yemek', defter: 'SAHSI', kategori: { ad: 'Yemek / Eğlence', renk: '#e6c878' } },
  { id: 'kh-3', tarih: g(20), donem: BU_DONEM, tur: 'GIDER', tutar: 1000, aciklama: 'Eczane', defter: 'SAHSI', kategori: { ad: 'Sağlık', renk: '#f09aa8' } },
  { id: 'kh-4', tarih: g(6), donem: BU_DONEM, tur: 'GIDER', tutar: 1020, aciklama: 'Pazar alışverişi', defter: 'SAHSI', kategori: { ad: 'Market', renk: '#5ad18a' } },
];

/* ── Yapay zekâ ──────────────────────────────────────────────────────────────────────────── */
const AI_AYLIK = {
  id: 'ai1', tur: 'AYLIK', donem: BU_DONEM, icerik: [
    '## Bu ayın özeti',
    `Eylül gelirin **${GELIR.toLocaleString('tr-TR')} ₺**, giderin **${GIDER.toLocaleString('tr-TR')} ₺**; ay sonunda cebinde ${(GELIR - GIDER).toLocaleString('tr-TR')} ₺ kalıyor. Gelirin %68'i müşavirlik tahsilatı, bu sağlıklı bir dağılım.`,
    '## Dikkat çeken üç nokta',
    '- Ofis giderinin %45\'i personel maaşı; bu kalem sabit, gelir dalgalanınca nakit sıkışır.',
    '- Kişisel giderde **Eğitim (12.000 ₺)** bu ay en büyük kalem; taksitli olduğu için önümüzdeki 2 ay da sürecek.',
    '- Ziraat Bankkart ekstresinin 18.420 ₺ kalanı gecikti; gecikme faizi %4,75 ile ayda ~875 ₺ ekstra maliyet demek.',
    '',
    '## Ne yapmalı',
    '1. Geciken ekstreyi bugün kapat; Ziraat bakiyesi yeterli.',
    '2. Garanti ek hesabı (12.500 ₺) bu ay sıfırla; günlük 17,71 ₺ faiz gereksiz.',
    '3. Akbank Axess için 4 gün var; tamamını ödersen faiz işlemez.',
  ].join('\n'),
  model: 'claude-max', createdAt: new Date(BUGUN.getTime() - 3600e3).toISOString(), onbellek: true,
};
const AI_PLAN = { id: 'ai2', tur: 'PLAN', icerik: ['Çığ yöntemi seni Kartopu\'na göre **6.540 ₺** daha az faiz ödetiyor ve borcu 1 ay erken bitiriyor.', '- Bu ay iki kart borcunu tamamen kapatmak mantıklı: ikisi de aylık %4,25 ile en pahalı borçların.', '- İhtiyaç kredisine ekstra ödeme yapmak yerine önce ek hesabı sıfırla; oran aynı ama ek hesap her gün faiz işletiyor.', '- Araç kredisi en düşük oranlı (%3,5); en sona kalması doğru.'].join('\n'), model: 'claude-max', createdAt: new Date(BUGUN.getTime() - 7200e3).toISOString(), onbellek: true };
const AI_GECMIS = [
  { id: 'ai3', tur: 'SORU', soru: 'Bu ay en çok nereye harcadım?', icerik: 'Bu ay en büyük gider kalemin **Personel Maaşı (42.000 ₺)**, ardından **Ofis Kira (25.000 ₺)** ve **SGK ve Vergi (18.600 ₺)** geliyor. Kişisel tarafta ilk sırada **Eğitim (12.000 ₺)** var; bu üçü kişisel harcamanın %62\'sini oluşturuyor.', model: 'claude-max', createdAt: new Date(BUGUN.getTime() - 86400e3).toISOString() },
  { id: 'ai4', tur: 'SORU', soru: 'Hangi kartı önce kapatmalıyım?', icerik: 'Önce **Ziraat Bankkart Combo**: ekstresi gecikmiş ve gecikme faizi (%4,75) işliyor. Sonra **Akbank Axess**; son ödeme 4 gün sonra, tamamını ödersen faiz hiç işlemez. Garanti Bonus henüz kesilmedi, acele gerekmiyor.', model: 'claude-max', createdAt: new Date(BUGUN.getTime() - 43200e3).toISOString() },
];

const SABLONLAR = [
  { anahtar: 'ekstre-gecikti', baslik: 'Geciken ekstre', metin: 'Muzaffer Bey, Ziraat Bankkart Combo ekstresinin 18.420,00 ₺ kalanı 3 gündür gecikmiş durumda. Gecikme faizi işliyor; bugün ödemenizi öneririm.', gonderildi: false },
  { anahtar: 'son-odeme-yaklasti', baslik: 'Son ödeme yaklaşıyor', metin: `Muzaffer Bey, Akbank Axess ekstresi için son ödeme ${E.k3_bu.sonOdemeTarihi.split('-').reverse().join('.')} (4 gün kaldı). Borç 21.750,00 ₺, asgari 4.350,00 ₺.`, gonderildi: false },
  { anahtar: 'tutar-bekleniyor', baslik: 'Ekstre tutarı bekleniyor', metin: `Muzaffer Bey, Garanti Bonus Platinum ekstresi ${E.k2_bu.kesimTarihi.split('-').reverse().join('.')} tarihinde kesilecek; PDF'i yüklerseniz hareketleri okurum.`, gonderildi: false },
];

/* ── Uçlar ───────────────────────────────────────────────────────────────────────────────── */
function uclar(yol, yontem, q, govde, jsonGonder, res) {
  if (!yol.startsWith(ONEK + '/')) return false;
  const y = yol.slice(ONEK.length);
  const ok = (veri) => jsonGonder(res, 200, veri);

  if (y === '/erisim') return ok({ yetkili: true });
  if (y === '/pin/durum') return ok({ kurulu: true, kilitli: false, kilitBitis: null, kalanDeneme: 5 });
  if (y === '/pin/ac' || y === '/pin/kur') return ok({ bilet: 'sahte-bilet', bitis: Date.now() + 3600e3 });
  if (y === '/ozet') return ok(ozet(q.donem || BU_DONEM));
  if (y === '/hesaplar' && yontem === 'GET') return ok(HESAPLAR);
  if (y === '/kasa') return ok(KASA);
  if (y === '/kasa/hareketler') return ok(q.donem && q.donem !== BU_DONEM ? [] : KASA_HAREKETLERI);
  if (y === '/tahsilat-ozet') return ok({ hesabiSecilmemis: { adet: 2, toplam: 9400 }, arsiv: { adet: 0, toplam: 0 } });
  if (y === '/kirilim') return ok(kirilim(Number(q.yil) || YIL));
  const hh = /^\/hesaplar\/([^/]+)\/hareketler$/.exec(y);
  if (hh) return ok(hesapHareketleri(hh[1]));
  if (y === '/nakit-akis') return ok(nakitAkis(Number(q.gunSayisi) || 30));
  if (y === '/ayar' && yontem === 'GET') return ok({ nakitYastigi: NAKIT_YASTIGI, strateji: 'CIG', hatirlatmaWhatsapp: true, hatirlatmaPortal: true, hatirlatmaEmail: false, whatsappNumara: '905350587475', sabahSaati: 9 });
  if (y === '/kategoriler' && yontem === 'GET') return ok(KATEGORILER);
  if (y === '/islemler' && yontem === 'GET') return ok((q.donem || BU_DONEM) === BU_DONEM ? ISLEMLER : []);
  if (y === '/duzenliler' && yontem === 'GET') return ok([]);
  if (y === '/kartlar' && yontem === 'GET') return ok(KARTLAR);
  if (y === '/ekstreler' && yontem === 'GET') return ok(q.kartId ? EKSTRELER.filter((e) => e.kartId === q.kartId) : EKSTRELER);
  const eh = /^\/ekstreler\/([^/]+)\/hareketler$/.exec(y);
  if (eh && yontem === 'GET') return ok(KART_HAREKETLERI[eh[1]] || []);
  if (y === '/borclar' && yontem === 'GET') return ok(q.hepsi === '1' ? BORCLAR : BORCLAR.filter((b) => b.durum === 'AKTIF'));
  if (y === '/plan') return ok(plan(q));
  if (y === '/fayda') return ok({ tutar: Number(q.tutar) || 0, siralama: [{ id: 'k3', ad: 'Akbank Axess', kazanc: 4130, ay: 1 }, { id: 'h3', ad: 'Garanti ek hesap', kazanc: 3190, ay: 2 }, { id: 'b2', ad: 'İhtiyaç kredisi (Garanti)', kazanc: 2610, ay: 4 }, { id: 'b1', ad: 'Araç kredisi (Ziraat)', kazanc: 1980, ay: 11 }] });
  if (y === '/ai/aylik-yorum') return ok(AI_AYLIK);
  if (y === '/ai/plan-yorum') return ok(AI_PLAN);
  if (y === '/ai/gecmis') return ok(q.tur === 'SORU' ? AI_GECMIS : [AI_AYLIK, AI_PLAN]);
  if (y === '/ai/soru') return ok({ id: `ai-${Date.now()}`, tur: 'SORU', soru: govde && govde.soru, icerik: `"${(govde && govde.soru) || ''}" sorusu için: verinizde bu ay ${ISLEMLER.length} kayıt var. Toplam gelir ${GELIR.toLocaleString('tr-TR')} ₺, gider ${GIDER.toLocaleString('tr-TR')} ₺; en büyük kalem Personel Maaşı.`, model: 'claude-max', createdAt: new Date().toISOString() });
  if (y === '/sablon-testi') return ok(SABLONLAR.map((s) => ({ ...s, gonderildi: !!(govde && govde.gonder) })));

  // Yazma uçları: önizlemede yalnız "tamam" döner; veri değişmez.
  if (yontem === 'POST' || yontem === 'PUT' || yontem === 'DELETE' || yontem === 'PATCH') {
    console.log('[mock] bütçe yazma', yontem, y, JSON.stringify(govde || {}).slice(0, 120));
    return ok({ ok: true, id: 'sahte', pasifeAlindi: false, islenen: 0, geriAlinan: 0, eklenen: 0, toplam: 0, tutar: (govde && govde.tutar) || 0, transferGrupId: 'sahte', aciklama: '' });
  }
  return false;
}

module.exports = { uclar };
