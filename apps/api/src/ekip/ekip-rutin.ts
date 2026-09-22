import { istanbulParcalari } from './ekip-kota.service';
import { ogeleriOku } from './ekip-kuyruk';

/**
 * EKİP RUTİNİ — saf yardımcılar (PLAN/20 §D, 2026-09-22). DB/cron `ekip-rutin.service.ts`'te.
 *
 * Rutin = personel + görev kalıbı + kapsam + zaman + günlük tavan. Zamanı gelince kapsamdaki mükellefler kuyruğa girer.
 * Kapsam: pano:kontrol_bekleyen (işleme bitmiş, kontrol bitmemiş) · pano:isleme_bekleyen (evrak gelmiş, işlenmemiş) ·
 * pano:hazirlik_bekleyen (kontrol bitmiş, beyanname hazır değil) · liste (seçili mükellefler) · ofis (mükellefsiz tek iş).
 * Zaman: {tur:'haftalik', gunler:[1..7], baslangic:'09:30', bitis:'17:00'} | {tur:'aylik', ayGunu:5, saat:'09:30', aylar?:[1,4,7,10]} (aylar boşsa her ay).
 */

export const RUTIN_KAPSAMLARI = ['kdv:islenmis', 'pano:kontrol_bekleyen', 'pano:isleme_bekleyen', 'pano:hazirlik_bekleyen', 'ofis', 'liste'] as const;
export type RutinKapsami = (typeof RUTIN_KAPSAMLARI)[number];

export type RutinZamani =
  | { tur: 'haftalik'; gunler: number[]; baslangic: string; bitis: string }
  | { tur: 'aylik'; ayGunu: number; saat: string; aylar?: number[] };

/** "Şimdi çalıştır" tek seferde en çok bu kadar öğe açar (tavana bakılmaz). */
export const SIMDI_CALISTIR_TAVANI = 20;
export const GUNLUK_TAVAN_VARSAYILAN = 8;
export const GUNLUK_TAVAN_EN_COK = 50;

const SAAT_KALIBI = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** 'HH:MM' → dakika (gün başından); geçersiz → null. */
export function saatDakikasi(s: any): number | null {
  const m = String(s || '').trim().match(SAAT_KALIBI);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Ham JSON → doğrulanmış zaman; bozuksa null (hata metni ile). */
export function zamanDogrula(ham: any): { zaman: RutinZamani | null; hata: string | null } {
  if (!ham || typeof ham !== 'object') return { zaman: null, hata: 'zaman zorunlu ({tur:"haftalik"|"aylik", …}).' };
  if (ham.tur === 'haftalik') {
    const gunler = Array.from(new Set((Array.isArray(ham.gunler) ? ham.gunler : []).map((g: any) => Number(g)).filter((g: number) => Number.isInteger(g) && g >= 1 && g <= 7))).sort() as number[];
    if (!gunler.length) return { zaman: null, hata: 'haftalik: gunler 1-7 arası en az bir gün olmalı (1=Pazartesi).' };
    const b = saatDakikasi(ham.baslangic);
    const e = saatDakikasi(ham.bitis);
    if (b === null || e === null) return { zaman: null, hata: 'haftalik: baslangic/bitis "HH:MM" olmalı.' };
    if (e <= b) return { zaman: null, hata: 'haftalik: bitis, baslangic saatinden sonra olmalı.' };
    return { zaman: { tur: 'haftalik', gunler, baslangic: String(ham.baslangic).trim(), bitis: String(ham.bitis).trim() }, hata: null };
  }
  if (ham.tur === 'aylik') {
    const ayGunu = Number(ham.ayGunu);
    if (!Number.isInteger(ayGunu) || ayGunu < 1 || ayGunu > 31) return { zaman: null, hata: 'aylik: ayGunu 1-31 arası olmalı.' };
    if (saatDakikasi(ham.saat) === null) return { zaman: null, hata: 'aylik: saat "HH:MM" olmalı.' };
    // aylar (isteğe bağlı): 1-12 listesi; boş/verilmemiş → her ay. Geçici vergi gibi çeyreklik işler için [1,4,7,10].
    let aylar: number[] | undefined;
    if (ham.aylar !== undefined && ham.aylar !== null) {
      if (!Array.isArray(ham.aylar)) return { zaman: null, hata: 'aylik: aylar 1-12 listesi olmalı.' };
      const temiz = Array.from(new Set<number>(ham.aylar.map((a: any) => Number(a)))).filter((a) => Number.isInteger(a) && a >= 1 && a <= 12).sort((x, y) => x - y);
      if (temiz.length !== ham.aylar.length) return { zaman: null, hata: 'aylik: aylar 1-12 listesi olmalı.' };
      if (temiz.length) aylar = temiz;
    }
    return { zaman: aylar ? { tur: 'aylik', ayGunu, saat: String(ham.saat).trim(), aylar } : { tur: 'aylik', ayGunu, saat: String(ham.saat).trim() }, hata: null };
  }
  return { zaman: null, hata: 'zaman.tur "haftalik" ya da "aylik" olmalı.' };
}

/** Ayın gün sayısı (31 verilmiş ama ay 30 çekiyorsa son gün). */
function ayGunSayisi(yil: number, ay: number): number {
  return new Date(Date.UTC(yil, ay, 0)).getUTCDate();
}

/** Aynı Istanbul günü mü? */
export function ayniIstanbulGunuMu(a: Date | null | undefined, b: Date): boolean {
  if (!a) return false;
  const x = istanbulParcalari(a);
  const y = istanbulParcalari(b);
  return x.yil === y.yil && x.ay === y.ay && x.gun === y.gun;
}

/**
 * Rutin ŞİMDİ koşmalı mı? haftalik: gün listede ∧ saat aralıkta (bitiş dahil). aylik: ayGunu (ay kısa ise son gün) ∧ saat geçmiş ∧
 * bugün henüz koşmamış (sonKosuAt). Haftalık rutin pencerede her tikte "uygun" döner; tekrar açmamayı günlük tavan + bugün-açılan
 * süzgeci sağlar (gün içinde yeni uygun mükellef çıkarsa alınır).
 */
export function zamanUygunMu(zaman: RutinZamani | null | undefined, simdi: Date, sonKosuAt: Date | null | undefined): boolean {
  if (!zaman) return false;
  const p = istanbulParcalari(simdi);
  const dk = p.saat * 60 + p.dakika;
  if (zaman.tur === 'haftalik') {
    if (!Array.isArray(zaman.gunler) || !zaman.gunler.includes(p.haftaGunu)) return false;
    const b = saatDakikasi(zaman.baslangic);
    const e = saatDakikasi(zaman.bitis);
    if (b === null || e === null) return false;
    return dk >= b && dk <= e;
  }
  if (zaman.tur === 'aylik') {
    if (Array.isArray(zaman.aylar) && zaman.aylar.length && !zaman.aylar.includes(p.ay)) return false;
    const hedefGun = Math.min(Number(zaman.ayGunu) || 0, ayGunSayisi(p.yil, p.ay));
    if (p.gun !== hedefGun) return false;
    const s = saatDakikasi(zaman.saat);
    if (s === null || dk < s) return false;
    return !ayniIstanbulGunuMu(sonKosuAt, simdi);
  }
  return false;
}

/** Pano satırı (runner.pano çıktısı `donemler[i].mukellefler[j]`). */
export interface PanoMukellefi {
  taxpayerId: string | null;
  ad: string | null;
  kayitVar?: boolean;
  /** kdvKontrol = Aylık Takip "KDV kontrol edildi" kutusu; kontrol = İND+HES+ARŞİV kutuları (AYNI ŞEY DEĞİL, 2026-09-22). */
  asamalar: { evrak: boolean; isleme: boolean; kontrol: boolean; kdvKontrol?: boolean; beyannameHazir: boolean; beyanname: boolean };
}

export interface PanoDonemi {
  istenenDonem: string;
  beyannameDonem: string | null;
  hata?: string | null;
  mukellefler: PanoMukellefi[];
}

export interface KapsamSonucu {
  /** 'kdv:islenmis': işaretçe işlenmiş görünen ama Luca'sı boş olanlar (rutin almaz, rapora girer). */
  islenmemis?: Array<{ taxpayerId: string | null; ad: string | null }>;
  donem: string | null;
  mukellefler: Array<{ taxpayerId: string | null; ad: string | null }>;
}

/** Pano çıktısındaki EN SON beyanname dönemi satırı (donemler[0]; hatalıysa null). */
export function panoSonDonemi(pano: { donemler?: PanoDonemi[] } | null | undefined): PanoDonemi | null {
  const d = pano?.donemler?.[0];
  return d && !d.hata ? d : null;
}

/**
 * Kapsamdaki mükellefler. pano:* → en son dönem satırlarından aşama süzgeci; liste → verilen id'ler (ad servis tarafında);
 * ofis → mükellefsiz tek öğe. Pano yoksa/hatalıysa pano kapsamları boş döner.
 */
export function kapsamMukellefleri(
  kapsam: string,
  pano: { donemler?: PanoDonemi[] } | null | undefined,
  taxpayerIds: string[] | null | undefined,
  ek?: { kdvHazirIdler?: Set<string> | null },
): KapsamSonucu {
  if (kapsam === 'ofis') return { donem: panoSonDonemi(pano)?.beyannameDonem || null, mukellefler: [{ taxpayerId: null, ad: null }] };
  if (kapsam === 'liste') {
    const idler = Array.from(new Set((Array.isArray(taxpayerIds) ? taxpayerIds : []).map((x) => String(x || '').trim()).filter(Boolean)));
    return { donem: panoSonDonemi(pano)?.beyannameDonem || null, mukellefler: idler.map((id) => ({ taxpayerId: id, ad: null })) };
  }
  const d = panoSonDonemi(pano);
  if (!d) return { donem: null, mukellefler: [] };
  // 'kdv:islenmis' (2026-09-22, Muzaffer Bey'in kararı): "KDV kontrol edildi" işaretsiz AMA evrakı gerçekten Luca'ya
  // işlenmiş olanlar. "İşlendi" kutusuna güvenilmiyor (canlıda 37 işaretliden 11'inin Luca'sı boştu) → hazır kümesi
  // servis tarafında ölçülür: o dönem KDV oturumu var VE Luca kaydı gelmiş. Kalanlar 'islenmemis' olarak raporlanır.
  if (kapsam === 'kdv:islenmis') {
    const hazir = ek?.kdvHazirIdler || null;
    const out: KapsamSonucu['mukellefler'] = [];
    const islenmemis: KapsamSonucu['mukellefler'] = [];
    const gorulenK = new Set<string>();
    for (const m of d.mukellefler || []) {
      if (!m?.taxpayerId || gorulenK.has(m.taxpayerId)) continue;
      if (m.asamalar?.kdvKontrol) continue; // kontrolü bitmiş
      gorulenK.add(m.taxpayerId);
      if (hazir?.has(m.taxpayerId)) out.push({ taxpayerId: m.taxpayerId, ad: m.ad || null });
      else if (m.asamalar?.isleme) islenmemis.push({ taxpayerId: m.taxpayerId, ad: m.ad || null });
    }
    return { donem: d.beyannameDonem || null, mukellefler: out, islenmemis };
  }
  const suzgec: ((m: PanoMukellefi) => boolean) | null =
    kapsam === 'pano:kontrol_bekleyen'
      ? (m) => Boolean(m.asamalar?.isleme) && !m.asamalar?.kontrol
      : kapsam === 'pano:isleme_bekleyen'
        ? (m) => Boolean(m.asamalar?.evrak) && !m.asamalar?.isleme
        : kapsam === 'pano:hazirlik_bekleyen'
          ? (m) => Boolean(m.asamalar?.kontrol) && !m.asamalar?.beyannameHazir
          : null;
  if (!suzgec) return { donem: d.beyannameDonem || null, mukellefler: [] };
  const gorulen = new Set<string>();
  const out: KapsamSonucu['mukellefler'] = [];
  for (const m of d.mukellefler || []) {
    if (!m?.taxpayerId || gorulen.has(m.taxpayerId)) continue;
    if (!suzgec(m)) continue;
    gorulen.add(m.taxpayerId);
    out.push({ taxpayerId: m.taxpayerId, ad: m.ad || null });
  }
  return { donem: d.beyannameDonem || null, mukellefler: out };
}

export interface BugunAcilan {
  /** Bugün bu rutinden açılmış öğe sayısı (durum fark etmez) */
  sayi: number;
  /** Bugün açılmış öğelerin mükellefleri (mükellefsiz öğe: '' anahtarı) */
  taxpayerIdler: Set<string>;
  biten: number;
  hatali: number;
}

/** Bugünkü (rutinId'ye ait) kuyruklardan açılan öğeler — tavan ve tekrar-açmama süzgeci. */
export function bugunAcilanlar(kuyruklar: Array<{ ogeler: any }>): BugunAcilan {
  const out: BugunAcilan = { sayi: 0, taxpayerIdler: new Set<string>(), biten: 0, hatali: 0 };
  for (const k of kuyruklar) {
    for (const o of ogeleriOku(k.ogeler)) {
      out.sayi++;
      out.taxpayerIdler.add(o.taxpayerId || '');
      if (o.durum === 'bitti') out.biten++;
      else if (o.durum === 'hata' || o.durum === 'atlandi') out.hatali++;
    }
  }
  return out;
}

/**
 * Bu koşuda kuyruğa girecek öğeler: bugün zaten açılmış mükellefler elenir, `tavan` kadar alınır.
 * tavan ≤ 0 → boş (günlük tavan doldu).
 */
export function secilecekOgeler(
  adaylar: Array<{ taxpayerId: string | null; ad: string | null }>,
  acilan: BugunAcilan,
  tavan: number,
): Array<{ taxpayerId: string | null; ad: string | null }> {
  if (tavan <= 0) return [];
  return adaylar.filter((a) => !acilan.taxpayerIdler.has(a.taxpayerId || '')).slice(0, tavan);
}
