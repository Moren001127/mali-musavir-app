import { KOTA_KALIBI } from './ekip-kota.service';

/**
 * EKİP KUYRUĞU — saf yardımcılar (PLAN/20 §D, 2026-09-22). DB/zamanlayıcı `ekip-kuyruk.service.ts`'te.
 *
 * Kuyruk = bir personel + bir görev kalıbı + mükellef listesi; öğeler sırayla runner.calistir ile koşar.
 * Durumlar: kuyruk `bekliyor → suruyor → bitti`, araya `durduruldu` (Muzaffer Bey) ya da `kota_bekliyor` (Max kotası) girer.
 * Öğe: `bekliyor | suruyor | bitti | hata | atlandi` (atlandi = mükellef kiracıda bulunamadı).
 */

export type KuyrukDurumu = 'bekliyor' | 'suruyor' | 'durduruldu' | 'bitti' | 'kota_bekliyor';
export type KuyrukKaynagi = 'rutin' | 'toplu';
export type OgeDurumu = 'bekliyor' | 'suruyor' | 'bitti' | 'hata' | 'atlandi';

export const KUYRUK_DURUMLARI: KuyrukDurumu[] = ['bekliyor', 'suruyor', 'durduruldu', 'bitti', 'kota_bekliyor'];
/** İşleyicinin ele aldığı (bitmemiş, durdurulmamış) kuyruk durumları. */
export const AKTIF_KUYRUK_DURUMLARI: KuyrukDurumu[] = ['bekliyor', 'suruyor', 'kota_bekliyor'];
/** Ekranda "aktif" sayılanlar (durdurulmuş da listede kalır; Devam düğmesi için). */
export const LISTE_AKTIF_DURUMLARI: KuyrukDurumu[] = ['bekliyor', 'suruyor', 'kota_bekliyor', 'durduruldu'];

export interface KuyrukOgesi {
  taxpayerId: string | null;
  ad: string | null;
  donem?: string | null;
  durum: OgeDurumu;
  isId?: string | null;
  hata?: string | null;
  bitisAt?: string | null;
}

/** DB satırı (Prisma EkipKuyruk) — servis `as any` okur; burada yalnız kullanılan alanlar. */
export interface KuyrukSatiri {
  id: string;
  tenantId: string;
  ad: string;
  ajanId: string;
  sablon: string;
  dryRun: boolean;
  kaynak: string;
  rutinId: string | null;
  durum: string;
  ogeler: any;
  aktifIsId: string | null;
  olusturan: string | null;
  createdAt: Date;
  updatedAt: Date;
  bitisAt: Date | null;
}

/** Json alanını güvenli öğe dizisine çevirir (bozuk kayıt → boş dizi). */
export function ogeleriOku(ham: any): KuyrukOgesi[] {
  if (!Array.isArray(ham)) return [];
  const out: KuyrukOgesi[] = [];
  for (const o of ham) {
    if (!o || typeof o !== 'object') continue;
    const durum = (['bekliyor', 'suruyor', 'bitti', 'hata', 'atlandi'] as OgeDurumu[]).includes(o.durum) ? (o.durum as OgeDurumu) : 'bekliyor';
    out.push({
      taxpayerId: typeof o.taxpayerId === 'string' && o.taxpayerId ? o.taxpayerId : null,
      ad: typeof o.ad === 'string' && o.ad ? o.ad : null,
      donem: typeof o.donem === 'string' && o.donem ? o.donem : null,
      durum,
      isId: typeof o.isId === 'string' && o.isId ? o.isId : null,
      hata: typeof o.hata === 'string' && o.hata ? o.hata : null,
      bitisAt: typeof o.bitisAt === 'string' && o.bitisAt ? o.bitisAt : null,
    });
  }
  return out;
}

/**
 * Görev kalıbındaki yer tutucular: {mukellef} → mükellef adı, {donem} → dönem. Ad yoksa (ofis işi) yer tutucu silinir,
 * çift boşluklar tekleşir. Bilinmeyen yer tutucular olduğu gibi kalır (ajan görür, sorar).
 */
export function sablonDoldur(sablon: string, degerler: { mukellef?: string | null; donem?: string | null }): string {
  return String(sablon || '')
    .replace(/\{\s*mukellef\s*\}/gi, degerler.mukellef || '')
    .replace(/\{\s*donem\s*\}/gi, degerler.donem || '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Kalıp {donem} istiyor mu (pano dönemi yalnız gerektiğinde hesaplanır). */
export function sablonDonemIstiyorMu(sablon: string): boolean {
  return /\{\s*donem\s*\}/i.test(String(sablon || ''));
}

/** Koşu hatası Max kotası mı? (ekip-kota KOTA_KALIBI ile aynı kalıp) */
export function kotaHatasiMi(hata: string | null | undefined): boolean {
  return Boolean(hata) && KOTA_KALIBI.test(String(hata));
}

/** Sıradaki bekleyen öğenin dizini; yoksa -1. */
export function siradakiOgeDizini(ogeler: KuyrukOgesi[]): number {
  return ogeler.findIndex((o) => o.durum === 'bekliyor');
}

export interface KuyrukOzeti {
  id: string;
  ad: string;
  ajanId: string;
  sablon: string;
  dryRun: boolean;
  kaynak: string;
  rutinId: string | null;
  durum: KuyrukDurumu;
  toplam: number;
  biten: number;
  hatali: number;
  bekleyen: number;
  atlanan: number;
  /** Şu an koşan öğe (kuyruk suruyor iken). */
  suruyor: { taxpayerId: string | null; ad: string | null; isId: string | null } | null;
  /** Sıradaki bekleyen öğe. */
  siradaki: { taxpayerId: string | null; ad: string | null } | null;
  aktifIsId: string | null;
  olusturan: string | null;
  ogeler: KuyrukOgesi[];
  createdAt: Date;
  updatedAt: Date;
  bitisAt: Date | null;
}

/** DB satırı → ekran özeti (sayaçlar + sıradaki). */
export function kuyrukOzeti(r: KuyrukSatiri): KuyrukOzeti {
  const ogeler = ogeleriOku(r.ogeler);
  const say = (d: OgeDurumu) => ogeler.filter((o) => o.durum === d).length;
  const suruyorOge = ogeler.find((o) => o.durum === 'suruyor') || null;
  const siradakiOge = ogeler.find((o) => o.durum === 'bekliyor') || null;
  const durum = (KUYRUK_DURUMLARI as string[]).includes(r.durum) ? (r.durum as KuyrukDurumu) : 'bekliyor';
  return {
    id: r.id,
    ad: r.ad,
    ajanId: r.ajanId,
    sablon: r.sablon,
    dryRun: r.dryRun !== false,
    kaynak: r.kaynak,
    rutinId: r.rutinId || null,
    durum,
    toplam: ogeler.length,
    biten: say('bitti'),
    hatali: say('hata'),
    bekleyen: say('bekliyor') + say('suruyor'),
    atlanan: say('atlandi'),
    suruyor: suruyorOge ? { taxpayerId: suruyorOge.taxpayerId, ad: suruyorOge.ad, isId: suruyorOge.isId || null } : null,
    siradaki: siradakiOge ? { taxpayerId: siradakiOge.taxpayerId, ad: siradakiOge.ad } : null,
    aktifIsId: r.aktifIsId || null,
    olusturan: r.olusturan || null,
    ogeler,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    bitisAt: r.bitisAt || null,
  };
}

export interface BugunPlani {
  planlanan: number;
  suruyor: number;
  biten: number;
  yarim: number;
  bekleyen: number;
}

/** Bugünkü kuyrukların öğe sayaçları — /ekip/durum `bugunPlan`. yarim = hata + atlandı. */
export function bugunPlani(kuyruklar: Array<{ ogeler: any }>): BugunPlani {
  const p: BugunPlani = { planlanan: 0, suruyor: 0, biten: 0, yarim: 0, bekleyen: 0 };
  for (const k of kuyruklar) {
    for (const o of ogeleriOku(k.ogeler)) {
      p.planlanan++;
      if (o.durum === 'suruyor') p.suruyor++;
      else if (o.durum === 'bitti') p.biten++;
      else if (o.durum === 'hata' || o.durum === 'atlandi') p.yarim++;
      else p.bekleyen++;
    }
  }
  return p;
}

/** Istanbul gününün başlangıcı (UTC Date) — runner.gunBasiIstanbul ile aynı kural; `simdi` testte verilir. */
export function gunBasiIstanbul(simdi: Date = new Date()): Date {
  const y = new Date(simdi.getTime() + 3 * 60 * 60 * 1000);
  return new Date(Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate()) - 3 * 60 * 60 * 1000);
}

/**
 * Tenant'ın adaylarından hangi kuyruk işlenir: önce 'suruyor' (yarım kalan), sonra en eski 'bekliyor'/'kota_bekliyor'.
 * Kiracı başına tek kuyruk sürer (tek koşu kilidi).
 */
export function tenantKuyruguSec(adaylar: KuyrukSatiri[]): KuyrukSatiri | null {
  const sirali = [...adaylar].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return sirali.find((k) => k.durum === 'suruyor') || sirali.find((k) => k.durum === 'bekliyor' || k.durum === 'kota_bekliyor') || null;
}
