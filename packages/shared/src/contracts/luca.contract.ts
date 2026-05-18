/**
 * Luca Sozlesmesi - Agent -> Backend SINIR
 * ========================================
 * Luca agent runtime'in yukledigi veriler bu shape ile dokulur.
 * Backend her upload'da LucaJobUploadSchema.parse() yapar.
 */

import { z } from 'zod';

/** Luca job tipleri - agent runtime + backend kontrati */
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
 * Job tipi -> upload endpoint sozlesmesi.
 * MODUL-IZOLASYON-SURECI.md'deki Luca upload endpoint kurali buraya kilitli.
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

/** Job upload payload - agent -> backend */
export const LucaJobUploadSchema = z.object({
  jobId: z.string().min(1),
  tip: LucaJobTipiSchema,
  mukellefId: z.string().min(1),
  donem: z.string().regex(/^\d{4}-\d{2}$/),
  sessionId: z.string().nullable().optional(),
  contentSize: z.number().int().min(0).optional(),
  rows: z.array(z.unknown()).optional(),
  agentLog: z.array(z.string()).optional(),
  agentVersion: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
});
export type LucaJobUpload = z.infer<typeof LucaJobUploadSchema>;

/** Luca Excel'inden parse edilen tek satir */
export const LucaRowSchema = z.object({
  rowIndex: z.number().int().min(0).optional(),
  belgeNo: z.string().nullable().optional(),
  belgeDate: z.union([z.string(), z.date()]).nullable().optional(),
  hesapKodu: z.string().nullable().optional(),
  hesapAdi: z.string().nullable().optional(),
  aciklama: z.string().nullable().optional(),
  karsiTaraf: z.string().nullable().optional(),
  vergiNo: z.string().nullable().optional(),
  kdvOrani: z.number().nullable().optional(),
  kdvTutari: z.union([z.string(), z.number()]).nullable().optional(),
  matrah: z.union([z.string(), z.number()]).nullable().optional(),
  toplamTutar: z.union([z.string(), z.number()]).nullable().optional(),
  rawData: z.record(z.unknown()).optional(),
});
export type LucaRow = z.infer<typeof LucaRowSchema>;

export const LucaSheetSchema = z.object({
  taxpayerId: z.string().min(1),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  sessionType: LucaJobTipiSchema,
  rows: z.array(LucaRowSchema),
  aggregateRows: z.array(LucaRowSchema).optional(),
});
export type LucaSheet = z.infer<typeof LucaSheetSchema>;

export function expectedEndpointForJob(tip: LucaJobTipi): string {
  return LUCA_JOB_TO_ENDPOINT[tip];
}

interface IssueLike {
  path: Array<string | number>;
  message: string;
}

export function parseLucaJobUpload(value: unknown, origin: string): LucaJobUpload {
  const r = LucaJobUploadSchema.safeParse(value);
  if (!r.success) {
    const issues = r.error.issues
      .map((i: IssueLike) => i.path.join('.') + ': ' + i.message)
      .join('; ');
    throw new Error('[contract] LucaJobUpload shape invalid - origin=' + origin + ' - ' + issues);
  }
  return r.data;
}

export function parseLucaSheet(value: unknown, origin: string): LucaSheet {
  const r = LucaSheetSchema.safeParse(value);
  if (!r.success) {
    const issues = r.error.issues
      .map((i: IssueLike) => i.path.join('.') + ': ' + i.message)
      .join('; ');
    throw new Error('[contract] LucaSheet shape invalid - origin=' + origin + ' - ' + issues);
  }
  return r.data;
}
