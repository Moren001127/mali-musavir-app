/**
 * Dijital Ofis — küçük yardımcılar (selamlama, zaman/kapsam etiketleri, personel tonu).
 * Renk yalnız anlam taşır; ton aileleri bilgi/BEYAZ-TEMA-TASARIM-DILI.md §2 (ofis.css `[data-ton]`).
 */
import type { Rutin, RutinKapsam, RutinZaman } from '@/lib/ekip';

/** Personel → ton ailesi (avatar halkası, çipler). banka-kasa/evrak kadroda yok (2026-09-13/19'da kaldırıldı). */
export const AJAN_TONU: Record<string, string> = {
  koordinator: 'civit',
  fatura: 'mavi',
  beyanname: 'mor',
  'bordro-sgk': 'deniz',
  edefter: 'yesil',
  'luca-operator': 'kursuni',
  denetci: 'kehribar',
  analist: 'gul',
  mevzuat: 'sari',
  risk: 'kirmizi',
  musteri: 'cam',
  siz: 'civit',
};

export function ajanTonu(id: string): string {
  return AJAN_TONU[id] || 'kursuni';
}

/** Saate göre selam: 12'den önce Günaydın, 18'e kadar İyi günler, sonra İyi akşamlar (Europe/Istanbul). */
export function selamlama(simdi = new Date()): string {
  const saat = Number(simdi.toLocaleTimeString('tr-TR', { hour: '2-digit', hour12: false, timeZone: 'Europe/Istanbul' }).slice(0, 2));
  if (saat < 12) return 'Günaydın';
  if (saat < 18) return 'İyi günler';
  return 'İyi akşamlar';
}

/** Rapor metninin ilk cümlesi (emoji/etiket başlığı düşer): "📊 DURUM · 65 aktif mükellef; …" → "65 aktif mükellef; …". */
export function ilkCumle(metin?: string | null, tavan = 140): string {
  const ham = String(metin || '')
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean);
  if (!ham) return '';
  const temiz = ham
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/^(DURUM|RİSKLİ\/ACİL|YAKLAŞAN SÜRELER|EKİP|BUGÜN ÖNCELİK)\s*[·:—-]\s*/i, '')
    .trim();
  const cumle = temiz.split(/(?<=[.!?])\s+/)[0] || temiz;
  return cumle.length > tavan ? `${cumle.slice(0, tavan - 1).trimEnd()}…` : cumle;
}

const GUN_KISA = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

/** Haftanın günleri → "Hafta içi" / "Her gün" / "Pzt, Çar, Cum". */
export function gunlerEtiketi(gunler: number[]): string {
  const s = [...new Set(gunler)].sort((a, b) => a - b);
  if (s.length === 7) return 'Her gün';
  if (s.length === 5 && s.every((g) => g >= 1 && g <= 5)) return 'Hafta içi';
  if (s.length === 2 && s[0] === 6 && s[1] === 7) return 'Hafta sonu';
  return s.map((g) => GUN_KISA[g - 1] || String(g)).join(', ');
}

/** Rutin zamanı → "Hafta içi 09:30–17:00" / "Her ayın 5. günü 09:30". */
export function zamanEtiketi(z: RutinZaman): string {
  if (z.tur === 'aylik') return `Her ayın ${z.ayGunu}. günü ${z.saat}`;
  return `${gunlerEtiketi(z.gunler)} ${z.baslangic}–${z.bitis}`;
}

export const KAPSAM_ETIKETI: Record<RutinKapsam, string> = {
  'kdv:islenmis': 'KDV kontrolü bekleyenler (evrakı işlenmiş)',
  'pano:kontrol_bekleyen': 'Kontrol bekleyenler',
  'pano:isleme_bekleyen': 'İşleme bekleyenler',
  'pano:hazirlik_bekleyen': 'Hazırlık bekleyenler',
  liste: 'Seçili mükellefler',
  ofis: 'Ofis geneli',
};

export function kapsamEtiketi(k: RutinKapsam, taxpayerSayisi?: number): string {
  if (k === 'liste' && taxpayerSayisi) return `${taxpayerSayisi} seçili mükellef`;
  return KAPSAM_ETIKETI[k] || k;
}

/** Rutinin bugün için tek satır özeti: "Bugün planlı: 8 KDV kontrolü · 3 bitti". */
export function rutinBugunOzeti(r: Rutin): string {
  const parcalar = [`Bugün planlı: ${r.bugun.planlanan}`];
  if (r.bugun.biten) parcalar.push(`${r.bugun.biten} bitti`);
  if (r.bugun.hatali) parcalar.push(`${r.bugun.hatali} yarım`);
  return parcalar.join(' · ');
}

/** Mükellef unvanından iki baş harf ("ÖMER ÖZEN" → "ÖÖ"). */
export function basHarfler(unvan: string): string {
  const k = String(unvan || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const s = k.length >= 2 ? `${k[0][0]}${k[1][0]}` : (k[0] || '?').slice(0, 2);
  return s.toLocaleUpperCase('tr-TR');
}

/** ISO/ms → "09:30" (Europe/Istanbul). */
export function saatEtiketi(iso?: string | number | null): string {
  if (iso == null) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
}

/* ─── Alt sayfalardan ana sayfaya görev taslağı devri (oturum deposu; kuru/canlı taşınmaz, taslak hep kuru) ─── */

const TASLAK_ANAHTARI = 'ekip.taslak';

export interface TaslakDevri {
  gorev: string;
  taxpayerId?: string;
  kaynak?: 'pano' | 'tekrar' | 'sablon';
  vakaId?: string;
}

/** Alt sayfa (dönem tablosu / iş geçmişi) görev kutusunu doldurmak istediğinde bırakır; ana sayfa açılınca alır. */
export function taslakBirak(t: TaslakDevri) {
  try {
    if (typeof window !== 'undefined') window.sessionStorage.setItem(TASLAK_ANAHTARI, JSON.stringify(t));
  } catch {
    /* yoksay */
  }
}

/** Ana sayfa: bırakılan taslağı alır ve siler (tek kullanımlık). */
export function taslakAl(): TaslakDevri | null {
  try {
    if (typeof window === 'undefined') return null;
    const ham = window.sessionStorage.getItem(TASLAK_ANAHTARI);
    if (!ham) return null;
    window.sessionStorage.removeItem(TASLAK_ANAHTARI);
    const t = JSON.parse(ham);
    return t && typeof t.gorev === 'string' ? { gorev: t.gorev, taxpayerId: t.taxpayerId || undefined, kaynak: t.kaynak, vakaId: t.vakaId || undefined } : null;
  } catch {
    return null;
  }
}
