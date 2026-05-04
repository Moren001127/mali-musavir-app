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

    // Türkçe karakter normalizasyonu — KRITIK BUG FIX:
    //   .normalize('NFD') İ harfini "I + combining dot"a böler.
    //   Combining'i sildikten sonra kalan "I" toLocaleLowerCase('tr-TR') ile "ı" (dotsuz) olur.
    //   Bu yüzden "İndirilecek" → "ındirilecek" oluyor, "indirilecek".includes() match etmiyor.
    //   ÇÖZÜM: NFD/combining'i kaldır, ASCII fallback yap.
    const norm = (v: any): string =>
      String(v ?? '')
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        // Türkçe büyük→küçük (İ→i, I→ı) — sonra hem TR hem ASCII varyantlarını eşle
        .toLocaleLowerCase('tr-TR')
        // ASCII fallback: ı→i, ğ→g, ü→u, ş→s, ö→o, ç→c (parser eşleşmesi için)
        .replace(/[ıİ]/g, 'i')
        .replace(/[ğĞ]/g, 'g')
        .replace(/[üÜ]/g, 'u')
        .replace(/[şŞ]/g, 's')
        .replace(/[öÖ]/g, 'o')
        .replace(/[çÇ]/g, 'c');

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
    let target = isGelir
      ? headers.find((h) => h.hasHesaplanan)
      : headers.find((h) => h.hasIndirilecek);

    // FALLBACK: İstenen bölüm yoksa diğer bölümle dene (en azından satır gelsin)
    if (!target && headers.length > 0) {
      target = headers[0];
      this.logger.warn(
        `İşletme ${isGelir ? 'Gelir' : 'Gider'} Excel: istenen bölüm yok (${isGelir ? 'Hesaplanan' : 'İndirilecek'} K.D.V.), ` +
          `FALLBACK olarak ilk header (#${target.idx + 1}) kullanılıyor. ` +
          `Adaylar: ${headers.map((h) => `[#${h.idx + 1}: ${h.cells.slice(0, 8).join('|')}]`).join(' / ')}`,
      );
    }

    if (!target) {
      this.logger.warn(
        `İşletme ${isGelir ? 'Gelir' : 'Gider'} Excel: hiç KDV header'ı yok.`,
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
/**
   * İŞLETME HESAP ÖZETİ için detaylı parse — tek excel'den 4 toplam çıkarır:
   *   - GELİRLER bölümü (Hesaplanan KDV):
   *       gelirToplam = "Gelir" + "Satılan Emtia" matrah toplamı (KDV hariç)
   *   - GİDERLER bölümü (İndirilecek KDV):
   *       malAlisToplam = "Alınan Emtia" matrah toplamı
   *       giderToplam   = "Gider" matrah toplamı
   */
  parseIsletmeExcelDetayli(buffer: Buffer): {
    gelirToplam: number;
    malAlisToplam: number;
    giderToplam: number;
    gelirSatirAdet: number;
    giderSatirAdet: number;
  } {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const matrix: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: null,
      blankrows: false,
    });

    const norm = (v: any): string =>
      String(v ?? '')
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleLowerCase('tr-TR')
        .replace(/[ıİ]/g, 'i')
        .replace(/[ğĞ]/g, 'g')
        .replace(/[üÜ]/g, 'u')
        .replace(/[şŞ]/g, 's')
        .replace(/[öÖ]/g, 'o')
        .replace(/[çÇ]/g, 'c');

    // Header satırlarını topla
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
        headers.push({ idx: i, hasIndirilecek, hasHesaplanan, cells });
      }
    }

    let gelirToplam = 0;
    let malAlisToplam = 0;
    let giderToplam = 0;
    let gelirSatirAdet = 0;
    let giderSatirAdet = 0;

    if (headers.length === 0) {
      this.logger.warn('İHÖ Detaylı: Excel\'de hiç KDV header satırı bulunamadı');
      return { gelirToplam, malAlisToplam, giderToplam, gelirSatirAdet, giderSatirAdet };
    }

    // GELİRLER bölümü (Hesaplanan KDV): Gelir + Satılan Emtia kolonlarını topla
    const gelirHeader = headers.find((h) => h.hasHesaplanan);
    if (gelirHeader) {
      const next = headers.find((h) => h.idx > gelirHeader.idx);
      const sectionEnd = next ? next.idx : matrix.length;
      const cells = gelirHeader.cells;
      const gelirCol = cells.findIndex((c) => c === 'gelir' || c.startsWith('gelir'));
      const satilanCol = cells.findIndex((c) => c.includes('satilan') || c.includes('satılan'));
      const tarihCol = cells.findIndex((c) => c === 'tarih' || c.includes('tarih'));

      this.logger.log(
        `İHÖ GELİR bölümü: header=${gelirHeader.idx + 1}, end=${sectionEnd}, gelirCol=${gelirCol}, satilanCol=${satilanCol}`,
      );

      for (let i = gelirHeader.idx + 1; i < sectionEnd; i++) {
        const row = matrix[i] || [];
        // Tarih yoksa veya TOPLAM satırıysa atla
        const tarihRaw = tarihCol >= 0 ? row[tarihCol] : null;
        const ilkHucre = norm(row[0]);
        if (!tarihRaw && !ilkHucre) continue;
        if (ilkHucre.includes('toplam') || ilkHucre.includes('genel')) continue;

        const gelirVal = gelirCol >= 0 ? this.toDecimal(row[gelirCol]) : 0;
        const satilanVal = satilanCol >= 0 ? this.toDecimal(row[satilanCol]) : 0;
        const sum = (gelirVal || 0) + (satilanVal || 0);
        if (sum > 0) {
          gelirToplam += sum;
          gelirSatirAdet++;
        }
      }
    }

    // GİDERLER bölümü (İndirilecek KDV): Alınan Emtia + Gider ayrı ayrı
    const giderHeader = headers.find((h) => h.hasIndirilecek);
    if (giderHeader) {
      const next = headers.find((h) => h.idx > giderHeader.idx);
      const sectionEnd = next ? next.idx : matrix.length;
      const cells = giderHeader.cells;
      const giderCol = cells.findIndex((c) => c === 'gider' || c.startsWith('gider'));
      const alinanCol = cells.findIndex((c) => c.includes('alinan') || c.includes('alınan'));
      const tarihCol = cells.findIndex((c) => c === 'tarih' || c.includes('tarih'));

      this.logger.log(
        `İHÖ GİDER bölümü: header=${giderHeader.idx + 1}, end=${sectionEnd}, giderCol=${giderCol}, alinanCol=${alinanCol}`,
      );

      for (let i = giderHeader.idx + 1; i < sectionEnd; i++) {
        const row = matrix[i] || [];
        const tarihRaw = tarihCol >= 0 ? row[tarihCol] : null;
        const ilkHucre = norm(row[0]);
        if (!tarihRaw && !ilkHucre) continue;
        if (ilkHucre.includes('toplam') || ilkHucre.includes('genel')) continue;

        const giderVal = giderCol >= 0 ? this.toDecimal(row[giderCol]) : 0;
        const alinanVal = alinanCol >= 0 ? this.toDecimal(row[alinanCol]) : 0;
        if ((giderVal || 0) > 0 || (alinanVal || 0) > 0) {
          giderToplam += giderVal || 0;
          malAlisToplam += alinanVal || 0;
          giderSatirAdet++;
        }
      }
    }

    const r2 = (n: number) => Math.round(n * 100) / 100;
    return {
      gelirToplam: r2(gelirToplam),
      malAlisToplam: r2(malAlisToplam),
      giderToplam: r2(giderToplam),
      gelirSatirAdet,
      giderSatirAdet,
    };
  }
}
