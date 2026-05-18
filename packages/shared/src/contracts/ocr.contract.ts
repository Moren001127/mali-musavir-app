/**
 * OCR Sözleşmesi — modüller arası SINIR
 * =====================================
 * `ocr.service.ts` çıkışında ve `reconciliation.engine.ts` girişinde RUNTIME parse.
 * Shape değişirse anında patlar (sessiz bozulma yok).
 */

import { z } from 'zod';

/** Belge tipi — fiş/fatura/Z raporu/dekont/diğer */
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

/** Çok oranlı KDV kırılımı — Z raporu / karma fatura için */
export const KdvBreakdownItemSchema = z.object({
  /** KDV oranı (%) — 1, 10, 20 vb. */
  oran: z.number().min(0).max(100),
  /** Matrah (KDV hariç tutar) — opsiyonel */
  matrah: z.number().nullable().optional(),
  /** KDV tutarı (TL) */
  tutar: z.number(),
});
export type KdvBreakdownItem = z.infer<typeof KdvBreakdownItemSchema>;

/** OCR sonucu — tüm OCR provider'ları (Azure/Claude/UBL) bu shape'i döner */
export const OcrResultSchema = z.object({
  rawText: z.string(),
  belgeNo: z.string().nullable(),
  date: z.string().nullable(),

  /** NET KDV — tevkifatlı faturada (tam KDV − tevkifat). Reconciliation'da Luca ile kıyaslanan değer */
  kdvTutari: z.string().nullable(),

  /** Tevkifat tutarı (TL) — varsa */
  kdvTevkifat: z.string().nullable().optional(),

  totalTutari: z.string().nullable(),

  /** Satıcı unvanı */
  satici: z.string().nullable().optional(),

  /** Satıcı VKN/TCKN (10 veya 11 hane) */
  saticiVkn: z.string().nullable().optional(),

  /** Belge tipi sınıflandırması */
  belgeTipi: OcrBelgeTipiSchema.or(z.string()).nullable().optional(),

  /** Çok oranlı KDV kırılımı */
  kdvBreakdown: z.array(KdvBreakdownItemSchema).nullable().optional(),

  /** Otomatik gider kategorisi */
  kategori: z.string().nullable().optional(),

  /** SHA-256 hash — cache kontrolü için */
  imageHash: z.string().optional(),

  /** Genel güven (0-1) */
  confidence: z.number().min(0).max(1),

  /** Alan-bazlı güven skorları */
  fieldConfidence: z.object({
    belgeNo: z.number().min(0).max(1).nullable(),
    date: z.number().min(0).max(1).nullable(),
    kdvTutari: z.number().min(0).max(1).nullable(),
  }),

  /** Multi-pass validation skoru (0-1) */
  validationScore: z.number().min(0).max(1).nullable().optional(),

  /** Validation hataları */
  validationIssues: z.array(z.string()).optional(),

  engine: z.string(),

  /** Claude API token kullanımı (maliyet için) */
  usage: z
    .object({
      inputTokens: z.number().int().min(0),
      outputTokens: z.number().int().min(0),
      costUsd: z.number().min(0),
    })
    .optional(),
});
export type OcrResult = z.infer<typeof OcrResultSchema>;

/** OCR girdi seçenekleri */
export const ExtractOcrOptionsSchema = z.object({
  forceClaude: z.boolean().optional(),
});
export type ExtractOcrOptions = z.infer<typeof ExtractOcrOptionsSchema>;

/**
 * Belge tipi sabitleri — Z raporu/fiş/fatura için **tek doğru kaynak**.
 * OCR ve reconciliation buradan referans alır.
 */
export const BELGE_TIPI_VALUES = OcrBelgeTipiSchema.options;

/**
 * Geçerli KDV oranları — kullanıcının değiştirmek istemediği muhasebe sabiti.
 * Yeni oran eklenince burada güncellenir, tüm validation buradan çeker.
 */
export const VALID_KDV_RATES = [0, 1, 8, 10, 18, 20] as const;
export const VALID_KDV_RATE_SET = new Set<number>(VALID_KDV_RATES);

/**
 * Field-bazlı confidence eşiği — bu altında kullanıcı teyidine düşer.
 */
export const FIELD_CONFIDENCE_THRESHOLD = 0.7 as const;

/**
 * Safe parse helper — modül sınırında kullanılır.
 * `OcrResultSchema.parse(data)` direkt fırlatır; bu helper hata mesajını
 * lokalize eder ve hangi modülün ne shape gönderdiğini logger'a verir.
 */
export function parseOcrResult(
  value: unknown,
  origin: string,
): OcrResult {
  const r = OcrResultSchema.safeParse(value);
  if (!r.success) {
    const issues = r.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(
      `[contract] OcrResult shape bozulmuş — origin=${origin} — ${issues}`,
    );
  }
  return r.data;
}
