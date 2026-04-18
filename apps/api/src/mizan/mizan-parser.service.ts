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
    // raw: true ile sayısal hücreleri JS number olarak al — Türkçe binlik
    // ayracı (.) ve ondalık virgül (,) formatlama sorunlarını önler.
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const grid: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: null,
    });

    // ── BAŞLIK SATIRI OTOMATİK TESPİT ──────────────────────────
    // Luca ve diğer programların Excel'leri genelde üstte firma bilgisi,
    // dönem, kapak satırları içerir. Gerçek başlık 2-10. satır arasında
    // olabilir. İçinde hem "hesap/kod" hem "borç/alacak" geçen ilk satırı
    // başlık olarak kabul ederiz.
    const MAX_SCAN = Math.min(20, grid.length);
    let headerRowIdx = -1;
    for (let i = 0; i < MAX_SCAN; i++) {
      const row = grid[i];
      if (!row || row.length === 0) continue;
      const cells = row.map((c) => String(c ?? '').toLowerCase());
      const hasKod = cells.some((c) => /hesap|kod/.test(c));
      const hasBorc = cells.some((c) => /bor[çc]/.test(c));
      const hasAlacak = cells.some((c) => /alacak/.test(c));
      if (hasKod && (hasBorc || hasAlacak)) {
        headerRowIdx = i;
        break;
      }
    }

    if (headerRowIdx === -1) {
      // Hiçbir başlık satırı bulunamadı — detaylı hata ver
      const firstFewRows = grid
        .slice(0, 5)
        .map((r, i) => `Satır ${i + 1}: ${(r || []).slice(0, 6).join(' | ')}`)
        .join('\n');
      this.logger.warn(
        `Mizan başlık satırı bulunamadı. İlk 5 satır:\n${firstFewRows}`,
      );
      throw new Error(
        'Mizan Excel dosyasında başlık satırı bulunamadı. ' +
          'Beklenen sütunlar: "Hesap Kodu", "Hesap Adı", "Borç Toplamı", "Alacak Toplamı". ' +
          'Dosyanın Luca\'dan standart mizan formatında indirildiğinden emin olun.',
      );
    }

    // Başlığı normalize et
    const headers = (grid[headerRowIdx] || []).map((h) =>
      String(h ?? '').replace(/\s+/g, ' ').trim().toLowerCase(),
    );

    // Başlıktan sonraki satırları obje olarak dönüştür
    const rows: Record<string, any>[] = [];
    for (let i = headerRowIdx + 1; i < grid.length; i++) {
      const row = grid[i];
      if (!row || row.every((c) => c == null || String(c).trim() === '')) {
        continue; // boş satırları atla
      }
      const obj: Record<string, any> = {};
      headers.forEach((h, j) => {
        if (h) obj[h] = row[j];
      });
      rows.push(obj);
    }

    this.logger.log(
      `Mizan başlık ${headerRowIdx + 1}. satırda bulundu. Sütunlar: ${headers.filter(Boolean).join(' · ')}`,
    );
    // Örnek — ilk veri satırının tüm hücrelerini logla (debug)
    if (rows.length > 0) {
      const sample = rows[0];
      this.logger.log(
        `Örnek satır 1: ${JSON.stringify(sample)}`,
      );
    }

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
        find([/bor[çc]\s*toplam/, /^bor[çc]$/, /^bor[çc]\s/]),
      );
      const alacakToplami = this.toDecimal(
        find([/alacak\s*toplam/, /^alacak$/, /^alacak\s/]),
      );
      let borcBakiye = this.toDecimal(
        find([/bor[çc]\s*bak[iı]y/, /bakiye.*bor[çc]/, /^bb$/, /bor[çc]\s*kal/]),
      );
      let alacakBakiye = this.toDecimal(
        find([/alacak\s*bak[iı]y/, /bakiye.*alacak/, /^ab$/, /alacak\s*kal/]),
      );

      // Bakiye sütunları dolmamışsa (merged cell veya farklı format) —
      // standart mizan mantığı ile borç toplam - alacak toplam farkından
      // türet. Borç > alacak ise borç bakiyesi, aksi halde alacak bakiyesi.
      if (borcBakiye === 0 && alacakBakiye === 0) {
        const fark = borcToplami - alacakToplami;
        if (fark > 0) borcBakiye = fark;
        else if (fark < 0) alacakBakiye = Math.abs(fark);
      }

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

    // 1) Değer zaten number ise direkt kullan (raw: true sayesinde genelde böyle)
    if (typeof val === 'number') {
      return Number.isFinite(val) ? val : 0;
    }

    // 2) String ise — Türkçe/İngilizce formatı akıllıca ayırt et:
    //    Hem nokta hem virgül varsa: sonuncu hangisiyse ondalık, diğeri binlik.
    //    Sadece virgül varsa: virgül ondalıktır.
    //    Sadece nokta varsa: noktanın sayı konumuna göre karar ver.
    let str = String(val).trim().replace(/\s/g, '');
    // Sadece işaret karakterlerini temizle (rakam, nokta, virgül, eksi kalsın)
    str = str.replace(/[^\d.,\-]/g, '');
    if (!str) return 0;

    const lastDot = str.lastIndexOf('.');
    const lastComma = str.lastIndexOf(',');

    if (lastDot !== -1 && lastComma !== -1) {
      // Hem nokta hem virgül var — sonuncusu ondalık
      if (lastComma > lastDot) {
        // "245.260,17" Türkçe: nokta binlik, virgül ondalık
        str = str.replace(/\./g, '').replace(',', '.');
      } else {
        // "245,260.17" İngilizce: virgül binlik, nokta ondalık
        str = str.replace(/,/g, '');
      }
    } else if (lastComma !== -1) {
      // Sadece virgül — ondalık kabul et ("245,26" → "245.26")
      str = str.replace(',', '.');
    } else if (lastDot !== -1) {
      // Sadece nokta — noktadan sonra 3 hane varsa binlik ayracı ("245.260"),
      // 1-2 hane varsa ondalık ("245.26")
      const afterDot = str.substring(lastDot + 1).length;
      if (afterDot === 3 && str.indexOf('.') === lastDot) {
        // Tek nokta + 3 hane → binlik ayracı
        str = str.replace(/\./g, '');
      }
      // Aksi halde nokta ondalık olarak kalsın (zaten JS native)
    }

    const n = parseFloat(str);
    return Number.isFinite(n) ? n : 0;
  }
}
