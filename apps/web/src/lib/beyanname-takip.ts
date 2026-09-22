import { api } from './api';

export type Period = 'AYLIK' | 'UCAYLIK' | null;
export type DonemTuru = 'VERILME' | 'VERGI';
export type BeyanTipi =
  | 'KURUMLAR' | 'GELIR' | 'KDV1' | 'KDV2'
  | 'KDV4' | 'KDV9015' | 'DAMGA' | 'MUHSGK' | 'MUHSGK2'
  | 'GGECICI' | 'KGECICI' | 'POSET' | 'BILDIRGE' | 'EDEFTER'
  | 'OTV1' | 'OTV3A' | 'OTV3B' | 'OTV4'
  | 'KONAKLAMA' | 'OIV' | 'GMSI' | 'TURIZM';

export type BeyanDurum = 'beklemede' | 'onaylandi' | 'hatali' | 'muaf' | 'kalan';

export const BEYAN_ETIKETLER: Record<BeyanTipi, string> = {
  KURUMLAR: 'Kurumlar',
  GELIR:    'Gelir',
  KDV1:     'KDV1',
  KDV2:     'KDV2',
  KDV4:     'KDV4',
  KDV9015:  'KDV9015',
  DAMGA:    'Damga',
  MUHSGK:   'MUHSGK',
  MUHSGK2:  'MUHSGK2',
  GGECICI:  'Gelir Geçici',
  KGECICI:  'Kurum Geçici',
  POSET:    'Poşet',
  BILDIRGE: 'Bildirge',
  EDEFTER:  'E-Defter',
  OTV1:     'ÖTV1',
  OTV3A:    'ÖTV3A',
  OTV3B:    'ÖTV3B',
  OTV4:     'ÖTV4',
  KONAKLAMA:'Konaklama',
  OIV:      'ÖİV',
  GMSI:     'GMSİ',
  TURIZM:   'Turizm Payı',
};

export interface TaxpayerBeyanConfig {
  incomeTaxType: 'KURUMLAR' | 'GELIR' | 'BASIT_USUL' | null;
  kdv1Period: Period;
  kdv2Enabled: boolean;
  kdv4Period?: Period;
  kdv9015Period?: Period;
  muhtasarPeriod: Period;
  muhtasar2Period?: Period;
  gelirGeciciPeriod?: Period;
  kurumGeciciPeriod?: Period;
  otv1Period?: Period;
  otv3aPeriod?: Period;
  otv3bPeriod?: Period | 'ON_BES_GUNLUK';
  otv4Period?: Period;
  damgaEnabled: boolean;
  posetEnabled: boolean;
  sgkBildirgeEnabled: boolean;
  konaklamaEnabled?: boolean;
  oivEnabled?: boolean;
  gmsiEnabled?: boolean;
  turizmPeriod?: Period;
  eDefterPeriod: Period;
  /** e-Defter mükellefiyetinin başladığı ay "YYYY-MM" (Hattat "Başlangıç"); null = sınırsız */
  eDefterBaslangic?: string | null;
  notes: string | null;
}

export interface ConfigRow {
  taxpayerId: string;
  ad: string;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  config: TaxpayerBeyanConfig;
}

export interface OzetRow {
  beyanTipi: BeyanTipi;
  vergiDonem: string;
  /** O ay takibe düşen dönem anahtarları (tekrarsız). e-Defter'de birden çok olabilir: ['2026-05', '2026-Q2']. */
  donemler?: string[];
  toplam: number;
  onaylanan: number;
  bekleyen: number;
  hatali: number;
  muaf: number;
  kalan: number;
  yuzde: number;
}

export interface OzetResponse {
  donem: string;
  donemTuru: DonemTuru;
  rows: OzetRow[];
}

export interface DetayRow {
  taxpayerId: string;
  ad: string;
  beyanlar: Array<{
    beyanTipi: BeyanTipi;
    durum: BeyanDurum;
    vergiDonem: string;
    tahakkukTutari: number | null;
    onayTarihi: string | null;
  }>;
}

// ── e-Defter berat takibi (GET /beyanname-takip/edefter) ──
export type EDefterTercih = 'AYLIK' | 'UCAYLIK';
export type EDefterTip = 'SAHIS' | 'FIRMA';

export interface EDefterBelge {
  belgeTuru: 'KB' | 'YB' | 'Y' | 'K' | string;
  etiket: string;
  paketId: string;
  islemOid: string | null;
  alinmaZamani: string | null;
  durumKodu: number | null;
  durumAciklama: string | null;
}

export interface EDefterAy {
  ay: string; // "2026-04"
  etiket: string; // "Nisan 2026"
  verildi: boolean;
  belgeler: EDefterBelge[];
}

export interface EDefterDonem {
  donem: string; // "2026-05" | "2026-Q2"
  etiket: string; // "Mayıs 2026" | "Nis–Haz 2026"
  tercih: EDefterTercih;
  tebligTarihi: string;
  sonGun: string; // "2026-09-10"
  uzatildi: boolean;
  uzatmaKaynagi: string | null;
  verildi: boolean;
  elleIsaretli: boolean;
  sonYukleme: string | null;
  aylar: EDefterAy[];
}

export interface EDefterMukellef {
  taxpayerId: string;
  ad: string;
  taxNumber: string | null;
  tip: EDefterTip;
  tipEtiketi: 'Gelir Vergisi' | 'Kurumlar Vergisi';
  tercih: EDefterTercih;
  tercihEtiketi: 'Aylık' | '3 Aylık';
  baslangic: string | null;
  donemler: EDefterDonem[];
  verildi: boolean;
  sonSorgu: { sorguTarihi: string; hata: string | null; paketSayisi: number; kaynak: string } | null;
  sonYukleme: string | null;
}

export interface EDefterDetayYaniti {
  donem: string;
  donemTuru: DonemTuru;
  mukellefler: EDefterMukellef[];
  /** toplam/verilen/kalan = dönem başına (panel tablosuyla aynı sayım); mukellef = blok sayısı */
  ozet: { toplam: number; verilen: number; kalan: number; mukellef: number; verilenMukellef: number };
}

const AYLAR_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const CEYREK_TR = ['Oca–Mar', 'Nis–Haz', 'Tem–Eyl', 'Eki–Ara'];

/** e-Defter dönem anahtarı → kısa etiket: "2026-05" → "Mayıs 2026", "2026-Q2" → "Nis–Haz 2026". */
export function eDefterDonemEtiketi(donem: string): string {
  const ay = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(donem);
  if (ay) return `${AYLAR_TR[parseInt(ay[2], 10) - 1]} ${ay[1]}`;
  const q = /^(\d{4})-Q([1-4])$/.exec(donem);
  if (q) return `${CEYREK_TR[parseInt(q[2], 10) - 1]} ${q[1]}`;
  return donem;
}

/**
 * Panel kartı / tablo notu için tercihe göre gruplanmış dönem çipleri:
 * ['2026-05', '2026-Q2'] → ['Aylık Mayıs 2026', '3 Aylık Nis–Haz 2026']; ['2026-01', '2026-02'] → ['Aylık Ocak, Şubat 2026'].
 */
export function eDefterDonemCipleri(donemler?: string[] | null): string[] {
  const aylik = (donemler || []).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort();
  const ucAylik = (donemler || []).filter((d) => /^\d{4}-Q[1-4]$/.test(d)).sort();
  const birlestir = (anahtarlar: string[]) => {
    // Aynı yıl içindeki aylar tek yıl ekiyle: "Ocak, Şubat 2026"
    const yillar = new Map<string, string[]>();
    for (const k of anahtarlar) {
      const etiket = eDefterDonemEtiketi(k);
      const parcalar = etiket.split(' ');
      const yil = parcalar.pop() as string;
      const ad = parcalar.join(' ');
      yillar.set(yil, [...(yillar.get(yil) || []), ad]);
    }
    return Array.from(yillar.entries()).map(([yil, adlar]) => `${adlar.join(', ')} ${yil}`).join(' · ');
  };
  const cipler: string[] = [];
  if (aylik.length) cipler.push(`Aylık ${birlestir(aylik)}`);
  if (ucAylik.length) cipler.push(`3 Aylık ${birlestir(ucAylik)}`);
  return cipler;
}

// ── Dijital Vergi Dairesi e-Defter sorgusu (POST /portal-automation/dvd-sorgu) ──
export interface DvdSorguYaniti {
  created: Array<{ id: string; taxpayerId: string; jobType: string }>;
  skipped: Array<{ taxpayerId: string; reason: string }>;
  message: string;
}

export interface DvdSorguIsi {
  id: string;
  taxpayerId: string | null;
  jobType: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  payload?: { progress?: { message?: string } } | null;
  errorMessage?: string | null;
  finishedAt?: string | null;
  taxpayer?: { companyName?: string | null; firstName?: string | null; lastName?: string | null } | null;
}

export const beyannameTakipApi = {
  listConfigs: () =>
    api.get<ConfigRow[]>('/beyanname-takip/configs').then((r) => r.data),

  upsertConfig: (taxpayerId: string, cfg: Partial<TaxpayerBeyanConfig>) =>
    api.put<TaxpayerBeyanConfig>(`/beyanname-takip/configs/${taxpayerId}`, cfg).then((r) => r.data),

  listOzet: (donem: string, donemTuru: DonemTuru = 'VERILME') =>
    api.get<OzetResponse>('/beyanname-takip/ozet', { params: { donem, donemTuru } }).then((r) => r.data),

  listDetay: (donem: string, donemTuru: DonemTuru = 'VERILME') =>
    api.get<DetayRow[]>('/beyanname-takip/detay', { params: { donem, donemTuru } }).then((r) => r.data),

  // E-Defter Detayı penceresi: o ay beklenen dönemler + berat paketleri (mükellef bazında)
  edefterDetay: (donem: string, donemTuru: DonemTuru = 'VERILME') =>
    api.get<EDefterDetayYaniti>('/beyanname-takip/edefter', { params: { donem, donemTuru } }).then((r) => r.data),

  // "Sorgula": listedeki e-Defter mükellefleri için Dijital Vergi Dairesi e-Defter sorgusu başlat
  /** e-Defter sorgusu başlat. `eDefterAylar` ("YYYY-MM"[]) verilirse yalnız o aylar sorgulanır; verilmezse arka uç
   *  bugüne göre güncel dönemi seçer (ekrandaki dönem farklıysa MUTLAKA gönderin — 2026-09-22 Haziran hatası). */
  dvdSorguBaslat: (taxpayerIds: string[], eDefterAylar?: string[]) =>
    api.post<DvdSorguYaniti>('/portal-automation/dvd-sorgu', { taxpayerIds, sorgular: ['eDefter'], ...(eDefterAylar?.length ? { eDefterAylar } : {}) }).then((r) => r.data),

  // Sorgu koşuları (5 sn'de bir ilerleme için)
  dvdSorguIsleri: (limit = 50) =>
    api.get<DvdSorguIsi[]>('/portal-automation/jobs', { params: { jobType: 'DVD_SORGU', limit } }).then((r) => r.data),

  upsertDurum: (
    taxpayerId: string,
    beyanTipi: BeyanTipi,
    donem: string,
    data: { durum?: BeyanDurum; tahakkukTutari?: number | null; notlar?: string | null },
  ) =>
    api
      .put(`/beyanname-takip/durum/${taxpayerId}/${beyanTipi}/${donem}`, data)
      .then((r) => r.data),
};
