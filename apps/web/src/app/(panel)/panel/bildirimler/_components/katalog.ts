// Bildirimler — tür kataloğu ve yardımcılar (TEK KAYNAK; sayfa ve tercih paneli buradan okur).
//   Ham tür kodu (BUTCE_KRITIK, GALERI_HGS_OZET…) ekranda GÖRÜNMEZ; her türün Türkçe adı, rengi, ikonu, açıklaması burada.
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle, AlertTriangle, Banknote, Bell, Bot, CalendarClock, CheckCircle2, FileText, HandCoins, Inbox, Key,
  Lightbulb, Mail, MessageCircle, Receipt, ShieldAlert, Sparkles, Upload, Zap,
} from 'lucide-react';

// Renkler — portal dili (e-Defter teması ile aynı sakin ton; tek renge boğma yok).
export const ALTIN = '#d4b876';
export const KIRMIZI = '#e2706f';
export const TURUNCU = '#d4a85f';
export const MAVI = '#7fa6dd';
export const YESIL = '#5cbf8a';
export const GRI = '#94a3b8';
export const METIN = '#fafaf9';
export const IKINCIL = 'rgba(250,250,249,.55)';
export const SONUK = 'rgba(250,250,249,.38)';
export const KENAR = 'rgba(255,255,255,0.07)';
export const KENAR_KOYU = 'rgba(255,255,255,0.12)';
export const ZEMIN = 'rgba(255,255,255,0.025)';
export const ZEMIN_HOVER = 'rgba(255,255,255,0.045)';

export type Bildirim = {
  id: string;
  title: string;
  body: string;
  type: string;
  isRead: boolean;
  readAt?: string | null;
  createdAt: string;
  metadata?: Record<string, any> | null;
};

/** Beyaz tema ton ailesi (bilgi/BEYAZ-TEMA-TASARIM-DILI.md): otomasyon/ajan çivit · bilgi mavi · WhatsApp yeşil ·
 *  görev/bekleyen kehribar · kritik/bütçe(kritik) kırmızı · AI mor · sistem kurşuni · ofis sohbeti/bütçe deniz yeşili. */
export type Ton = 'civit' | 'mavi' | 'deniz' | 'yesil' | 'kehribar' | 'kirmizi' | 'mor' | 'kursuni';

export type TurTanimi = {
  ad: string;
  /** Koyu tema (A) rengi. */
  renk: string;
  /** Beyaz tema (D) ton ailesi; renkler bildirimler-white.css'te. */
  ton: Ton;
  Ikon: LucideIcon;
  /** Kritik türler "Kritik" sekmesinde ve kırmızı şeritle gösterilir (sunucudaki CRITICAL_TYPES ile aynı liste). */
  kritik?: boolean;
  /** Tercihler panelinde tek satır açıklama. */
  aciklama: string;
  /** Tercihlerde kapatılamaz (güvenlik / zorunlu). */
  kapatilamaz?: boolean;
};

export const TUR: Record<string, TurTanimi> = {
  E_TEBLIGAT: { ad: 'e-Tebligat', renk: KIRMIZI, ton: 'kirmizi', Ikon: Mail, kritik: true, aciklama: 'Mükellefe yeni e-Tebligat geldiğinde', kapatilamaz: true },
  TAX_DEADLINE: { ad: 'Beyanname son gün', renk: KIRMIZI, ton: 'kirmizi', Ikon: CalendarClock, kritik: true, aciklama: 'Onaylanmamış beyanname varken son 7 gün', kapatilamaz: true },
  PORTAL_CREDENTIAL_FAIL: { ad: 'Portal şifre hatası', renk: KIRMIZI, ton: 'kirmizi', Ikon: Key, kritik: true, aciklama: 'GİB/SGK girişinde şifre hatası (şifre güncellenene kadar 1 kez)' },
  CAPTCHA_SOLVER_ERROR: { ad: 'Güvenlik kodu servisi', renk: KIRMIZI, ton: 'kirmizi', Ikon: ShieldAlert, kritik: true, aciklama: 'Güvenlik kodu çözücü bakiyesi bitince otomasyonlar durur' },
  AUTH_NEW_DEVICE: { ad: 'Yeni cihaz girişi', renk: KIRMIZI, ton: 'kirmizi', Ikon: ShieldAlert, kritik: true, aciklama: 'Hesabınıza yeni bir adresten giriş yapıldığında', kapatilamaz: true },
  AI_COST_LIMIT: { ad: 'AI maliyet tavanı', renk: KIRMIZI, ton: 'kirmizi', Ikon: HandCoins, kritik: true, aciklama: 'Günlük AI harcaması sınırı aşınca' },
  LUCA_SYNC_ERROR: { ad: 'Luca aktarımı', renk: TURUNCU, ton: 'kehribar', Ikon: AlertTriangle, kritik: true, aciklama: 'Luca veri çekme işi hata verince ya da sırada beklerken' },
  PENDING_DECISION: { ad: 'Onay bekleyen karar', renk: TURUNCU, ton: 'kehribar', Ikon: AlertTriangle, aciklama: 'Fatura/işletme kaydında karar sizden bekleniyor' },
  TASK_DUE: { ad: 'Görev hatırlatması', renk: TURUNCU, ton: 'kehribar', Ikon: CheckCircle2, aciklama: 'Görevin vadesi yaklaşınca ya da geçince' },
  INVOICE_OVERDUE: { ad: 'Bekleyen alış faturaları', renk: TURUNCU, ton: 'kehribar', Ikon: Receipt, aciklama: '60+ gündür muhasebeleşmemiş alış faturası özeti (haftalık)' },
  WHATSAPP: { ad: 'WhatsApp', renk: '#27d39a', ton: 'yesil', Ikon: MessageCircle, aciklama: 'Kayıtsız numara ya da müşavir yanıtı bekleyen mesaj' },
  OFFICE_CHAT: { ad: 'Ofis sohbeti', renk: '#8fd7bd', ton: 'deniz', Ikon: Inbox, aciklama: 'Ofis içi mesaj' },
  BANK_TRANSACTION_ALERT: { ad: 'Banka ekstresi', renk: MAVI, ton: 'mavi', Ikon: Banknote, aciklama: 'Mükellefin banka ekstresi geldiğinde' },
  DOCUMENT_UPLOADED: { ad: 'Yeni evrak', renk: MAVI, ton: 'mavi', Ikon: Upload, aciklama: 'Mükellef portala evrak yüklediğinde' },
  KDV_RESULT: { ad: 'KDV kontrol sonucu', renk: MAVI, ton: 'mavi', Ikon: Receipt, aciklama: 'KDV kontrolünde inceleme/hata çıkan kayıt varsa' },
  MIHSAP_RESULT: { ad: 'Mihsap aktarımı', renk: MAVI, ton: 'mavi', Ikon: FileText, aciklama: 'Mihsap fatura aktarımı hata verince' },
  AUTOMATION: { ad: 'Otomasyon', renk: MAVI, ton: 'civit', Ikon: Zap, aciklama: 'Otomasyon başarısız olunca ya da rapor hazır olunca' },
  AGENT: { ad: 'Ajan', renk: MAVI, ton: 'civit', Ikon: Bot, aciklama: 'Ajan taramaları' },
  AI: { ad: 'Moren AI', renk: ALTIN, ton: 'mor', Ikon: Sparkles, aciklama: 'Bot kalite raporu ve AI bilgilendirmeleri' },
  MOREN_AI_ALERT: { ad: 'Moren AI uyarısı', renk: ALTIN, ton: 'mor', Ikon: Sparkles, aciklama: 'Belge içerik denetiminde risk bulununca' },
  AI_PROPOSAL: { ad: 'AI önerisi', renk: ALTIN, ton: 'mor', Ikon: Lightbulb, aciklama: 'DENİZ tarama önerileri' },
  SYSTEM: { ad: 'Sistem', renk: GRI, ton: 'kursuni', Ikon: AlertCircle, aciklama: 'Ajan/oturum/kuyruk arızaları ve gece işi özetleri' },
  BUTCE: { ad: 'Bütçe', renk: YESIL, ton: 'deniz', Ikon: HandCoins, aciklama: 'Kişisel bütçe hatırlatmaları' },
  BUTCE_KRITIK: { ad: 'Bütçe (kritik)', renk: KIRMIZI, ton: 'kirmizi', Ikon: HandCoins, aciklama: 'Kart limiti, gecikmiş ödeme, nakit açığı' },
  GALERI_HGS_OZET: { ad: 'HGS sorgu özeti', renk: MAVI, ton: 'mavi', Ikon: Receipt, aciklama: 'Galeri HGS ihlal sorgusu sonucu' },
};

// Eski kayıtlarda görülen takma adlar → asıl tür
const TAKMA: Record<string, string> = { WhatsApp: 'WHATSAPP', MOREN_AI: 'AI', 'Moren AI': 'AI' };
export function turKodu(t: string): string { return TAKMA[t] || t; }
export function tur(t: string): TurTanimi {
  return TUR[turKodu(t)] || { ad: t, renk: GRI, ton: 'kursuni', Ikon: Bell, aciklama: '' };
}

/** "Luca işi bekliyor / bayat iş iptal" durum bildirimleri kritik sayılmaz (gerçek aktarım hatası kritik). */
export function kritikMi(n: Bildirim): boolean {
  const t = tur(n.type);
  if (!t.kritik) return false;
  const kind = String(n.metadata?.kind || '');
  if (turKodu(n.type) === 'LUCA_SYNC_ERROR' && (kind === 'stale-pending' || kind === 'stale-cancelled')) return false;
  return true;
}

/** Gövdedeki WhatsApp biçimlendirmesini (*kalın*, _italik_) ve fazla boşluğu temizle — ekranda düz metin. */
export function temizGovde(s: string): string {
  return String(s || '')
    .replace(/\*([^*\n]{1,200})\*/g, '$1')
    .replace(/(^|\s)_([^_\n]{1,200})_(?=\s|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Başlıktaki emoji/sembol önekini at (ikon zaten türü söylüyor): "🔑 Portal şifre hatası: X" → "Portal şifre hatası: X". */
export function temizBaslik(s: string): string {
  return String(s || '').replace(/^[^\p{L}\p{N}"«(]+/u, '').trim();
}

// Sunucudaki varsayılan bağlantılardan bugün portalda karşılığı olmayanlar (404) → doğru sayfa
const ESKI_BAGLANTI: Record<string, string> = {
  '/panel/luca': '/panel/ajanlar/luca',
  '/panel/onay-bekleyen': '/panel/onay-kuyrugu',
};
export function bildirimBaglantisi(n: Bildirim): string {
  const m = n.metadata || {};
  if (typeof m.link === 'string' && m.link) return ESKI_BAGLANTI[m.link] || m.link;
  switch (turKodu(n.type)) {
    case 'WHATSAPP': return m.taxpayerId ? `/panel/mesajlar?conversation=${encodeURIComponent(String(m.taxpayerId))}` : '/panel/mesajlar';
    case 'OFFICE_CHAT': return '/panel?officeChat=open';
    case 'TASK_DUE': return '/panel/gorevler';
    case 'TAX_DEADLINE': case 'E_TEBLIGAT': return '/panel/beyannameler';
    case 'AGENT': return '/panel/ajanlar';
    case 'AI': case 'MOREN_AI_ALERT': case 'AI_PROPOSAL': case 'AI_COST_LIMIT': return '/panel/moren-ai';
    case 'PORTAL_CREDENTIAL_FAIL': return '/panel/ayarlar/entegrasyonlar';
    case 'LUCA_SYNC_ERROR': return '/panel/ajanlar/luca';
    case 'KDV_RESULT': return m.sessionId ? `/panel/kdv-kontrol/${encodeURIComponent(String(m.sessionId))}` : '/panel/kdv-kontrol';
    case 'DOCUMENT_UPLOADED': return '/panel/evraklar';
    case 'PENDING_DECISION': return '/panel/onay-kuyrugu';
    case 'BANK_TRANSACTION_ALERT': return '/panel/banka-takip';
    case 'INVOICE_OVERDUE': return '/panel/faturalar';
    case 'MIHSAP_RESULT': return '/panel/ajanlar/mihsap';
    case 'AUTH_NEW_DEVICE': return '/panel/ayarlar';
    case 'BUTCE': case 'BUTCE_KRITIK': return '/panel/butce';
    case 'GALERI_HGS_OZET': return '/panel/galeri/hgs-ihlal';
    default: return '';
  }
}

// ---- Zaman yardımcıları (Europe/Istanbul) ----
const TZ = 'Europe/Istanbul';
function gunAnahtari(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); // YYYY-MM-DD
}
function gunFarki(iso: string, simdi = new Date()): number {
  const a = gunAnahtari(new Date(iso)); const b = gunAnahtari(simdi);
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

export type GunGrubu = 'Bugün' | 'Dün' | 'Bu hafta' | 'Daha eski';
export function gunGrubu(iso: string, simdi = new Date()): GunGrubu {
  const f = gunFarki(iso, simdi);
  if (f <= 0) return 'Bugün';
  if (f === 1) return 'Dün';
  if (f < 7) return 'Bu hafta';
  return 'Daha eski';
}
export const GUN_SIRASI: GunGrubu[] = ['Bugün', 'Dün', 'Bu hafta', 'Daha eski'];

/** Satırda görünen kısa zaman: bugün "14:55", dün "Dün 15:52", diğer "12 Eyl 09:10". */
export function kisaZaman(iso: string, simdi = new Date()): string {
  const d = new Date(iso);
  const saat = new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d);
  const f = gunFarki(iso, simdi);
  if (f <= 0) return saat;
  if (f === 1) return `Dün ${saat}`;
  const gun = new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, day: 'numeric', month: 'short' }).format(d);
  return `${gun} ${saat}`;
}
export function tamZaman(iso: string): string {
  return new Date(iso).toLocaleString('tr-TR', { timeZone: TZ, dateStyle: 'long', timeStyle: 'short' });
}

/** Aynı türden, aynı başlıklı ardışık bildirimler tek satırda katlanır ("×12"). Sayı/parantez farkı katlamayı bozmaz. */
export function katlamaAnahtari(n: Bildirim): string {
  const b = temizBaslik(n.title).replace(/\d+/g, '#').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
  return `${turKodu(n.type)}|${b}`;
}

export type Satir = { temsilci: Bildirim; uyeler: Bildirim[]; okunmamis: number; kritik: boolean };

/** Gün grubu içinde katlama: ilk (en yeni) kayıt temsilci; grup içinde okunmamış varsa satır okunmamış sayılır. */
export function satirlariKur(liste: Bildirim[]): Satir[] {
  const sira: Satir[] = [];
  const idx = new Map<string, number>();
  for (const n of liste) {
    const k = katlamaAnahtari(n);
    const i = idx.get(k);
    if (i == null) { idx.set(k, sira.length); sira.push({ temsilci: n, uyeler: [n], okunmamis: n.isRead ? 0 : 1, kritik: kritikMi(n) }); }
    else { const s = sira[i]; s.uyeler.push(n); if (!n.isRead) s.okunmamis++; if (kritikMi(n)) s.kritik = true; }
  }
  return sira;
}
