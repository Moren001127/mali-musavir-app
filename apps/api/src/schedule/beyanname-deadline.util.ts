/**
 * Beyanname son verme tarihi (TC standart) — TEK KAYNAK.
 * Hem BeyannameDeadlineCron (hatırlatma) hem get_operation_briefing (owner brifingi)
 * buradan hesaplar; kural tek yerde dursun, kopya/sapma olmasın.
 *
 * Son tarih kuralları (kabaca):
 *   - KDV1, KDV2, KDV4, KDV9015     -> sonraki ayın 28'i
 *   - MUHSGK, MUHSGK2, KONAKLAMA,
 *     OIV, GMSI, TURIZM             -> sonraki ayın 26'sı
 *   - DAMGA                         -> sonraki ayın 25'i
 *   - POSET                         -> sonraki ayın 24'ü
 *   - BILDIRGE                      -> sonraki ayın 23'ü
 *   - OTV1/3A/3B/4                  -> sonraki ayın 15'i
 *   - GGECICI, KGECICI              -> sonraki ayın 17'si
 *   - EDEFTER                       -> 3 ay sonrasının son günü
 *   - KURUMLAR                      -> 30 Nisan
 *   - GELIR                         -> 31 Mart
 */
export function calculateBeyannameDeadline(beyanTipi: string, donem: string): Date | null {
  const [yearStr, monthStr] = String(donem || '').split('-');
  const year = Number(yearStr);
  const month = Number(monthStr); // 1-12
  if (!year || !month) return null;

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  const mkDate = (y: number, m: number, d: number) =>
    new Date(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T23:59:59+03:00`);

  switch (beyanTipi) {
    case 'KDV1':
    case 'KDV2':
    case 'KDV4':
    case 'KDV9015':
      return mkDate(nextYear, nextMonth, 28);
    case 'MUHSGK':
    case 'MUHSGK2':
    case 'KONAKLAMA':
    case 'OIV':
    case 'GMSI':
    case 'TURIZM':
      return mkDate(nextYear, nextMonth, 26);
    case 'DAMGA':
      return mkDate(nextYear, nextMonth, 25);
    case 'BILDIRGE':
      return mkDate(nextYear, nextMonth, 23);
    case 'POSET':
      return mkDate(nextYear, nextMonth, 24);
    case 'EDEFTER': {
      const targetMonth = month + 3 > 12 ? month + 3 - 12 : month + 3;
      const targetYear = month + 3 > 12 ? year + 1 : year;
      const lastDay = new Date(targetYear, targetMonth, 0).getDate();
      return mkDate(targetYear, targetMonth, lastDay);
    }
    case 'GGECICI':
    case 'KGECICI':
      return mkDate(nextYear, nextMonth, 17);
    case 'KURUMLAR':
      return mkDate(year, 4, 30); // 30 Nisan
    case 'GELIR':
      return mkDate(year, 3, 31); // 31 Mart
    case 'OTV1':
    case 'OTV3A':
    case 'OTV3B':
    case 'OTV4':
      return mkDate(nextYear, nextMonth, 15);
    default:
      return null;
  }
}
