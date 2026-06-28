import * as XLSX from 'xlsx';
import { EDefterFisListesiParserService } from './edefter-fis-listesi-parser.service';

function workbookBuffer(rows: any[][]) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Detay');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('EDefterFisListesiParserService', () => {
  let parser: EDefterFisListesiParserService;

  beforeEach(() => {
    parser = new EDefterFisListesiParserService();
  });

  it('fis kimligi ve hesap kodu olmayan tutarli rapor ozet satirlarini hareket saymaz', () => {
    const buffer = workbookBuffer([
      ['Fiş No', 'Tarih', 'Hesap Kodu', 'Hesap Adı', 'Açıklama', 'Borç', 'Alacak'],
      ['1', '01.01.2026', '100.01.001', 'Kasa', 'Açılış fişi', 1000, 0],
      [null, null, null, null, null, 1000, 0],
      [null, null, null, null, null, 0, 1000],
      [null, null, null, null, 'Rapor toplamı', 1000, 1000],
    ]);

    const rows = parser.parse(buffer, { defaultYear: 2026 });

    expect(rows).toHaveLength(1);
    expect(rows[0].rowIndex).toBe(2);
    expect(rows[0].hesapKodu).toBe('100.01.001');
  });
});
