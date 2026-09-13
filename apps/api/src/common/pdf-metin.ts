/**
 * PDF → METİN (2026-09-13) — pdf-parse v2 sınıf API'si (`new PDFParse({data}).getText()`).
 *
 * Canlı bulgu: fatura servisi (2), e-Arşiv zip ayrıştırıcı (1) ve Moren Ofis (2) eski `require('pdf-parse')(buf)` (v1 fonksiyon API'si) çağrılıyordu →
 * "pdfParse is not a function" → PDF'ler sessizce "taranmış/şifreli" sayılıyordu (kalem tamamlama + Max-vision metin yolu).
 * Tek yardımcı: hata fırlatmaz ('' döner), ilk `maxSayfa` sayfa, metin tavanı (bozuk PDF belleği doldurmasın).
 */
import { PDFParse } from 'pdf-parse';

export const PDF_METIN_TAVANI = 200_000;

export async function pdfMetniCikar(buf: Buffer, opts: { maxSayfa?: number; sifre?: string } = {}): Promise<string> {
  if (!buf || buf.length < 8) return '';
  let parser: any = null;
  try {
    parser = new PDFParse(opts.sifre ? ({ data: buf, password: opts.sifre } as any) : ({ data: buf } as any));
    const r = await parser.getText(opts.maxSayfa ? ({ first: opts.maxSayfa } as any) : undefined); // ilk N sayfa
    const ham = String(r?.text || '');
    return ham.length > PDF_METIN_TAVANI ? ham.slice(0, PDF_METIN_TAVANI) : ham;
  } catch {
    return '';
  } finally {
    try {
      const destroy = parser && parser.destroy;
      if (typeof destroy === 'function') await destroy.call(parser);
    } catch { /* kapatılamadıysa geç */ }
  }
}
