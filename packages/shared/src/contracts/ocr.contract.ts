/**
 * OCR Sozlesmesi - moduller arasi SINIR
 * =====================================
 * ocr.service.ts cikisinda ve reconciliation.engine.ts girisinde RUNTIME parse.
 * Shape degisirse aninda patlar (sessiz bozulma yok).
 */

import { z } from 'zod';

/** Belge tipi - fis/fatura/Z raporu/dekont/diger */
export const OcrBelgeTipiSchema = z.enum([
  'EFATURA',
  'EARSIV',
  'OKC_FIS',
  'Z_RAPORU',
  'MAKBUZ',
  'DEKONT',
  'DIGER',
]);
export type OcrBelgeTipi = z.infer<typeof OcrBelgeTipiSchema>;

/** Cok oranli KDV kirilimi - Z raporu / karma fatura icin */
export const KdvBreakdownItemSchema = z.object({
  oran: z.number().min(0).max(100),
  matrah: z.number().nullable().optional(),
  tutar: z.number(),
});
export type KdvBreakdownItem = z.infer<typeof KdvBreakdownItemSchema>;

/** OCR sonucu - tum OCR provider'lari (Azure/Claude/UBL) bu shape'i doner */
export const OcrResultSchema = z.object({
  rawText: z.string(),
  belgeNo: z.string().nullable(),
  date: z.string().nullable(),
  kdvTutari: z.string().nullable(),
  kdvTevkifat: z.string().nullable().optional(),
  totalTutari: z.string().nullable(),
  satici: z.string().nullable().optional(),
  saticiVkn: z.string().nullable().optional(),
  belgeTipi: z.union([OcrBelgeTipiSchema, z.string()]).nullable().optional(),
  kdvBreakdown: z.array(KdvBreakdownItemSchema).nullable().optional(),
  kategori: z.string().nullable().optional(),
  imageHash: z.string().optional(),
  confidence: z.number().min(0).max(1),
  fieldConfidence: z.object({
    belgeNo: z.number().min(0).max(1).nullable(),
    date: z.number().min(0).max(1).nullable(),
    kdvTutari: z.number().min(0).max(1).nullable(),
  }),
  validationScore: z.number().min(0).max(1).nullable().optional(),
  validationIssues: z.array(z.string()).optional(),
  engine: z.string(),
  usage: z
    .object({
      inputTokens: z.number().int().min(0),
      outputTokens: z.number().int().min(0),
      costUsd: z.number().min(0),
    })
    .optional(),
});
export type OcrResult = z.infer<typeof OcrResultSchema>;

export const ExtractOcrOptionsSchema = z.object({
  forceClaude: z.boolean().optional(),
});
export type ExtractOcrOptions = z.infer<typeof ExtractOcrOptionsSchema>;

export const BELGE_TIPI_VALUES = OcrBelgeTipiSchema.options;

export const VALID_KDV_RATES = [0, 1, 8, 10, 18, 20] as const;
export const VALID_KDV_RATE_SET = new Set<number>(VALID_KDV_RATES);

export const FIELD_CONFIDENCE_THRESHOLD = 0.7 as const;

interface IssueLike {
  path: Array<string | number>;
  message: string;
}

export function parseOcrResult(value: unknown, origin: string): OcrResult {
  const r = OcrResultSchema.safeParse(value);
  if (!r.success) {
    const issues = r.error.issues
      .map((i: IssueLike) => i.path.join('.') + ': ' + i.message)
      .join('; ');
    throw new Error('[contract] OcrResult shape invalid - origin=' + origin + ' - ' + issues);
  }
  return r.data;
}
