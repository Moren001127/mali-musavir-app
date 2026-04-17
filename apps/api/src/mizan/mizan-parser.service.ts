/**
 * Luca'dan indirilen mizan Excel dosyasını parse eder.
 *
 * Beklenen Luca mizan başlıkları (esnek eşleşme):
 *   Hesap Kodu | Hesap Adı | Borç Toplamı | Alacak Toplamı | Borç Bakiye | Alacak Bakiye
 *
 * Luca sürümleri arasında sütun isimleri değişebilir — burada regex ile
 * tanınmaya çalışılır.
 */
import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';

export interface ParsedMizanRow {
  rowIndex: number;
  hesapKodu: string;
  hesapAdi: string;
  seviye: number; // 0 = ana hesap, 1 = alt, 2+ = detay
  borcToplami: number;
  alacakToplami: number;
  borcBakiye: number;
  alacakBakiye: number;
}

@Injectable()
export class MizanParserService {
  private readonly logger = new Logger(MizanParserService.name);

  parse(buffer: Buffer): ParsedMizanRow[] {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw: any[] = XLSX.utils.sheet_to_json(sheet, { raw: false, defval: null });

    // Başlıkları normalize et
    const rows = raw.map((r) => {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(r)) {
        const cleanK = String(k).replace(/\s+/g, ' ').trim().toLowerCase();
        out[cleanK] = v;
      }
      return out;
    });

    const results: ParsedMizanRow[] = [];
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const keys = Object.keys(row);

      // Esnek alan bulucu — patterns her dil/sıra ile eşleşsin
      const find = (patterns: RegExp[]): any => {
        const k = keys.find((key) => patterns.some((p) => p.test(key)));
        return k ? row[k] : null;
      };

      const hesapKodu = String(
        find([/^hesap\s*kod/, /^kod/, /^h\.?\s*kod/]) ?? '',
      ).trim();
      if (!hesapKodu || !/^\d/.test(hesapKodu)) {
        skipped++;
        continue;
      }

      const hesapAdi = String(
        find([/^hesap\s*ad/, /^ad[ıi]/, /hesap.*a[çc][ıi]klam/i]) ?? '',
      ).trim();

      const borcToplami = this.toDecimal(
        find([/bor[çc]\s*toplam/, /bor[çc]$/, /^bor[çc]/]),
      );
      const alacakToplami = this.toDecimal(
        find([/alacak\s*toplam/, /alacak$/, /^alacak/]),
      );
      const borcBakiye = this.toDecimal(
        find([/bor[çc]\s*bak[iı]y/, /bakiye.*bor[çc]/, /^bb$/]),
      );
      const alacakBakiye = this.toDecimal(
        find([/alacak\s*bak[iı]y/, /bakiye.*alacak/, /^ab$/]),
      );

      // Hiçbir tutar yoksa geç
      if (
        borcToplami === 0 &&
        alacakToplami === 0 &&
        borcBakiye === 0 &&
        alacakBakiye === 0
      ) {
        continue;
      }

      // Seviye: "100" → 0, "100.01" → 1, "100.01.001" → 2
      const seviye = (hesapKodu.match(/\./g) || []).length;

      results.push({
        rowIndex: i + 2,
        hesapKodu,
        hesapAdi,
        seviye,
        borcToplami,
        alacakToplami,
        borcBakiye,
        alacakBakiye,
      });
    }

    this.logger.log(
      `Mizan parse: ${results.length} hesap satırı · ${skipped} başlık/bilinmeyen satır atlandı`,
    );
    return results;
  }

  private toDecimal(val: any): number {
    if (val == null || val === '') return 0;
    const str = String(val)
      .replace(/\s/g, '')
      .replace(/\./g, '') // Türkçe binlik
      .replace(',', '.') // ondalık
      .replace(/[^\d.\-]/g, '');
    const n = parseFloat(str);
    return isNaN(n) ? 0 : n;
  }
}
