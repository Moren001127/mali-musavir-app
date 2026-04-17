import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';

export interface ParsedKdvRow {
  rowIndex: number;
  belgeNo: string | null;
  belgeDate: Date | null;
  karsiTaraf: string | null;
  kdvMatrahi: number | null;
  kdvTutari: number;
  kdvOrani: number | null;
  aciklama: string | null;
  rawData: Record<string, any>;
}

@Injectable()
export class ExcelParserService {
  private readonly logger = new Logger(ExcelParserService.name);

  /**
   * Luca'dan alınan 191/391 muavin defteri Excel dosyasını parse eder.
   * type='191' → KDV tutarı BORÇ sütununda
   * type='391' → KDV tutarı ALACAK sütununda
   */
  parseKdvExcel(buffer: Buffer, type?: '191' | '391'): ParsedKdvRow[] {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, {
      raw: false,
      defval: null,
    });

    // Sütun adlarını normalize et (satır sonu, fazla boşluk kaldır)
    const normalizedRows = rows.map((row) => {
      const normalized: Record<string, any> = {};
      for (const [k, v] of Object.entries(row)) {
        const cleanKey = k.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        normalized[cleanKey] = v;
      }
      return normalized;
    });

    const results: ParsedKdvRow[] = [];

    // 191: BORÇ önce, 391: ALACAK önce
    const is191 = type === '191';
    const kdvPatterns = is191
      ? ['borç', 'borc', 'alacak']        // 191 İndirilecek KDV → BORÇ sütunu
      : ['alacak', 'borç', 'borc'];        // 391 Hesaplanan KDV → ALACAK sütunu

    for (let i = 0; i < normalizedRows.length; i++) {
      const row = normalizedRows[i];
      const keys = Object.keys(row);

      const find = (patterns: string[]): any => {
        // Önce tam eşleşme dene
        for (const p of patterns) {
          const exactKey = keys.find((k) => k.toLowerCase() === p.toLowerCase());
          if (exactKey) return row[exactKey];
        }
        // Sonra içerir kontrolü
        const key = keys.find((k) =>
          patterns.some((p) => k.toLowerCase().includes(p.toLowerCase())),
        );
        return key ? row[key] : null;
      };

      const kdvRaw = find(kdvPatterns);
      const kdvTutari = this.toDecimal(kdvRaw);
      if (kdvTutari === null || kdvTutari === 0) continue;

      // Belge No: Luca Defteri Kebir'de "EVRAK NO" kesin eşleşme önce
      const belgeNo = find([
        'evrak no', 'evrak numarasi', 'belge no', 'fiş no', 'fis no',
        'fatura no', 'belge numarası', 'fiş numarası', 'belge',
      ]);

      // Tarih: "EVRAK TARİHİ" ya da "TARİH"
      const dateRaw = find([
        'evrak tarihi', 'belge tarihi', 'tarih', 'fiş tarihi',
        'fatura tarihi', 'işlem tarihi',
      ]);
      const belgeDate = this.parseDate(dateRaw);

      const karsiTaraf = find([
        'açıklama', 'aciklama', 'hesap adı', 'hesap adi',
        'karşı taraf', 'karsi taraf', 'cari adı', 'cari adi', 'firma',
      ]);

      const kdvMatrahi = this.toDecimal(
        find(['kdv matrahı', 'kdv matrahi', 'matrah']),
      );

      // 'hesap kodu' buraya dahil EDİLMEMELİ — "191.01.001" gibi değerler toDecimal ile taşar
      const kdvOraniRaw = this.toDecimal(find(['kdv oranı', 'kdv orani', 'oran']));
      // Oran 1-100 arasında olmalı; dışındaysa null say
      const kdvOrani = (kdvOraniRaw !== null && kdvOraniRaw >= 1 && kdvOraniRaw <= 100) ? kdvOraniRaw : null;

      // Hesap kodu'ndan KDV oranı çıkar (Ör: "191.01.001" → %1)
      const hesapKodu = String(find(['hesap kodu']) ?? '');
      const extractedOran = kdvOrani ?? this.extractKdvOraniFromHesapKodu(hesapKodu);

      results.push({
        rowIndex: i + 2,
        belgeNo: belgeNo ? String(belgeNo).trim() : null,
        belgeDate,
        karsiTaraf: karsiTaraf ? String(karsiTaraf).trim() : null,
        kdvMatrahi,
        kdvTutari,
        kdvOrani: extractedOran,
        aciklama: karsiTaraf ? String(karsiTaraf).trim() : null,
        rawData: this.sanitizeRawData(row),
      });
    }

    this.logger.log(`KDV Excel (${type ?? 'auto'}) parse: ${results.length} satır bulundu.`);
    return results;
  }

  /**
   * Luca işletme defteri (Gelir/Gider sayfası) Excel parse eder.
   */
  parseIsletmeExcel(
    buffer: Buffer,
    type: 'ISLETME_GELIR' | 'ISLETME_GIDER',
  ): ParsedKdvRow[] {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, {
      raw: false,
      defval: null,
    });

    // Sütun adlarını normalize et
    const rows = rawRows.map((row) => {
      const normalized: Record<string, any> = {};
      for (const [k, v] of Object.entries(row)) {
        const cleanKey = k.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        normalized[cleanKey] = v;
      }
      return normalized;
    });

    const results: ParsedKdvRow[] = [];
    const isGelir = type === 'ISLETME_GELIR';

    // Tam sütun adları önce, sonra kısmi eşleşme
    const tutarPatterns = isGelir
      ? [
          'Hesaplanan K.D.V.', 'hesaplanan k.d.v.',
          'hesaplanan k.d.v', 'hesaplanan kdv', 'hesaplanan',
          'k.d.v', 'hasılat', 'hasilat', 'alacak', 'tutar', 'net tutar',
        ]
      : [
          'İndirilecek K.D.V.', 'indirilecek k.d.v.',
          'indirilecek k.d.v', 'indirilecek kdv', 'indirilecek',
          'k.d.v', 'borç', 'borc', 'tutar', 'net tutar',
        ];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const keys = Object.keys(row);

      const find = (patterns: string[]): any => {
        // Önce büyük/küçük harf duyarsız TAM eşleşme
        for (const p of patterns) {
          const exactKey = keys.find((k) => k.toLowerCase() === p.toLowerCase());
          if (exactKey) return row[exactKey];
        }
        // Sonra içerir
        const key = keys.find((k) =>
          patterns.some((p) => k.toLowerCase().includes(p.toLowerCase())),
        );
        return key ? row[key] : null;
      };

      const tutarRaw = find(tutarPatterns);
      const tutar = this.toDecimal(tutarRaw);
      if (tutar === null || tutar === 0) continue;

      const belgeNo = find([
        'evrak no', 'belge no', 'fiş no', 'fatura no',
        'sıra no', 'sira no', 'kayıt no', 'kayit no', 'no',
      ]);

      const dateRaw = find([
        'tarih', 'belge tarihi', 'fiş tarihi', 'fatura tarihi', 'işlem tarihi',
      ]);

      const karsiTaraf = find([
        'açıklama', 'aciklama',
        'karşı taraf', 'karsi taraf', 'ticari unvan', 'müşteri', 'musteri',
        'tedarikçi', 'tedarikci', 'cari adı', 'cari adi', 'firma',
      ]);

      results.push({
        rowIndex: i + 2,
        belgeNo: belgeNo ? String(belgeNo).trim() : null,
        belgeDate: this.parseDate(dateRaw),
        karsiTaraf: karsiTaraf ? String(karsiTaraf).trim() : null,
        kdvMatrahi: null,
        kdvTutari: tutar,
        kdvOrani: null,
        aciklama: karsiTaraf ? String(karsiTaraf).trim() : null,
        rawData: this.sanitizeRawData(row),
      });
    }

    this.logger.log(
      `İşletme ${isGelir ? 'Gelir' : 'Gider'} Excel parse: ${results.length} satır bulundu.`,
    );
    if (results.length === 0 && rows.length > 0) {
      const firstRowKeys = Object.keys(rows[0]).join(', ');
      this.logger.warn(`Hiç satır okunamadı. İlk satır sütunları: ${firstRowKeys}`);
    }
    return results;
  }

  /** Parse edilen Excel'den tespit edilen sütun başlıklarını döner */
  detectColumns(buffer: Buffer): string[] {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { raw: false, defval: null });
    if (!rows.length) return [];
    return Object.keys(rows[0]).map((k) =>
      k.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim(),
    );
  }

  /** "191.01.001" → 1, "191.01.004" → 20, "191.01.005" → 10 */
  private extractKdvOraniFromHesapKodu(kod: string): number | null {
    const map: Record<string, number> = {
      '001': 1, '002': 8, '003': 18, '004': 20, '005': 10,
    };
    const suffix = kod.slice(-3);
    return map[suffix] ?? null;
  }

  /** rawData'yı Prisma JSON'una uygun hale getirir (Date, NaN, Infinity temizler) */
  private sanitizeRawData(raw: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v === null || v === undefined) out[k] = null;
      else if (v instanceof Date) out[k] = isNaN(v.getTime()) ? null : v.toISOString();
      else if (typeof v === 'number') out[k] = isFinite(v) ? v : null;
      else out[k] = String(v);
    }
    return out;
  }

  /**
   * Excel hücresinden para tutarı parse eder.
   *
   * ☠️ KRİTİK BUG FIX:
   * xlsx library raw:false ile bazen number bazen string döndürür. Eski kod
   * daima String(val) yapıp noktaları siliyordu:
   *   1436.02 (number) → "1436.02" → "143602" → 143602  ☠ 100x şişirme
   *
   * Yeni yaklaşım:
   *  - val number ise direkt kullan (noktaları sil deme).
   *  - val string ise TR/EN format'ını son ayırıcıdan tespit et:
   *      "1.234,56" TR  → son ayırıcı "," → binlik=. decimal=,
   *      "1,234.56" EN  → son ayırıcı "." → binlik=, decimal=.
   *      "1,44"     TR  → sadece ","      → decimal=,
   *      "39.230"   TR  → tek nokta+3basamak → binlik (39230)
   *      "1.44"     EN  → tek nokta+2basamak → decimal (1.44)
   */
  toDecimal(val: any): number | null {
    if (val === null || val === undefined || val === '') return null;

    if (typeof val === 'number') {
      return Number.isFinite(val) ? Math.abs(val) : null;
    }

    const raw = String(val).trim();
    if (!raw) return null;

    const hasDot = raw.includes('.');
    const hasComma = raw.includes(',');
    let cleaned: string;

    if (hasDot && hasComma) {
      const lastDot = raw.lastIndexOf('.');
      const lastComma = raw.lastIndexOf(',');
      if (lastComma > lastDot) {
        // TR: 1.234,56
        cleaned = raw.replace(/\./g, '').replace(',', '.');
      } else {
        // EN: 1,234.56
        cleaned = raw.replace(/,/g, '');
      }
    } else if (hasComma) {
      // TR ondalık: "1,44" → 1.44
      cleaned = raw.replace(',', '.');
    } else if (hasDot) {
      // Tek nokta: binlik mi ondalık mı? Heuristik.
      const m = raw.match(/^(\d+)\.(\d+)$/);
      if (m && m[2].length === 3 && m[1].length <= 3 && !raw.includes('-')) {
        // "39.230", "1.436" → binlik
        cleaned = m[1] + m[2];
      } else {
        // "1.44", "1436.02" → ondalık
        cleaned = raw;
      }
    } else {
      cleaned = raw;
    }

    cleaned = cleaned.replace(/[^\d.-]/g, '');
    const num = parseFloat(cleaned);
    if (isNaN(num)) {
      this.logger.warn(`toDecimal parse hata: "${raw}" → "${cleaned}"`);
      return null;
    }
    return Math.abs(num);
  }

  parseDate(val: any): Date | null {
    if (!val) return null;
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val;

    const str = String(val).trim();

    // DD.MM.YYYY veya DD/MM/YYYY veya DD-MM-YYYY
    const trMatch = str.match(/^(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{4})$/);
    if (trMatch) {
      const d = new Date(`${trMatch[3]}-${trMatch[2].padStart(2, '0')}-${trMatch[1].padStart(2, '0')}`);
      return isNaN(d.getTime()) ? null : d;
    }

    // YYYY-MM-DD (ISO)
    const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const d = new Date(str.slice(0, 10));
      return isNaN(d.getTime()) ? null : d;
    }

    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }
}
