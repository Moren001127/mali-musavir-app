import { api } from './api';

/**
 * Genel Sorgulamalar — Dijital Vergi Dairesi'nden mükellef başına yapılan sorguların sonuçları.
 * Arka uç sözleşmesi (2026-09-14): GET /genel-sorgular · GET /genel-sorgular/ozet
 * (e-Tebligat bu modülde YOK — ayrı modülü var.)
 */

export type SorguTuru = 'VERGI_BORCU' | 'E_HACIZ' | 'YOKLAMA_DENETIM' | 'POS' | 'GELEN_EARSIV';

export const SORGU_TURLERI: readonly SorguTuru[] = ['VERGI_BORCU', 'E_HACIZ', 'YOKLAMA_DENETIM', 'POS', 'GELEN_EARSIV'] as const;

export const SORGU_TURU_ADI: Record<SorguTuru, string> = {
  VERGI_BORCU: 'Vergi Borcu',
  E_HACIZ: 'E-Haciz',
  YOKLAMA_DENETIM: 'Yoklama / Denetim Tutanakları',
  POS: 'POS Tutarları',
  GELEN_EARSIV: 'Gelen E-Arşiv',
};

export function sorguTuruMu(v: unknown): v is SorguTuru {
  return typeof v === 'string' && (SORGU_TURLERI as readonly string[]).includes(v);
}

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
  /** YYYY-MM (bazı türlerde boş olabilir) */
  donem?: string | null;
  sorguTarihi: string;
  ozet?: string | null;
  /** Türe göre serbest yapı — ekranda anahtar-değer olarak gösterilir. */
  veri?: Record<string, unknown> | null;
  kaynak?: string | null;
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

  ozet: () => api.get('/genel-sorgular/ozet').then((r) => (r.data ?? {}) as SorguOzeti),
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
    // Hem nokta hem virgül varsa: son ayırıcı ondalık kabul edilir.
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

/** Vergi Borcu / POS / Gelen E-Arşiv satırındaki toplam — veri içindeki olası anahtarlardan. */
export function satirToplami(s: SorguSonucu): number | null {
  const v = s.veri || {};
  switch (s.tur) {
    case 'VERGI_BORCU':
      return sayiOku(v.toplamBorc);
    case 'POS':
      return sayiOku(v.toplamTutar ?? v.toplam);
    case 'GELEN_EARSIV': {
      const dogrudan = sayiOku(v.toplamTutar ?? v.toplam);
      if (dogrudan !== null) return dogrudan;
      const faturalar = Array.isArray(v.faturalar) ? (v.faturalar as Array<Record<string, unknown>>) : [];
      if (faturalar.length === 0) return null;
      return faturalar.reduce((acc, f) => acc + (sayiOku(f?.toplamTutar ?? f?.toplam ?? f?.tutar) || 0), 0);
    }
    default:
      return null;
  }
}
