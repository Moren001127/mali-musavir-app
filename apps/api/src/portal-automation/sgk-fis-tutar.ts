// SGK tahakkuk fişinden ÖDENECEK NET TUTAR'ı GÜVENLİ okuma (2026-09-14).
//
// Vaka (Muzaffer Bey): ERCAN ÖZTAMUR 2026/07 belge türü 02 (SGDP) fişinde tutar 6.606,00 okundu; doğrusu 2.130,44.
//   ZEYREK LOJİSTİK aynı: 22.020,00 yerine 7.101,45. Eski yöntem metindeki TÜM para değerlerinde "a+b=c olan EN BÜYÜK c"
//   arıyordu; fişte İŞSİZLİK TUTARI 0,00 olunca her değer için "x + 0,00 = x" sağlanıyor ve en büyük değer olan
//   PRİME ESAS KAZANÇ (6.606,00) seçiliyordu.
//
// Yeni yöntem (pdf-parse v2 `getTable()`): fişin sağ sütunu ("PRİM TUTARI" başlıklı hücre) görsel sırayla gelir:
//   [satır primleri…, TOPLAM PRİM, NET PRİM TUTARI, İŞSİZLİK TUTARI, ÖDENECEK NET TUTAR]. Prime esas kazanç değerleri bu
//   sütunda YOKTUR. ÖDENECEK NET TUTAR = NET PRİM + İŞSİZLİK eşitliğini sağlayan, sondan ilk değerdir (6111 gibi fişlerde
//   altına ek satır gelse bile). Eşitlik sağlanmazsa sütunun son değeri alınır ve `dogrulandi=false` işaretlenir.
// Yedek yol (tablo çıkarılamazsa): düz metindeki para değerleri; yalnız a>0 ve b>0 olan a+b=c üçlüleri sayılır
//   (0,00 ile "x+0=x" tuzağı yok) ve metin sırasında EN SONDAKİ aday alınır.

export type SgkTutarSonucu = { tutar: string | null; dogrulandi: boolean; yontem: 'tablo' | 'metin' | 'yok'; sutun?: string[] };

const PARA = /\d{1,3}(?:\.\d{3})*,\d{2}/g;

export function paraSayi(v: string): number {
  return Number(String(v).replace(/\./g, '').replace(',', '.'));
}

function ascii(s: string): string {
  return String(s || '')
    .replace(/İ/g, 'I').replace(/ı/g, 'i').replace(/Ş/g, 'S').replace(/ş/g, 's').replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
    .replace(/Ü/g, 'U').replace(/ü/g, 'u').replace(/Ö/g, 'O').replace(/ö/g, 'o').replace(/Ç/g, 'C').replace(/ç/g, 'c')
    .toUpperCase();
}

/** `getTable()` çıktısındaki tüm hücre metinlerini düz liste yapar (sayfa/tablo/satır iç içe dizileri). */
export function tabloHucreleri(tablo: unknown): string[] {
  const out: string[] = [];
  const gez = (x: unknown) => {
    if (typeof x === 'string') { out.push(x); return; }
    if (Array.isArray(x)) { for (const e of x) gez(e); return; }
    if (x && typeof x === 'object') { for (const v of Object.values(x as Record<string, unknown>)) gez(v); }
  };
  gez(tablo);
  return out;
}

/** "PRİM TUTARI" sütun bloğundaki para değerleri (görsel sıra). Bulunamazsa null. */
export function primTutariSutunu(tablo: unknown): string[] | null {
  for (const hucre of tabloHucreleri(tablo)) {
    const a = ascii(hucre);
    if (!/PRIM\s*TUTARI/.test(a)) continue;
    // Başlık hücresi ile değerler aynı hücrede: "PRİM TUTARI 148,64\n 1.981,80\n2.130,44…"
    const govde = hucre.slice(a.indexOf('PRIM TUTARI') + 'PRIM TUTARI'.length);
    const degerler = govde.match(PARA) || [];
    if (degerler.length >= 2) return degerler;
  }
  return null;
}

/**
 * Sütun değerlerinden ÖDENECEK NET TUTAR: sondan başlayarak ilk k için
 *   v[k] ≈ v[k-2] + v[k-1]           (NET PRİM + İŞSİZLİK — bugünkü fiş)
 *   v[k] ≈ v[k-3] + v[k-2] + v[k-1]  (NET PRİM + DAMGA VERGİSİ + İŞSİZLİK — 2016-2020 eski fiş biçimi)
 */
export function sutundanOdenecek(degerler: string[]): { tutar: string; dogrulandi: boolean } | null {
  if (!degerler.length) return null;
  const n = degerler.map(paraSayi);
  const esit = (a: number, b: number) => Math.abs(a - b) <= 0.02;
  for (let k = n.length - 1; k >= 2; k--) {
    if (n[k] <= 0) continue;
    if (esit(n[k - 2] + n[k - 1], n[k])) return { tutar: degerler[k], dogrulandi: true };
    if (k >= 3 && esit(n[k - 3] + n[k - 2] + n[k - 1], n[k])) return { tutar: degerler[k], dogrulandi: true };
  }
  // Hepsi 0,00 (tahakkuk yok) → 0,00 doğrulanmış sayılır.
  if (n.every((v) => v === 0)) return { tutar: degerler[degerler.length - 1], dogrulandi: true };
  return { tutar: degerler[degerler.length - 1], dogrulandi: false };
}

/** Yedek: düz metin. a>0, b>0, a+b≈c; metin sırasında EN SON aday. */
export function metindenOdenecek(metin: string): { tutar: string; dogrulandi: boolean } | null {
  const hepsi = String(metin || '').match(PARA) || [];
  if (!hepsi.length) return null;
  const n = hepsi.map(paraSayi);
  let sonAday = -1;
  for (let k = 0; k < n.length; k++) {
    if (n[k] <= 0) continue;
    let ok = false;
    for (let i = 0; i < n.length && !ok; i++) {
      if (i === k || n[i] <= 0) continue;
      for (let j = i + 1; j < n.length; j++) {
        if (j === k || n[j] <= 0) continue;
        if (Math.abs(n[i] + n[j] - n[k]) <= 0.02) { ok = true; break; }
      }
    }
    if (ok) sonAday = k;
  }
  if (sonAday >= 0) return { tutar: hepsi[sonAday], dogrulandi: true };
  return { tutar: hepsi[hepsi.length - 1], dogrulandi: false };
}

/** Ana giriş: önce tablo sütunu, sonra metin. */
export function sgkOdenecekTutar(tablo: unknown | null, metin: string): SgkTutarSonucu {
  const sutun = tablo ? primTutariSutunu(tablo) : null;
  if (sutun) {
    const r = sutundanOdenecek(sutun);
    if (r) return { ...r, yontem: 'tablo', sutun };
  }
  const m = metindenOdenecek(metin);
  if (m) return { ...m, yontem: 'metin' };
  return { tutar: null, dogrulandi: false, yontem: 'yok' };
}
