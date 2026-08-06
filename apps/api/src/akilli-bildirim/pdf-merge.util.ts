import { PDFDocument } from 'pdf-lib';
import type { Logger } from '@nestjs/common';

/**
 * Birden fazla PDF'i tek dosyada art arda sayfalar halinde birleştirir.
 * Okunamayan/bozuk dosya atlanır; hiç sayfa çıkmazsa null döner.
 */
export async function mergePdfBuffers(buffers: Buffer[], logger?: Logger): Promise<Buffer | null> {
  if (buffers.length === 0) return null;
  const out = await PDFDocument.create();
  let pageCount = 0;
  for (const buf of buffers) {
    try {
      const src = await PDFDocument.load(new Uint8Array(buf), { ignoreEncryption: true });
      const copied = await out.copyPages(src, src.getPageIndices());
      for (const p of copied) {
        out.addPage(p);
        pageCount += 1;
      }
    } catch (e: any) {
      logger?.warn(`PDF birleştirmede dosya atlandı: ${e?.message}`);
    }
  }
  if (pageCount === 0) return null;
  return Buffer.from(await out.save());
}
