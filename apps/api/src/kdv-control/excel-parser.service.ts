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

      // ─── ÖZEL SATIR FİLTRESİ ───
      // Luca Defteri Kebir Excel'inde "NAKLİ YEKÜN" (devir bakiyesi) ve "Toplam:"
      // satırları KDV sütunu doluysa yanlışlıkla kayıt olarak alınır.
      // Bunlar transaction değil — TARIH/MADDE NO/EVRAK NO boş olur,
      // AÇIKLAMA "NAKLİ YEKÜN" / "TOPLAM" / "GENEL TOPLAM" içerir.
      const aciklamaText = String(
        find(['açıklama', 'aciklama', 'hesap adı', 'hesap adi']) ?? '',
      ).toLocaleUpperCase('tr-TR').trim();
      const tarihMissing = !belgeDate;
      const madeNo = find(['madde no', 'maddeno']);
      const fisNo = find(['fiş no', 'fis no']);
      const isHeaderOrSummaryRow =
        // Devir bakiyesi
        /^NAKL[İI]\s*YEK[ÜU]N/.test(aciklamaText) ||
        // Toplam / Genel Toplam
        /^TOPLAM[:\s]?/.test(aciklamaText) ||
        /^GENEL\s+TOPLAM/.test(aciklamaText) ||
        // Hesap başlığı (örn: "191 İNDİRİLECEK KATMA DEĞER VERGİSİ")
        /^\d{3}\s+[A-ZÇĞİÖŞÜ]/.test(aciklamaText);

      // Transaction kabul kriteri: TARIH dolu VE (madde no veya fiş no) dolu
      const looksLikeTransaction =
        !!belgeDate && (madeNo || fisNo || belgeNo);

      if (isHeaderOrSummaryRow || tarihMissing || !looksLikeTransaction) {
        this.logger.debug(
          `Satır atlandı (header/özet/devir): row=${i + 2} aciklama="${aciklamaText.slice(0, 40)}" tarih=${tarihMissing ? 'YOK' : 'var'}`,
        );
        continue;
      }

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
   * Luca işletme defteri (Gelir/Gider Listesi) Excel parse eder.
   *
   * Excel formatı:
   *   Satır 1-2: Başlık (GELİR GİDER LİSTESİ)
   *   Satır 4-5: Metadata (İşyerinin Unvanı, Dönem)
   *   Satır 6: Boş
   *   Satır 7: Bölüm başlığı (GİDERLER / GELİRLER)
   *   Satır 8: Boş
   *   Satır 9: Header (Evrak No | Tarih | Açıklama | Gider/Hasılat | Alınan Emtia | İndirilecek/Hesaplanan K.D.V. | KREDİLİ TUTAR)
   *   Satır 10+: Veri satırları
   *   Son satır: TOPLAM : ...
   *
   * Header satırını dinamik olarak tespit ederiz (Evrak No + Tarih + Açıklama içeren satır).
   */
  parseIsletmeExcel(
    buffer: Buffer,
    type: 'ISLETME_GELIR' | 'ISLETME_GIDER',
  ): ParsedKdvRow[] {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // header:1 → her satır array olarak gelir (sütun adları yok)
    const matrix: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: null,
      blankrows: false,
    });

    const isGelir = type === 'ISLETME_GELIR';
    const results: ParsedKdvRow[] = [];

    // Türkçe karakter normalizasyonu
    const norm = (v: any): string =>
      String(v ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '') // combining marks
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleLowerCase('tr-TR');

    // Excel YAPISIYLA İLGİLİ NOT:
    //   Aynı dosyada hem GİDERLER hem GELİRLER bölümü var.
    //   GİDERLER header'ı: ... | Gider | Alınan Emtia | İndirilecek K.D.V. | KREDİLİ TUTAR
    //   GELİRLER header'ı: ... | Gelir | Satılan Emtia | Hesaplanan K.D.V. | KREDİLİ TUTAR
    //   Type'a göre doğru bölümün header satırını seçeriz.

    // 1) Aday header satırlarını bul.
    // Header satırı = "İndirilecek K.D.V." VEYA "Hesaplanan K.D.V." içeren satır.
    // (Evrak No / Tarih / Açıklama merge'lenmiş ya da farklı yazılmış olabilir.)
    type HeaderInfo = {
      idx: number;
      hasIndirilecek: boolean;
      hasHesaplanan: boolean;
      cells: string[];
    };
    const headers: HeaderInfo[] = [];
    for (let i = 0; i < matrix.length; i++) {
      const row = matrix[i] || [];
      const cells = row.map(norm);
      const hasIndirilecek = cells.some((c) => c.includes('indirilecek'));
      const hasHesaplanan = cells.some((c) => c.includes('hesaplanan'));
      if (hasIndirilecek || hasHesaplanan) {
        headers.push({
          idx: i,
          hasIndirilecek,
          hasHesaplanan,
          cells,
        });
      }
    }

    if (headers.length === 0) {
      this.logger.warn(
        `İşletme ${isGelir ? 'Gelir' : 'Gider'} Excel: hiç header satırı bulunamadı (İndirilecek/Hesaplanan K.D.V. sütunu yok).`,
      );
      // Debug: ilk 15 satırın ham içeriğini dump et
      const debugRows = matrix.slice(0, 15).map((r, idx) => {
        const cells = (r || []).map((c) => (c === null || c === undefined ? '' : String(c).slice(0, 30)));
        return `  [${idx}] ${cells.map((c, j) => `${j}:"${c}"`).join(' | ')}`;
      });
      this.logger.warn(`Excel ilk 15 satır dump:\n${debugRows.join('\n')}`);
      return results;
    }

    // 2) Type'a göre doğru header'ı seç
    const target = isGelir
      ? headers.find((h) => h.hasHesaplanan)
      : headers.find((h) => h.hasIndirilecek);

    if (!target) {
      this.logger.warn(
        `İşletme ${isGelir ? 'Gelir' : 'Gider'} Excel: ` +
          `${isGelir ? 'Hesaplanan' : 'İndirilecek'} K.D.V. sütunu içeren header bulunamadı. ` +
          `Adaylar: ${headers.map((h) => `[#${h.idx + 1}: ${h.cells.join(' | ')}]`).join(' / ')}`,
      );
      return results;
    }

    // 3) Bölümün bitişi: bir sonraki header satırı (varsa), yoksa matrix sonu
    const nextHeader = headers.find((h) => h.idx > target.idx);
    const sectionEnd = nextHeader ? nextHeader.idx : matrix.length;

    // 4) Sütun indekslerini topla
    const headerCells = target.cells;
    const colIdx = (predicates: ((c: string) => boolean)[]): number => {
      for (const pred of predicates) {
        const idx = headerCells.findIndex(pred);
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const evrakNoIdx = colIdx([(c) => c === 'evrak no', (c) => c.includes('evrak no'), (c) => c.includes('evrak')]);
    const tarihIdx = colIdx([(c) => c === 'tarih', (c) => c.includes('tarih')]);
    const aciklamaIdx = colIdx([(c) => c.includes('açıklama'), (c) => c.includes('aciklama')]);
    const matrahIdx = isGelir
      ? colIdx([(c) => c === 'gelir', (c) => c.startsWith('gelir')])
      : colIdx([(c) => c === 'gider', (c) => c.startsWith('gider')]);
    const kdvIdx = colIdx(
      isGelir
        ? [(c) => c.includes('hesaplanan')]
        : [(c) => c.includes('indirilecek')],
    );

    this.logger.log(
      `İşletme ${isGelir ? 'GELİR' : 'GİDER'} bölümü: header=satır ${target.idx + 1}, ` +
        `bitis=satır ${sectionEnd}, ` +
        `evrakNo=${evrakNoIdx}, tarih=${tarihIdx}, aciklama=${aciklamaIdx}, ` +
        `matrah=${matrahIdx}, kdv=${kdvIdx}`,
    );

    // DİAGNOSTİK: bölümdeki ilk 5 ham satırı dump
    const diagRows = matrix.slice(target.idx + 1, Math.min(sectionEnd, target.idx + 6))
      .map((r, di) => {
        const cells = (r || []).map((c) => (c === null || c === undefined ? '' : String(c).slice(0, 25)));
        return `  data#${target.idx + 2 + di}: ${cells.map((c, j) => `${j}:"${c}"`).join(' | ')}`;
      });
    this.logger.log(`İşletme bölüm ilk 5 satır:\n${diagRows.join('\n')}`);

    // 5) Veri satırlarını dolaş (bölümün başından sonuna)
    let skipReason = { toplam: 0, sectionTitle: 0, noTarih: 0, noKdvNoMatrah: 0, ok: 0 };
    const sampleSkipped: string[] = [];
    for (let i = target.idx + 1; i < sectionEnd; i++) {
      const row = matrix[i] || [];
      if (!row.length) continue;

      // TOPLAM / DEVİR / GENEL TOPLAM atla
      const firstCells = row.slice(0, 6).map(norm).join(' ');
      if (
        firstCells.includes('toplam') ||
        firstCells.includes('genel toplam') ||
        firstCells.includes('devir')
      ) {
        skipReason.toplam++;
        continue;
      }

      // GELİRLER / GİDERLER bölüm başlığını da atla
      const isSectionTitle = row.every((cell, idx) => {
        if (idx === 0) {
          const t = norm(cell);
          return t === 'gelirler' || t === 'giderler' || t === '';
        }
        return cell === null || cell === undefined || String(cell).trim() === '';
      });
      if (isSectionTitle) {
        skipReason.sectionTitle++;
        continue;
      }

      const evrakNo = evrakNoIdx >= 0 ? row[evrakNoIdx] : null;
      const tarihRaw = tarihIdx >= 0 ? row[tarihIdx] : null;
      const aciklama = aciklamaIdx >= 0 ? row[aciklamaIdx] : null;
      const matrahRaw = matrahIdx >= 0 ? row[matrahIdx] : null;
      const kdvRaw = kdvIdx >= 0 ? row[kdvIdx] : null;

      const kdvTutari = this.toDecimal(kdvRaw);
      const matrah = this.toDecimal(matrahRaw);
      const belgeDate = this.parseDate(tarihRaw);

      // Tarih dolu olmalı
      if (!belgeDate) {
        skipReason.noTarih++;
        if (sampleSkipped.length < 3) {
          sampleSkipped.push(`row#${i+1} tarihRaw="${tarihRaw}" → null | evrakNo="${evrakNo}" kdv="${kdvRaw}"`);
        }
        continue;
      }

      // KDV ya da matrah dolu olmalı
      if ((kdvTutari === null || kdvTutari === 0) && (matrah === null || matrah === 0)) {
        skipReason.noKdvNoMatrah++;
        if (sampleSkipped.length < 3) {
          sampleSkipped.push(`row#${i+1} tarih="${tarihRaw}" kdv="${kdvRaw}" matrah="${matrahRaw}" — ikisi de boş/0`);
        }
        continue;
      }
      skipReason.ok++;

      // rawData: header → değer eşlemesi
      const rawData: Record<string, any> = {};
      const rawHeader = matrix[target.idx] || [];
      for (let c = 0; c < headerCells.length; c++) {
        const key = rawHeader[c];
        if (key !== null && key !== undefined && String(key).trim() !== '') {
          rawData[String(key).replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()] = row[c];
        }
      }

      results.push({
        rowIndex: i + 1,
        belgeNo:
          evrakNo !== null && evrakNo !== undefined && String(evrakNo).trim() !== ''
            ? String(evrakNo).trim()
            : null,
        belgeDate,
        karsiTaraf: aciklama ? String(aciklama).trim() : null,
        kdvMatrahi: matrah,
        kdvTutari: kdvTutari ?? 0,
        kdvOrani: null,
        aciklama: aciklama ? String(aciklama).trim() : null,
        rawData: this.sanitizeRawData(rawData),
      });
    }

    this.logger.log(
      `İşletme ${isGelir ? 'Gelir' : 'Gider'} Excel parse: ${results.length} satır bulundu. ` +
        `(skip: toplam=${skipReason.toplam}, sectionTitle=${skipReason.sectionTitle}, ` +
        `noTarih=${skipReason.noTarih}, noKdvNoMatrah=${skipReason.noKdvNoMatrah}, ok=${skipReason.ok})`,
    );
    if (sampleSkipped.length > 0) {
      this.logger.warn(`Atlanan örnek satırlar:\n${sampleSkipped.join('\n')}`);
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
