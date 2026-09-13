// HESAP DAVRANIS DENETIMI — Cari hesaplar (120 Alicilar / 320 Saticilar).
//   Gercek musavir bakisi: her cari alt hesap icin "fatura islenmis mi, karsiliginda tahsilat/odeme
//   islenmis mi, bakiye yasiyor mu, ayni taraf iki yerde mi, kart mukerrer mi".
import { ESIK } from '../esikler';
import {
  capa,
  fmtTL,
  hesapEtiketi,
  hesaplarAna,
  normalizeCariAdi,
  sinifToplam,
  ustSinirla,
  yuzde,
} from '../istatistik';
import type { Bulgu, DenetimBaglami, HesapIstatistik, KuralSonucu } from '../tipler';

type CariOzet = {
  h: HesapIstatistik;
  faturaAdet: number;
  faturaTutar: number;
  karsilikAdet: number; // tahsilat (120) / odeme (320) niteligindeki hareketler
  karsilikTutar: number;
  iadeTutar: number;
};

// 120: borc = fatura, alacak = tahsilat/mahsup. 320: alacak = fatura, borc = odeme/mahsup.
function cariOzet(h: HesapIstatistik): CariOzet {
  const alici = h.ana === '120';
  const fatura = sinifToplam(h, alici ? 'BORC' : 'ALACAK', ['FATURA']);
  const karsilik = sinifToplam(h, alici ? 'ALACAK' : 'BORC', ['TAHSILAT', 'ODEME', 'MAHSUP', 'DIGER']);
  const iade = sinifToplam(h, alici ? 'ALACAK' : 'BORC', ['IADE']);
  return { h, faturaAdet: fatura.adet, faturaTutar: fatura.tutar, karsilikAdet: karsilik.adet, karsilikTutar: karsilik.tutar, iadeTutar: iade.tutar };
}

function cariOzetleri(b: DenetimBaglami, ana: '120' | '320'): CariOzet[] {
  return hesaplarAna(b, ana).map(cariOzet);
}

// Defter geneli tek-yonluluk olcusu (DEFTER_TAHSILAT_ODEME_ISLENMEMIS ve ust sinir daraltma icin)
export function defterTekYonluOzeti(b: DenetimBaglami) {
  const hepsi = [...cariOzetleri(b, '120'), ...cariOzetleri(b, '320')].filter((o) => o.faturaAdet > 0);
  const tekYonlu = hepsi.filter((o) => o.karsilikTutar <= 1);
  const oran = hepsi.length ? tekYonlu.length / hepsi.length : 0;
  const yaygin = hepsi.length >= ESIK.DEFTER_TEK_YONLU_MIN_HESAP && oran >= ESIK.DEFTER_TEK_YONLU_ORAN;
  return { hesapSayisi: hepsi.length, tekYonluSayisi: tekYonlu.length, oran, yaygin };
}

function cokAyliDegil(b: DenetimBaglami, kod: string): KuralSonucu | null {
  if (b.ozet.aySayisi >= 2) return null;
  return { kod, durum: 'UYGULANMAZ', bulgular: [], not: 'Tek aylık dönemde tahsilat/ödeme döngüsü değerlendirilemez' };
}

function tekYonluKurali(b: DenetimBaglami, ana: '120' | '320'): KuralSonucu {
  const kod = ana === '120' ? 'CARI_120_TAHSILAT_YOK' : 'CARI_320_ODEME_YOK';
  const kisit = cokAyliDegil(b, kod);
  if (kisit) return kisit;
  const ozetler = cariOzetleri(b, ana);
  if (!ozetler.length) return { kod, durum: 'VERI_YOK', bulgular: [], not: `Dönemde ${ana} hareketi yok` };
  const karsilikAdi = ana === '120' ? 'tahsilat' : 'ödeme';
  const faturaAdi = ana === '120' ? 'satış faturası' : 'alış faturası';
  const bulgular: Bulgu[] = [];
  for (const o of ozetler) {
    if (o.faturaAdet === 0 || o.karsilikTutar > 1) continue;
    if (o.faturaAdet < ESIK.CARI_TEK_YONLU_MIN_FATURA && o.faturaTutar < ESIK.CARI_TEK_YONLU_MIN_TUTAR) continue;
    const h = o.h;
    // Mizan varsa yil basindan beri karsilik var mi? (120: alacakToplam, 320: borcToplam)
    const yilBasiKarsilik = ana === '120' ? h.mizanAlacakToplam : h.mizanBorcToplam;
    let mizanNotu = '';
    if (h.mizanKapanis != null) {
      const bakiye = ana === '120' ? h.mizanKapanis : -h.mizanKapanis;
      if (yilBasiKarsilik != null && yilBasiKarsilik <= 1) {
        mizanNotu = ` Yıl başından beri de hiç ${karsilikAdi} yok; Mizan bakiyesi ${fmtTL(bakiye)} TL.`;
      } else {
        mizanNotu = ` Mizan bakiyesi ${fmtTL(bakiye)} TL.`;
      }
    }
    const iadeNotu = o.iadeTutar > 1 ? ` (${fmtTL(o.iadeTutar)} TL iade/düzeltme var, ${karsilikAdi} sayılmadı)` : '';
    bulgular.push({
      severity: 'WARN',
      category: kod,
      message: `${hesapEtiketi(h)}: dönemde ${o.faturaAdet} ${faturaAdi} (${fmtTL(o.faturaTutar)} TL) işlenmiş, ${karsilikAdi} kaydı yok${iadeNotu}.${mizanNotu}`,
      ...capa(h),
      detail: {
        tutar: o.faturaTutar,
        faturaAdet: o.faturaAdet,
        karsilik: 0,
        iade: o.iadeTutar,
        mizanKapanis: h.mizanKapanis,
        yilBasindanKarsilik: yilBasiKarsilik,
        hesapAdi: h.ad,
      },
    });
  }
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [], not: `${ozetler.length} ${ana} alt hesabı incelendi` };
  const genel = defterTekYonluOzeti(b);
  const sinir = genel.yaygin ? ESIK.UST_SINIR_DUSUK : ESIK.UST_SINIR_STANDART;
  const sonuc = ustSinirla(
    bulgular,
    sinir,
    (kalan, toplam) => `${ana} alt hesaplarının toplam ${toplam} tanesinde ${karsilikAdi} kaydı yok; en büyük ${toplam - kalan} tanesi listelendi, ${kalan} tanesi daha var.`,
    kod,
  );
  return { kod, durum: 'BULGU', bulgular: sonuc, not: `${ozetler.length} alt hesabın ${bulgular.length} tanesi tek yönlü` };
}

export function kuralCari120TahsilatYok(b: DenetimBaglami): KuralSonucu {
  return tekYonluKurali(b, '120');
}
export function kuralCari320OdemeYok(b: DenetimBaglami): KuralSonucu {
  return tekYonluKurali(b, '320');
}

function oranKurali(b: DenetimBaglami, ana: '120' | '320'): KuralSonucu {
  const kod = ana === '120' ? 'CARI_120_TAHSILAT_ORANI_DUSUK' : 'CARI_320_ODEME_ORANI_DUSUK';
  const kisit = cokAyliDegil(b, kod);
  if (kisit) return kisit;
  const ozetler = cariOzetleri(b, ana);
  if (!ozetler.length) return { kod, durum: 'VERI_YOK', bulgular: [], not: `Dönemde ${ana} hareketi yok` };
  const karsilikAdi = ana === '120' ? 'tahsilat' : 'ödeme';
  const bulgular: Bulgu[] = [];
  for (const o of ozetler) {
    if (o.karsilikTutar <= 1) continue; // hic yoksa ayri kural
    if (o.faturaAdet < ESIK.CARI_ORAN_MIN_FATURA || o.faturaTutar < ESIK.CARI_ORAN_MIN_TUTAR) continue;
    const oran = o.karsilikTutar / o.faturaTutar;
    if (oran >= ESIK.CARI_ORAN_DUSUK) continue;
    const h = o.h;
    const bakiyeNotu = h.mizanKapanis != null ? ` Mizan bakiyesi ${fmtTL(ana === '120' ? h.mizanKapanis : -h.mizanKapanis)} TL.` : '';
    bulgular.push({
      severity: 'INFO',
      category: kod,
      message: `${hesapEtiketi(h)}: ${o.faturaAdet} fatura ${fmtTL(o.faturaTutar)} TL, ${karsilikAdi} ${fmtTL(o.karsilikTutar)} TL (%${yuzde(o.karsilikTutar, o.faturaTutar)}).${bakiyeNotu}`,
      ...capa(h),
      detail: { tutar: o.faturaTutar - o.karsilikTutar, faturaAdet: o.faturaAdet, fatura: o.faturaTutar, karsilik: o.karsilikTutar, oran, hesapAdi: h.ad },
    });
  }
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [] };
  return {
    kod,
    durum: 'BULGU',
    bulgular: ustSinirla(bulgular, ESIK.UST_SINIR_DUSUK, (kalan, toplam) => `${ana} alt hesaplarının ${toplam} tanesinde ${karsilikAdi} oranı düşük; ${kalan} tanesi daha var.`, kod),
  };
}

export function kuralCari120OranDusuk(b: DenetimBaglami): KuralSonucu {
  return oranKurali(b, '120');
}
export function kuralCari320OranDusuk(b: DenetimBaglami): KuralSonucu {
  return oranKurali(b, '320');
}

export function kuralCariHareketsizBakiye(b: DenetimBaglami): KuralSonucu {
  const kod = 'CARI_HAREKETSIZ_BAKIYE';
  if (!b.ozet.mizanVar) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Mizan yok' };
  const kisit = cokAyliDegil(b, kod);
  if (kisit) return kisit;
  const bulgular: Bulgu[] = [];
  let incelenen = 0;
  for (const m of b.mizanHesaplari.values()) {
    if (m.ana !== '120' && m.ana !== '320') continue;
    if (b.hesaplar.has(m.kod)) continue; // donemde hareketi var
    incelenen += 1;
    // 120 icin borc bakiye, 320 icin alacak bakiye anlamli (ters bakiye ayri kuralin isi)
    const bakiye = m.ana === '120' ? m.kapanis : -m.kapanis;
    if (bakiye < ESIK.HAREKETSIZ_MIN_BAKIYE) continue;
    // 120: Mizan BORC bakiyesi = musteriden alacagimiz; 320: Mizan ALACAK bakiyesi = saticiya borcumuz
    const tur = m.ana === '120' ? 'alacak' : 'borç';
    const yazi = m.ana === '120' ? `müşteriden alacak ${fmtTL(bakiye)} TL (Mizan borç bakiyesi)` : `satıcıya borç ${fmtTL(bakiye)} TL (Mizan alacak bakiyesi)`;
    bulgular.push({
      severity: 'INFO',
      category: kod,
      message: `${hesapEtiketi(m)}: dönemde hiç hareket yok; ${yazi}, en az ${b.ozet.aySayisi} aydır dokunulmamış.`,
      hesapKodu: m.kod,
      detail: { tutar: bakiye, tur, hesapAdi: m.ad, aySayisi: b.ozet.aySayisi },
    });
  }
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [], not: `${incelenen} hareketsiz cari incelendi` };
  return {
    kod,
    durum: 'BULGU',
    bulgular: ustSinirla(bulgular, ESIK.UST_SINIR_STANDART, (kalan, toplam) => `Toplam ${toplam} hareketsiz cari bakiyesi var; ${kalan} tanesi daha listelenmedi.`, kod),
  };
}

// Ad anahtari → kodlar (hem fis hem Mizan hesaplari)
function cariAdHaritasi(b: DenetimBaglami, ana: '120' | '320'): Map<string, { kod: string; ad: string; bakiye: number | null }[]> {
  const map = new Map<string, { kod: string; ad: string; bakiye: number | null }[]>();
  const ekle = (kod: string, ad: string, bakiye: number | null) => {
    const anahtar = normalizeCariAdi(ad);
    if (!anahtar || anahtar.length < 5) return;
    if (!map.has(anahtar)) map.set(anahtar, []);
    const liste = map.get(anahtar)!;
    if (!liste.some((x) => x.kod === kod)) liste.push({ kod, ad, bakiye });
  };
  for (const h of hesaplarAna(b, ana)) ekle(h.kod, h.ad, h.mizanKapanis);
  for (const m of b.mizanHesaplari.values()) if (m.ana === ana) ekle(m.kod, m.ad, m.kapanis);
  return map;
}

export function kuralCariAyniTaraf(b: DenetimBaglami): KuralSonucu {
  const kod = 'CARI_AYNI_TARAF_120_320';
  const alicilar = cariAdHaritasi(b, '120');
  const saticilar = cariAdHaritasi(b, '320');
  if (!alicilar.size || !saticilar.size) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Karşılaştırılacak 120/320 adı yok' };
  const bulgular: Bulgu[] = [];
  for (const [anahtar, aliciListe] of alicilar.entries()) {
    const saticiListe = saticilar.get(anahtar);
    if (!saticiListe) continue;
    const a = aliciListe[0];
    const s = saticiListe[0];
    const aB = a.bakiye != null ? ` (bakiye ${fmtTL(a.bakiye)} TL)` : '';
    const sB = s.bakiye != null ? ` (bakiye ${fmtTL(-s.bakiye)} TL)` : '';
    const hareketli = b.hesaplar.get(a.kod) || b.hesaplar.get(s.kod);
    bulgular.push({
      severity: 'INFO',
      category: kod,
      message: `${a.ad || anahtar}: hem ${a.kod}${aB} hem ${s.kod}${sB} olarak açık. Karşılıklı bakiye varsa mahsup/netleştirme kararı verin.`,
      hesapKodu: a.kod,
      voucherKey: hareketli?.ilkSatir.voucherKey ?? null,
      rowIndex: hareketli?.ilkSatir.rowIndex ?? null,
      detail: { tutar: Math.abs(a.bakiye || 0) + Math.abs(s.bakiye || 0), alici: a.kod, satici: s.kod, hesapAdi: a.ad },
    });
  }
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [] };
  return { kod, durum: 'BULGU', bulgular: ustSinirla(bulgular, ESIK.UST_SINIR_DUSUK, (kalan, toplam) => `${toplam} cari hem 120 hem 320'de; ${kalan} tanesi daha var.`, kod) };
}

export function kuralMukerrerCariKarti(b: DenetimBaglami): KuralSonucu {
  const kod = 'MUKERRER_CARI_KARTI';
  const bulgular: Bulgu[] = [];
  for (const ana of ['120', '320'] as const) {
    for (const [anahtar, liste] of cariAdHaritasi(b, ana).entries()) {
      if (liste.length < 2) continue;
      const hareketli = liste.map((x) => b.hesaplar.get(x.kod)).find(Boolean);
      const kodlar = liste.map((x) => x.kod).join(', ');
      bulgular.push({
        severity: 'INFO',
        category: kod,
        message: `${liste[0].ad || anahtar}: ${ana} altında ${liste.length} ayrı kart açılmış (${kodlar}). Kartlar birleştirilmeli; bakiye ve Ba/Bs bölünmesin.`,
        hesapKodu: liste[0].kod,
        voucherKey: hareketli?.ilkSatir.voucherKey ?? null,
        rowIndex: hareketli?.ilkSatir.rowIndex ?? null,
        detail: { tutar: liste.reduce((s, x) => s + Math.abs(x.bakiye || 0), 0), kodlar: liste.map((x) => x.kod), hesapAdi: liste[0].ad },
      });
    }
  }
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [] };
  return { kod, durum: 'BULGU', bulgular: ustSinirla(bulgular, ESIK.UST_SINIR_DUSUK, (kalan, toplam) => `${toplam} mükerrer cari kartı; ${kalan} tanesi daha var.`, kod) };
}

export function kuralDefterTahsilatOdemeIslenmemis(b: DenetimBaglami): KuralSonucu {
  const kod = 'DEFTER_TAHSILAT_ODEME_ISLENMEMIS';
  const kisit = cokAyliDegil(b, kod);
  if (kisit) return kisit;
  const genel = defterTekYonluOzeti(b);
  if (genel.hesapSayisi < ESIK.DEFTER_TEK_YONLU_MIN_HESAP) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Değerlendirmeye yetecek cari hesap yok' };
  if (!genel.yaygin) return { kod, durum: 'TEMIZ', bulgular: [], not: `${genel.hesapSayisi} caride tek yönlü oranı %${yuzde(genel.tekYonluSayisi, genel.hesapSayisi)}` };
  const paraYok = !b.ozet.kasaHareketVar && !b.ozet.bankaHareketVar;
  const oranYazi = `%${yuzde(genel.tekYonluSayisi, genel.hesapSayisi)}`;
  const message = paraYok
    ? `Faturalı ${genel.hesapSayisi} cari hesabın ${genel.tekYonluSayisi} tanesi (${oranYazi}) yalnız fatura görmüş; dönemde hiç kasa (100) ve banka (102) hareketi yok. Tahsilat ve ödeme kayıtları işlenmemiş; defter bu haliyle gerçek durumu yansıtmaz.`
    : `Faturalı ${genel.hesapSayisi} cari hesabın ${genel.tekYonluSayisi} tanesi (${oranYazi}) yalnız fatura görmüş, karşılığında tahsilat/ödeme yok. Kasa/banka hareketi var ama carilere işlenmemiş görünüyor.`;
  return {
    kod,
    durum: 'BULGU',
    bulgular: [{
      severity: paraYok ? 'ERROR' : 'WARN',
      category: kod,
      message,
      detail: { tutar: 0, hesapSayisi: genel.hesapSayisi, tekYonlu: genel.tekYonluSayisi, oran: genel.oran, kasaHareketVar: b.ozet.kasaHareketVar, bankaHareketVar: b.ozet.bankaHareketVar },
    }],
  };
}

export function kuralAlacakCiroOrani(b: DenetimBaglami): KuralSonucu {
  const kod = 'ALACAK_CIRO_ORANI_YUKSEK';
  if (!b.ozet.mizanVar) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Mizan yok' };
  let alacak = 0;
  let aliciSayisi = 0;
  for (const m of b.mizanHesaplari.values()) {
    if (m.ana !== '120') continue;
    aliciSayisi += 1;
    if (m.kapanis > 0) alacak += m.kapanis;
  }
  if (!aliciSayisi) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Mizanda 120 yok' };
  let satis = 0;
  for (const h of b.hesaplar.values()) if (/^60[012]$/.test(h.ana)) satis += h.alacak - h.borc;
  if (alacak < ESIK.ALACAK_CIRO_MIN_BAKIYE) return { kod, durum: 'TEMIZ', bulgular: [], not: `Alacak ${fmtTL(alacak)} TL, eşik altı` };
  if (satis > 0 && alacak <= satis * ESIK.ALACAK_CIRO_KATI) return { kod, durum: 'TEMIZ', bulgular: [], not: `Alacak/satış ${(alacak / satis).toFixed(1)} kat` };
  const kat = satis > 0 ? `${(alacak / satis).toFixed(1)} katı` : 'dönemde satış yokken';
  const ilk120 = hesaplarAna(b, '120')[0];
  return {
    kod,
    durum: 'BULGU',
    bulgular: [{
      severity: 'INFO',
      category: kod,
      message: `Mizanda toplam alıcı (120) bakiyesi ${fmtTL(alacak)} TL; dönem net satışı ${fmtTL(satis)} TL (${kat}). Tahsilatlar işlenmemiş ya da eski alacaklar tahsil edilemiyor olabilir; alacak yaşlandırması yapın.`,
      hesapKodu: '120',
      voucherKey: ilk120?.ilkSatir.voucherKey ?? null,
      rowIndex: ilk120?.ilkSatir.rowIndex ?? null,
      detail: { tutar: alacak, satis, oran: satis > 0 ? alacak / satis : null },
    }],
  };
}

export const CARI_KURALLARI = [
  kuralDefterTahsilatOdemeIslenmemis,
  kuralCari120TahsilatYok,
  kuralCari320OdemeYok,
  kuralCari120OranDusuk,
  kuralCari320OranDusuk,
  kuralCariHareketsizBakiye,
  kuralCariAyniTaraf,
  kuralMukerrerCariKarti,
  kuralAlacakCiroOrani,
];
