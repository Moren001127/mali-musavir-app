/**
 * GİB e-Arşiv portalı 2026-09-22 itibarıyla sorgu tarih aralığını EN FAZLA 7 GÜN ile sınırladı
 * (portal takviminde 8. günden sonrası seçilemiyor). Kullanıcı ayı seçtiğinde sorgu arka planda
 * 7'şer günlük pencerelere bölünüp birleştirilir.
 *
 * Saf yardımcı: tarih hesabı UTC üzerinden yapılır (yerel saat/yaz saati kaymasın),
 * giriş/çıkış "YYYY-MM-DD" biçimindedir.
 */

/** GİB'in kabul ettiği en geniş pencere (gün). */
export const EARSIV_PENCERE_GUN = 7;

export interface TarihPenceresi {
  /** YYYY-MM-DD */
  bas: string;
  /** YYYY-MM-DD (dâhil) */
  bit: string;
}

const gunMs = 24 * 60 * 60 * 1000;

/** "2026-08-01" | Date | "2026-08-01T00:00:00Z" → UTC gün başlangıcı; çözülemezse null. */
export function gunBasi(deger: string | Date | null | undefined): Date | null {
  if (!deger) return null;
  if (deger instanceof Date) {
    if (Number.isNaN(deger.getTime())) return null;
    return new Date(Date.UTC(deger.getUTCFullYear(), deger.getUTCMonth(), deger.getUTCDate()));
  }
  const metin = String(deger).trim();
  const m = metin.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // 31.08.2026 / 31/08/2026
  const t = metin.match(/^(\d{2})[./](\d{2})[./](\d{4})/);
  if (t) return new Date(Date.UTC(Number(t[3]), Number(t[2]) - 1, Number(t[1])));
  const ms = Date.parse(metin);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * [bas, bit] aralığını en fazla `gun` günlük, ARDIŞIK ve ÇAKIŞMAYAN pencerelere böler.
 * - Aralık zaten sınırın içindeyse tek pencere döner (davranış değişmez).
 * - Bitiş başlangıçtan önceyse tek günlük pencere döner (çağıran boşa dönmesin).
 * - Tarihler çözülemezse boş dizi döner (çağıran eski davranışa düşsün).
 */
export function tarihPencereleri(
  bas: string | Date | null | undefined,
  bit: string | Date | null | undefined,
  gun: number = EARSIV_PENCERE_GUN,
): TarihPenceresi[] {
  const b = gunBasi(bas);
  const s = gunBasi(bit);
  if (!b || !s) return [];
  const adim = Math.max(1, Math.floor(gun));
  if (s.getTime() < b.getTime()) return [{ bas: ymd(b), bit: ymd(b) }];

  const pencereler: TarihPenceresi[] = [];
  let imlec = b.getTime();
  const sonMs = s.getTime();
  // Güvenlik freni: bir yıllık aralıkta bile ~53 pencere olur; 400 tur yeter.
  for (let tur = 0; imlec <= sonMs && tur < 400; tur++) {
    const pencereSon = Math.min(imlec + (adim - 1) * gunMs, sonMs);
    pencereler.push({ bas: ymd(new Date(imlec)), bit: ymd(new Date(pencereSon)) });
    imlec = pencereSon + gunMs;
  }
  return pencereler;
}
