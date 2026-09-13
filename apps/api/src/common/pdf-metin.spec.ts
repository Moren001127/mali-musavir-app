/**
 * pdfMetniCikar — pdf-parse v2 sınıf API'si sarmalayıcısı (2026-09-13: 5 yerde eski fonksiyon API'si sessizce kırıktı).
 * Gerçek ayrıştırma Jest altında çalışmaz (pdfjs worker dinamik import → "--experimental-vm-modules"); düz node'da
 * doğrulandı (pdf-lib ile üretilen PDF → "Fatura kalemi Motorin 1250,00 TL"). Burada sarmalayıcı davranışı test edilir.
 */
const parserCagrilari: any[] = [];
let sonucMetin: string | null = 'Fatura kalemi Motorin 1250,00 TL';
let destroySayac = 0;

jest.mock('pdf-parse', () => ({
  PDFParse: class {
    opts: any;
    constructor(opts: any) { this.opts = opts; parserCagrilari.push({ tur: 'new', opts }); }
    async getText(params?: any) {
      parserCagrilari.push({ tur: 'getText', params });
      if (sonucMetin === null) throw new Error('bozuk pdf');
      return { text: sonucMetin };
    }
    async destroy() { destroySayac++; }
  },
}));

import { pdfMetniCikar, PDF_METIN_TAVANI } from './pdf-metin';

describe('pdfMetniCikar', () => {
  beforeEach(() => { parserCagrilari.length = 0; destroySayac = 0; sonucMetin = 'Fatura kalemi Motorin 1250,00 TL'; });

  it('sınıf API: new PDFParse({data}) + getText(); metni döner ve parser kapatılır', async () => {
    const m = await pdfMetniCikar(Buffer.from('%PDF-1.4 sahte'));
    expect(m).toContain('Motorin');
    expect(parserCagrilari[0]).toEqual({ tur: 'new', opts: { data: expect.any(Buffer) } });
    expect(parserCagrilari[1]).toEqual({ tur: 'getText', params: undefined });
    expect(destroySayac).toBe(1);
  });

  it('maxSayfa → getText({first: N}); şifre → password', async () => {
    await pdfMetniCikar(Buffer.from('%PDF-1.4 sahte'), { maxSayfa: 4, sifre: 'gizli' });
    expect(parserCagrilari[0].opts).toEqual({ data: expect.any(Buffer), password: 'gizli' });
    expect(parserCagrilari[1].params).toEqual({ first: 4 });
  });

  it('bozuk/boş girdide hata fırlatmaz, boş döner; kısa buffer parser bile açmaz', async () => {
    sonucMetin = null;
    expect(await pdfMetniCikar(Buffer.from('%PDF-1.4 sahte'))).toBe('');
    expect(destroySayac).toBe(1); // hata olsa da kapatılır
    parserCagrilari.length = 0;
    expect(await pdfMetniCikar(Buffer.alloc(0))).toBe('');
    expect(parserCagrilari).toHaveLength(0);
  });

  it('metin tavanı: aşırı uzun metin kırpılır', async () => {
    sonucMetin = 'a'.repeat(PDF_METIN_TAVANI + 500);
    expect((await pdfMetniCikar(Buffer.from('%PDF-1.4 sahte'))).length).toBe(PDF_METIN_TAVANI);
  });
});
