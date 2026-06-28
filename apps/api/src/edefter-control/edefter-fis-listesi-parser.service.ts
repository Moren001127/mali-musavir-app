import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';

export type ParsedEDefterFisLine = {
  rowIndex: number;
  voucherKey: string;
  fisNo?: string | null;
  yevmiyeNo?: string | null;
  fisTarihi?: Date | null;
  fisTipi?: string | null;
  evrakNo?: string | null;
  evrakTarihi?: Date | null;
  belgeTuru?: string | null;
  hesapKodu?: string | null;
  hesapAdi?: string | null;
  aciklama?: string | null;
  karsiHesap?: string | null;
  vknTckn?: string | null;
  borc: number;
  alacak: number;
  rawData: Record<string, unknown>;
};

type HeaderMap = Record<string, number>;
type ParserOptions = {
  defaultYear?: number;
};

type CarryVoucherContext = {
  fisNo: string | null;
  yevmiyeNo: string | null;
  fisTarihi: Date | null;
  fisTipi: string | null;
  evrakNo: string | null;
  evrakTarihi: Date | null;
  belgeTuru: string | null;
  vknTckn: string | null;
};

@Injectable()
export class EDefterFisListesiParserService {
  private readonly logger = new Logger(EDefterFisListesiParserService.name);

  parse(buffer: Buffer, opts: ParserOptions = {}): ParsedEDefterFisLine[] {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const { sheetName, grid } = this.pickBestSheet(wb);
    const headerRowIdx = this.findHeaderRow(grid);
    if (headerRowIdx === -1) {
      const dump = grid
        .slice(0, Math.min(35, grid.length))
        .map((row, idx) => {
          const cells = (row || []).map((c) => this.cellText(c)).filter(Boolean);
          return cells.length ? `S${idx + 1}: ${cells.slice(0, 14).join(' | ')}` : null;
        })
        .filter(Boolean)
        .join(' || ');
      throw new Error(`Detay Fis Listesi baslik satiri bulunamadi. Sheet="${sheetName}". Ilk satirlar: ${dump.slice(0, 1800)}`);
    }

    const headers = (grid[headerRowIdx] || []).map((cell) => this.normalizeHeader(cell));
    const headerMap: HeaderMap = {};
    headers.forEach((h, idx) => {
      if (h && headerMap[h] == null) headerMap[h] = idx;
    });

    this.logger.log(
      `Detay Fis Listesi parse: sheet="${sheetName}", baslik=S${headerRowIdx + 1}, kolonlar=${headers.filter(Boolean).join(' | ')}`,
    );

    const rows: ParsedEDefterFisLine[] = [];
    let reportBlockNo = 1;
    let carryVoucher: CarryVoucherContext | null = null;
    for (let r = headerRowIdx + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      if (row.every((c) => this.cellText(c) === '')) {
        carryVoucher = null;
        continue;
      }

      const rawData: Record<string, unknown> = {};
      headers.forEach((h, idx) => {
        if (h) rawData[h] = row[idx] ?? null;
      });

      let hesapKodu = this.readString(row, headerMap, [
        /^hesap.*kod/,
        /^kod$/,
        /^hsp.*kod/,
        /^account.*code/,
      ]);
      let hesapAdi = this.readString(row, headerMap, [
        /^hesap.*ad/,
        /^hesap.*aciklama/,
        /^account.*name/,
      ]);
      const borc = this.readAmount(row, headerMap, [/^borc$/, /^borc\s*tutar/, /^debit$/]);
      const alacak = this.readAmount(row, headerMap, [/^alacak$/, /^alacak\s*tutar/, /^credit$/]);

      const account = this.splitAccount(hesapKodu, hesapAdi);
      hesapKodu = account.code;
      hesapAdi = account.name;

      let aciklama = this.readString(row, headerMap, [/^aciklama$/, /^izahat$/, /^fis\s*aciklama/, /^description$/]);
      const inlineVoucher = this.parseInlineVoucher(aciklama, opts.defaultYear);
      if (inlineVoucher.description) aciklama = inlineVoucher.description;

      let fisNo = this.readString(row, headerMap, [/^fis$/, /^fis\s*no/, /^fisno$/, /^fis\s*numara/]) || inlineVoucher.no;
      let yevmiyeNo = this.readString(row, headerMap, [/^yevmiye\s*no/, /^yevmiye$/, /^yevmiye\s*numara/]);
      let fisTarihi = this.readDate(row, headerMap, [/^fis\s*tarih/, /^fistarih/, /^tarih$/]) || inlineVoucher.date;
      let evrakNo = this.readString(row, headerMap, [/^evrak\s*no/, /^belge\s*no/, /^dokuman\s*no/, /^document\s*no/]) || inlineVoucher.no;
      let evrakTarihi = this.readDate(row, headerMap, [/^evrak\s*tarih/, /^belge\s*tarih/, /^document\s*date/]) || inlineVoucher.date;
      let fisTipi = this.readString(row, headerMap, [/^fis\s*tip/, /^fistipi$/, /^tip$/]);
      let belgeTuru = this.readString(row, headerMap, [/^belge\s*tur/, /^evrak\s*tur/, /^document\s*type/]);
      let vknTckn = this.readString(row, headerMap, [/^vkn/, /^tckn/, /^vergi\s*no/, /^tc\s*no/, /^tax\s*no/]);
      const karsiHesap = this.readString(row, headerMap, [/^karsi\s*hesap/, /^karsi\s*kod/]);

      if (this.isReportTotalRow({ hesapKodu, hesapAdi, aciklama })) {
        reportBlockNo += 1;
        carryVoucher = null;
        continue;
      }
      if (this.isReportScaffoldRow({ hesapKodu, hesapAdi, aciklama, borc, alacak, fisNo, yevmiyeNo })) {
        continue;
      }

      const hasMovement = Boolean(hesapKodu || hesapAdi || borc !== 0 || alacak !== 0);
      const rowVoucherId = yevmiyeNo || fisNo;
      if (!rowVoucherId && !fisTarihi && !this.isAccountCode(hesapKodu) && !hesapAdi) {
        // Luca raporlarinin sayfa/rapor sonlarinda bazen yalnizca tutar kolonlari dolu
        // ozet satirlari gelir. Carry-forward devreye girmeden once bunlari at;
        // yoksa onceki fisin tarihi bu satirlara tasinip sahte hareket olusur.
        carryVoucher = null;
        continue;
      }
      const carry = carryVoucher as CarryVoucherContext | null;
      const carryVoucherId = carry ? carry.yevmiyeNo || carry.fisNo : null;
      const canCarryVoucher = Boolean(
        hasMovement &&
        carry &&
        ((!rowVoucherId && !fisTarihi) || (rowVoucherId && carryVoucherId && rowVoucherId === carryVoucherId)),
      );
      if (canCarryVoucher && carry) {
        fisNo ||= carry.fisNo;
        yevmiyeNo ||= carry.yevmiyeNo;
        fisTarihi ||= carry.fisTarihi;
        fisTipi ||= carry.fisTipi;
        evrakNo ||= carry.evrakNo;
        evrakTarihi ||= carry.evrakTarihi;
        belgeTuru ||= carry.belgeTuru;
        vknTckn ||= carry.vknTckn;
      }

      if (!hesapKodu && !hesapAdi && borc === 0 && alacak === 0 && !fisNo && !yevmiyeNo) {
        carryVoucher = null;
        continue;
      }
      const voucherKey = fisNo || yevmiyeNo
        ? this.buildVoucherKey({ fisNo, yevmiyeNo, fisTarihi, rowIndex: r + 1 })
        : `BLOCK|${reportBlockNo}`;
      rows.push({
        rowIndex: r + 1,
        voucherKey,
        fisNo,
        yevmiyeNo,
        fisTarihi,
        fisTipi,
        evrakNo,
        evrakTarihi,
        belgeTuru,
        hesapKodu,
        hesapAdi,
        aciklama,
        karsiHesap,
        vknTckn,
        borc,
        alacak,
        rawData,
      });
      if (hasMovement && (fisNo || yevmiyeNo || fisTarihi)) {
        carryVoucher = { fisNo, yevmiyeNo, fisTarihi, fisTipi, evrakNo, evrakTarihi, belgeTuru, vknTckn };
      }
    }

    if (!rows.length) {
      throw new Error('Detay Fis Listesi okundu ama gecerli fis satiri bulunamadi');
    }
    return rows;
  }

  private pickBestSheet(wb: XLSX.WorkBook): { sheetName: string; grid: any[][] } {
    let best = { sheetName: wb.SheetNames[0] || 'Sheet1', grid: [] as any[][], filled: -1 };
    for (const sheetName of wb.SheetNames) {
      const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
        header: 1,
        raw: true,
        defval: null,
      }) as any[][];
      const filled = grid.filter((row) => row?.some((cell) => this.cellText(cell) !== '')).length;
      if (filled > best.filled) best = { sheetName, grid, filled };
    }
    return { sheetName: best.sheetName, grid: best.grid };
  }

  private findHeaderRow(grid: any[][]): number {
    const scanLimit = Math.min(80, grid.length);
    for (let i = 0; i < scanLimit; i++) {
      const headers = (grid[i] || []).map((cell) => this.normalizeHeader(cell)).filter(Boolean);
      if (!headers.length) continue;
      const joined = headers.join(' | ');
      const hasAccount = headers.some((h) => /hesap.*kod|account.*code/.test(h));
      const hasDebitCredit =
        headers.some((h) => /^borc|debit/.test(h)) &&
        headers.some((h) => /^alacak|credit/.test(h));
      const hasVoucher = headers.some((h) => /fis|yevmiye|evrak|belge|tarih/.test(h));
      if (hasAccount && hasDebitCredit && hasVoucher) return i;

      const hasLooseFisListesi =
        /hesap.*kod/.test(joined) &&
        /borc/.test(joined) &&
        /alacak/.test(joined);
      if (hasLooseFisListesi) return i;
    }
    return -1;
  }

  private readString(row: any[], map: HeaderMap, patterns: RegExp[]): string | null {
    const idx = this.findIndex(map, patterns);
    if (idx == null) return null;
    const text = this.cellText(row[idx]);
    return text || null;
  }

  private readAmount(row: any[], map: HeaderMap, patterns: RegExp[]): number {
    const idx = this.findIndex(map, patterns);
    if (idx == null) return 0;
    return this.toDecimal(row[idx]);
  }

  private readDate(row: any[], map: HeaderMap, patterns: RegExp[]): Date | null {
    const idx = this.findIndex(map, patterns);
    if (idx == null) return null;
    return this.toDate(row[idx]);
  }

  private findIndex(map: HeaderMap, patterns: RegExp[]): number | null {
    const key = Object.keys(map).find((h) => patterns.some((p) => p.test(h)));
    return key == null ? null : map[key];
  }

  private splitAccount(
    hesapKodu?: string | null,
    hesapAdi?: string | null,
  ): { code: string | null; name: string | null } {
    const codeText = this.cellText(hesapKodu);
    const nameText = this.cellText(hesapAdi);
    const source = codeText || nameText;
    const match = source.match(/^(\d{3}(?:[.\-][\p{L}\p{N}]+)*)(?:\s*[-·]\s*|\s+)(.+)$/u);
    if (!match) {
      return { code: codeText || null, name: nameText && nameText !== codeText ? nameText : null };
    }
    const code = match[1];
    const nameFromCombined = match[2]?.trim() || null;
    const cleanName = nameText && nameText !== source ? nameText : nameFromCombined;
    return { code, name: cleanName || null };
  }

  private parseInlineVoucher(
    text?: string | null,
    defaultYear?: number,
  ): { date: Date | null; no: string | null; description: string | null } {
    const raw = this.cellText(text);
    const match = raw.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\s+([A-Za-z0-9][A-Za-z0-9./_-]*)\s*(.*)$/);
    if (!match) return { date: null, no: null, description: null };

    const day = Number(match[1]);
    const month = Number(match[2]);
    let year = match[3] ? Number(match[3]) : Number(defaultYear || 0);
    if (year > 0 && year < 100) year += 2000;
    const date = year >= 1900 && month >= 1 && month <= 12 && day >= 1 && day <= 31
      ? new Date(Date.UTC(year, month - 1, day))
      : null;

    return {
      date,
      no: match[4] || null,
      description: match[5]?.trim() || null,
    };
  }

  private isReportScaffoldRow(row: {
    hesapKodu?: string | null;
    hesapAdi?: string | null;
    aciklama?: string | null;
    borc: number;
    alacak: number;
    fisNo?: string | null;
    yevmiyeNo?: string | null;
  }) {
    const code = this.normalizeHeader(row.hesapKodu);
    const name = this.normalizeHeader(row.hesapAdi);
    const desc = this.normalizeHeader(row.aciklama);
    const label = `${code} ${name} ${desc}`.trim();
    if (!label) return false;
    if (/fis toplam|sayfa toplam|genel toplam|rapor toplam/.test(label)) return true;
    if (/^tarih(?:\s+mahsup)?$/.test(label) || /^mahsup$/.test(label)) return true;
    if (/hesap kodu|hesap adi|aciklama/.test(label)) return true;
    if (row.borc === 0 && row.alacak === 0 && !this.isAccountCode(row.hesapKodu) && !row.fisNo && !row.yevmiyeNo) {
      return true;
    }
    return Boolean(row.hesapKodu && !this.isAccountCode(row.hesapKodu) && row.borc === 0 && row.alacak === 0);
  }

  private isReportTotalRow(row: {
    hesapKodu?: string | null;
    hesapAdi?: string | null;
    aciklama?: string | null;
  }) {
    const label = [
      this.normalizeHeader(row.hesapKodu),
      this.normalizeHeader(row.hesapAdi),
      this.normalizeHeader(row.aciklama),
    ].filter(Boolean).join(' ');
    return /fis toplam|sayfa toplam|genel toplam|rapor toplam/.test(label);
  }

  private isAccountCode(value?: string | null) {
    const text = this.cellText(value);
    if (!text) return false;
    const first = text.split(/\s*[-·]\s*|\s+/)[0];
    return /^\d{3}(?:[.\-][\p{L}\p{N}]+)*$/u.test(first);
  }

  private buildVoucherKey(input: {
    fisNo?: string | null;
    yevmiyeNo?: string | null;
    fisTarihi?: Date | null;
    rowIndex: number;
  }): string {
    const date = input.fisTarihi ? input.fisTarihi.toISOString().slice(0, 10) : '';
    const primary = input.yevmiyeNo || input.fisNo;
    return primary ? `${date}|${primary}` : `ROW|${input.rowIndex}`;
  }

  private normalizeHeader(value: any): string {
    return this.cellText(value)
      .toLocaleLowerCase('tr-TR')
      .replace(/[ç]/g, 'c')
      .replace(/[ğ]/g, 'g')
      .replace(/[ı]/g, 'i')
      .replace(/[ö]/g, 'o')
      .replace(/[ş]/g, 's')
      .replace(/[ü]/g, 'u')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private cellText(value: any): string {
    if (value == null) return '';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).replace(/\s+/g, ' ').trim();
  }

  private toDate(value: any): Date | null {
    if (value == null || value === '') return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
    }
    const text = this.cellText(value);
    const dmy = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (dmy) return new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1]));
    const ymd = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
    if (ymd) return new Date(Date.UTC(+ymd[1], +ymd[2] - 1, +ymd[3]));
    const dt = new Date(text);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  private toDecimal(value: any): number {
    if (value == null || value === '') return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let text = this.cellText(value).replace(/\s/g, '');
    text = text.replace(/[^\d,.\-]/g, '');
    if (!text) return 0;

    const lastDot = text.lastIndexOf('.');
    const lastComma = text.lastIndexOf(',');
    if (lastDot !== -1 && lastComma !== -1) {
      if (lastComma > lastDot) text = text.replace(/\./g, '').replace(',', '.');
      else text = text.replace(/,/g, '');
    } else if (lastComma !== -1) {
      text = text.replace(',', '.');
    } else if (lastDot !== -1) {
      const after = text.length - lastDot - 1;
      if (after === 3 && text.indexOf('.') === lastDot) text = text.replace(/\./g, '');
    }

    const n = parseFloat(text);
    return Number.isFinite(n) ? n : 0;
  }
}
