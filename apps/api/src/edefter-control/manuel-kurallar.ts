// MANUEL KURAL MOTORU (2026-09-14) — Muzaffer Bey: "500 sermaye hesabinda bakiye yoksa uyari versin; hareket yoksa;
//   su tutarin ustundeyse / altindaysa gibi kriterlerle kural eklemek istiyorum" (eski form yalniz tarayiciya yaziyordu,
//   hic calismiyordu). Kurallar sunucuda (tenant) saklanir, analizin sonunda hesap kartlari + Mizan bakiyeleri
//   uzerinde calisir; bulgu kodu `MANUEL:<id>`, alan "Manuel Kurallar", kapsam raporunda gorunur.
//   SAF modul: Prisma yok, tarih yok; jest ile test edilir.
import type { Bulgu, HesapKarti, KuralKapsami, MizanBaglami, Siddet } from './hesap-davranis/tipler';
import type { KuralTanimi } from './kural-katalogu';

export const MANUEL_ONEK = 'MANUEL:';
export const MANUEL_ALAN = 'Manuel Kurallar';

export type ManuelKaynak = 'MIZAN' | 'HAREKET';
export type ManuelDonemKisiti = 'HEPSI' | 'YILLIK' | 'GECICI';
export type ManuelKosul =
  // Mizan bakiyesi (kumulatif, donem sonu)
  | 'BAKIYE_YOK' | 'BAKIYE_VAR' | 'BORC_BAKIYE' | 'ALACAK_BAKIYE' | 'BAKIYE_USTUNDE' | 'BAKIYE_ALTINDA'
  // Donem hareketi (Detay Fis Listesi)
  | 'HAREKET_YOK' | 'HAREKET_VAR' | 'BORC_USTUNDE' | 'BORC_ALTINDA' | 'ALACAK_USTUNDE' | 'ALACAK_ALTINDA' | 'ADET_ALTINDA';

export type ManuelKural = {
  id: string;
  ad: string;
  aciklama?: string | null;
  seviye: Siddet;
  hesap: string;            // "500" | "320.01" | "120, 320" (virgul/bosluk ile birden fazla onek)
  kaynak: ManuelKaynak;
  kosul: ManuelKosul;
  esik?: number | null;     // USTUNDE/ALTINDA/ADET_ALTINDA icin zorunlu
  herHesapAyri: boolean;    // false: onek toplami tek satir · true: onek altindaki her alt hesap ayri degerlendirilir
  donemKisiti: ManuelDonemKisiti;
  aktif: boolean;
};

export const KOSUL_TANIMLARI: Record<ManuelKosul, { kaynak: ManuelKaynak; ad: string; esikGerekli: boolean }> = {
  BAKIYE_YOK: { kaynak: 'MIZAN', ad: 'mizan bakiyesi yoksa', esikGerekli: false },
  BAKIYE_VAR: { kaynak: 'MIZAN', ad: 'mizan bakiyesi varsa', esikGerekli: false },
  BORC_BAKIYE: { kaynak: 'MIZAN', ad: 'borç bakiyesi veriyorsa', esikGerekli: false },
  ALACAK_BAKIYE: { kaynak: 'MIZAN', ad: 'alacak bakiyesi veriyorsa', esikGerekli: false },
  BAKIYE_USTUNDE: { kaynak: 'MIZAN', ad: 'mizan bakiyesi eşiğin üstündeyse', esikGerekli: true },
  BAKIYE_ALTINDA: { kaynak: 'MIZAN', ad: 'mizan bakiyesi eşiğin altındaysa', esikGerekli: true },
  HAREKET_YOK: { kaynak: 'HAREKET', ad: 'dönemde hareket yoksa', esikGerekli: false },
  HAREKET_VAR: { kaynak: 'HAREKET', ad: 'dönemde hareket varsa', esikGerekli: false },
  BORC_USTUNDE: { kaynak: 'HAREKET', ad: 'dönem borç toplamı eşiğin üstündeyse', esikGerekli: true },
  BORC_ALTINDA: { kaynak: 'HAREKET', ad: 'dönem borç toplamı eşiğin altındaysa', esikGerekli: true },
  ALACAK_USTUNDE: { kaynak: 'HAREKET', ad: 'dönem alacak toplamı eşiğin üstündeyse', esikGerekli: true },
  ALACAK_ALTINDA: { kaynak: 'HAREKET', ad: 'dönem alacak toplamı eşiğin altındaysa', esikGerekli: true },
  ADET_ALTINDA: { kaynak: 'HAREKET', ad: 'dönem hareket adedi eşiğin altındaysa', esikGerekli: true },
};

export const SEVIYELER: Siddet[] = ['ERROR', 'WARN', 'INFO'];
export const KAYNAKLAR: ManuelKaynak[] = ['MIZAN', 'HAREKET'];
export const DONEM_KISITLARI: ManuelDonemKisiti[] = ['HEPSI', 'YILLIK', 'GECICI'];

const SIFIR = 0.005;
const TR = 'tr-TR';
const fmtTL = (n: number) => Math.abs(n).toLocaleString(TR, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtAdet = (n: number) => n.toLocaleString(TR, { maximumFractionDigits: 0 });

// "500, 320.01 120" → ["500", "320.01", "120"] (buyuk harf; Turkce karakterli cari kodlari da kapsar)
export function hesapOnekleri(hesap: string): string[] {
  return String(hesap || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLocaleUpperCase(TR))
    .filter(Boolean);
}

// Kod oneke uyar mi: birebir · "onek." ile baslar · onek noktasizsa (ana/grup) kod onekle baslar (500 → 500.01.001; 50 → 500, 501...)
export function kodEslesir(kod: string, onek: string): boolean {
  const k = String(kod || '').toLocaleUpperCase(TR);
  if (!k || !onek) return false;
  if (k === onek || k.startsWith(`${onek}.`)) return true;
  return !onek.includes('.') && k.startsWith(onek);
}

// Kural dogrulamasi — ekran ve API ayni mesajlari kullanir. Hata yoksa bos dizi.
export function manuelKuralDogrula(k: Partial<ManuelKural>): string[] {
  const hatalar: string[] = [];
  if (!String(k.ad || '').trim()) hatalar.push('Kural adı boş olamaz');
  if (String(k.ad || '').trim().length > 120) hatalar.push('Kural adı 120 karakteri geçemez');
  if (!SEVIYELER.includes(k.seviye as Siddet)) hatalar.push('Seviye Hata / Uyarı / Bilgi olmalı');
  const onekler = hesapOnekleri(String(k.hesap || ''));
  if (!onekler.length) hatalar.push('Hesap kodu boş olamaz (örn. 500 veya 320.01)');
  for (const o of onekler) if (!/^[0-9]{1,3}(\.[0-9A-ZÇĞİÖŞÜ]+)*$/.test(o)) hatalar.push(`Hesap kodu geçersiz: ${o}`);
  if (!KAYNAKLAR.includes(k.kaynak as ManuelKaynak)) hatalar.push('Kaynak Mizan bakiyesi ya da Dönem hareketi olmalı');
  const kosul = KOSUL_TANIMLARI[k.kosul as ManuelKosul];
  if (!kosul) hatalar.push('Koşul seçilmeli');
  else if (k.kaynak && kosul.kaynak !== k.kaynak) hatalar.push('Koşul seçilen kaynağa uymuyor');
  if (kosul?.esikGerekli) {
    const e = k.esik == null ? Number.NaN : Number(k.esik);
    if (!Number.isFinite(e) || e < 0) hatalar.push('Bu koşul için eşik (0 veya daha büyük bir sayı) gerekli');
  }
  if (k.donemKisiti != null && !DONEM_KISITLARI.includes(k.donemKisiti)) hatalar.push('Dönem kısıtı geçersiz');
  return hatalar;
}

// Kuralin ekranda okunan cumlesi: "500 hesabında mizan bakiyesi yoksa (eşik 250.000,00 TL) → her alt hesap ayrı"
export function manuelKuralCumlesi(k: Pick<ManuelKural, 'hesap' | 'kosul' | 'esik' | 'herHesapAyri' | 'donemKisiti'>): string {
  const t = KOSUL_TANIMLARI[k.kosul];
  const onekler = hesapOnekleri(k.hesap);
  const hesapYazi = onekler.length > 1 ? `${onekler.join(', ')} hesaplarında` : `${onekler[0] || '?'} hesabında`;
  const kosulYazi = t ? t.ad : k.kosul;
  const esikYazi = t?.esikGerekli && k.esik != null
    ? (k.kosul === 'ADET_ALTINDA' ? ` (eşik ${fmtAdet(Number(k.esik))} hareket)` : ` (eşik ${fmtTL(Number(k.esik))} TL)`)
    : '';
  const ayriYazi = k.herHesapAyri ? ' — her alt hesap ayrı' : '';
  const donemYazi = k.donemKisiti === 'YILLIK' ? ' — yalnız yıllık' : k.donemKisiti === 'GECICI' ? ' — yalnız geçici vergi' : '';
  return `${hesapYazi} ${kosulYazi}${esikYazi}${ayriYazi}${donemYazi}`;
}

// Katalog girdisi — ekran gruplama/etiket/mizanGerekli buradan; rule-settings `catalog` yanitina eklenir.
export function manuelKuralTanimi(k: ManuelKural): KuralTanimi {
  const cumle = manuelKuralCumlesi(k);
  const aciklama = String(k.aciklama || '').trim();
  return {
    kod: MANUEL_ONEK + k.id,
    ad: k.ad,
    aciklama: aciklama ? `${cumle}. ${aciklama}` : cumle,
    oneri: '',
    siddet: k.seviye,
    alan: MANUEL_ALAN,
    mevzuat: 'Ofis kuralı',
    varsayilanAktif: k.aktif,
    mizanGerekli: k.kaynak === 'MIZAN',
    motor: 'MANUEL',
  };
}

export type ManuelGirdi = {
  hesapKartlari: HesapKarti[];   // hesap davranis motorunun yaprak hesap kartlari (donem hareketi + mizan kapanisi)
  mizan: MizanBaglami | null;
  donemTipi?: string | null;
};

type Deger = { kod: string; ad: string; bakiye: number; borc: number; alacak: number; adet: number; varMi: boolean };

// Mizan: onek altindaki degerler. Toplam modunda ana hesap satiri varsa o, yoksa yaprak toplami (cift sayim yok).
function mizanDegerleri(mizan: MizanBaglami, onek: string, herHesapAyri: boolean): Deger[] {
  const kodlar = [...mizan.bakiyeByCode.keys()];
  const ad = (kod: string) => mizan.toplamByCode?.get(kod)?.ad || '';
  const eslesen = kodlar.filter((c) => kodEslesir(c, onek));
  const yapraklar = eslesen.filter((c) => !eslesen.some((o) => o !== c && o.startsWith(`${c}.`)));
  if (herHesapAyri) {
    return yapraklar.map((c) => {
      const t = mizan.toplamByCode?.get(c);
      const b = mizan.bakiyeByCode.get(c) || 0;
      return { kod: c, ad: ad(c), bakiye: b, borc: t?.borc || 0, alacak: t?.alacak || 0, adet: 0, varMi: true };
    });
  }
  if (!eslesen.length) return [{ kod: onek, ad: '', bakiye: 0, borc: 0, alacak: 0, adet: 0, varMi: false }];
  if (mizan.bakiyeByCode.has(onek)) {
    const t = mizan.toplamByCode?.get(onek);
    return [{ kod: onek, ad: ad(onek), bakiye: mizan.bakiyeByCode.get(onek) || 0, borc: t?.borc || 0, alacak: t?.alacak || 0, adet: 0, varMi: true }];
  }
  let bakiye = 0; let borc = 0; let alacak = 0;
  for (const c of yapraklar) {
    bakiye += mizan.bakiyeByCode.get(c) || 0;
    const t = mizan.toplamByCode?.get(c);
    borc += t?.borc || 0; alacak += t?.alacak || 0;
  }
  return [{ kod: onek, ad: '', bakiye, borc, alacak, adet: 0, varMi: true }];
}

// Donem hareketi: hesap kartlari (yaprak). Toplam modunda onek altindaki kartlar toplanir.
function hareketDegerleri(kartlar: HesapKarti[], onek: string, herHesapAyri: boolean): Deger[] {
  const eslesen = kartlar.filter((h) => kodEslesir(h.kod, onek));
  const kartDeger = (h: HesapKarti): Deger => ({
    kod: h.kod, ad: h.ad || '', bakiye: h.kapanis ?? h.mizanKapanis ?? 0, borc: h.borc, alacak: h.alacak, adet: h.borcAdet + h.alacakAdet, varMi: true,
  });
  if (herHesapAyri) return eslesen.map(kartDeger);
  if (!eslesen.length) return [{ kod: onek, ad: '', bakiye: 0, borc: 0, alacak: 0, adet: 0, varMi: false }];
  const toplam = eslesen.reduce((s, h) => ({ borc: s.borc + h.borc, alacak: s.alacak + h.alacak, adet: s.adet + h.borcAdet + h.alacakAdet }), { borc: 0, alacak: 0, adet: 0 });
  const tek = eslesen.length === 1 ? eslesen[0] : null;
  return [{ kod: tek ? tek.kod : onek, ad: tek?.ad || '', bakiye: 0, borc: toplam.borc, alacak: toplam.alacak, adet: toplam.adet, varMi: true }];
}

// Kosul degerlendirmesi: bulgu uretilecekse mesaj + tutar, degilse null.
function degerlendir(k: ManuelKural, d: Deger): { olgu: string; tutar: number } | null {
  const esik = Number(k.esik ?? 0);
  const b = d.bakiye;
  switch (k.kosul) {
    case 'BAKIYE_YOK': return Math.abs(b) < SIFIR ? { olgu: d.varMi ? 'mizan bakiyesi yok (sıfır)' : 'mizanda hesap yok, bakiye yok', tutar: 0 } : null;
    case 'BAKIYE_VAR': return Math.abs(b) >= SIFIR ? { olgu: `mizan bakiyesi var: ${fmtTL(b)} TL ${b > 0 ? 'borç' : 'alacak'}`, tutar: Math.abs(b) } : null;
    case 'BORC_BAKIYE': return b > SIFIR ? { olgu: `borç bakiyesi veriyor: ${fmtTL(b)} TL`, tutar: b } : null;
    case 'ALACAK_BAKIYE': return b < -SIFIR ? { olgu: `alacak bakiyesi veriyor: ${fmtTL(b)} TL`, tutar: Math.abs(b) } : null;
    case 'BAKIYE_USTUNDE': return Math.abs(b) > esik ? { olgu: `mizan bakiyesi ${fmtTL(b)} TL, eşik ${fmtTL(esik)} TL üstünde`, tutar: Math.abs(b) } : null;
    case 'BAKIYE_ALTINDA': return Math.abs(b) < esik ? { olgu: `mizan bakiyesi ${fmtTL(b)} TL, eşik ${fmtTL(esik)} TL altında`, tutar: Math.abs(b) } : null;
    case 'HAREKET_YOK': return d.adet === 0 ? { olgu: d.varMi ? 'dönemde hareket yok' : 'dönemde hareket yok (hesap defterde ve mizanda görünmüyor)', tutar: 0 } : null;
    case 'HAREKET_VAR': return d.adet > 0 ? { olgu: `dönemde ${fmtAdet(d.adet)} hareket var (borç ${fmtTL(d.borc)} / alacak ${fmtTL(d.alacak)} TL)`, tutar: Math.max(d.borc, d.alacak) } : null;
    case 'BORC_USTUNDE': return d.borc > esik ? { olgu: `dönem borç toplamı ${fmtTL(d.borc)} TL, eşik ${fmtTL(esik)} TL üstünde`, tutar: d.borc } : null;
    case 'BORC_ALTINDA': return d.borc < esik ? { olgu: `dönem borç toplamı ${fmtTL(d.borc)} TL, eşik ${fmtTL(esik)} TL altında`, tutar: d.borc } : null;
    case 'ALACAK_USTUNDE': return d.alacak > esik ? { olgu: `dönem alacak toplamı ${fmtTL(d.alacak)} TL, eşik ${fmtTL(esik)} TL üstünde`, tutar: d.alacak } : null;
    case 'ALACAK_ALTINDA': return d.alacak < esik ? { olgu: `dönem alacak toplamı ${fmtTL(d.alacak)} TL, eşik ${fmtTL(esik)} TL altında`, tutar: d.alacak } : null;
    case 'ADET_ALTINDA': return d.adet < esik ? { olgu: `dönemde ${fmtAdet(d.adet)} hareket var, eşik ${fmtAdet(esik)} altında`, tutar: Math.max(d.borc, d.alacak) } : null;
    default: return null;
  }
}

function donemUygunMu(kisit: ManuelDonemKisiti, donemTipi?: string | null): boolean {
  const t = String(donemTipi || '').toUpperCase();
  if (kisit === 'YILLIK') return t === 'YILLIK';
  if (kisit === 'GECICI') return t.startsWith('GECICI');
  return true;
}

// Tum manuel kurallari calistirir: bulgular (servis dogrudan push eder) + kapsam satirlari (kural basina bir).
export function manuelKurallariCalistir(kurallar: ManuelKural[], g: ManuelGirdi): { bulgular: Bulgu[]; kapsam: KuralKapsami[] } {
  const bulgular: Bulgu[] = [];
  const kapsam: KuralKapsami[] = [];
  for (const k of kurallar) {
    const kod = MANUEL_ONEK + k.id;
    if (!k.aktif) { kapsam.push({ kod, durum: 'PASIF', bulgu: 0, not: 'Kural kapalı' }); continue; }
    if (!donemUygunMu(k.donemKisiti, g.donemTipi)) {
      kapsam.push({ kod, durum: 'UYGULANMAZ', bulgu: 0, not: k.donemKisiti === 'YILLIK' ? 'Yalnız yıllık defterde' : 'Yalnız geçici vergi döneminde' });
      continue;
    }
    if (k.kaynak === 'MIZAN' && !g.mizan?.found) { kapsam.push({ kod, durum: 'VERI_YOK', bulgu: 0, not: 'Mizan yok' }); continue; }
    const onekler = hesapOnekleri(k.hesap);
    let n = 0;
    for (const onek of onekler) {
      const degerler = k.kaynak === 'MIZAN' ? mizanDegerleri(g.mizan!, onek, k.herHesapAyri) : hareketDegerleri(g.hesapKartlari, onek, k.herHesapAyri);
      for (const d of degerler) {
        const s = degerlendir(k, d);
        if (!s) continue;
        n += 1;
        const bas = d.ad ? `${d.kod} ${d.ad}: ` : `${d.kod}: `;
        bulgular.push({
          severity: k.seviye,
          category: kod,
          message: `${bas}${s.olgu}. Ofis kuralı: ${k.ad}.`,
          hesapKodu: d.kod,
          detail: {
            manuel: true, kuralId: k.id, kosul: k.kosul, kaynak: k.kaynak, esik: k.esik ?? null,
            tutar: s.tutar, hesapAdi: d.ad || undefined, bakiye: d.bakiye, borc: d.borc, alacak: d.alacak, adet: d.adet,
          },
        });
      }
    }
    kapsam.push({ kod, durum: n > 0 ? 'BULGU' : 'TEMIZ', bulgu: n, not: `${onekler.join(', ')} · ${KOSUL_TANIMLARI[k.kosul]?.ad || k.kosul}` });
  }
  return { bulgular, kapsam };
}
