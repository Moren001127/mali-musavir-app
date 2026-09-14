/**
 * Moren Ekip — ortak renkler ve yardımcılar.
 * 2026-09-14 (PLAN/19 §A): Ekip ekranı SAKİN dile geçti (tek vurgu rengi, kelime+nokta durum, gradyan/parıltı yok).
 * Aşağıdaki eski gradyan yardımcıları (kartArkaPlan, kahramanKartStili, avatarHalkaStili, ikonStili, seritStili, hapStili)
 * e-Defter ekranı (`ajanlar/e-defter/page.tsx`) ve MukellefSecici tarafından kullanıldığı için DURUYOR; ekip bileşenleri artık SAKIN kullanır.
 */
import type { CSSProperties } from 'react';
import type { AkisFiltre, AsamaAdi, AsamaDurumu, IsDosyasi, Vaka, VakaKutu } from '@/lib/ekip';

/** Modül vurgu rengi — çelik mavi (KayitFormu ile aynı; PLAN/19 §A.2). */
export const EKIP_ACCENT = '#4f86c9';

/**
 * SAKİN palet (PLAN/19 §A.2, 2026-09-14) — Ekip ekranının TEK paleti.
 * Durum yalnız kelime + küçük nokta: yeşil bitti · kehribar onayınızı bekleyen / sizden istenen · kırmızı hata/canlı · çelik mavi sürüyor.
 * Altın, gradyan çerçeve, parıltı, conic halka, ajan başına renk YOK.
 */
export const SAKIN = {
  metin: '#fafaf9',
  ikincil: 'rgba(250,250,249,0.60)',
  soluk: 'rgba(250,250,249,0.38)',
  kilcal: 'rgba(255,255,255,0.07)',
  cizgi: 'rgba(255,255,255,0.10)',
  cizgiKoyu: 'rgba(255,255,255,0.16)',
  zemin: 'rgba(255,255,255,0.03)',
  zeminAcik: 'rgba(255,255,255,0.055)',
  alan: '#0f1013',
  vurgu: '#4f86c9',
  vurguAcik: '#74a6e6',
  yesil: '#5fcf8e',
  kehribar: '#f0b755',
  kirmizi: '#d64545',
  kirmiziAcik: '#e57373',
  gri: '#8a8f98',
} as const;

/** Tema (Bütçe ui.tsx ile aynı değerler — tek kaynak olsun diye burada da sabit). */
export const TEMA = {
  altin: '#e6c878',
  altinSoft: '#d4b876',
  mavi: '#8cbde8',
  yesil: '#5ad18a',
  kirmizi: '#e0697a',
  turuncu: '#d9a06c',
  mor: '#b0a0e0',
  metin: '#e7e7ea',
  ikincil: 'rgba(231,231,234,0.62)',
  soluk: '#71717a',
  kartZemin: 'rgba(255,255,255,0.018)',
  kartKenar: 'rgba(255,255,255,0.06)',
  satirCizgi: 'rgba(255,255,255,0.05)',
  alanZemin: 'rgba(0,0,0,0.28)',
  alanKenar: 'rgba(255,255,255,0.10)',
} as const;

/** Sakin kart: düz koyu zemin + 1px kılcal kenar; `secili` → çelik mavi kenar. Gradyan/parıltı yok. */
export function sakinKart(secili = false): CSSProperties {
  return {
    background: SAKIN.zemin,
    border: `1px solid ${secili ? `${SAKIN.vurgu}66` : SAKIN.kilcal}`,
    borderRadius: 12,
  };
}

/** Sakin giriş alanı (metin kutusu, arama): koyu zemin, kılcal kenar; odak rengi bileşende (çelik mavi). */
export function sakinAlan(): CSSProperties {
  return { background: SAKIN.alan, border: `1px solid ${SAKIN.cizgi}`, color: SAKIN.metin };
}

/** Sakin düğme: birincil (çelik mavi dolu) · ikincil (kılcal kenar) · tehlike (kırmızı kenar, kırmızı yazı). */
export function sakinDugme(tur: 'birincil' | 'ikincil' | 'tehlike' = 'ikincil'): CSSProperties {
  if (tur === 'birincil') return { background: SAKIN.vurgu, border: `1px solid ${SAKIN.vurgu}`, color: '#ffffff' };
  if (tur === 'tehlike') return { background: 'rgba(214,69,69,0.10)', border: `1px solid ${SAKIN.kirmizi}88`, color: SAKIN.kirmiziAcik };
  return { background: 'transparent', border: `1px solid ${SAKIN.cizgi}`, color: SAKIN.metin };
}

/** Sakin avatar (2 harf): nötr koyu daire; çalışıyorsa çelik mavi halka, hata ise kırmızı halka. */
export function sakinAvatar(durum: 'bos' | 'calisiyor' | 'hata' | 'siz' = 'bos'): CSSProperties {
  const kenar = durum === 'calisiyor' ? SAKIN.vurgu : durum === 'hata' ? SAKIN.kirmizi : durum === 'siz' ? SAKIN.kehribar : SAKIN.cizgiKoyu;
  return {
    background: SAKIN.alan,
    border: `1px solid ${kenar}`,
    color: durum === 'calisiyor' ? SAKIN.vurguAcik : durum === 'siz' ? SAKIN.kehribar : SAKIN.ikincil,
    boxShadow: durum === 'calisiyor' ? `0 0 0 2px ${SAKIN.vurgu}33` : 'none',
  };
}

/** Küçük durum noktası (6px) — kelimenin yanında. */
export function durumNoktasi(renk: string, nabiz = false): CSSProperties {
  return { background: renk, boxShadow: nabiz ? `0 0 0 3px ${renk}33` : 'none' };
}

/** Renk envanteri (§8) — eski dil; e-Defter ekranı ve eski yardımcılar için duruyor. Ekip bileşenleri SAKIN kullanır. */
export const RENK = {
  metin: '#fafaf9',
  ikincil: 'rgba(250,250,249,0.55)',
  sonuk: 'rgba(250,250,249,0.35)',
  altin: '#fbbf24', // yalnız: Onay kuyruğu şeridi/başlığı + Sabah bandı "bekleyen onay" sayacı + Koordinatör ikon halkası
  turuncu: '#fdba74', // onay bekliyor adımı, ajan başına onay rozeti, süre azaldı, uyarı satırı
  kirmizi: '#f87171', // hata, CANLI, Max bağlı değil, Operatör kapalı, Durdur
  yesil: '#4ade80', // KURU, bitti, onaylandı
  mor: '#a78bfa', // pano, ÖĞRENDİM çipleri
  gri: '#a3a3a3', // bekliyor / kapalı metin
} as const;

/** Her ajanın kendi rengi (28px ikon, seçili satır kenarı, akış şeridi). */
export const AJAN_RENK: Record<string, string> = {
  koordinator: '#d4b876',
  evrak: '#60a5fa',
  fatura: '#34d399',
  'banka-kasa': '#22d3ee',
  beyanname: '#fbbf24',
  'bordro-sgk': '#a78bfa',
  edefter: '#818cf8',
  'luca-operator': '#e879f9',
  denetci: '#f87171',
  analist: '#2dd4bf',
  mevzuat: '#fb923c',
  risk: '#fb7185',
  musteri: '#4ade80',
};

export function ajanRengi(id: string): string {
  return AJAN_RENK[id] || EKIP_ACCENT;
}

/**
 * Büyük yüzey rengi (kart arka planı, şerit, çipler, Çalıştır gradyanı) — §0.3/§0.6/§8.
 * Ajan rengi yalnız 28/36px ikon + seçili satır kenarında kalır; şu ajanlar büyük yüzeyde modül rengine (gök mavisi) düşer:
 * - koordinator (#d4b876) ve beyanname (#fbbf24): altın yalnız 3 yerde olabilir (§8), büyük yüzeye çıkamaz.
 * - denetci (#f87171 = RENK.kirmizi): kırmızı yalnız hata + CANLI; KURU'da kırmızı Çalıştır olamaz (§0.6).
 * - musteri (#4ade80 = RENK.yesil): yeşil yalnız KURU/bitti/onaylandı ile karışmasın.
 * AJAN_RENK'in kendisi onaysız DEĞİŞTİRİLMEZ (§8).
 */
const YUZEYDE_MODUL_RENGI = new Set(['koordinator', 'beyanname', 'denetci', 'musteri']);
export function ajanYuzeyRengi(id: string): string {
  return YUZEYDE_MODUL_RENGI.has(id) ? EKIP_ACCENT : ajanRengi(id);
}

/** Kısa ad — id'den baş harf/kısaltma (ikon yerine). */
export function ajanKisaltma(id: string, ad?: string): string {
  const map: Record<string, string> = {
    koordinator: 'KO',
    evrak: 'EV',
    fatura: 'FA',
    'banka-kasa': 'BK',
    beyanname: 'BY',
    'bordro-sgk': 'SG',
    edefter: 'ED',
    'luca-operator': 'LU',
    denetci: 'DN',
    analist: 'AN',
    mevzuat: 'MV',
    risk: 'RS',
    musteri: 'MÜ',
  };
  if (map[id]) return map[id];
  return (ad || id).slice(0, 2).toLocaleUpperCase('tr-TR');
}

/**
 * Sakin kart zemini (düz gri kutu YOK): koyu gradyan + sol-üst radial parıltı + 1px rgba(255,255,255,.08) kenar.
 * `secili` → kenar ve parıltı ajan/modül renginde belirginleşir.
 */
export function kartArkaPlan(renk: string, secili = false): CSSProperties {
  return {
    background: `radial-gradient(120% 100% at 0% 0%, ${renk}${secili ? '2a' : '16'}, transparent 50%), linear-gradient(160deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01)), linear-gradient(160deg, rgba(20,18,16,0.96), rgba(9,8,7,0.96))`,
    border: `1px solid ${secili ? `${renk}66` : 'rgba(255,255,255,0.08)'}`,
    boxShadow: secili
      ? `0 0 0 1px ${renk}22, 0 18px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05)`
      : 'inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 30px rgba(0,0,0,0.25)',
  };
}

/**
 * Kahraman kart (komut kutusu): 1px GRADYAN çerçeve + dış parıltı + iç beyaz gradyan + sol-üst radial parıltı.
 * `canli` → çerçeve/parıltı kırmızıya döner (kırmızı yalnız CANLI ve hata).
 */
export function kahramanKartStili(renk: string, canli = false): CSSProperties {
  const r = canli ? RENK.kirmizi : renk;
  return {
    border: '1px solid transparent',
    background: [
      `radial-gradient(90% 70% at 0% 0%, ${r}2e, transparent 55%) padding-box`,
      'linear-gradient(160deg, rgba(255,255,255,0.045), rgba(255,255,255,0.01)) padding-box',
      'linear-gradient(160deg, rgba(20,18,16,0.98), rgba(9,8,7,0.98)) padding-box',
      `linear-gradient(135deg, ${r}bb, ${r}33 55%, rgba(255,255,255,0.10)) border-box`,
    ].join(', '),
    boxShadow: `0 0 0 1px ${r}22, 0 20px 60px ${r}14, inset 0 1px 0 rgba(255,255,255,0.05)`,
  };
}

/** Küçük hap rozet (başlık kartı, sekme sayaçları). */
export function hapStili(renk: string, dolu = false): CSSProperties {
  return dolu
    ? { background: `linear-gradient(135deg, ${renk}, ${renk}bb)`, border: '1px solid transparent', color: '#0b1218' }
    : { background: `${renk}12`, border: `1px solid ${renk}3d`, color: renk };
}

/** Avatar halkası (48px daire): conic gradyan halka, içi koyu, kısaltma ajan renginde. */
export function avatarHalkaStili(renk: string, secili: boolean): CSSProperties {
  return {
    background: `conic-gradient(from 210deg, ${renk}, ${renk}55 40%, ${renk}cc 70%, ${renk})`,
    boxShadow: secili ? `0 0 0 3px ${renk}2e, 0 0 22px ${renk}66` : `0 0 0 1px rgba(0,0,0,0.5)`,
  };
}

/** Tek kelimelik kısa ad (avatar sırası altı). */
export function ajanKisaAd(id: string, ad?: string): string {
  const map: Record<string, string> = {
    koordinator: 'Koordinatör',
    evrak: 'Evrak',
    fatura: 'Fatura',
    'banka-kasa': 'Banka',
    beyanname: 'Beyanname',
    'bordro-sgk': 'Bordro',
    edefter: 'e-Defter',
    'luca-operator': 'Luca',
    denetci: 'Denetçi',
    analist: 'Analist',
    mevzuat: 'Mevzuat',
    risk: 'Risk',
    musteri: 'Müşteri',
  };
  return map[id] || (ad || id).split(' ')[0];
}

/** Her bölümün üstündeki 1px/4px renk şeridi (§0.2). */
export function seritStili(renk: string): CSSProperties {
  return { background: `linear-gradient(90deg, ${renk}, ${renk}55 55%, transparent)` };
}

/** Ajan ikonu (28px kısaltma kutusu) — gradyan, koyu metin. */
export function ikonStili(renk: string): CSSProperties {
  return {
    background: `linear-gradient(135deg, ${renk}, ${renk}88)`,
    color: '#0f0d0b',
    boxShadow: `0 0 12px ${renk}2a, inset 0 1px 0 rgba(255,255,255,0.3)`,
  };
}

/** Model rozeti rengi. */
export function modelRengi(model: string): string {
  const m = (model || '').toLowerCase();
  if (m.includes('opus')) return '#e879f9';
  if (m.includes('sonnet')) return '#7dd3fc';
  if (m.includes('haiku')) return '#4ade80';
  return '#a3a3a3';
}

/** 5 aşama (6→5: tahakkukIletildi kalktı — MonthlyStatusRow'da gerçek alan yok). Harf: E İ K H V. */
export const ASAMALAR: Array<{ key: AsamaAdi; ad: string; harf: string; kisa: string }> = [
  { key: 'evrak', ad: 'Evrak geldi', harf: 'E', kisa: 'evrak' },
  { key: 'isleme', ad: 'İşlendi', harf: 'İ', kisa: 'işlendi' },
  { key: 'kontrol', ad: 'Kontrol edildi', harf: 'K', kisa: 'kontrol' },
  { key: 'beyanname', ad: 'Beyanname hazır', harf: 'H', kisa: 'hazır' },
  { key: 'gonderim', ad: 'Beyanname verildi', harf: 'V', kisa: 'verildi' },
];

export function asamaRengi(d?: string): string {
  if (d === 'tamam') return TEMA.yesil;
  if (d === 'eksik') return TEMA.turuncu;
  return 'rgba(255,255,255,0.18)';
}

export function donemEtiketi(donem: string): string {
  const [y, m] = donem.split('-');
  const aylar = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  const ay = aylar[Number(m) - 1];
  return ay ? `${ay} ${y}` : donem;
}

export function tarihKisa(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
}

export function saatKisa(iso?: string | number | null): string {
  if (iso == null) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Istanbul' });
}

export function sureKisa(ms?: number | null): string {
  if (ms == null) return '';
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} sn`;
  return `${Math.floor(s / 60)} dk ${s % 60} sn`;
}

/** mm:ss sayaç (canlı koşu süresi). */
export function sayacMetni(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Europe/Istanbul takvim günü (YYYY-MM-DD). */
function istanbulGunu(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
}

/** Verilen an İstanbul takvimine göre bugün mü. */
export function bugunMu(iso?: string | number | null): boolean {
  if (iso == null) return false;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  return istanbulGunu(d) === istanbulGunu(new Date());
}

/** '12 dk önce' | '2 sa önce' | 'dün 08:31' | '12.09 14:02' */
export function goreliSaat(iso?: string | number | null): string {
  if (iso == null) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const simdi = new Date();
  const fark = simdi.getTime() - d.getTime();
  if (fark < 60_000) return 'az önce';
  if (fark < 3_600_000) return `${Math.floor(fark / 60_000)} dk önce`;
  const bugun = istanbulGunu(simdi);
  const gun = istanbulGunu(d);
  const saat = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
  if (gun === bugun) return `${Math.floor(fark / 3_600_000)} sa önce`;
  const dun = istanbulGunu(new Date(simdi.getTime() - 86_400_000));
  if (gun === dun) return `dün ${saat}`;
  return `${d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Istanbul' })} ${saat}`;
}

/** Onay süresi: kalan ms → '21 sa 40 dk kaldı' / '35 dk kaldı' / 'süresi doldu'. */
export function kalanSure(expiresAt?: string | null): { metin: string; ms: number } {
  if (!expiresAt) return { metin: '', ms: 0 };
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (isNaN(ms)) return { metin: '', ms: 0 };
  if (ms <= 0) return { metin: 'süresi doldu', ms };
  const dk = Math.floor(ms / 60_000);
  const sa = Math.floor(dk / 60);
  if (sa >= 1) return { metin: `${sa} sa ${dk % 60} dk kaldı`, ms };
  return { metin: `${dk} dk kaldı`, ms };
}

/** Telefonu maskele: 0532 *** ** 12 → başı ve son 2 hanesi kalır. */
export function telefonMaskele(t: string): string {
  const s = String(t).replace(/\s+/g, '');
  if (!/^\+?\d{7,15}$/.test(s)) return t;
  return `${s.slice(0, 4)} … ${s.slice(-2)}`;
}

export function telefonMu(h?: string | null): boolean {
  return !!h && /^\+?\d{7,15}$/.test(String(h).replace(/\s+/g, ''));
}

/** Kaynak → etiket (portal / 🎤 ses / ⏰ cron / KO koordinatör / 💬 WhatsApp). */
export function kaynakEtiketi(k?: string | null): { ad: string; ikon: string } {
  switch (k) {
    case 'ses':
      return { ad: 'sesli komut', ikon: '🎤' };
    case 'cron':
      return { ad: 'zamanlanmış', ikon: '⏰' };
    case 'koordinator':
      return { ad: 'koordinatör', ikon: 'KO' };
    case 'whatsapp':
      return { ad: 'WhatsApp', ikon: '💬' };
    default:
      return { ad: 'portal', ikon: '' };
  }
}

/** Araç adı → insan dili (arac-defteri + ajan-tanimlari tüm adlar; eksik olan ham adla gösterilir). */
export const ARAC_ADI: Record<string, string> = {
  // dışarı gönderim
  send_whatsapp_freeform: 'WhatsApp mesajı',
  send_whatsapp_template: 'WhatsApp şablon mesajı',
  send_sms: 'SMS',
  send_email: 'e-posta',
  // resmi (yalnız Muzaffer Bey)
  gib_beyanname_gonder: 'GİB beyanname gönderimi (yalnız Muzaffer Bey)',
  sgk_bildirge_gonder: 'SGK e-bildirge gönderimi (yalnız Muzaffer Bey)',
  edefter_berat_yukle: 'e-Defter berat yükleme (yalnız Muzaffer Bey)',
  // Luca
  luca_yaz: 'Luca alan yazma',
  luca_sec: 'Luca seçim',
  luca_tikla: 'Luca tıklama',
  luca_ekran_oku: 'Luca ekran okuma',
  luca_rapor_oku: 'Luca rapor okuma',
  luca_menu_ara: 'Luca menü arama',
  luca_menu_git: 'Luca menüye gitme',
  luca_menu_haritasi_cikar: 'Luca menü haritası',
  luca_mizan_cek: 'Luca mizan çekme',
  luca_beceri_listele: 'Luca beceri listesi',
  luca_beceri_getir: 'Luca beceri getirme',
  luca_beceri_kaydet: 'Luca beceri kaydı',
  luca_kural_listele: 'Luca kural listesi',
  luca_kural_kaydet: 'Luca kural kaydı',
  luca_kural_sil: 'Luca kural silme',
  post_to_luca: 'Luca fiş kaydı',
  fetch_kdv_from_luca: "Luca'dan KDV çekme",
  // mükellef / portal okuma
  list_taxpayers: 'Mükellef listesi',
  get_taxpayer: 'Mükellef kartı',
  search_all: 'Portal arama',
  get_taxpayer_work_status: 'Mükellef iş durumu',
  list_taxpayers_monthly_status: 'Aylık takip',
  set_monthly_status: 'Aylık takip işaretleme',
  list_documents: 'Belge listesi',
  list_invoices: 'Fatura listesi',
  list_fatura_merkezi: 'Fatura Merkezi',
  list_earsiv_invoices: 'e-Arşiv faturaları',
  fetch_invoices_for_period: 'Dönem faturalarını çekme',
  extract_invoice_fields: 'Fatura alanlarını çıkarma',
  generate_fis_word_from_invoices: 'Faturadan fiş taslağı',
  ocr_pdf: 'PDF okuma (OCR)',
  classify_with_claude: 'Belge sınıflandırma',
  summarize_with_claude: 'Özetleme',
  get_kdv_summary: 'KDV özeti',
  get_beyan_ozet: 'Beyan özeti',
  get_beyanname_config: 'Beyanname ayarları',
  get_beyanname_readiness_summary: 'Beyanname hazırlık',
  list_beyan_kayitlari: 'Beyan kayıtları',
  list_tax_payable: 'Ödenecek vergiler',
  get_tax_calendar: 'Vergi takvimi',
  get_operation_briefing: 'Operasyon özeti',
  get_collection_risk_summary: 'Tahsilat riski',
  get_cari_hareketler: 'Cari hareketler',
  get_bank_status: 'Banka durumu',
  get_isletme_hesap_ozeti: 'İşletme hesap özeti',
  list_mizan_periods: 'Mizan dönemleri',
  get_mizan: 'Mizan',
  get_gelir_tablosu: 'Gelir tablosu',
  get_bilanco: 'Bilanço',
  compare_periods: 'Dönem karşılaştırma',
  calculate_financial_ratios: 'Mali oranlar',
  get_payroll_summary: 'Bordro özeti',
  list_sgk_declarations: 'SGK bildirgeleri',
  list_edefter_sessions: 'e-Defter oturumları',
  list_etebligat: 'e-Tebligat listesi',
  list_tasks: 'Görev listesi',
  list_pending_decisions: 'Bekleyen kararlar',
  get_gundem: 'Gündem',
  get_agent_status: 'Ajan durumu',
  get_luca_agent_jobs: 'Luca ajan işleri',
  get_mihsap_agent_jobs: 'Mihsap ajan işleri',
  get_system_health: 'Sistem sağlığı',
  get_ai_cost_summary: 'AI maliyet özeti',
  get_portal_capability_map: 'Portal yetenek haritası',
  check_official_gazette: 'Resmî Gazete taraması',
  research_official_sources: 'Resmî kaynak araştırması',
  http_get: 'Web isteği',
  // hafıza
  search_ai_memory: 'Hafızada arama',
  save_ai_memory: 'Hafızaya kayıt',
  get_firma_hafizasi: 'Firma hafızası',
  get_accounting_reference: 'Muhasebe referansı',
  // mükellef botu tarafı
  get_my_profile: 'Mükellef profili',
  get_my_balance: 'Mükellef bakiyesi',
  get_my_beyanname: 'Mükellef beyannameleri',
  get_my_documents: 'Mükellef belgeleri',
  get_my_invoices: 'Mükellef faturaları',
  get_my_kdv: 'Mükellef KDV',
  get_my_open_tasks: 'Mükellef açık işleri',
  get_my_recent_messages: 'Mükellef son mesajları',
  get_my_sgk: 'Mükellef SGK',
  get_my_tebligat: 'Mükellef tebligatları',
  get_my_vergi_takvimi: 'Mükellef vergi takvimi',
  get_my_work_status: 'Mükellef iş durumu',
  // ajan/onay mekaniği
  preview_agent_command: 'Komut önizleme',
  create_pending_action: 'Bekleyen işlem oluşturma',
  ekip_pano: 'Dönem panosu',
  ekip_isler: 'İş dosyaları',
  ekip_onaylar: 'Onay kayıtları',
  ekip_onayla: 'Onay yürütme',
  ekip_reddet: 'Onay reddi',
  ekip_ajan_baslat: 'Personel başlatıldı',
  ekip_is_durum: 'İş durumu okundu',
  create_agent_command: 'Ajan komutu',
  create_confirmed_agent_command: 'Onaylı ajan komutu',
  // KDV Kontrol zinciri (R1)
  kdv_kontrol_oturum_bul_olustur: 'KDV kontrol oturumu bulundu/açıldı',
  kdv_kontrol_luca_cek: 'Luca çekimi başlatıldı',
  kdv_kontrol_fatura_bagla: 'Mihsap faturaları bağlandı',
  kdv_kontrol_ocr_baslat: 'Fatura okuma (OCR) başlatıldı',
  kdv_kontrol_ocr_bekle: 'Fatura okuma bekleniyor',
  kdv_kontrol_eslestir: 'Luca ↔ fatura eşleştirmesi',
  kdv_kontrol_sonuc_satirlari: 'Sonuç satırları okundu',
  kdv_kontrol_kilitle: 'KDV kontrol oturumu kilitlendi',
  kdv_kontrol_kilit_ac: 'KDV kontrol kilidi açıldı',
  luca_is_bekle: 'Luca işi bekleniyor',
  // Fatura Merkezi
  fm_donem_ozeti: 'Fatura Merkezi dönem özeti',
  fm_uyumsuzluklar: 'Fatura Merkezi uyumsuzlukları',
  fm_belge_listele: 'Fatura Merkezi belge listesi',
  fm_belge_detay: 'Belge ayrıntısı',
  fm_hesap_plani_ara: 'Hesap planında arama',
  fm_ai_ile_oku: 'Belgeleri yapay zekâ ile okuma',
  fm_hesap_ata: 'Hesap kodu atama',
  fm_isaretle: 'Belge işaretleme',
  fm_luca_gonder: 'Luca’ya fiş gönderme',
  fm_onayla: 'Fatura Merkezi onayı (yalnız Muzaffer Bey)',
  // mali tablo / KDV
  mali_donemler_listele: 'Hazır mali tablo dönemleri',
  mali_yorum_oku: 'Kayıtlı mali yorum',
  get_kdv1_on_hazirlik: 'KDV1 ön hazırlık',
  get_my_isletme_hesap_ozeti: 'Mükellef işletme hesap özeti',
};

export function aracAdi(ad?: string | null): string {
  if (!ad) return '';
  return ARAC_ADI[ad] ?? ad;
}

/** Cevap ayrıştırma: RAPOR / SORU / ÖĞRENDİM etiketleri (§4.5). */
export function cevapAyristir(metin: string): { rapor: string; sorular: string[]; ogrenilen: string[]; ham: string } {
  const ham = metin || '';
  const re = /^[ \t]*(RAPOR|SORU|ÖĞRENDİM|OGRENDIM)[ \t]*:[ \t]*/gim;
  const eslesmeler: Array<{ tip: string; bas: number; son: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(ham))) {
    eslesmeler.push({ tip: m[1].toLocaleUpperCase('tr-TR'), bas: m.index, son: m.index + m[0].length });
  }
  if (!eslesmeler.length) return { rapor: '', sorular: [], ogrenilen: [], ham };
  const raporParcalari: string[] = [];
  const sorular: string[] = [];
  const ogrenilen: string[] = [];
  const bastaki = ham.slice(0, eslesmeler[0].bas).trim();
  if (bastaki) raporParcalari.push(bastaki);
  eslesmeler.forEach((e, i) => {
    const govde = ham.slice(e.son, i + 1 < eslesmeler.length ? eslesmeler[i + 1].bas : undefined).trim();
    if (!govde) return;
    if (e.tip === 'RAPOR') raporParcalari.push(govde);
    else if (e.tip === 'SORU') sorular.push(govde);
    else {
      for (const satir of govde.split('\n')) {
        const s = satir.replace(/^\s*[-•*\d.)]+\s*/, '').trim();
        if (s) ogrenilen.push(s);
      }
    }
  });
  return { rapor: raporParcalari.join('\n\n'), sorular, ogrenilen, ham };
}

/** Pano satırının sonraki adımı (§4.9 tablosu). `sira`: Acil önce sıralaması (0 = en acil). */
export function sonrakiAdim(
  asamalar: Partial<Record<AsamaAdi, AsamaDurumu>> | undefined,
  kayitVar: boolean,
): { metin: string; ajanId?: string; sablonId?: string; sira: number } {
  const t = (k: AsamaAdi) => asamalar?.[k] === 'tamam';
  if (!kayitVar) return { metin: 'Kayıt yok', ajanId: 'koordinator', sablonId: 'kayit-yok', sira: 0 };
  // Evrak hatırlatma/geldi mesajları EVRAK OTOMASYONU'nun işi (Evrak ajanı 2026-09-13'te kaldırıldı) → görev düğmesi yok.
  if (!t('evrak')) return { metin: 'Evrak bekleniyor (otomatik hatırlatma)', sira: 1 };
  if (!t('isleme')) return { metin: 'Faturalar işlenecek', ajanId: 'fatura', sablonId: 'fatura-isle', sira: 2 };
  if (!t('kontrol')) return { metin: 'KDV kontrolü', ajanId: 'beyanname', sablonId: 'kdv-kontrol', sira: 3 };
  if (!t('beyanname')) return { metin: 'Beyanname hazırlanacak', ajanId: 'beyanname', sablonId: 'kdv-kontrol', sira: 4 };
  if (!t('gonderim')) return { metin: 'Hazır — GİB gönderimi sende', sira: 5 };
  return { metin: 'Tamam ✓', sira: 6 };
}

export type SablonGrubu = 'Günlük' | 'Fatura' | 'Beyanname ve KDV' | 'Denetim ve analiz' | 'Diğer';

export interface Sablon {
  id: string;
  ad: string;
  ajanId: string;
  mukellefIster: boolean;
  donemIster: boolean;
  gorev: string;
  /** "Diğer ▾" listesinde gruplama (PLAN/19 §A.3). */
  grup: SablonGrubu;
}

/** Görev kutusunda düz bağlantı olarak görünen 5 sık şablon; kalanı "Diğer ▾" listesinde. */
export const SIK_SABLON_IDLERI = ['sabah-ozeti', 'kdv-kontrol', 'fatura-isle', 'donem-yorum', 'donem-denetim'] as const;

/**
 * Hazır görev şablonları — doğal dil, araç adı geçmez; {mükellef}/{dönem} yer tutucu.
 * 2026-09-14 (PLAN/19 H6): "Eksik evrak", "Hatırlatma metni", "Tahsilat taslağı" (evrak/tahsilat mesajları otomasyon işi, Evrak ajanı
 * kaldırıldı) ve "Bordro/SGK kontrol" (yönlendirme ajanı başlatmıyor) şablonları çıkmaz sokaktı → KALDIRILDI.
 */
export const SABLONLAR: Sablon[] = [
  { id: 'sabah-ozeti', ad: 'Sabah özeti', ajanId: 'koordinator', mukellefIster: false, donemIster: false, gorev: 'Bugünün ofis özetini çıkar: durum, riskli/acil, yaklaşan süreler, ekip dün ne yaptı, bugün öncelik. Mesaj gönderme.' , grup: 'Günlük' },
  { id: 'haftalik-sureler', ad: 'Haftalık süreler', ajanId: 'koordinator', mukellefIster: false, donemIster: false, gorev: 'Bu hafta ve gelecek hafta vadesi gelen beyanname/bildirge/ödemeleri mükellef bazında listele.' , grup: 'Günlük' },
  { id: 'kayit-yok', ad: 'Kayıt yok — araştır', ajanId: 'koordinator', mukellefIster: true, donemIster: true, gorev: '{mükellef} için {dönem} aylık takip kaydı yok; neden yok araştır, açılması gerekiyorsa bana sun.' , grup: 'Günlük' },
  { id: 'fatura-isle', ad: 'Faturaları işle', ajanId: 'fatura', mukellefIster: true, donemIster: true, gorev: '{mükellef} için {dönem} faturalarını oku, hesap eşleştir, Luca fiş taslağı hazırla (kuru test). Şüpheli/uyuşmayan faturaları ayrı listele.' , grup: 'Fatura' },
  { id: 'supheli', ad: 'Şüpheli faturalar', ajanId: 'fatura', mukellefIster: true, donemIster: true, gorev: '{mükellef} {dönem}: içerik-hesap uyuşmayan, mükerrer ya da tutarı şüpheli faturaları ayır.' , grup: 'Fatura' },
  { id: 'vadesi-gecmis', ad: 'Vadesi geçmiş', ajanId: 'banka-kasa', mukellefIster: false, donemIster: false, gorev: 'Vadesi geçmiş tahsilatları mükellef bazında listele; {mükellef} seçiliyse ekstre özetini çıkar.' , grup: 'Diğer' },
  // PLAN/17 R1 (2026-09-13): KDV Kontrol portal işidir; ajan zinciri kendi yürütür (Luca Operatörü'ne devretmez).
  { id: 'kdv-kontrol', ad: 'KDV kontrol', ajanId: 'beyanname', mukellefIster: true, donemIster: true, gorev: '{mükellef} için {dönem} KDV kontrolünü YAP (R1): oturumları bul/aç, Luca çekimi ve fatura bağlama + OCR, eşleştir, hatalı satırları belge no ile listele. Kuru testte oturum açılmaz, zincir "yapılacaktı" olarak yazılır. Kilitleme bende; beyannameyi hazır işaretleme, önce bana sun.' , grup: 'Beyanname ve KDV' },
  { id: 'hazir-isaretle', ad: 'Hazır işaretlenebilecekler', ajanId: 'beyanname', mukellefIster: false, donemIster: true, gorev: '{dönem} KDV kontrolü biten ve hatasız olan mükellefleri listele; hazır işaretlenebilecekleri ayrı göster.' , grup: 'Beyanname ve KDV' },
  { id: 'donem-denetim', ad: 'Dönem denetimi', ajanId: 'denetci', mukellefIster: true, donemIster: true, gorev: '{mükellef} {dönem} mizan + fiş listesi: kasa negatif, 191-391 tutarsızlık, tekrarlı fiş, eksik ay, ters bakiye, KDV aritmetik. Uyarı raporu çıkar, mükellefe gönderme.' , grup: 'Denetim ve analiz' },
  { id: 'resmi-gazete', ad: 'Resmî Gazete', ajanId: 'mevzuat', mukellefIster: false, donemIster: false, gorev: "Bugünkü Resmî Gazete'yi tara; ofisi ve mükellefleri ilgilendiren vergi/SGK değişikliklerini 3 maddede özetle." , grup: 'Diğer' },
  { id: 'risk-guncelle', ad: 'Risk puanları', ajanId: 'risk', mukellefIster: false, donemIster: false, gorev: "Mükellef risk puanlarını güncelle; en riskli 5'i nedenleriyle listele." , grup: 'Diğer' },
  { id: 'cevapsiz', ad: 'Cevapsız mesajlar', ajanId: 'musteri', mukellefIster: false, donemIster: false, gorev: 'Cevapsız kalan mükellef mesajlarını listele; her biri için cevap taslağı hazırla (gönderme).' , grup: 'Diğer' },
  // PLAN/17 R2 (2026-09-13): portaldaki hazır (kilitli) tablo okunur; Luca çekimi / mizan çekimi istenmez.
  { id: 'donem-yorum', ad: 'Mali yorum', ajanId: 'analist', mukellefIster: true, donemIster: true, gorev: '{mükellef} için {dönem} portaldaki hazır (kilitli) gelir tablosunu oku ve yorumla: ciro/kâr eğilimi, vergi yükü tahmini, nakit akışı, geçici vergi öngörüsü; kayıtlı Mali Yorum varsa çelişkiyi söyle. Luca çekimi isteme. ÖNERİ etiketiyle, mükellefe gönderme.' , grup: 'Denetim ve analiz' },
  { id: 'berat-negatif', ad: 'Berat + negatif tarama', ajanId: 'edefter', mukellefIster: true, donemIster: false, gorev: 'Berat takvimi + {mükellef} için negatif kasa/stok/banka taraması.' , grup: 'Denetim ve analiz' },
  { id: 'luca-kontrol', ad: 'Luca oturum kontrolü', ajanId: 'luca-operator', mukellefIster: false, donemIster: false, gorev: 'Luca oturumunu ve menüyü kontrol et; oturum düşmüşse bildir.' , grup: 'Diğer' },
];

/** Şablon metnini doldur: {mükellef} → seçili ad ya da "seçili mükellef"; {dönem} → dönem etiketi ya da "bu dönem". */
export function sablonDoldur(gorev: string, mukellefAd?: string | null, donem?: string | null): string {
  return gorev
    .replace(/\{mükellef\}/g, mukellefAd || 'seçili mükellef')
    .replace(/\{dönem\}/g, donem ? donemEtiketi(donem) : 'bu dönem');
}

/** İş dosyası durum etiketi + rengi (tek yerden). */
export function isDurumu(is: Pick<IsDosyasi, 'status'>): { ad: string; renk: string } {
  switch (is.status) {
    case 'running':
      return { ad: 'Çalışıyor', renk: TEMA.mavi };
    case 'done':
      return { ad: 'Bitti', renk: TEMA.yesil };
    case 'failed':
      return { ad: 'Hata', renk: TEMA.kirmizi };
    default:
      return { ad: 'Bekliyor', renk: TEMA.soluk };
  }
}

// ─── CANLI AKIŞ — kutular (2026-09-13, "sakin komuta merkezi" v2) ───

/** Depo anahtarları (localStorage). Kuru/Canlı ve açık vaka ASLA depoya yazılmaz. */
export const DEPO = {
  akisSuzgec: 'ekip.akisSuzgec',
  akisGun: 'ekip.akisGun',
  panoAcik: 'ekip.panoAcik',
  donem: 'ekip.donem',
} as const;

/**
 * Muzaffer Bey'in gördüğü kutular: Sürüyor · Onayınızı bekleyen · Sizden istenen · Bitti.
 * Sakin dil: onay ve istek ikisi de kehribar (ayrımı kelime yapar); sürüyor çelik mavi; bitti yeşil.
 */
export const KUTULAR: Array<{ id: AkisFiltre; ad: string; renk: string; sayacAnahtari: 'suruyor' | 'onay' | 'istek' | 'bitti' | null }> = [
  { id: 'tumu', ad: 'Tümü', renk: TEMA.mavi, sayacAnahtari: null },
  { id: 'suruyor', ad: 'Sürüyor', renk: TEMA.mavi, sayacAnahtari: 'suruyor' },
  { id: 'onay', ad: 'Onayınızı bekleyen', renk: TEMA.altin, sayacAnahtari: 'onay' },
  { id: 'istek', ad: 'Sizden istenen', renk: TEMA.turuncu, sayacAnahtari: 'istek' },
  { id: 'bitti', ad: 'Bitti', renk: TEMA.yesil, sayacAnahtari: 'bitti' },
];

export function kutuRengi(kutu: VakaKutu): string {
  return KUTULAR.find((k) => k.id === kutu)?.renk || TEMA.mavi;
}

/** Vaka satırı durum rozeti — Sürüyor / Onay / İstek / Bitti / Hata (tek yerden). */
export function kutuRozeti(v: Pick<Vaka, 'kutu' | 'durum'>): { ad: string; renk: string; nabiz: boolean } {
  if (v.durum === 'hata') return { ad: 'Hata', renk: TEMA.kirmizi, nabiz: false };
  switch (v.kutu) {
    case 'onay':
      return { ad: 'Onayınızı bekliyor', renk: TEMA.altin, nabiz: false };
    case 'istek':
      return { ad: 'Sizden istenen', renk: TEMA.turuncu, nabiz: false };
    case 'bitti':
      return { ad: 'Bitti', renk: TEMA.yesil, nabiz: false };
    default:
      return { ad: 'Sürüyor', renk: TEMA.mavi, nabiz: true };
  }
}

/** Liste sırası: önce onay/istek kutuları, sonra sürüyor, sonra bitti; her grupta guncellendi desc. */
export function vakaSirasi(a: Vaka, b: Vaka): number {
  const grup = (v: Vaka) => (v.kutu === 'onay' || v.kutu === 'istek' ? 0 : v.kutu === 'suruyor' ? 1 : 2);
  const g = grup(a) - grup(b);
  if (g !== 0) return g;
  return new Date(b.guncellendi).getTime() - new Date(a.guncellendi).getTime();
}

/** localStorage güvenli okuma/yazma (SSR + engelli tarayıcı). Kuru/Canlı ASLA buraya yazılmaz. */
export function depoOku(anahtar: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(anahtar);
  } catch {
    return null;
  }
}
export function depoYaz(anahtar: string, deger: string | null) {
  try {
    if (typeof window === 'undefined') return;
    if (deger == null) window.localStorage.removeItem(anahtar);
    else window.localStorage.setItem(anahtar, deger);
  } catch {
    /* yoksay */
  }
}

// ─── v3 "Ekip Konsolu" (2026-09-14 gece, baştan tasarım) ───
// Kart dili = Bütçe/Cari Kasa (beğenilen): koyu kart + üstte ince renk çizgisi + köşede hafif parıltı + gölge. Altın yalnız birincil düğme ve ana başlık.

/** Ajan unvanı — kısa (personel kartı ikinci satırı). */
export const AJAN_UNVAN: Record<string, string> = {
  koordinator: 'Ofis müdürü',
  fatura: 'Fatura işleme',
  'banka-kasa': 'Banka ve kasa',
  beyanname: 'Beyanname ve KDV',
  'bordro-sgk': 'Bordro ve SGK',
  edefter: 'e-Defter',
  'luca-operator': 'Luca ekranı',
  denetci: 'Dönem denetimi',
  analist: 'Mali analiz',
  mevzuat: 'Mevzuat takibi',
  risk: 'Risk puanı',
  musteri: 'Müşteri ilişkileri',
};

/** Ajan tam adı (kadro adı yoksa kısa ad). */
export function ajanTamAd(id: string, ad?: string): string {
  if (id === 'siz') return 'Muzaffer Bey';
  return ad || ajanKisaAd(id);
}

function argMetni(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(argMetni).filter(Boolean).join(', ');
  return '';
}

/**
 * Araç çağrısı → insan dili adım açıklaması. Ham JSON gösterilmez; yalnız anlamlı alanlar (mükellef, dönem, arama, sayı).
 * Ör: list_taxpayers {search:'Öz Ela'} → "Mükellef listesi · 'Öz Ela' arandı"; ekip_ajan_baslat {ajanId:'beyanname', gorev} → "Beyanname Uzmanı'na verildi · <görev ilk 70>".
 */
export function adimAciklamasi(name: string, args: any, mukellefAd?: (id?: string | null) => string | undefined, ajanAd?: (id: string) => string): { baslik: string; ayrinti: string } {
  const a = args && typeof args === 'object' ? args : {};
  const parcalar: string[] = [];
  if (name === 'ekip_ajan_baslat') {
    const hedef = ajanAd ? ajanAd(String(a.ajanId || '')) : String(a.ajanId || '');
    const gorev = String(a.gorev || '').split('\n')[0].trim();
    return { baslik: `${hedef || 'Personel'}’e verildi`, ayrinti: gorev.length > 90 ? `${gorev.slice(0, 89)}…` : gorev };
  }
  if (name === 'create_pending_action') {
    const baslik = String(a.title || a.baslik || '').trim();
    const tur = String(a.tur || '').toLowerCase();
    const atama = /^İŞ ATAMASI/i.test(baslik);
    const turAd = atama ? 'Atama kaydı düşüldü' : tur === 'istek' ? 'Sizden istenen' : tur === 'onay' ? 'Onayınıza sunuldu' : 'Not düşüldü';
    const govde = atama ? baslik.replace(/^İŞ ATAMASI\s*(?:→|->)\s*/i, '') : baslik;
    return { baslik: turAd, ayrinti: govde.length > 90 ? `${govde.slice(0, 89)}…` : govde };
  }
  const mukellef = a.taxpayerId && mukellefAd ? mukellefAd(String(a.taxpayerId)) : undefined;
  if (mukellef) parcalar.push(mukellef);
  const arama = argMetni(a.search ?? a.query ?? a.q);
  if (arama) parcalar.push(`'${arama.length > 40 ? `${arama.slice(0, 39)}…` : arama}' arandı`);
  const donem = argMetni(a.donem ?? a.period ?? a.ay ?? a.donemler);
  if (donem) parcalar.push(/^\d{4}-\d{2}$/.test(donem) ? donemEtiketi(donem) : donem);
  if (a.year && a.month) parcalar.push(donemEtiketi(`${a.year}-${String(a.month).padStart(2, '0')}`));
  if (a.limit && !a.taxpayerId && !a.sessionId) parcalar.push(`en çok ${a.limit}`);
  if (a.previewId) parcalar.push(`#${a.previewId}`);
  return { baslik: aracAdi(name), ayrinti: parcalar.join(' · ') };
}

/** Rapor bölümleri — kadro şablonu (Yaptığım iş / Baktığım kaynaklar / Bulgular / Onayınızı bekleyen / Sizden istenen / Kime döndü / Öğrendiklerim / Emin değilim). */
export interface RaporBolumu {
  anahtar: 'yaptigim' | 'kaynaklar' | 'bulgular' | 'onay' | 'istek' | 'kimde' | 'ogrendim' | 'emin' | 'devir' | 'diger';
  baslik: string;
  satirlar: string[];
}

const BOLUM_KALIPLARI: Array<{ re: RegExp; anahtar: RaporBolumu['anahtar']; baslik: string }> = [
  { re: /^\s*[*_#\-•\d.)\s]*yapt[ıi]ğ[ıi]m i[şs]\s*[*_]*\s*:/i, anahtar: 'yaptigim', baslik: 'Yaptığı iş' },
  { re: /^\s*[*_#\-•\d.)\s]*bakt[ıi]ğ[ıi]m kaynaklar\s*[*_]*\s*:/i, anahtar: 'kaynaklar', baslik: 'Baktığı kaynaklar' },
  { re: /^\s*[*_#\-•\d.)\s]*bulgular\s*[*_]*\s*:/i, anahtar: 'bulgular', baslik: 'Bulgular' },
  { re: /^\s*[*_#\-•\d.)\s]*onay[ıi]n[ıi]z[ıi] bekleyen\s*[*_]*\s*:/i, anahtar: 'onay', baslik: 'Onayınızı bekleyen' },
  { re: /^\s*[*_#\-•\d.)\s]*sizden istenen\s*[*_]*\s*:/i, anahtar: 'istek', baslik: 'Sizden istenen' },
  { re: /^\s*[*_#\-•\d.)\s]*kime d[öo]nd[üu]\s*[*_]*\s*:/i, anahtar: 'kimde', baslik: 'Kime döndü' },
  { re: /^\s*[*_#\-•\d.)\s]*(öğrendiklerim|ogrendiklerim|öğrendim|ogrendim)\s*[*_]*\s*:/i, anahtar: 'ogrendim', baslik: 'Öğrendikleri' },
  { re: /^\s*[*_#\-•\d.)\s]*emin de[ğg]ilim\s*[*_]*\s*:/i, anahtar: 'emin', baslik: 'Emin olmadığı' },
  { re: /^\s*[*_#\-•\d.)\s]*dev[İi]r\s*[*_]*\s*:/i, anahtar: 'devir', baslik: 'Devir' },
];

function temizSatir(s: string): string {
  return s.replace(/\*\*|__|`/g, '').replace(/^\s*[-•*]\s+/, '').trim();
}

/**
 * Raporu bölümlere ayırır. Bölüm başlığından ÖNCE gelen süreç cümleleri ("Şimdi çekiyorum…") atılır (ilk başlık varsa).
 * Hiç başlık yoksa tek "Rapor" bölümü döner. "yok" satırları bölümde tutulur (arayüz "yok" gösterir).
 */
export function raporBolumleri(rapor: string): RaporBolumu[] {
  const satirlar = String(rapor || '').replace(/\r/g, '').split('\n');
  const bolumler: RaporBolumu[] = [];
  let aktif: RaporBolumu | null = null;
  let baslikGoruldu = false;
  const onceki: string[] = [];
  for (const ham of satirlar) {
    const eslesen = BOLUM_KALIPLARI.find((k) => k.re.test(ham));
    if (eslesen) {
      baslikGoruldu = true;
      const govde = temizSatir(ham.replace(eslesen.re, ''));
      aktif = bolumler.find((b) => b.anahtar === eslesen.anahtar) || null;
      if (!aktif) {
        aktif = { anahtar: eslesen.anahtar, baslik: eslesen.baslik, satirlar: [] };
        bolumler.push(aktif);
      }
      if (govde) aktif.satirlar.push(govde);
      continue;
    }
    const t = temizSatir(ham);
    if (!t) continue;
    if (aktif) aktif.satirlar.push(t);
    else onceki.push(t);
  }
  if (!baslikGoruldu) return onceki.length ? [{ anahtar: 'diger', baslik: 'Rapor', satirlar: onceki }] : [];
  return bolumler;
}

/** Bölüm satırı "yok" mu (yok / yok. / — / -). */
export function yokMu(s: string): boolean {
  return /^(yok|yok\.|—|-|–)$/i.test(s.trim()) || /^yok\s*[(:—-]/i.test(s.trim());
}

/** Görev metninden kısa konu: "SORU/KOMUT:" satırı varsa o; yoksa ilk dolu satır; `tavan` karakterde kırpılır. */
export function konuKisalt(gorev: string, tavan = 90): string {
  const metin = String(gorev || '');
  const soru = metin.match(/^\s*SORU\/KOMUT\s*:\s*(.+)$/im);
  let s = soru ? soru[1].trim() : metin.split(/\r?\n/).map((x) => x.trim()).find((x) => x.length > 0) || '';
  s = s.replace(/^\s*[*_`#>\-•]+/, '').replace(/\*\*|`/g, '').trim();
  return s.length > tavan ? `${s.slice(0, tavan - 1).trimEnd()}…` : s;
}
