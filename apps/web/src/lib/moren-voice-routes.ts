/**
 * Canlı MOREN AI — sesle gezilebilir portal modülleri + yerel komut çözümü.
 * GlobalMorenVoice'tan ayrıldı: ses oturumu (moren-voice-session.ts) ve arayüz
 * aynı listeyi kullanır.
 */

export type PortalRoute = {
  label: string;
  path: string;
  aliases?: string[];
};

export const PORTAL_ROUTES: PortalRoute[] = [
  { label: 'Gösterge Paneli', path: '/panel', aliases: ['dashboard', 'ana ekran', 'gösterge'] },
  { label: 'MOREN AI', path: '/panel/moren-ai', aliases: ['moren ai', 'yapay zeka', 'ai'] },
  { label: 'Otomasyonlar', path: '/panel/otomasyonlar', aliases: ['otomasyon'] },
  { label: 'Mükellef Listesi', path: '/panel/mukellef-listesi', aliases: ['mükellefler', 'mukellef listesi'] },
  { label: 'Aylık Takip Listesi', path: '/panel/mukellefler', aliases: ['aylık takip', 'aylik takip', 'takip listesi'] },
  { label: 'İş Akışı', path: '/panel/is-yuku', aliases: ['iş yükü', 'is akisi', 'işler'] },
  { label: 'Görevler & Notlar', path: '/panel/gorevler', aliases: ['görevler', 'notlar'] },
  { label: 'Bildirimler', path: '/panel/bildirimler', aliases: ['bildirim'] },
  { label: 'Fatura İşleme Merkezi', path: '/fatura-merkezi', aliases: ['fatura merkezi', 'fatura muhasebe'] },
  { label: 'E-Fatura / E-Arşiv Sorgulama', path: '/panel/e-arsiv', aliases: ['e arşiv', 'e fatura', 'earsiv'] },
  { label: 'Fatura İşleme', path: '/panel/ajanlar/mihsap', aliases: ['mihsap', 'mihsap fatura'] },
  { label: 'İşlenen Faturalar', path: '/panel/faturalar', aliases: ['faturalar'] },
  { label: 'Fiş Yazdırma', path: '/panel/fis-yazdirma', aliases: ['fiş', 'fis yazdirma'] },
  { label: 'Banka Takip', path: '/panel/banka-takip', aliases: ['banka'] },
  { label: 'Mükellef Profilleri', path: '/panel/ajanlar/profiller', aliases: ['profiller'] },
  { label: 'KDV Kontrol', path: '/panel/kdv-kontrol', aliases: ['kdv'] },
  { label: 'KDV Beyanname', path: '/panel/kdv-beyanname', aliases: ['kdv beyan'] },
  { label: 'Beyannameler', path: '/panel/beyannameler', aliases: ['beyanname'] },
  { label: 'e-Tebligat Kontrol', path: '/panel/ajanlar/tebligat', aliases: ['tebligat'] },
  { label: 'SGK Otomasyonu', path: '/panel/ajanlar/sgk', aliases: ['sgk'] },
  { label: 'Mizan', path: '/panel/mizan', aliases: ['mizan'] },
  { label: 'İşletme Hesap Özeti', path: '/panel/isletme-hesap-ozeti', aliases: ['işletme', 'isletme hesap'] },
  { label: 'Gelir Tablosu', path: '/panel/gelir-tablosu', aliases: ['gelir'] },
  { label: 'Bilanço', path: '/panel/bilanco', aliases: ['bilanço', 'bilanco'] },
  { label: 'E-Defter Kontrol', path: '/panel/ajanlar/e-defter', aliases: ['edefter', 'e defter'] },
  { label: 'Cari Kasa & Tahsilat', path: '/panel/cari-kasa', aliases: ['cari', 'kasa', 'tahsilat'] },
  { label: 'Duyurular', path: '/panel/duyurular', aliases: ['duyuru'] },
  { label: 'HGS İhlal Sorgulama', path: '/panel/galeri/hgs-ihlal', aliases: ['hgs'] },
  { label: 'WhatsApp Otomasyonu', path: '/panel/hatirlatmalar', aliases: ['whatsapp otomasyon', 'hatırlatmalar'] },
  { label: 'Ekip', path: '/panel/ekip', aliases: ['ekip', 'ajan kadrosu', 'koordinatör', 'koordinator'] },
  { label: 'Tüm Ajanlar', path: '/panel/ajanlar', aliases: ['ajanlar', 'tüm ajanlar'] },
  { label: 'Luca Oturumu', path: '/panel/ajanlar/luca', aliases: ['luca'] },
  { label: 'Sağlık Panosu', path: '/panel/ajan-saglik', aliases: ['sağlık', 'ajan sağlık'] },
  { label: 'Ayarlar', path: '/panel/ayarlar', aliases: ['ayar'] },
  { label: 'Denetim Günlüğü', path: '/panel/ayarlar/denetim', aliases: ['denetim'] },
  { label: 'Kilitli Modüller', path: '/panel/sistem/kilitli-moduller', aliases: ['kilitli'] },
];

export function normalizeKey(value: string) {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9/]+/g, '');
}

export function resolveRoute(target: string): PortalRoute | null {
  const raw = String(target || '').trim();
  if (!raw) return null;
  if ((raw === '/fatura-merkezi' || raw.startsWith('/panel')) && !raw.includes('://')) {
    const exact = PORTAL_ROUTES.find((route) => route.path === raw);
    return exact || { label: raw, path: raw };
  }

  const key = normalizeKey(raw);
  return PORTAL_ROUTES.find((route) => {
    if (normalizeKey(route.label) === key) return true;
    if (normalizeKey(route.path) === key) return true;
    return (route.aliases || []).some((alias) => normalizeKey(alias) === key);
  }) || null;
}

export function getCurrentRoute(pathname: string | null): PortalRoute {
  const path = pathname || '';
  const exact = PORTAL_ROUTES.find((route) => route.path === path);
  if (exact) return exact;
  return [...PORTAL_ROUTES]
    .sort((a, b) => b.path.length - a.path.length)
    .find((route) => route.path !== '/panel' && path.startsWith(route.path)) || PORTAL_ROUTES[0];
}

export function resolveLocalPortalCommand(text: string) {
  const key = normalizeKey(text);
  if (!key) return null;

  if (/^(tamam|ok|olur|evet|hayir|hayır|sagol|sağol|tesekkurler|teşekkürler)$/.test(key)) {
    return { type: 'ack' as const, message: 'Tamam.' };
  }

  const hasCommand = /(ac|aç|git|gid|gec|geç|goster|göster|listele|ekran|sayfa)/i.test(text);
  for (const route of PORTAL_ROUTES) {
    const names = [route.label, route.path, ...(route.aliases || [])].map(normalizeKey);
    if (names.some((name) => key === name || (hasCommand && key.includes(name)))) {
      return { type: 'navigate' as const, route };
    }
  }

  return null;
}
