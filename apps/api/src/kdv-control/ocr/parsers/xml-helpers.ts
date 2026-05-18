/**
 * XML helpers — UBL fatura XML'inden tag deger / blok cikartma.
 *
 * Public API (Faz 1 modul izolasyon):
 *   decodeXmlText(value)              - XML escape karakterlerini decode eder
 *   getXmlTagValue(xml, tag)          - <tag>...</tag> icerigini doner (namespace prefix toleransli)
 *   getXmlBlocks(xml, tag)            - tum <tag>...</tag> bloklarinin icerikleri (array)
 *   stripXmlBlocks(xml, tag)          - tum <tag>...</tag> bloklarini metinden cikarir
 *   parseXmlAmount(xml, tag, parser)  - <tag>...</tag> icerigini parser ile sayiya cevirir
 *
 * Bu helper'lar `this` kullanmaz - saf fonksiyonlar.
 * `parseXmlAmount` icin `parser` callback (genellikle OcrService.parseAmount).
 */

type AmountParser = (s: string) => number;

/** XML escape karakterlerini decode eder: &amp; &lt; &gt; &quot; &apos; */
export function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * XML icindeki ilk `<tag>...</tag>` (veya `<ns:tag>...</ns:tag>`) icerigini doner.
 * Bos string veya bulunamayan tag icin null.
 */
export function getXmlTagValue(xml: string, tag: string): string | null {
  const name = `(?:[\\w.-]+:)?${tag}`;
  const match = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match?.[1] ? decodeXmlText(match[1].trim()) : null;
}

/**
 * Tum `<tag>...</tag>` bloklarinin icerigini array olarak doner (decode YAPMAZ;
 * inner XML yapisi korunur cunku alt-tag'lar olabilir).
 */
export function getXmlBlocks(xml: string, tag: string): string[] {
  const name = `(?:[\\w.-]+:)?${tag}`;
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'gi');
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

/** Tum `<tag>...</tag>` bloklarini XML'den cikarir (kalan metin doner). */
export function stripXmlBlocks(xml: string, tag: string): string {
  const name = `(?:[\\w.-]+:)?${tag}`;
  return xml.replace(new RegExp(`<${name}\\b[^>]*>[\\s\\S]*?<\\/${name}>`, 'gi'), '');
}

/**
 * `<tag>` icerigini sayiya cevirir. Tag yoksa veya parse edilemiyorsa 0.
 * `parser` callback genelde caller'in parseAmount metodudur (TR sayi formati,
 * para birimi simgesi temizleme, vb.).
 */
export function parseXmlAmount(xml: string, tag: string, parser: AmountParser): number {
  const raw = getXmlTagValue(xml, tag);
  return raw ? parser(raw) : 0;
}
