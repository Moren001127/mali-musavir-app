import { PDFDocument } from 'pdf-lib';
import type { Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

function isEncrypted(buf: Buffer): boolean {
  // /Encrypt sözlüğü genelde dosya sonundaki trailer'dadır; tüm dosyada ara
  return buf.includes('/Encrypt');
}

/** GİB e-tebligat gibi sahip-şifreli PDF'leri qpdf ile çözer (kullanıcı şifresi boş). */
async function decryptIfNeeded(buf: Buffer, logger?: Logger): Promise<Buffer> {
  if (!isEncrypted(buf)) return buf;
  const inPath = join(tmpdir(), `dec_in_${randomUUID()}.pdf`);
  const outPath = join(tmpdir(), `dec_out_${randomUUID()}.pdf`);
  try {
    await fs.writeFile(inPath, buf);
    await new Promise<void>((resolve, reject) => {
      execFile('qpdf', ['--decrypt', inPath, outPath], { timeout: 30000 }, (err) => (err ? reject(err) : resolve()));
    });
    const out = await fs.readFile(outPath);
    logger?.log(`şifreli PDF çözüldü (${buf.length}B → ${out.length}B)`);
    return out;
  } catch (e: any) {
    logger?.warn(`PDF şifre çözme başarısız (qpdf): ${e?.message} — orijinal kullanılacak`);
    return buf;
  } finally {
    fs.unlink(inPath).catch(() => {});
    fs.unlink(outPath).catch(() => {});
  }
}

/**
 * Birden fazla PDF'i tek dosyada art arda sayfalar halinde birleştirir.
 * Şifreli kaynaklar önce çözülür (aksi halde sayfaları BEYAZ görünür).
 * Okunamayan/bozuk dosya atlanır; hiç sayfa çıkmazsa null döner.
 */
export async function mergePdfBuffers(buffers: Buffer[], logger?: Logger): Promise<Buffer | null> {
  if (buffers.length === 0) return null;
  const out = await PDFDocument.create();
  let pageCount = 0;
  for (const raw of buffers) {
    try {
      const buf = await decryptIfNeeded(raw, logger);
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
