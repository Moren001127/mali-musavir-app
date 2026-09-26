/**
 * SGK WS_Vizite kayıtlarını portal satırlarına çeviren SAF fonksiyonlar (veritabanı / ağ yok; test edilir).
 *
 * Canlı veriyle doğrulanan kurallar (2026-09-26, TAHİR SUCU / GİTO GIDA):
 *  - Onay bekleyen raporda başlangıç = en erken (yatarak başlangıç, ayakta başlangıç, doğum öncesi başlangıç);
 *    bitiş = en geç (ayakta bitiş, yatarak bitiş). Gün = başlangıç..bitiş dahil
 *    (Funda İlknur Sucu 27.04–02.09 = 129 gün — Hattat ile aynı).
 *  - Onaylı listede başlangıç/bitiş yok: bitiş = işbaşı/kontrol tarihinin bir önceki günü kabul edilir.
 *  - Parçalı rapor: onaylanan son gün < rapor bitişi → kalan kısım onay bekliyor
 *    (Faruk Ahak: 05.08–31.08 onaylı, işbaşı 04.10 → kalan 01.09–03.10).
 */
import { SGK_RAPOR_DURUMLARI, SGK_VAKA_ADLARI, isKazasiBildirimSonGunu, resmiTatilMi } from '@mali-musavir/shared';
import { sgkTarih } from './sgk-vizite-istemci';

export interface RaporKaydi {
  medulaRaporId: string;
  tcKimlikNo: string;
  adSoyad: string;
  vaka: string | null;
  vakaAdi: string | null;
  raporTakipNo: string | null;
  raporSiraNo: string | null;
  poliklinikTarihi: string | null;
  raporBaslangic: string | null;
  raporBitis: string | null;
  isbasiKontrolTarihi: string | null;
  isKazasiTarihi: string | null;
  raporDurumuKodu: string | null;
  raw: Record<string, string>;
}

export interface OnayParcasiKaydi {
  baslangic: string;
  bitis: string;
  calisti: boolean;
  islemTarihi: string | null;
  odemeCikti: boolean | null;
  bildirimId: string | null;
}

export interface IsKazasiKaydi {
  bildirimId: string;
  tcKimlikNo: string;
  cinsiyet: string | null;
  isKazasiTarihi: string | null;
  provizyonTarihi: string | null;
  provizyonTipi: string | null;
  tesisAdi: string | null;
  unvani: string | null;
  islemTuru: string | null;
  sgkBildirimSonGun: string | null;
  raw: Record<string, string>;
}

const bosIse = (v: string | null | undefined): string | null => {
  const s = String(v ?? '').trim();
  return s ? s : null;
};

export function isoGunEkle(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10));
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** İstanbul takvim günü "YYYY-AA-GG". */
export function bugunIso(simdi: Date = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(simdi);
  return p; // en-CA → 2026-09-26
}

function enKucuk(liste: Array<string | null>): string | null {
  const v = liste.filter((x): x is string => !!x).sort();
  return v.length ? v[0] : null;
}

function enBuyuk(liste: Array<string | null>): string | null {
  const v = liste.filter((x): x is string => !!x).sort();
  return v.length ? v[v.length - 1] : null;
}

/** Başlangıç..bitiş dahil gün sayısı; biri yoksa null. */
export function gunSayisi(bas: string | null, bit: string | null): number | null {
  if (!bas || !bit || bit < bas) return null;
  const a = Date.UTC(+bas.slice(0, 4), +bas.slice(5, 7) - 1, +bas.slice(8, 10));
  const b = Date.UTC(+bit.slice(0, 4), +bit.slice(5, 7) - 1, +bit.slice(8, 10));
  return Math.round((b - a) / 86_400_000) + 1;
}

function adSoyad(a: Record<string, string>): string {
  return [a.AD, a.SOYAD].map((x) => String(x || '').trim()).filter(Boolean).join(' ') || String(a.SIGORTALIADSOYAD || '').trim();
}

export function vakaAdi(vaka: string | null, sgkAdi?: string | null): string | null {
  if (vaka && SGK_VAKA_ADLARI[vaka]) return SGK_VAKA_ADLARI[vaka];
  const s = String(sgkAdi || '').trim();
  return s ? s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1).toLocaleLowerCase('tr-TR') : null;
}

export function raporDurumuAdi(kod: string | null): string | null {
  if (!kod) return null;
  return SGK_RAPOR_DURUMLARI[kod] || `Durum ${kod}`;
}

/** raporAramaTarihile → RaporAramaTarihleBean */
export function bekleyenRaporCoz(a: Record<string, string>): RaporKaydi | null {
  const id = bosIse(a.MEDULARAPORID);
  const tc = bosIse(a.TCKIMLIKNO);
  if (!id || !tc) return null;
  const poliklinik = sgkTarih(a.POLIKLINIKTAR);
  const baslangic = enKucuk([sgkTarih(a.YATRAPBASTAR), sgkTarih(a.ABASTAR), sgkTarih(a.DOGUMONCBASTAR)]) ?? poliklinik;
  const bitis = enBuyuk([sgkTarih(a.ABITTAR), sgkTarih(a.YATRAPBITTAR), sgkTarih(a.RAPORBITTAR)]);
  const vaka = bosIse(a.VAKA);
  return {
    medulaRaporId: id,
    tcKimlikNo: tc,
    adSoyad: adSoyad(a),
    vaka,
    vakaAdi: vakaAdi(vaka, a.VAKAADI),
    raporTakipNo: bosIse(a.RAPORTAKIPNO),
    raporSiraNo: bosIse(a.RAPORSIRANO),
    poliklinikTarihi: poliklinik,
    raporBaslangic: baslangic,
    raporBitis: bitis,
    isbasiKontrolTarihi: sgkTarih(a.ISBASKONTTAR),
    isKazasiTarihi: sgkTarih(a.ISKAZASITARIHI),
    raporDurumuKodu: bosIse(a.RAPORDURUMU),
    raw: a,
  };
}

/** onayliRaporlarTarihile → OnayliRaporlarTarihleBean (başlangıç/bitiş yok → poliklinik / işbaşı−1). */
export function onayliRaporCoz(a: Record<string, string>): RaporKaydi | null {
  const id = bosIse(a.MEDULARAPORID);
  const tc = bosIse(a.TCKIMLIKNO);
  if (!id || !tc) return null;
  const poliklinik = sgkTarih(a.POLIKLINIKTAR);
  const isbasi = sgkTarih(a.ISBASKONTTAR);
  const vaka = bosIse(a.VAKA);
  return {
    medulaRaporId: id,
    tcKimlikNo: tc,
    adSoyad: adSoyad(a),
    vaka,
    vakaAdi: vakaAdi(vaka, a.VAKAADI),
    raporTakipNo: bosIse(a.RAPORTAKIPNO),
    raporSiraNo: bosIse(a.RAPORSIRANO),
    poliklinikTarihi: poliklinik,
    raporBaslangic: poliklinik,
    raporBitis: isbasi ? isoGunEkle(isbasi, -1) : null,
    isbasiKontrolTarihi: isbasi,
    isKazasiTarihi: sgkTarih(a.ISKAZASITARIHI),
    raporDurumuKodu: null,
    raw: a,
  };
}

/** onayliRaporlarDetay → OnayliRaporDetayBean */
export function onayParcasiCoz(a: Record<string, string>): OnayParcasiKaydi | null {
  const bas = sgkTarih(a.BASTAR);
  const bit = sgkTarih(a.BITTAR);
  if (!bas || !bit) return null;
  const odeme = String(a.ODEMECIKTIMI ?? '').trim();
  return {
    baslangic: bas,
    bitis: bit,
    calisti: String(a.CALISTI_CALISMADI ?? '').trim() === '1',
    islemTarihi: sgkTarih(a.ISLEM_TARIHI),
    odemeCikti: odeme === '1' ? true : odeme === '0' ? false : null,
    bildirimId: bosIse(a.BILDIRIM_ID),
  };
}

/** Onaylanan son günün ertesi (parça yoksa null). */
export function sonOnayliGun(parcalar: OnayParcasiKaydi[]): string | null {
  return enBuyuk(parcalar.map((p) => p.bitis));
}

/**
 * Parçalı mı: onaylanan son gün, rapor bitişinden (yoksa işbaşı−1) önceyse kalan aralık döner.
 * Hiç parça yoksa null (karar verilemez).
 */
export function kalanAralik(
  rapor: { raporBitis: string | null; isbasiKontrolTarihi: string | null },
  parcalar: OnayParcasiKaydi[],
): { kalanBaslangic: string; kalanBitis: string } | null {
  const son = sonOnayliGun(parcalar);
  if (!son) return null;
  const hedef = rapor.raporBitis ?? (rapor.isbasiKontrolTarihi ? isoGunEkle(rapor.isbasiKontrolTarihi, -1) : null);
  if (!hedef || son >= hedef) return null;
  return { kalanBaslangic: isoGunEkle(son, 1), kalanBitis: hedef };
}

/** Onay penceresi başlangıcı: son onaylı günün ertesi, yoksa rapor başlangıcı. */
export function onayBaslangici(rapor: { raporBaslangic: string | null; poliklinikTarihi: string | null }, parcalar: OnayParcasiKaydi[]): string | null {
  const son = sonOnayliGun(parcalar);
  if (son) return isoGunEkle(son, 1);
  return rapor.raporBaslangic ?? rapor.poliklinikTarihi;
}

/** Onay bitişi en geç: min(rapor bitişi | işbaşı−1, bugün). */
export function onayEnGecBitisi(rapor: { raporBitis: string | null; isbasiKontrolTarihi: string | null }, bugun: string): string | null {
  const bitis = rapor.raporBitis ?? (rapor.isbasiKontrolTarihi ? isoGunEkle(rapor.isbasiKontrolTarihi, -1) : null);
  if (!bitis) return bugun;
  return bitis < bugun ? bitis : bugun;
}

/** hasIsKazSorguTarihle → HastaneBildirimiIsKazasiBean | IsKazasiHastaneBilgiBean */
export function isKazasiCoz(a: Record<string, string>): IsKazasiKaydi | null {
  const id = bosIse(a.BILDIRIMID);
  const tc = bosIse(a.TCKIMLIKNO);
  if (!id || !tc) return null;
  const kaza = sgkTarih(a.ISKAZASITARIHI);
  return {
    bildirimId: id,
    tcKimlikNo: tc,
    cinsiyet: bosIse(a.CINSIYET),
    isKazasiTarihi: kaza,
    provizyonTarihi: sgkTarih(a.PROVIZYONTARIHI),
    provizyonTipi: bosIse(a.PROVIZYONTIPI),
    tesisAdi: bosIse(a.TESISADI),
    unvani: bosIse(a.UNVANI),
    islemTuru: bosIse(a.ISLEMTUR),
    sgkBildirimSonGun: isKazasiBildirimSonGunu(kaza, resmiTatilMi),
    raw: a,
  };
}
