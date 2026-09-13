// HESAP DAVRANIS DENETIMI — Vergi (360), SGK (361), personel (335) borc dongusu + bordro makullugu.
//   Mantik: alacak = tahakkuk, karsi tarafta para/ortak/mahsup olan borc = odeme. Olaylar tarih sirali
//   yurutulur; her odeme once TUTARI BIREBIR tutan tahakkuku, sonra ayni ayin toplamini, en son FIFO
//   ile en eski acik tahakkuku kapatir. Donem sonunda vadesi donem icinde dolan (son ay haric) acik
//   tahakkuklar "odenmemis", kismen kapananlar "tutar uyumsuz" olur. Bordro fisi icindeki borc satirlari
//   (SGK tesviki) odeme sayilmaz (siniflandirma DUZELTME).
import { ESIK } from '../esikler';
import { ayAdi, ayEkle, capa, fmtTL, hesapEtiketi, hesaplarAna } from '../istatistik';
import type { Bulgu, DenetimBaglami, Hareket, HesapIstatistik, KuralSonucu } from '../tipler';

type AcikTahakkuk = { ay: string; tutar: number; kalan: number; adet: number; onceki: boolean };

type DonguSonucu = {
  h: HesapIstatistik;
  odenmemisAylar: { ay: string; tahakkuk: number; kalan: number; adet: number }[];
  kismiAylar: { ay: string; tahakkuk: number; kalan: number }[];
  sonAyTahakkuk: number;
  oncekiDevir: number | null; // donem basi borc (Mizan), null = bilinmiyor
  oncekiKalan: number; // donem basi borcun odenmeyen kismi
  fazlaOdeme: number; // hicbir tahakkuka eslesmeyen odeme (yalniz acilis biliniyorsa anlamli)
  tarihsiz: number;
  odemeToplam: number;
  tahakkukToplam: number;
};

function olaylar(h: HesapIstatistik): { tahakkuk: Hareket[]; odeme: Hareket[]; tarihsiz: number } {
  const tahakkuk: Hareket[] = [];
  const odeme: Hareket[] = [];
  let tarihsiz = 0;
  for (const m of h.hareketler) {
    if (!m.ay || !m.tarih) { tarihsiz += 1; continue; }
    if (m.taraf === 'ALACAK') tahakkuk.push(m);
    else if (m.sinif === 'ODEME' || m.sinif === 'MAHSUP') odeme.push(m);
    // DUZELTME / IADE / DIGER borc: odeme degil (tesvik, duzeltme, alt hesaplar arasi virman)
  }
  return { tahakkuk, odeme, tarihsiz };
}

export function borcDongusu(h: HesapIstatistik, aylar: string[]): DonguSonucu | null {
  if (!aylar.length) return null;
  const { tahakkuk, odeme, tarihsiz } = olaylar(h);
  const acik: AcikTahakkuk[] = [];
  const oncekiDevir = h.acilis != null ? -h.acilis : null; // alacak bakiye pozitif
  if (oncekiDevir != null && oncekiDevir > ESIK.VERGI_TAHAKKUK_MIN) {
    acik.push({ ay: ayEkle(aylar[0], -1), tutar: oncekiDevir, kalan: oncekiDevir, adet: 1, onceki: true });
  }
  // Ayni gun: once tahakkuk, sonra odeme (ayni fiste tahakkuk+odeme olabilir)
  const sirali: { tur: 'T' | 'O'; m: Hareket }[] = [
    ...tahakkuk.map((m) => ({ tur: 'T' as const, m })),
    ...odeme.map((m) => ({ tur: 'O' as const, m })),
  ].sort((a, b) => {
    const t = a.m.tarih!.getTime() - b.m.tarih!.getTime();
    if (t !== 0) return t;
    if (a.tur !== b.tur) return a.tur === 'T' ? -1 : 1;
    return a.m.satir.rowIndex - b.m.satir.rowIndex;
  });

  const tol = (x: number) => Math.max(ESIK.VERGI_ESLESME_TOLERANS_TL, x * ESIK.VERGI_ESLESME_TOLERANS_ORAN);
  let fazlaOdeme = 0;
  let odemeToplam = 0;
  let tahakkukToplam = 0;
  for (const ev of sirali) {
    if (ev.tur === 'T') {
      tahakkukToplam += ev.m.tutar;
      const ay = ev.m.ay!;
      const ayniAy = acik.find((a) => a.ay === ay && !a.onceki);
      // Ayni ayin tahakkuklari tek kalemde izlenir (21 tevkifat satiri = 1 aylik beyanname)
      if (ayniAy) { ayniAy.tutar += ev.m.tutar; ayniAy.kalan += ev.m.tutar; ayniAy.adet += 1; }
      else acik.push({ ay, tutar: ev.m.tutar, kalan: ev.m.tutar, adet: 1, onceki: false });
      continue;
    }
    let pay = ev.m.tutar;
    odemeToplam += pay;
    const odemeAyi = ev.m.ay!;
    const eslesir = (a: AcikTahakkuk) => a.kalan > 0 && Math.abs(a.kalan - pay) <= tol(a.kalan);
    // 1) Odeme ayinin bir onceki ayina ait tahakkuk (vade mantigi: M tahakkuku M+1'de odenir),
    //    sonra ayni aya ait (beyanname gunu tahakkuk+odeme), sonra tutari birebir tutan herhangi bir acik kalem
    const birebir =
      acik.find((a) => !a.onceki && a.ay === ayEkle(odemeAyi, -1) && eslesir(a)) ||
      acik.find((a) => !a.onceki && a.ay === odemeAyi && eslesir(a)) ||
      acik.find(eslesir);
    if (birebir) { birebir.kalan = 0; continue; }
    // 2) FIFO (en eski acik kalemden baslayarak)
    for (const a of acik) {
      if (a.kalan <= 0) continue;
      const al = Math.min(a.kalan, pay);
      a.kalan -= al;
      pay -= al;
      if (pay <= 0.005) break;
    }
    if (pay > 0.005) fazlaOdeme += pay;
  }

  const sonAy = aylar[aylar.length - 1];
  const odenmemisAylar: DonguSonucu['odenmemisAylar'] = [];
  const kismiAylar: DonguSonucu['kismiAylar'] = [];
  let sonAyTahakkuk = 0;
  let oncekiKalan = 0;
  for (const a of acik) {
    if (a.onceki) { oncekiKalan = a.kalan; continue; }
    if (a.tutar < ESIK.VERGI_TAHAKKUK_MIN) continue;
    if (a.ay >= sonAy) { sonAyTahakkuk += a.tutar; continue; } // vadesi sonraki donemde
    if (!aylar.includes(a.ay)) continue; // donem disi tarihli (ayri kural yakalar)
    const kismiTol = Math.max(ESIK.VERGI_KISMI_TOLERANS_TL, a.tutar * ESIK.VERGI_KISMI_TOLERANS_ORAN);
    if (a.kalan <= kismiTol) continue; // odenmis
    if (a.kalan >= a.tutar - tol(a.tutar)) odenmemisAylar.push({ ay: a.ay, tahakkuk: a.tutar, kalan: a.kalan, adet: a.adet });
    else kismiAylar.push({ ay: a.ay, tahakkuk: a.tutar, kalan: a.kalan });
  }
  return { h, odenmemisAylar, kismiAylar, sonAyTahakkuk, oncekiDevir, oncekiKalan, fazlaOdeme, tarihsiz, odemeToplam, tahakkukToplam };
}

const HESAP_BILGI: Record<string, { kod: string; ad: string; vadeNotu: string; ekNot: string }> = {
  '360': { kod: 'VERGI_360_ODEME_YOK', ad: 'vergi', vadeNotu: 'izleyen ayın 26/28\'ine kadar', ekNot: 'Ödeme banka ekstresinden işlenmemiş olabilir; gerçekten ödenmediyse gecikme zammı (6183) işler.' },
  '361': { kod: 'SGK_361_ODEME_YOK', ad: 'SGK primi', vadeNotu: 'izleyen ayın sonuna kadar', ekNot: 'Fiilen ödenmeyen SGK primi gider yazılamaz (5510 md. 88 — KKEG) ve teşvikler kaybedilir.' },
  '335': { kod: 'PERSONEL_335_ODEME_YOK', ad: 'net ücret', vadeNotu: 'izleyen ay içinde', ekNot: 'Banka maaş ödemeleri işlenmemiş olabilir; ödenmemiş ücret iş hukuku riski taşır.' },
};

function odemeYokKurali(b: DenetimBaglami, ana: '335' | '360' | '361'): KuralSonucu {
  const bilgi = HESAP_BILGI[ana];
  const kod = bilgi.kod;
  if (b.ozet.aySayisi < 2) return { kod, durum: 'UYGULANMAZ', bulgular: [], not: 'Tek aylık dönemde ödeme vadesi dönem içine düşmez' };
  const hesaplar = hesaplarAna(b, ana);
  if (!hesaplar.length) return { kod, durum: 'VERI_YOK', bulgular: [], not: `Dönemde ${ana} hareketi yok` };
  const bulgular: Bulgu[] = [];
  for (const h of hesaplar) {
    const d = borcDongusu(h, b.ozet.aylar);
    if (!d || !d.odenmemisAylar.length) continue;
    const aylarYazi = d.odenmemisAylar
      .map((a) => `${ayAdi(a.ay)} tahakkuku ${fmtTL(a.tahakkuk)} TL${a.adet > 1 ? ` (${a.adet} kayıt)` : ''} → ${ayAdi(ayEkle(a.ay, 1))} içinde ödeme yok`)
      .join('; ');
    const ustUste = d.odenmemisAylar.length >= 2;
    const sonAyNotu = d.sonAyTahakkuk > 0 ? ` ${ayAdi(b.ozet.aylar[b.ozet.aylar.length - 1])} tahakkuku (${fmtTL(d.sonAyTahakkuk)} TL) sonraki dönemde ödenir, sayılmadı.` : '';
    const tarihsizNotu = d.tarihsiz > 0 ? ` ${d.tarihsiz} tarihsiz satır değerlendirilemedi.` : '';
    const bakiyeNotu = h.mizanKapanis != null ? ` Mizan bakiyesi ${fmtTL(-h.mizanKapanis)} TL.` : '';
    bulgular.push({
      severity: ustUste && ana !== '335' ? 'ERROR' : 'WARN',
      category: kod,
      message: `${hesapEtiketi(h)}: ${aylarYazi}.${ustUste ? ` ${d.odenmemisAylar.length} ay üst üste ${bilgi.ad} ödemesi yok.` : ''} ${bilgi.ekNot}${bakiyeNotu}${sonAyNotu}${tarihsizNotu}`,
      ...capa(h),
      detail: {
        tutar: d.odenmemisAylar.reduce((s, a) => s + a.kalan, 0),
        odenmemisAylar: d.odenmemisAylar,
        tahakkukToplam: d.tahakkukToplam,
        odemeToplam: d.odemeToplam,
        sonAyTahakkuk: d.sonAyTahakkuk,
        mizanKapanis: h.mizanKapanis,
        hesapAdi: h.ad,
      },
    });
  }
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [], not: `${hesaplar.length} ${ana} alt hesabında tahakkuk→ödeme döngüsü tutarlı` };
  return { kod, durum: 'BULGU', bulgular };
}

export function kuralVergi360OdemeYok(b: DenetimBaglami): KuralSonucu {
  return odemeYokKurali(b, '360');
}
export function kuralSgk361OdemeYok(b: DenetimBaglami): KuralSonucu {
  return odemeYokKurali(b, '361');
}
export function kuralPersonel335OdemeYok(b: DenetimBaglami): KuralSonucu {
  return odemeYokKurali(b, '335');
}

export function kuralVergiSgkTutarUyumsuz(b: DenetimBaglami): KuralSonucu {
  const kod = 'VERGI_SGK_ODEME_TUTAR_UYUMSUZ';
  if (b.ozet.aySayisi < 2) return { kod, durum: 'UYGULANMAZ', bulgular: [], not: 'Tek aylık dönem' };
  const hesaplar = [...hesaplarAna(b, '360'), ...hesaplarAna(b, '361'), ...hesaplarAna(b, '335')];
  if (!hesaplar.length) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Dönemde 335/360/361 hareketi yok' };
  const bulgular: Bulgu[] = [];
  for (const h of hesaplar) {
    const d = borcDongusu(h, b.ozet.aylar);
    if (!d || !d.kismiAylar.length) continue;
    const yazi = d.kismiAylar.map((a) => `${ayAdi(a.ay)} tahakkuku ${fmtTL(a.tahakkuk)} TL, ödenmeyen ${fmtTL(a.kalan)} TL`).join('; ');
    bulgular.push({
      severity: 'INFO',
      category: kod,
      message: `${hesapEtiketi(h)}: ${yazi}. Kısmi ödeme, gecikme zammı, mahsup ya da teşvik farkı olabilir; farkın sebebi doğru hesaba işlenmeli.`,
      ...capa(h),
      detail: { tutar: d.kismiAylar.reduce((s, a) => s + a.kalan, 0), kismiAylar: d.kismiAylar, hesapAdi: h.ad },
    });
  }
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [] };
  return { kod, durum: 'BULGU', bulgular };
}

export function kuralVergiSgkTersBakiye(b: DenetimBaglami): KuralSonucu {
  const kod = 'VERGI_SGK_TERS_BAKIYE';
  const hesaplar = [...hesaplarAna(b, '360'), ...hesaplarAna(b, '361'), ...hesaplarAna(b, '335')];
  if (!hesaplar.length) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Dönemde 335/360/361 hareketi yok' };
  const bulgular: Bulgu[] = [];
  for (const h of hesaplar) {
    // Kesin: Mizan/acilis biliniyorsa kapanis borc bakiye; bilinmiyorsa donem neti borc VE ilk ayda tahakkuk oldugu halde
    //   odeme tahakkuku asiyorsa (onceki donem borcu bahanesi kalmaz).
    let tersTutar = 0;
    let kesin = false;
    if (h.kapanis != null) {
      if (h.kapanis > 1) { tersTutar = h.kapanis; kesin = true; }
    } else {
      const d = borcDongusu(h, b.ozet.aylar);
      if (d && d.fazlaOdeme > 1 && h.net > 1) {
        // acilis bilinmiyor: ilk aydaki odemeler onceki donem tahakkuku olabilir → ilk ay odemesini dus
        const ilkAy = b.ozet.aylar[0];
        const ilkAyOdeme = h.hareketler.filter((m) => m.taraf === 'BORC' && m.ay === ilkAy && (m.sinif === 'ODEME' || m.sinif === 'MAHSUP')).reduce((s, m) => s + m.tutar, 0);
        const kalanFazla = h.net - ilkAyOdeme;
        if (kalanFazla > 1) tersTutar = kalanFazla;
      }
    }
    if (tersTutar <= 1) continue;
    bulgular.push({
      severity: 'WARN',
      category: kod,
      message: `${hesapEtiketi(h)}: ${kesin ? 'kapanış' : 'dönem hareketi'} ${fmtTL(tersTutar)} TL BORÇ bakiye veriyor (ödeme tahakkuku aşmış)${kesin ? '' : ' — açılış bakiyesi bilinmiyor, ilk ay ödemeleri düşüldü'}. Ödeme yanlış alt hesaba işlenmiş ya da tahakkuk kaydı eksik olabilir.`,
      ...capa(h),
      detail: { tutar: tersTutar, kesin, borc: h.borc, alacak: h.alacak, acilis: h.acilis, hesapAdi: h.ad },
    });
  }
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [] };
  return { kod, durum: 'BULGU', bulgular };
}

export function kuralVergiSgkDevredenBorc(b: DenetimBaglami): KuralSonucu {
  const kod = 'VERGI_SGK_DEVREDEN_BORC_ODENMEMIS';
  if (!b.ozet.mizanVar && !b.ozet.acilisFisiVeride) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Açılış bakiyesi bilinmiyor (Mizan yok)' };
  if (b.ozet.aySayisi < 2) return { kod, durum: 'UYGULANMAZ', bulgular: [], not: 'Tek aylık dönem' };
  const hesaplar = [...hesaplarAna(b, '360'), ...hesaplarAna(b, '361'), ...hesaplarAna(b, '335')];
  // Hareketsiz ama Mizan'da alacak bakiyesi olan 360/361/335 de devreden borctur
  const bulgular: Bulgu[] = [];
  for (const h of hesaplar) {
    const d = borcDongusu(h, b.ozet.aylar);
    if (!d || d.oncekiDevir == null || d.oncekiKalan <= ESIK.VERGI_KISMI_TOLERANS_TL) continue;
    bulgular.push({
      severity: 'WARN',
      category: kod,
      message: `${hesapEtiketi(h)}: dönem başında bekleyen ${fmtTL(d.oncekiDevir)} TL borcun ${fmtTL(d.oncekiKalan)} TL'si dönem boyunca ödenmemiş. Yapılandırma/taksitse 368'e alınmalı; değilse gecikme zammı işliyor.`,
      ...capa(h),
      detail: { tutar: d.oncekiKalan, devir: d.oncekiDevir, hesapAdi: h.ad },
    });
  }
  for (const m of b.mizanHesaplari.values()) {
    if (!['335', '360', '361'].includes(m.ana) || b.hesaplar.has(m.kod)) continue;
    const borc = -m.kapanis;
    if (borc <= ESIK.VERGI_KISMI_TOLERANS_TL) continue;
    bulgular.push({
      severity: 'WARN',
      category: kod,
      message: `${hesapEtiketi(m)}: Mizanda ${fmtTL(borc)} TL bekleyen borç var, dönemde hiç hareket (ödeme) yok.`,
      hesapKodu: m.kod,
      detail: { tutar: borc, hareketsiz: true, hesapAdi: m.ad },
    });
  }
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [] };
  return { kod, durum: 'BULGU', bulgular };
}

export function kuralPersonelOdemeKasadan(b: DenetimBaglami): KuralSonucu {
  const kod = 'PERSONEL_335_ODEME_KASADAN';
  const hesaplar = hesaplarAna(b, '335');
  if (!hesaplar.length) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Dönemde 335 hareketi yok' };
  let tutar = 0;
  let adet = 0;
  let ilk: Hareket | null = null;
  for (const h of hesaplar) {
    for (const m of h.hareketler) {
      if (m.taraf !== 'BORC' || !m.karsi.has('100')) continue;
      tutar += m.tutar;
      adet += 1;
      if (!ilk) ilk = m;
    }
  }
  if (!ilk || tutar <= 1) return { kod, durum: 'TEMIZ', bulgular: [] };
  return {
    kod,
    durum: 'BULGU',
    bulgular: [{
      severity: 'INFO',
      category: kod,
      message: `Personel ücretleri kasadan ödenmiş: ${adet} kayıt, ${fmtTL(tutar)} TL. 5 ve üzeri çalışanı olan işveren ücreti banka üzerinden ödemek zorundadır (Ücret Yönetmeliği md. 10).`,
      voucherKey: ilk.satir.voucherKey,
      rowIndex: ilk.satir.rowIndex,
      hesapKodu: ilk.satir.hesapKodu,
      detail: { tutar, adet },
    }],
  };
}

// Bordro fisi = 335 alacak (TAHAKKUK) iceren fis. Brut = fisteki 7xx borc, net = 335 alacak, SGK = 361 net alacak.
function bordroFisleri(b: DenetimBaglami) {
  const sonuc: { key: string; brut: number; net: number; sgk: number; ilkRow: number; hesapKodu: string; ay: string | null }[] = [];
  for (const h of hesaplarAna(b, '335')) {
    for (const m of h.hareketler) {
      if (m.taraf !== 'ALACAK' || m.sinif !== 'TAHAKKUK') continue;
      const key = m.satir.voucherKey;
      if (sonuc.some((s) => s.key === key)) continue;
      const rows = b.fisler.get(key) || [];
      let brut = 0;
      let net = 0;
      let sgk = 0;
      for (const r of rows) {
        const ana = String(r.hesapKodu || '').replace(/\D/g, '').slice(0, 3);
        const borc = Number(r.borc || 0);
        const alacak = Number(r.alacak || 0);
        if (/^7/.test(ana)) brut += borc - alacak;
        if (ana === '335') net += alacak - borc;
        if (ana === '361') sgk += alacak - borc;
      }
      sonuc.push({ key, brut, net, sgk, ilkRow: m.satir.rowIndex, hesapKodu: m.satir.hesapKodu || '335', ay: m.ay });
    }
  }
  return sonuc;
}

export function kuralBordroNetBrutOrani(b: DenetimBaglami): KuralSonucu {
  const kod = 'BORDRO_NET_BRUT_ORANI_ANORMAL';
  const fisler = bordroFisleri(b);
  if (!fisler.length) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Bordro fişi (335 tahakkuku) yok' };
  const bulgular: Bulgu[] = [];
  for (const f of fisler) {
    if (f.brut <= 1 || f.net <= 1) continue;
    const oran = f.net / f.brut;
    if (oran >= ESIK.BORDRO_NET_BRUT_MIN && oran <= ESIK.BORDRO_NET_BRUT_MAX) continue;
    bulgular.push({
      severity: 'WARN',
      category: kod,
      message: `${f.ay ? ayAdi(f.ay) + ' ' : ''}bordro fişi: net ücret ${fmtTL(f.net)} TL, brüt ücret gideri ${fmtTL(f.brut)} TL (net/brüt %${(oran * 100).toFixed(0)}; beklenen %${ESIK.BORDRO_NET_BRUT_MIN * 100}-${ESIK.BORDRO_NET_BRUT_MAX * 100}). Bordro bacakları eksik/fazla olabilir.`,
      voucherKey: f.key,
      rowIndex: f.ilkRow,
      hesapKodu: f.hesapKodu,
      detail: { tutar: f.brut, net: f.net, brut: f.brut, oran },
    });
  }
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [], not: `${fisler.length} bordro fişi makul` };
  return { kod, durum: 'BULGU', bulgular: bulgular.slice(0, 6) };
}

export function kuralBordroSgkOrani(b: DenetimBaglami): KuralSonucu {
  const kod = 'BORDRO_SGK_ORANI_ANORMAL';
  const fisler = bordroFisleri(b);
  if (!fisler.length) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Bordro fişi yok' };
  const bulgular: Bulgu[] = [];
  for (const f of fisler) {
    if (f.brut <= 1) continue;
    const oran = f.sgk / f.brut;
    if (oran >= ESIK.BORDRO_SGK_BRUT_MIN && oran <= ESIK.BORDRO_SGK_BRUT_MAX) continue;
    bulgular.push({
      severity: 'INFO',
      category: kod,
      message: `${f.ay ? ayAdi(f.ay) + ' ' : ''}bordro fişi: SGK kesintisi ${fmtTL(f.sgk)} TL, brüt ücret gideri ${fmtTL(f.brut)} TL (SGK/brüt %${(oran * 100).toFixed(0)}; beklenen %${ESIK.BORDRO_SGK_BRUT_MIN * 100}-${ESIK.BORDRO_SGK_BRUT_MAX * 100}). Teşvik, emekli çalışan (SGDP) ya da eksik bacak olabilir.`,
      voucherKey: f.key,
      rowIndex: f.ilkRow,
      hesapKodu: f.hesapKodu,
      detail: { tutar: f.sgk, brut: f.brut, oran },
    });
  }
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [] };
  return { kod, durum: 'BULGU', bulgular: bulgular.slice(0, 6) };
}

// Gecici vergi donemi sonunda (ceyrek) kar varsa 370/371/691 karsilik kaydi var mi (bilgi; kayit istege bagli)
export function kuralGeciciVergiKarsilik(b: DenetimBaglami): KuralSonucu {
  const kod = 'GECICI_VERGI_KARSILIK_KAYDI_YOK';
  const donemTipi = String(b.girdi.donemTipi || '').toUpperCase();
  if (!/^GECICI_Q[1-4]$/.test(donemTipi)) return { kod, durum: 'UYGULANMAZ', bulgular: [], not: 'Yalnız geçici vergi döneminde' };
  if (!b.ozet.mizanVar) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Mizan yok (kâr hesaplanamadı)' };
  // Kar = 6xx net alacak + 7xx net alacak (yansitilmamis 7xx borc bakiye kari dusurur)
  let kar = 0;
  let gelirVar = false;
  for (const m of b.mizanHesaplari.values()) {
    if (m.ana.startsWith('6') || m.ana.startsWith('7')) { kar += -m.kapanis; gelirVar = gelirVar || m.ana.startsWith('6'); }
  }
  if (!gelirVar) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Mizanda gelir tablosu hesabı yok' };
  if (kar <= 0) return { kod, durum: 'TEMIZ', bulgular: [], not: `Dönem zararı ${fmtTL(-kar)} TL, karşılık beklenmez` };
  const sonAy = b.ozet.aylar[b.ozet.aylar.length - 1];
  const karsilikVar = [...b.hesaplar.values()].some((h) => ['370', '371', '691'].includes(h.ana) && h.hareketler.some((m) => m.ay === sonAy));
  if (karsilikVar) return { kod, durum: 'TEMIZ', bulgular: [], not: 'Karşılık kaydı var' };
  return {
    kod,
    durum: 'BULGU',
    bulgular: [{
      severity: 'INFO',
      category: kod,
      message: `Mizana göre dönem kârı ${fmtTL(kar)} TL görünüyor ama ${ayAdi(sonAy)} sonunda geçici vergi karşılığı (691/370) kaydı yok. Kayıt isteğe bağlıdır; beyanname tutarını kaydetmek dönem net kârını doğru gösterir.`,
      hesapKodu: '370',
      detail: { tutar: kar, sonAy },
    }],
  };
}

export const VERGI_SGK_KURALLARI = [
  kuralVergi360OdemeYok,
  kuralSgk361OdemeYok,
  kuralPersonel335OdemeYok,
  kuralVergiSgkTutarUyumsuz,
  kuralVergiSgkTersBakiye,
  kuralVergiSgkDevredenBorc,
  kuralPersonelOdemeKasadan,
  kuralBordroNetBrutOrani,
  kuralBordroSgkOrani,
  kuralGeciciVergiKarsilik,
];
