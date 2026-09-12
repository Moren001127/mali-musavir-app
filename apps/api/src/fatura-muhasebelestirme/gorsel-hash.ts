/**
 * PLAN/16 §C — ALGISAL GÖRSEL HASH (dHash, 64 bit).
 *
 * Aynı fişin ikinci fotoğrafı (farklı açı/ışık/kırpma) SHA-256 ile yakalanmaz; dHash ise küçük
 * farkları tolere eder: görsel griye çevrilip 9×8'e küçültülür, her satırda komşu piksel
 * karşılaştırması (sol < sağ → 1) 8×8 = 64 bit üretir. İki hash arasındaki Hamming uzaklığı
 * ≤ 6 ise "aynı belge gibi görünüyor" (MUKERRER_GORSEL uyarısı, engel değil).
 *
 * SAF BÖLÜM (dHashFromGray / hamming / benzerMi): Prisma/Nest/sharp yok — regresyon betiği
 * doğrudan kullanır. `computeImagePhash` sharp'ı tembel yükler; hata yutulur (null döner):
 * PDF/HEIC gibi sharp'ın raster üretemediği biçimlerde phash boş kalır.
 */

export const PHASH_GENISLIK = 9;
export const PHASH_YUKSEKLIK = 8;
/** Hamming eşiği: bu değer ve altı → görsel mükerrer şüphesi. */
export const MUKERRER_GORSEL_HAMMING_ESIK = 6;

/**
 * Gri piksel dizisinden (satır-öncelikli, w×h, 0-255) 64 bitlik dHash üretir → 16 haneli küçük harf hex.
 * Varsayılan 9×8: her satırda 8 karşılaştırma × 8 satır = 64 bit.
 */
export function dHashFromGray(pixels: Uint8Array | Buffer | number[], w: number = PHASH_GENISLIK, h: number = PHASH_YUKSEKLIK): string {
  if (!pixels || pixels.length < w * h) throw new Error(`dHash: ${w}x${h} = ${w * h} piksel gerekli, ${pixels ? pixels.length : 0} verildi`);
  if (w < 2 || h < 1) throw new Error('dHash: genişlik ≥ 2, yükseklik ≥ 1 olmalı');
  const bitler: number[] = [];
  for (let y = 0; y < h; y++) {
    const satir = y * w;
    for (let x = 0; x < w - 1; x++) {
      bitler.push(pixels[satir + x] < pixels[satir + x + 1] ? 1 : 0);
    }
  }
  // 4'erli gruplar → hex haneleri (bit sayısı 4'e bölünmüyorsa sona 0 eklenir).
  while (bitler.length % 4 !== 0) bitler.push(0);
  let hex = '';
  for (let i = 0; i < bitler.length; i += 4) {
    const n = (bitler[i] << 3) | (bitler[i + 1] << 2) | (bitler[i + 2] << 1) | bitler[i + 3];
    hex += n.toString(16);
  }
  return hex;
}

/** Hex hash geçerli mi (yalnız hex haneleri, boş değil)? */
export function phashGecerliMi(h: any): boolean {
  return typeof h === 'string' && h.length > 0 && /^[0-9a-fA-F]+$/.test(h);
}

/**
 * Dejenere hash: tüm bitler 0 ya da 1 (düz beyaz/siyah kare, gradyan bilgisi yok). Böyle iki görsel
 * "benzer" çıkar ama içerik taşımaz → mükerrer aramasında kullanılmaz.
 */
export function phashDejenereMi(h: any): boolean {
  return phashGecerliMi(h) && (/^0+$/.test(h) || /^[fF]+$/.test(h));
}

/**
 * İki hex hash arasındaki Hamming uzaklığı (farklı bit sayısı). Geçersiz/uzunluğu farklı
 * girdide Infinity (asla "benzer" sayılmaz).
 */
export function hamming(a: string, b: string): number {
  if (!phashGecerliMi(a) || !phashGecerliMi(b) || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let fark = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { fark += x & 1; x >>= 1; }
  }
  return fark;
}

/** Hamming ≤ eşik → görsel olarak aynı belge şüphesi. */
export function benzerMi(a: string, b: string, esik: number = MUKERRER_GORSEL_HAMMING_ESIK): boolean {
  return hamming(a, b) <= esik;
}

/** Bu MIME türünde phash denenir mi? Görseller evet; PDF denenir (sharp raster üretemezse null); diğerleri hayır. */
export function phashDenenirMi(mimeType: string | null | undefined): boolean {
  const m = String(mimeType || '').toLowerCase();
  if (!m) return true; // bilinmiyor → dene, sharp karar versin
  return m.startsWith('image/') || m === 'application/pdf';
}

/**
 * Görsel buffer'ından dHash (16 hex). sharp yoksa/biçim desteklenmiyorsa/bozuksa null (hata yutulur).
 * EXIF yönü uygulanır (rotate), şeffaflık beyaza basılır, gri 9×8 ham piksel alınır.
 */
export async function computeImagePhash(buffer: Buffer | null | undefined, mimeType?: string | null): Promise<string | null> {
  if (!buffer || !buffer.length) return null;
  if (!phashDenenirMi(mimeType)) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sharp = require('sharp');
    const { data, info } = await sharp(buffer, { failOn: 'none', limitInputPixels: 120_000_000, pages: 1 })
      .rotate()
      .flatten({ background: '#ffffff' })
      .grayscale()
      .resize(PHASH_GENISLIK, PHASH_YUKSEKLIK, { fit: 'fill', kernel: 'lanczos3' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const kanal = Math.max(1, Number(info?.channels) || 1);
    // Birden çok kanal döndüyse (nadiren) ilk kanalı al; gri tek kanal beklenir.
    const gri = kanal === 1 ? data : Buffer.from(Array.from({ length: PHASH_GENISLIK * PHASH_YUKSEKLIK }, (_, i) => data[i * kanal]));
    if (gri.length < PHASH_GENISLIK * PHASH_YUKSEKLIK) return null;
    return dHashFromGray(gri, PHASH_GENISLIK, PHASH_YUKSEKLIK);
  } catch {
    return null;
  }
}
