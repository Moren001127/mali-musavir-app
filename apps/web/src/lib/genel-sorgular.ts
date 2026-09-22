import { api } from './api';
import {
  DVD_SORGU_TURLERI,
  GENEL_SORGU_ETIKETLERI,
  GENEL_SORGU_TURLERI,
  OTOMATIK_SORGU_ETIKETLERI,
  type DvdSorguTuru,
  type EHacizVeri,
  type GelenEArsivVeri,
  type GenelSorguTuru,
  type GenelSorguVeri,
  type PosVeri,
  type VergiBorcuVeri,
  type YoklamaDenetimVeri,
} from '@mali-musavir/shared';
import type { TaxpayerLite } from '@/components/ui/TaxpayerSelect';

/**
 * Genel Sorgulamalar — Dijital Vergi Dairesi'nden mükellef başına yapılan sorguların sonuçları.
 * Tür ve veri şekilleri `@mali-musavir/shared` sözleşmesinden gelir (otomatik-sorgu.ts, genel-sorgu-veri.ts).
 *
 * Uçlar:
 *   GET  /genel-sorgular?taxpayerId=&tur=&donem=YYYY-MM&page=&pageSize=   → sonuç listesi (sayfalı)
 *   GET  /genel-sorgular/ozet                                             → tür başına { adet, sonSorgu }
 *   POST /portal-automation/dvd-sorgu { taxpayerIds?, sorgular }           → elle sorgu (kuyruğa alır)
 *   GET  /portal-automation/jobs?jobType=DVD_SORGU,E_TEBLIGAT_CHECK&limit=  → koşu durumu
 *   GET  /portal-automation/credentials                                    → DVD şifresi olan mükellefler
 *   GET  /portal-automation/documents/:id/view                             → yoklama tutanağı PDF adresi
 * (e-Tebligat sonuçları bu modülde YOK — ayrı modülü var.)
 */

export type SorguTuru = GenelSorguTuru;
export const SORGU_TURLERI: readonly SorguTuru[] = GENEL_SORGU_TURLERI;
export const SORGU_TURU_ADI: Record<SorguTuru, string> = GENEL_SORGU_ETIKETLERI;

export function sorguTuruMu(v: unknown): v is SorguTuru {
  return typeof v === 'string' && (SORGU_TURLERI as readonly string[]).includes(v);
}

/** Elle / gece sorgusunda seçilebilen DVD sorgu türleri (e-Defter dahil; sonucu ayrı tabloda). */
export const DVD_SORGULARI: readonly DvdSorguTuru[] = DVD_SORGU_TURLERI;
export const DVD_SORGU_ADI: Record<DvdSorguTuru, string> = {
  vergiBorcu: 'Vergi Borcu',
  eHaciz: 'e-Haciz',
  yoklama: 'Yoklama ve Denetim Tutanakları',
  pos: 'POS Bilgisi',
  gelenEArsiv: 'Gelen e-Arşiv Fatura',
  eDefter: 'e-Defter',
};
export function dvdSorguMu(v: unknown): v is DvdSorguTuru {
  return typeof v === 'string' && (DVD_SORGULARI as readonly string[]).includes(v);
}
/** Koşu satırında kısa ad (şalter etiketleriyle aynı). */
export const KISA_SORGU_ADI = OTOMATIK_SORGU_ETIKETLERI;

export interface SorguMukellef {
  id: string;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  taxNumber?: string | null;
}

export interface SorguSonucu {
  id: string;
  taxpayerId: string;
  taxpayer?: SorguMukellef | null;
  tur: SorguTuru;
  /** YYYY-MM (vergi borcu / e-haciz / yoklamada boş olabilir) */
  donem?: string | null;
  sorguTarihi: string;
  ozet?: string | null;
  /** Türe göre şekil: VergiBorcuVeri | EHacizVeri | YoklamaDenetimVeri | PosVeri | GelenEArsivVeri */
  veri?: Partial<GenelSorguVeri> | Record<string, unknown> | null;
  kaynak?: 'manual' | 'nightly' | string | null;
  whatsappGonderildiMi?: boolean | null;
}

export interface SorguListesi {
  rows: SorguSonucu[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SorguOzetKalemi {
  adet: number;
  sonSorgu?: string | null;
}
export type SorguOzeti = Partial<Record<SorguTuru, SorguOzetKalemi>>;

export interface SorguListeParams {
  taxpayerId?: string;
  tur?: SorguTuru;
  /** YYYY-MM; boş → tüm dönemler */
  donem?: string;
  page?: number;
  pageSize?: number;
}

// ---- Koşular (portal-automation işleri) ----
export type KosuDurumu = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
export const KOSU_DURUM_ADI: Record<KosuDurumu, string> = {
  pending: 'Kuyrukta',
  running: 'Çalışıyor',
  done: 'Tamamlandı',
  failed: 'Hata',
  cancelled: 'İptal edildi',
};

export interface SorguKosusu {
  id: string;
  taxpayerId: string | null;
  jobType: 'DVD_SORGU' | 'E_TEBLIGAT_CHECK' | string;
  status: KosuDurumu | string;
  source?: 'manual' | 'nightly' | 'agent' | string | null;
  payload?: {
    sorgular?: string[];
    ekSorgular?: string[];
    progress?: { message?: string | null; step?: number | null; total?: number | null } | null;
    [k: string]: unknown;
  } | null;
  result?: { sorguHatalari?: Array<{ sorgu: string; hata: string }>; [k: string]: unknown } | null;
  errorMessage?: string | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  taxpayer?: SorguMukellef | null;
}

export interface SorguBaslatmaSonucu {
  created: Array<{ id: string; taxpayerId: string | null; jobType: string }>;
  skipped: Array<{ taxpayerId?: string | null; jobType?: string; reason: string }>;
  message?: string;
}

/** Görseli eksik fatura satırı (DVD gelen e-Arşiv listesi ↔ Luca alış e-Arşiv/e-Fatura çekimi). */
export interface EksikGorselSatiri {
  taxpayerId: string;
  taxpayer?: SorguMukellef | null;
  donem: string | null;
  sorguTarihi: string;
  faturaNo: string;
  duzenlenmeTarihi: string | null;
  saticiUnvan: string;
  saticiVkn: string;
  toplamTutar: number;
  vergilerTutari: number;
  odenecekTutar: number;
  /** LUCA_YOK: Luca çekiminde hiç yok · GORSEL_YOK: kayıt var, PDF/HTML görseli inmemiş */
  durum: 'LUCA_YOK' | 'GORSEL_YOK';
}
export interface EksikGorselYaniti {
  rows: EksikGorselSatiri[];
  ozet: { dvd: number; lucaVar: number; lucaYok: number; gorselYok: number; sorguSayisi: number };
}
export const EKSIK_DURUM_ADI: Record<EksikGorselSatiri['durum'], string> = { LUCA_YOK: "Luca'da yok", GORSEL_YOK: 'Görsel yok' };

export interface DvdSifresi {
  id: string;
  provider: string;
  ownerType: string;
  ownerId: string;
  taxpayerId?: string | null;
  isActive?: boolean;
  hasPassword?: boolean;
  lastError?: string | null;
}

export const genelSorgularApi = {
  liste: (params: SorguListeParams) =>
    api
      .get('/genel-sorgular', {
        params: {
          taxpayerId: params.taxpayerId || undefined,
          tur: params.tur || undefined,
          donem: params.donem || undefined,
          page: params.page ?? 1,
          pageSize: params.pageSize ?? 50,
        },
      })
      .then((r) => {
        const d = r.data as Partial<SorguListesi> | undefined;
        return {
          rows: Array.isArray(d?.rows) ? d!.rows : [],
          total: Number(d?.total ?? 0) || 0,
          page: Number(d?.page ?? params.page ?? 1) || 1,
          pageSize: Number(d?.pageSize ?? params.pageSize ?? 50) || 50,
        } satisfies SorguListesi;
      }),

  /** Süzgece uyan TÜM satırlar (Excel için) — 200'lük sayfalarla, en çok `tavan` satır. */
  tumunuGetir: async (params: Omit<SorguListeParams, 'page' | 'pageSize'>, tavan = 5000): Promise<SorguSonucu[]> => {
    const hepsi: SorguSonucu[] = [];
    for (let page = 1; hepsi.length < tavan; page++) {
      const s = await genelSorgularApi.liste({ ...params, page, pageSize: 200 });
      hepsi.push(...s.rows);
      if (s.rows.length < 200 || hepsi.length >= s.total) break;
    }
    return hepsi.slice(0, tavan);
  },

  ozet: () => api.get('/genel-sorgular/ozet').then((r) => (r.data ?? {}) as SorguOzeti),

  /** Görseli eksik faturalar: DVD gelen e-Arşiv listesi ↔ Luca'dan inen görselli alış e-Arşiv/e-Fatura. */
  eksikGorseller: (params: { taxpayerId?: string; donem?: string }) =>
    api
      .get('/genel-sorgular/earsiv-eksik', { params: { taxpayerId: params.taxpayerId || undefined, donem: params.donem || undefined } })
      .then((r) => {
        const d = (r.data ?? {}) as Partial<EksikGorselYaniti>;
        return {
          rows: Array.isArray(d.rows) ? d.rows : [],
          ozet: d.ozet ?? { dvd: 0, lucaVar: 0, lucaYok: 0, gorselYok: 0, sorguSayisi: 0 },
        } satisfies EksikGorselYaniti;
      }),

  /** Elle sorgu: mükellef seçilmezse (taxpayerIds yok) DVD şifresi olan tüm mükellefler. */
  sorguBaslat: (govde: { taxpayerIds?: string[]; sorgular: DvdSorguTuru[] }) =>
    api.post('/portal-automation/dvd-sorgu', govde).then((r) => {
      const d = (r.data ?? {}) as Partial<SorguBaslatmaSonucu>;
      return {
        created: Array.isArray(d.created) ? d.created : [],
        skipped: Array.isArray(d.skipped) ? d.skipped : [],
        message: typeof d.message === 'string' ? d.message : undefined,
      } satisfies SorguBaslatmaSonucu;
    }),

  /** DVD sorgu koşuları (elle + gece); en yeni önce. */
  kosular: (limit = 50) =>
    api
      .get('/portal-automation/jobs', { params: { jobType: 'DVD_SORGU,E_TEBLIGAT_CHECK', limit } })
      .then((r) => (Array.isArray(r.data) ? (r.data as SorguKosusu[]) : [])),

  /** Dijital Vergi Dairesi (GIB_IVD) şifresi tanımlı mükellef kimlikleri. */
  dvdSifreliMukellefler: () =>
    api.get('/portal-automation/credentials').then((r) => {
      const rows = (r.data?.rows ?? r.data ?? []) as DvdSifresi[];
      const set = new Set<string>();
      for (const c of Array.isArray(rows) ? rows : []) {
        if (c.provider !== 'GIB_IVD' || c.ownerType !== 'TAXPAYER' || c.isActive === false) continue;
        const id = c.taxpayerId || c.ownerId;
        if (id) set.add(id);
      }
      return set;
    }),

  mukellefler: () => api.get('/taxpayers').then((r) => (Array.isArray(r.data) ? (r.data as TaxpayerLite[]) : [])),

  /** Yoklama tutanağı PDF'i (PortalDocument) → sayfa içi pencerede açılacak adres. */
  tutanakAdresi: (documentId: string) =>
    api.get(`/portal-automation/documents/${documentId}/view`).then((r) => (r.data ?? {}) as { url?: string; viewedAt?: string | null }),
};

/** Mükellef görünen adı: unvan → ad soyad → VKN. */
export function sorguMukellefAdi(t?: SorguMukellef | null): string {
  if (!t) return '';
  return (t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || t.taxNumber || '').trim();
}

/** Sayı/para alanını güvenli sayıya çevirir ("1.234,56" · "1234.56" · 1234.56). */
export function sayiOku(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const temiz = v.replace(/[^\d,.-]/g, '');
    const sonVirgul = temiz.lastIndexOf(',');
    const sonNokta = temiz.lastIndexOf('.');
    let norm = temiz;
    if (sonVirgul > sonNokta) norm = temiz.replace(/\./g, '').replace(',', '.');
    else if (sonNokta > sonVirgul) norm = temiz.replace(/,/g, '');
    const n = Number(norm);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ---- Türe göre veri erişimi (şekil bozuksa boş/varsayılan döner; ekran çökmez) ----
const nesne = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
function dizi<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function vergiBorcuVerisi(s: SorguSonucu): VergiBorcuVeri {
  const v = nesne(s.veri);
  const kalemler = dizi<Record<string, unknown>>(v.kalemler).map((k) => ({
    vergiTuru: String(k.vergiTuru ?? ''),
    vergiKodu: String(k.vergiKodu ?? ''),
    donem: String(k.donem ?? ''),
    vadeTarihi: (k.vadeTarihi as string | null) ?? null,
    asilBorc: sayiOku(k.asilBorc) ?? 0,
    gecikmeZammi: sayiOku(k.gecikmeZammi) ?? 0,
    toplam: sayiOku(k.toplam) ?? 0,
    vergiDairesi: String(k.vergiDairesi ?? ''),
    vergiDairesiKodu: String(k.vergiDairesiKodu ?? ''),
    belgeNo: (k.belgeNo as string | null) ?? null,
    vadesiGecmisMi: k.vadesiGecmisMi === true,
  }));
  return {
    vadesiGecmis: sayiOku(v.vadesiGecmis) ?? 0,
    vadesiGelmemis: sayiOku(v.vadesiGelmemis) ?? 0,
    toplam: sayiOku(v.toplam ?? v.toplamBorc) ?? 0,
    gecikmeZammiToplam: sayiOku(v.gecikmeZammiToplam) ?? 0,
    kalemSayisi: sayiOku(v.kalemSayisi) ?? kalemler.length,
    kalemler,
    turOzeti: dizi<VergiBorcuVeri['turOzeti'][number]>(v.turOzeti),
    hesaplamaZamani: (v.hesaplamaZamani as string | null) ?? null,
  };
}

export function eHacizVerisi(s: SorguSonucu): EHacizVeri {
  const v = nesne(s.veri);
  const bildiriler = dizi<Record<string, unknown>>(v.bildiriler).map((b) => ({
    kapsam: (b.kapsam === 'ARAC' ? 'ARAC' : 'BANKA') as EHacizVeri['bildiriler'][number]['kapsam'],
    bildiriNo: String(b.bildiriNo ?? ''),
    tutar: sayiOku(b.tutar) ?? 0,
    durum: String(b.durum ?? ''),
    vergiDairesiKodu: String(b.vergiDairesiKodu ?? ''),
    vergiDairesi: (b.vergiDairesi as string | null) ?? null,
    borclar: dizi<{ vergiTuru: string; vergiDonem: string }>(b.borclar),
    hesaplar: dizi<Record<string, unknown>>(b.hesaplar),
  }));
  return {
    bildiriSayisi: sayiOku(v.bildiriSayisi) ?? bildiriler.length,
    tatbikEdilenSayisi: sayiOku(v.tatbikEdilenSayisi) ?? bildiriler.filter((b) => /TATBİK EDİLMİŞ/i.test(b.durum)).length,
    toplamTutar: sayiOku(v.toplamTutar) ?? bildiriler.reduce((a, b) => a + b.tutar, 0),
    bildiriler,
  };
}

export function yoklamaVerisi(s: SorguSonucu): YoklamaDenetimVeri {
  const v = nesne(s.veri);
  const yoklamalar = dizi<Record<string, unknown>>(v.yoklamalar).map((y) => ({
    yoklamaKodu: String(y.yoklamaKodu ?? ''),
    tarih: String(y.tarih ?? ''),
    vergiDairesi: String(y.vergiDairesi ?? ''),
    vergiDairesiKodu: String(y.vergiDairesiKodu ?? ''),
    yoklamaTuru: String(y.yoklamaTuru ?? ''),
    yoklamaTuruKodu: String(y.yoklamaTuruKodu ?? ''),
    pdfVarMi: y.pdfVarMi === true,
    pdfDocumentId: (y.pdfDocumentId as string | null) ?? null,
  }));
  const denetimler = dizi<Record<string, unknown>>(v.denetimler).map((d) => ({
    belgeKodu: String(d.belgeKodu ?? ''),
    denetimAdi: String(d.denetimAdi ?? ''),
    denetimTuru: String(d.denetimTuru ?? ''),
    tarih: String(d.tarih ?? ''),
    sonuc: (d.sonuc as string | null) ?? null,
  }));
  return {
    yoklamaSayisi: sayiOku(v.yoklamaSayisi) ?? yoklamalar.length,
    denetimSayisi: sayiOku(v.denetimSayisi) ?? denetimler.length,
    sonYoklamaTarihi: (v.sonYoklamaTarihi as string | null) ?? (yoklamalar[0]?.tarih || null),
    yoklamalar,
    denetimler,
  };
}

export function posVerisi(s: SorguSonucu): PosVeri {
  const v = nesne(s.veri);
  const satirlar = dizi<Record<string, unknown>>(v.satirlar).map((p) => ({
    kaynak: (p.kaynak === 'ODEME_KURULUSU' ? 'ODEME_KURULUSU' : 'BANKA') as PosVeri['satirlar'][number]['kaynak'],
    unvan: String(p.unvan ?? ''),
    vkn: String(p.vkn ?? ''),
    uyeIsyeriNo: String(p.uyeIsyeriNo ?? ''),
    tutar: sayiOku(p.tutar) ?? 0,
  }));
  return {
    yil: sayiOku(v.yil) ?? 0,
    ay: sayiOku(v.ay) ?? 0,
    toplamTutar: sayiOku(v.toplamTutar) ?? satirlar.reduce((a, b) => a + b.tutar, 0),
    satirSayisi: sayiOku(v.satirSayisi) ?? satirlar.length,
    satirlar,
  };
}

export function gelenEArsivVerisi(s: SorguSonucu): GelenEArsivVeri {
  const v = nesne(s.veri);
  const faturalar = dizi<Record<string, unknown>>(v.faturalar).map((f) => ({
    faturaNo: String(f.faturaNo ?? ''),
    duzenlenmeTarihi: String(f.duzenlenmeTarihi ?? ''),
    saticiUnvan: String(f.saticiUnvan ?? ''),
    saticiVkn: String(f.saticiVkn ?? ''),
    gonderimSekli: String(f.gonderimSekli ?? ''),
    toplamTutar: sayiOku(f.toplamTutar) ?? 0,
    vergilerTutari: sayiOku(f.vergilerTutari) ?? 0,
    odenecekTutar: sayiOku(f.odenecekTutar) ?? 0,
    paraBirimi: String(f.paraBirimi ?? 'TRY'),
    iptalItirazDurum: (f.iptalItirazDurum as string | null) ?? null,
  }));
  return {
    baslangic: String(v.baslangic ?? ''),
    bitis: String(v.bitis ?? ''),
    faturaSayisi: sayiOku(v.faturaSayisi) ?? faturalar.length,
    toplamOdenecek: sayiOku(v.toplamOdenecek) ?? faturalar.reduce((a, b) => a + b.odenecekTutar, 0),
    faturalar,
    pencereSayisi: sayiOku(v.pencereSayisi) ?? 0,
    hataliPencereler: dizi<GelenEArsivVeri['hataliPencereler'][number]>(v.hataliPencereler),
  };
}

/** Koşunun kapsadığı sorgular (kısa adlar): DVD_SORGU → payload.sorgular; E_TEBLIGAT_CHECK → e-Tebligat + payload.ekSorgular. */
export function kosuSorgulari(k: SorguKosusu): string[] {
  const p = k.payload || {};
  const adlar: string[] = [];
  if (k.jobType === 'E_TEBLIGAT_CHECK') adlar.push(KISA_SORGU_ADI.eTebligat);
  const liste = k.jobType === 'E_TEBLIGAT_CHECK' ? p.ekSorgular : p.sorgular;
  for (const s of Array.isArray(liste) ? liste : []) adlar.push(dvdSorguMu(s) ? KISA_SORGU_ADI[s] : String(s));
  return adlar;
}
