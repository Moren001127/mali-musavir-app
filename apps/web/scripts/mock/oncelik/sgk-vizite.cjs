// SGK e-Rapor (vizite) + hastane iş kazası — öncelikli sahte uçlar (2026-09-26, YALNIZ önizleme).
// Kişiler UYDURMA; TC numaraları sağlama hanesi tutmayan sıralı sayılar (gerçek kimlik olamaz).
// İşyerleri mevcut sahte mükellef listesinden (mock/kdv-grubu.cjs MUK: m4, m6, m7) — mükellef seçici aynı kimlikleri kullanır.
// Tarihler bugüne göre (İstanbul) hesaplanır ki betik hangi gün çalışırsa çalışsın "süresi geçti" vb. doğru çıksın.
//   GET  /sgk-vizite/ozet?taxpayerId=
//   GET  /sgk-vizite/raporlar?durum=bekleyen|onaylanan&taxpayerId=
//   GET  /sgk-vizite/is-kazalari?taxpayerId=
//   GET  /sgk-vizite/durumlar
//   POST /sgk-vizite/sorgula { taxpayerIds? }            → sorgu ~20 sn (tek mükellef ~6 sn) "sürüyor", ilerlemeli
//   POST /sgk-vizite/raporlar/:id/onay                    → sr2: SGK hatası 802; diğerleri başarılı (rapor onaylananlara geçer)
//   POST /sgk-vizite/raporlar/:id/personelim-degil        → başarılı (rapor listeden düşer)
//   POST /sahte/sgk-vizite/sifirla                        → önizleme betiği başında durumu sıfırlar
const TZ = 'Europe/Istanbul';
const bugunIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function gunEkle(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const G = (n) => gunEkle(bugunIso(), n);
const zaman = (gunFarki, saat, dakika) => new Date(`${G(gunFarki)}T${String(saat).padStart(2, '0')}:${String(dakika).padStart(2, '0')}:00+03:00`).toISOString();
const gunSayisi = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
const enKucuk = (a, b) => (a < b ? a : b);
// Kazadan sonraki 3. iş günü (yalnız hafta sonu; sahte veri için yeterli).
function bildirimSonGun(kaza) {
  let t = kaza;
  let n = 0;
  while (n < 3) {
    t = gunEkle(t, 1);
    const g = new Date(`${t}T00:00:00Z`).getUTCDay();
    if (g !== 0 && g !== 6) n++;
  }
  return t;
}

const MUK = { m1: 'Öz Ela Gıda San. ve Tic. Ltd. Şti.', m4: 'Mert Reklam Ajansı Ltd. Şti.', m6: 'Ela Tekstil Ltd. Şti.', m7: 'Balçık İnşaat A.Ş.' };
const VAKA = { 1: 'İş Kazası', 2: 'Meslek Hastalığı', 3: 'Hastalık', 4: 'Analık' };
const DURUM = { 1: 'Çalışır', 2: 'Kontrol', 3: 'Devamı Verildi', 10: 'Analık Doğum Öncesi Çalışır' };

function rapor(o) {
  const parcalar = o.parcalar || [];
  const sonOnay = parcalar.length ? parcalar[parcalar.length - 1].bitis : null;
  const onayBaslangic = sonOnay ? gunEkle(sonOnay, 1) : o.bas;
  return {
    id: o.id,
    taxpayerId: o.tp,
    mukellefAdi: MUK[o.tp],
    medulaRaporId: `MR-${o.id.toUpperCase()}-2026`,
    tcKimlikNo: o.tc,
    adSoyad: o.ad,
    vaka: String(o.vaka),
    vakaAdi: VAKA[o.vaka],
    poliklinikTarihi: o.bas,
    raporBaslangic: o.bas,
    raporBitis: o.bit,
    isbasiKontrolTarihi: o.isbasi,
    gunSayisi: gunSayisi(o.bas, o.bit),
    raporDurumuKodu: String(o.dk),
    raporDurumuAdi: DURUM[o.dk],
    isKazasiTarihi: o.vaka === 1 ? o.bas : null,
    durum: o.durum,
    onayParcalari: parcalar,
    onayBaslangic,
    onayEnGecBitis: enKucuk(o.bit, bugunIso()),
    kalanBaslangic: o.durum === 'PARCALI' ? onayBaslangic : null,
    kalanBitis: o.durum === 'PARCALI' ? o.bit : null,
    ilkGorulme: zaman(-3, 3, 10),
    sonGorulme: zaman(0, 3, 12),
    sonPortalIslemi: o.son || null,
  };
}

function kaza(o) {
  return {
    id: o.id,
    taxpayerId: o.tp,
    mukellefAdi: MUK[o.tp],
    bildirimId: `HB-${o.id.toUpperCase()}`,
    tcKimlikNo: o.tc,
    adSoyad: o.ad,
    cinsiyet: o.cinsiyet,
    isKazasiTarihi: o.tarih,
    provizyonTarihi: o.tarih,
    tesisAdi: o.tesis,
    unvani: null,
    islemTuru: o.tur,
    sgkBildirimSonGun: bildirimSonGun(o.tarih),
    ilkGorulme: zaman(0, 3, 12),
  };
}

let DURUMLAR_VERI;
let BEKLEYEN;
let ONAYLANAN;
let KAZALAR;
let SORGU = null; // { bas: ms, toplam }

function sifirla() {
  SORGU = null;
  BEKLEYEN = [
    rapor({ id: 'sr1', tp: 'm7', tc: '23456789012', ad: 'SELİN ARSLAN', vaka: 3, bas: G(-4), bit: G(0), isbasi: G(1), dk: 1, durum: 'BEKLIYOR' }),
    rapor({
      id: 'sr2', tp: 'm4', tc: '34567890123', ad: 'MURAT KILIÇ', vaka: 3, bas: G(-11), bit: G(-7), isbasi: G(-6), dk: 2, durum: 'BEKLIYOR',
      son: { islem: 'ONAY', tarih: zaman(-1, 10, 42), kullanici: 'Deneme Kullanıcı', basarili: false, sonucKod: 802, sonucAciklama: 'Girdiğiniz Tarih, Rapor Bitiş Tarihinden Büyük Olamaz.' },
    }),
    rapor({
      id: 'sr3', tp: 'm7', tc: '45678901234', ad: 'ELİF ŞAHİN', vaka: 3, bas: G(-52), bit: G(4), isbasi: G(5), dk: 3, durum: 'PARCALI',
      parcalar: [{ baslangic: G(-52), bitis: G(-26), calisti: false, islemTarihi: G(-25), odemeCikti: true }],
      son: { islem: 'ONAY', tarih: zaman(-25, 14, 20), kullanici: 'Deneme Kullanıcı', basarili: true, sonucKod: 0, sonucAciklama: 'İşlem başarılı.' },
    }),
  ];
  ONAYLANAN = [
    rapor({
      id: 'so1', tp: 'm6', tc: '56789012345', ad: 'HAKAN ÇELİK', vaka: 3, bas: G(-24), bit: G(-22), isbasi: G(-21), dk: 1, durum: 'ONAYLANDI',
      parcalar: [{ baslangic: G(-24), bitis: G(-22), calisti: false, islemTarihi: G(-20), odemeCikti: true }],
    }),
    rapor({
      id: 'so2', tp: 'm6', tc: '67890123456', ad: 'ZEYNEP AYDIN', vaka: 4, bas: G(-47), bit: G(-40), isbasi: G(-39), dk: 10, durum: 'ONAYLANDI',
      parcalar: [{ baslangic: G(-47), bitis: G(-40), calisti: false, islemTarihi: G(-39), odemeCikti: false }],
    }),
    rapor({
      id: 'so3', tp: 'm7', tc: '78901234567', ad: 'BURAK YILDIZ', vaka: 1, bas: G(-60), bit: G(-45), isbasi: G(-44), dk: 1, durum: 'ONAYLANDI',
      parcalar: [
        { baslangic: G(-60), bitis: G(-53), calisti: false, islemTarihi: G(-52), odemeCikti: true },
        { baslangic: G(-52), bitis: G(-45), calisti: true, islemTarihi: G(-44), odemeCikti: null },
      ],
    }),
  ];
  KAZALAR = [
    // Süresi geçmiş (BURAK YILDIZ'ın raporundan ad dolu)
    kaza({ id: 'ik1', tp: 'm7', tc: '78901234567', ad: 'BURAK YILDIZ', cinsiyet: 'E', tarih: G(-60), tesis: 'MERKEZ DEVLET HASTANESİ', tur: 'Ayaktan' }),
    // Süresi dolmamış; raporu henüz yok → ad boş
    kaza({ id: 'ik2', tp: 'm4', tc: '90123456789', ad: null, cinsiyet: 'K', tarih: G(-1), tesis: 'ÖZEL ŞİFA TIP MERKEZİ', tur: 'Yatarak' }),
  ];
  DURUMLAR_VERI = [
    { taxpayerId: 'm7', mukellefAdi: MUK.m7, sonSorgu: zaman(0, 3, 4), sonBasari: zaman(0, 3, 4), hata: null },
    { taxpayerId: 'm4', mukellefAdi: MUK.m4, sonSorgu: zaman(0, 3, 6), sonBasari: zaman(0, 3, 6), hata: null },
    { taxpayerId: 'm6', mukellefAdi: MUK.m6, sonSorgu: zaman(0, 3, 8), sonBasari: zaman(0, 3, 8), hata: null },
    { taxpayerId: 'm1', mukellefAdi: MUK.m1, sonSorgu: zaman(0, 3, 10), sonBasari: zaman(-4, 3, 9), hata: 'SGK girişi reddedildi: kullanıcı adı, işyeri kodu ya da işyeri şifresi hatalı.' },
  ];
}
sifirla();

function sorguDurumu() {
  if (!SORGU) return { suruyor: false, toplam: 0, biten: 0, baslangic: null };
  const sure = SORGU.toplam === 1 ? 6_000 : 20_000;
  const gecen = Date.now() - SORGU.bas;
  if (gecen >= sure) { SORGU = null; return { suruyor: false, toplam: 0, biten: 0, baslangic: null }; }
  return { suruyor: true, toplam: SORGU.toplam, biten: Math.min(SORGU.toplam - 1, Math.floor((gecen / sure) * SORGU.toplam)), baslangic: new Date(SORGU.bas).toISOString() };
}

const suz = (dizi, tp) => (tp ? dizi.filter((r) => r.taxpayerId === tp) : dizi);

function uclar(yol, yontem, q, govde, jsonGonder, res) {
  if (yontem === 'POST' && yol === '/sahte/sgk-vizite/sifirla') { sifirla(); return jsonGonder(res, 200, { ok: true }); }
  if (!yol.startsWith('/sgk-vizite/')) return false;

  if (yontem === 'GET' && yol === '/sgk-vizite/ozet') {
    const bek = suz(BEKLEYEN, q.taxpayerId);
    return jsonGonder(res, 200, {
      onayBekleyen: bek.length,
      parcali: bek.filter((r) => r.durum === 'PARCALI').length,
      onaylanan: suz(ONAYLANAN, q.taxpayerId).length,
      isKazasi: suz(KAZALAR, q.taxpayerId).length,
      iseGirisCikisBagli: false,
      sonGeceSorgusu: { tarih: zaman(0, 3, 12), mukellefSayisi: 54, hataSayisi: 1 },
      sorgu: sorguDurumu(),
      sgkSifreliMukellef: 54,
    });
  }
  if (yontem === 'GET' && yol === '/sgk-vizite/raporlar') {
    const kaynak = q.durum === 'onaylanan' ? ONAYLANAN : BEKLEYEN;
    return jsonGonder(res, 200, { satirlar: suz(kaynak, q.taxpayerId) });
  }
  if (yontem === 'GET' && yol === '/sgk-vizite/is-kazalari') return jsonGonder(res, 200, { satirlar: suz(KAZALAR, q.taxpayerId) });
  if (yontem === 'GET' && yol === '/sgk-vizite/durumlar') return jsonGonder(res, 200, { satirlar: DURUMLAR_VERI });

  if (yontem === 'POST' && yol === '/sgk-vizite/sorgula') {
    const ids = Array.isArray(govde.taxpayerIds) ? govde.taxpayerIds : [];
    const n = ids.length || 54;
    SORGU = { bas: Date.now(), toplam: n };
    return jsonGonder(res, 200, {
      baslatildi: true,
      mukellefSayisi: n,
      mesaj: n === 1 ? 'Mükellef için SGK sorgusu başlatıldı.' : `${n} mükellef için SGK sorgusu başlatıldı; yaklaşık ${n} dakika sürer.`,
    });
  }

  const onay = /^\/sgk-vizite\/raporlar\/([^/]+)\/onay$/.exec(yol);
  if (onay && yontem === 'POST') {
    const r = BEKLEYEN.find((x) => x.id === onay[1]);
    if (!r) return jsonGonder(res, 404, { message: 'Rapor bulunamadı.' });
    const tarih = new Date().toISOString();
    if (r.id === 'sr2') {
      const aciklama = 'Girdiğiniz Tarih, Rapor Bitiş Tarihinden Büyük Olamaz.';
      r.sonPortalIslemi = { islem: 'ONAY', tarih, kullanici: 'Deneme Kullanıcı', basarili: false, sonucKod: 802, sonucAciklama: aciklama };
      return jsonGonder(res, 200, { basarili: false, sonucKod: 802, sonucAciklama: aciklama, rapor: r });
    }
    const bitis = String(govde.bitisTarihi || r.onayEnGecBitis);
    r.onayParcalari = [...r.onayParcalari, { baslangic: r.onayBaslangic, bitis, calisti: !!govde.calisti, islemTarihi: G(0), odemeCikti: null }];
    r.sonPortalIslemi = { islem: 'ONAY', tarih, kullanici: 'Deneme Kullanıcı', basarili: true, sonucKod: 0, sonucAciklama: 'İşlem başarılı.' };
    if (bitis >= r.raporBitis) {
      r.durum = 'ONAYLANDI';
      r.kalanBaslangic = null;
      r.kalanBitis = null;
      BEKLEYEN = BEKLEYEN.filter((x) => x.id !== r.id);
      ONAYLANAN = [r, ...ONAYLANAN];
    } else {
      r.durum = 'PARCALI';
      r.onayBaslangic = gunEkle(bitis, 1);
      r.kalanBaslangic = r.onayBaslangic;
      r.kalanBitis = r.raporBitis;
    }
    return jsonGonder(res, 200, { basarili: true, sonucKod: 0, sonucAciklama: 'İşlem başarılı.', rapor: r });
  }

  const personel = /^\/sgk-vizite\/raporlar\/([^/]+)\/personelim-degil$/.exec(yol);
  if (personel && yontem === 'POST') {
    const r = BEKLEYEN.find((x) => x.id === personel[1]);
    if (!r) return jsonGonder(res, 404, { message: 'Rapor bulunamadı.' });
    BEKLEYEN = BEKLEYEN.filter((x) => x.id !== r.id);
    return jsonGonder(res, 200, { basarili: true, sonucKod: 0, sonucAciklama: 'Personelim değil bildirimi kaydedildi.', rapor: null });
  }
  return false;
}

module.exports = { uclar };
