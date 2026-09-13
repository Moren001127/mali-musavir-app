// HESAP DAVRANIS DENETIMI — Gelir (600/610), KDV (191/391/190/360) ve fis bicimi kontrolleri.
//   Gercek musavir bakisi: satis fisinde KDV hesaplanmis mi, iadede KDV duzeltilmis mi, KDV tahakkukunda
//   devreden ile odenecek ayni anda cikmis mi, ayni cari+belge no+tutar iki fiste mi (mukerrer),
//   fisler belge tarihine gore mi yoksa ay sonunda toplu mu isleniyor.
import type { ParsedEDefterFisLine } from '../../edefter-fis-listesi-parser.service';
import { ESIK } from '../esikler';
import { anaKod, fmtTL, fmtTarih, gecerliTarih, hesapEtiketi, normalizeMetin, satirMetni, ustSinirla, yuzde } from '../istatistik';
import type { Bulgu, DenetimBaglami, KuralSonucu } from '../tipler';

// ---------------------------------------------------------------- fis yardimcilari (bu dosyaya ozel)
function fisMetni(rows: ParsedEDefterFisLine[]): string {
  return normalizeMetin(rows.map((r) => satirMetni(r)).join(' '));
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
function satirTutar(r: ParsedEDefterFisLine, taraf: 'BORC' | 'ALACAK'): number {
  return Number((taraf === 'BORC' ? r.borc : r.alacak) || 0);
}
function fisToplam(rows: ParsedEDefterFisLine[], ana: RegExp, taraf: 'BORC' | 'ALACAK'): number {
  let t = 0;
  for (const r of rows) if (ana.test(anaKod(r.hesapKodu))) t += satirTutar(r, taraf);
  return t;
}
function fisSatiri(rows: ParsedEDefterFisLine[], ana: RegExp, taraf: 'BORC' | 'ALACAK'): ParsedEDefterFisLine | undefined {
  return rows.find((r) => ana.test(anaKod(r.hesapKodu)) && satirTutar(r, taraf) > 0);
}
function fisCapasi(r: ParsedEDefterFisLine): Pick<Bulgu, 'voucherKey' | 'rowIndex' | 'hesapKodu'> {
  return { voucherKey: r.voucherKey, rowIndex: r.rowIndex, hesapKodu: r.hesapKodu ?? null };
}
function satirEtiketi(r: ParsedEDefterFisLine): string {
  return hesapEtiketi({ kod: String(r.hesapKodu || ''), ad: String(r.hesapAdi || '') });
}

// KDV aranmayan satis/iade: istisna, ihracat, tevkifat, serbest bolge… (aksansiz; "kdv'siz" → "kdv siz")
const KDV_ISTISNA_METNI = /istisna|ihracat|ihrac|kdv siz|kdvsiz|tevkifat|serbest bolge|muaf|transit|hizmet ihraci|yolcu beraberi|kdv den istisna|3065/;
// Acilis/kapanis/yansitma/devir fisleri satis fisi degildir
const DONEM_FISI_METNI = /acilis|kapanis|yansitma|devir/;
// Satis fisi kaniti: karsi tarafta cari/para/avans hesabi (600 ↔ 690 kapanis virmani degil)
const SATIS_KARSILIK = /^(100|101|102|108|120|121|127|131|136|320|340)$/;

// ---------------------------------------------------------------- 1) Satis fisinde KDV yok
export function kuralSatisKdvYok(b: DenetimBaglami): KuralSonucu {
  const kod = 'SATIS_KDV_YOK';
  const bulgular: Bulgu[] = [];
  let satisFisi = 0;
  for (const rows of b.fisler.values()) {
    const satisSatiri = fisSatiri(rows, /^600$/, 'ALACAK');
    if (!satisSatiri) continue;
    satisFisi += 1;
    const tutar = fisToplam(rows, /^600$/, 'ALACAK');
    if (tutar < ESIK.SATIS_KDV_YOK_MIN_TUTAR) continue;
    if (fisToplam(rows, /^391$/, 'ALACAK') > 0) continue;
    const metin = fisMetni(rows);
    if (KDV_ISTISNA_METNI.test(metin) || DONEM_FISI_METNI.test(metin)) continue;
    const karsilik = rows.find((r) => SATIS_KARSILIK.test(anaKod(r.hesapKodu)) && satirTutar(r, 'BORC') > 0);
    if (!karsilik) continue; // cari/para karsiligi yoksa satis fisi oldugu kanitlanamiyor
    bulgular.push({
      severity: 'WARN',
      category: kod,
      message: `${fisEtiketi(rows)}: ${satirEtiketi(satisSatiri)} hesabına ${fmtTL(tutar)} TL satış işlenmiş (karşılığı ${satirEtiketi(karsilik)}) ama fişte hesaplanan KDV (391) yok; açıklamada istisna/ihracat/tevkifat ibaresi de yok. KDV hesaplanması gerekiyorsa fişi düzeltin; istisna ise açıklamaya işleyin.`,
      ...fisCapasi(satisSatiri),
      detail: { tutar, karsilikHesap: karsilik.hesapKodu, hesapAdi: satisSatiri.hesapAdi },
    });
  }
  if (!satisFisi) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Dönemde 600 satış kaydı yok' };
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [], not: `${satisFisi} satış fişi incelendi` };
  return {
    kod,
    durum: 'BULGU',
    bulgular: ustSinirla(bulgular, ESIK.UST_SINIR_STANDART, (kalan, toplam) => `${toplam} satış fişinde KDV yok; en büyük ${toplam - kalan} tanesi listelendi, ${kalan} tanesi daha var.`, kod),
  };
}

// ---------------------------------------------------------------- 2) Satis iadesinde KDV duzeltmesi yok
export function kuralIadeKdvDuzeltmeYok(b: DenetimBaglami): KuralSonucu {
  const kod = 'IADE_610_KDV_DUZELTME_YOK';
  const bulgular: Bulgu[] = [];
  let iadeFisi = 0;
  for (const rows of b.fisler.values()) {
    const iadeSatiri = fisSatiri(rows, /^61[012]$/, 'BORC');
    if (!iadeSatiri) continue;
    iadeFisi += 1;
    const tutar = fisToplam(rows, /^61[012]$/, 'BORC');
    if (tutar <= 1) continue;
    // KDV duzeltmesi: 391 borc (asil yol) ya da 191 borc (beyannamede indirim satirina yazan uygulama)
    if (fisToplam(rows, /^(391|191)$/, 'BORC') > 0) continue;
    const metin = fisMetni(rows);
    if (KDV_ISTISNA_METNI.test(metin) || DONEM_FISI_METNI.test(metin)) continue;
    bulgular.push({
      severity: 'INFO',
      category: kod,
      message: `${fisEtiketi(rows)}: ${satirEtiketi(iadeSatiri)} hesabına ${fmtTL(tutar)} TL iade/indirim işlenmiş ama fişte KDV düzeltmesi (391 borç) yok. İade faturasındaki KDV'yi 391 borç olarak işleyin; istisna/ihracat iadesiyse açıklamaya yazın.`,
      ...fisCapasi(iadeSatiri),
      detail: { tutar, hesapAdi: iadeSatiri.hesapAdi },
    });
  }
  if (!iadeFisi) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Dönemde satış iadesi/indirimi (610-612 borç) yok' };
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [], not: `${iadeFisi} iade fişi incelendi` };
  return {
    kod,
    durum: 'BULGU',
    bulgular: ustSinirla(bulgular, ESIK.UST_SINIR_DUSUK, (kalan, toplam) => `${toplam} iade fişinde KDV düzeltmesi yok; ${kalan} tanesi daha listelenmedi.`, kod),
  };
}

// ---------------------------------------------------------------- 3) Ayni ayda hem devreden hem odenecek KDV
// KDV tahakkuk fisi = 391 borc + 191 alacak birlikte. 360 satirinin KDV'ye ait oldugu ad/aciklamadan anlasilir;
//   sorumlu sifatiyla (KDV-2) satiri ayri beyannamedir, sayilmaz.
const KDV_360_METNI = /kdv|katma deger/;
const KDV_360_DISI_METNI = /sorumlu|kdv 2|kdv2|2 no|tevkifat|stopaj|muhtasar|gelir vergisi|damga|gecici|kurumlar|mtv/;

export function kuralKdvDevredenVeOdenecekAyniAy(b: DenetimBaglami): KuralSonucu {
  const kod = 'KDV_DEVREDEN_VE_ODENECEK_AYNI_AY';
  const bulgular: Bulgu[] = [];
  let tahakkukFisi = 0;
  for (const rows of b.fisler.values()) {
    if (fisToplam(rows, /^391$/, 'BORC') <= 0 || fisToplam(rows, /^191$/, 'ALACAK') <= 0) continue;
    tahakkukFisi += 1;
    const devredenSatiri = fisSatiri(rows, /^190$/, 'BORC');
    if (!devredenSatiri) continue;
    const devreden = fisToplam(rows, /^190$/, 'BORC');
    const fisKdvMi = /kdv|katma deger/.test(fisMetni(rows));
    const odenecekSatirlari = rows.filter((r) => {
      if (anaKod(r.hesapKodu) !== '360' || satirTutar(r, 'ALACAK') <= 0) return false;
      const metin = normalizeMetin(`${r.hesapAdi || ''} ${r.aciklama || ''}`);
      if (KDV_360_DISI_METNI.test(metin)) return false;
      return KDV_360_METNI.test(metin) || fisKdvMi;
    });
    if (!odenecekSatirlari.length) continue;
    const odenecek = odenecekSatirlari.reduce((s, r) => s + satirTutar(r, 'ALACAK'), 0);
    const odenecekSatiri = odenecekSatirlari[0];
    bulgular.push({
      severity: 'WARN',
      category: kod,
      message: `${fisEtiketi(rows)} (KDV tahakkuku): hem ${satirEtiketi(devredenSatiri)} hesabına ${fmtTL(devreden)} TL devreden KDV hem ${satirEtiketi(odenecekSatiri)} hesabına ${fmtTL(odenecek)} TL ödenecek KDV yazılmış; aynı ayda ikisi birlikte olamaz. Tahakkuk fişini beyannameyle karşılaştırıp düzeltin.`,
      ...fisCapasi(odenecekSatiri),
      detail: { tutar: odenecek, devreden, odenecek, hesapAdi: odenecekSatiri.hesapAdi },
    });
  }
  if (!tahakkukFisi) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'KDV tahakkuk fişi (391 borç + 191 alacak) yok' };
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [], not: `${tahakkukFisi} KDV tahakkuk fişi incelendi` };
  return {
    kod,
    durum: 'BULGU',
    bulgular: ustSinirla(bulgular, ESIK.UST_SINIR_DUSUK, (kalan, toplam) => `${toplam} tahakkuk fişinde devreden ve ödenecek KDV birlikte; ${kalan} tanesi daha listelenmedi.`, kod),
  };
}

// ---------------------------------------------------------------- 4) Mukerrer fatura (cari + belge no + tutar)
const BELGE_NO_ANLAMSIZ = /^(MUHTELIF|NAKIT|BELGESIZ|YOK|DIGER|OTHER)/;
const IADE_FISI_METNI = /iade|iptal|ters kayit|duzeltme/;

// Belge no normalizasyonu: buyuk harf, bosluk/noktalama yok; anlamsiz/kisa numaralar null
export function normalizeBelgeNo(value?: string | null): string | null {
  const ham = String(value ?? '').trim();
  if (!ham) return null;
  const n = normalizeMetin(ham).replace(/[^a-z0-9]/g, '').toUpperCase();
  if (n.length < 5) return null;
  if (BELGE_NO_ANLAMSIZ.test(n)) return null;
  if (/^\d+$/.test(n) && n.length < 6) return null;
  return n;
}

type MukerrerGrup = { fisler: Map<string, ParsedEDefterFisLine>; ilk: ParsedEDefterFisLine; tutar: number; belgeNo: string; taraf: 'BORC' | 'ALACAK' };

export function kuralMukerrerFaturaCariBazli(b: DenetimBaglami): KuralSonucu {
  const kod = 'MUKERRER_FATURA_CARI_BAZLI';
  const gruplar = new Map<string, MukerrerGrup>();
  let cariSatiri = 0;
  let belgeli = 0;
  const iadeFisleri = new Map<string, boolean>();
  const iadeMi = (key: string): boolean => {
    let v = iadeFisleri.get(key);
    if (v == null) { v = IADE_FISI_METNI.test(fisMetni(b.fisler.get(key) || [])); iadeFisleri.set(key, v); }
    return v;
  };
  for (const r of b.girdi.rows) {
    const ana = anaKod(r.hesapKodu);
    if (ana !== '120' && ana !== '320') continue;
    const borc = satirTutar(r, 'BORC');
    const alacak = satirTutar(r, 'ALACAK');
    const taraf: 'BORC' | 'ALACAK' | null = borc > 0 ? 'BORC' : alacak > 0 ? 'ALACAK' : null;
    if (!taraf) continue;
    cariSatiri += 1;
    const belgeNo = normalizeBelgeNo(r.evrakNo);
    if (!belgeNo) continue;
    belgeli += 1;
    if (iadeMi(r.voucherKey)) continue;
    const tutar = taraf === 'BORC' ? borc : alacak;
    // Yon anahtara dahil: fatura (120 borc) ile ayni belge no'lu tahsilat (120 alacak) mukerrer degildir
    const anahtar = `${String(r.hesapKodu).trim()}|${belgeNo}|${taraf}|${tutar.toFixed(2)}`;
    let g = gruplar.get(anahtar);
    if (!g) { g = { fisler: new Map(), ilk: r, tutar, belgeNo, taraf }; gruplar.set(anahtar, g); }
    if (!g.fisler.has(r.voucherKey)) g.fisler.set(r.voucherKey, r);
  }
  if (!cariSatiri) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Dönemde 120/320 hareketi yok' };
  if (!belgeli) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Cari satırlarında kullanılabilir belge numarası yok' };
  const bulgular: Bulgu[] = [];
  for (const g of gruplar.values()) {
    if (g.fisler.size < 2) continue;
    const fisListesi = [...g.fisler.values()].map((r) => {
      const t = gecerliTarih(r.fisTarihi) ? fmtTarih(r.fisTarihi) : 'tarihsiz';
      return r.fisNo ? `${t} fiş ${r.fisNo}` : t;
    });
    const alici = anaKod(g.ilk.hesapKodu) === '120';
    const yon = (alici && g.taraf === 'BORC') || (!alici && g.taraf === 'ALACAK') ? 'fatura' : 'tahsilat/ödeme';
    bulgular.push({
      severity: 'ERROR',
      category: kod,
      message: `${satirEtiketi(g.ilk)}: ${g.ilk.evrakNo} no.lu belge ${fmtTL(g.tutar)} TL ile ${g.fisler.size} ayrı fişte işlenmiş (${fisListesi.join('; ')}). Mükerrer ${yon} kaydı olabilir; KDV mükerrer indirilmiş/hesaplanmış olabilir, fişlerden birini iptal edin.`,
      ...fisCapasi(g.ilk),
      detail: { tutar: g.tutar, belgeNo: g.belgeNo, evrakNo: g.ilk.evrakNo, fisSayisi: g.fisler.size, fisler: [...g.fisler.keys()], taraf: g.taraf, hesapAdi: g.ilk.hesapAdi },
    });
  }
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [], not: `${belgeli} belgeli cari satırı incelendi` };
  return {
    kod,
    durum: 'BULGU',
    bulgular: ustSinirla(bulgular, ESIK.UST_SINIR_STANDART, (kalan, toplam) => `${toplam} mükerrer belge var; en büyük ${toplam - kalan} tanesi listelendi, ${kalan} tanesi daha var.`, kod),
  };
}

// ---------------------------------------------------------------- 5) Fisler ay sonuna yigilmis
const AY_SONU_HARIC_METNI = /acilis|kapanis|tahakkuk|yansitma|amortisman|bordro|personel/;
const AY_SONU_MIN_FIS = 30;
const AY_SONU_ORAN = 0.6;

function ayinSonGunuMu(t: Date): boolean {
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate() === t.getUTCDate();
}

export function kuralFisTarihiAySonuYigilma(b: DenetimBaglami): KuralSonucu {
  const kod = 'FIS_TARIHI_AY_SONU_YIGILMA';
  let toplam = 0;
  let aySonu = 0;
  let aySonuTutar = 0;
  let ilk: ParsedEDefterFisLine | null = null;
  for (const rows of b.fisler.values()) {
    const t = fisTarihi(rows);
    if (!t) continue;
    if (AY_SONU_HARIC_METNI.test(fisMetni(rows))) continue;
    toplam += 1;
    if (!ayinSonGunuMu(t)) continue;
    aySonu += 1;
    aySonuTutar += rows.reduce((s, r) => s + satirTutar(r, 'BORC'), 0);
    if (!ilk) ilk = rows[0];
  }
  if (toplam < AY_SONU_MIN_FIS) return { kod, durum: 'VERI_YOK', bulgular: [], not: `Değerlendirmeye yetecek tarihli fiş yok (${toplam} < ${AY_SONU_MIN_FIS})` };
  const oran = aySonu / toplam;
  if (oran < AY_SONU_ORAN) return { kod, durum: 'TEMIZ', bulgular: [], not: `${toplam} fişin %${yuzde(aySonu, toplam)}'i ay sonu tarihli` };
  return {
    kod,
    durum: 'BULGU',
    bulgular: [{
      severity: 'INFO',
      category: kod,
      message: `Tarihli ${toplam} fişin ${aySonu} tanesi (%${yuzde(aySonu, toplam)}) ayın son gününe tarihlenmiş (açılış/kapanış/tahakkuk/bordro fişleri hariç). Kayıtlar belge tarihine göre değil ay sonunda toplu işleniyor görünüyor; kayıt süresi aşılmasın diye belge tarihine göre işleyin.`,
      voucherKey: ilk?.voucherKey ?? null,
      rowIndex: ilk?.rowIndex ?? null,
      hesapKodu: null,
      detail: { tutar: aySonuTutar, toplamFis: toplam, aySonuFis: aySonu, oran },
    }],
  };
}

export const GELIR_KDV_KURALLARI = [
  kuralSatisKdvYok,
  kuralIadeKdvDuzeltmeYok,
  kuralKdvDevredenVeOdenecekAyniAy,
  kuralMukerrerFaturaCariBazli,
  kuralFisTarihiAySonuYigilma,
];
