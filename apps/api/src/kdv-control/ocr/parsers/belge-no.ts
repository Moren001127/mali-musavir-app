/**
 * Belge No parser — OCR ham metninden fis/fatura/Z raporu numarasini cikarir.
 *
 * Public API (Faz 1 modul izolasyon):
 *   extractBelgeNo(text, foldedText) - ham + Turkce-ASCII katlanmis metin alir, belge no doner
 *
 * Bu helper `this` kullanmaz - saf fonksiyon. `foldedText` parametresi caller
 * tarafindan hazirlanir (genellikle foldTurkishAscii ile). Boylece bu modul
 * normalizeAzureText/foldTurkishAscii zincirine bagimsiz kalir.
 */

/**
 * OCR ham metninden belge numarasini cikarir.
 *
 * Akis:
 *   1) Z RAPORU tespiti -> Z SAYAC / Z NO / ciplak Z<num> desenlerini dene
 *   2) Genel desenler (Turkce harfler ASCII'ye katlanmis foldedText uzerinde):
 *      - "FIS NO: ..."
 *      - "FATURA NO: ..."
 *      - "FIS/BELGE/EVRAK NO ..."
 *      - "[A-Z0-9]{3}20\d{2}\d{6,12}" (e-fatura/e-arsiv UUID-benzeri)
 *
 * @param text       Orijinal OCR metni (Turkce karakter korunmus, Z raporu detection icin)
 * @param foldedText foldTurkishAscii(text) sonucu (genel desenler bunun uzerinde calisir)
 */
/**
 * Dosya adı Prisma `cuid()` / rastgele DB id'si mi? (ör. "cmqgpx7xd0d7swns6sw3am42o").
 *
 * Bunlar belge no DEĞİLDİR; filename'den belge no üretilirken elenmeli — aksi halde
 * OKC fişlerinde belge no=cuid kalıp Luca ile EŞLEŞMEZ ("Luca'da yok" yığını).
 * cuid: 'c' + 24-30 küçük-harf base36, hem harf hem rakam. Gerçek belge no'lar
 * büyük-harf önekli (GIB/EFA…) veya rakam-yapılı olduğundan elenmez.
 */
export function isRandomDbId(base: string): boolean {
  return /^c[a-z0-9]{23,30}$/.test(base) && /[a-z]/.test(base) && /\d/.test(base);
}

export function extractBelgeNo(text: string, foldedText: string): string | null {
  // Z RAPORU tespiti — eger metinde Z RAPORU geciyorsa Z NO/Z SAYAC'ı al
  const isZRapor = /z\s*rapor(u|[ıi])?|z\s*report|z\s*g[uü]nl[uü]k/i.test(text);
  if (isZRapor) {
    // v1.36.72: "Z SAYAÇ 896" / "Z SAYAC: 896" / "Z SAYACI 896" desenleri
    // (bazi OKC modelleri "Z NO" yerine "Z SAYAÇ" yaziyor)
    const zSayac = text.match(/z\s*saya[cç][ıi]?\s*[:\-.#\s]*(\d{1,8})/i);
    if (zSayac?.[1]) return zSayac[1].trim();

    // "Z NO: 666" formatini ara (iki nokta, tire veya bosluk sonrasi rakam)
    const zNo = text.match(/z\s*no\s*[:\-.#\s]+(\d{1,8})/i);
    if (zNo?.[1]) return zNo[1].trim();

    // Son care: belgenin alt kismindaki ciplak Z numarasi ("Z 0896" gibi)
    const zBare = text.match(/(?:^|\n|\s)z\s*[:\-]?\s*(\d{2,8})\s*(?:$|\n)/im);
    if (zBare?.[1]) return zBare[1].trim();
  }

  const headerWordRe = /^(SAAT|TARIH|TAR[Iİ]H|TOPKDV|TOPLAM|NAKIT|NAK[Iİ]T|KREDI|KRED[Iİ]|KART)$/i;

  const fisNo = foldedText.match(/(?:^|\n)\s*fis\s*no\s*[:#. \t]*([A-Z0-9]{1,12})\b/im);
  if (fisNo?.[1] && /\d/.test(fisNo[1]) && !headerWordRe.test(fisNo[1])) {
    return fisNo[1].trim().toUpperCase();
  }

  // Some OKC slips print "FIS NO:" empty but include the real receipt number
  // in the POS line as "ISLEM NO:0003/KP0807".
  const okcPosNo = foldedText.match(/(?:^|\n)\s*islem\s*(?:no|n)?\s*[:#. \t]*(\d{1,8})\s*\/\s*KP\d{1,8}\b/im);
  if (okcPosNo?.[1] && /\bT[O0]PKDV\b/i.test(foldedText)) {
    return okcPosNo[1].replace(/^0+(?=\d)/, '').trim();
  }

  const patterns = [
    /fatura\s*no\s*:?\s*([A-Z0-9]{10,20})/i,
    /(?:fis|belge|evrak)\s*(?:no|numarasi)?[:\s#.]*([A-Z0-9]{8,20})/i,
    /\b([A-Z0-9]{3}20\d{2}\d{6,12})\b/i,
  ];
  for (const p of patterns) {
    const m = foldedText.match(p);
    if (m?.[1] && !headerWordRe.test(m[1])) return m[1].trim().toUpperCase();
  }
  return null;
}
