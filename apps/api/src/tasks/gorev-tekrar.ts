/**
 * GÖREV TEKRAR MOTORU — saf hesap (2026-09-14, Görevler & Notlar yeniden tasarımı Faz 2).
 *
 * Sorun: `Task.recurrence` (RecurrenceConfig) kaydediliyor ama tekrarı üreten hiçbir kod yoktu — 11 "tekrarlı" görev
 * hiç tekrarlanmadı, `nextOccurrence` hiç hesaplanmadı. Burada yalnız tarih hesabı var (DB yok); cron servisi
 * `gorev-tekrar.service.ts` bunu kullanır.
 *
 * Tarihler "takvim günü" düzeyinde (Europe/Istanbul günü) — saat `dueTime` alanında ayrıca taşınır. Hesap UTC gece
 * yarısı Date nesneleriyle yapılır (yıl-ay-gün), böylece saat dilimi kayması olmaz.
 */

export type TekrarTuru = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface TekrarAyari {
  type: TekrarTuru;
  /** her N gün/hafta/ay/yıl (varsayılan 1) */
  interval?: number;
  /** WEEKLY: 0=Pazar … 6=Cumartesi */
  weekdays?: number[];
  /** MONTHLY: 1..31, -1 = ayın son günü */
  monthDay?: number;
  /** MONTHLY: ayın N. haftaiçi günü (örn. ikinci Salı) */
  monthOrdinal?: 'FIRST' | 'SECOND' | 'THIRD' | 'FOURTH' | 'LAST';
  monthOrdinalDay?: number;
  /** YEARLY: 1..12 ve 1..31 */
  yearMonth?: number;
  yearDay?: number;
  /** bitiş: tarih (ISO gün) ya da toplam adet */
  endDate?: string;
  count?: number;
}

/** 'YYYY-MM-DD' → UTC gece yarısı Date (takvim günü) */
export function gunYap(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}
export function gunAnahtari(t: Date): string {
  return t.toISOString().slice(0, 10);
}
/** Herhangi bir Date'i (İstanbul'a göre) takvim gününe indirger */
export function istanbulGunu(t: Date): Date {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(t);
  const al = (tip: string) => Number(p.find((x) => x.type === tip)?.value);
  return gunYap(al('year'), al('month'), al('day'));
}
function gunEkle(t: Date, n: number): Date {
  return new Date(t.getTime() + n * 86400000);
}
function ayinSonGunu(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1..12 → sonraki ayın 0. günü
}
function ayIcindeGun(y: number, m: number, a: TekrarAyari): Date | null {
  if (a.monthOrdinal && a.monthOrdinalDay !== undefined) {
    const hedefGun = ((a.monthOrdinalDay % 7) + 7) % 7;
    const son = ayinSonGunu(y, m);
    const adaylar: number[] = [];
    for (let d = 1; d <= son; d++) if (gunYap(y, m, d).getUTCDay() === hedefGun) adaylar.push(d);
    if (!adaylar.length) return null;
    const sira = { FIRST: 0, SECOND: 1, THIRD: 2, FOURTH: 3, LAST: adaylar.length - 1 }[a.monthOrdinal];
    const d = adaylar[sira];
    return d ? gunYap(y, m, d) : null;
  }
  const md = Number(a.monthDay || 1);
  const son = ayinSonGunu(y, m);
  const d = md === -1 ? son : Math.min(Math.max(1, md), son); // 31 seçilmiş ama ay 30 çekiyorsa ayın son günü
  return gunYap(y, m, d);
}

/**
 * Verilen tarihten SONRAKİ ilk tekrar gününü döner (aynı gün hariç). Bitiş tarihi geçildiyse null.
 * `sonTarih` = son üretilen oluşumun günü (yoksa şablonun vade günü / oluşturulma günü).
 */
export function sonrakiTekrar(ayar: TekrarAyari | null | undefined, sonTarih: Date): Date | null {
  if (!ayar || !ayar.type || ayar.type === 'NONE') return null;
  const aralik = Math.max(1, Math.floor(Number(ayar.interval || 1)));
  const son = istanbulGunu(sonTarih);
  let aday: Date | null = null;

  if (ayar.type === 'DAILY') {
    aday = gunEkle(son, aralik);
  } else if (ayar.type === 'WEEKLY') {
    const gunler = (ayar.weekdays || []).map((g) => ((g % 7) + 7) % 7).sort((a, b) => a - b);
    const kume = gunler.length ? gunler : [son.getUTCDay()];
    // aynı haftada daha ileri bir gün var mı?
    for (let i = 1; i <= 7; i++) {
      const t = gunEkle(son, i);
      const haftaBasiSon = gunEkle(son, -((son.getUTCDay() + 6) % 7)); // Pazartesi
      const haftaBasiT = gunEkle(t, -((t.getUTCDay() + 6) % 7));
      const haftaFarki = Math.round((haftaBasiT.getTime() - haftaBasiSon.getTime()) / (7 * 86400000));
      if (kume.includes(t.getUTCDay()) && (haftaFarki === 0 || haftaFarki % aralik === 0)) { aday = t; break; }
    }
    if (!aday) {
      // aralık > 1 ve bu hafta bitti → aralık kadar hafta sonraki ilk uygun gün
      const haftaBasi = gunEkle(son, -((son.getUTCDay() + 6) % 7));
      const hedefHafta = gunEkle(haftaBasi, 7 * aralik);
      for (let i = 0; i < 7; i++) { const t = gunEkle(hedefHafta, i); if (kume.includes(t.getUTCDay())) { aday = t; break; } }
    }
  } else if (ayar.type === 'MONTHLY') {
    // önce içinde bulunulan ayda daha ileri bir gün, yoksa aralık kadar ay sonra
    const y = son.getUTCFullYear(); const m = son.getUTCMonth() + 1;
    const buAy = ayIcindeGun(y, m, ayar);
    if (buAy && buAy.getTime() > son.getTime()) aday = buAy;
    else {
      const toplam = m - 1 + aralik;
      const yy = y + Math.floor(toplam / 12); const mm = (toplam % 12) + 1;
      aday = ayIcindeGun(yy, mm, ayar);
    }
  } else if (ayar.type === 'YEARLY') {
    const y = son.getUTCFullYear();
    const ay = Math.min(12, Math.max(1, Number(ayar.yearMonth || son.getUTCMonth() + 1)));
    const gun = Number(ayar.yearDay || son.getUTCDate());
    const buYil = gunYap(y, ay, Math.min(gun, ayinSonGunu(y, ay)));
    if (buYil.getTime() > son.getTime()) aday = buYil;
    else { const yy = y + aralik; aday = gunYap(yy, ay, Math.min(gun, ayinSonGunu(yy, ay))); }
  }
  if (!aday) return null;
  if (ayar.endDate) {
    const bitis = istanbulGunu(new Date(ayar.endDate));
    if (aday.getTime() > bitis.getTime()) return null;
  }
  return aday;
}

/** Bugünden `ufukGun` gün ileriye kadar üretilmesi gereken oluşum günleri (en çok `tavan` adet). */
export function uretilecekGunler(ayar: TekrarAyari | null | undefined, sonTarih: Date, bugun: Date, ufukGun = 14, tavan = 12, uretilenAdet = 0): Date[] {
  const cikti: Date[] = [];
  if (!ayar || ayar.type === 'NONE') return cikti;
  const ufuk = gunEkle(istanbulGunu(bugun), ufukGun);
  let imlec = sonTarih;
  let sayac = uretilenAdet;
  for (let i = 0; i < tavan; i++) {
    if (ayar.count && sayac >= ayar.count) break;
    const sonraki = sonrakiTekrar(ayar, imlec);
    if (!sonraki || sonraki.getTime() > ufuk.getTime()) break;
    cikti.push(sonraki);
    imlec = sonraki;
    sayac++;
  }
  return cikti;
}

/** Tekrar ayarını Türkçe tek satıra çevirir (ekran/rapor). */
export function tekrarMetni(ayar: TekrarAyari | null | undefined): string {
  if (!ayar || ayar.type === 'NONE') return 'Tekrar yok';
  const n = Math.max(1, Number(ayar.interval || 1));
  const GUN = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  const AY = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  if (ayar.type === 'DAILY') return n === 1 ? 'Her gün' : `${n} günde bir`;
  if (ayar.type === 'WEEKLY') {
    const g = (ayar.weekdays || []).map((x) => GUN[((x % 7) + 7) % 7]).join(', ');
    return (n === 1 ? 'Her hafta' : `${n} haftada bir`) + (g ? ` (${g})` : '');
  }
  if (ayar.type === 'MONTHLY') {
    const sira = { FIRST: 'ilk', SECOND: 'ikinci', THIRD: 'üçüncü', FOURTH: 'dördüncü', LAST: 'son' } as const;
    const gun = ayar.monthOrdinal && ayar.monthOrdinalDay !== undefined
      ? `${sira[ayar.monthOrdinal]} ${GUN[((ayar.monthOrdinalDay % 7) + 7) % 7]}`
      : ayar.monthDay === -1 ? 'ayın son günü' : `ayın ${ayar.monthDay || 1}'i`;
    return (n === 1 ? 'Her ay' : `${n} ayda bir`) + ` — ${gun}`;
  }
  if (ayar.type === 'YEARLY') return (n === 1 ? 'Her yıl' : `${n} yılda bir`) + ` — ${ayar.yearDay || 1} ${AY[Math.min(12, Math.max(1, ayar.yearMonth || 1)) - 1]}`;
  return 'Tekrar yok';
}
