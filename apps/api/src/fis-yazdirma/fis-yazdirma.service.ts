import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { logAiUsage } from '../common/ai-usage-logger';
import { createWorker } from 'tesseract.js';
import * as sharp from 'sharp';
import * as XLSX from 'xlsx';
import {
  Document,
  Packer,
  Paragraph,
  ImageRun,
  TextRun,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  VerticalAlign,
  TableLayoutType,
  convertMillimetersToTwip,
} from 'docx';

/* ─── Tip Tanımları ─────────────────────────────────────────── */

export interface ScanDetected {
  filename: string;
  date: string; // YYYY-MM-DD
  belge_no?: string;
  cari?: string;
  vergi_no?: string;
  kdv_1?: string;
  kdv_10?: string;
  kdv_20?: string;
  toplam?: string;
}

export interface ScanUnread {
  filename: string;
  thumbnail: string; // "data:image/jpeg;base64,..."
}

export interface ScanResult {
  detected: ScanDetected[];
  unread: ScanUnread[];
  total: number;
}

export interface ExcelRow {
  filename: string;
  date: string;
  belge_no?: string;
  cari?: string;
  vergi_no?: string;
  kdv_1?: string;
  kdv_10?: string;
  kdv_20?: string;
  toplam?: string;
}

function isoDisplay(iso: string): string {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/* ─── Türkçe Ay Adları (OCR gürültü toleranslı) ────────────── */
const TR_MONTHS: Record<string, number> = {
  ocak: 1, subat: 2, şubat: 2, mart: 3, nisan: 4,
  mayis: 5, mayıs: 5, haziran: 6,
  temmuz: 7, agustos: 8, ağustos: 8,
  eylul: 9, eylül: 9, ekim: 10,
  kasim: 11, kasım: 11, aralik: 12, aralık: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/* ─── Çapraz Kontrol: Geçerli tarih aralığı ────────────────── */
const MIN_YEAR = 2020;
const MAX_YEAR = 2030;
const TODAY = new Date();
const MAX_DATE = new Date(TODAY.getTime() + 7 * 24 * 60 * 60 * 1000);

function parseDate(d: string, m: string | number, y: string): string | null {
  const day = parseInt(d, 10);
  const month = typeof m === 'string' ? (TR_MONTHS[m.toLowerCase()] ?? 0) : m;
  let year = parseInt(y, 10);
  if (year < 100) year += 2000;

  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  if (year < MIN_YEAR || year > MAX_YEAR) return null;

  const candidate = new Date(year, month - 1, day);
  if (candidate > MAX_DATE) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractDateFromText(raw: string): string | null {
  if (!raw || raw.trim().length < 5) return null;

  // ── Ön Temizlik ──────────────────────────────────────────────
  let t = raw
    .replace(/[\u2013\u2014\u2015\u2212]/g, '-')   // Unicode dash → standart tire
    .replace(/[|\\]/g, '-')
    .replace(/[oO](\d)/g, '0$1')                    // "O2" → "02"
    .replace(/(\d)[,;](\d)/g, '$1.$2')              // virgül/noktalı virgül → nokta
    .replace(/\s+/g, ' ');

  // ── SAAT Temizliği: SADECE : (iki nokta üst üste) ile yazılmış saatler ──
  // NOT: [.:] yerine sadece [:] — böylece "20.02" gibi tarih parçaları silinmez
  t = t.replace(/\b\d{2}:\d{2}(:\d{2})?\b/g, ' ');

  // ── Separator normalizasyonu: tire → nokta (yedek kopya) ──
  const tDash = t.replace(/(\d)\s*-\s*(\d)/g, '$1.$2');

  const tryAll = (text: string): string | null => {
    // 1. DD.MM.YYYY / DD-MM-YYYY / DD/MM/YYYY
    let m = text.match(/(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{4})/);
    if (m) { const r = parseDate(m[1], parseInt(m[2], 10), m[3]); if (r) return r; }

    // 2. YYYY-MM-DD / YYYY.MM.DD
    m = text.match(/(\d{4})\s*[.\-]\s*(\d{2})\s*[.\-]\s*(\d{2})(?!\d)/);
    if (m) { const r = parseDate(m[3], parseInt(m[2], 10), m[1]); if (r) return r; }

    // 3. DD.MM.YY (2 haneli yıl)
    m = text.match(/(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{2})(?!\d)/);
    if (m) { const r = parseDate(m[1], parseInt(m[2], 10), m[3]); if (r) return r; }

    // 4. DD MM YYYY (boşlukla ayrılmış)
    m = text.match(/\b(\d{1,2})\s+(\d{1,2})\s+(20\d{2})\b/);
    if (m) { const r = parseDate(m[1], parseInt(m[2], 10), m[3]); if (r) return r; }

    // 5. DDMMYYYY bitişik 8 hane
    m = text.match(/\b(\d{2})(\d{2})(20\d{2})\b/);
    if (m) { const r = parseDate(m[1], parseInt(m[2], 10), m[3]); if (r) return r; }

    // 6. DD Ocak 2025 vb.
    m = text.match(/(\d{1,2})\s+(ocak|subat|şubat|mart|nisan|mayis|mayıs|haziran|temmuz|agustos|ağustos|eylul|eylül|ekim|kasim|kasım|aralik|aralık|january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i);
    if (m) { const r = parseDate(m[1], m[2].toLowerCase(), m[3]); if (r) return r; }

    return null;
  };

  return tryAll(t) ?? tryAll(tDash);
}

/**
 * OCR metninden ek alanları best-effort çıkar
 */
function extractFieldsFromText(text: string): Omit<ScanDetected, 'filename' | 'date'> {
  const result: Omit<ScanDetected, 'filename' | 'date'> = {};
  if (!text) return result;

  // Belge No / Fiş No
  const belgeMatch = text.match(
    /(?:fi[sş]\s*no|belge\s*no|z\s*no|seri\s*no|eku\s*no)[:\s#]*([A-Z0-9\-]{1,20})/i,
  );
  if (belgeMatch) result.belge_no = belgeMatch[1].trim();

  // Cari / Ünvan (şirket adı — Ltd, A.Ş., Tic, San içeren ilk satır)
  const cariMatch = text.match(
    /^(.{5,80}(?:ltd|a\.?\s*ş|tic\.?|san\.?|a\.?\s*s\.?|limited|petrol|oto|market|nakliyat)[^\n]*)/im,
  );
  if (cariMatch) result.cari = cariMatch[1].trim().substring(0, 80);

  // Vergi No (10-11 haneli sayı — VD veya No etiketiyle)
  const vergiMatch = text.match(
    /(?:vd|v\.d\.|vergi\s*no|vergi\s*kimlik)[:\s]*([0-9]{10,11})/i,
  ) ?? text.match(/\b([0-9]{10,11})\b/);
  if (vergiMatch) result.vergi_no = vergiMatch[1];

  // Genel Toplam / Satış Tutarı
  const toplamMatch = text.match(
    /(?:genel\s*toplam|sati[sş]\s*tutar[iı]|toplam|total)\s*[:\s*]*\*?\s*([0-9]{1,6}[.,][0-9]{2,3}(?:[.,][0-9]{2})?)/i,
  );
  if (toplamMatch) result.toplam = toplamMatch[1].replace(/\./g, '').replace(',', '.').trim();

  // KDV %20 (en yaygın)
  const kdv20Match = text.match(
    /(?:topkdv|kdv\s*%?20|k\.d\.v\.?\s*%?20)\s*[:\s*]*\*?\s*([0-9]{1,6}[.,][0-9]{1,3})/i,
  );
  if (kdv20Match) result.kdv_20 = kdv20Match[1].replace(',', '.').trim();

  // KDV %10
  const kdv10Match = text.match(
    /kdv\s*%?10\s*[:\s*]*\*?\s*([0-9]{1,6}[.,][0-9]{1,3})/i,
  );
  if (kdv10Match) result.kdv_10 = kdv10Match[1].replace(',', '.').trim();

  // KDV %1
  const kdv1Match = text.match(
    /kdv\s*%?1(?!\d)\s*[:\s*]*\*?\s*([0-9]{1,6}[.,][0-9]{1,3})/i,
  );
  if (kdv1Match) result.kdv_1 = kdv1Match[1].replace(',', '.').trim();

  return result;
}

/* ─── Görünmez Border ───────────────────────────────────────── */
const NO_BORDER = {
  top:    { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right:  { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

/* ─── OCR Strateji Matrisi ──────────────────────────────────── */
type OcrStrategy = {
  zone: 'full' | 'top50' | 'mid' | 'bot40';
  preprocess: 'normalize' | 'threshold' | 'contrast';
  psm: '11' | '6' | '3';
};

const OCR_STRATEGIES: OcrStrategy[] = [
  { zone: 'full',  preprocess: 'normalize',  psm: '11' },
  { zone: 'full',  preprocess: 'threshold',  psm: '6'  },
  { zone: 'top50', preprocess: 'normalize',  psm: '6'  },
  { zone: 'top50', preprocess: 'threshold',  psm: '11' },
  { zone: 'mid',   preprocess: 'normalize',  psm: '6'  },
  { zone: 'bot40', preprocess: 'normalize',  psm: '6'  },
  { zone: 'bot40', preprocess: 'threshold',  psm: '11' },
  { zone: 'full',  preprocess: 'contrast',   psm: '3'  },
];

/* ─── Service ───────────────────────────────────────────────── */

@Injectable()
export class FisYazdirmaService {
  private readonly logger = new Logger(FisYazdirmaService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async preprocessImage(
    buffer: Buffer,
    W: number,
    H: number,
    strategy: OcrStrategy,
  ): Promise<Buffer> {
    let top = 0;
    let height = H;
    switch (strategy.zone) {
      case 'top50': height = Math.floor(H * 0.50); break;
      case 'mid':   top = Math.floor(H * 0.20); height = Math.floor(H * 0.50); break;
      case 'bot40': top = Math.floor(H * 0.60); height = Math.floor(H * 0.40); break;
    }
    if (top + height > H) height = H - top;
    if (height < 20) height = Math.min(40, H);

    let pipeline = sharp(buffer)
      .extract({ left: 0, top, width: W, height })
      .grayscale();

    switch (strategy.preprocess) {
      case 'normalize':
        pipeline = pipeline.normalize().sharpen();
        break;
      case 'threshold':
        pipeline = pipeline.normalize().threshold(140);
        break;
      case 'contrast':
        pipeline = pipeline.linear(1.5, -40).normalize().sharpen();
        break;
    }

    return pipeline
      .resize({ width: 1200, withoutEnlargement: false })
      .png()
      .toBuffer();
  }

  private async ocrDateWithWorker(
    buffer: Buffer,
    worker: any,
  ): Promise<{ date: string | null; fullText: string }> {
    const meta = await sharp(buffer).metadata();
    const W = meta.width ?? 400;
    const H = meta.height ?? 600;

    let bestText = '';

    for (const strategy of OCR_STRATEGIES) {
      try {
        await worker.setParameters({ tessedit_pageseg_mode: strategy.psm });
        const processed = await this.preprocessImage(buffer, W, H, strategy);
        const { data } = await worker.recognize(processed);
        if (!bestText && data.text) bestText = data.text;
        const date = extractDateFromText(data.text);
        if (date) {
          this.logger.debug(`[OCR] ${strategy.zone}/${strategy.preprocess}/PSM${strategy.psm} → ${date}`);
          return { date, fullText: data.text };
        }
      } catch (e: any) {
        this.logger.debug(`[OCR] ${strategy.zone}/${strategy.preprocess} hata: ${e.message}`);
      }
    }

    return { date: null, fullText: bestText };
  }

  private async makeThumbnail(buffer: Buffer): Promise<string> {
    try {
      const thumb = await sharp(buffer)
        .resize({ width: 240, withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer();
      return `data:image/jpeg;base64,${thumb.toString('base64')}`;
    } catch {
      return '';
    }
  }

  /** Claude'un döndürdüğü herhangi bir tarih string'ini YYYY-MM-DD'ye normalize et.
   *  Kabul edilen formatlar: YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY,
   *  D.M.YYYY, DD.MM.YY, 24 Mart 2026, 2026.03.24, vs.
   */
  private normalizeDateString(raw: any): string | null {
    if (!raw || typeof raw !== 'string') return null;
    const s = raw.trim();
    if (!s) return null;

    // Zaten YYYY-MM-DD formatında mı?
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return parseDate(m[3], parseInt(m[2], 10), m[1]);

    // DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY (en yaygın TR fiş formatı)
    m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/);
    if (m) return parseDate(m[1], parseInt(m[2], 10), m[3]);

    // YYYY.MM.DD veya YYYY/MM/DD
    m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
    if (m) return parseDate(m[3], parseInt(m[2], 10), m[1]);

    // 24 Mart 2026
    m = s.match(/^(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]+)\s+(\d{2,4})$/);
    if (m) {
      const mon = TR_MONTHS[m[2].toLowerCase()] ?? 0;
      if (mon) return parseDate(m[1], mon, m[3]);
    }

    // Metin içinde tarih ara (fallback)
    return extractDateFromText(s);
  }

  /** Tek bir Claude modeliyle tarih oku. Başarısızsa null döner. */
  private async claudeOcrOnce(
    model: string,
    b64: string,
    tenantId: string | undefined,
    logSuffix: string,
    opts?: { aggressive?: boolean },
  ): Promise<{ date: string | null; fields: any; rawDate: string | null }> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { date: null, fields: {}, rawDate: null };
    const startMs = Date.now();
    const logUsage = (karar: string, sebep: string, usage?: any) =>
      logAiUsage(this.prisma, {
        tenantId: tenantId || 'unknown',
        source: `fis-yazdirma${logSuffix}`,
        model,
        karar,
        sebep,
        durationMs: Date.now() - startMs,
        usage,
      });

    // 1. Çağrı (Haiku): sade, muhafazakâr
    // 2. Çağrı retry (Sonnet): agresif — görünür tarihi çıkarmaya zorla
    const systemPrompt = opts?.aggressive
      ? 'Sen Türk fiş/fatura görsellerinden BİLGİ ÇIKARMA UZMANISIN. ' +
        'Bu görsel daha önce başka bir modelle denendi ve BAŞARISIZ oldu. Bu yüzden dikkatli ol. ' +
        'Türk ÖKC/yazarkasa fişlerinde tarih GENELDE üst kısımda "TARİH:" etiketinin yanında, ' +
        'DD-MM-YYYY / DD.MM.YYYY / DD/MM/YYYY formatında yazılır (örn: 08-03-2026). ' +
        'Termal fişler soluk olabilir; rakamların çoğunu görebiliyorsan tarihi oku. ' +
        'SADECE tamamen okunamayan / tamamen silik tarih durumunda null dön. ' +
        'Rakamlardan en az bir tanesi seçilemezse o zaman null. ' +
        'Yanıt SADECE JSON: {"tarih":"YYYY-MM-DD" veya null,"belgeNo":"...","cari":"...","toplam":"..."}'
      : 'Sen Türk fiş/fatura görsellerinden bilgi çıkaran bir asistansın. ' +
        'Sadece JSON döndür: {"tarih":"YYYY-MM-DD" veya null,"belgeNo":"...","cari":"...","toplam":"..."}. ' +
        'Tarih net değilse null.';

    const userText = opts?.aggressive
      ? 'Bu fişin tarihini (YYYY-MM-DD), belge numarasını, satıcı/cari firmayı ve toplam tutarı çıkar. ' +
        'Fişin üstüne dikkatle bak — tarih orada olmalı. Rakamları gör ve YYYY-MM-DD olarak dön. ' +
        'Örn: görselde "08-03-2026" yazıyorsa "tarih":"2026-03-08".'
      : 'Bu fişin/faturanın tarihini, belge numarasını, satıcı/cari firmayı ve toplam tutarı çıkar. JSON döndür.';

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 300,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: 'image/jpeg', data: b64 },
                },
                { type: 'text', text: userText },
              ],
            },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        await logUsage('error', `API ${res.status}: ${body.slice(0, 100)}`);
        return { date: null, fields: {}, rawDate: null };
      }
      const j: any = await res.json();
      const text = j?.content?.[0]?.text || '';
      const usage = j?.usage || {};
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        await logUsage('error', `JSON parse fail: ${text.slice(0, 80)}`, usage);
        return { date: null, fields: {}, rawDate: null };
      }
      let parsed: any = {};
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        await logUsage('error', `JSON.parse fail: ${match[0].slice(0, 80)}`, usage);
        return { date: null, fields: {}, rawDate: null };
      }
      const rawDate = parsed.tarih ?? null;
      const normalizedDate = this.normalizeDateString(rawDate);
      await logUsage(
        'ok',
        normalizedDate
          ? `tarih: ${normalizedDate}`
          : `tarih yok (ham: ${String(rawDate ?? 'null').slice(0, 20)})`,
        usage,
      );
      return {
        date: normalizedDate,
        fields: {
          belge_no: parsed.belgeNo || parsed.belge_no || undefined,
          cari: parsed.cari || undefined,
          toplam: parsed.toplam || undefined,
        },
        rawDate,
      };
    } catch (e: any) {
      this.logger.warn(`Claude OCR (${model}) hata: ${e?.message}`);
      await logUsage('error', `Network: ${e?.message || '?'}`);
      return { date: null, fields: {}, rawDate: null };
    }
  }

  /** Görseli OCR için hazırla: auto-rotate + grayscale + kontrast + sharpen + resize. */
  private async prepareOcrImage(buffer: Buffer, width: number, quality: number): Promise<string> {
    const processed = await sharp(buffer)
      .rotate() // EXIF auto-orient
      .resize({ width, withoutEnlargement: true })
      .grayscale() // renk gürültüsü yok, OCR daha iyi
      .normalize() // histogram stretch — soluk termal için kontrast boost
      .sharpen({ sigma: 1.0 }) // kenarları keskinleştir — rakamlar daha belirgin
      .jpeg({ quality })
      .toBuffer();
    return processed.toString('base64');
  }

  /** Claude ile tarih okuma — Sonnet 4.6 primary, başarısızsa farklı prompt ile 2. deneme. */
  private async claudeExtractDate(
    buffer: Buffer,
    tenantId?: string,
    _hintDonem?: string,
  ): Promise<{ date: string | null; fields: any }> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { date: null, fields: {} };

    // Pre-processed hi-res görsel (grayscale+kontrast+sharpen) — Sonnet için optimize
    let b64: string;
    try {
      b64 = await this.prepareOcrImage(buffer, 1600, 85);
    } catch (e: any) {
      this.logger.warn(`Görsel hazırlama hatası: ${e?.message}`);
      return { date: null, fields: {} };
    }

    // 1. Sonnet 4.6 — agresif prompt ile direkt
    const first = await this.claudeOcrOnce(
      'claude-sonnet-4-6',
      b64,
      tenantId,
      '',
      { aggressive: true },
    );
    if (first.date) return { date: first.date, fields: first.fields };

    // 2. Hala null — farklı bir açı dene (zoom: üst kısma odaklan, daha yüksek kalite)
    try {
      const meta = await sharp(buffer).metadata();
      const W = meta.width ?? 1200;
      const H = meta.height ?? 1600;
      // Fişin üst %40'ını crop et — tarih genelde üstte
      const topCrop = await sharp(buffer)
        .rotate()
        .extract({
          left: 0,
          top: 0,
          width: W,
          height: Math.floor(H * 0.4),
        })
        .resize({ width: 1400, withoutEnlargement: true })
        .grayscale()
        .normalize()
        .sharpen({ sigma: 1.2 })
        .jpeg({ quality: 90 })
        .toBuffer();
      const b64Top = topCrop.toString('base64');

      const retry = await this.claudeOcrOnce(
        'claude-sonnet-4-6',
        b64Top,
        tenantId,
        '-retry',
        { aggressive: true },
      );
      if (retry.date) {
        return { date: retry.date, fields: { ...first.fields, ...retry.fields } };
      }
    } catch (e: any) {
      this.logger.debug(`Top-crop retry hatası: ${e?.message}`);
    }

    // İkisi de null — alan bilgilerini yine de döndür
    return { date: null, fields: first.fields };
  }

  async scanImages(
    files: Express.Multer.File[],
    tenantId?: string,
    hintDonem?: string, // "YYYY-MM" — fişlerin bulunduğu dönem
  ): Promise<ScanResult> {
    if (!files || files.length === 0) {
      throw new BadRequestException('En az bir görsel gerekli');
    }

    const useClaude = !!process.env.ANTHROPIC_API_KEY;
    this.logger.log(
      `OCR tarama başlıyor: ${files.length} görsel (${useClaude ? 'Claude Haiku' : 'Tesseract'})${hintDonem ? ` [dönem ipucu: ${hintDonem}]` : ''}`,
    );

    if (useClaude) {
      // Claude path: paralel 3'er işle (Sonnet daha pahalı/yavaş — rate limit dostu)
      const { default: pLimit } = await (Function('return import("p-limit")')() as Promise<{ default: any }>);
      const limit = pLimit(3);
      const detected: ScanDetected[] = [];
      const unread: ScanUnread[] = [];
      const results = await Promise.all(
        files.map((file) =>
          limit(async () => {
            const r = await this.claudeExtractDate(file.buffer, tenantId, hintDonem);
            return { file, ...r };
          }),
        ),
      );
      await Promise.all(
        results.map(async ({ file, date, fields }) => {
          if (date) {
            detected.push({ filename: file.originalname, date, ...fields });
          } else {
            const thumbnail = await this.makeThumbnail(file.buffer);
            unread.push({ filename: file.originalname, thumbnail });
          }
        }),
      );
      detected.sort((a, b) => a.date.localeCompare(b.date));
      this.logger.log(`Claude OCR bitti: ${detected.length}/${files.length}, ${unread.length} teyit`);
      return { detected, unread, total: files.length };
    }

    // Fallback: Tesseract (eski yol)

    const { default: pLimit } = await (Function('return import("p-limit")')() as Promise<{ default: any }>);

    const POOL_SIZE = 3;
    const workers: any[] = await Promise.all(
      Array.from({ length: POOL_SIZE }, () => createWorker(['tur', 'eng'])),
    );

    let workerIdx = 0;
    const limit = pLimit(POOL_SIZE);

    const results: { file: Express.Multer.File; date: string | null; fullText: string }[] = [];

    try {
      const promises = files.map((file) => {
        const wi = workerIdx++ % POOL_SIZE;
        return limit(async () => {
          const { date, fullText } = await this.ocrDateWithWorker(file.buffer, workers[wi]);
          this.logger.log(`${file.originalname}: ${date ?? 'OKUNAMADI'}`);
          return { file, date, fullText };
        });
      });

      results.push(...(await Promise.all(promises)));
    } finally {
      await Promise.all(workers.map((w) => w.terminate().catch(() => {})));
    }

    const detected: ScanDetected[] = [];
    const unread: ScanUnread[] = [];

    await Promise.all(
      results.map(async ({ file, date, fullText }) => {
        if (date) {
          const extra = extractFieldsFromText(fullText);
          detected.push({ filename: file.originalname, date, ...extra });
        } else {
          const thumbnail = await this.makeThumbnail(file.buffer);
          unread.push({ filename: file.originalname, thumbnail });
        }
      }),
    );

    detected.sort((a, b) => a.date.localeCompare(b.date));

    this.logger.log(`Tamamlandı: ${detected.length}/${files.length} okundu, ${unread.length} teyit bekliyor`);

    return { detected, unread, total: files.length };
  }

  generateExcel(rows: ExcelRow[]): Buffer {
    const sheetData = rows.map((r) => {
      let displayDate = r.date;
      if (r.date && r.date.includes('-')) {
        const [y, mo, d] = r.date.split('-');
        displayDate = `${d}.${mo}.${y}`;
      }
      return {
        'Tarih':     displayDate,
        'Fiş No':    r.belge_no ?? '',
        'Cari İsmi': r.cari ?? '',
        'Vergi No':  r.vergi_no ?? '',
        'KDV %1':    r.kdv_1 ?? '',
        'KDV %10':   r.kdv_10 ?? '',
        'KDV %20':   r.kdv_20 ?? '',
        'Toplam':    r.toplam ?? '',
      };
    });

    const ws = XLSX.utils.json_to_sheet(sheetData);

    // Sütun genişlikleri (örneğe göre)
    ws['!cols'] = [
      { wch: 14 }, // Tarih
      { wch: 10 }, // Fiş No
      { wch: 40 }, // Cari İsmi
      { wch: 16 }, // Vergi No
      { wch: 10 }, // KDV %1
      { wch: 10 }, // KDV %10
      { wch: 10 }, // KDV %20
      { wch: 18 }, // Toplam
    ];

    // Başlık satırı stili — mavi arka plan, beyaz kalın yazı
    const headerStyle = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '007BFF' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center' },
    };

    const headerCols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    headerCols.forEach((col) => {
      if (ws[`${col}1`]) {
        ws[`${col}1`].s = headerStyle;
      }
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Excel Dokumu');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  /* ─── Word Çıktı Arşivi ─────────────────────────────────────── */

  /** Oluşturulan Word belgesini DB'ye kaydeder */
  async saveOutput(params: {
    tenantId: string;
    buffer: Buffer;
    filename: string;
    fileCount: number;
    mukellefName?: string;
    donem?: string;
    pagesPerSheet?: number;
    createdBy?: string;
  }) {
    return (this.prisma as any).fisYazdirmaOutput.create({
      data: {
        tenantId: params.tenantId,
        mukellefName: params.mukellefName || null,
        donem: params.donem || null,
        fileCount: params.fileCount,
        pagesPerSheet: params.pagesPerSheet || null,
        filename: params.filename,
        fileBytes: params.buffer,
        fileSize: params.buffer.length,
        createdBy: params.createdBy || null,
      },
      select: {
        id: true,
        tenantId: true,
        mukellefName: true,
        donem: true,
        fileCount: true,
        pagesPerSheet: true,
        filename: true,
        fileSize: true,
        createdAt: true,
      },
    });
  }

  /** Tenant'a ait tüm çıktıları listeler (bayt içeriği hariç) */
  async listOutputs(tenantId: string, limit = 100) {
    return (this.prisma as any).fisYazdirmaOutput.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        mukellefName: true,
        donem: true,
        fileCount: true,
        pagesPerSheet: true,
        filename: true,
        fileSize: true,
        createdAt: true,
      },
    });
  }

  /** Bir çıktıyı (içeriğiyle birlikte) getirir */
  async getOutput(tenantId: string, outputId: string) {
    const rec = await (this.prisma as any).fisYazdirmaOutput.findUnique({
      where: { id: outputId },
    });
    if (!rec || rec.tenantId !== tenantId) return null;
    return rec;
  }

  /** Bir çıktıyı siler */
  async deleteOutput(tenantId: string, outputId: string) {
    const rec = await (this.prisma as any).fisYazdirmaOutput.findUnique({
      where: { id: outputId },
    });
    if (!rec || rec.tenantId !== tenantId) return { deleted: 0 };
    await (this.prisma as any).fisYazdirmaOutput.delete({ where: { id: outputId } });
    return { deleted: 1 };
  }

  async generateWord(
    files: Express.Multer.File[],
    allDates: Record<string, string>,
    opts: { mukellef?: string; donem?: string; pagesPerSheet?: number } = {},
  ): Promise<Buffer> {
    if (!files || files.length === 0) {
      throw new BadRequestException('En az bir görsel gerekli');
    }

    const missing = files.filter((f) => !allDates[f.originalname]);
    if (missing.length > 0) {
      throw new BadRequestException(
        `Şu fişler için tarih eksik: ${missing.map((f) => f.originalname).join(', ')}`,
      );
    }

    // Tarihe göre sırala (eski → yeni)
    const sorted = [...files].sort((a, b) =>
      (allDates[a.originalname] ?? '').localeCompare(allDates[b.originalname] ?? ''),
    );

    // ── Sayfa & Grid Ayarları ─────────────────────────────────
    const PAGE_W_MM  = 215.9;
    const PAGE_H_MM  = 279.4;
    const MARGIN_MM  = 0;
    // pagesPerSheet: 4 (2x2 büyük) / 8 (4x2 - default) / 12 (4x3 küçük)
    const perPage = opts.pagesPerSheet && [4, 8, 12].includes(opts.pagesPerSheet) ? opts.pagesPerSheet : 8;
    const COLS = perPage === 4 ? 2 : 4;
    const ROWS_PER_PAGE = perPage / COLS;
    const PER_PAGE = perPage;

    const pageWTwip  = convertMillimetersToTwip(PAGE_W_MM);
    const pageHTwip  = convertMillimetersToTwip(PAGE_H_MM);
    const usableW    = convertMillimetersToTwip(PAGE_W_MM - 2 * MARGIN_MM);
    const colW       = Math.floor(usableW / COLS);

    // Görsel display genişliği: sütun sayısına göre ayarlanır
    const usableCM = (PAGE_W_MM - 2 * MARGIN_MM) / 10;
    const DISPLAY_W_CM = (usableCM / COLS) - 0.2;
    const DISPLAY_W    = Math.round((DISPLAY_W_CM / 2.54) * 96);

    const emptyCell = (): TableCell =>
      new TableCell({
        borders: NO_BORDER,
        width: { size: colW, type: WidthType.DXA },
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        children: [new Paragraph({ children: [] })],
      });

    // Tüm hücreleri oluştur
    const cells: TableCell[] = await Promise.all(
      sorted.map(async (file) => {
        const embedded = await sharp(file.buffer)
          .rotate() // EXIF auto-orient
          .jpeg({ quality: 95 })
          .toBuffer();

        const meta = await sharp(embedded).metadata();
        const imgW  = meta.width ?? 800;
        const imgH  = meta.height ?? 600;
        const displayH = Math.round(imgH * (DISPLAY_W / imgW));

        const dateStr = allDates[file.originalname] ?? '';
        let displayDate = dateStr;
        if (dateStr.includes('-')) {
          const [y, mo, d] = dateStr.split('-');
          displayDate = `${d}.${mo}.${y}`;
        }

        return new TableCell({
          borders: NO_BORDER,
          width: { size: colW, type: WidthType.DXA },
          verticalAlign: VerticalAlign.BOTTOM,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 0, after: 0 },
              children: [
                new ImageRun({
                  data: embedded,
                  transformation: { width: DISPLAY_W, height: displayH },
                  type: 'jpg',
                }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 20, after: 20 },
              children: [
                new TextRun({ text: displayDate, size: 22, bold: true }),
              ],
            }),
          ],
        });
      }),
    );

    // ── Sayfaları oluştur (her sayfa = PER_PAGE fiş, ayrı Section) ──
    const sections: any[] = [];
    const pageProps = {
      page: {
        size: { width: pageWTwip, height: pageHTwip },
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      },
    };

    // ── Kapak Sayfası (mükellef veya dönem verildiyse) ──
    if (opts.mukellef || opts.donem) {
      const dates = sorted.map((f) => allDates[f.originalname]).filter(Boolean).sort();
      const ilkTarih = dates[0] ? isoDisplay(dates[0]) : '—';
      const sonTarih = dates[dates.length - 1] ? isoDisplay(dates[dates.length - 1]) : '—';
      const coverChildren: any[] = [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 4000, after: 400 },
          children: [
            new TextRun({ text: 'MOREN', bold: true, size: 72, color: '8B7649' }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 800 },
          children: [
            new TextRun({ text: 'MALİ MÜŞAVİRLİK', bold: true, size: 28, color: '8B7649' }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({ text: '—— FİŞ DÖKÜMÜ ——', size: 24, color: '666666' })],
        }),
      ];
      if (opts.mukellef) {
        coverChildren.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 600, after: 100 },
            children: [new TextRun({ text: 'MÜKELLEF', size: 18, color: '999999' })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
            children: [new TextRun({ text: opts.mukellef.toUpperCase(), bold: true, size: 32 })],
          }),
        );
      }
      if (opts.donem) {
        coverChildren.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
            children: [new TextRun({ text: 'DÖNEM', size: 18, color: '999999' })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 800 },
            children: [new TextRun({ text: opts.donem, bold: true, size: 28 })],
          }),
        );
      }
      coverChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 600, after: 100 },
          children: [new TextRun({ text: 'TOPLAM FİŞ', size: 18, color: '999999' })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 600 },
          children: [new TextRun({ text: `${files.length} adet`, bold: true, size: 26 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: `İlk Tarih: ${ilkTarih}   ·   Son Tarih: ${sonTarih}`, size: 20, color: '666666' }),
          ],
        }),
      );
      sections.push({
        properties: {
          page: {
            size: { width: pageWTwip, height: pageHTwip },
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
          },
        },
        children: coverChildren,
      });
    }

    // Sayfaları PER_PAGE'lik gruplara böl
    for (let pageStart = 0; pageStart < cells.length; pageStart += PER_PAGE) {
      const pageCells = cells.slice(pageStart, pageStart + PER_PAGE);
      // Dolgu hücresi ekle (son sayfa eksikse)
      while (pageCells.length < PER_PAGE) pageCells.push(emptyCell());

      const rows: TableRow[] = [];
      for (let r = 0; r < ROWS_PER_PAGE; r++) {
        const rowCells = pageCells.slice(r * COLS, r * COLS + COLS);
        rows.push(new TableRow({ children: rowCells }));
      }

      const table = new Table({
        layout: TableLayoutType.FIXED,
        width: { size: usableW, type: WidthType.DXA },
        rows,
        borders: {
          top:              { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          bottom:           { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          left:             { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          right:            { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          insideVertical:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        },
      });

      sections.push({ properties: pageProps, children: [table] });
    }

    const doc = new Document({ sections });
    return Packer.toBuffer(doc);
  }
}
