/**
 * Vendor parsers — Azure OCR ham metninden satici (VKN + unvan) bilgilerini cikarir.
 *
 * Public API (Faz 1 modul izolasyon):
 *   extractSaticiVkn(text, foldFn)   - 10/11 haneli VKN/TCKN doner
 *   extractSaticiUnvan(text, foldFn) - tedarikci/satici unvanini doner
 *
 * Bu helper'lar `this` kullanmaz - saf fonksiyonlar.
 * `foldFn` parametresi caller tarafindan saglanan Turkce-ASCII katlama
 * fonksiyonudur (genellikle OcrService.foldTurkishAscii). Boylece bu modul
 * normalizeAzureText/foldTurkishAscii zincirine bagimsiz kalir.
 */

type FoldFn = (s: string) => string;

/**
 * Faturanin ust kisminda yer alan satici VKN/TCKN'sini bulur.
 * "SAYIN/ALICI/MUSTERI" kelimesinden onceki satirlari tarayarak
 * alici yerine saticinin bilgilerini secer.
 *
 * Once etiketli desenler (VKN/TCKN/VERGI NO/MUKELLEF NO), sonra
 * son care olarak ilk 10-11 haneli numarayi doner.
 */
export function extractSaticiVkn(text: string, foldFn: FoldFn): string | null {
  if (!text) return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const stop = lines.findIndex((l) => /SAYIN|ALICI|MUSTERI|MÜŞTERİ/.test(foldFn(l)));
  const top = (stop >= 0 ? lines.slice(0, stop) : lines.slice(0, 14)).join('\n');
  const folded = foldFn(top);
  const labeled = folded.match(/\b(?:VKN|TCKN|VERGI\s*NO|MUKELLEF(?:LER)?\s*NO)\b[^0-9]{0,30}(\d{10,11})/);
  if (labeled?.[1]) return labeled[1];
  // K10: Etiketsiz son-care — telefon/IBAN/fatura-no'yu VKN SANMA. Numarasinin gectigi
  // satirda TEL/GSM/FAX/IBAN/TR../FATURA/BELGE/MERSIS/SICIL ipucu varsa o satiri atla.
  for (const ln of top.split('\n')) {
    if (/\b\d{10,11}\b/.test(ln) && !/TEL|GSM|FAX|IBAN|\bTR\d|FATURA|BELGE|SIRA|MERSIS|SICIL/i.test(foldFn(ln))) {
      return ln.match(/\b(\d{10,11})\b/)![1];
    }
  }
  return null;
}

/**
 * Faturanin ust kismindan satici/tedarikci unvanini cikarir.
 * "SAYIN/ALICI/MUSTERI" kelimesinden onceki ilk anlamli sirket
 * satirini doner (LTD/LIMITED/ANONIM/AS/STI/SIRKET/TICARET... gibi
 * sirket eklerini iceren ya da yeterli sayida buyuk harf icerenler).
 */
export function extractSaticiUnvan(text: string, foldFn: FoldFn): string | null {
  if (!text) return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const stop = lines.findIndex((l) => /SAYIN|ALICI|MUSTERI|MÜŞTERİ/.test(foldFn(l)));
  const topLines = stop >= 0 ? lines.slice(0, stop) : lines.slice(0, 10);
  for (const raw of topLines) {
    const folded = foldFn(raw);
    if (folded.length < 5) continue;
    if (/\b(?:VKN|TCKN|VERGI|TEL|FAKS|WEB|E-?POSTA|MERSIS|TICARET\s+SICIL|FATURA|ETTN)\b/.test(folded)) continue;
    if (!/[A-Z]/.test(folded)) continue;
    if (/\b(?:LTD|LIMITED|ANONIM|AS|STI|SIRKET|TICARET|SANAYI|TURIZM|HIZMET|INSAAT|LOJISTIK|TASIMACILIK)\b/.test(folded)) {
      return raw.slice(0, 200);
    }
    if (folded.replace(/[^A-Z]/g, '').length >= 12) return raw.slice(0, 200);
  }
  return null;
}
