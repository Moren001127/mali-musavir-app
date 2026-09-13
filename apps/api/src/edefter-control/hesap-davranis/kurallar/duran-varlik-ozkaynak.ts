// HESAP DAVRANIS DENETIMI — Duran varlik (25x), kredi (300/400) ve ozkaynak (500/570) hesaplari.
//   Gercek musavir bakisi: sabit kiymet satisinda fis eksiksiz mi (amortisman/KDV/kar-zarar), tasit
//   alisinda KDV indirimi dogru mu, yapilmakta olan yatirim ve gecmis yil kari bekliyor mu, uzun vadeli
//   kredinin cari kismi ayrilmis mi, sermaye hareketi var mi, ortak carisine adat faizi hesaplanmis mi,
//   personel varken kidem karsiligi ayrilmis mi.
import type { ParsedEDefterFisLine } from '../../edefter-fis-listesi-parser.service';
import { ESIK } from '../esikler';
import {
  anaKod,
  ayAdi,
  capa,
  fmtTL,
  fmtTarih,
  gecerliTarih,
  hesapEtiketi,
  hesaplarAna,
  isClosingLikeText,
  isOpeningLikeText,
  normalizeMetin,
  satirMetni,
  ustSinirla,
} from '../istatistik';
import type { Bulgu, DenetimBaglami, Hareket, KuralSonucu } from '../tipler';

// ---------------------------------------------------------------- fis yardimcilari (bu dosyaya ozel)
function fisMetni(rows: ParsedEDefterFisLine[]): string {
  return normalizeMetin(rows.map((r) => satirMetni(r)).join(' '));
}
function fisAcilisKapanisMi(rows: ParsedEDefterFisLine[]): boolean {
  return rows.some((r) => {
    const t = satirMetni(r);
    return isOpeningLikeText(t) || isClosingLikeText(t);
  });
}
function fisTarihi(rows: ParsedEDefterFisLine[]): Date | null {
  for (const r of rows) if (gecerliTarih(r.fisTarihi)) return r.fisTarihi;
  return null;
}
function fisEtiketi(rows: ParsedEDefterFisLine[]): string {
  const t = fisTarihi(rows);
  const no = rows.find((r) => r.fisNo)?.fisNo;
  return `${t ? `${fmtTarih(t)} tarihli ` : ''}${no ? `${no} no.lu fiş` : 'fiş'}`;
}
// Fiste ana kodu esleyen (regex) satirlarin borc/alacak toplami
function fisToplam(rows: ParsedEDefterFisLine[], ana: RegExp, taraf: 'BORC' | 'ALACAK'): number {
  let t = 0;
  for (const r of rows) {
    if (!ana.test(anaKod(r.hesapKodu))) continue;
    t += Number((taraf === 'BORC' ? r.borc : r.alacak) || 0);
  }
  return t;
}
function fisSatiri(rows: ParsedEDefterFisLine[], ana: RegExp, taraf: 'BORC' | 'ALACAK'): ParsedEDefterFisLine | undefined {
  return rows.find((r) => ana.test(anaKod(r.hesapKodu)) && Number((taraf === 'BORC' ? r.borc : r.alacak) || 0) > 0);
}
function fisCapasi(r: ParsedEDefterFisLine): Pick<Bulgu, 'voucherKey' | 'rowIndex' | 'hesapKodu'> {
  return { voucherKey: r.voucherKey, rowIndex: r.rowIndex, hesapKodu: r.hesapKodu ?? null };
}

// ---------------------------------------------------------------- 1) Sabit kiymet satisinda eksik bacak
// Satis = 250-256 alacak (257 alacak amortisman kaydidir, 258 alacak aktiflestirme, 259 alacak avans mahsubu;
//   bunlar satis degildir). Ayni fiste 25x borc varsa virman/aktiflestirmedir → satis sayilmaz.
const SABIT_KIYMET_ANA = /^25[0-6]$/;
const SABIT_KIYMET_VIRMAN = /^25[0-689]$/; // ayni fiste bunlardan borc varsa hesaplar arasi aktarim
const KDV_ISTISNA_METNI = /istisna|kdv siz|kdvsiz/;

export function kuralSabitKiymetSatisiEksikBacak(b: DenetimBaglami): KuralSonucu {
  const kod = 'SABIT_KIYMET_SATISI_EKSIK_BACAK';
  const bulgular: Bulgu[] = [];
  let cikisFisi = 0;
  let incelenen = 0;
  for (const rows of b.fisler.values()) {
    const cikisSatiri = fisSatiri(rows, SABIT_KIYMET_ANA, 'ALACAK');
    if (!cikisSatiri) continue;
    cikisFisi += 1;
    const tutar = fisToplam(rows, SABIT_KIYMET_ANA, 'ALACAK');
    if (tutar < ESIK.SABIT_KIYMET_SATIS_MIN) continue;
    if (fisAcilisKapanisMi(rows)) continue;
    if (fisToplam(rows, SABIT_KIYMET_VIRMAN, 'BORC') > 0) continue; // 258→25x aktarimi ya da alt hesaplar arasi virman
    // Fis yalniz duran varlik hesaplari (25x/26x) arasinda kaliyorsa (orn. 257 borc / 254 alacak: amortisman kapatma
    //   ayri fiste yapilmis) satis fisi degildir; satis bacagi olan fis ayrica degerlendirilir.
    if (!rows.some((r) => !/^2[56]\d$/.test(anaKod(r.hesapKodu)) && (Number(r.borc || 0) > 0 || Number(r.alacak || 0) > 0))) continue;
    incelenen += 1;
    const metin = fisMetni(rows);
    const cikisSatirlari = rows.filter((r) => SABIT_KIYMET_ANA.test(anaKod(r.hesapKodu)) && Number(r.alacak || 0) > 0);
    const yalnizArazi = cikisSatirlari.every((r) => anaKod(r.hesapKodu) === '250'); // arazi amortismana tabi degil
    const amortismanVar = fisToplam(rows, /^(257|268)$/, 'BORC') > 0;
    const kdvVar = fisToplam(rows, /^391$/, 'ALACAK') > 0;
    const kdvIstisna = KDV_ISTISNA_METNI.test(metin);
    const karZararVar = rows.some((r) => /^(649|659|679|689)$/.test(anaKod(r.hesapKodu)) && (Number(r.borc || 0) > 0 || Number(r.alacak || 0) > 0));
    const eksik: string[] = [];
    if (!amortismanVar && !yalnizArazi) eksik.push('birikmiş amortisman (257/268) kapatılmamış');
    if (!kdvVar && !kdvIstisna) eksik.push('KDV (391) hesaplanmamış');
    if (!karZararVar) eksik.push('satış kâr/zarar hesabı (649/659/679/689) yok');
    if (!eksik.length) continue;
    const kodlar = [...new Set(cikisSatirlari.map((r) => String(r.hesapKodu)))];
    bulgular.push({
      severity: 'WARN',
      category: kod,
      message: `${fisEtiketi(rows)}: ${hesapEtiketi({ kod: String(cikisSatiri.hesapKodu || ''), ad: String(cikisSatiri.hesapAdi || '') })} hesabından ${fmtTL(tutar)} TL çıkış var ama fişte ${eksik.join(', ')}. Sabit kıymet satış fişi eksik görünüyor; birikmiş amortismanı kapatıp KDV'yi hesaplayın ve farkı kâr/zarar hesabına alın (satış tam net defter değerinden yapıldıysa fark çıkmaz).`,
      ...fisCapasi(cikisSatiri),
      detail: { tutar, eksikBacaklar: eksik, amortismanVar, kdvVar, kdvIstisna, karZararVar, hesapKodlari: kodlar, hesapAdi: cikisSatiri.hesapAdi },
    });
  }
  if (!cikisFisi) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Dönemde sabit kıymet çıkışı (25x alacak) yok' };
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [], not: `${incelenen} sabit kıymet çıkış fişi incelendi` };
  return {
    kod,
    durum: 'BULGU',
    bulgular: ustSinirla(bulgular, ESIK.UST_SINIR_DUSUK, (kalan, toplam) => `${toplam} sabit kıymet çıkış fişinde eksik bacak var; ${kalan} tanesi daha listelenmedi.`, kod),
  };
}

// ---------------------------------------------------------------- 2) Tasit alisinda KDV indirimi
// Yalniz binek oldugu KESIN ifadeler: marka adi tek basina yeterli degil (Mercedes Sprinter, Renault Master ticaridir).
//   Kisa model adlari (polo, golf, suv, i20…) baska kelimelerin icinde gecebilir → kelime siniri.
const BINEK_METNI = /binek|otomobil|sedan|hatchback|passat|corolla|megane|civic|jetta|symbol|yaris|\b(?:suv|clio|egea|polo|golf|focus|astra|i20|i10)\b/;
// "tir" tek basina cok kelimenin icinde gecer (getir, aktarim…) → kelime siniri sart
const TICARI_METNI = /kamyon|kamyonet|\btir\b|cekici|minibus|otobus|forklift|traktor|panelvan|panel van|dorse|hafif ticari|ticari arac|ticari tasit/;

export function kuralBinekOtoKdvIndirim(b: DenetimBaglami): KuralSonucu {
  const kod = 'BINEK_OTO_KDV_INDIRIM';
  const bulgular: Bulgu[] = [];
  let tasitAlisi = 0;
  for (const rows of b.fisler.values()) {
    const tasitSatiri = fisSatiri(rows, /^254$/, 'BORC');
    if (!tasitSatiri) continue;
    tasitAlisi += 1;
    const tasitTutar = fisToplam(rows, /^254$/, 'BORC');
    if (tasitTutar < 1_000) continue;
    if (fisAcilisKapanisMi(rows)) continue; // acilis fisinde 254 ve 191 birlikte borc calisir
    const kdvSatiri = fisSatiri(rows, /^191$/, 'BORC');
    if (!kdvSatiri) continue;
    const kdv = fisToplam(rows, /^191$/, 'BORC');
    const metin = fisMetni(rows);
    if (TICARI_METNI.test(metin)) continue; // kamyon/kamyonet/panelvan: KDV indirilebilir
    const binek = BINEK_METNI.test(metin);
    const etiket = hesapEtiketi({ kod: String(tasitSatiri.hesapKodu || ''), ad: String(tasitSatiri.hesapAdi || '') });
    bulgular.push({
      severity: binek ? 'WARN' : 'INFO',
      category: kod,
      message: binek
        ? `${fisEtiketi(rows)}: ${etiket} hesabına ${fmtTL(tasitTutar)} TL taşıt alınmış, ${fmtTL(kdv)} TL KDV 191'e indirilmiş; açıklamaya göre araç binek otomobil. Binek otomobil KDV'si indirilemez; KDV'yi 191'den çıkarıp maliyete (veya gidere) alın, amortisman/gider kısıtını uygulayın.`
        : `${fisEtiketi(rows)}: ${etiket} hesabına ${fmtTL(tasitTutar)} TL taşıt alınmış, ${fmtTL(kdv)} TL KDV 191'e indirilmiş; araç türü açıklamadan anlaşılmıyor. Araç binekse KDV indirilemez (maliyete/gidere alınır); kamyon, kamyonet gibi ticari araçta indirilebilir. Ruhsattaki araç cinsini kontrol edin.`,
      ...fisCapasi(tasitSatiri),
      detail: { tutar: kdv, tasitTutar, binek, hesapAdi: tasitSatiri.hesapAdi },
    });
  }
  if (!tasitAlisi) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Dönemde taşıt (254) alışı yok' };
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [], not: `${tasitAlisi} taşıt alış fişi incelendi` };
  return {
    kod,
    durum: 'BULGU',
    bulgular: ustSinirla(bulgular, ESIK.UST_SINIR_DUSUK, (kalan, toplam) => `${toplam} taşıt alış fişinde KDV indirimi var; ${kalan} tanesi daha listelenmedi.`, kod),
  };
}

// ---------------------------------------------------------------- 3) 258 Yapilmakta olan yatirim bakiyesi (Mizan)
export function kuralYapilmaktaOlanYatirim(b: DenetimBaglami): KuralSonucu {
  const kod = 'OZELLIKLI_258_YAPILMAKTA_OLAN_YATIRIM';
  if (!b.ozet.mizanVar) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Mizan yok' };
  const hesaplar = [...b.mizanHesaplari.values()].filter((m) => m.ana === '258');
  if (!hesaplar.length) return { kod, durum: 'TEMIZ', bulgular: [], not: 'Mizanda 258 yok' };
  const bakiyeli = hesaplar.filter((m) => m.kapanis > 1);
  const tutar = bakiyeli.reduce((s, m) => s + m.kapanis, 0);
  if (tutar <= 1) return { kod, durum: 'TEMIZ', bulgular: [], not: '258 bakiyesi yok' };
  const ilk = bakiyeli.sort((x, y) => y.kapanis - x.kapanis)[0];
  const hareketli = b.hesaplar.get(ilk.kod);
  const donemHareket = hesaplarAna(b, '258').reduce((s, h) => s + h.borc, 0);
  const liste = bakiyeli.slice(0, 3).map((m) => `${hesapEtiketi(m)} ${fmtTL(m.kapanis)} TL`).join('; ');
  return {
    kod,
    durum: 'BULGU',
    bulgular: [{
      severity: 'INFO',
      category: kod,
      message: `${liste}${bakiyeli.length > 3 ? ` (+${bakiyeli.length - 3} hesap daha)` : ''}: Mizanda yapılmakta olan yatırım bakiyesi toplam ${fmtTL(tutar)} TL${donemHareket > 0 ? `, dönemde ${fmtTL(donemHareket)} TL eklenmiş` : ''}. Tamamlanan kısım ilgili sabit kıymet hesabına (25x) aktarılıp amortismana başlanmalı.`,
      hesapKodu: ilk.kod,
      voucherKey: hareketli?.ilkSatir.voucherKey ?? null,
      rowIndex: hareketli?.ilkSatir.rowIndex ?? null,
      detail: { tutar, hesaplar: bakiyeli.map((m) => ({ kod: m.kod, ad: m.ad, bakiye: m.kapanis })), donemHareket, hesapAdi: ilk.ad },
    }],
  };
}

// ---------------------------------------------------------------- 4) 570 Gecmis yil kari bekliyor (Mizan)
export function kuralGecmisYilKari(b: DenetimBaglami): KuralSonucu {
  const kod = 'OZELLIKLI_570_KAR_DAGITIM_YEDEK';
  if (!b.ozet.mizanVar) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Mizan yok' };
  const hesaplar = [...b.mizanHesaplari.values()].filter((m) => m.ana === '570');
  if (!hesaplar.length) return { kod, durum: 'TEMIZ', bulgular: [], not: 'Mizanda 570 yok' };
  const bakiyeli = hesaplar.filter((m) => -m.kapanis > 1); // alacak bakiye
  const tutar = bakiyeli.reduce((s, m) => s + -m.kapanis, 0);
  if (tutar <= 1) return { kod, durum: 'TEMIZ', bulgular: [], not: '570 alacak bakiyesi yok' };
  const ilk = bakiyeli.sort((x, y) => x.kapanis - y.kapanis)[0];
  const hareketli = b.hesaplar.get(ilk.kod);
  const yedek = hesaplarAna(b, '540').reduce((s, h) => s + h.borc + h.alacak, 0);
  const yedekVar = yedek > 0;
  const dagitim = hesaplarAna(b, '570').reduce((s, h) => s + h.borc, 0);
  return {
    kod,
    durum: 'BULGU',
    bulgular: [{
      severity: 'INFO',
      category: kod,
      message: `${hesapEtiketi(ilk)}: Mizanda geçmiş yıl kârı bakiyesi ${fmtTL(tutar)} TL${dagitim > 0 ? `, dönemde ${fmtTL(dagitim)} TL kullanılmış` : ''}. ${yedekVar ? `Dönemde 540 yasal yedek hareketi var (${fmtTL(yedek)} TL).` : 'Dönemde yasal yedek (540) kaydı görünmüyor.'} Kâr dağıtımı kararı alındıysa yasal yedek ve kâr payı stopajı kayıtlarını, alınmadıysa bekleyen kârı genel kurul kararıyla birlikte kontrol edin.`,
      hesapKodu: ilk.kod,
      voucherKey: hareketli?.ilkSatir.voucherKey ?? null,
      rowIndex: hareketli?.ilkSatir.rowIndex ?? null,
      detail: { tutar, yedekHareketi: yedek, yedekVar, dagitim, hesaplar: bakiyeli.map((m) => ({ kod: m.kod, ad: m.ad, bakiye: -m.kapanis })), hesapAdi: ilk.ad },
    }],
  };
}

// ---------------------------------------------------------------- 5) Uzun vadeli kredinin cari kismi aktarilmamis (YILLIK + Mizan)
export function kuralUzunVadeliKrediAktarim(b: DenetimBaglami): KuralSonucu {
  const kod = 'UZUN_VADELI_KREDI_KISA_VADE_AKTARIM';
  if (!b.ozet.isYillik) return { kod, durum: 'UYGULANMAZ', bulgular: [], not: 'Yalnız yıllık dönemde (yıl sonu sınıflandırması)' };
  if (!b.ozet.mizanVar) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Mizan yok' };
  const hesaplar = [...b.mizanHesaplari.values()].filter((m) => m.ana === '400');
  if (!hesaplar.length) return { kod, durum: 'TEMIZ', bulgular: [], not: 'Mizanda 400 yok' };
  const bakiyeli = hesaplar.filter((m) => -m.kapanis > 1);
  const tutar = bakiyeli.reduce((s, m) => s + -m.kapanis, 0);
  if (tutar <= 1) return { kod, durum: 'TEMIZ', bulgular: [], not: '400 alacak bakiyesi yok' };
  const sonAy = b.ozet.aylar[b.ozet.aylar.length - 1];
  // 400 borc + ayni fiste 300 alacak = kisa vadeye aktarim; hangi aylarda yapilmis?
  const aktarimAylari = new Set<string>();
  for (const h of hesaplarAna(b, '400')) {
    for (const m of h.hareketler) {
      if (m.taraf === 'BORC' && m.ay && m.karsi.has('300')) aktarimAylari.add(m.ay);
    }
  }
  if (sonAy && aktarimAylari.has(sonAy)) return { kod, durum: 'TEMIZ', bulgular: [], not: `${ayAdi(sonAy)} içinde 400→300 aktarımı var` };
  const ilk = bakiyeli.sort((x, y) => x.kapanis - y.kapanis)[0];
  const hareketli = b.hesaplar.get(ilk.kod);
  const oncekiNotu = aktarimAylari.size ? ` Yıl içinde (${[...aktarimAylari].sort().map(ayAdi).join(', ')}) aktarım yapılmış ama yıl sonunda yok.` : '';
  return {
    kod,
    durum: 'BULGU',
    bulgular: [{
      severity: 'INFO',
      category: kod,
      message: `${hesapEtiketi(ilk)}: yıl sonunda uzun vadeli kredi bakiyesi ${fmtTL(tutar)} TL var ama ${sonAy ? ayAdi(sonAy) : 'son ay'} içinde 300 hesabına aktarım (400 borç / 300 alacak) kaydı yok.${oncekiNotu} Gelecek yıl ödenecek anaparayı 300'e virmanlayın; bilançoda kısa/uzun vade ayrımı bozulmasın.`,
      hesapKodu: ilk.kod,
      voucherKey: hareketli?.ilkSatir.voucherKey ?? null,
      rowIndex: hareketli?.ilkSatir.rowIndex ?? null,
      detail: { tutar, aktarimAylari: [...aktarimAylari].sort(), sonAy, hesaplar: bakiyeli.map((m) => ({ kod: m.kod, ad: m.ad, bakiye: -m.kapanis })), hesapAdi: ilk.ad },
    }],
  };
}

// ---------------------------------------------------------------- 6) Sermaye hesabinda hareket
export function kuralSermayeHareketi(b: DenetimBaglami): KuralSonucu {
  const kod = 'SERMAYE_HAREKETI_KONTROL';
  const hesaplar = hesaplarAna(b, '500');
  const hareketler: Hareket[] = [];
  for (const h of hesaplar) {
    for (const m of h.hareketler) {
      if (m.tutar <= 0) continue;
      const rows = b.fisler.get(m.satir.voucherKey) || [m.satir];
      if (fisAcilisKapanisMi(rows)) continue; // acilis/kapanis fisinde 500 her zaman calisir
      hareketler.push(m);
    }
  }
  if (!hareketler.length) return { kod, durum: 'TEMIZ', bulgular: [], not: hesaplar.length ? 'Dönemde 500 hareketi yalnız açılış/kapanış fişinde' : 'Dönemde 500 hareketi yok' };
  const artirim = hareketler.filter((m) => m.taraf === 'ALACAK').reduce((s, m) => s + m.tutar, 0);
  const azaltim = hareketler.filter((m) => m.taraf === 'BORC').reduce((s, m) => s + m.tutar, 0);
  const tutar = artirim + azaltim;
  const ilk = hareketler[0];
  const odenmemisVar = hareketler.some((m) => m.karsi.has('501'));
  const parcalar: string[] = [];
  if (artirim > 0) parcalar.push(`alacak (artırım) ${fmtTL(artirim)} TL`);
  if (azaltim > 0) parcalar.push(`borç (azaltım) ${fmtTL(azaltim)} TL`);
  const h = b.hesaplar.get(ilk.satir.hesapKodu || '') || hesaplar[0];
  return {
    kod,
    durum: 'BULGU',
    bulgular: [{
      severity: 'INFO',
      category: kod,
      message: `${hesapEtiketi(h)}: dönemde ${hareketler.length} sermaye hareketi var; ${parcalar.join(', ')}${odenmemisVar ? ' (501 ödenmemiş sermaye ile birlikte)' : ''}. Ticaret sicil tescilini, 501 ödenmemiş sermaye kaydını ve nakdi artırımsa faiz indirimi hakkını kontrol edin.`,
      ...capa(h),
      detail: { tutar, artirim, azaltim, adet: hareketler.length, odenmemisSermayeVar: odenmemisVar, hesapAdi: h.ad },
    }],
  };
}

// ---------------------------------------------------------------- 7) Ortak carisi icin adat faizi yok (YILLIK)
export function kuralOrtakAdatFaiziYok(b: DenetimBaglami): KuralSonucu {
  const kod = 'ORTAK_ADAT_FAIZI_YOK';
  if (!b.ozet.isYillik) return { kod, durum: 'UYGULANMAZ', bulgular: [], not: 'Yalnız yıllık dönemde (adat yıl sonunda hesaplanır)' };
  const fisHesaplari = hesaplarAna(b, '131');
  const mizanHesaplari = [...b.mizanHesaplari.values()].filter((m) => m.ana === '131');
  if (!fisHesaplari.length && !mizanHesaplari.length) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Dönemde ve Mizanda 131 yok' };
  // Borc bakiye ya da donem icinde borc hareketi (ortaga para kullandirilmis)
  let bakiye = 0;
  let donemBorc = 0;
  let kapanisBilinen = false;
  const kodlar = new Set<string>();
  for (const h of fisHesaplari) {
    if (h.borc > 1) { donemBorc += h.borc; kodlar.add(h.kod); }
    const kapanis = h.kapanis ?? h.mizanKapanis;
    if (kapanis != null) kapanisBilinen = true;
    if (kapanis != null && kapanis > 1) { bakiye += kapanis; kodlar.add(h.kod); }
  }
  for (const m of mizanHesaplari) {
    if (b.hesaplar.has(m.kod)) continue;
    if (m.kapanis > 1) { bakiye += m.kapanis; kodlar.add(m.kod); }
  }
  if (!kodlar.size) return { kod, durum: 'TEMIZ', bulgular: [], not: '131 borç bakiyesi/hareketi yok' };
  // 642 alacak: karsi tarafta 131 varsa ya da metinde "adat" geciyorsa kesin; yalniz "faiz" geciyorsa banka faizi olabilir
  let adatVar = false;
  let faizGeliri = 0;
  for (const h of hesaplarAna(b, '642')) {
    for (const m of h.hareketler) {
      if (m.taraf !== 'ALACAK') continue;
      faizGeliri += m.tutar;
      const metin = normalizeMetin(`${h.ad} ${m.satir.aciklama || ''}`);
      if (m.karsi.has('131') || /adat/.test(metin)) { adatVar = true; break; }
      if (/faiz/.test(metin) && !m.karsi.has('102') && !m.karsi.has('100')) { adatVar = true; break; }
    }
    if (adatVar) break;
  }
  if (adatVar) return { kod, durum: 'TEMIZ', bulgular: [], not: '642 altında adat/faiz kaydı var' };
  const ilkKod = [...kodlar][0];
  const h = b.hesaplar.get(ilkKod);
  const m = b.mizanHesaplari.get(ilkKod);
  const etiket = h ? hesapEtiketi(h) : m ? hesapEtiketi(m) : ilkKod;
  const tutar = Math.max(bakiye, donemBorc);
  const bakiyeNotu = bakiye > 1
    ? `yıl sonu borç bakiyesi ${fmtTL(bakiye)} TL`
    : kapanisBilinen
      ? `yıl sonunda bakiye kapanmış ama yıl içinde ${fmtTL(donemBorc)} TL borç hareketi var (adat gün bazlı hesaplanır)`
      : `açılış bilinmiyor, dönemde ${fmtTL(donemBorc)} TL borç hareketi var`;
  const faizNotu = faizGeliri > 1 ? ` 642'de ${fmtTL(faizGeliri)} TL faiz geliri var ama ortak carisiyle ilişkili adat kaydı görünmüyor.` : ' Dönemde 642 faiz geliri kaydı hiç yok.';
  return {
    kod,
    durum: 'BULGU',
    bulgular: [{
      severity: 'INFO',
      category: kod,
      message: `${etiket}: ortaklardan alacak hesabında ${bakiyeNotu}${kodlar.size > 1 ? ` (${kodlar.size} alt hesap)` : ''}.${faizNotu} Ortağa kullandırılan para için emsal faiz hesaplayıp KDV'li fatura düzenleyin.`,
      hesapKodu: ilkKod,
      voucherKey: h?.ilkSatir.voucherKey ?? null,
      rowIndex: h?.ilkSatir.rowIndex ?? null,
      detail: { tutar, bakiye, donemBorc, faizGeliri, hesaplar: [...kodlar], hesapAdi: h?.ad ?? m?.ad ?? '' },
    }],
  };
}

// ---------------------------------------------------------------- 8) Kidem tazminati karsiligi yok (YILLIK)
export function kuralKidemKarsiligiYok(b: DenetimBaglami): KuralSonucu {
  const kod = 'KIDEM_KARSILIGI_YOK';
  if (!b.ozet.isYillik) return { kod, durum: 'UYGULANMAZ', bulgular: [], not: 'Yalnız yıllık dönemde (karşılık yıl sonunda ayrılır)' };
  if (!b.ozet.bordroVar) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Bordro (335/361) hareketi yok' };
  const karsilikHareketi = [...hesaplarAna(b, '472'), ...hesaplarAna(b, '372')].some((h) => h.borc > 0 || h.alacak > 0);
  if (karsilikHareketi) return { kod, durum: 'TEMIZ', bulgular: [], not: 'Dönemde 472/372 hareketi var' };
  if (b.ozet.mizanVar) {
    const mizanBakiye = [...b.mizanHesaplari.values()].some((m) => (m.ana === '472' || m.ana === '372') && Math.abs(m.kapanis) > 1);
    if (mizanBakiye) return { kod, durum: 'TEMIZ', bulgular: [], not: 'Mizanda 472/372 bakiyesi var' };
  }
  const ucretHesaplari = hesaplarAna(b, '335');
  const netUcret = ucretHesaplari.reduce((s, h) => s + h.alacak, 0);
  const ilk = ucretHesaplari[0] || hesaplarAna(b, '361')[0];
  return {
    kod,
    durum: 'BULGU',
    bulgular: [{
      severity: 'INFO',
      category: kod,
      message: `Personel var (dönemde ${fmtTL(netUcret)} TL net ücret tahakkuku) ama yıl sonunda kıdem tazminatı karşılığı (472/372) kaydı yok${b.ozet.mizanVar ? ' ve Mizanda bakiyesi de görünmüyor' : ''}. Vergisel olarak kabul edilmese de finansal raporlama için karşılık ayrılması gerekir; bağımsız denetim kapsamındaysa ayırın, değilse bilgi olarak geçin.`,
      hesapKodu: ilk?.kod ?? '472',
      voucherKey: ilk?.ilkSatir.voucherKey ?? null,
      rowIndex: ilk?.ilkSatir.rowIndex ?? null,
      detail: { tutar: netUcret, mizanVar: b.ozet.mizanVar, hesapAdi: ilk?.ad ?? '' },
    }],
  };
}

export const DURAN_VARLIK_KURALLARI = [
  kuralSabitKiymetSatisiEksikBacak,
  kuralBinekOtoKdvIndirim,
  kuralYapilmaktaOlanYatirim,
  kuralGecmisYilKari,
  kuralUzunVadeliKrediAktarim,
  kuralSermayeHareketi,
  kuralOrtakAdatFaiziYok,
  kuralKidemKarsiligiYok,
];
