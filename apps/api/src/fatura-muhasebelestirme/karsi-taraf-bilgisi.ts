/**
 * karsi-taraf-bilgisi.ts — GİB e-Arşiv/e-Fatura GÖRÜNÜMÜNDEN (HTML) karşı tarafın vergi dairesi + adresi
 * (2026-09-23, DOĞAN ÖZKAN → ECT TURİZM olayı).
 *
 * Luca HIZLI FİŞ, TCKN/VKN'li satırda cari kartını "Fiş Kes" anında kendisi açar ve bunun için VERGİ DAİRESİ ister.
 * Alıcı Luca'da kayıtlı değilse (Luca'nın kendi cari sorgusu boş dönerse) satır SESSİZCE reddediliyordu — ekranda hata
 * yok, satır olduğu gibi kalıyor. Oysa belgenin GİB görünümünde karşı tarafın vergi dairesi ve adresi zaten yazılı:
 *   "SAYIN" bloğu = ALICI (satış faturasında karşı taraf), üstteki blok = SATICI (alış faturasında karşı taraf).
 * Saf metin işleme — veritabanı yok; test edilir.
 */

export interface KarsiTaraf {
  kimlikNo: string;
  unvan: string;
  vergiDairesi: string;
  adres: string;
}

/** HTML → satırlı düz metin (tarayıcı innerText'e yakın: hücreler sekmeyle, satırlar/bloklar yeni satırla). */
export function htmlMetne(html: string): string {
  let s = String(html || '');
  s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(td|th)>/gi, '\t');
  s = s.replace(/<\/(p|div|tr|li|h\d|table|thead|tbody|section)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  return varliklariCoz(s);
}

/** GİB görünümünde Türkçe harfler adlı varlıkla yazılı (BEYLİKD&Uuml;Z&Uuml;) — canlı 23.09: çözülmeyince Luca'ya bozuk gitti. */
const ADLI_VARLIKLAR: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  Uuml: 'Ü', uuml: 'ü', Ouml: 'Ö', ouml: 'ö', Ccedil: 'Ç', ccedil: 'ç', Auml: 'Ä', auml: 'ä',
  Acirc: 'Â', acirc: 'â', Icirc: 'Î', icirc: 'î', Ucirc: 'Û', ucirc: 'û', Ecirc: 'Ê', ecirc: 'ê', Ocirc: 'Ô', ocirc: 'ô',
  Eacute: 'É', eacute: 'é', Agrave: 'À', agrave: 'à', Egrave: 'È', egrave: 'è', Iacute: 'Í', iacute: 'í', Oacute: 'Ó', oacute: 'ó', Uacute: 'Ú', uacute: 'ú',
  szlig: 'ß', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', deg: '°', middot: '·', times: '×',
};
export function varliklariCoz(s: string): string {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&([A-Za-z]+);/g, (m, ad) => (Object.prototype.hasOwnProperty.call(ADLI_VARLIKLAR, ad) ? ADLI_VARLIKLAR[ad] : m));
}

/** Adres olmayan etiket satırları (bu satırda adres biter). */
const ETIKET_SATIRI = /^(Tel\b|Fax\b|Web\s*Sitesi|E-?Posta|Vergi\s*Dairesi|VKN\b|TCKN\b|Vergi\s*No|T\.?C\.?\s*Kimlik)/i;
/** Fatura künyesi / başlık satırları — taraf bloğunun sınırı. */
const KUNYE_BASI = /^(Özelleştirme\s*No|Senaryo|Fatura\s*Tipi|Fatura\s*No|Fatura\s*Tarihi|ETTN|e-?Arşiv\s*Fatura|e-?Fatura|İrsaliye)\b/i;

/** Adres satırını temizle: boş "No:" / "Kapı No:" etiketleri, tek başına duran "/" ayraçları, sondaki ülke adı, fazla boşluk. */
function adresTemizle(satir: string): string {
  return satir
    .replace(/\b(Kapı\s*No|No)\s*:(?=\s*(?:$|\/))/gi, ' ') // "No:" / "Kapı No:" boş kalmışsa (değeri olan "No:128B" korunur)
    .replace(/(^|\s)\/(?=\s|$)/g, ' ')                       // yalnız başına "/" (tokenin içindeki "131/6" korunur)
    .replace(/\s+/g, ' ')
    .replace(/\s*\bTürkiye\s*$/i, '')
    .trim();
}

/**
 * Karşı tarafın bilgisi. yon=SATIS → "SAYIN" altındaki alıcı; yon=ALIS → üstteki satıcı.
 * Blok sınırı: "Vergi Dairesi" satırının iki yanındaki ilk künye/başlık satırları (başlık üstte de olabilir).
 * beklenenKimlikNo verilirse ve blokta BAŞKA bir kimlik no okunursa null (yanlış tarafa yazılmasın).
 */
export function earsivHtmlKarsiTaraf(html: string, yon: 'ALIS' | 'SATIS', beklenenKimlikNo?: string): KarsiTaraf | null {
  const satirlar = htmlMetne(html)
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim());
  const sayinIdx = satirlar.findIndex((l) => /^SAYIN\b/i.test(l));
  if (sayinIdx < 0) return null;
  const ham = yon === 'SATIS' ? satirlar.slice(sayinIdx + 1) : satirlar.slice(0, sayinIdx);
  const vdIdx = ham.findIndex((l) => /Vergi\s*Dairesi/i.test(l));
  let bas = 0;
  let son = ham.length;
  if (vdIdx >= 0) {
    for (let i = vdIdx - 1; i >= 0; i--) if (KUNYE_BASI.test(ham[i])) { bas = i + 1; break; }
    for (let i = vdIdx + 1; i < ham.length; i++) if (KUNYE_BASI.test(ham[i])) { son = i; break; }
  } else {
    const b = ham.findIndex((l) => KUNYE_BASI.test(l));
    if (b >= 0) son = b;
  }
  const blok = ham.slice(bas, son).filter((l) => l.length > 0);
  if (!blok.length) return null;

  let vergiDairesi = '';
  let kimlikNo = '';
  for (let i = 0; i < blok.length; i++) {
    const l = blok[i];
    const vd = l.match(/Vergi\s*Dairesi\s*:?\s*(.*)$/i);
    if (vd && !vergiDairesi) {
      vergiDairesi = vd[1].trim();
      if (!vergiDairesi && blok[i + 1] && !ETIKET_SATIRI.test(blok[i + 1])) vergiDairesi = blok[i + 1].trim();
    }
    const kn = l.match(/\b(?:VKN|TCKN|Vergi\s*No|T\.?C\.?\s*Kimlik\s*No)\s*:?\s*(\d{10,11})\b/i);
    if (kn && !kimlikNo) kimlikNo = kn[1];
  }
  const beklenen = String(beklenenKimlikNo || '').replace(/\D/g, '');
  if (beklenen && kimlikNo && kimlikNo !== beklenen) return null;

  const unvanIdx = blok.findIndex((l) => !ETIKET_SATIRI.test(l) && !/^\d{10,11}$/.test(l));
  const unvan = unvanIdx >= 0 ? blok[unvanIdx] : '';
  const adresParcalari: string[] = [];
  for (let i = unvanIdx + 1; unvanIdx >= 0 && i < blok.length; i++) {
    if (ETIKET_SATIRI.test(blok[i])) break;
    const t = adresTemizle(blok[i]);
    if (t) adresParcalari.push(t);
  }
  const adres = adresTemizle(adresParcalari.join(' ')).slice(0, 250);
  vergiDairesi = vergiDairesi.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!vergiDairesi && !adres) return null;
  return { kimlikNo, unvan: unvan.slice(0, 200), vergiDairesi, adres };
}
