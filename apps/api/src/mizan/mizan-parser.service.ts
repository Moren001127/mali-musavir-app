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

    // Tüm sheet'leri tara — en çok satırı olanı seç (Luca bazen ilk sheet'i
    // kapak/info için kullanır, asıl mizan ikinci sheet'te olabilir)
    let bestSheet: any = null;
    let bestGrid: any[][] = [];
    let bestSheetName = '';
    for (const name of wb.SheetNames) {
      const sh = wb.Sheets[name];
      const g: any[][] = XLSX.utils.sheet_to_json(sh, {
        header: 1, raw: true, defval: null,
      });
      const dolulukSayisi = g.filter((r) => r && r.some((c) => c != null && String(c).trim() !== '')).length;
      this.logger.log(`Sheet "${name}": ${g.length} satır, ${dolulukSayisi} dolu`);
      if (dolulukSayisi > bestGrid.filter((r) => r && r.some((c) => c != null)).length) {
        bestSheet = sh;
        bestGrid = g;
        bestSheetName = name;
      }
    }
    const sheet = bestSheet || wb.Sheets[wb.SheetNames[0]];
    const grid: any[][] = bestGrid.length > 0 ? bestGrid : XLSX.utils.sheet_to_json(sheet, {
      header: 1, raw: true, defval: null,
    });
    this.logger.log(`Mizan parse: sheet="${bestSheetName || wb.SheetNames[0]}" seçildi · ${wb.SheetNames.length} sheet toplam (${wb.SheetNames.join(', ')})`);

    // ── BAŞLIK SATIRI OTOMATİK TESPİT ──────────────────────────
    // Luca mizan Excel formatı:
    //   Satır 1-2: "MİZAN" başlık + firma adı (merge edilmiş)
    //   Satır 3-4: Dönem / Tarih Aralığı
    //   Satır 5: boş
    //   Satır 6: HESAP KODU | HESAP ADI | (boş) | BORÇ | ALACAK | BORÇ BAKİYESİ | ALACAK BAKİYESİ
    //   Satır 7+: veriler
    // Türkçe locale toLowerCase için tr-TR kullanıyoruz (İ → i sorununu önler).
    const MAX_SCAN = Math.min(50, grid.length);
    let headerRowIdx = -1;
    for (let i = 0; i < MAX_SCAN; i++) {
      const row = grid[i];
      if (!row || row.length === 0) continue;
      const cells = row.map((c) => String(c ?? '').toLocaleLowerCase('tr-TR').trim());
      const hasKod = cells.some((c) => /hesap.*kod|^kod\b|hesap_kod|kodu/.test(c));
      const hasAd = cells.some((c) => /hesap.*ad[ıi]?|^ad[ıi]?\b|ad[ıi]/.test(c));
      const hasBorc = cells.some((c) => /bor[çc]/.test(c));
      const hasAlacak = cells.some((c) => /alacak/.test(c));
      const hasBakiye = cells.some((c) => /bakiye/.test(c));
      if ((hasKod || hasAd) && (hasBorc || hasAlacak || hasBakiye)) {
        headerRowIdx = i;
        this.logger.log(`Mizan başlık satırı: index=${i} (S${i+1}) · cells=[${cells.filter(c=>c).slice(0,8).join(' | ')}]`);
        break;
      }
    }

    // ── FALLBACK: Hesap kodu pattern tabanlı tespit ──
    // Eğer üst başlıklar bulunamadıysa, mizan veri satırlarına bakalım.
    // Mizan'da hesap kodları pattern'i: 1, 10, 100, 100.01, 100.01.001 (sayı veya nokta-ayırılmış kademeli)
    // Bu satırlardan ÖNCEKİ ilk dolu satır büyük olasılıkla başlıktır.
    if (headerRowIdx === -1) {
      const isHesapKoduRow = (row: any[]): boolean => {
        if (!row || row.length === 0) return false;
        // İlk dolu hücre hesap kodu pattern'ine uyuyor mu?
        for (let c = 0; c < Math.min(3, row.length); c++) {
          const v = String(row[c] ?? '').trim();
          if (!v) continue;
          // 1, 10, 100, 100.01, 100.01.001 gibi
          if (/^\d{1,3}(\.\d{1,3})*(\.[A-Za-z0-9]{1,8})*$/.test(v)) return true;
          return false;
        }
        return false;
      };

      let firstDataRowIdx = -1;
      for (let i = 0; i < MAX_SCAN; i++) {
        if (isHesapKoduRow(grid[i])) {
          firstDataRowIdx = i;
          break;
        }
      }

      if (firstDataRowIdx > 0) {
        // Bir önceki dolu satırı header kabul et
        for (let i = firstDataRowIdx - 1; i >= 0; i--) {
          const row = grid[i];
          if (row && row.some((c) => c != null && String(c).trim() !== '')) {
            headerRowIdx = i;
            this.logger.log(`Mizan başlık (fallback): index=${i} (S${i+1}) — hesap kodu satırı S${firstDataRowIdx+1}'in öncesi`);
            break;
          }
        }
        // Header bulunmazsa, varsayılan kolon yapısı kullan ve veri satırından başla
        if (headerRowIdx === -1) {
          headerRowIdx = firstDataRowIdx - 1;  // varsayılan
          this.logger.warn(`Mizan başlık tahmin edilemedi, varsayılan kolon yapısı kullanılıyor. Veri S${firstDataRowIdx+1}'den başlar.`);
        }
      }
    }

    if (headerRowIdx === -1) {
      // Hiçbir başlık satırı bulunamadı — TÜM dolu satırları hata mesajına ekle
      const dumpRows = grid
        .slice(0, Math.min(30, grid.length))
        .map((r, i) => {
          const cells = (r || []).map((c) => String(c ?? '').trim()).filter((c) => c);
          return cells.length > 0 ? `S${i + 1}: ${cells.slice(0, 12).join(' | ')}` : null;
        })
        .filter(Boolean)
        .join(' || ');
      this.logger.warn(`Mizan başlık satırı bulunamadı. Sheet=${bestSheetName} · Dolu satırlar:\n${dumpRows}`);
      throw new Error(
        `Mizan Excel'de başlık satırı bulunamadı. Sheet="${bestSheetName}". Dolu satırlar (ilk 30): ${dumpRows.slice(0, 2000)}`,
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

      // Luca formatı: tek "Bakiye" sütunu varsa (Borç Bakiye - Alacak Bakiye birleşik)
      // negatif/pozitif değere göre borç/alacak ayrımı yap
      if (borcBakiye === 0 && alacakBakiye === 0) {
        const tekBakiye = this.toDecimal(find([/^bakiye$/, /^bakıye$/, /^bak[iı]y/]));
        if (tekBakiye > 0) borcBakiye = tekBakiye;
        else if (tekBakiye < 0) alacakBakiye = Math.abs(tekBakiye);
      }

      // Hâlâ boşsa: borç toplam - alacak toplam farkından türet
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
