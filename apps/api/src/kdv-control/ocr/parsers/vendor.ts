/**
 * Vendor parsers — Azure OCR ham metninden satici (VKN + unvan) bilgilerini cikarir.
 *
 * Public API (Faz 1 modul izolasyon):
 *   extractSaticiVkn(text, foldFn)   - 10/11 haneli VKN/TCKN doner
 *   extractSaticiUnvan(text, foldFn) - tedarikci/satici unvanini BLOK halinde doner
 *                                      (cok satira bolunmus unvan birlestirilir)
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
  // OKC fislerinde VKN cogunlukla vergi dairesi satirinda yazar:
  // "IKITELI VD:0800371588" veya "V.D. : 0800371588" — "VD" etiketi de VKN kaynagidir
  // (gercek vaka: ARS OTOMOBIL fisi, VKN bos kaliyordu).
  const vdLabeled = folded.match(/\bV\.?\s*D\.?\b[^0-9\n]{0,25}(\d{10,11})\b/);
  if (vdLabeled?.[1]) return vdLabeled[1];
  // K10: Etiketsiz son-care — telefon/IBAN/fatura-no'yu VKN SANMA. Numarasinin gectigi
  // satirda TEL/GSM/FAX/IBAN/TR../FATURA/BELGE/MERSIS/SICIL ipucu varsa o satiri atla.
  // Kelime-siniri sart: "IKITELI VD:0800371588" satiri "TEL" alt-dizisi yuzunden
  // telefon sanilip atlaniyordu (IKI-TEL-I) → \b(TEL\w*)\b yalnizca gercek
  // TEL/TELEFON etiketini eler, kelime icindeki "tel"e takilmaz.
  for (const ln of top.split('\n')) {
    if (/\b\d{10,11}\b/.test(ln) && !/\b(?:TEL\w*|GSM|FAX|FAKS|IBAN|FATURA|BELGE|SIRA|MERSIS|SICIL)\b|\bTR\d/i.test(foldFn(ln))) {
      return ln.match(/\b(\d{10,11})\b/)![1];
    }
  }
  return null;
}

// ═══ UNVAN BLOĞU sabitleri (2026-09-25) ═══
// Adres/konum işaretleri — unvan bloğu burada BİTER. "MH" (noktasız kısaltma) eskiden listede
// YOKTU; OTO GENÇ fişinde "LTD.ŞTİ.FEVZİ ÇAKMAK MH." satırının firma adı sanılmasının sebebi buydu.
const ADRES_ISARETI =
  /\b(?:MH|MAH|MAHALLE(?:SI)?|CD|CAD|CADDE(?:SI)?|SK|SOK|SOKAK|BLV|BULV(?:AR)?|APT|KAT|DAIRE|SIT|SITE(?:SI)?|IS\s*MERKEZI|PLAZA|BLOK|OSB|ORGANIZE|POSTA\s*KODU|PK)\b|\bNO\s*[:.]?\s*\d/;

// Unvan bloğunu bitiren meta satırlar: vergi dairesi/VKN, iletişim, sicil, tarih/fiş başlıkları.
// "TIC SIC" birlikte aranır — tek başına "TIC" unvanın kendi ekidir ("SAN.VE TİC.A.Ş.").
const META_ISARETI =
  /\bV\.?\s*D\.?\b|\bVKN\b|\bTCKN\b|\bVERGI\b|\bTEL\w*\b|\bGSM\b|\bFAX\b|\bFAKS\b|\bMERSIS\b|\bLISANS\b|\bTIC\.?\s*SIC\b|\bTICARET\s*SICIL\b|\bODA\s*SICIL\b|\bADA\s*NO\b|\bFIS\s*NO\b|\bFATURA\b|\bBELGE\s*NO\b|\bTARIH\b|\bSAAT\b|\bZ\s*NO\b|\bEKU\b|\bWEB\b|\bE-?POSTA\b|\bETTN\b|\bIBAN\b|\bSERI\s*NO\b/;

// Unvan ekleri (kelime bazlı) — karma satırda baştaki "ek" parçalarını ayırmak için.
const EK_KELIME =
  /^(?:LTD|LIMITED|STI|SIRKET(?:I)?|ANONIM|AS|A|S|SAN|SANAYI|SANAYII|TIC|TICARET|VE|INS|INSAAT|TURZ|TURIZM|PAZ|PAZARLAMA|NAK|NAKLIYAT|NAKLIYE|TAS|TASIMACILIK|OTM|OTOMOTIV|OTO|GIDA|PETROL|PET|URUN(?:LERI)?|UR|MALZ(?:EMELERI)?|HIZ(?:METLERI)?|DIS|IC|KOLL|KOM|ITH|IHR|ITHALAT|IHRACAT|MUH|MUHENDISLIK|ENERJI|ELEKT(?:RIK)?|TEKS|TEKSTIL)$/;

// "Anlamlı" şirket eki — kırpılmış parçanın gerçekten unvan devamı olduğunu doğrular.
const GUCLU_EK = /\b(?:LTD|STI|SIRKET|ANONIM|AS|SAN|SANAYI|TIC|TICARET|INS|INSAAT|PAZ|NAK|OTM|GIDA|PETROL|MALZ|HIZ|ITH|IHR|LIMITED)\b/;

/** Parçanın TÜM kelimeleri unvan eki mi ("VE TİC", "SAN", "LTD")? */
function hepsiEkMi(parcaFolded: string): boolean {
  const kelimeler = parcaFolded.split(/[^A-Z0-9]+/).filter(Boolean);
  if (!kelimeler.length) return false;
  return kelimeler.every((k) => EK_KELIME.test(k));
}

/**
 * Karma satırda ("LTD.ŞTİ.FEVZİ ÇAKMAK MH.") baştaki unvan-eki parçalarını döner → "LTD.ŞTİ."
 * İlk parça en az 2 harfli GERÇEK bir ek olmalı: "K.SİNAN MERKEZ MAH."in "K"si ya da
 * "75. YIL MAH."in "75"i unvan sanılmasın.
 */
function ekOnekiniAl(raw: string, foldFn: FoldFn): string | null {
  const alinan: string[] = [];
  for (const parca of raw.split('.')) {
    const t = parca.trim();
    if (!t) break;
    const f = foldFn(t).trim();
    if (!hepsiEkMi(f)) break;
    if (alinan.length === 0 && f.replace(/[^A-Z]/g, '').length < 2) break;
    alinan.push(parca);
  }
  if (!alinan.length) return null;
  const metin = alinan.join('.').trim();
  if (!GUCLU_EK.test(foldFn(metin))) return null;  // yalnız "VE" gibi bir kırıntı — boşver
  return `${metin}.`;
}

/**
 * Faturanin/fisin ust kismindan satici unvanini cikarir — UNVAN BLOGU birlestirerek.
 *
 * NEDEN BLOK (2026-09-25, gercek vaka ERCAN SANLAV temmuz fisleri): eski surum ust bloktan
 * TEK satir secerdi. OKC fislerinde unvan 2-3 satira bolunur; bu yuzden ya ilk satir
 * atlaniyordu ("HIDAYETOTO YEDEK PARCA" kaybolup "IC VE DIS TICARET A.S." kaliyordu) ya da
 * ADRES satiri firma adi saniliyordu ("LTD.STI.FEVZI CAKMAK MH."). Canli olcum: ham metni
 * olan 550 alis belgesinin 522'sinde unvan eksik/yanlisti.
 *
 * Yeni davranis: en ustten baslanip ADRES ya da META (VKN/TEL/MERSIS/TARIH/FIS NO...) satirina
 * kadar ardisik satirlar birlestirilir. Karma satirda yalniz bastaki ek parcalari alinir.
 */
export function extractSaticiUnvan(text: string, foldFn: FoldFn): string | null {
  if (!text) return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const stop = lines.findIndex((l) => /SAYIN|ALICI|MUSTERI|MÜŞTERİ/.test(foldFn(l)));
  const topLines = stop >= 0 ? lines.slice(0, stop) : lines.slice(0, 12);

  const parcalar: string[] = [];
  for (let i = 0; i < Math.min(topLines.length, 8); i++) {
    const raw = topLines[i];
    const folded = foldFn(raw);
    // Blok henüz başlamadıysa üstteki çöp (logo/slogan/tutar kalıntısı) atlanabilir;
    // blok başladıktan sonra ilk engel bloğu BİTİRİR.
    const atlanabilir = parcalar.length === 0;

    if (META_ISARETI.test(folded) || folded.replace(/[^A-Z]/g, '').length < 2) {
      if (atlanabilir) continue;
      break;
    }
    if (ADRES_ISARETI.test(folded)) {
      const kirpik = ekOnekiniAl(raw, foldFn);
      if (kirpik) { parcalar.push(kirpik); break; }
      if (atlanabilir) continue;
      break;
    }
    // DEVAM SATIRI KAPISI (gerçek vaka: BASBUG e-faturasında 3. satır "Bakanlar" = arka plan
    // filigranı, unvana yapışıyordu). Unvanın 2. ve sonraki satırı ya bir ŞİRKET EKİ taşımalı
    // ("SAN.TİC.LTD.ŞTİ.") ya da en az İKİ kelime olmalı ("MANİNUR KÖSE", "İLKER ÖNER").
    if (parcalar.length > 0) {
      const kelimeSayisi = folded.split(/[^A-Z0-9]+/).filter(Boolean).length;
      if (!GUCLU_EK.test(folded) && kelimeSayisi < 2) break;
    }
    parcalar.push(raw);
    if (parcalar.length >= 3) break;  // kaçak büyümeyi engelle
  }

  if (!parcalar.length) return null;
  return parcalar.join(' ').replace(/\s{2,}/g, ' ').trim().slice(0, 200) || null;
}
