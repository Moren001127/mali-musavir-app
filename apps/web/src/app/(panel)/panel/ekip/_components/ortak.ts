/** Moren Ekip — ortak renkler ve yardımcılar. Modül kimliği: gök mavisi; altın YALNIZ 3 yerde (§8). */
import type { CSSProperties } from 'react';
import type { AsamaAdi, AsamaDurumu, IsDosyasi } from '@/lib/ekip';

export const EKIP_ACCENT = '#7dd3fc';

/** Renk envanteri (§8) — başka yerde yeni renk uydurma. */
export const RENK = {
  metin: '#fafaf9',
  ikincil: 'rgba(250,250,249,0.55)',
  sonuk: 'rgba(250,250,249,0.35)',
  altin: '#fbbf24', // yalnız: Onay kuyruğu şeridi/başlığı + Sabah bandı "bekleyen onay" sayacı + Koordinatör ikon halkası
  turuncu: '#fdba74', // onay bekliyor adımı, ajan başına onay rozeti, süre azaldı, uyarı satırı
  kirmizi: '#f87171', // hata, CANLI, Max bağlı değil, Operatör kapalı, Bağlantıyı kes
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
  if (d === 'tamam') return '#4ade80';
  if (d === 'eksik') return '#fb923c';
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

/** Kaynak → etiket (portal / 🎤 ses / ⏰ cron / KO koordinatör). */
export function kaynakEtiketi(k?: string | null): { ad: string; ikon: string } {
  switch (k) {
    case 'ses':
      return { ad: 'ses', ikon: '🎤' };
    case 'cron':
      return { ad: 'cron', ikon: '⏰' };
    case 'koordinator':
      return { ad: 'koordinatör', ikon: 'KO' };
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
  // resmi (yalnız sahip)
  gib_beyanname_gonder: 'GİB beyanname gönderimi (yalnız sahip)',
  sgk_bildirge_gonder: 'SGK e-bildirge gönderimi (yalnız sahip)',
  edefter_berat_yukle: 'e-Defter berat yükleme (yalnız sahip)',
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
  if (!t('evrak')) return { metin: 'Evrak bekleniyor', ajanId: 'evrak', sablonId: 'eksik-evrak', sira: 1 };
  if (!t('isleme')) return { metin: 'Faturalar işlenecek', ajanId: 'fatura', sablonId: 'fatura-isle', sira: 2 };
  if (!t('kontrol')) return { metin: 'KDV kontrolü', ajanId: 'beyanname', sablonId: 'kdv-kontrol', sira: 3 };
  if (!t('beyanname')) return { metin: 'Beyanname hazırlanacak', ajanId: 'beyanname', sablonId: 'kdv-kontrol', sira: 4 };
  if (!t('gonderim')) return { metin: 'Hazır — GİB gönderimi sende', sira: 5 };
  return { metin: 'Tamam ✓', sira: 6 };
}

export interface Sablon {
  id: string;
  ad: string;
  ajanId: string;
  mukellefIster: boolean;
  donemIster: boolean;
  gorev: string;
}

/** Hazır görev şablonları — doğal dil, araç adı geçmez; {mükellef}/{dönem} yer tutucu. */
export const SABLONLAR: Sablon[] = [
  { id: 'sabah-ozeti', ad: 'Sabah özeti', ajanId: 'koordinator', mukellefIster: false, donemIster: false, gorev: 'Bugünün ofis özetini çıkar: durum, riskli/acil, yaklaşan süreler, ekip dün ne yaptı, bugün öncelik. Mesaj gönderme.' },
  { id: 'haftalik-sureler', ad: 'Haftalık süreler', ajanId: 'koordinator', mukellefIster: false, donemIster: false, gorev: 'Bu hafta ve gelecek hafta vadesi gelen beyanname/bildirge/ödemeleri mükellef bazında listele.' },
  { id: 'kayit-yok', ad: 'Kayıt yok — araştır', ajanId: 'koordinator', mukellefIster: true, donemIster: true, gorev: '{mükellef} için {dönem} aylık takip kaydı yok; neden yok araştır, açılması gerekiyorsa bana sun.' },
  { id: 'eksik-evrak', ad: 'Eksik evrak', ajanId: 'evrak', mukellefIster: false, donemIster: true, gorev: '{dönem} evrakı gelmeyen mükellefleri listele; {mükellef} seçiliyse yalnız onun eksik belgelerini çıkar ve hatırlatma taslağı hazırla (gönderme).' },
  { id: 'hatirlatma-metni', ad: 'Hatırlatma metni', ajanId: 'evrak', mukellefIster: true, donemIster: false, gorev: '{mükellef} için eksik evrak hatırlatma metni hazırla; gönderme, bana sun.' },
  { id: 'fatura-isle', ad: 'Faturaları işle', ajanId: 'fatura', mukellefIster: true, donemIster: true, gorev: '{mükellef} için {dönem} faturalarını oku, hesap eşleştir, Luca fiş taslağı hazırla (kuru test). Şüpheli/uyuşmayan faturaları ayrı listele.' },
  { id: 'supheli', ad: 'Şüpheli faturalar', ajanId: 'fatura', mukellefIster: true, donemIster: true, gorev: '{mükellef} {dönem}: içerik-hesap uyuşmayan, mükerrer ya da tutarı şüpheli faturaları ayır.' },
  { id: 'vadesi-gecmis', ad: 'Vadesi geçmiş', ajanId: 'banka-kasa', mukellefIster: false, donemIster: false, gorev: 'Vadesi geçmiş tahsilatları mükellef bazında listele; {mükellef} seçiliyse ekstre özetini çıkar.' },
  { id: 'tahsilat-taslak', ad: 'Tahsilat taslağı', ajanId: 'banka-kasa', mukellefIster: true, donemIster: false, gorev: '{mükellef} için nazik tahsilat hatırlatma taslağı hazırla (gönderme).' },
  { id: 'kdv-kontrol', ad: 'KDV kontrol', ajanId: 'beyanname', mukellefIster: true, donemIster: true, gorev: '{mükellef} için {dönem} KDV Kontrol sonucunu oku; hata varsa satır satır listele; hata yoksa Luca tahakkuk fişini hazırla (kuru test). Beyannameyi hazır işaretleme, önce bana sun.' },
  { id: 'hazir-isaretle', ad: 'Hazır işaretlenebilecekler', ajanId: 'beyanname', mukellefIster: false, donemIster: true, gorev: '{dönem} KDV kontrolü biten ve hatasız olan mükellefleri listele; hazır işaretlenebilecekleri ayrı göster.' },
  { id: 'donem-denetim', ad: 'Dönem denetimi', ajanId: 'denetci', mukellefIster: true, donemIster: true, gorev: '{mükellef} {dönem} mizan + fiş listesi: kasa negatif, 191-391 tutarsızlık, tekrarlı fiş, eksik ay, ters bakiye, KDV aritmetik. Uyarı raporu çıkar, mükellefe gönderme.' },
  { id: 'resmi-gazete', ad: 'Resmî Gazete', ajanId: 'mevzuat', mukellefIster: false, donemIster: false, gorev: "Bugünkü Resmî Gazete'yi tara; ofisi ve mükellefleri ilgilendiren vergi/SGK değişikliklerini 3 maddede özetle." },
  { id: 'risk-guncelle', ad: 'Risk puanları', ajanId: 'risk', mukellefIster: false, donemIster: false, gorev: "Mükellef risk puanlarını güncelle; en riskli 5'i nedenleriyle listele." },
  { id: 'cevapsiz', ad: 'Cevapsız mesajlar', ajanId: 'musteri', mukellefIster: false, donemIster: false, gorev: 'Cevapsız kalan mükellef mesajlarını listele; her biri için cevap taslağı hazırla (gönderme).' },
  { id: 'donem-yorum', ad: 'Mali yorum', ajanId: 'analist', mukellefIster: true, donemIster: true, gorev: '{mükellef} için {dönem} mali yorum: ciro/kâr eğilimi, vergi yükü tahmini, nakit akışı, geçici vergi öngörüsü. ÖNERİ etiketiyle, mükellefe gönderme.' },
  { id: 'bordro-kontrol', ad: 'Bordro/SGK kontrol', ajanId: 'bordro-sgk', mukellefIster: false, donemIster: true, gorev: '{dönem} bordro/SGK kontrolü: eksik bildirge, işe giriş/çıkış, prim tutarsızlığı; {mükellef} seçiliyse yalnız onun.' },
  { id: 'berat-negatif', ad: 'Berat + negatif tarama', ajanId: 'edefter', mukellefIster: true, donemIster: false, gorev: 'Berat takvimi + {mükellef} için negatif kasa/stok/banka taraması.' },
  { id: 'luca-kontrol', ad: 'Luca oturum kontrolü', ajanId: 'luca-operator', mukellefIster: false, donemIster: false, gorev: 'Luca oturumunu ve menüyü kontrol et; oturum düşmüşse bildir.' },
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
      return { ad: 'Çalışıyor', renk: EKIP_ACCENT };
    case 'done':
      return { ad: 'Bitti', renk: RENK.yesil };
    case 'failed':
      return { ad: 'Hata', renk: RENK.kirmizi };
    default:
      return { ad: 'Bekliyor', renk: RENK.gri };
  }
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
