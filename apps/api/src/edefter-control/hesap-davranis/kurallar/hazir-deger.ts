// HESAP DAVRANIS DENETIMI — Hazir degerler: 100 Kasa / 102 Banka / 108 POS + dovizli hesap ve vadeli mevduat.
//   Gercek musavir bakisi: "banka ekstresi hic islenmis mi, kasa hic calismis mi, banka tek yonlu mu
//   (ekstre yarim mi), POS tahsilati bankaya gecmis mi, aktif bankada masraf/komisyon var mi, dovizli
//   hesap donem sonunda degerlenmis mi, vadeli hesabin faizi islenmis mi". Saf fonksiyonlar.
import { ESIK } from '../esikler';
import {
  ayAdi,
  capa,
  fmtTL,
  hesapEtiketi,
  hesaplarAna,
  hesaplarPrefix,
  normalizeMetin,
  satirMetni,
  ustSinirla,
} from '../istatistik';
import type { Bulgu, DenetimBaglami, HesapIstatistik, KuralSonucu, MizanHesabi } from '../tipler';

// ---------------------------------------------------------------- ortak yardimcilar
function mizanHesaplariAna(b: DenetimBaglami, ana: string): MizanHesabi[] {
  return [...b.mizanHesaplari.values()].filter((m) => m.ana === ana);
}

function cokAyliDegil(b: DenetimBaglami, kod: string): KuralSonucu | null {
  if (b.ozet.aySayisi >= 2) return null;
  return { kod, durum: 'UYGULANMAZ', bulgular: [], not: 'Tek aylık dönemde banka/POS davranışı değerlendirilemez (en az 2 ay gerekir)' };
}

function hareketAdedi(h: HesapIstatistik): number {
  return h.borcAdet + h.alacakAdet;
}

// Hesabin bilinen bakiyesi: Mizan kapanisi > hesaplanan kapanis > donem neti
function bilinenBakiye(h: HesapIstatistik): number {
  return h.mizanKapanis ?? h.kapanis ?? h.net;
}

function mizanNotu(h: HesapIstatistik): string {
  return h.mizanKapanis != null ? ` Mizan bakiyesi ${fmtTL(h.mizanKapanis)} TL.` : '';
}

// ---------------------------------------------------------------- 1) BANKA_HAREKETI_YOK
// Donemde hic 102 hareketi yok; ama Mizan'da banka hesabi var ya da duzenli satis var → ekstre islenmemis.
export function kuralBankaHareketiYok(b: DenetimBaglami): KuralSonucu {
  const kod = 'BANKA_HAREKETI_YOK';
  if (b.ozet.bankaHareketVar) {
    return { kod, durum: 'TEMIZ', bulgular: [], not: `${hesaplarAna(b, '102').length} banka hesabı dönemde hareketli` };
  }
  const mizan102 = mizanHesaplariAna(b, '102');
  const satis = b.ozet.satisFisSayisi;
  if (!mizan102.length && satis < 3) {
    const satisNotu = satis > 0 ? `dönemde yalnız ${satis} satış fişi var` : 'dönemde satış fişi yok';
    return { kod, durum: 'VERI_YOK', bulgular: [], not: `Mizanda banka hesabı yok, ${satisNotu}; banka beklentisi kurulamadı` };
  }
  const mizanBakiye = mizan102.reduce((s, m) => s + m.kapanis, 0);
  const mizanYazi = mizan102.length
    ? `Mizanda ${mizan102.length} banka hesabı var (toplam bakiye ${fmtTL(mizanBakiye)} TL)`
    : `${b.ozet.mizanVar ? 'Mizanda banka hesabı görünmüyor' : 'Mizan yok'}`;
  const satisYazi = satis > 0 ? `dönemde ${satis} satış fişi işlenmiş` : 'dönemde satış fişi de yok';
  return {
    kod,
    durum: 'BULGU',
    bulgular: [{
      severity: 'WARN',
      category: kod,
      message: `Dönemde hiç banka (102) hareketi işlenmemiş. ${mizanYazi}; ${satisYazi}. Banka ekstreleri işlenmemiş görünüyor; tahsilat, ödeme, masraf ve faiz kayıtları eksik demektir.`,
      hesapKodu: '102',
      voucherKey: null,
      rowIndex: null,
      detail: {
        tutar: mizanBakiye,
        mizanHesapSayisi: mizan102.length,
        mizanBakiye,
        mizanHesaplar: mizan102.slice(0, 5).map((m) => m.kod),
        satisFisSayisi: satis,
      },
    }],
  };
}

// ---------------------------------------------------------------- 2) BANKA_TEK_YONLU
// 102 alt hesabi yalniz giris ya da yalniz cikis gormus (≥3 hareket). Vadeli/bloke/mevduat/fon hesaplari
//   dogasi geregi tek yonlu olabilir → atlanir.
const TEK_YONLU_ATLA = /vadeli|bloke|mevduat|\bfon/;

export function kuralBankaTekYonlu(b: DenetimBaglami): KuralSonucu {
  const kod = 'BANKA_TEK_YONLU';
  const kisit = cokAyliDegil(b, kod);
  if (kisit) return kisit;
  const hesaplar = hesaplarAna(b, '102');
  if (!hesaplar.length) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Dönemde 102 hareketi yok' };
  const bulgular: Bulgu[] = [];
  let atlanan = 0;
  let incelenen = 0;
  for (const h of hesaplar) {
    if (TEK_YONLU_ATLA.test(normalizeMetin(h.ad))) { atlanan += 1; continue; }
    incelenen += 1;
    const adet = hareketAdedi(h);
    if (adet < 3) continue;
    if (h.borcAdet > 0 && h.alacakAdet > 0) continue;
    const yalnizGiris = h.alacakAdet === 0; // 102 borc = bankaya giren para
    const tutar = yalnizGiris ? h.borc : h.alacak;
    const yon = yalnizGiris ? 'giriş (borç)' : 'çıkış (alacak)';
    const eksik = yalnizGiris ? 'hiç çıkış (ödeme, masraf, virman)' : 'hiç giriş (tahsilat, yatan para)';
    bulgular.push({
      severity: 'INFO',
      category: kod,
      message: `${hesapEtiketi(h)}: dönemdeki ${adet} hareketin tümü ${yon} yönlü, ${fmtTL(tutar)} TL; ${eksik} kaydı yok. Ekstre kısmen işlenmiş olabilir, baştan sona işleyin; vadeli/bloke hesapsa bilgi olarak geçin.${mizanNotu(h)}`,
      ...capa(h),
      detail: {
        tutar,
        yon: yalnizGiris ? 'BORC' : 'ALACAK',
        hareketAdet: adet,
        borcAdet: h.borcAdet,
        alacakAdet: h.alacakAdet,
        mizanKapanis: h.mizanKapanis,
        hesapAdi: h.ad,
      },
    });
  }
  if (!bulgular.length) {
    const atlananNotu = atlanan ? ` (${atlanan} vadeli/bloke hesap atlandı)` : '';
    return { kod, durum: 'TEMIZ', bulgular: [], not: `${incelenen} banka hesabı incelendi${atlananNotu}` };
  }
  return {
    kod,
    durum: 'BULGU',
    bulgular: ustSinirla(bulgular, ESIK.UST_SINIR_DUSUK, (kalan, toplam) => `Toplam ${toplam} banka hesabı tek yönlü çalışmış; en büyük ${toplam - kalan} tanesi listelendi, ${kalan} tanesi daha var.`, kod),
    not: `${incelenen} banka hesabının ${bulgular.length} tanesi tek yönlü`,
  };
}

// ---------------------------------------------------------------- 3) KASA_HAREKETI_YOK
// Satis var ama donemde hic 100 hareketi yok (tamamen bankayla calisan isletmede normal → INFO).
export function kuralKasaHareketiYok(b: DenetimBaglami): KuralSonucu {
  const kod = 'KASA_HAREKETI_YOK';
  if (b.ozet.kasaHareketVar) {
    return { kod, durum: 'TEMIZ', bulgular: [], not: `${hesaplarAna(b, '100').length} kasa hesabı dönemde hareketli` };
  }
  const satis = b.ozet.satisFisSayisi;
  if (satis < 3) {
    const not = satis > 0 ? `Dönemde yalnız ${satis} satış fişi var; kasa beklentisi kurulamadı` : 'Dönemde satış fişi yok; kasa beklentisi kurulamadı';
    return { kod, durum: 'VERI_YOK', bulgular: [], not };
  }
  const mizan100 = mizanHesaplariAna(b, '100');
  const mizanBakiye = mizan100.reduce((s, m) => s + m.kapanis, 0);
  const mizanYazi = mizan100.length ? ` Mizanda kasa bakiyesi ${fmtTL(mizanBakiye)} TL.` : '';
  const bankaYazi = b.ozet.bankaHareketVar ? '' : ' Banka hareketi de yok; tahsilatlar hiç işlenmemiş olabilir.';
  return {
    kod,
    durum: 'BULGU',
    bulgular: [{
      severity: 'INFO',
      category: kod,
      message: `Dönemde ${satis} satış fişi işlenmiş ama hiç kasa (100) hareketi yok.${mizanYazi}${bankaYazi} Tamamen bankayla çalışan işletmede normaldir; nakit tahsilat/ödeme varsa kasa kayıtlarını işleyin.`,
      hesapKodu: '100',
      voucherKey: null,
      rowIndex: null,
      detail: {
        tutar: mizanBakiye,
        satisFisSayisi: satis,
        mizanKasaBakiye: mizan100.length ? mizanBakiye : null,
        bankaHareketVar: b.ozet.bankaHareketVar,
      },
    }],
  };
}

// ---------------------------------------------------------------- 4) KASA_BAKIYE_YUKSEK
// Mizan'daki 100 yaprak hesaplarinin kapanis toplami esigi asiyor (fiili sayim / adat faizi / ortulu kazanc).
export function kuralKasaBakiyeYuksek(b: DenetimBaglami): KuralSonucu {
  const kod = 'KASA_BAKIYE_YUKSEK';
  if (!b.ozet.mizanVar) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Mizan yok' };
  const mizan100 = mizanHesaplariAna(b, '100');
  if (!mizan100.length) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Mizanda 100 hesabı yok' };
  const toplam = mizan100.reduce((s, m) => s + m.kapanis, 0);
  if (toplam < ESIK.KASA_YUKSEK_BAKIYE) {
    return { kod, durum: 'TEMIZ', bulgular: [], not: `Kasa bakiyesi ${fmtTL(toplam)} TL, eşik (${fmtTL(ESIK.KASA_YUKSEK_BAKIYE)} TL) altı` };
  }
  const enBuyuk = [...mizan100].sort((x, y) => y.kapanis - x.kapanis)[0];
  const hareketli = b.hesaplar.get(enBuyuk.kod);
  const hesapYazi = mizan100.length > 1
    ? ` (${mizan100.length} kasa hesabı; en büyüğü ${hesapEtiketi(enBuyuk)} ${fmtTL(enBuyuk.kapanis)} TL)`
    : ` (${hesapEtiketi(enBuyuk)})`;
  return {
    kod,
    durum: 'BULGU',
    bulgular: [{
      severity: 'INFO',
      category: kod,
      message: `Kasa (100) Mizan bakiyesi ${fmtTL(toplam)} TL${hesapYazi}; işletme ölçeğine göre yüksek. Fiilen kasada olmayan para ortaklara kullandırılmış sayılabilir: fiili kasa sayımı yapın, fark ortak carisine alınmalı ve adat faizi hesaplanmalı (örtülü kazanç riski).`,
      hesapKodu: enBuyuk.kod,
      voucherKey: hareketli?.ilkSatir.voucherKey ?? null,
      rowIndex: hareketli?.ilkSatir.rowIndex ?? null,
      detail: {
        tutar: toplam,
        hesapSayisi: mizan100.length,
        enBuyukKod: enBuyuk.kod,
        enBuyukBakiye: enBuyuk.kapanis,
        esik: ESIK.KASA_YUKSEK_BAKIYE,
        hesapAdi: enBuyuk.ad,
      },
    }],
  };
}

// ---------------------------------------------------------------- 5) POS_108_TEK_YONLU
// 108 yalniz borc calismis (≥3 tahsilat, hic alacak yok) → POS tahsilatlari bankaya gecince kapatilmamis.
export function kuralPos108TekYonlu(b: DenetimBaglami): KuralSonucu {
  const kod = 'POS_108_TEK_YONLU';
  const kisit = cokAyliDegil(b, kod);
  if (kisit) return kisit;
  const hesaplar = hesaplarAna(b, '108');
  if (!hesaplar.length) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Dönemde 108 (POS) hareketi yok' };
  const bulgular: Bulgu[] = [];
  for (const h of hesaplar) {
    if (h.borcAdet < 3 || h.alacakAdet !== 0) continue;
    bulgular.push({
      severity: 'INFO',
      category: kod,
      message: `${hesapEtiketi(h)}: dönemde ${h.borcAdet} POS tahsilatı (${fmtTL(h.borc)} TL) borç işlenmiş ama hesap hiç alacak çalışmamış; kredi kartı tahsilatları bankaya geçtiğinde kapatılmamış görünüyor. Banka ekstresindeki POS aktarımlarını 108 → 102 olarak işleyin.${mizanNotu(h)}`,
      ...capa(h),
      detail: { tutar: h.borc, borcAdet: h.borcAdet, mizanKapanis: h.mizanKapanis, hesapAdi: h.ad },
    });
  }
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [], not: `${hesaplar.length} POS hesabı incelendi, hepsi iki yönlü` };
  return {
    kod,
    durum: 'BULGU',
    bulgular: ustSinirla(bulgular, ESIK.UST_SINIR_DUSUK, (kalan, toplam) => `Toplam ${toplam} POS hesabı yalnız borç çalışmış; ${kalan} tanesi daha var.`, kod),
  };
}

// ---------------------------------------------------------------- 6) BANKA_MASRAF_KAYDI_YOK
// Aktif banka hesabi (≥ESIK.BANKA_AKTIF_MIN_HAREKET hareket) var ama donemde 7xx/65x/66x borc + karsi 102 olan
//   ve metninde masraf/komisyon/bsmv... gecen tek bir kayit yok.
const MASRAF_METNI = /banka masraf|masraf|komisyon|bsmv|havale|eft ucret|hesap isletim|ekstre/;

export function kuralBankaMasrafKaydiYok(b: DenetimBaglami): KuralSonucu {
  const kod = 'BANKA_MASRAF_KAYDI_YOK';
  const kisit = cokAyliDegil(b, kod);
  if (kisit) return kisit;
  const bankalar = hesaplarAna(b, '102');
  if (!bankalar.length) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Dönemde 102 hareketi yok' };
  const aktif = bankalar.filter((h) => hareketAdedi(h) >= ESIK.BANKA_AKTIF_MIN_HAREKET).sort((x, y) => hareketAdedi(y) - hareketAdedi(x));
  if (!aktif.length) {
    const enCok = Math.max(...bankalar.map(hareketAdedi));
    return { kod, durum: 'VERI_YOK', bulgular: [], not: `Aktif banka hesabı yok (en çok ${enCok} hareket; eşik ${ESIK.BANKA_AKTIF_MIN_HAREKET})` };
  }
  // Masraf kaydi: gider hesabi BORC, ayni fiste karsi tarafta 102, metinde masraf/komisyon... (gider satiri ya da
  //   ayni fisteki 102 satiri — Luca'da aciklama cogu zaman fisin tek satirinda yazar)
  let masrafAdet = 0;
  let masrafTutar = 0;
  for (const h of hesaplarPrefix(b, /^(7|65|66)/)) {
    for (const m of h.hareketler) {
      if (m.taraf !== 'BORC' || !m.karsi.has('102')) continue;
      let eslesti = MASRAF_METNI.test(satirMetni(m.satir));
      if (!eslesti) {
        const fis = b.fisler.get(m.satir.voucherKey) || [];
        eslesti = fis.some((r) => Number(r.alacak || 0) > 0 && String(r.hesapKodu || '').replace(/\D/g, '').startsWith('102') && MASRAF_METNI.test(satirMetni(r)));
      }
      if (!eslesti) continue;
      masrafAdet += 1;
      masrafTutar += m.tutar;
    }
  }
  if (masrafAdet > 0) {
    return { kod, durum: 'TEMIZ', bulgular: [], not: `${masrafAdet} banka masraf/komisyon kaydı var (${fmtTL(masrafTutar)} TL)` };
  }
  const enAktif = aktif[0];
  const toplamHareket = aktif.reduce((s, h) => s + hareketAdedi(h), 0);
  const digerYazi = aktif.length > 1 ? ` (${aktif.length} aktif banka hesabında toplam ${toplamHareket} hareket)` : '';
  return {
    kod,
    durum: 'BULGU',
    bulgular: [{
      severity: 'INFO',
      category: kod,
      message: `${hesapEtiketi(enAktif)}: dönemde ${hareketAdedi(enAktif)} banka hareketi işlenmiş${digerYazi} ama hiç banka masrafı, komisyon ya da BSMV gider kaydı yok. Ekstredeki masraf, komisyon ve BSMV satırlarını gider (7xx) olarak işleyin.`,
      ...capa(enAktif),
      detail: {
        tutar: 0,
        hareketAdet: hareketAdedi(enAktif),
        aktifHesapSayisi: aktif.length,
        aktifHesaplar: aktif.slice(0, 5).map((h) => h.kod),
        toplamHareket,
        hesapAdi: enAktif.ad,
      },
    }],
  };
}

// ---------------------------------------------------------------- 7) DOVIZ_HESAP_KUR_DEGERLEME_YOK
// Adinda doviz gecen 102/120/320/300/400/131/331 hesabi var ama donemin SON AYINDA 646/656 hareketi yok.
//   Kisa para birimi kodlari (usd/eur/gbp/chf) kelime sinirli: "EURASIA LOJISTIK" gibi cari adlari yakalanmasin.
const DOVIZ_ADI = /\b(usd|eur|euro|gbp|chf)\b|dolar|doviz|yabanci para/;
const DOVIZ_ANA = new Set(['102', '120', '320', '300', '400', '131', '331']);

type DovizliHesap = { kod: string; ad: string; tutar: number; h: HesapIstatistik | null };

function dovizliHesaplar(b: DenetimBaglami): DovizliHesap[] {
  const liste: DovizliHesap[] = [];
  for (const h of b.hesaplar.values()) {
    if (!DOVIZ_ANA.has(h.ana) || !DOVIZ_ADI.test(normalizeMetin(h.ad))) continue;
    liste.push({ kod: h.kod, ad: h.ad, tutar: Math.abs(bilinenBakiye(h)), h });
  }
  for (const m of b.mizanHesaplari.values()) {
    if (!DOVIZ_ANA.has(m.ana) || b.hesaplar.has(m.kod)) continue;
    if (Math.abs(m.kapanis) <= 0.005 || !DOVIZ_ADI.test(normalizeMetin(m.ad))) continue;
    liste.push({ kod: m.kod, ad: m.ad, tutar: Math.abs(m.kapanis), h: null });
  }
  // Once 102 (banka) sonra digerleri, kendi icinde tutara gore
  return liste.sort((x, y) => {
    const xb = x.kod.startsWith('102') ? 0 : 1;
    const yb = y.kod.startsWith('102') ? 0 : 1;
    if (xb !== yb) return xb - yb;
    return y.tutar - x.tutar;
  });
}

export function kuralDovizKurDegerlemeYok(b: DenetimBaglami): KuralSonucu {
  const kod = 'DOVIZ_HESAP_KUR_DEGERLEME_YOK';
  const donemTipi = String(b.girdi.donemTipi || '').toUpperCase();
  // Servis bilinmeyen donem tipini AYLIK sayar; burada da tek aylik aralik AYLIK kabul edilir.
  if (donemTipi === 'AYLIK' || (!donemTipi && b.ozet.aySayisi <= 1)) {
    return { kod, durum: 'UYGULANMAZ', bulgular: [], not: 'Aylık dönemde kur değerlemesi beklenmez (geçici vergi / yıllık dönemde bakılır)' };
  }
  const sonAy = b.ozet.aylar[b.ozet.aylar.length - 1];
  if (!sonAy) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Dönem aralığı bilinmiyor' };
  const dovizli = dovizliHesaplar(b);
  if (!dovizli.length) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Adında döviz geçen hesap yok' };
  const kurHesaplari = [...hesaplarAna(b, '646'), ...hesaplarAna(b, '656')];
  const sonAyVar = kurHesaplari.some((h) => h.hareketler.some((m) => m.ay === sonAy));
  if (sonAyVar) return { kod, durum: 'TEMIZ', bulgular: [], not: `${dovizli.length} dövizli hesap; ${ayAdi(sonAy)} içinde kur farkı (646/656) kaydı var` };
  const digerAyVar = kurHesaplari.some((h) => h.hareketler.some((m) => m.ay != null && m.ay !== sonAy));
  const tarihsizVar = kurHesaplari.some((h) => h.hareketler.some((m) => m.ay == null));
  const liste = dovizli.slice(0, 5).map((x) => hesapEtiketi(x)).join(', ');
  const fazla = dovizli.length > 5 ? ` ve ${dovizli.length - 5} hesap daha` : '';
  const digerAyNotu = digerAyVar ? ' Önceki aylarda kur farkı kaydı var ama dönem sonu için yok.' : '';
  const tarihsizNotu = tarihsizVar ? ' 646/656 hesabında tarihsiz kayıt var; hangi aya ait olduğu doğrulanamadı.' : '';
  const ilk = dovizli[0];
  const toplam = dovizli.reduce((s, x) => s + x.tutar, 0);
  return {
    kod,
    durum: 'BULGU',
    bulgular: [{
      severity: 'WARN',
      category: kod,
      message: `Dövizli hesap var (${liste}${fazla}) ama ${ayAdi(sonAy)} sonunda kur farkı (646/656) kaydı yok.${digerAyNotu}${tarihsizNotu} Dönem sonu TCMB alış kuruyla değerleme yapın, farkı 646/656 hesaplarına işleyin; geçici vergi dönemlerinde de zorunludur.`,
      hesapKodu: ilk.kod,
      voucherKey: ilk.h?.ilkSatir.voucherKey ?? null,
      rowIndex: ilk.h?.ilkSatir.rowIndex ?? null,
      detail: {
        tutar: toplam,
        hesaplar: dovizli.slice(0, 5).map((x) => x.kod),
        hesapSayisi: dovizli.length,
        sonAy,
        digerAydaKurFarki: digerAyVar,
        tarihsizKurFarki: tarihsizVar,
        hesapAdi: ilk.ad,
      },
    }],
  };
}

// ---------------------------------------------------------------- 8) VADELI_MEVDUAT_FAIZ_YOK
// Adinda "vadeli" gecen 102 hesabi var (hareketli ya da Mizan'da bakiyeli) ama donemde 642 alacak hareketi yok.
// bakiye: bilinen kapanis (Mizan/acilis fisi), bilinmiyorsa null · tutar: siralama/detay icin (bakiye yoksa donem neti)
type VadeliHesap = { kod: string; ad: string; bakiye: number | null; tutar: number; h: HesapIstatistik | null };

function vadeliHesaplar(b: DenetimBaglami): VadeliHesap[] {
  const liste: VadeliHesap[] = [];
  for (const h of hesaplarAna(b, '102')) {
    if (!/vadeli/.test(normalizeMetin(h.ad))) continue;
    const bakiye = h.mizanKapanis ?? h.kapanis;
    liste.push({ kod: h.kod, ad: h.ad, bakiye, tutar: Math.abs(bakiye ?? h.net), h });
  }
  for (const m of mizanHesaplariAna(b, '102')) {
    if (b.hesaplar.has(m.kod) || m.kapanis <= 0.005 || !/vadeli/.test(normalizeMetin(m.ad))) continue;
    liste.push({ kod: m.kod, ad: m.ad, bakiye: m.kapanis, tutar: m.kapanis, h: null });
  }
  return liste.sort((x, y) => y.tutar - x.tutar);
}

export function kuralVadeliMevduatFaizYok(b: DenetimBaglami): KuralSonucu {
  const kod = 'VADELI_MEVDUAT_FAIZ_YOK';
  const vadeli = vadeliHesaplar(b);
  if (!vadeli.length) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Adında vadeli geçen banka hesabı yok' };
  const faizVar = hesaplarAna(b, '642').some((h) => h.alacakAdet > 0);
  if (faizVar) return { kod, durum: 'TEMIZ', bulgular: [], not: `${vadeli.length} vadeli hesap; dönemde 642 faiz geliri kaydı var` };
  const ilk = vadeli[0];
  const bakiyeYazi = ilk.bakiye != null ? ` (bakiye ${fmtTL(ilk.bakiye)} TL)` : '';
  const digerYazi = vadeli.length > 1 ? ` ve ${vadeli.length - 1} vadeli hesap daha` : '';
  const toplam = vadeli.reduce((s, x) => s + x.tutar, 0);
  return {
    kod,
    durum: 'BULGU',
    bulgular: [{
      severity: 'INFO',
      category: kod,
      message: `${hesapEtiketi(ilk)}${bakiyeYazi}${digerYazi}: vadeli mevduat var ama dönemde faiz geliri (642) kaydı yok. Dönem sonu faiz tahakkukunu ve kesilen stopajı (193) işleyin.`,
      hesapKodu: ilk.kod,
      voucherKey: ilk.h?.ilkSatir.voucherKey ?? null,
      rowIndex: ilk.h?.ilkSatir.rowIndex ?? null,
      detail: {
        tutar: toplam,
        hesaplar: vadeli.slice(0, 5).map((x) => x.kod),
        hesapSayisi: vadeli.length,
        bakiye: ilk.bakiye,
        hesapAdi: ilk.ad,
      },
    }],
  };
}

export const HAZIR_DEGER_KURALLARI = [
  kuralBankaHareketiYok,
  kuralBankaTekYonlu,
  kuralKasaHareketiYok,
  kuralKasaBakiyeYuksek,
  kuralPos108TekYonlu,
  kuralBankaMasrafKaydiYok,
  kuralDovizKurDegerlemeYok,
  kuralVadeliMevduatFaizYok,
];
