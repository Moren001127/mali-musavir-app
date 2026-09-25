/**
 * AŞAMA DAMGALARI — 2026-09-25, portal denetimi bulgu 46b.
 *
 * SORUN: `TaxpayerMonthlyStatus`ta tek aşama damgası vardı (`evraklarIslendiAt`).
 * Diğer aşamaların bekleme süresi genel `updatedAt`'ten ölçülüyordu; oysa `updatedAt`
 * satırdaki HERHANGİ bir alan değişince tazelenir. Sonuç: 208 gündür evrak bekleyen
 * bir mükellefte biri alakasız bir kutuyu işaretleyince gecikme sıfırlanıyordu — yani
 * en geç kalan iş, listede en yeni iş gibi görünüyordu.
 *
 * KURAL:
 *   false → true  : damga = o an
 *   true  → false : damga = null   (geri alınan durumda eski damga KALMAMALI; kalırsa
 *                   raporlar onu gerçek sanar — bulgu 49'daki `onayTarihi` dersi)
 *   değişmedi     : dokunulmaz     (aksi hâlde her kaydetme gecikmeyi sıfırlardı)
 *
 * GERİ DOLUM YOK: geçmiş geçişlerin anı hiçbir yerde tutulmuyor. Eski satırlarda
 * damgalar null kalır; okuyan taraf `updatedAt` yedeğine düşer. Uydurma tarih
 * yazılmaz — yanlış gecikme, hiç gecikme göstermemekten kötüdür.
 */

/** Bayrak alanı → damga alanı eşlemesi. Yeni aşama eklenirse TEK yer burasıdır. */
export const ASAMA_DAMGA_ALANLARI = {
  evraklarGeldi: 'evraklarGeldiAt',
  yuklendi: 'yuklendiAt',
  evraklarIslendi: 'evraklarIslendiAt',
  kontrolEdildi: 'kontrolEdildiAt',
  beyannameVerildi: 'beyannameVerildiAt',
} as const;

export type AsamaBayragi = keyof typeof ASAMA_DAMGA_ALANLARI;
export type AsamaDamgasi = (typeof ASAMA_DAMGA_ALANLARI)[AsamaBayragi];

/**
 * Yazılacak damga alanlarını hesaplar.
 *
 * @param mevcut    Veritabanındaki satır (yoksa null — yeni kayıt)
 * @param yeniVeri  Bu çağrıda gelen alanlar. `undefined` olanlara dokunulmaz.
 * @param simdi     Damga anı (sınama için dışarıdan verilebilir)
 * @returns         Yalnızca DEĞİŞEN damga alanları. Hiçbir şey değişmediyse boş nesne.
 */
export function asamaDamgalari(
  mevcut: Partial<Record<AsamaBayragi, boolean>> | null | undefined,
  yeniVeri: Partial<Record<AsamaBayragi, boolean | undefined>>,
  simdi: Date = new Date(),
): Partial<Record<AsamaDamgasi, Date | null>> {
  const sonuc: Partial<Record<AsamaDamgasi, Date | null>> = {};

  for (const bayrak of Object.keys(ASAMA_DAMGA_ALANLARI) as AsamaBayragi[]) {
    const gelen = yeniVeri[bayrak];
    if (typeof gelen !== 'boolean') continue; // bu çağrıda gönderilmemiş → dokunma

    // Kayıt yoksa önceki değer varsayılan `false` sayılır.
    const onceki = mevcut ? mevcut[bayrak] === true : false;
    if (gelen === onceki) continue; // değişmedi → damgaya dokunma

    sonuc[ASAMA_DAMGA_ALANLARI[bayrak]] = gelen ? simdi : null;
  }

  return sonuc;
}

/**
 * Bir aşamanın bekleme başlangıcını verir: damga varsa o, yoksa yedek.
 * Eski satırlarda damga null olduğu için yedek şart.
 */
export function damgaVeyaYedek(damga: Date | string | null | undefined, yedek: Date): Date {
  if (!damga) return yedek;
  const d = damga instanceof Date ? damga : new Date(damga);
  return Number.isNaN(d.getTime()) ? yedek : d;
}
