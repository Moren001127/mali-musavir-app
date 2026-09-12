import { OPERATOR_MODELLERI } from '../calisan/luca-operator.service';

/**
 * EKİP — AJAN TANIMLARI (PLAN/13-AJAN-KADROSU.md §3)
 *
 * 13 ajan; id'ler SABİTTİR (iş dosyası, hafıza ve kimlik klasörü bu id'ye bağlıdır).
 * Araçlar arac-defteri.ts'teki adla seçilir; kademe defterden gelir, burada tekrar yazılmaz.
 * Kimlik klasörü: apps/api/kadro/<id>/ (kimlik.md, kurallar.md) + apps/api/kadro/00_ORTAK_KURALLAR.md
 * — başka bir ajan yazar; runner dosya yoksa boş geçer.
 */

export type AjanModeli = 'opus' | 'sonnet' | 'haiku';

export type AjanId =
  | 'koordinator'
  | 'evrak'
  | 'fatura'
  | 'banka-kasa'
  | 'beyanname'
  | 'bordro-sgk'
  | 'edefter'
  | 'luca-operator'
  | 'denetci'
  | 'analist'
  | 'mevzuat'
  | 'risk'
  | 'musteri';

export interface AjanTanimi {
  id: AjanId;
  ad: string;
  unvan: string;
  aciklama: string;
  model: AjanModeli;
  /** Defterdeki araç adları. */
  araclar: string[];
  /** Sahip onayı gereken noktalar (metin — kimlik dosyası ve prompt için). */
  onayNoktalari: string[];
  /** Ne zaman çalışır (cron/olay/sahip komutu). */
  tetikler: string[];
  /** Kimlik dosyalarının klasörü (repo köküne göre). */
  kimlikKlasoru: string;
}

/** Model kısa adı → gerçek model kimliği (luca-operator.service.ts sabitleri). */
export const MODEL_KIMLIKLERI: Record<AjanModeli, string> = {
  opus: OPERATOR_MODELLERI.opus,
  sonnet: OPERATOR_MODELLERI.sonnet,
  haiku: OPERATOR_MODELLERI.haiku,
};

const KADRO_KOKU = 'apps/api/kadro';
const klasor = (id: AjanId) => `${KADRO_KOKU}/${id}`;

// Ortak "oku" paketleri — tekrar yazmamak için.
const MUKELLEF_OKU = ['list_taxpayers', 'get_taxpayer', 'search_all', 'get_taxpayer_work_status', 'list_taxpayers_monthly_status'];
const HAFIZA = ['search_ai_memory', 'save_ai_memory', 'get_firma_hafizasi', 'get_accounting_reference'];
const LUCA_OKU = ['luca_ekran_oku', 'luca_rapor_oku', 'luca_menu_ara', 'luca_menu_git', 'luca_beceri_listele', 'luca_beceri_getir', 'luca_kural_listele'];
const LUCA_YAZ = ['luca_yaz', 'luca_sec', 'luca_tikla', 'luca_beceri_kaydet'];
const MALI_OKU = ['list_mizan_periods', 'get_mizan', 'get_gelir_tablosu', 'get_bilanco', 'compare_periods', 'calculate_financial_ratios'];
const EKIP_OKU = ['ekip_isler', 'ekip_pano', 'ekip_onaylar'];
/** Yalnız koordinatör: sahibin açık sözüyle onay yürütme / reddetme. */
const EKIP_ONAY = ['ekip_onayla', 'ekip_reddet'];
const ONAY = ['preview_agent_command'];

export const AJAN_TANIMLARI: AjanTanimi[] = [
  {
    id: 'koordinator',
    ad: 'Koordinatör',
    unvan: 'Ofis Müdürü',
    aciklama:
      'Ofis takvimini bilir (KDV, muhtasar, geçici vergi, SGK, Ba-Bs, e-defter, yıllık). Mükellef × dönem × aşama panosunu tutar, ' +
      'işi dağıtır, takılanı sahibe getirir, sabah özetini verir. Sesli muhatap budur.',
    model: 'sonnet',
    araclar: [
      ...MUKELLEF_OKU, ...EKIP_OKU,
      ...EKIP_ONAY,
      'get_operation_briefing', 'get_tax_calendar', 'get_beyanname_readiness_summary', 'get_collection_risk_summary',
      'get_gundem', 'list_pending_decisions', 'list_tasks', 'get_agent_status', 'get_system_health', 'get_ai_cost_summary',
      'list_beyan_kayitlari', 'get_beyan_ozet', 'get_kdv1_on_hazirlik', 'get_luca_agent_jobs', 'get_mihsap_agent_jobs', 'get_portal_capability_map',
      'search_ai_memory', 'save_ai_memory', ...ONAY, 'create_pending_action',
    ],
    onayNoktalari: ['Sahibe giden özet dışında dışarıya mesaj', 'Bir ajanı canlı (kuru test dışı) çalıştırma'],
    tetikler: ['cron 08:30 (EKIP_SABAH_OZETI=on)', 'olay', 'sahip komutu (portal/ses)'],
    kimlikKlasoru: klasor('koordinator'),
  },
  {
    id: 'evrak',
    ad: 'Evrak Sorumlusu',
    unvan: 'Evrak Takip',
    aciklama: 'Belge ister, geleni kaydeder, eksiği takip eder, sahibe eksik listesi çıkarır.',
    model: 'sonnet',
    araclar: [
      ...MUKELLEF_OKU, 'list_documents', 'list_fatura_merkezi', 'get_tax_calendar', 'list_pending_decisions', 'list_tasks',
      'search_ai_memory', 'save_ai_memory', 'set_monthly_status', 'create_pending_action',
      'send_whatsapp_template', 'send_whatsapp_freeform', 'send_sms', 'send_email', ...ONAY,
    ],
    onayNoktalari: ['Mükellefe mesaj (evrak talebi/hatırlatma)'],
    tetikler: ['ay başı evrak taraması', 'belge yüklendi olayı', 'koordinatör'],
    kimlikKlasoru: klasor('evrak'),
  },
  {
    id: 'fatura',
    ad: 'Fatura Muhasebecisi',
    unvan: 'Fatura İşleme',
    aciklama: "Entegratörden çeker, okur, hesap eşleştirir, Luca'ya fiş atar, şüpheliyi ayırır.",
    model: 'opus',
    araclar: [
      ...MUKELLEF_OKU, ...HAFIZA, 'list_invoices', 'list_fatura_merkezi', 'list_earsiv_invoices', 'get_kdv_summary',
      'fetch_invoices_for_period', 'extract_invoice_fields', 'ocr_pdf', 'classify_with_claude',
      'generate_fis_word_from_invoices', 'post_to_luca', ...LUCA_OKU, ...LUCA_YAZ, 'create_pending_action', ...ONAY,
    ],
    onayNoktalari: ["Luca'ya fiş kaydı (kuru test → sahip onayı → canlı)", 'Şüpheli fatura kararı'],
    tetikler: ['evrak yüklendi', 'entegratör çekimi bitti', 'koordinatör'],
    kimlikKlasoru: klasor('fatura'),
  },
  {
    id: 'banka-kasa',
    ad: 'Banka/Kasa Sorumlusu',
    unvan: 'Banka ve Cari Takip',
    aciklama: 'Banka hareketi ↔ fatura eşleştirme, kasa/cari takibi, tahsilat hatırlatma.',
    model: 'sonnet',
    araclar: [
      ...MUKELLEF_OKU, 'get_bank_status', 'get_cari_hareketler', 'list_invoices', 'get_collection_risk_summary', 'list_tax_payable',
      'search_ai_memory', 'save_ai_memory', 'create_pending_action', 'send_whatsapp_template', 'send_whatsapp_freeform', 'send_sms', ...ONAY,
    ],
    onayNoktalari: ['Mükellefe tahsilat/mutabakat mesajı'],
    tetikler: ['banka ekstresi geldi', 'ay sonu', 'koordinatör'],
    kimlikKlasoru: klasor('banka-kasa'),
  },
  {
    id: 'beyanname',
    ad: 'KDV/Beyanname Uzmanı',
    unvan: 'Beyanname Hazırlık',
    aciklama:
      'KDV Kontrol → hata yoksa Luca tahakkuk fişi → beyanname hazır → sahibe sunar. Muhtasar, geçici vergi, yıllık, Ba-Bs aynı kalıpla. ' +
      'GİB gönderimi ASLA yapmaz.',
    model: 'opus',
    araclar: [
      ...MUKELLEF_OKU, ...HAFIZA, ...MALI_OKU, 'get_kdv_summary', 'get_kdv1_on_hazirlik', 'list_tax_payable', 'list_beyan_kayitlari', 'get_beyan_ozet',
      'get_beyanname_config', 'get_beyanname_readiness_summary', 'get_tax_calendar', 'fetch_kdv_from_luca', 'get_isletme_hesap_ozeti',
      ...LUCA_OKU, ...LUCA_YAZ, 'luca_kural_kaydet', 'set_monthly_status', 'create_pending_action', ...ONAY,
    ],
    onayNoktalari: ["Luca'da tahakkuk fişi (kuru test → onay)", 'Beyanname "hazır" işareti', 'GİB gönderimi: ajan ASLA — yalnız sahip'],
    tetikler: ['KDV Kontrol bitti', 'beyanname takvimi (son gün −5)', 'koordinatör'],
    kimlikKlasoru: klasor('beyanname'),
  },
  {
    id: 'bordro-sgk',
    ad: 'Bordro/SGK Sorumlusu',
    unvan: 'Bordro ve SGK',
    aciklama: 'İşe giriş/çıkış, bordro, SGK hizmet/tahakkuk, e-bildirge kontrolü. Bildirge gönderimi yapmaz.',
    model: 'sonnet',
    araclar: [
      ...MUKELLEF_OKU, 'get_payroll_summary', 'list_sgk_declarations', 'get_tax_calendar', 'list_documents',
      'search_ai_memory', 'save_ai_memory', ...LUCA_OKU, ...LUCA_YAZ, 'create_pending_action', ...ONAY,
    ],
    onayNoktalari: ['Bordro hesabı sonucu', 'SGK bildirge gönderimi: ajan ASLA — yalnız sahip'],
    tetikler: ['ay sonu bordro', 'işe giriş/çıkış belgesi', 'koordinatör'],
    kimlikKlasoru: klasor('bordro-sgk'),
  },
  {
    id: 'edefter',
    ad: 'e-Defter/Yıl Sonu Sorumlusu',
    unvan: 'e-Defter ve Kapanış',
    aciklama: 'e-Defter kontrol kuralları (kasa/stok/banka negatif, mizan↔fiş), berat takvimi, yıl sonu kapanış hazırlığı.',
    model: 'opus',
    araclar: [
      ...MUKELLEF_OKU, ...HAFIZA, ...MALI_OKU, 'list_edefter_sessions', 'get_tax_calendar', ...LUCA_OKU, ...LUCA_YAZ,
      'create_pending_action', ...ONAY,
    ],
    onayNoktalari: ['Düzeltme fişi önerisi', 'Berat yükleme: ajan ASLA — yalnız sahip'],
    tetikler: ['berat takvimi', 'geçici vergi öncesi', 'yıl sonu', 'koordinatör'],
    kimlikKlasoru: klasor('edefter'),
  },
  {
    id: 'luca-operator',
    ad: 'Luca Operatörü',
    unvan: "Ekibin Luca'daki Eli",
    aciklama: "Diğer ajanların Luca'daki eli: ekran okur, alan doldurur, menü açar, beceri öğrenir. VPS'te 7/24 (Faz B).",
    model: 'sonnet',
    araclar: [
      ...LUCA_OKU, ...LUCA_YAZ, 'luca_menu_haritasi_cikar', 'luca_kural_kaydet', 'luca_kural_sil', 'luca_mizan_cek',
      'list_taxpayers', 'get_taxpayer', 'get_luca_agent_jobs', 'get_agent_status', 'search_ai_memory',
    ],
    onayNoktalari: ['Kaydet / Gönder / Tahakkuk / İmzala / Sil düğmeleri (confirmed=true yalnız sahip onayıyla)'],
    tetikler: ['diğer ajanların isteği', 'sahip komutu'],
    kimlikKlasoru: klasor('luca-operator'),
  },
  {
    id: 'denetci',
    ad: 'Dönem Denetçisi',
    unvan: 'Dönem Denetimi',
    aciklama:
      'Geçici vergi / yıl sonu öncesi mizan + fiş listesi: kasa negatif, 191-391 tutarsızlık, tekrarlı fiş, eksik ay, ters bakiye, KDV aritmetik. ' +
      'Uyarı raporu üretir.',
    model: 'opus',
    araclar: [
      ...MUKELLEF_OKU, ...HAFIZA, ...MALI_OKU, 'get_kdv_summary', 'get_kdv1_on_hazirlik', 'list_edefter_sessions', 'list_beyan_kayitlari', 'get_beyan_ozet',
      ...LUCA_OKU, 'create_pending_action', ...ONAY,
    ],
    onayNoktalari: ['Sahibe uyarı raporu (portal içi — serbest)', 'Mükellefe iletim: onaylı'],
    tetikler: ['geçici vergi öncesi (dönem son günü −10)', 'yıl sonu', 'koordinatör'],
    kimlikKlasoru: klasor('denetci'),
  },
  {
    id: 'analist',
    ad: 'Mali Analist',
    unvan: 'Dönemlik Yorum',
    aciklama:
      'Her mükellef için dönemlik yorum: ciro/kâr eğilimi, vergi yükü tahmini, nakit akışı, sektör karşılaştırması, geçici vergi öngörüsü. ' +
      'Rapor "öneri" etiketiyle; sahip onayı olmadan mükellefe gitmez.',
    model: 'opus',
    araclar: [
      ...MUKELLEF_OKU, ...HAFIZA, ...MALI_OKU, 'get_kdv_summary', 'list_tax_payable', 'get_cari_hareketler', 'get_bank_status',
      'get_isletme_hesap_ozeti', 'research_official_sources', 'summarize_with_claude',
      // kimlik.md: get_gundem (TÜFE/kur → gerçek büyüme düzeltmesi) + vergi takvimi (ödeme vadesi). Pilot 3: kapalı olduğu için enflasyon düzeltmesi yapılamadı.
      'get_gundem', 'get_tax_calendar',
      // Gönderim araçları YOK: kimlik.md "Mükellefle doğrudan konuşmam; onaylı özeti Müşteri İlişkileri iletir".
      ...ONAY,
    ],
    onayNoktalari: ['Raporun mükellefe gönderimi (Müşteri İlişkileri üzerinden, sahip onayıyla)'],
    tetikler: ['dönem kapanışı', 'geçici vergi sonrası', 'sahip komutu'],
    kimlikKlasoru: klasor('analist'),
  },
  {
    id: 'mevzuat',
    ad: 'Mevzuat Takipçisi',
    unvan: 'Mevzuat İzleme',
    aciklama: 'Resmî Gazete / GİB duyurusu → özet → hangi mükellefi ilgilendirir. Sahibe özet.',
    model: 'sonnet',
    araclar: [
      'list_taxpayers', 'get_taxpayer', 'search_all', 'check_official_gazette', 'research_official_sources', 'http_get',
      'summarize_with_claude', 'search_ai_memory', 'save_ai_memory', 'create_pending_action',
    ],
    onayNoktalari: ['Mükellefe mevzuat bildirimi'],
    tetikler: ['her sabah 07:00 (Resmî Gazete)', 'sahip komutu'],
    kimlikKlasoru: klasor('mevzuat'),
  },
  {
    id: 'risk',
    ad: 'Risk Gözcüsü',
    unvan: 'İnceleme Riski',
    aciklama: 'Vergi incelemesi riski: KDV yüklenim oranı, sürekli devreden, kasa şişkinliği, ortaklar cari, nakit satış oranı. Mükellef bazlı risk puanı.',
    model: 'sonnet',
    araclar: [
      ...MUKELLEF_OKU, ...HAFIZA, ...MALI_OKU, 'get_kdv_summary', 'list_beyan_kayitlari', 'get_beyan_ozet', 'get_cari_hareketler',
      'get_collection_risk_summary', 'create_pending_action',
    ],
    onayNoktalari: ['Risk puanının mükellefe iletimi'],
    tetikler: ['aylık (beyanname sonrası)', 'sahip komutu'],
    kimlikKlasoru: klasor('risk'),
  },
  {
    id: 'musteri',
    ad: 'Müşteri İlişkileri',
    unvan: 'Mükellef İletişimi',
    aciklama: 'Mükellef soru-cevap, hatırlatma, tahsilat (mevcut WhatsApp botu genişler). Toplu mesaj onaylı.',
    model: 'sonnet',
    araclar: [
      ...MUKELLEF_OKU, 'get_my_profile', 'get_my_work_status', 'get_my_documents', 'get_my_open_tasks', 'get_my_recent_messages',
      'get_my_kdv', 'get_my_invoices', 'get_my_beyanname', 'get_my_balance', 'get_my_tebligat', 'get_my_sgk', 'get_my_vergi_takvimi',
      'list_etebligat', 'get_collection_risk_summary', 'search_ai_memory', 'save_ai_memory',
      'send_whatsapp_template', 'send_whatsapp_freeform', 'send_sms', 'send_email', 'create_pending_action', ...ONAY,
    ],
    onayNoktalari: ['Toplu mesaj', 'Mükellefe tek mesaj (kuru testte gitmez)'],
    tetikler: ['gelen WhatsApp mesajı', 'tahsilat takvimi', 'koordinatör'],
    kimlikKlasoru: klasor('musteri'),
  },
];

const AJAN_HARITASI: Map<string, AjanTanimi> = new Map(AJAN_TANIMLARI.map((a) => [a.id, a]));

export function ajanBul(id: string): AjanTanimi | null {
  return AJAN_HARITASI.get(String(id || '').trim()) || null;
}

export const ORTAK_KURALLAR_DOSYASI = `${KADRO_KOKU}/00_ORTAK_KURALLAR.md`;
