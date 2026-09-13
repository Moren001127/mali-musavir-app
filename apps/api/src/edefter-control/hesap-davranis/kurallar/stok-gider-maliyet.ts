// HESAP DAVRANIS DENETIMI — Stok, satilan malin maliyeti ve gider davranisi.
//   Gercek musavir bakisi: satis var ama SMM kaydi atilmamis mi; stok alt hesabinin adindaki KDV orani
//   fisle tutuyor mu; stok satisa gore sisik mi; her ay gelen gider (kira, elektrik, su...) bir ay
//   atlamis mi; satis/alis/KDV bir ayda tamamen kesilmis mi; kredi var ama faiz gideri yok mu; 180'den
//   aylik aktarim yapilmis mi; ceza/gecikme zammi normal gidere mi yazilmis; demirbas dogrudan gidere
//   mi gitmis; brut satis zarari var mi. Saf fonksiyonlar; yalniz baglam okunur.
import type { ParsedEDefterFisLine } from '../../edefter-fis-listesi-parser.service';
import { ESIK, demirbasSiniri } from '../esikler';
import {
  anaKod,
  ayAdi,
  fmtTL,
  fmtTarih,
  gecerliTarih,
  hesapEtiketi,
  hesaplarAna,
  hesaplarPrefix,
  kisaAd,
  normalizeMetin,
  satirMetni,
  ustSinirla,
  yuzde,
} from '../istatistik';
import type { Bulgu, DenetimBaglami, Hareket, HesapIstatistik, KuralSonucu, MizanHesabi } from '../tipler';

// ---------------------------------------------------------------- ortak yardimcilar
const STOK_RE = /^15[0-7]$/; // 150-157 stoklar (158 deger dusuklugu karsiligi ve 159 siparis avansi stok degil)
const STOK_FIS_RE = /^15[0-9]$/; // fis satirinda "15x borc"
const SATIS_RE = /^60[01]$/;
const NET_SATIS_RE = /^60[012]$/;
const SATIS_IADE_RE = /^61[012]$/;
const SMM_RE = /^62[0-3]$/; // 620 mamul, 621 ticari mal, 622 hizmet, 623 diger satislarin maliyeti
const GIDER_RE = /^7/;

function donemTipiMetni(b: DenetimBaglami): string {
  return String(b.girdi.donemTipi || '').toUpperCase();
}
// Gecici vergi ceyregi ya da yillik donem mi? Tip bilinmiyorsa 3+ aylik donem ceyrek/yil gibi sayilir.
function geciciVeyaYillik(b: DenetimBaglami): boolean {
  const t = donemTipiMetni(b);
  if (t === 'YILLIK' || /^GECICI_Q[1-4]$/.test(t)) return true;
  if (t === 'AYLIK') return false;
  return b.ozet.aySayisi >= 3;
}
function yillikMi(b: DenetimBaglami): boolean {
  return b.ozet.isYillik || (!donemTipiMetni(b) && b.ozet.aySayisi >= 12);
}
function toplam(hesaplar: HesapIstatistik[], alan: 'borc' | 'alacak'): number {
  return hesaplar.reduce((s, h) => s + h[alan], 0);
}
function fmtOran(x: number): string {
  const r = Math.round(x * 10) / 10;
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace('.', ',');
}
// Hareketin metni: fis satiri (aciklama + hesap adi + tip) + hesabin adi (satirda ad bos olabilir)
function hareketMetni(h: HesapIstatistik, m: Hareket): string {
  return normalizeMetin(`${satirMetni(m.satir)} ${h.ad}`);
}
function mizanHesaplariAna(b: DenetimBaglami, re: RegExp): MizanHesabi[] {
  return [...b.mizanHesaplari.values()].filter((m) => re.test(m.ana));
}
function fisSatirlari(b: DenetimBaglami, key: string): ParsedEDefterFisLine[] {
  return b.fisler.get(key) || [];
}
function fisteHesapVar(b: DenetimBaglami, key: string, re: RegExp, taraf?: 'borc' | 'alacak'): boolean {
  return fisSatirlari(b, key).some((r) => re.test(anaKod(r.hesapKodu)) && (!taraf || Number(r[taraf] || 0) > 0));
}
function satirTarihi(r: ParsedEDefterFisLine): string | null {
  return gecerliTarih(r.fisTarihi) ? fmtTarih(r.fisTarihi) : null;
}
function fisKimligi(r: ParsedEDefterFisLine): string {
  const tarih = satirTarihi(r);
  const parcalar = [tarih ? `${tarih} tarihli` : null, r.evrakNo ? `evrak ${r.evrakNo}` : null].filter(Boolean);
  return parcalar.length ? `${parcalar.join(', ')} fişte` : 'fişte';
}
function aciklamaMetni(r: ParsedEDefterFisLine, varsayilan: string): string {
  const t = String(r.aciklama || '').trim();
  return t ? `"${kisaAd(t, 60)}" açıklamalı` : varsayilan;
}
// Ay listesini kisa yaz: 4 ve daha az ay ise hepsi; daha coksa eksik ayin komsulari + ortalama
function ayListesiYazisi(
  eksikAy: string,
  aylar: string[],
  deger: (ay: string) => string,
  ortalama: string,
): string {
  if (aylar.length <= 4) return aylar.map((a) => `${ayAdi(a)} ${deger(a)}`).join(', ');
  const sirali = [...aylar].sort();
  const onceki = sirali.filter((a) => a < eksikAy).pop();
  const sonraki = sirali.find((a) => a > eksikAy);
  const parcalar: string[] = [];
  if (onceki) parcalar.push(`önceki ay ${ayAdi(onceki)} ${deger(onceki)}`);
  if (sonraki) parcalar.push(`sonraki ay ${ayAdi(sonraki)} ${deger(sonraki)}`);
  parcalar.push(`aylık ortalama ${ortalama}`);
  return parcalar.join(', ');
}

// ---------------------------------------------------------------- 1) SMM_621_YOK
// Satis var, stok hesabi var ama donemde 62x borc kaydi yok ve stoktan hic cikis olmamis → SMM atilmamis.
export function kuralSmm621Yok(b: DenetimBaglami): KuralSonucu {
  const kod = 'SMM_621_YOK';
  if (!geciciVeyaYillik(b)) {
    return { kod, durum: 'UYGULANMAZ', bulgular: [], not: 'Aylık dönemde SMM kaydı beklenmez; geçici vergi ya da yıllık dönemde bakılır' };
  }
  const satisHesaplari = hesaplarPrefix(b, SATIS_RE);
  const satis = toplam(satisHesaplari, 'alacak');
  if (satis <= 0) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Dönemde satış (600/601) yok' };
  const stokHesaplari = hesaplarPrefix(b, STOK_RE);
  const mizanStok = mizanHesaplariAna(b, STOK_RE).filter((m) => m.kapanis > 1);
  if (!stokHesaplari.length && !mizanStok.length) {
    return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Stok hesabı (15x) yok; hizmet işletmesi olabilir' };
  }
  const smm = hesaplarPrefix(b, SMM_RE).filter((h) => h.borc > 0);
  if (smm.length) {
    return { kod, durum: 'TEMIZ', bulgular: [], not: `SMM kaydı var (${[...new Set(smm.map((h) => h.ana))].join(', ')}: ${fmtTL(toplam(smm, 'borc'))} TL)` };
  }
  const stokAlis = toplam(stokHesaplari, 'borc');
  const stokCikis = toplam(stokHesaplari, 'alacak');
  if (stokCikis > 1) {
    return { kod, durum: 'TEMIZ', bulgular: [], not: `62x kaydı yok ama stok hesabından ${fmtTL(stokCikis)} TL çıkış var (üretim/aktarım olabilir)` };
  }
  const yillik = yillikMi(b);
  const mizanStokBakiye = mizanStok.reduce((s, m) => s + m.kapanis, 0);
  const mizanNotu = b.ozet.mizanVar && mizanStokBakiye > 0 ? ` Mizan stok bakiyesi ${fmtTL(mizanStokBakiye)} TL.` : '';
  const capaHesap: HesapIstatistik = stokHesaplari[0] || satisHesaplari[0];
  const baslik = stokHesaplari.length === 1 ? hesapEtiketi(stokHesaplari[0]) : 'Stok hesapları (15x)';
  const oneri = yillik
    ? 'Yıllık defterde SMM kaydı zorunlu: dönem sonu stok sayımı yapıp maliyet kaydını atın.'
    : 'Geçici vergi matrahı için dönem sonu stok tespiti yapıp SMM kaydını atın.';
  const stokAlisYazi = stokAlis > 0 ? `stok alışı ${fmtTL(stokAlis)} TL` : 'dönemde stok alışı yok';
  return {
    kod,
    durum: 'BULGU',
    bulgular: [{
      severity: yillik ? 'WARN' : 'INFO',
      category: kod,
      message: `${baslik}: dönemde satış ${fmtTL(satis)} TL, ${stokAlisYazi}; satılan malın maliyeti (621/622) kaydı yok ve stok hesabından hiç çıkış yok.${mizanNotu} ${oneri}`,
      voucherKey: capaHesap.ilkSatir.voucherKey,
      rowIndex: capaHesap.ilkSatir.rowIndex,
      hesapKodu: stokHesaplari[0]?.kod || mizanStok[0]?.kod || '153',
      detail: {
        tutar: satis,
        satis,
        stokAlis,
        mizanStokBakiye: b.ozet.mizanVar ? mizanStokBakiye : null,
        yillik,
        stokHesapSayisi: stokHesaplari.length,
      },
    }],
  };
}

// ---------------------------------------------------------------- 2) STOK_KDV_ORANI_ALT_HESAP_UYUMSUZ
const KDV_ORAN_RE = /%\s?(\d{1,2})(?!\d)/;
export function hesapAdindakiKdvOrani(ad?: string | null): number | null {
  const m = KDV_ORAN_RE.exec(normalizeMetin(ad));
  return m ? Number(m[1]) : null;
}

// Fis bazli: borc tarafi yalniz BIR stok satiri + 191 satirlarindan olusan fislerde 191/stok orani, hesap adindaki
//   "%N" ile karsilastirilir. Karma fisler (gider/sabit kiymet satiri da olan) atlanir: 191 toplami onlarin KDV'sini de tasir.
export function kuralStokKdvOraniUyumsuz(b: DenetimBaglami): KuralSonucu {
  const kod = 'STOK_KDV_ORANI_ALT_HESAP_UYUMSUZ';
  const oranliStok = hesaplarPrefix(b, STOK_FIS_RE).filter((h) => hesapAdindakiKdvOrani(h.ad) != null);
  if (!oranliStok.length) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Adında KDV oranı (%) yazan stok alt hesabı yok' };
  const bulgular: Bulgu[] = [];
  let incelenen = 0;
  for (const [key, rows] of b.fisler.entries()) {
    const borclar = rows.filter((r) => Number(r.borc || 0) > 0);
    const stokSatirlari = borclar.filter((r) => STOK_FIS_RE.test(anaKod(r.hesapKodu)));
    if (stokSatirlari.length !== 1) continue;
    const kdvSatirlari = borclar.filter((r) => anaKod(r.hesapKodu) === '191');
    if (borclar.length !== stokSatirlari.length + kdvSatirlari.length) continue; // karma fis
    const kdv = kdvSatirlari.reduce((s, r) => s + Number(r.borc || 0), 0);
    if (kdv <= 0) continue;
    const stok = stokSatirlari[0];
    const hesap = b.hesaplar.get(String(stok.hesapKodu || '').trim());
    const hesapAdi = hesap?.ad || String(stok.hesapAdi || '');
    const beklenen = hesapAdindakiKdvOrani(hesapAdi);
    if (beklenen == null) continue;
    incelenen += 1;
    const stokTutar = Number(stok.borc || 0);
    const gercek = (kdv / stokTutar) * 100;
    if (Math.abs(gercek - beklenen) <= 1) continue;
    const etiket = hesapEtiketi({ kod: String(stok.hesapKodu || ''), ad: hesapAdi });
    bulgular.push({
      severity: 'WARN',
      category: kod,
      message: `${etiket}: ${fisKimligi(stok)} stok ${fmtTL(stokTutar)} TL, KDV (191) ${fmtTL(kdv)} TL → fiili oran %${fmtOran(gercek)}; hesap adı %${beklenen} diyor. Fiş yanlış oranlı stok alt hesabına işlenmiş ya da KDV tutarı hatalı olabilir.`,
      voucherKey: key,
      rowIndex: stok.rowIndex,
      hesapKodu: stok.hesapKodu ?? null,
      detail: {
        tutar: stokTutar,
        kdv,
        beklenenOran: beklenen,
        gercekOran: Math.round(gercek * 100) / 100,
        evrakNo: stok.evrakNo ?? null,
        hesapAdi,
      },
    });
  }
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [], not: `${incelenen} stok alış fişinde KDV oranı hesap adıyla uyumlu` };
  return {
    kod,
    durum: 'BULGU',
    bulgular: ustSinirla(
      bulgular,
      ESIK.UST_SINIR_STANDART,
      (kalan, toplamAdet) => `Toplam ${toplamAdet} fişte stok alt hesabı KDV oranıyla uyuşmuyor; en büyük ${toplamAdet - kalan} tanesi listelendi, ${kalan} tanesi daha var.`,
      kod,
    ),
    not: `${incelenen} fişin ${bulgular.length} tanesinde oran uyumsuz`,
  };
}

// ---------------------------------------------------------------- 3) STOK_CIRO_ORANI_YUKSEK
export function kuralStokCiroOrani(b: DenetimBaglami): KuralSonucu {
  const kod = 'STOK_CIRO_ORANI_YUKSEK';
  if (!b.ozet.mizanVar) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Mizan yok' };
  const stokMizan = mizanHesaplariAna(b, STOK_RE);
  if (!stokMizan.length) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Mizanda stok hesabı (15x) yok' };
  const stok = stokMizan.reduce((s, m) => s + (m.kapanis > 0 ? m.kapanis : 0), 0);
  if (stok < ESIK.STOK_CIRO_MIN_BAKIYE) return { kod, durum: 'TEMIZ', bulgular: [], not: `Stok ${fmtTL(stok)} TL, eşik altı` };
  let satis = 0;
  for (const h of hesaplarPrefix(b, NET_SATIS_RE)) satis += h.alacak - h.borc;
  if (satis <= 0) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Dönemde net satış yok; stok/satış oranı hesaplanamadı' };
  const kat = stok / satis;
  // Ceyrek donemde 3 aylik satisa esit stok normaldir; esik yillikta 1 kat, ara donemde 2 kat (2026-09-13)
  const katEsigi = b.ozet.isYillik ? ESIK.STOK_CIRO_KATI : ESIK.STOK_CIRO_KATI * 2;
  if (stok <= satis * katEsigi) return { kod, durum: 'TEMIZ', bulgular: [], not: `Stok/satış ${kat.toFixed(1)} kat (eşik ${katEsigi} kat)` };
  const ilkStok = hesaplarPrefix(b, STOK_RE)[0];
  return {
    kod,
    durum: 'BULGU',
    bulgular: [{
      severity: 'INFO',
      category: kod,
      message: `Mizanda stok (15x) bakiyesi ${fmtTL(stok)} TL; dönem net satışı ${fmtTL(satis)} TL (${kat.toFixed(1)} katı). SMM kaydı eksik ya da fiili stok şişkin olabilir; envanterle karşılaştırıp stok değer düşüklüğünü değerlendirin.`,
      hesapKodu: stokMizan[0].kod,
      voucherKey: ilkStok?.ilkSatir.voucherKey ?? null,
      rowIndex: ilkStok?.ilkSatir.rowIndex ?? null,
      detail: { tutar: stok, satis, oran: kat, stokHesapSayisi: stokMizan.length },
    }],
  };
}

// ---------------------------------------------------------------- 4) SABIT_GIDER_AY_ATLAMIS
type GiderTuru = { ad: string; re: RegExp };
// Duzenli ifadeler aksansiz (normalizeMetin sonrasi metne uygulanir)
const DUZENLI_GIDERLER: GiderTuru[] = [
  { ad: 'Kira gideri', re: /\bkira(si|sini|lari|larini|ya|yi|dan|nin)?\b|kira gideri|isyeri kirasi/ },
  { ad: 'Elektrik gideri', re: /elektrik|enerjisa|ck bogazici|aydem|bedas|uedas|akedas|sedas/ },
  { ad: 'Su gideri', re: /\bsu(yu)?\b|su faturasi|\b(iski|aski|maski|saski|kaski|buski|izsu)\b/ },
  { ad: 'Doğalgaz gideri', re: /dogalgaz|dogal gaz|igdas|bursagaz|enerya|gaz faturasi|baskentgaz|izmirgaz|esgaz|palgaz|agdas|kargaz|torosgaz/ },
  { ad: 'Telefon/internet gideri', re: /telefon|\bgsm\b|turkcell|vodafone|turk telekom|internet|superonline|ttnet|turknet|kablonet|netgsm/ },
  { ad: 'Muhasebe/müşavirlik ücreti', re: /muhasebe|musavir|smmm/ },
  { ad: 'Aidat gideri', re: /aidat/ },
];

type AySerisi = { tutar: number; adet: number };
type TurSerisi = { tur: GiderTuru; aylar: Map<string, AySerisi>; ilk: Hareket | null; hesap: HesapIstatistik | null };

export function kuralSabitGiderAyAtlamis(b: DenetimBaglami): KuralSonucu {
  const kod = 'SABIT_GIDER_AY_ATLAMIS';
  // 2 ayda desen kurulamaz (bir ayda gorunen gider tek seferlik olabilir); en az 3 ay gerekir
  if (b.ozet.aySayisi < 3) return { kod, durum: 'UYGULANMAZ', bulgular: [], not: 'Ay atlama deseni için en az 3 aylık dönem gerekir' };
  const giderHesaplari = hesaplarPrefix(b, GIDER_RE);
  if (!giderHesaplari.length) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Dönemde 7xx gider hareketi yok' };
  const seriler: TurSerisi[] = DUZENLI_GIDERLER.map((tur) => ({ tur, aylar: new Map(), ilk: null, hesap: null }));
  for (const h of giderHesaplari) {
    for (const m of h.hareketler) {
      if (m.taraf !== 'BORC' || m.tutar <= 0 || !m.ay || !b.ozet.aylar.includes(m.ay)) continue;
      const metin = hareketMetni(h, m);
      for (const s of seriler) {
        if (!s.tur.re.test(metin)) continue;
        const ay = s.aylar.get(m.ay) || { tutar: 0, adet: 0 };
        ay.tutar += m.tutar;
        ay.adet += 1;
        s.aylar.set(m.ay, ay);
        if (!s.ilk) { s.ilk = m; s.hesap = h; }
      }
    }
  }
  const bulgular: Bulgu[] = [];
  let desenli = 0;
  for (const s of seriler) {
    const varAylar = b.ozet.aylar.filter((a) => (s.aylar.get(a)?.adet || 0) > 0);
    if (varAylar.length < 2) continue; // desen yok
    desenli += 1;
    if (varAylar.length !== b.ozet.aySayisi - 1) continue; // ya tam ya da 2+ ay eksik (duzensiz)
    const eksikAy = b.ozet.aylar.find((a) => !varAylar.includes(a))!;
    const toplamTutar = varAylar.reduce((t, a) => t + (s.aylar.get(a)?.tutar || 0), 0);
    const ortalama = toplamTutar / varAylar.length;
    const liste = ayListesiYazisi(eksikAy, varAylar, (a) => `${fmtTL(s.aylar.get(a)!.tutar)} TL`, `${fmtTL(ortalama)} TL`);
    const ilk = s.ilk!;
    bulgular.push({
      severity: 'INFO',
      category: kod,
      message: `${s.tur.ad} ${ayAdi(eksikAy)} ayında yok; diğer ${varAylar.length} ayda var (${liste}). O ayın faturası işlenmemiş olabilir; e-Fatura/e-Arşiv gelen kutusunu kontrol edin.`,
      voucherKey: ilk.satir.voucherKey,
      rowIndex: ilk.satir.rowIndex,
      hesapKodu: s.hesap?.kod ?? null,
      detail: {
        tutar: ortalama,
        tur: s.tur.ad,
        eksikAy,
        ortalama,
        aylar: Object.fromEntries(varAylar.map((a) => [a, s.aylar.get(a)!.tutar])),
        hesapAdi: s.hesap?.ad ?? '',
      },
    });
  }
  if (!bulgular.length) {
    return { kod, durum: 'TEMIZ', bulgular: [], not: desenli ? `${desenli} düzenli gider türü her ay var` : 'Düzenli gider deseni yok' };
  }
  return { kod, durum: 'BULGU', bulgular, not: `${desenli} düzenli gider türünün ${bulgular.length} tanesi bir ay atlamış` };
}

// ---------------------------------------------------------------- 5) AYLIK_HAREKET_KESINTISI
type HareketSinifTanimi = { ad: string; kod: string; uyar: (h: HesapIstatistik, m: Hareket) => boolean };
const HAREKET_SINIFLARI: HareketSinifTanimi[] = [
  { ad: 'Satış (600/601 alacak)', kod: '600', uyar: (h, m) => SATIS_RE.test(h.ana) && m.taraf === 'ALACAK' },
  { ad: 'Alış/gider (15x, 7xx borç)', kod: '153', uyar: (h, m) => (STOK_FIS_RE.test(h.ana) || GIDER_RE.test(h.ana)) && m.taraf === 'BORC' },
  { ad: 'İndirilecek KDV (191 borç)', kod: '191', uyar: (h, m) => h.ana === '191' && m.taraf === 'BORC' },
  { ad: 'Hesaplanan KDV (391 alacak)', kod: '391', uyar: (h, m) => h.ana === '391' && m.taraf === 'ALACAK' },
];

export function kuralAylikHareketKesintisi(b: DenetimBaglami): KuralSonucu {
  const kod = 'AYLIK_HAREKET_KESINTISI';
  if (b.ozet.aySayisi < 3) return { kod, durum: 'UYGULANMAZ', bulgular: [], not: 'Ay kesintisi için en az 3 aylık dönem gerekir' };
  const seriler = HAREKET_SINIFLARI.map((sinif) => ({ sinif, aylar: new Map<string, AySerisi>(), ilk: null as Hareket | null, hesap: null as HesapIstatistik | null }));
  for (const h of b.hesaplar.values()) {
    for (const m of h.hareketler) {
      if (m.tutar <= 0 || !m.ay || !b.ozet.aylar.includes(m.ay)) continue;
      for (const s of seriler) {
        if (!s.sinif.uyar(h, m)) continue;
        const ay = s.aylar.get(m.ay) || { tutar: 0, adet: 0 };
        ay.tutar += m.tutar;
        ay.adet += 1;
        s.aylar.set(m.ay, ay);
        if (!s.ilk) { s.ilk = m; s.hesap = h; }
      }
    }
  }
  const bulgular: Bulgu[] = [];
  let incelenen = 0;
  for (const s of seriler) {
    if (!s.aylar.size) continue;
    incelenen += 1;
    const adet = (a: string) => s.aylar.get(a)?.adet || 0;
    const sifirAylar = b.ozet.aylar.filter((a) => adet(a) === 0);
    if (sifirAylar.length !== 1) continue;
    const eksikAy = sifirAylar[0];
    const digerAylar = b.ozet.aylar.filter((a) => a !== eksikAy);
    if (digerAylar.some((a) => adet(a) < ESIK.AY_KESINTI_MIN_HAREKET)) continue;
    const toplamTutar = digerAylar.reduce((t, a) => t + (s.aylar.get(a)?.tutar || 0), 0);
    const toplamAdet = digerAylar.reduce((t, a) => t + adet(a), 0);
    const ortalamaTutar = toplamTutar / digerAylar.length;
    const liste = ayListesiYazisi(
      eksikAy,
      digerAylar,
      (a) => `${adet(a)} kayıt / ${fmtTL(s.aylar.get(a)!.tutar)} TL`,
      `${Math.round(toplamAdet / digerAylar.length)} kayıt / ${fmtTL(ortalamaTutar)} TL`,
    );
    const ilk = s.ilk!;
    bulgular.push({
      severity: 'INFO',
      category: kod,
      message: `${s.sinif.ad} kayıtları ${ayAdi(eksikAy)} ayında hiç yok; diğer aylarda düzenli (${liste}). O ayın fişleri işlenmemiş olabilir; mevsimsel durgunluksa bilgi olarak geçin.`,
      voucherKey: ilk.satir.voucherKey,
      rowIndex: ilk.satir.rowIndex,
      hesapKodu: s.hesap?.kod ?? s.sinif.kod,
      detail: {
        tutar: ortalamaTutar,
        sinif: s.sinif.ad,
        eksikAy,
        ortalamaAdet: toplamAdet / digerAylar.length,
        aylar: Object.fromEntries(digerAylar.map((a) => [a, { adet: adet(a), tutar: s.aylar.get(a)!.tutar }])),
      },
    });
  }
  if (!incelenen) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Satış/alış/KDV hareketi yok' };
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [], not: `${incelenen} hareket sınıfında ay kesintisi yok` };
  return { kod, durum: 'BULGU', bulgular };
}

// ---------------------------------------------------------------- 6) KREDI_FAIZ_GIDERI_YOK
const KREDI_RE = /^(300|303|400)$/; // 300 kisa vadeli, 303 uzun vadeli kredi anapara taksitleri, 400 uzun vadeli
const FINANSMAN_RE = /^(780|660|661)$/;
const FAIZ_METIN_RE = /faiz|finansman/;
const FAIZ_HARIC_RE = /gecikme|tecil|pisman/; // vergi gecikme/tecil faizi kredi faizi degildir

export function kuralKrediFaizGideriYok(b: DenetimBaglami): KuralSonucu {
  const kod = 'KREDI_FAIZ_GIDERI_YOK';
  const krediHesaplari = hesaplarPrefix(b, KREDI_RE);
  const krediMizan = mizanHesaplariAna(b, KREDI_RE).filter((m) => -m.kapanis > 1);
  if (!krediHesaplari.length && !krediMizan.length) {
    return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Banka kredisi (300/400) hareketi ya da bakiyesi yok' };
  }
  const finansman = hesaplarPrefix(b, FINANSMAN_RE).filter((h) => h.borc > 0);
  if (finansman.length) {
    return { kod, durum: 'TEMIZ', bulgular: [], not: `Finansman gideri var (${[...new Set(finansman.map((h) => h.ana))].join(', ')}: ${fmtTL(toplam(finansman, 'borc'))} TL)` };
  }
  // 770 (ya da baska 65x-69x/7xx) altina "faiz/finansman" metniyle yazilmis borc da kabul
  let faizMetinli = 0;
  let faizHesap: HesapIstatistik | null = null;
  for (const h of hesaplarPrefix(b, /^(6[5-9]|7)/)) {
    for (const m of h.hareketler) {
      if (m.taraf !== 'BORC' || m.tutar <= 0) continue;
      const metin = hareketMetni(h, m);
      if (!FAIZ_METIN_RE.test(metin) || FAIZ_HARIC_RE.test(metin)) continue;
      faizMetinli += m.tutar;
      if (!faizHesap) faizHesap = h;
    }
  }
  if (faizHesap && faizMetinli > 0) {
    return { kod, durum: 'TEMIZ', bulgular: [], not: `Faiz/finansman gideri ${hesapEtiketi(faizHesap)} altında (${fmtTL(faizMetinli)} TL)` };
  }
  const bakiye = krediMizan.reduce((s, m) => s - m.kapanis, 0);
  const hareket = krediHesaplari.reduce((s, h) => s + h.borc + h.alacak, 0);
  const adet = krediHesaplari.reduce((s, h) => s + h.borcAdet + h.alacakAdet, 0);
  const parcalar: string[] = [];
  if (krediHesaplari.length) {
    parcalar.push(`${krediHesaplari.slice(0, 3).map(hesapEtiketi).join(', ')}: dönemde ${adet} hareket, ${fmtTL(hareket)} TL`);
  }
  if (bakiye > 0) parcalar.push(`Mizan kredi bakiyesi ${fmtTL(bakiye)} TL`);
  const ilk = krediHesaplari[0];
  return {
    kod,
    durum: 'BULGU',
    bulgular: [{
      severity: 'WARN',
      category: kod,
      message: `Banka kredisi var (${parcalar.join('; ')}) ama dönemde finansman/faiz gideri (780/660/661) kaydı yok. Kredi taksit tablosundaki faizleri işleyin; dönem sonu işlemiş faiz tahakkukunu unutmayın.`,
      voucherKey: ilk?.ilkSatir.voucherKey ?? null,
      rowIndex: ilk?.ilkSatir.rowIndex ?? null,
      hesapKodu: ilk?.kod ?? krediMizan[0]?.kod ?? '300',
      detail: { tutar: bakiye > 0 ? bakiye : hareket, mizanBakiye: b.ozet.mizanVar ? bakiye : null, donemHareket: hareket, hareketAdet: adet, krediHesaplari: krediHesaplari.map((h) => h.kod) },
    }],
  };
}

// ---------------------------------------------------------------- 7) GELECEK_AY_180_AKTARIM_YOK
export function kuralGelecekAy180Aktarim(b: DenetimBaglami): KuralSonucu {
  const kod = 'GELECEK_AY_180_AKTARIM_YOK';
  const hesaplar = hesaplarAna(b, '180');
  const mizan180 = mizanHesaplariAna(b, /^180$/);
  if (!hesaplar.length && !mizan180.length) return { kod, durum: 'VERI_YOK', bulgular: [], not: '180 hesabı yok' };
  const bakiye = mizan180.reduce((s, m) => s + (m.kapanis > 0 ? m.kapanis : 0), 0);
  const borc = toplam(hesaplar, 'borc');
  const alacak = toplam(hesaplar, 'alacak');
  if (bakiye <= 1 && borc <= 0) return { kod, durum: 'TEMIZ', bulgular: [], not: '180 bakiyesi/borç hareketi yok' };
  if (alacak > 0) return { kod, durum: 'TEMIZ', bulgular: [], not: `180'den ${fmtTL(alacak)} TL aktarım var` };
  const ilk = hesaplar[0];
  const etiket = ilk ? hesapEtiketi(ilk) : hesapEtiketi(mizan180[0]);
  const parcalar: string[] = [];
  if (bakiye > 1) parcalar.push(`Mizan bakiyesi ${fmtTL(bakiye)} TL`);
  if (borc > 0) parcalar.push(`dönemde ${fmtTL(borc)} TL borç kaydı`);
  return {
    kod,
    durum: 'BULGU',
    bulgular: [{
      severity: 'INFO',
      category: kod,
      message: `${etiket}: ${parcalar.join(', ')} var ama dönem içinde hiç alacak (gidere aktarım) kaydı yok. Peşin ödenen kira/sigorta gibi giderlerin bu döneme düşen payı 7xx hesaplarına aktarılmalı (dönemsellik).`,
      voucherKey: ilk?.ilkSatir.voucherKey ?? null,
      rowIndex: ilk?.ilkSatir.rowIndex ?? null,
      hesapKodu: ilk?.kod ?? mizan180[0].kod,
      detail: { tutar: bakiye > 1 ? bakiye : borc, mizanBakiye: b.ozet.mizanVar ? bakiye : null, donemBorc: borc, hesapAdi: ilk?.ad ?? mizan180[0].ad },
    }],
  };
}

// ---------------------------------------------------------------- 8) KKEG_NITELIKLI_GIDER_7XX
const KKEG_RE = /vergi cezasi|vergi ceza|vergi ziyai|gecikme zammi|gecikme faizi|gecikme cezasi|trafik cezasi|trafik ceza|idari para cezasi|idari para|ozel usulsuzluk|usulsuzluk|pisman|tecil faizi|kabahat/;
const CEZA_HARIC_RE = /cezasiz|cezai sart|cezaevi/;
const KKEG_ETIKET: Record<string, string> = {
  'vergi cezasi': 'vergi cezası',
  'vergi ceza': 'vergi cezası',
  'vergi ziyai': 'vergi ziyaı cezası',
  'gecikme zammi': 'gecikme zammı',
  'gecikme faizi': 'gecikme faizi',
  'gecikme cezasi': 'gecikme cezası',
  'trafik cezasi': 'trafik cezası',
  'trafik ceza': 'trafik cezası',
  'idari para cezasi': 'idari para cezası',
  'idari para': 'idari para cezası',
  'ozel usulsuzluk': 'özel usulsüzlük cezası',
  usulsuzluk: 'usulsüzlük cezası',
  pisman: 'pişmanlık zammı',
  'tecil faizi': 'tecil faizi',
  kabahat: 'kabahat / idari yaptırım',
  ceza: 'ceza',
};

export function kkegDeseni(metin: string): string | null {
  const m = KKEG_RE.exec(metin);
  if (m) return m[0];
  if (/ceza/.test(metin) && !CEZA_HARIC_RE.test(metin)) return 'ceza';
  return null;
}

export function kuralKkegNitelikliGider(b: DenetimBaglami): KuralSonucu {
  const kod = 'KKEG_NITELIKLI_GIDER_7XX';
  const giderHesaplari = hesaplarPrefix(b, GIDER_RE);
  if (!giderHesaplari.length) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Dönemde 7xx gider hareketi yok' };
  const bulgular: Bulgu[] = [];
  let incelenen = 0;
  for (const h of giderHesaplari) {
    for (const m of h.hareketler) {
      if (m.taraf !== 'BORC' || m.tutar <= 0) continue;
      incelenen += 1;
      const desen = kkegDeseni(hareketMetni(h, m));
      if (!desen) continue;
      if (fisteHesapVar(b, m.satir.voucherKey, /^689$/)) continue; // ayni fiste 689 var: KKEG'e alinmis
      const etiket = KKEG_ETIKET[desen] || desen;
      bulgular.push({
        severity: 'WARN',
        category: kod,
        message: `${hesapEtiketi(h)}: ${fisKimligi(m.satir)} ${aciklamaMetni(m.satir, 'hesap adına göre')} ${fmtTL(m.tutar)} TL gider yazılmış (${etiket}); bu tür ödemeler kanunen kabul edilmeyen giderdir. Kaydı 689 KKEG hesabına alın ya da beyannamede matraha ekleyin.`,
        voucherKey: m.satir.voucherKey,
        rowIndex: m.satir.rowIndex,
        hesapKodu: h.kod,
        detail: { tutar: m.tutar, desen: etiket, aciklama: m.satir.aciklama ?? null, evrakNo: m.satir.evrakNo ?? null, tarih: satirTarihi(m.satir), hesapAdi: h.ad },
      });
    }
  }
  if (!incelenen) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Dönemde 7xx borç satırı yok' };
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [], not: `${incelenen} gider satırında ceza/gecikme zammı deseni yok` };
  return {
    kod,
    durum: 'BULGU',
    bulgular: ustSinirla(
      bulgular,
      ESIK.UST_SINIR_STANDART,
      (kalan, toplamAdet) => `Toplam ${toplamAdet} gider satırı KKEG niteliğinde; en büyük ${toplamAdet - kalan} tanesi listelendi, ${kalan} tanesi daha var.`,
      kod,
    ),
    not: `${incelenen} gider satırının ${bulgular.length} tanesi KKEG niteliğinde`,
  };
}

// ---------------------------------------------------------------- 9) DEMIRBAS_DOGRUDAN_GIDER
// "telefon" tek basina telefon faturasi olabilir → yalniz "telefon alimi | cep telefonu"
const DEMIRBAS_RE = /bilgisayar|laptop|notebook|dizustu|telefon alimi|cep telefonu|iphone|samsung|klima|buzdolabi|\bmasa|sandalye|koltuk|dolap|mobilya|makine|makina|yazici|printer|tablet|monitor|ekran|kamera|jenerator|kompresor|demirbas/;
// Ayni kelimeler bakim/onarim/kira/sarf faturasinda da gecer; bunlar alim degil
const DEMIRBAS_HARIC_RE = /bakim|onarim|tamir|servis|kira|toner|kartus|yedek parca|sarf|abone|yakit|sigorta/;

export function kuralDemirbasDogrudanGider(b: DenetimBaglami): KuralSonucu {
  const kod = 'DEMIRBAS_DOGRUDAN_GIDER';
  const giderHesaplari = hesaplarPrefix(b, GIDER_RE);
  if (!giderHesaplari.length) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Dönemde 7xx gider hareketi yok' };
  const varsayilanYil = b.girdi.range?.start.getUTCFullYear() ?? new Date().getUTCFullYear();
  const bulgular: Bulgu[] = [];
  let incelenen = 0;
  for (const h of giderHesaplari) {
    for (const m of h.hareketler) {
      if (m.taraf !== 'BORC' || m.tutar <= 0) continue;
      incelenen += 1;
      const metin = hareketMetni(h, m);
      const desen = DEMIRBAS_RE.exec(metin);
      if (!desen || DEMIRBAS_HARIC_RE.test(metin)) continue;
      const yil = m.tarih ? m.tarih.getUTCFullYear() : varsayilanYil;
      const sinir = demirbasSiniri(yil);
      if (m.tutar < sinir) continue;
      if (fisteHesapVar(b, m.satir.voucherKey, /^25\d$/, 'borc')) continue; // ayni fiste sabit kiymet kaydi var (montaj vb. gider olabilir)
      bulgular.push({
        severity: 'INFO',
        category: kod,
        message: `${hesapEtiketi(h)}: ${fisKimligi(m.satir)} ${aciklamaMetni(m.satir, 'hesap adına göre demirbaş niteliğinde')} ${fmtTL(m.tutar)} TL doğrudan gider yazılmış; ${yil} yılı doğrudan gider sınırı ${fmtTL(sinir)} TL (KDV hariç). Sınırı aşan iktisadi kıymet 25x hesabına alınıp amortismana tabi tutulmalı.`,
        voucherKey: m.satir.voucherKey,
        rowIndex: m.satir.rowIndex,
        hesapKodu: h.kod,
        detail: { tutar: m.tutar, sinir, yil, desen: desen[0].trim(), aciklama: m.satir.aciklama ?? null, evrakNo: m.satir.evrakNo ?? null, tarih: satirTarihi(m.satir), hesapAdi: h.ad },
      });
    }
  }
  if (!incelenen) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Dönemde 7xx borç satırı yok' };
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [], not: `${incelenen} gider satırında sınırı aşan demirbaş alımı yok` };
  return {
    kod,
    durum: 'BULGU',
    bulgular: ustSinirla(
      bulgular,
      ESIK.UST_SINIR_DUSUK,
      (kalan, toplamAdet) => `Toplam ${toplamAdet} gider satırı demirbaş sınırını aşıyor; en büyük ${toplamAdet - kalan} tanesi listelendi, ${kalan} tanesi daha var.`,
      kod,
    ),
    not: `${incelenen} gider satırının ${bulgular.length} tanesi demirbaş niteliğinde`,
  };
}

// ---------------------------------------------------------------- 10) BRUT_SATIS_ZARARI
export function kuralBrutSatisZarari(b: DenetimBaglami): KuralSonucu {
  const kod = 'BRUT_SATIS_ZARARI';
  if (!b.ozet.mizanVar) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Mizan yok' };
  const smmMizan = mizanHesaplariAna(b, SMM_RE);
  if (!smmMizan.length) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Mizanda SMM hesabı (62x) yok' };
  let brutSatis = 0;
  for (const m of mizanHesaplariAna(b, NET_SATIS_RE)) brutSatis += -m.kapanis;
  let iade = 0;
  for (const m of mizanHesaplariAna(b, SATIS_IADE_RE)) iade += m.kapanis;
  const netSatis = brutSatis - iade;
  const smm = smmMizan.reduce((s, m) => s + m.kapanis, 0);
  if (smm <= 0) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Mizanda SMM (62x) bakiyesi yok' };
  if (netSatis <= 0) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Mizanda net satış yok' };
  if (smm <= netSatis) {
    return { kod, durum: 'TEMIZ', bulgular: [], not: `Brüt kâr ${fmtTL(netSatis - smm)} TL (net satışa oranı %${yuzde(netSatis - smm, netSatis)})` };
  }
  const zarar = smm - netSatis;
  const ilkSmm = hesaplarPrefix(b, SMM_RE)[0];
  const iadeNotu = iade > 0 ? ` (iadeler ${fmtTL(iade)} TL düşüldü)` : '';
  return {
    kod,
    durum: 'BULGU',
    bulgular: [{
      severity: 'INFO',
      category: kod,
      message: `Mizana göre net satış ${fmtTL(netSatis)} TL${iadeNotu}, satılan malın maliyeti (62x) ${fmtTL(smm)} TL: brüt satış zararı ${fmtTL(zarar)} TL (net satışa oranı %${yuzde(zarar, netSatis)}). Fiyatlama, stok/SMM hatası ya da maliyet altı satış olabilir; SMM hesabını ve satış fiyatlarını kontrol edin.`,
      hesapKodu: smmMizan[0].kod,
      voucherKey: ilkSmm?.ilkSatir.voucherKey ?? null,
      rowIndex: ilkSmm?.ilkSatir.rowIndex ?? null,
      detail: { tutar: zarar, netSatis, brutSatis, iade, smm, oran: zarar / netSatis },
    }],
  };
}

export const STOK_GIDER_KURALLARI = [
  kuralSmm621Yok,
  kuralStokKdvOraniUyumsuz,
  kuralStokCiroOrani,
  kuralSabitGiderAyAtlamis,
  kuralAylikHareketKesintisi,
  kuralKrediFaizGideriYok,
  kuralGelecekAy180Aktarim,
  kuralKkegNitelikliGider,
  kuralDemirbasDogrudanGider,
  kuralBrutSatisZarari,
];
