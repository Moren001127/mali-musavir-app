/**
 * Luca Sözleşmesi — Agent → Backend SINIR
 * ========================================
 * Luca agent runtime'ın yüklediği veriler bu shape ile dökülür.
 * Backend her upload'da `LucaJobUploadSchema.parse()` yapar.
 * Shape bozulması = anında hata, sessiz değişiklik yok.
 */

import { z } from 'zod';

/** Luca job tipleri — agent runtime + backend kontratı */
export const LucaJobTipiSchema = z.enum([
  'MIZAN',
  'KDV_MIZAN',
  'KDV_191',
  'KDV_391',
  'ISLETME_GELIR',
  'ISLETME_GIDER',
  'IHO_FETCH',
  'EARSIV_GELEN',
  'EARSIV_GIDEN',
  'EFATURA_GELEN',
  'EFATURA_GIDEN',
  'HESAP_PLANI',
]);
export type LucaJobTipi = z.infer<typeof LucaJobTipiSchema>;

/**
 * Job tipi → upload endpoint sözleşmesi.
 * `MODUL-IZOLASYON-SURECI.md`'deki "Luca upload endpoint sözleşmesi" buraya kilitlendi.
 * Endpoint değişirse hem agent runtime hem backend hem bu eşleme güncellenir.
 */
export const LUCA_JOB_TO_ENDPOINT: Record<LucaJobTipi, string> = {
  MIZAN: 'upload-mizan',
  KDV_MIZAN: 'upload-kdv-mizan',
  KDV_191: 'upload-kdv',
  KDV_391: 'upload-kdv',
  ISLETME_GELIR: 'upload-kdv',
  ISLETME_GIDER: 'upload-kdv',
  IHO_FETCH: 'upload-iho',
  EARSIV_GELEN: 'upload-earsiv',
  EARSIV_GIDEN: 'upload-earsiv',
  EFATURA_GELEN: 'upload-earsiv',
  EFATURA_GIDEN: 'upload-earsiv',
  HESAP_PLANI: 'upload-hesap-plani',
};

/** Job upload payload — agent → backend */
export const LucaJobUploadSchema = z.object({
  jobId: z.string().min(1),
  tip: LucaJobTipiSchema,
  mukellefId: z.string().min(1),
  donem: z.string().regex(/^\d{4}-\d{2}$/, 'donem YYYY-MM formatında olmalı'),
  sessionId: z.string().nullable().optional(),
  /** Excel content base64 veya raw XLSX buffer referansı (multipart'ta) */
  contentSize: z.number().int().min(0).optional(),
  rows: z.array(z.unknown()).optional(),
  /** Job çalışma logları (agent runtime'ın frame mesajları) */
  agentLog: z.array(z.string()).optional(),
  /** Agent runtime sürümü */
  agentVersion: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
});
export type LucaJobUpload = z.infer<typeof LucaJobUploadSchema>;

/**
 * Luca Excel'inden parse edilen tek satır.
 * KDV kontrol modülü için ana giriş.
 */
export const LucaRowSchema = z.object({
  /** Excel'deki satır numarası — orijinal sıralamayı korumak için */
  rowIndex: z.number().int().min(0).optional(),

  /** Yevmiye belge no (genelde Luca'da "FİŞ NO" sütunu) */
  belgeNo: z.string().nullable().optional(),

  /** Belge tarihi */
  belgeDate: z.union([z.string(), z.date()]).nullable().optional(),

  /** Hesap kodu (191 indirilecek KDV, 391 hesaplanan KDV, vs.) */
  hesapKodu: z.string().nullable().optional(),

  /** Hesap adı */
  hesapAdi: z.string().nullable().optional(),

  /** Açıklama (Luca'daki "AÇIKLAMA" sütunu) */
  aciklama: z.string().nullable().optional(),

  /** Karşı taraf (cari) */
  karsiTaraf: z.string().nullable().optional(),

  /** Vergi numarası */
  vergiNo: z.string().nullable().optional(),

  /** KDV oranı (örn. 20) */
  kdvOrani: z.number().nullable().optional(),

  /** KDV tutarı (TL) — string ya da number kabul ediyoruz, normalize edilir */
  kdvTutari: z.union([z.string(), z.number()]).nullable().optional(),

  /** Matrah (KDV hariç) */
  matrah: z.union([z.string(), z.number()]).nullable().optional(),

  /** Toplam (KDV dahil) */
  toplamTutar: z.union([z.string(), z.number()]).nullable().optional(),

  /** Raw payload — Luca'dan gelen orijinal hücreler */
  rawData: z.record(z.unknown()).optional(),
});
export type LucaRow = z.infer<typeof LucaRowSchema>;

/** Bir Luca Excel'inin tüm satırlarını içeren sheet payload */
export const LucaSheetSchema = z.object({
  taxpayerId: z.string().min(1),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  sessionType: LucaJobTipiSchema,
  rows: z.array(LucaRowSchema),
  /** Aggregate/toplam/nakli yekun satırları ayrı tutulur */
  aggregateRows: z.array(LucaRowSchema).optional(),
});
export type LucaSheet = z.infer<typeof LucaSheetSchema>;

/**
 * Endpoint sözleşmesi guardı — yanlış endpoint'e yanlış tip gönderilmesin.
 * `MODUL-IZOLASYON-SURECI.md` kuralı buraya kilitli.
 */
export function expectedEndpointForJob(tip: LucaJobTipi): string {
  return LUCA_JOB_TO_ENDPOINT[tip];
}

export function parseLucaJobUpload(value: unknown, origin: string): LucaJobUpload {
  const r = LucaJobUploadSchema.safeParse(value);
  if (!r.success) {
    const issues = r.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(
      `[contract] LucaJobUpload shape bozulmuş — origin=${origin} — ${issues}`,
    );
  }
  return r.data;
}

export function parseLucaSheet(value: unknown, origin: string): LucaSheet {
  const r = LucaSheetSchema.safeParse(value);
  if (!r.success) {
    const issues = r.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(
      `[contract] LucaSheet shape bozulmuş — origin=${origin} — ${issues}`,
    );
  }
  return r.data;
}
