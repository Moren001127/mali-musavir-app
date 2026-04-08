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
   * Farklı sütun isimleri için esnek mapping uygular.
   */
  parseKdvExcel(buffer: Buffer): ParsedKdvRow[] {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, {
      raw: false,
      defval: null,
    });

    const results: ParsedKdvRow[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const keys = Object.keys(row);

      const find = (patterns: string[]): any => {
        const key = keys.find((k) =>
          patterns.some((p) => k.toLowerCase().includes(p.toLowerCase())),
        );
        return key ? row[key] : null;
      };

      const kdvRaw = find([
        'kdv tutarı', 'kdv tutar', 'kdv', 'vergi tutarı',
        'vergi', 'alacak', 'borc', 'borç',
      ]);
      const kdvTutari = this.toDecimal(kdvRaw);
      if (kdvTutari === null || kdvTutari === 0) continue;

      const belgeNo = find([
        'belge no', 'fiş no', 'fatura no', 'evrak no',
        'belge numarası', 'fiş numarası', 'belge',
      ]);

      const dateRaw = find([
        'tarih', 'belge tarihi', 'fiş tarihi', 'fatura tarihi', 'işlem tarihi',
      ]);

      const belgeDate = this.parseDate(dateRaw);

      const karsiTaraf = find([
        'karşı taraf', 'karsi taraf', 'cari adı', 'cari adi',
        'firma', 'mükellef', 'açıklama 2', 'aciklama2',
      ]);

      const kdvMatrahi = this.toDecimal(
        find(['kdv matrahı', 'kdv matrahi', 'matrah', 'tutar']),
      );

      const kdvOrani = this.toDecimal(
        find(['kdv oranı', 'kdv orani', 'oran', '%']),
      );

      const aciklama = find([
        'açıklama', 'aciklama', 'hesap adı', 'hesap adi', 'anlatım',
      ]);

      results.push({
        rowIndex: i + 2,
        belgeNo: belgeNo ? String(belgeNo).trim() : null,
        belgeDate,
        karsiTaraf: karsiTaraf ? String(karsiTaraf).trim() : null,
        kdvMatrahi,
        kdvTutari,
        kdvOrani,
        aciklama: aciklama ? String(aciklama).trim() : null,
        rawData: row,
      });
    }

    this.logger.log(`KDV Excel parse: ${results.length} satır bulundu.`);
    return results;
  }

  /**
   * Luca işletme defteri (Gelir/Gider sayfası) Excel parse eder.
   * Tutar sütunu kdvTutari alanına map edilir; KDV alanları null bırakılır.
   */
  parseIsletmeExcel(
    buffer: Buffer,
    type: 'ISLETME_GELIR' | 'ISLETME_GIDER',
  ): ParsedKdvRow[] {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, {
      raw: false,
      defval: null,
    });

    const results: ParsedKdvRow[] = [];
    const isGelir = type === 'ISLETME_GELIR';

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const keys = Object.keys(row);

      const find = (patterns: string[]): any => {
        const key = keys.find((k) =>
          patterns.some((p) => k.toLowerCase().includes(p.toLowerCase())),
        );
        return key ? row[key] : null;
      };

      // Tutar sütunları — önce türe özgü, sonra genel
      // Luca işletme defteri: Gelir → "Hesaplanan K.D.V.", Gider → "İndirilecek K.D.V."
      const tutarPatterns = isGelir
        ? ['hesaplanan k.d.v', 'hesaplanan kdv', 'hesaplanan', 'k.d.v', 'gelir', 'hasılat', 'hasilat', 'alacak', 'tutar', 'net tutar', 'meblağ']
        : ['indirilecek k.d.v', 'indirilecek kdv', 'indirilecek', 'k.d.v', 'gider', 'maliyet', 'borç', 'borc', 'tutar', 'net tutar', 'meblağ'];

      const tutarRaw = find(tutarPatterns);
      const tutar = this.toDecimal(tutarRaw);
      if (tutar === null || tutar === 0) continue;

      const belgeNo = find([
        'belge no', 'evrak no', 'fiş no', 'fatura no',
        'sıra no', 'sira no', 'kayıt no', 'kayit no', 'no',
      ]);

      const dateRaw = find([
        'tarih', 'belge tarihi', 'fiş tarihi', 'fatura tarihi', 'işlem tarihi',
      ]);

      const karsiTaraf = find([
        'karşı taraf', 'karsi taraf', 'ticari unvan', 'müşteri', 'musteri',
        'tedarikçi', 'tedarikci', 'cari adı', 'cari adi', 'firma',
      ]);

      const aciklama = find([
        'açıklama', 'aciklama', 'hesap adı', 'hesap adi',
        'işlem açıklaması', 'islem aciklamasi', 'anlatım',
      ]);

      results.push({
        rowIndex: i + 2,
        belgeNo: belgeNo ? String(belgeNo).trim() : null,
        belgeDate: this.parseDate(dateRaw),
        karsiTaraf: karsiTaraf ? String(karsiTaraf).trim() : null,
        kdvMatrahi: null,
        kdvTutari: tutar,
        kdvOrani: null,
        aciklama: aciklama ? String(aciklama).trim() : null,
        rawData: row,
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

  /** Parse edilen Excel'den tespit edilen sütun başlıklarını döner (önizleme için) */
  detectColumns(buffer: Buffer): string[] {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { raw: false, defval: null });
    if (!rows.length) return [];
    return Object.keys(rows[0]);
  }

  private toDecimal(val: any): number | null {
    if (val === null || val === undefined || val === '') return null;
    const str = String(val)
      .replace(/\./g, '')
      .replace(',', '.')
      .replace(/[^\d.-]/g, '');
    const num = parseFloat(str);
    return isNaN(num) ? null : Math.abs(num);
  }

  private parseDate(val: any): Date | null {
    if (!val) return null;
    if (val instanceof Date) return val;

    const str = String(val).trim();
    const trMatch = str.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    if (trMatch) {
      return new Date(`${trMatch[3]}-${trMatch[2].padStart(2, '0')}-${trMatch[1].padStart(2, '0')}`);
    }

    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }
}
