import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ToolExecutorService } from './tool-executor.service';
import { MOREN_AI_TOOLS } from './tools';
import { runMaxAgent, type AgentToolDef } from '../common/max-agent-runner';
import { buildSystemPrompt } from './system-prompt';
import { buildOwnerStatusReply } from './monthly-status.shared';
import { computeCostUsd, computeRealtimeCostUsd, canSpendOnApi, logAiUsage } from '../common/ai-usage-logger';
import { claudeTextViaMax, isMaxAvailable, MAX_MODEL_CHEAP } from '../common/max-inference';
import { sablonForTool, sablonZatenVar } from './whatsapp-sablon';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
// Hibrit model secimi — maliyet/kalite dengesi:
//   taxpayer-readonly → her zaman Haiku 4.5 (kisa musteri cevabi, ucuz)
//   owner / undefined → soru tipine gore:
//     - Veri/data sorgusu, kisa sohbet → Haiku 4.5 (ucuz, hizli)
//     - Mevzuat/kanun/analiz/yorum/oneri → Sonnet 4.6 (derin)
// body.model verilirse override eder. Brifing/cron'larda explicit Haiku gecirilebilir.
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';        // genel fallback + basit sorular
const DEFAULT_MODEL_OWNER_DEEP = 'claude-sonnet-4-6';     // derin analiz/yorum gerekiyorsa
// MEVZUAT/BILGI sorulari (oran, ceza, sure, kanun maddesi) en dogru cevabi gerektirir
// → Opus 4.8. HEPSI Max aboneliginden (token-basi API DEGIL); Opus sadece Max kotasini
// biraz daha cok kullanir, ekstra para maliyeti yok. Bot eskiden bu sorulari Haiku/Sonnet'te
// birakip celiskili/yanlis mevzuat cevabi veriyordu (canli: SGK suresi "15->30->15 gun").
const DEFAULT_MODEL_LEGISLATION = 'claude-opus-4-8';

/**
 * Mesaj NET bir mevzuat/bilgi sorusu mu? (kanun maddesi, vergi orani, ceza, sure,
 * istisna/muafiyet kurallari) → en guclu model (Opus). Belirli mukellefin VERISINI
 * soran sorular ( "Adem Can'a ne kadar KDV") buraya GIRMEZ; onlar arac/veri yoluyla
 * Sonnet/Haiku'da kalir. Ayirt edici: genel kural/oran/sure bilgisi mi, yoksa tekil
 * mukellef-verisi mi.
 */
export function needsLegislationModel(userMessage: string): boolean {
  if (!userMessage) return false;
  const text = String(userMessage)
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  // Belirli mukellef-verisi sinyali varsa mevzuat sayma (veri sorusu → arac yolu).
  const looksLikePersonalData = /\b(benim|bizim|firmamiz|sirketimiz)\b/.test(text)
    || /'(n[iı]n|n[uü]n|in|un)\b/.test(userMessage); // "Adem Can'in", "Ozela'nin" gibi iyelik

  // NOT: Türkçe sondan eklemeli olduğu için kök kelimelerde SON \b KULLANMA
  // ("hesaplanır", "tazminatı", "süresinde" eki \b'yi bozar). Yalnız baş \b.
  const legislationPatterns: RegExp[] = [
    // Kanun/mevzuat referansi
    /\b(vuk|gvk|kvk|kdvk|ttk|otv|btmv|6183|5510|6111|6661|7103|7256|213|193|3065)\b/,
    /\b(mevzuat|kanun|yonetmelik|teblig|sirkuler|resmi gazete|madde\s*\d+|m\.\s*\d+)/,
    // Oran / yuzde BILGISI (genel kural)
    /\b(oran|yuzde|%)\w*\s*(kac|nedir|ne\s*kadar|kacti|ne\b)/,
    /\b(kdv|otv|stopaj|tevkifat|damga|gelir vergisi|kurumlar)\s*(vergisi\s*)?oran/,
    // Ceza bilgisi
    /\bceza\w*\s*(ne|kac|nedir|ne\s*kadar|var\s*m[iı])/,
    // Sure/bildirim bilgisi (genel kural)
    /\b(kac\s*gun|kac\s*ay|sure|en\s*gec|ne\s*zaman).{0,50}(bildir|beyan|basvur|itiraz|odeme|veril)/,
    // Calisma hukuku + vergi kavramlari (kök; ek alabilir)
    /\b(istisna|muafiyet|matrah|tevkifat|amortisman|asgari\s*ucret|kidem|ihbar\s*tazminat|tazminat)\b/,
    // "nasil ... / hangi durumda / hangi sart" tipi kural sorulari
    /\b(nasil\s*(hesaplan|beyan|bildir|uygulan)|hangi\s*durumda|hangi\s*sart|sart\w*\s*(ne|mi)|kosul)/,
  ];

  if (looksLikePersonalData) return false;
  return legislationPatterns.some((p) => p.test(text));
}

/**
 * Kullanici mesajinda mali musavir derinligi gerektiren sinyaller var mi?
 * Tek kelimelik veri sorguları (KDV ne kadar, kac mukellef, hangi belge) Haiku'da kalir.
 * Mevzuat/kanun/yorum/oneri/risk sinyalleri Sonnet'i tetikler.
 */
function needsDeepModel(userMessage: string): boolean {
  if (!userMessage) return false;
  const text = String(userMessage)
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  const deepPatterns: RegExp[] = [
    // Mevzuat referansi
    /\b(vuk|gvk|kvk|kdv kanunu|sgk|ttk|btmv|otv|damga|6183|5510|6111|6661|7103|213|193)\b/,
    /\b(mevzuat|kanun|yonetmelik|teblig|sirkuler|resmi gazete|madde\s*\d+|m\.\s*\d+)\b/,
    // Yorum/analiz
    /\b(oner|tavsiye|gorus|fikir|analiz|yorumla|degerlendir|karsilastir|risk|sakinca|usul)\b/,
    /\b(nasil yapmali|ne yapmali|hangi adim|ne olur|nasil hesaplan|hesaplan(?:ir|acak)|formul)\b/,
    /\b(istisna|indirim|matrah|iade(?:de|si|ne|ye)?|tahakkuk\s+(usul|yolu|tarz)|tahsil)\b/,
    // Karmasik kavramlar
    /\b(yillara sari|amortisman|envanter|degerleme|reel|enflasyon|kurumlar gecisi|tasfiye|birlesme|bolunme|nakit akis|finansal kiralama)\b/,
    /\b(muhasebe|tdhp|mizan|yevmiye|defter|e-defter|e defter|donem sonu|donem kapanis|finans|butce|butceleme|nakit akis|rasyo|karlilik|finansman|isletme sermayesi)\b/,
    /\b(sirket yonetimi|is plani|strateji|planlama|kpi|performans|operasyon plani|vergi planlama|sgk tesvik|tesvik analizi)\b/,
    /\b(usulsuzluk|sahte fatura|naylon|incelemeye|denetim|tarhiyat|ihtirazi|yargilama|itiraz|temyiz)\b/,
    // "Ne yaparim / nasil olur" tipi sorular
    /\b(yapmali miyim|edebilir miyim|olabilir mi|gerekiyor mu|sart mi|zorunlu mu|uygun mu|dogru mu)\b/,
    // Calisma hukuku derinligi
    /\b(kidem|ihbar|fesih|haklı sebep|isçi\s+(alacak|hak|ayrilis bildirim)|sgk(\s+ceza|\s+bildirim)|asgari ucret istisna)\b/,
  ];

  return deepPatterns.some((p) => p.test(text));
}

export function pickDefaultModel(toolMode?: string, userMessage?: string, taxpayerText?: string): string {
  // Kişisel sohbet için her zaman Haiku
  if (toolMode === 'none') return DEFAULT_MODEL;
  // Mükellef botu: müşterinin HAM mesajı analiz/mevzuat/hesap derinliği istiyorsa
  // Sonnet (Max aboneliğinden — token ücreti yok), basit sohbet Haiku'da kalır.
  // userMessage burada KULLANILMAZ: bot prompt'u talimat bloğu içerir, hep tetiklerdi.
  if (toolMode === 'taxpayer-readonly') {
    if (taxpayerText && needsLegislationModel(taxpayerText)) return DEFAULT_MODEL_LEGISLATION;
    return taxpayerText && needsDeepModel(taxpayerText) ? DEFAULT_MODEL_OWNER_DEEP : DEFAULT_MODEL;
  }
  // Owner için: mevzuat/bilgi sorusu → Opus, derin analiz → Sonnet, basit → Haiku.
  if (userMessage && needsLegislationModel(userMessage)) return DEFAULT_MODEL_LEGISLATION;
  if (userMessage && needsDeepModel(userMessage)) return DEFAULT_MODEL_OWNER_DEEP;
  return DEFAULT_MODEL;
}
const BRIFING_ALLOWED_ROUTES = [
  '/panel/ajanlar/mihsap',
  '/panel/is-yuku',
  '/panel/gorevler',
  '/panel/beyannameler',
  '/panel/kdv-kontrol',
  '/panel/mukellefler',
  '/panel/ajanlar',
];

const TAX_DEADLINE_RULES: Array<{ day: number | 'last'; tip: string; months?: number[] }> = [
  { day: 10, tip: 'e-Defter berat (gelir vergisi mükellefleri)' },
  { day: 14, tip: 'e-Defter berat (kurumlar/diğer mükellefler)' },
  { day: 17, tip: 'Geçici Vergi', months: [2, 5, 8, 11] },
  { day: 26, tip: 'Muhtasar/Damga' },
  { day: 28, tip: 'KDV' },
  { day: 'last', tip: 'Turizm Payı' },
];

// Sabit resmi tatiller; dini bayramlar yıllara göre değiştiği için burada özellikle
// hard-code edilmez. Bu katman en azından hafta sonu ve sabit tatil kaydırmasını sağlar.
const TR_FIXED_HOLIDAYS = new Set(['01-01', '04-23', '05-01', '05-19', '07-15', '08-30', '10-29']);
const MAX_TOOL_ITERATIONS = 8;              // Tool döngüsünde en fazla 8 tur
const MAX_HISTORY_MESSAGES = Number(process.env.MOREN_AI_HISTORY_LIMIT || 5); // Maliyet kontrolü: son mesaj penceresi (8 → 5, paket A tasarrufu)
const NORMAL_MAX_TOKENS = Number(process.env.MOREN_AI_MAX_TOKENS || 650);
const VOICE_MAX_TOKENS = Number(process.env.MOREN_AI_VOICE_MAX_TOKENS || 260);

const CORE_TOOL_NAMES = [
  'list_taxpayers',
  'get_taxpayer',
  'search_ai_memory',
  'save_ai_memory',
  'get_operation_briefing',
  'get_ai_cost_summary',
  'get_portal_capability_map',
  'get_accounting_reference', // TDHP kod + vergi oranı — uydurmayı keser, her zaman erişilebilir
];

const TAXPAYER_READONLY_TOOL_NAMES = [
  'get_my_profile',
  'get_my_work_status',
  'get_my_documents',
  'get_my_open_tasks',
  'get_my_recent_messages',
  // FAZ 1 — mükellefin kendi finansal verisi (hepsi backend'de aktif mükellefe kilitli)
  'get_my_kdv',
  'get_my_invoices',
  'get_my_beyanname',
  'get_my_balance',
  // GENEL MEVZUAT: mükellef "işe başlama süresi/ceza, KDV oranı, hangi belge" gibi GENEL
  // soru sorarsa resmi kaynaktan cevaplayabilsin. Mükellef verisi DEĞİL, kamuya açık
  // mevzuat; inferMaxToolInput yalnız GERÇEK mevzuat sorusunda çalıştırır (gate'li).
  'research_official_sources',
  'get_accounting_reference', // mükellef de hesap kodu/oran sorabilir — genel bilgi, veri sızıntısı yok
];

const TOOL_GROUPS: Array<{ pattern: RegExp; tools: string[] }> = [
  { pattern: /mizan|hesap kod|gelir tablos|bilanço|bilanco|rasyo|oran|likidite|özkaynak|ozkaynak/i, tools: ['list_mizan_periods', 'get_mizan', 'get_gelir_tablosu', 'get_bilanco', 'compare_periods', 'calculate_financial_ratios'] },
  // TDHP hesap kodu / vergi oranı sorusu → DOĞRULANMIŞ referans (uydurmayı keser).
  { pattern: /hangi hesap|hesap kod|hesap plan|tdhp|\b[1-7]\d\d\b.*hesap|kurumlar.*oran|gecici.*oran|geçici.*oran|tevkifat.*oran|vergi oran/i, tools: ['get_accounting_reference'] },
  { pattern: /muhasebe|tdhp|yevmiye|defter|e-defter|e defter|dönem sonu|donem sonu|dönem kapan|donem kapan|amortisman|envanter|mali müşavirlik|mali musavirlik/i, tools: ['list_mizan_periods', 'get_mizan', 'get_gelir_tablosu', 'get_bilanco', 'compare_periods', 'calculate_financial_ratios', 'get_operation_briefing'] },
  { pattern: /finans|nakit akış|nakit akis|bütçe|butce|kârlılık|karlılık|karlilik|finansman|işletme sermayesi|isletme sermayesi|tahsilat|cari|rasyo|likidite/i, tools: ['get_operation_briefing', 'get_collection_risk_summary', 'list_mizan_periods', 'get_mizan', 'get_gelir_tablosu', 'get_bilanco', 'compare_periods', 'calculate_financial_ratios'] },
  { pattern: /şirket yönetimi|sirket yonetimi|planlama|iş planı|is plani|strateji|performans|kpi|görev|gorev|iş akışı|is akisi|risk yönetimi|risk yonetimi/i, tools: ['get_operation_briefing', 'get_beyanname_readiness_summary', 'get_collection_risk_summary', 'get_agent_status', 'list_taxpayers_monthly_status'] },
  { pattern: /kdv|beyan|muhtasar|muhsgk|kurumlar|damga|tahakkuk|onay no|hattat|verilebil|verilecek|hazir|hazır/i, tools: ['get_kdv_summary', 'list_beyan_kayitlari', 'get_beyanname_config', 'get_beyan_ozet', 'get_beyanname_readiness_summary', 'list_taxpayers_monthly_status', 'get_tax_calendar'] },
  { pattern: /fatura|muhasebeleştir|muhasebelestir|mihsap|tedarikçi|tedarikci|alıcı|alici|firma hafıza|firma hafiza/i, tools: ['list_invoices', 'get_firma_hafizasi', 'get_mihsap_agent_jobs', 'list_pending_decisions'] },
  { pattern: /sgk|bordro|personel|prim|işçi|isci|işveren|isveren/i, tools: ['get_payroll_summary', 'list_sgk_declarations'] },
  { pattern: /evrak|belge|sözleşme|sozlesme|doküman|dokuman/i, tools: ['list_documents', 'get_taxpayer_work_status', 'list_taxpayers_monthly_status'] },
  { pattern: /tahsilat|borç|borc|cari|ödeme|odeme|whatsapp|hatırlatma|hatirlatma|tahsil ettik|ne ödedi|odedi mi/i, tools: ['get_cari_hareketler', 'get_operation_briefing', 'get_collection_risk_summary', 'get_taxpayer_work_status', 'preview_agent_command', 'create_confirmed_agent_command'] },
  { pattern: /banka|iban|ekstre|hesap no|hesap durum|banka hesab/i, tools: ['get_bank_status'] },
  { pattern: /e-?ar[şs]iv|e-?fatura|earsiv|kesti[ğg]i fatura|ham fatura|fatura detay|en b[üu]y[üu]k.*fatura/i, tools: ['list_earsiv_invoices'] },
  { pattern: /görev|gorev|yap[ıi]lacak|to-?do|geciken i[şs]|hat[ıi]rlatma listesi/i, tools: ['list_tasks'] },
  { pattern: /tebligat|e-?tebligat|gib belge|portal belge/i, tools: ['list_etebligat'] },
  { pattern: /i[şs]letme defter|i[şs]letme hesap|2\.?\s*s[ıi]n[ıi]f defter/i, tools: ['get_isletme_hesap_ozeti'] },
  { pattern: /bug[üu]n|acil|öncelik|oncelik|yapmam gereken|neye bak|işler|isler|brifing|briefing|operasyon/i, tools: ['get_operation_briefing', 'get_beyanname_readiness_summary', 'get_collection_risk_summary', 'get_agent_status', 'get_system_health'] },
  { pattern: /sa[gğ]l[ıi]k|sistem durum|sorun var|aksakl[ıi]k|yolunda m|her[ ]?[şs]ey yolunda|alarm|uyar[ıi]|ayakta m|down|cal[ıi][şs][ıi]yor mu|hata var/i, tools: ['get_system_health', 'get_agent_status', 'get_operation_briefing'] },
  { pattern: /ajan|agent|luca|tebligat|otomasyon|komut|çalıştır|calistir|işlem yap|islem yap/i, tools: ['get_agent_status', 'get_luca_agent_jobs', 'get_mihsap_agent_jobs', 'preview_agent_command', 'create_confirmed_agent_command'] },
  { pattern: /başlat|baslat|durdur|iptal|cancel|sonuç|sonuc|hata|log|durum|komut kuyru|devam et|yeniden dene|retry/i, tools: ['get_agent_status', 'get_luca_agent_jobs', 'get_mihsap_agent_jobs', 'preview_agent_command', 'create_confirmed_agent_command', 'get_portal_capability_map', 'get_system_health'] },
  { pattern: /gönder|gonder|yolla|ilet|talep et|iste|evrak iste|evrak talep|belge gönder|belge gonder|pdf gönder|pdf gonder|whatsapp/i, tools: ['list_taxpayers', 'list_documents', 'get_taxpayer_work_status', 'get_operation_briefing', 'preview_agent_command', 'create_confirmed_agent_command', 'get_portal_capability_map'] },
  { pattern: /portal|modül|modul|her alan|her şey|her sey|neler yap|ne yapabil|vakıf|vakif|entegre|entegrasyon/i, tools: ['get_portal_capability_map', 'get_agent_status', 'get_operation_briefing'] },
  { pattern: /araç|arac|plaka|hgs|otoyol|ihlal/i, tools: ['list_araclar_hgs'] },
  { pattern: /vergi|mevzuat|kanun|ceza|had|süre|sure|oran|vuk|kvk|gvk|sgk|resmi gazete|gib|gelir idaresi|işi bırak|isi birak/i, tools: ['research_official_sources'] },
  { pattern: /herkes|tüm|tum|listele|kimler|kaç tane|kac tane|özet|ozet|durum/i, tools: ['list_taxpayers_monthly_status', 'get_operation_briefing', 'search_all'] },
];

const MAX_PREFETCH_SKIP_TOOLS = new Set([
  'save_ai_memory',
  'preview_agent_command',
  'create_confirmed_agent_command',
  'create_agent_command',
]);

function cleanFirstName(raw?: string | null): string | undefined {
  const cleaned = String(raw || '')
    .replace(/\b(Bey|Hanım|Hanim|Bay|Bayan)\b/gi, '')
    .trim()
    .split(/\s+/)[0];
  return cleaned || undefined;
}

function turkeyClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  return { year: pick('year'), month: pick('month'), day: pick('day'), hour: pick('hour') };
}

function utcNoon(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}

function utcDateKey(date: Date) {
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function diffDays(from: Date, to: Date) {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86400000);
}

function isTurkeyNonWorkingDay(date: Date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6 || TR_FIXED_HOLIDAYS.has(utcDateKey(date));
}

function nextBusinessDate(date: Date) {
  const d = new Date(date);
  while (isTurkeyNonWorkingDay(d)) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

function briefingId(prefix: string, text: string) {
  const slug = String(text || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[^a-z0-9ğüşöçıİĞÜŞÖÇ]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
  return `${prefix}-${slug || 'item'}`;
}

export interface ChatRequest {
  conversationId?: string;
  message: string;
  taxpayerId?: string;     // Opsiyonel kontekst
  currentPath?: string;    // Aktif portal ekranı
  voiceMode?: boolean;
  toolMode?: 'owner' | 'taxpayer-readonly' | 'none';
  model?: string;
  /** Maliyet logu için kaynak/modül etiketi (varsayılan 'moren-ai').
   *  WhatsApp botu 'whatsapp-bot' / 'whatsapp-owner' geçer → maliyet ekranında ayrı görünür. */
  source?: string;
  /** WhatsApp botunda müşterinin HAM mesajı (message tüm talimat bloğunu içerir).
   *  Veri tool'larının prefetch'i bu ham metne göre tetiklenir → "merhaba"da gereksiz veri çekilmez. */
  taxpayerText?: string;
  /** userId DB'den yüklenemeyen yollarda (ör. owner WhatsApp köprüsü) kimlik adı override'ı.
   *  Sistem-prompt'ta "Karşındaki kişi X" için kullanılır → bot kiminle konuştuğunu bilir. */
  userName?: string;
}

export interface ChatResponse {
  conversationId: string;
  assistantMessage: string;
  toolUses: Array<{ name: string; input: any; result: any }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number;
    durationMs: number;
    model: string;
  };
}


type BrifingFocus = 'calm' | 'busy' | 'critical' | 'review';
type BrifingSourceKey =
  | 'workflow'
  | 'calendar'
  | 'tasks'
  | 'agents'
  | 'notifications'
  | 'luca'
  | 'mihsap'
  | 'finance'
  | 'automation'
  | 'approval';
type BrifingSeverity = 'high' | 'medium' | 'low';

interface BrifingSourceTag {
  key: BrifingSourceKey;
  label: string;
  count: number;
}

interface BrifingSection {
  key: 'today' | 'risk' | 'action';
  title: string;
  items: string[];
}

interface BrifingDeadline {
  gun: number;
  tip: string;
  gunFark: number;
  originalGun?: number;
  shifted?: boolean;
  source?: BrifingSourceKey;
}

interface BrifingPayload {
  summary: string;
  motivation?: string;
  alerts: Array<{ id?: string; severity: BrifingSeverity; text: string; href?: string; source?: BrifingSourceKey }>;
  suggestions: Array<{ id?: string; text: string; href: string; icon?: string; source?: BrifingSourceKey }>;
  focus: BrifingFocus;
  sourceTags: BrifingSourceTag[];
  sections: BrifingSection[];
  metrics: Record<string, any>;
}
export interface BrifingResponse extends BrifingPayload {
  generatedAt: string;
  fromCache: boolean;
}
interface BrifingContext {
  now: Date;
  year: number; month: number; day: number; saat: number;
  tarihUzun: string;
  userFirstName: string;
  workflow: { bekliyorEvrak: number; isleniyor: number; kontrol: number; beyan: number; tamam: number; total: number };
  enUzunBekleyen: { ad: string; gun: number; stage: string; id: string } | null;
  ortalamaBekleme: number;
  eskiBeklemeler: Array<{ ad: string; gun: number; stage: string }>;
  deadlines: BrifingDeadline[];
  gorev: { bugun: number; hafta: number; geciken: number };
  ajan: { bugunOlay: number; bugunHata: number; bugunBasariOrani: number | null; haftaOlay: number; haftaHata: number; haftaBasariOrani: number | null; sonSaatOlay: number };
  okunmamisBildirim: number;
  portal: {
    luca: { pending: number; running: number; failed: number };
    mihsap: { pending: number; running: number; failed: number; invoiceCount: number };
    finance: { borcluMukellef: number; toplamBakiye: number };
    automation: { active: number; error: number; failedRuns: number };
    approval: { pendingDecisions: number; pendingCommands: number; failedCommands: number };
  };
  metrics: Record<string, any>;
}

@Injectable()
export class MorenAiService {
  private readonly logger = new Logger(MorenAiService.name);

  constructor(
    private prisma: PrismaService,
    private toolExecutor: ToolExecutorService,
  ) {}

  // ==========================================================
  // KONUŞMA YÖNETİMİ
  // ==========================================================
  async listConversations(tenantId: string, limit = 30) {
    const rows = await this.prisma.aiConversation.findMany({
      where: { tenantId, isArchived: false },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true, title: true, taxpayerId: true, updatedAt: true, createdAt: true,
        totalCostUsd: true, totalInputTokens: true, totalOutputTokens: true,
      },
    });
    return rows;
  }

  async getConversation(id: string, tenantId: string) {
    const conv = await this.prisma.aiConversation.findFirst({
      where: { id, tenantId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!conv) throw new BadRequestException('Konuşma bulunamadı');
    return conv;
  }

  async deleteConversation(id: string, tenantId: string) {
    const conv = await this.prisma.aiConversation.findFirst({ where: { id, tenantId } });
    if (!conv) throw new BadRequestException('Konuşma bulunamadı');
    await this.prisma.aiConversation.delete({ where: { id } });
    return { ok: true };
  }

  async renameConversation(id: string, tenantId: string, title: string) {
    const conv = await this.prisma.aiConversation.findFirst({ where: { id, tenantId } });
    if (!conv) throw new BadRequestException('Konuşma bulunamadı');
    await this.prisma.aiConversation.update({
      where: { id }, data: { title: title.slice(0, 120) },
    });
    return { ok: true };
  }

  // ==========================================================
  // ANA CHAT
  // ==========================================================
  async chat(
    tenantId: string,
    userId: string | null,
    body: ChatRequest,
  ): Promise<ChatResponse> {
    const started = Date.now();
    const model = body.model || pickDefaultModel(body.toolMode, body.message, body.taxpayerText);
    const userMessage = (body.message || '').trim();
    if (!userMessage) throw new BadRequestException('Mesaj boş olamaz');
    const currentPath = String(body.currentPath || '').trim().slice(0, 180);

    // Konuşmayı getir ya da oluştur
    let conversation: any = body.conversationId
      ? await this.prisma.aiConversation.findFirst({
          where: { id: body.conversationId, tenantId },
          include: { messages: { orderBy: { createdAt: 'asc' } } },
        })
      : null;

    if (!conversation) {
      conversation = await this.prisma.aiConversation.create({
        data: {
          tenantId,
          userId,
          taxpayerId: body.taxpayerId || null,
          title: this.generateTitle(userMessage),
        },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
    }

    // Kullanıcı mesajını kaydet
    await this.prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content: userMessage,
      },
    });

    // Konuşma geçmişini Anthropic formatına çevir
    const today = new Date();
    const currentPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const user = userId
      ? await this.prisma.user.findFirst({
          where: { id: userId },
          include: { tenant: true, userRoles: { include: { role: true } } },
        })
      : null;

    // Hem getPortalMetaAnswer hem getDeterministicCriticalAnswer SADECE portal web UI
    // (user != null) için anlamlı. WhatsApp owner/taxpayer akışında userId null geliyor +
    // 'userMessage' aslında recentContext + kurallar dahil TAM PROMPT oluyor. Tarihçedeki
    // eski "ben kimim" veya "4/A personel ayrılış" cevapları regex'i tetikleyip canned cevap
    // üretiyor, log'a yazılınca bir sonraki recentContext yine tetikleyip kendini besleyen
    // sonsuz döngü kuruyordu. User yoksa her iki kestirmeyi de atla.
    const deterministicAnswer = user
      ? (this.getPortalMetaAnswer(userMessage, user, conversation.messages || [], currentPath) ||
         this.getDeterministicCriticalAnswer(userMessage))
      : null;
    if (deterministicAnswer) {
      const durationMs = Date.now() - started;
      await this.prisma.aiMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'assistant',
          content: deterministicAnswer,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
          model: 'moren-ai-verified-rule',
          durationMs,
        },
      });
      await this.prisma.aiConversation.update({
        where: { id: conversation.id },
        data: { taxpayerId: conversation.taxpayerId || body.taxpayerId || null },
      });
      return {
        conversationId: conversation.id,
        assistantMessage: deterministicAnswer,
        toolUses: [],
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
          durationMs,
          model: 'moren-ai-verified-rule',
        },
      };
    }

    // OWNER DURUM-LİSTESİ FAST-PATH (TEK KAYNAK): "kimler evrak getirdi / beyannamesi
    // verildi / kontrol bekleyen kim" gibi durum sorularını agentic AI'ya BIRAKMA
    // (agentic yol bunlarda "çekmem gerekiyor" yarım-cevabına düşebiliyordu). WhatsApp
    // owner kısayolu ile AYNI fonksiyondan (buildOwnerStatusReply) deterministik cevap
    // üret → SAYFA da WhatsApp ile birebir aynı, hızlı ve güvenilir.
    // Efektif owner = mükellef-readonly ve none DIŞINDAKİ her şey (sayfa toolMode GÖNDERMEZ
    // → undefined; audience hesabı da bunu 'owner' kabul eder). Mükellef/none HARİÇ.
    const ownerEfektif = body.toolMode !== 'taxpayer-readonly' && body.toolMode !== 'none';
    if (ownerEfektif) {
      const statusRes = await buildOwnerStatusReply(this.prisma, tenantId, userMessage).catch(() => null);
      if (statusRes) {
        const durationMs = Date.now() - started;
        await this.prisma.aiMessage.create({
          data: {
            conversationId: conversation.id,
            role: 'assistant',
            content: statusRes.reply,
            inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
            costUsd: 0, model: 'moren-ai-status-shortcut', durationMs,
          },
        });
        return {
          conversationId: conversation.id,
          assistantMessage: statusRes.reply,
          toolUses: [],
          usage: {
            inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
            costUsd: 0, durationMs, model: 'moren-ai-status-shortcut',
          },
        };
      }
    }

    const messages = this.buildMessages(conversation.messages, userMessage);

    // Tenant + kullanıcı + cari dönem bağlamı
    const systemPrompt = buildSystemPrompt({
      officeName: user?.tenant?.name,
      // DB user yoksa (owner WhatsApp köprüsü userId=null) body.userName ile kimliği bil.
      userName: cleanFirstName(user?.firstName) || cleanFirstName(user?.lastName) || cleanFirstName(body.userName),
      tenantId,
      currentDate: today.toISOString().slice(0, 10),
      currentPeriod,
      // Mükellef (WhatsApp müşterisi) için ayrı kimlik/ton → "ofis asistanı", müşavir değil.
      audience: body.toolMode === 'taxpayer-readonly' ? 'taxpayer' : 'owner',
    });

    // Taxpayer kontekst notu (varsa)
    const activeToolTaxpayerId = this.activeToolTaxpayerId(body, conversation);
    const taxpayerContext = activeToolTaxpayerId
      ? await this.buildTaxpayerContext(activeToolTaxpayerId, tenantId)
      : '';
    const memoryContext = await this.buildMemoryContext(
      tenantId,
      userMessage,
      activeToolTaxpayerId,
    );

    const voiceHint = body.voiceMode
      ? '\n\n[SESLİ MOD AKTİF — kısa cümleler, tablo yok, maksimum 200 kelime]'
      : '';

    // ----- Tool-use döngüsü -----
    const effectiveVoiceHint = body.voiceMode
      ? '\n\n[SES MODU AKTIF — gerçek konuşma gibi cevap ver: 1-3 kısa cümle, maksimum 45 kelime, tablo ve başlık yok.]'
      : voiceHint;
    const responseMaxTokens = body.voiceMode ? VOICE_MAX_TOKENS : NORMAL_MAX_TOKENS;
    const selectedTools = this.selectToolsForMessage(userMessage, body.toolMode || 'owner');

    // ───── GERÇEK ARAÇ-YÜRÜTME (agentic) ─────
    // Model portal araçlarını GERÇEKTEN çağırır, sonucu görür, ZİNCİRLER, ona göre cevaplar
    // (prefetch tahmininin aksine) → tüm portal verisine dinamik hakimiyet + çok adımlı iş +
    // hafıza oku/yaz + resmi kaynak araştırma. Agent yolu başarısız/boş olursa prefetch'e
    // DÜŞER (güvenli, additive). Yazma/komut araçları onay kapısında (canWrite verilmedi) —
    // şimdilik salt-okuma; komut çalıştırma ayrı fazda.
    // OWNER (ofis sahibi): VARSAYILAN AÇIK (MOREN_AI_AGENT_TOOLS=0 ile kapatılır) — sahibe
    // "her veriye hakim, çok adımlı" bot. MÜKELLEF: yalnız açık env ile (önce owner'da test).
    const agentToolsEnabled = body.toolMode === 'owner'
      ? process.env.MOREN_AI_AGENT_TOOLS !== '0'
      : process.env.MOREN_AI_AGENT_TOOLS === '1';
    if (agentToolsEnabled && (body.toolMode === 'owner' || body.toolMode === 'taxpayer-readonly')) {
      const agentReply = await this.tryAgentToolPath({
        tenantId, userId, body, conversation, userMessage,
        systemPrompt, taxpayerContext, memoryContext, model, started,
      }).catch((e: any) => { this.logger.warn(`[AgentTools] hata, prefetch'e dusuluyor: ${e?.message || e}`); return null; });
      if (agentReply) return agentReply;
    }

    const maxResponse = await this.chatViaClaudeMax({
      tenantId,
      userId,
      body,
      conversation,
      user,
      userMessage,
      systemPrompt,
      taxpayerContext,
      memoryContext,
      effectiveVoiceHint,
      currentPath,
      selectedTools,
      model,
      started,
    });
    if (maxResponse) return maxResponse;

    if (!this.allowAnthropicApiFallback()) {
      const fallback = /whatsapp|calisan|owner|bot/i.test(String(body.source || ''))
        ? 'Mesajınızı aldık, Claude Max bağlantısı geçici yanıt vermediği için ofisimiz size dönüş yapacak.'
        : 'Claude Max bağlantısı aktif değil veya yanıt vermedi. Ücretli API hattı kapalı olduğu için API çağrısı yapmadım.';
      return this.saveAssistantAndReturn({
        tenantId,
        conversation,
        body,
        text: fallback,
        model: 'claude-max-unavailable',
        started,
        toolUsesLog: [],
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new BadRequestException(
        'Claude Max yanıt vermedi ve ANTHROPIC_API_KEY yok. Ücretli API fallback için MOREN_AI_ALLOW_ANTHROPIC_API=1 + ANTHROPIC_API_KEY gerekir.',
      );
    }

    // Ücretli API fallback yalnızca açıkça izin verilirse çalışır.
    if (!(await canSpendOnApi(this.prisma, tenantId, body.source))) {
      const fallback = /whatsapp|calisan|owner|bot/i.test(String(body.source || ''))
        ? 'Mesajınızı aldık, en kısa sürede ofisimiz size dönüş yapacak.'
        : 'AI aylık maliyet tavanı doldu. Ücretli API hattı bu yüzden çalıştırılmadı.';
      return this.saveAssistantAndReturn({
        tenantId,
        conversation,
        body,
        text: fallback,
        model: 'anthropic-api-cost-cap',
        started,
        toolUsesLog: [],
      });
    }

    const toolUsesLog: Array<{ name: string; input: any; result: any }> = [];
    let totalInput = 0, totalOutput = 0, totalCacheR = 0, totalCacheW = 0;

    let currentMessages = [...messages];
    let finalText = '';
    let stopReason = '';

    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      const dynamicSystemContext = [this.buildActiveUserContext(user, tenantId, currentPath), taxpayerContext, memoryContext, effectiveVoiceHint].filter(Boolean).join('\n\n');
      const payload: any = {
        model,
        // Maliyet optimizasyonu: 4096 -> 1500. Normal sohbet cevabi 500-1000 token.
        // Sesli modda 200 kelime (~300 token) zaten limitli. Cok uzun cevap kullanici
        // icin de zor okunur. Tool cevabi gerekiyorsa model daha cok yazar degilse kisa.
        max_tokens: responseMaxTokens,
        // temperature GÖNDERİLMİYOR — yeni modeller (Opus 4.8 vb.) "temperature is deprecated
        // for this model" diye 400 dönüyor; modelin varsayılan sıcaklığı kullanılıyor.
        system: [
          { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
          ...(dynamicSystemContext ? [{ type: 'text', text: dynamicSystemContext }] : []),
        ],
        tools: selectedTools,
        messages: currentMessages,
      };

      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        this.logger.error(`Anthropic API hata: ${res.status} — ${errText.slice(0, 500)}`);
        throw new BadRequestException(`AI servisi hatası (${res.status}): ${errText.slice(0, 200)}`);
      }

      const data: any = await res.json();
      totalInput += data?.usage?.input_tokens || 0;
      totalOutput += data?.usage?.output_tokens || 0;
      totalCacheR += data?.usage?.cache_read_input_tokens || 0;
      totalCacheW += data?.usage?.cache_creation_input_tokens || 0;
      stopReason = data?.stop_reason;

      // Yanıt content block'larını işle
      const contentBlocks = data?.content || [];
      const toolUseBlocks = contentBlocks.filter((b: any) => b.type === 'tool_use');
      const textBlocks = contentBlocks.filter((b: any) => b.type === 'text');

      // Düz metin varsa ekle
      const thisText = textBlocks.map((b: any) => b.text).join('\n').trim();
      if (thisText) finalText = thisText; // en son textText cevap olarak kalır

      // Assistant mesajını da currentMessages'a ekle (gelecek turlar için)
      currentMessages.push({
        role: 'assistant',
        content: contentBlocks,
      });

      // Tool çağrısı yoksa döngüden çık
      if (toolUseBlocks.length === 0 || stopReason !== 'tool_use') break;

      // Tool'ları paralel çalıştır
      const toolResults = await Promise.all(
        toolUseBlocks.map(async (tb: any) => {
          const result = await this.toolExecutor.execute(tb.name, tb.input || {}, {
            tenantId,
            userId,
            taxpayerId: this.activeToolTaxpayerId(body, conversation),
          });
          toolUsesLog.push({ name: tb.name, input: tb.input, result });
          return {
            type: 'tool_result',
            tool_use_id: tb.id,
            content: JSON.stringify(result),
          };
        }),
      );

      // Tool sonuçlarını user mesajı olarak ekle
      currentMessages.push({
        role: 'user',
        content: toolResults,
      });
    }

    const durationMs = Date.now() - started;
    const costUsd = computeCostUsd(model, {
      input: totalInput, output: totalOutput, cacheRead: totalCacheR, cacheWrite: totalCacheW,
    });

    finalText = this.compactFinalAnswer(finalText || '', !!body.voiceMode);

    // DETERMİNİSTİK ŞABLON KATMANI — ortak metot (Max yolunda da uygulanır).
    finalText = this.applyWhatsappOzet(finalText, toolUsesLog, !!body.voiceMode, body.taxpayerText || userMessage);

    // Assistant mesajını kaydet
    const aiMessageData: any = {
      conversationId: conversation.id,
      role: 'assistant',
      content: finalText || '(Cevap boş)',
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheReadTokens: totalCacheR,
      cacheWriteTokens: totalCacheW,
      costUsd,
      model,
      durationMs,
    };
    if (toolUsesLog.length > 0) {
      aiMessageData.toolCalls = toolUsesLog.map((t) => ({ name: t.name, input: t.input }));
      aiMessageData.toolResults = toolUsesLog;
    }
    await this.prisma.aiMessage.create({ data: aiMessageData });

    // Konuşma totalini güncelle
    await this.prisma.aiConversation.update({
      where: { id: conversation.id },
      data: {
        totalInputTokens: { increment: totalInput },
        totalOutputTokens: { increment: totalOutput },
        totalCacheReadTokens: { increment: totalCacheR },
        totalCostUsd: { increment: costUsd },
        taxpayerId: conversation.taxpayerId || body.taxpayerId || null,
      },
    });

    // AI usage log'una da yaz
    try {
      await this.prisma.aiUsageLog.create({
        data: {
          tenantId,
          source: body.source || 'moren-ai',
          model,
          inputTokens: totalInput,
          outputTokens: totalOutput,
          cacheReadTokens: totalCacheR,
          cacheWriteTokens: totalCacheW,
          costUsd,
          karar: 'ok',
          durationMs,
        },
      });
    } catch {}

    await this.autoLearnFromTurn({
      tenantId,
      userId,
      taxpayerId: this.activeToolTaxpayerId(body, conversation),
      userMessage,
      assistantMessage: finalText || '',
    });

    // AI tool dongusu tamamlandi ama final text uretmedi — kullanIcIya anlamli mesaj don.
    // Sebepler: max iteration doldu, tool sonuclari arasinda bir karara varamadi vb.
    let outboundMessage = finalText;
    if (!outboundMessage) {
      // Final metin üretilemedi (max iterasyon/timeout) — tool sonuçlarından
      // DETERMİNİSTİK gerçek-veri cevabı üret; jenerik "işlem başlatıldı" deme.
      const toolOnly = this.buildToolOnlyAnswer(toolUsesLog, userMessage);
      if (toolOnly) {
        outboundMessage = toolOnly;
      } else if (toolUsesLog.length > 0) {
        const toolNames = Array.from(new Set(toolUsesLog.map((t) => t.name))).slice(0, 3).join(', ');
        outboundMessage = `${toolNames} icin islem baslatildi. Sonucu kisa surede ileteceğim.`;
      } else {
        outboundMessage = 'Su an net bir cevap uretemedim. Soruyu biraz daha kisa veya farkli yazar misin?';
      }
    }

    return {
      conversationId: conversation.id,
      assistantMessage: outboundMessage,
      toolUses: toolUsesLog,
      usage: {
        inputTokens: totalInput,
        outputTokens: totalOutput,
        cacheReadTokens: totalCacheR,
        cacheWriteTokens: totalCacheW,
        costUsd,
        durationMs,
        model,
      },
    };
  }

  async realtimePortalQuery(
    tenantId: string,
    userId: string | null,
    body: {
      conversationId?: string;
      taxpayerId?: string;
      question?: string;
      currentPath?: string;
    },
  ) {
    const question = String(body?.question || '').replace(/\s+/g, ' ').trim();
    if (!question) throw new BadRequestException('question zorunlu');
    const currentPath = String(body?.currentPath || '').trim().slice(0, 180);
    const routeContext = currentPath ? `[Aktif portal yolu: ${currentPath}]\n` : '';
    return this.chat(tenantId, userId, {
      conversationId: body.conversationId,
      taxpayerId: body.taxpayerId,
      currentPath,
      message: `${routeContext}${question.slice(0, 1200)}`,
      voiceMode: true,
    });
  }

  async logRealtimeUsage(
    tenantId: string,
    userId: string | null,
    body: {
      conversationId?: string;
      taxpayerId?: string;
      model?: string;
      responseId?: string;
      usage?: any;
      durationMs?: number;
    },
  ) {
    const usage = body?.usage || {};
    const model = body?.model || process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-mini';
    const num = (...values: any[]) => {
      for (const value of values) {
        const n = Number(value || 0);
        if (Number.isFinite(n) && n > 0) return Math.round(n);
      }
      return 0;
    };
    const inputTokens = num(usage.input_tokens, usage.inputTokens);
    const outputTokens = num(usage.output_tokens, usage.outputTokens);
    const cacheReadTokens = num(
      usage?.input_token_details?.cached_tokens,
      usage?.inputTokenDetails?.cachedTokens,
    );
    const costUsd = computeRealtimeCostUsd(model, usage);

    let conversation: any = null;
    if (body?.conversationId) {
      conversation = await this.prisma.aiConversation.findFirst({
        where: { id: body.conversationId, tenantId },
        select: { id: true },
      });
    }

    await this.prisma.aiUsageLog.create({
      data: {
        tenantId,
        taxpayerId: body?.taxpayerId || null,
        source: 'moren-ai-realtime',
        model,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens: 0,
        costUsd,
        karar: 'ok',
        sebep: String(body?.responseId || 'realtime-voice').slice(0, 200),
        durationMs: body?.durationMs ?? null,
        cacheHit: false,
      },
    });

    if (conversation) {
      await this.prisma.aiConversation.update({
        where: { id: conversation.id },
        data: {
          totalInputTokens: { increment: inputTokens },
          totalOutputTokens: { increment: outputTokens },
          totalCacheReadTokens: { increment: cacheReadTokens },
          totalCostUsd: { increment: costUsd },
          taxpayerId: body?.taxpayerId || undefined,
        },
      });
    }

    return {
      model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      costUsd,
    };
  }

  // ==========================================================
  // YARDIMCILAR
  // ==========================================================
  private getPortalMetaAnswer(text: string, user: any, history: any[] = [], currentPath?: string): string | null {
    const normalized = this.normalizeForIntent(text);
    const asksIdentity =
      /beni taniyor musun|beni tanir misin|sen beni taniyor musun|ben kimim|kim oldugumu biliyor musun|hangi kullaniciyim|adim ne|ismim ne/.test(normalized);
    const asksReason =
      /neden sordum|niye sordum|neden soruyorum|niye soruyorum|niye sordugumu|neden sordugumu|bunu neden soruyorum|bunu niye soruyorum/.test(normalized);
    const asksCapability =
      /(portal|moren ai|bu sistem).*(ne yapar|ne ise yarar|neye yarar|neler yapar|neler yapabili|neler yapam|yapamadigi|yapamadiklari|sinir|limit|kabiliyet|modul|ozellik|amac|kullanilir|fayda|hangi is)|neler yapabiliyorsun|ne yapabiliyorsun|ne ise yariyorsun|neye yariyorsun|hangi isleri yaparsin|hangi islerde yardim edersin|hangi moduller|neleri yapamazsin|neleri yapamiyorsun|limitin ne|sinirin ne/.test(normalized);
    if (!asksIdentity && !asksReason && !asksCapability) return null;

    const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
    const officeName = user?.tenant?.name || 'bu ofis';
    const roles = (user?.userRoles || [])
      .map((ur: any) => ur?.role?.name)
      .filter(Boolean)
      .join(', ');
    const routeLabel = this.describeCurrentPath(currentPath);
    const activePlace = routeLabel ? ` Şu an ${routeLabel} ekranından yazıyorsun.` : '';
    const roleText = roles ? ` Rolün: ${roles}.` : '';
    const emailText = user?.email ? ` E-posta: ${user.email}.` : '';
    const answers: string[] = [];

    if (asksIdentity) {
      answers.push(fullName
        ? `Seni ${fullName} olarak görüyorum. ${officeName} oturumundasın.${roleText}${emailText}${activePlace}`
        : `Seni aktif portal kullanıcısı olarak görüyorum. ${officeName} oturumundasın.${roleText}${emailText}${activePlace}`);
    }

    if (asksCapability) {
      answers.push(this.buildPortalCapabilityAnswer());
    }

    if (asksReason) {
      answers.push(this.inferQuestionReason(history, currentPath, asksIdentity, asksCapability));
    }

    return answers.join('\n\n');
  }

  private inferQuestionReason(history: any[], currentPath?: string, asksIdentity = false, asksCapability = false): string {
    const previousUserMessage = [...(history || [])]
      .reverse()
      .find((message: any) => message?.role === 'user')?.content;
    const routeLabel = this.describeCurrentPath(currentPath);
    const previousText = previousUserMessage
      ? ` Önceki bağlamın: "${String(previousUserMessage).replace(/\s+/g, ' ').slice(0, 120)}".`
      : '';
    const routeText = routeLabel ? ` Aktif ekran: ${routeLabel}.` : '';
    if (asksIdentity || asksCapability) {
      return `Bunu, MOREN AI'nın seni, portalı ve konuşma bağlamını gerçekten taşıyıp taşımadığını test etmek için soruyorsun.${routeText}${previousText}`;
    }
    return `Bu soru, önceki konuşmanın niyetini ve aktif portal bağlamını anlayıp anlamadığımı test ediyor.${routeText}${previousText}`;
  }

  private buildPortalCapabilityAnswer(): string {
    return [
      'Portalın ana işi: mali müşavirlik ofisini tek yerden yönetmek; mükellef, evrak, fatura, KDV, beyanname, Luca/Mihsap, görev, bildirim, tahsilat ve ajan operasyonlarını birleştirir.',
      'Yapabildikleri: mükellef durumlarını okur, eksik evrak/KDV/beyan riskini çıkarır, Luca ve Mihsap işlerini izler, fatura ve mizan verisini analiz eder, hatalı ajan/log durumlarını raporlar, onaylı işlerde komut kuyruğu oluşturur.',
      'Yapamadıkları/sınırları: veri yoksa uydurmaz; resmi gönderim, silme, toplu mesaj, beyan veya entegrasyon işlemlerini onaysız yapmaz; agent altyapısında tanımlı olmayan işi doğrudan çalıştırmaz.',
      'MOREN AI hedefi: sadece sohbet etmek değil, portalın tamamını bilen ve güvenli onayla iş başlatan ofis operatörü gibi çalışmak.',
    ].join('\n');
  }

  private describeCurrentPath(path?: string): string | null {
    const cleanPath = String(path || '').split('?')[0].replace(/\/+$/, '') || '/';
    const routes: Array<[RegExp, string]> = [
      [/^\/panel\/moren-ai/, 'MOREN AI'],
      [/^\/panel\/kdv-kontrol/, 'KDV Kontrol'],
      [/^\/panel\/kdv-beyanname/, 'KDV Beyanname'],
      [/^\/panel\/beyannameler/, 'Beyannameler'],
      [/^\/panel\/mukellefler/, 'Mükellefler'],
      [/^\/panel\/ajanlar\/mihsap/, 'Mihsap Ajanı'],
      [/^\/panel\/ajanlar\/luca/, 'Luca Ajanı'],
      [/^\/panel\/ajanlar/, 'Ajanlar'],
      [/^\/panel\/gorevler/, 'Görevler ve Notlar'],
      [/^\/panel\/is-yuku/, 'İş Akışı'],
      [/^\/panel\/bildirimler/, 'Bildirimler'],
      [/^\/fatura-merkezi/, 'Fatura Merkezi'],
      [/^\/panel$/, 'Gösterge Paneli'],
      [/^\/panel\//, 'Portal'],
    ];
    return routes.find(([pattern]) => pattern.test(cleanPath))?.[1] || null;
  }

  private buildActiveUserContext(user: any, tenantId: string, currentPath?: string): string {
    const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
    const roles = (user?.userRoles || [])
      .map((ur: any) => ur?.role?.name)
      .filter(Boolean)
      .join(', ');

    return [
      '[AKTIF KULLANICI]',
      `Ad Soyad: ${fullName || 'Bilinmiyor'}`,
      `E-posta: ${user?.email || 'Bilinmiyor'}`,
      `Rol: ${roles || 'Bilinmiyor'}`,
      `Ofis: ${user?.tenant?.name || 'Bilinmiyor'}`,
      `Aktif ekran: ${this.describeCurrentPath(currentPath) || currentPath || 'Bilinmiyor'}`,
      `Tenant: ${tenantId}`,
      'Kullanıcı "beni tanıyor musun", "ben kimim", "portal ne yapar", "ne yapamıyorsun", "neden soruyorum" gibi meta sorular sorarsa bu bilgiyi kısa ve net cevapla; örnek isteme.',
    ].join('\n');
  }

  private normalizeForIntent(text: string) {
    return String(text || '')
      .toLocaleLowerCase('tr-TR')
      .replace(/ı/g, 'i')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private getDeterministicCriticalAnswer(text: string): string | null {
    const normalized = text
      .toLocaleLowerCase('tr-TR')
      .replace(/\s+/g, ' ')
      .trim();

    const employeeSeparation =
      /(işçi|isci|personel|sigortalı|sigortali|çalışan|calisan|4\s*\/?\s*a|sgk)/i.test(normalized) &&
      (/(işten|isten)\s*(ayrıl|ayril|çık|cik|çıkış|cikis)|ayrılış|ayrilis|çıkış bildir|cikis bildir|fesih/i.test(normalized) ||
        /(işi|iş)\s*(bırak|birak)/i.test(normalized)) &&
      /(bildir|süre|sure|kaç gün|kac gun|ceza|idari para|ipc|süresinde|suresinde|geç|gec)/i.test(normalized);

    if (employeeSeparation) {
      const currentYear = new Date().getFullYear();
      const currentYearAmount =
        currentYear === 2026
          ? ' 2026 için brüt asgari ücret 33.030 TL olduğundan ceza 3.303 TL olur.'
          : ' Tutar, bildirimin verileceği yıldaki brüt asgari ücretin 1/10’u olarak hesaplanır.';

      return `4/A personel işten ayrılış bildirgesi, işten ayrılış tarihini takip eden 10 gün içinde SGK'ya verilir. Süresinde verilmezse 5510/102 kapsamında her bir sigortalı için brüt asgari ücretin 1/10’u idari para cezası uygulanır.${currentYearAmount} Bu ceza geç çıkış bildirgesi içindir; eksik/yanlış aylık prim bildirimi varsa o ayrıca değerlendirilir.`;
    }

    const businessClosure =
      /(işi|iş)\s*(bırak|birak|terk)|mükellefiyet\s*(terk|kapanış|kapanis)/i.test(normalized) &&
      /(bildir|süre|sure|kaç gün|kac gun|ceza|usulsüzlük|usulsuzluk)/i.test(normalized);

    if (businessClosure) {
      const currentYear = new Date().getFullYear();
      const currentYearAmounts =
        currentYear === 2026
          ? ' 2026 ikinci derece tutarları: sermaye şirketi 17.000 TL; birinci sınıf/serbest meslek 8.700 TL; ikinci sınıf 6.000 TL; beyanname usulü gelir vergisi 4.000 TL; basit usul 2.600 TL.'
          : ' Tutar yıl ve mükellef sınıfına göre güncel VUK usulsüzlük ceza tarifesinden alınır.';

      return `İşi bırakma bildirimi, işi bırakma tarihinden itibaren 1 ay içinde vergi dairesine yapılır. Geç kalırsa VUK 352/II kapsamında ikinci derece usulsüzlük cezası kesilir.${currentYearAmounts} VUK 359 veya 100 TL sabit ceza değildir.`;
    }

    return null;
  }

  private selectToolsForMessage(text: string, mode: 'owner' | 'taxpayer-readonly' | 'none' = 'owner') {
    if (mode === 'none') return [];
    if (mode === 'taxpayer-readonly') {
      return MOREN_AI_TOOLS.filter((tool: any) => TAXPAYER_READONLY_TOOL_NAMES.includes(tool.name));
    }

    // ÖNCELİK SIRASI ÖNEMLİ: prefetch en fazla 8 tool çeker (buildMaxToolContext).
    // Soruyla EŞLEŞEN grupların tool'ları ÖNCE gelmeli; yoksa ilgili tool (örn.
    // list_taxpayers_monthly_status) 8-sınırına takılıp düşüyor ve bot "çekemiyorum"
    // diyordu. Eşleşen grup tool'ları (eşleşme sırasıyla) → sonra CORE.
    const ordered: string[] = [];
    const seen = new Set<string>();
    const push = (name: string) => { if (name && !seen.has(name)) { seen.add(name); ordered.push(name); } };
    // MEVZUAT/BİLGİ sorusu: resmi kaynak araştırması EN ÖNE alınır. Aksi halde "KDV
    // oranı" gibi sorularda 'oran/kdv' kelimeleri önce alakasız mizan/KDV-özet
    // tool'larını prefetch edip 8-tool sınırını dolduruyor, research_official_sources
    // düşüyor → model kaynaksız kalıp "teyit edeyim" deyip cevapsız dönüyordu (E2).
    if (needsLegislationModel(text)) push('research_official_sources');
    for (const group of TOOL_GROUPS) {
      if (group.pattern.test(text)) for (const tool of group.tools) push(tool);
    }
    for (const tool of CORE_TOOL_NAMES) push(tool);
    const byName = new Map<string, any>(MOREN_AI_TOOLS.map((tool: any) => [tool.name, tool]));
    return ordered.map((name) => byName.get(name)).filter(Boolean);
  }

  private allowAnthropicApiFallback() {
    return process.env.MOREN_AI_ALLOW_ANTHROPIC_API === '1' ||
      process.env.MOREN_AI_LLM_PROVIDER === 'anthropic-api';
  }

  /**
   * GERÇEK ARAÇ-YÜRÜTME yolu (Max Agent SDK). Model portal araçlarını GERÇEKTEN çağırır,
   * sonucu görür, zincirler. Başarılıysa ChatResponse döner; başarısız/boşsa null (çağıran
   * prefetch'e düşer). FAZ 1: yalnız OKUMA araçları çalışır; yazma araçları (create_/confirm/
   * send_/...) onay kapısında (canWrite verilmedi) reddedilir.
   */
  private async tryAgentToolPath(p: {
    tenantId: string; userId: string | null; body: ChatRequest; conversation: any;
    userMessage: string; systemPrompt: string; taxpayerContext: string; memoryContext: string;
    model: string; started: number;
  }): Promise<ChatResponse | null> {
    const isTaxpayer = p.body.toolMode === 'taxpayer-readonly';
    const base = isTaxpayer
      ? MOREN_AI_TOOLS.filter((t: any) => TAXPAYER_READONLY_TOOL_NAMES.includes(t.name))
      : MOREN_AI_TOOLS;
    const WRITE_RE = /create_|confirm|^send_|delete_|update_|start_|execute/i;
    const tools: AgentToolDef[] = (base as any[]).map((t) => ({
      name: t.name, description: t.description, input_schema: t.input_schema, write: WRITE_RE.test(t.name),
    }));

    const taxpayerId = this.activeToolTaxpayerId(p.body, p.conversation);
    // AGENTIC OVERRIDE — paylaşılan prompt prefetch dönemine ait ("veriyi sistem hazırlar",
    // "tabloyu sistem ekler") ifadeler içeriyor; bunlar agentic'te YANLIŞ. En sona (öncelikli)
    // düzeltici not koyuyoruz; prefetch yolu etkilenmiyor.
    const agenticOverride = [
      '## AGENTIC ÇALIŞMA (bu mesajda geçerli — önceki "veriyi sistem hazırlar" ifadelerini EZER):',
      '- Veriyi SEN araçları çağırarak alırsın; sistem önceden hazırlamaz. Gerekirse BİRDEN ÇOK aracı sırayla çağır, bir aracın çıktısını (örn. mükellef ID) sonrakine girdi yap (önce list_taxpayers → ID → get_mizan/get_kdv_summary...). 8 tura kadar zincirleyebilirsin.',
      '- Mali tablo (gelir tablosu/bilanço/mizan/KDV) istenince tabloyu ve kalemleri ARAÇ SONUCUNDAKİ gerçek rakamlarla SEN YAZ (şablona uygun). Sistem otomatik EKLEMEZ; boş bırakma, "sistem ekleyecek" varsayma.',
      '- Araç ADINI (get_/list_...) cevap metninde yazma; ama veriyi MUTLAKA araç çağırarak al, ezberden uydurma.',
      '- Önceki konuşma "## Önceki konuşma" altında verilir; "ONAYLIYORUM #PRV-XXXX" gelirse o preview\'i bu geçmişten bul.',
      '',
      '## KOMUT/İŞLEM ÇALIŞTIRMA (owner): "X\'in faturalarını çek", "KDV verisini çek", "e-defter kontrolünü başlat", "mizanını çek", "fiş Word üret" gibi GERÇEK işlem istenince şu akışı izle:',
      '1) HANGİ işlemlerin çalıştırılabildiğini get_portal_capability_map\'ten al (calistirilabilirIslemler listesi — her biri bir action). İstenen işlem bu listede yoksa "şu an portaldan yapılması gerek" de, UYDURMA.',
      '2) Mükellefi ve DÖNEMİ netleştir (gerekirse list_taxpayers ile ID al; dönem yoksa SOR).',
      '   DÖNEM FORMATI: aylık → "YYYY-MM" (örn. Nisan→2026-04). E-DEFTER\'de "1./2./3./4. dönem" veya "1. çeyrek" GEÇİCİ (3 aylık) demektir → "YYYY-Qn" (1. dönem=2026-Q1=Ocak-Mart, 2.=Q2 Nis-Haz...). "yıllık" → "YYYY". "Ocak ayı / aylık" denmişse "YYYY-MM". DÖNEM TÜRÜNDEN EMİN DEĞİLSEN owner\'a sor (aylık mı geçici mi).',
      '3) preview_agent_command çağır: agent="islem", action=<calistirilabilirIslemler\'deki action>, payload={ "taxpayerId":"<id>", "donem":"<YYYY-MM|YYYY-Qn|YYYY>" }.',
      '4) Dönen etki ile owner\'a NE YAPACAĞINI SADE TÜRKÇE TEKRAR ET ve TEYİT iste: "Anladığım: <mükellef> için <dönem-okunur, örn. 2026 1. dönem (Ocak-Mart)> <işlem>. Onaylıyor musun?" — KISA "onaylıyor musun?" yeterli. PRV-XXXX KODUNU KULLANICIYA GÖSTERME/yazdırma (teknik, gereksiz).',
      '5) Owner "onaylıyorum / evet / tamam onayla" derse create_confirmed_agent_command çağır. confirmationText değerini SEN oluştur: "ONAYLIYORUM #<previewId>" (previewId\'yi 3. adımdaki preview sonucundan al; kullanıcının kodu yazmasına GEREK YOK). İşlem arka planda çalışır; "kuyruğa aldım, sonucu ileteceğim" de.',
      '- Onay GELMEDEN "başlattım/çektim/gönderdim/yaptım" ASLA deme. Listede olmayan işlemi "yaptım" DEME.',
    ].join('\n');
    const fullSystem = [p.systemPrompt, p.taxpayerContext, p.memoryContext, agenticOverride].filter(Boolean).join('\n\n');

    // KOMUT ÇALIŞTIRMA (Stage 2) — VARSAYILAN KAPALI. Denetim (2026-06-15) gösterdi ki
    // komut allowlist'indeki agent'ların ÇOĞUNUN yürüten runner'ı YOK (yalnız Mihsap
    // fatura işleme uçtan-uca çalışıyor; luca/kdv/sgk/tebligat/edefter/tahsilat/whatsapp
    // komutları kuyruğa yazılıp PENDING kalıyor) → bot "başlattım" deyip hiçbir şey
    // çalışmazsa YALAN AKSİYON olur. Gerçek yürütme (dispatcher köprüsü) bağlanana dek
    // komutlar yalnız MOREN_AI_AGENT_COMMANDS=1 ile AÇIK. Okuma her zaman açık.
    const allowCommands = !isTaxpayer && process.env.MOREN_AI_AGENT_COMMANDS === '1';

    // GEÇMİŞ: agentic yola önceki mesajları taşı (yoksa iki-adımlı ONAYLIYORUM onayı ve
    // bağlam kırılıyordu — model preview'i hatırlamıyordu).
    const prior = (p.conversation.messages || []).slice(-6)
      .map((m: any) => `${m.role === 'assistant' ? 'MOREN AI' : 'Kullanici'}: ${this.flattenMessageContent(m.content).slice(0, 1000)}`)
      .filter((s: string) => s && s.length > 12).join('\n');
    const agentUserMessage = prior
      ? `## Önceki konuşma (eski→yeni)\n${prior}\n\n## Yeni mesaj\n${p.userMessage}`
      : p.userMessage;

    const res = await runMaxAgent({
      systemPrompt: fullSystem,
      userMessage: agentUserMessage,
      tools,
      executeTool: (name, input) => this.toolExecutor.execute(name, input, { tenantId: p.tenantId, userId: p.userId, taxpayerId }),
      canWrite: allowCommands
        ? async (name: string) => (name === 'create_confirmed_agent_command' || name === 'create_agent_command')
          ? { allow: true }
          : { allow: false, message: 'Bu işlem yalnız preview_agent_command + "ONAYLIYORUM #PRV-XXXX" onayıyla yapılır.' }
        : undefined,
      model: p.model,
      // 8 tur çok-adımlı sorguya yetmiyordu (error_max_turns); 14 ise yavaş sorguyu
      // 124 sn'ye çıkardı. 12 = denge: çok-adımlı iş için yeterli, gecikme tavanı makul.
      // Agent erken biterse beklemez; tamamlayamazsa yarım "çekiyorum" yerine dürüst yedeğe düşer.
      maxTurns: Number(process.env.MOREN_AI_AGENT_MAX_TURNS || 12),
    });
    if (!res.ok || !res.text.trim()) {
      this.logger.warn(`[AgentTools] bos/hatali sonuc (${res.error || 'bos'}) — prefetch'e dusuluyor`);
      return null;
    }

    const durationMs = Date.now() - p.started;
    await this.prisma.aiMessage.create({
      data: {
        conversationId: p.conversation.id, role: 'assistant', content: res.text,
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        costUsd: res.costUsd || 0, model: `${res.model}+agent`, durationMs,
      },
    });
    await this.prisma.aiConversation.update({
      where: { id: p.conversation.id },
      data: { taxpayerId: p.conversation.taxpayerId || p.body.taxpayerId || null },
    }).catch(() => {});
    this.logger.log(`[AgentTools] OK ${res.toolCalls.length} arac, ${durationMs}ms (${res.toolCalls.map((c) => c.name).join(',') || 'arac-yok'})`);
    return {
      conversationId: p.conversation.id,
      assistantMessage: res.text,
      toolUses: res.toolCalls.map((c) => ({ name: c.name, input: c.input })) as any,
      usage: {
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        costUsd: res.costUsd || 0, durationMs, model: `${res.model}+agent`,
      },
    };
  }

  private async chatViaClaudeMax(params: {
    tenantId: string;
    userId: string | null;
    body: ChatRequest;
    conversation: any;
    user: any;
    userMessage: string;
    systemPrompt: string;
    taxpayerContext: string;
    memoryContext: string;
    effectiveVoiceHint: string;
    currentPath?: string;
    selectedTools: any[];
    model: string;
    started: number;
  }): Promise<ChatResponse | null> {
    if (!isMaxAvailable()) return null;

    let toolUsesLog: Array<{ name: string; input: any; result: any }> = [];
    try {
      toolUsesLog = await this.buildMaxToolContext(params);
    } catch (err: any) {
      this.logger.warn(`Claude Max tool context hazirlanamadi: ${err?.message || err}`);
    }

    const dynamicSystemContext = [
      this.buildActiveUserContext(params.user, params.tenantId, params.currentPath),
      params.taxpayerContext,
      params.memoryContext,
      params.effectiveVoiceHint,
    ].filter(Boolean).join('\n\n');
    const history = this.buildMessages(params.conversation.messages || [], params.userMessage)
      .slice(-6)
      .map((message) => `${message.role === 'assistant' ? 'MOREN AI' : 'Kullanici'}: ${this.flattenMessageContent(message.content).slice(0, 1200)}`)
      .join('\n');
    const toolContext = toolUsesLog.length
      ? this.safePromptJson(toolUsesLog.map((t) => ({ tool: t.name, input: t.input, result: t.result })), 16000)
      : 'Bu turda portal verisi gerektiren veya güvenli şekilde tahmin edilebilen okuma tool sonucu yok.';

    const prompt = [
      dynamicSystemContext,
      '## Konusma Gecmisi',
      history,
      '## Portal Veri Sonuclari',
      toolContext,
      '## Talimat',
      'Cevabi yalnizca yukaridaki gerçek portal verisi, hafiza ve mesleki bilgiyle uret. Veri yoksa uydurma; hangi kaydin eksik oldugunu soyle.',
      'BELGE/DOSYA GÖNDERME işini SİSTEM otomatik yapar (sen DEĞİL); belge gerçekten gönderildiyse ayrı bir [BELGE] mesajı düşer. Sana bir belge isteği geldiyse, sistem mükellefi/belgeyi NET çözememiş demektir — kısaca "hangi mükellefin hangi belgesini/dönemini göndereyim?" diye SOR. ASLA "gönderdim / gönderiyorum / gönderiliyor / iletiyorum / yolluyorum / tekrar deniyorum / birazdan düşer / bu özellik yakında / sistem aksaklığı oldu" gibi YAPMADIĞIN/YAPAMAYACAĞIN şeyi yazma (geçmiş/şimdiki/gelecek hiçbir zaman). AYNI KURAL tüm dış eylemler için: ajan/Luca başlatma, hatırlatma/SMS/mesaj gönderme, beyan verme — bunları SEN yapamazsın; "başlattım/gönderdim/yaptım/çağırdım" DEME. Bu işlemler ayrı bir onay akışıyla yapılır; sen yalnız bilgi ver veya netleştirici soru sor. "Gönder" = belgeyi birine ilet demek; "GİB\'e beyan ver" SANMA.',
      'BEYANNAME VERİLDİ Mİ hükmü: tool sonucundaki "durum"/"verildi"/"durumAciklama" alanını AYNEN kullan. durum=verildi ise beyanname GİB\'e VERİLMİŞTİR — onay numarası boş diye "verilmemiş/sunulmamış" deme, kendi çıkarımını yapma. Aylık takipteki beyannameVerildi kutusu ofis içi işaretlemedir, GİB hükmü DEĞİLDİR; çelişkide beyanname kayıtları (list_beyan_kayitlari) esastır.',
      `Kullanici mesaji: ${params.userMessage}`,
    ].filter(Boolean).join('\n\n');

    // Süre sınırı modele göre: Opus (mevzuat) en yavaş ama doğruluk kritik → daha
    // çok zaman; owner/Sonnet derin analiz orta; basit Haiku/sohbet kısa. Sesli her
    // zaman hızlı. Bu olmadan Opus'a yönlenen mevzuat sorusu timeout'a takılıp
    // Haiku yedeğine düşüyor (kötü cevap) ve "bağlantı yavaşladı" kaçışı tetikleniyor.
    const mainTimeoutMs = params.body.voiceMode
      ? 25000
      : params.model === DEFAULT_MODEL_LEGISLATION
        ? 70000
        : (params.body.toolMode === 'owner' || params.model === DEFAULT_MODEL_OWNER_DEEP)
          ? 60000
          : 45000;
    const maxStarted = Date.now();
    let max = await claudeTextViaMax({
      prompt,
      system: params.systemPrompt,
      model: params.model,
      maxTurns: 1,
      timeoutMs: mainTimeoutMs,
    });
    this.logger.log(`[HIZ] max ${params.model} ${Date.now() - maxStarted}ms ok=${max.ok && !!max.text.trim()}`);
    // YEDEK MODEL MERDİVENİ: ana model (örn. derin soru → Sonnet) zaman aşar veya boş
    // dönerse, düz-metin yedeğe düşmeden önce Haiku ile hızlı ikinci deneme yap.
    // Kullanıcı şikayeti: "şablon yerine düz cümle geldi" = Max tek denemede boş kalmıştı.
    if ((!max.ok || !max.text.trim()) && params.model !== MAX_MODEL_CHEAP) {
      this.logger.warn(`Claude Max ${params.model} yanit vermedi (${max.error || 'bos'}); ${MAX_MODEL_CHEAP} ile tekrar deneniyor.`);
      max = await claudeTextViaMax({
        prompt,
        system: params.systemPrompt,
        model: MAX_MODEL_CHEAP,
        maxTurns: 1,
        timeoutMs: params.body.voiceMode ? 15000 : 25000,
      });
    }
    if (!max.ok || !max.text.trim()) {
      this.logger.warn(`Claude Max yanit uretmedi: ${max.error || 'bos cevap'}`);
      const toolOnlyAnswer = this.buildToolOnlyAnswer(toolUsesLog, params.userMessage);
      if (toolOnlyAnswer) {
        return this.saveAssistantAndReturn({
          tenantId: params.tenantId,
          conversation: params.conversation,
          body: params.body,
          text: toolOnlyAnswer,
          model: `moren-ai-tools:${params.model}`,
          started: params.started,
          toolUsesLog,
        });
      }
      return null;
    }

    // Max yolunda da deterministik şablon katmanı uygulanır — model gelir
    // tablosu/bilançoyu düz metne çeviriyordu; tabloyu kod ekler, model metni
    // kısa YORUM olarak altına gider. (Canlıda aktif yol BU — Max aboneliği.)
    const finalText = this.applyWhatsappOzet(
      this.compactFinalAnswer(max.text, !!params.body.voiceMode, params.body.toolMode === 'owner'),
      toolUsesLog,
      !!params.body.voiceMode,
      params.body.taxpayerText || params.userMessage,
    );
    return this.saveAssistantAndReturn({
      tenantId: params.tenantId,
      conversation: params.conversation,
      body: params.body,
      text: finalText,
      model: `claude-max:${max.model}`,
      started: params.started,
      toolUsesLog,
    });
  }

  /**
   * Tool sonuçlarından üretilen hazır şablon bloklarını cevabın BAŞINA koyar.
   * SORU-KAPILI: blok yalnızca kullanıcının sorusu o veriyi açıkça istiyorsa
   * eklenir (whatsapp-sablon.ts) — önden çekilen alakasız veri cevaba yapışmaz
   * (örn. "beyannameyi gönder" KDV kontrol şablonu getirmez).
   * Şablon modele bırakılmaz: tablo deterministik, modelin metni YORUM olur.
   * Sesli modda uygulanmaz. Hem ücretli API hem Claude Max yolundan çağrılır.
   */
  private applyWhatsappOzet(
    finalText: string,
    toolUsesLog: Array<{ name: string; input: any; result: any }>,
    voiceMode: boolean,
    questionText: string,
  ): string {
    if (voiceMode) return finalText;
    const bloklar: string[] = [];
    for (const t of toolUsesLog || []) {
      const blok = sablonForTool(t?.name, t?.result, questionText);
      if (blok && !bloklar.includes(blok)) bloklar.push(blok);
      if (bloklar.length >= 2) break; // mesaj şişmesin — en fazla 2 blok
    }
    if (!bloklar.length) return finalText;
    // Model şablonu zaten kendisi yazdıysa ikinci kez ekleme.
    if (sablonZatenVar(finalText)) return finalText;
    const tablo = bloklar.join('\n\n');
    const yorum = String(finalText || '').trim();
    return yorum ? `${tablo}\n\n📊 YORUM\n${yorum}` : tablo;
  }

  private async buildMaxToolContext(params: {
    tenantId: string;
    userId: string | null;
    body: ChatRequest;
    conversation: any;
    userMessage: string;
    selectedTools: any[];
  }): Promise<Array<{ name: string; input: any; result: any }>> {
    const toolNames = Array.from(new Set((params.selectedTools || []).map((tool: any) => String(tool?.name || '')).filter(Boolean)));
    if (!toolNames.length) return [];

    const logs: Array<{ name: string; input: any; result: any }> = [];
    const ctx = { tenantId: params.tenantId, userId: params.userId, taxpayerId: this.activeToolTaxpayerId(params.body, params.conversation) };
    const period = this.inferPeriodFromText(params.userMessage);
    const previousPeriod = this.previousPeriod(period);
    const taxpayerSearch = this.extractTaxpayerSearch(params.userMessage);
    const needsTaxpayer = toolNames.some((name) => [
      'get_taxpayer',
      'list_mizan_periods',
      'get_mizan',
      'get_gelir_tablosu',
      'get_bilanco',
      'get_kdv_summary',
      'list_invoices',
      'get_payroll_summary',
      'list_sgk_declarations',
      'list_documents',
      'compare_periods',
      'calculate_financial_ratios',
      'list_beyan_kayitlari',
      'get_beyanname_config',
      'get_taxpayer_work_status',
    ].includes(name));

    let taxpayerId = this.activeToolTaxpayerId(params.body, params.conversation);
    if (!taxpayerId && needsTaxpayer && taxpayerSearch) {
      const input = { search: taxpayerSearch, limit: 5, onlyActive: true };
      const result = await this.toolExecutor.execute('list_taxpayers', input, ctx);
      logs.push({ name: 'list_taxpayers', input, result });
      taxpayerId = result?.taxpayers?.[0]?.id;
    }

    // HIZ: ön-çekimler artık PARALEL — eskiden 8 sorgu sırayla bekliyordu,
    // toplam süre en yavaş sorgu kadar oldu ("cevap çok geç geliyor" şikayeti).
    const started = Date.now();
    const planned: Array<{ name: string; input: any }> = [];
    for (const name of toolNames) {
      if (planned.length >= 8 - logs.length) break;
      if (MAX_PREFETCH_SKIP_TOOLS.has(name)) continue;
      if (name === 'list_taxpayers' && logs.some((log) => log.name === 'list_taxpayers')) continue;
      const input = this.inferMaxToolInput(name, {
        userMessage: params.userMessage,
        // Veri tool gating'i müşterinin HAM mesajına bakar (message = dev talimat bloğu).
        gateText: params.body.taxpayerText || params.userMessage,
        period,
        previousPeriod,
        taxpayerId,
        taxpayerSearch,
      });
      if (!input) continue;
      planned.push({ name, input });
    }
    const results = await Promise.all(planned.map(async ({ name, input }) => {
      try {
        const result = await this.toolExecutor.execute(name, input, { ...ctx, taxpayerId });
        return { name, input, result };
      } catch (err: any) {
        return { name, input, result: { error: String(err?.message || err).slice(0, 200) } };
      }
    }));
    logs.push(...results);
    this.logger.log(`[HIZ] prefetch ${planned.length} tool paralel ${Date.now() - started}ms (${planned.map((p) => p.name).join(',')})`);

    return logs;
  }

  private inferMaxToolInput(name: string, ctx: {
    userMessage: string;
    gateText?: string;
    period: string;
    previousPeriod: string;
    taxpayerId?: string;
    taxpayerSearch?: string;
  }): any | null {
    const gate = ctx.gateText || ctx.userMessage;
    const hasTaxpayer = Boolean(ctx.taxpayerId);
    const taxpayerInput = hasTaxpayer ? { taxpayerId: ctx.taxpayerId } : (ctx.taxpayerSearch ? { taxpayerName: ctx.taxpayerSearch } : null);

    switch (name) {
      case 'list_taxpayers':
        return ctx.taxpayerSearch ? { search: ctx.taxpayerSearch, limit: 10, onlyActive: true } : null;
      case 'get_taxpayer':
        return hasTaxpayer ? { taxpayerId: ctx.taxpayerId } : null;
      case 'search_ai_memory':
        return { query: ctx.userMessage, limit: 5 };
      case 'list_mizan_periods':
        return hasTaxpayer ? { taxpayerId: ctx.taxpayerId } : null;
      case 'get_mizan':
      case 'get_gelir_tablosu':
      case 'get_bilanco':
      case 'get_kdv_summary':
      case 'calculate_financial_ratios':
        return hasTaxpayer ? { taxpayerId: ctx.taxpayerId, donem: ctx.period } : null;
      case 'compare_periods': {
        if (!hasTaxpayer) return null;
        const kaynak = /bilan[cç]o/i.test(ctx.userMessage)
          ? 'bilanco'
          : /mizan|hesap/i.test(ctx.userMessage)
            ? 'mizan'
            : 'gelir_tablosu';
        return { taxpayerId: ctx.taxpayerId, kaynak, donem1: ctx.previousPeriod, donem2: ctx.period };
      }
      case 'list_invoices':
        return taxpayerInput ? { ...taxpayerInput, period: ctx.period, limit: 50 } : null;
      case 'list_beyan_kayitlari': {
        if (!hasTaxpayer) return null;
        // "KDV beyannamesi" sorulunca SADECE KDV çekilsin — yoksa MUHSGK/Damga da
        // gelip cevaba karışıyordu (kullanıcı "kdv verildi mi" dedi, bot MUHSGK'yı
        // da listeledi). Tip belirtilmezse hepsi (filtresiz).
        const beyanTipiIn = this.inferBeyanTipiFromText(gate);
        return { taxpayerId: ctx.taxpayerId, period: ctx.period, donem: ctx.period, ...(beyanTipiIn ? { beyanTipiIn } : {}) };
      }
      case 'get_payroll_summary':
      case 'list_sgk_declarations':
      case 'get_beyanname_config':
      case 'get_taxpayer_work_status':
        return hasTaxpayer ? { taxpayerId: ctx.taxpayerId, period: ctx.period, donem: ctx.period } : null;
      case 'list_documents':
        return hasTaxpayer ? { taxpayerId: ctx.taxpayerId } : null;
      // FAZ 1 — mükellefe-kilitli WhatsApp veri tool'ları. Backend aktif mükellefi
      // ctx.taxpayerId ile bağlar; girdide taxpayerId GÖNDERİLMEZ. İsraf/aşırı-paylaşım
      // olmasın diye SADECE mesaj o konuyla ilgiliyse prefetch edilir.
      case 'get_my_kdv':
        return /\bkdv\b|katma de[ğg]er|kdv['i]?m/i.test(gate) ? { donem: this.explicitPeriodOrNull(gate, ctx.period) } : null;
      case 'get_my_invoices':
        return /fatura|e-?ar[şs]iv|kesti[ğg]im|sat[ıi][şs]\b/i.test(gate) ? { donem: this.explicitPeriodOrNull(gate, ctx.period), limit: 20 } : null;
      case 'get_my_beyanname':
        return /beyan|tahakkuk|muhtasar|muhsgk|stopaj|ge[çc]ici|damga|kurumlar|verildi mi|verdiniz mi|haz[ıi]r m[ıi]/i.test(gate) ? { donem: this.explicitPeriodOrNull(gate, ctx.period) } : null;
      case 'get_my_balance':
        return /bor[cç]|bakiye|[öo]deme|[öo]deyece|[öo]demem|[öo]decek|cari|hesab[ıi]m|hesap durum|ne kadar [öo]de|kalan/i.test(gate) ? {} : null;
      case 'get_my_profile':
      case 'get_my_work_status':
      case 'get_my_documents':
      case 'get_my_open_tasks':
      case 'get_my_recent_messages':
        // Bunlar statik mükellef context bloğunda zaten var; prefetch'e gerek yok.
        return null;
      case 'get_tax_calendar':
        return { fromDate: new Date().toISOString().slice(0, 10), toDate: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10) };
      case 'get_operation_briefing':
        return { period: ctx.period };
      case 'get_collection_risk_summary':
        return { limit: 20 };
      case 'get_accounting_reference': {
        const kodlar = (String(ctx.userMessage || '').match(/\b[1-7]\d{2}\b/g) || []).slice(0, 25);
        const t = String(ctx.userMessage || '').toLocaleLowerCase('tr-TR');
        const oranTipi = /kurumlar/.test(t) ? 'kurumlar' : /(gecici|geçici)\s*vergi/.test(t) ? 'gecici' : /(tevkifat|kdv2)/.test(t) ? 'kdv2' : /kdv\s*oran/.test(t) ? 'kdv' : '';
        const hesapSorusu = /hesap kod|hangi hesap|hesap plan|tdhp/.test(t);
        return (kodlar.length || oranTipi || hesapSorusu) ? { kodlar, oranTipi } : null;
      }
      case 'get_bank_status':
        return taxpayerInput ? { ...taxpayerInput } : null;
      case 'get_cari_hareketler':
        return taxpayerInput ? { ...taxpayerInput, limit: 20 } : null;
      case 'list_earsiv_invoices':
        return taxpayerInput ? { ...taxpayerInput, donem: ctx.period, limit: 30 } : null;
      case 'list_tasks':
        return { limit: 25 };
      case 'list_etebligat':
        return { limit: 20 };
      case 'get_isletme_hesap_ozeti':
        return taxpayerInput ? { ...taxpayerInput } : null;
      case 'get_beyanname_readiness_summary':
      case 'list_taxpayers_monthly_status':
      case 'get_beyan_ozet':
        return { period: ctx.period, limit: 30 };
      case 'get_agent_status':
      case 'get_portal_capability_map':
        return {};
      case 'get_luca_agent_jobs':
      case 'get_mihsap_agent_jobs':
        return { limit: 10 };
      case 'search_all':
        return { query: ctx.userMessage, limit: 8 };
      case 'list_araclar_hgs':
        return { limit: 20 };
      case 'research_official_sources':
        // HIZ: internetten resmi kaynak araması EN YAVAŞ ön-çekim. Grup deseni
        // "oran/vergi/süre" gibi sık kelimelerle tetikleniyordu (örn. "cari oran"
        // sorusu web araması başlatıyordu). Yalnız GERÇEK mevzuat sorusunda çek.
        // KDV/vergi oranı GATE'TEN ÇIKARILDI: oranlar (%1/%10/%20) artık system-prompt'ta
        // sabit → model anında cevaplar, yavaş web araştırması gerekmez. Araştırma yalnız
        // GERÇEKTEN değişen/güncel veri için (asgari ücret, ceza TL, tevkifat/damga, yeni oran).
        return /mevzuat|kanun|tebli[ğg]|sirk[üu]ler|[öo]zelge|resmi gazete|ceza(s[ıi])?\b|para cezas|idari para|asgari [üu]cret|had(ler|di)?\b|yeni oran|g[üu]ncel (oran|tutar|had)|tevkifat oran|stopaj oran|damga oran|ka[çc] g[üu]n i[çc]|ne zaman (veril|bildir|yap[ıi]l|[öo]den)|i[şs]ten ([çc][ıi]k|ayr[ıi]l)|i[şs]e (giri[şs]|ba[şs]lama)|bildirge|beyanname (s[üu]resi|son)/i.test(gate)
          ? { query: ctx.userMessage, limit: 2, remember: true }
          : null;
      default:
        return null;
    }
  }

  // Mesajda AÇIKÇA bir dönem (YYYY-MM veya ay adı) geçiyorsa o dönemi döner;
  // yoksa undefined — böylece tool kendi mantığıyla (en güncel/son kayıt) seçer.
  /** Mesajda açıkça geçen beyan tipini grup olarak çıkar (yoksa null = hepsi). */
  private inferBeyanTipiFromText(text: string): string[] | null {
    const t = String(text || '').toLocaleLowerCase('tr-TR');
    if (/\bkdv\b|katma de[gğ]er/.test(t)) return ['KDV1', 'KDV2', 'KDV'];
    if (/muhtasar|muhsgk|stopaj|muh\.?sgk/.test(t)) return ['MUHSGK'];
    if (/damga/.test(t)) return ['DAMGA'];
    if (/kurumlar/.test(t)) return ['KURUMLAR'];
    if (/ge[cç]ici/.test(t)) return ['GGECICI', 'KGECICI', 'GECICI_VERGI', 'GECICI'];
    if (/po[sş]et/.test(t)) return ['POSET'];
    if (/gelir vergisi|y[ıi]ll[ıi]k gelir/.test(t)) return ['GELIR'];
    return null;
  }

  private explicitPeriodOrNull(text: string, period: string): string | undefined {
    const raw = String(text || '');
    if (/\b20\d{2}-(0[1-9]|1[0-2])\b/.test(raw)) return period;
    if (/(ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik)/i.test(raw)) return period;
    return undefined;
  }

  private inferPeriodFromText(text: string): string {
    const raw = String(text || '');
    const exact = raw.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
    if (exact) return exact[0];

    const normalized = this.normalizeForIntent(raw);
    const months: Record<string, number> = {
      ocak: 1,
      subat: 2,
      mart: 3,
      nisan: 4,
      mayis: 5,
      haziran: 6,
      temmuz: 7,
      agustos: 8,
      eylul: 9,
      ekim: 10,
      kasim: 11,
      aralik: 12,
    };
    const yearMatch = raw.match(/\b(20\d{2}|19\d{2})\b/);
    const year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();
    const quarterMatch = normalized.match(/\b([1-4])\s*\.?\s*donem\b/);
    if (quarterMatch) return `${year}-${String(Number(quarterMatch[1]) * 3).padStart(2, '0')}`;
    const monthName = Object.keys(months).find((name) => normalized.includes(name));
    if (monthName) return `${year}-${String(months[monthName]).padStart(2, '0')}`;
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  private previousPeriod(period: string): string {
    const match = String(period || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) return period;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 2, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private extractTaxpayerSearch(text: string): string | undefined {
    const raw = String(text || '').replace(/\s+/g, ' ').trim();
    if (!raw) return undefined;
    const hasTaxpayerSignal = /(gelir tablos|bilan[cç]o|mizan|kdv|beyanname|evrak|belge|fatura|bordro|sgk|rasyo|m[üu]kellef|vergi|tahakkuk)/i.test(raw) ||
      /['’]?\s*(nin|nın|nun|nün|in|ın|un|ün)\b/i.test(raw);
    if (!hasTaxpayerSignal) return undefined;

    const firstPart = raw.split(/gelir tablos|bilan[cç]o|mizan|kdv|beyanname|evrak|belge|fatura|bordro|sgk|rasyo|yorumla|g[öo]nder|talep|vergi|tahakkuk/i)[0] || '';
    const candidate = firstPart
      .replace(/\b(bana|benim|l[üu]tfen|şu|su|bu|için|icin)\b/gi, ' ')
      .replace(/\b(20\d{2}|19\d{2}|ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik)\b/gi, ' ')
      .replace(/\b([1-4])\s*\.?\s*(dönem|donem)\b/gi, ' ')
      .replace(/['’]?\s*(nin|nın|nun|nün|in|ın|un|ün)\b/gi, ' ')
      .replace(/[^a-zA-Z0-9ğüşıöçĞÜŞİÖÇ\s.&-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (candidate.length < 2 || candidate.length > 80) return undefined;
    return candidate;
  }

  private flattenMessageContent(content: any): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text') return part.text || '';
        if (part?.type === 'tool_result') return '[tool_result]';
        if (part?.type === 'tool_use') return `[tool_use:${part.name || ''}]`;
        return '';
      }).filter(Boolean).join(' ');
    }
    return String(content || '');
  }

  private safePromptJson(value: any, maxChars: number) {
    const text = JSON.stringify(value, (_key, val) => (typeof val === 'bigint' ? Number(val) : val), 2);
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n... [kısaltıldı]` : text;
  }

  private buildToolOnlyAnswer(
    toolUsesLog: Array<{ name: string; input: any; result: any }>,
    userMessage: string,
  ): string | null {
    if (!toolUsesLog.length) return null;
    const taxpayer = this.firstTaxpayerFromTools(toolUsesLog);

    // SORUYA GÖRE tablo seç — "bilanço" diyene gelir tablosu dökme. Soru
    // hangisini istiyorsa o öne; belirsizse eski öncelik (gelir→bilanço→mizan).
    const q = String(userMessage || '');
    const finansalSira = /bilan[cç]o/i.test(q)
      ? ['get_bilanco', 'get_gelir_tablosu', 'get_mizan']
      : /mizan/i.test(q)
        ? ['get_mizan', 'get_gelir_tablosu', 'get_bilanco']
        : ['get_gelir_tablosu', 'get_bilanco', 'get_mizan'];
    for (const ad of finansalSira) {
      const log = toolUsesLog.find((l) => l.name === ad && l.result && !l.result.error);
      if (!log) continue;
      if (ad === 'get_gelir_tablosu') return this.formatGelirTablosuAnswer(log.result, taxpayer);
      if (ad === 'get_bilanco') return this.formatBilancoAnswer(log.result, taxpayer);
      return this.formatMizanAnswer(log.result, taxpayer);
    }

    // Diğer veri tipleri: merkezi şablon katmanı (soru-kapılı) bir blok
    // üretebiliyorsa onu dön — yedek yol da şablonlu cevap versin.
    for (const log of toolUsesLog) {
      const blok = sablonForTool(log?.name, log?.result, q);
      if (blok) return blok;
    }

    const requestedFinancial = /gelir tablos|bilan[cç]o|bilanco|mizan|rasyo|oran|finansal/i.test(userMessage);
    if (requestedFinancial) {
      const firstError = toolUsesLog.find((log) =>
        ['get_gelir_tablosu', 'get_bilanco', 'get_mizan', 'calculate_financial_ratios'].includes(log.name) &&
        log.result?.error
      );
      if (firstError) {
        const periods = toolUsesLog.find((log) => log.name === 'list_mizan_periods')?.result?.periods || [];
        const periodText = Array.isArray(periods) && periods.length
          ? ` Sistemde görünen mizan dönemleri: ${periods.slice(0, 6).map((p: any) => p.donem).filter(Boolean).join(', ')}.`
          : '';
        const name = taxpayer?.isim ? `${taxpayer.isim} için ` : '';
        return `${name}${firstError.result.error}.${periodText} Gerçek tablo kaydı olmadan yorum uydurmadım.`;
      }
    }

    const capability = toolUsesLog.find((log) => log.name === 'get_portal_capability_map');
    if (capability?.result && !capability.result.error) {
      const modules = (capability.result.modules || [])
        .map((item: any) => item.module)
        .filter(Boolean)
        .slice(0, 8)
        .join(', ');
      return modules
        ? `Portal araçlarına erişim var. Aktif modüller: ${modules}.`
        : 'Portal araçlarına erişim var; ancak bu istek için özetlenecek net kayıt dönmedi.';
    }

    // Genel deterministik kuyruk: özel formatlayıcı olmasa bile, hata DÖNDÜRMEYEN
    // tool sonuçları varsa kullanıcıya gerçek veri çekildiğini söyle (jenerik
    // "AI yavaşladı" yerine). Böylece KDV/beyanname/evrak gibi tool'larda da
    // timeout anında veri kaybolmaz.
    const okTools = toolUsesLog.filter(
      (log) => log.result && !log.result.error &&
        log.name !== 'get_portal_capability_map' && log.name !== 'list_taxpayers',
    );
    if (okTools.length) {
      const name = taxpayer?.isim ? `${taxpayer.isim} için ` : '';
      const fetched = Array.from(new Set(okTools.map((t) => this.toolLabel(t.name)))).slice(0, 4).join(', ');
      return `${name}istediğin kayıtları portaldan çektim (${fetched}). Bağlantı yavaşladığı için tabloyu tam yazamadım; "detay" yazarsan rakamlarla özetlerim. Veri hazır, kaybolmadı.`;
    }

    return null;
  }

  /** Tool adını kullanıcıya gösterilecek kısa Türkçe etikete çevirir. */
  private toolLabel(name: string): string {
    const map: Record<string, string> = {
      get_kdv_summary: 'KDV özeti',
      list_beyan_kayitlari: 'beyanname kayıtları',
      get_beyanname_config: 'beyanname ayarları',
      get_taxpayer: 'mükellef bilgisi',
      get_taxpayer_work_status: 'çalışma durumu',
      list_documents: 'evraklar',
      list_invoices: 'faturalar',
      get_payroll_summary: 'bordro özeti',
      list_sgk_declarations: 'SGK bildirgeleri',
      get_mizan: 'mizan',
      get_gelir_tablosu: 'gelir tablosu',
      get_bilanco: 'bilanço',
      compare_periods: 'dönem karşılaştırma',
      calculate_financial_ratios: 'finansal rasyolar',
    };
    return map[name] || name;
  }

  private firstTaxpayerFromTools(toolUsesLog: Array<{ name: string; input: any; result: any }>): any | null {
    const list = toolUsesLog.find((log) => log.name === 'list_taxpayers')?.result?.taxpayers;
    if (Array.isArray(list) && list.length) return list[0];
    const get = toolUsesLog.find((log) => log.name === 'get_taxpayer')?.result;
    if (get && !get.error) return { isim: get.isim || get.ad, id: get.id, vkn_tckn: get.vkn_tckn };
    return null;
  }

  private money(value: any): string {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return '0,00 TL';
    return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' TL';
  }

  private pct(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return '-';
    return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value) + '%';
  }

  private ratio(part: any, total: any): number | null {
    const p = Number(part || 0);
    const t = Number(total || 0);
    if (!Number.isFinite(p) || !Number.isFinite(t) || Math.abs(t) < 0.01) return null;
    return (p / t) * 100;
  }

  private formatGelirTablosuAnswer(result: any, taxpayer: any | null): string {
    const k = result.kalemler || {};
    const name = taxpayer?.isim ? `${taxpayer.isim} için ` : '';
    const net = Number(k.netSatislar || 0);
    const brutKar = Number(k.brutSatisKari || 0);
    const faaliyet = Number(k.faaliyetKari || 0);
    const netKar = Number(k.donemNetKari || k.donemKari || 0);
    const vergi = Number(k.vergiKarsiligi || 0);
    const yorum = netKar > 0
      ? 'Sonuç kârlı; asıl bakılacak yer brüt kâr marjı ile faaliyet giderlerinin net satışa oranı.'
      : netKar < 0
        ? 'Sonuç zararda; satış maliyeti, faaliyet giderleri ve finansman gideri ayrı kontrol edilmeli.'
        : 'Net kâr sıfıra yakın; dönem kapanış kayıtları ve maliyet dağılımı kontrol edilmeli.';
    // Hazır şablon varsa onu kullan — yedek yol da şablonlu cevap versin
    // (Max cevap dönmediğinde düz cümle gidiyordu, kullanıcı şikayeti).
    if (typeof result.whatsappOzet === 'string' && result.whatsappOzet.trim()) {
      const baslik = taxpayer?.isim ? `${taxpayer.isim}\n` : '';
      const vergiSatiri = vergi ? `• Vergi Karşılığı: ${this.money(vergi)}\n` : '';
      return `${baslik}${result.whatsappOzet.trim()}\n${vergiSatiri}\n📊 YORUM\n• ${yorum}`;
    }
    return `${name}${result.donem} gelir tablosu bulundu. Net satış ${this.money(net)}, brüt kâr ${this.money(brutKar)} (${this.pct(this.ratio(brutKar, net))}), faaliyet kârı ${this.money(faaliyet)} (${this.pct(this.ratio(faaliyet, net))}), net kâr ${this.money(netKar)} (${this.pct(this.ratio(netKar, net))})${vergi ? `, vergi karşılığı ${this.money(vergi)}` : ''}. ${yorum}`;
  }

  private formatBilancoAnswer(result: any, taxpayer: any | null): string {
    const name = taxpayer?.isim ? `${taxpayer.isim} için ` : '';
    const aktif = result.aktif || {};
    const pasif = result.pasif || {};
    const aktifToplami = Number(aktif.aktifToplami || 0);
    const kvyk = Number(pasif.kvYabanciKaynak || 0);
    const ozkaynak = Number(pasif.ozkaynaklar || 0);
    const cariOran = kvyk ? Number(aktif.donenVarliklar || 0) / kvyk : null;
    const cariText = cariOran ? new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(cariOran) : '-';
    const yorum = `${result.dengeliMi ? 'Bilanço dengeli görünüyor.' : 'Aktif-pasif dengesi tutarsız görünüyor, kayıt kontrolü gerekir.'}${ozkaynak < 0 ? ' Özkaynak negatif — TTK 376 (sermaye kaybı) değerlendirilmeli.' : ''}`;
    if (typeof result.whatsappOzet === 'string' && result.whatsappOzet.trim()) {
      const baslik = taxpayer?.isim ? `${taxpayer.isim}\n` : '';
      return `${baslik}${result.whatsappOzet.trim()}\n\n📐 YORUM\n• Cari Oran: ${cariText}\n• ${yorum}`;
    }
    return `${name}${result.donem} bilançosu bulundu. Aktif toplamı ${this.money(aktifToplami)}, KV yabancı kaynak ${this.money(kvyk)}, özkaynak ${this.money(ozkaynak)}, cari oran ${cariText}. ${yorum}`;
  }

  private formatMizanAnswer(result: any, taxpayer: any | null): string {
    const name = taxpayer?.isim ? `${taxpayer.isim} için ` : '';
    const yorum = result.dengeliMi ? 'Mizan dengeli.' : 'Mizanda borç/alacak farkı var, kontrol gerekir.';
    if (typeof result.whatsappOzet === 'string' && result.whatsappOzet.trim()) {
      const baslik = taxpayer?.isim ? `${taxpayer.isim}\n` : '';
      return `${baslik}${result.whatsappOzet.trim()}\n\n📊 YORUM\n• ${yorum}`;
    }
    return `${name}${result.donem} mizanı bulundu. Toplam borç ${this.money(result.toplamBorc)}, toplam alacak ${this.money(result.toplamAlacak)}, hesap sayısı ${result.hesapSayisiToplam || result.hesapSayisi}. ${yorum}`;
  }

  private async saveAssistantAndReturn(params: {
    tenantId: string;
    conversation: any;
    body: ChatRequest;
    text: string;
    model: string;
    started: number;
    toolUsesLog: Array<{ name: string; input: any; result: any }>;
  }): Promise<ChatResponse> {
    const durationMs = Date.now() - params.started;
    const messageData: any = {
      conversationId: params.conversation.id,
      role: 'assistant',
      content: params.text || '(Cevap boş)',
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      model: params.model,
      durationMs,
    };
    if (params.toolUsesLog.length > 0) {
      messageData.toolCalls = params.toolUsesLog.map((t) => ({ name: t.name, input: t.input }));
      messageData.toolResults = params.toolUsesLog;
    }
    await this.prisma.aiMessage.create({ data: messageData });
    await this.prisma.aiConversation.update({
      where: { id: params.conversation.id },
      data: {
        taxpayerId: params.conversation.taxpayerId || params.body.taxpayerId || null,
      },
    });
    try {
      await this.prisma.aiUsageLog.create({
        data: {
          tenantId: params.tenantId,
          taxpayerId: this.activeToolTaxpayerId(params.body, params.conversation) || null,
          source: params.body.source || 'moren-ai',
          model: params.model,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
          karar: 'ok',
          sebep: params.model.startsWith('claude-max:') ? 'claude-max-subscription' : 'no-paid-api',
          durationMs,
        },
      });
    } catch {}
    await this.autoLearnFromTurn({
      tenantId: params.tenantId,
      userId: params.conversation.userId || null,
      taxpayerId: this.activeToolTaxpayerId(params.body, params.conversation),
      userMessage: params.body.message,
      assistantMessage: params.text || '',
    });
    return {
      conversationId: params.conversation.id,
      assistantMessage: params.text,
      toolUses: params.toolUsesLog,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        durationMs,
        model: params.model,
      },
    };
  }

  private compactFinalAnswer(text: string, voiceMode: boolean, ownerMode = false) {
    const cleaned = String(text || '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^Resmi kaynak doğrudan bulamadım\s*[—-]\s*/i, '')
      .replace(/Detaylı bilgi için[^.!?\n]*(mali müşavir|uzman|profesyonel)[^.!?\n]*[.!?]?/gi, '')
      .replace(/[^.!?\n]*(mali müşavire|uzmana|profesyonel destek)[^.!?\n]*(danışın|başvurun|alın)[^.!?\n]*[.!?]?/gi, '')
      .trim();
    // Owner uzun yapılandırılmış brifing/rapor isteyebilir → post-filter zaten 3500'e
    // izin veriyor; burada 900'de kesmek raporu yarıda bırakıyordu. Owner'da geniş tut.
    const maxChars = voiceMode ? 360 : (ownerMode ? 3200 : 900);
    if (cleaned.length <= maxChars) return cleaned;
    const sentences = cleaned.match(/[^.!?\n]+[.!?]?/g) || [cleaned];
    let out = '';
    for (const sentence of sentences) {
      if ((out + sentence).trim().length > maxChars) break;
      out += sentence;
      if (voiceMode && out.length > 220) break;
    }
    // Zorla "Detay istersen açarım." EKLEME — proaktif-soru yasağıyla çelişiyordu ve
    // owner'a yapışıyordu. Kesme olduysa metin doğal biter.
    return out.trim() || cleaned.slice(0, maxChars).trim();
  }

  private generateTitle(msg: string): string {
    const clean = msg.replace(/\s+/g, ' ').trim();
    if (clean.length <= 50) return clean;
    return clean.slice(0, 50) + '…';
  }

  private buildMessages(history: any[], newUserMessage: string): any[] {
    // Her mesaj için Anthropic format'ı:
    //   { role, content }  — content ya string ya block dizisi
    const msgs: any[] = [];
    const windowed = history.slice(-MAX_HISTORY_MESSAGES);
    while (windowed.length && windowed[0]?.role === 'assistant') windowed.shift();
    for (const m of windowed) {
      if (m.role === 'user' || m.role === 'assistant') {
        msgs.push({ role: m.role, content: m.content });
      }
      // 'tool' rolü burada yok — içerden bir assistant mesajının tool_use/tool_result parçası
    }
    msgs.push({ role: 'user', content: newUserMessage });
    return msgs;
  }

  private activeToolTaxpayerId(body: ChatRequest, conversation?: any): string | undefined {
    if (body.toolMode === 'owner') return body.taxpayerId || undefined;
    return body.taxpayerId || conversation?.taxpayerId || undefined;
  }

  private async buildTaxpayerContext(taxpayerId: string, tenantId: string): Promise<string> {
    const t = await this.prisma.taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      select: {
        companyName: true, firstName: true, lastName: true, taxNumber: true,
        taxOffice: true, type: true,
      },
    });
    if (!t) return '';
    const name = t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim();
    return `## Aktif Mükellef Kontekst\nSoru özellikle bu mükellefle ilgili:\n- İsim: ${name}\n- VKN/TCKN: ${t.taxNumber}\n- Vergi Dairesi: ${t.taxOffice}\n- Tip: ${t.type}\n- Sistem ID (taxpayerId): ${taxpayerId}\n\nTool çağırırken bu taxpayerId'yi kullan.`;
  }

  private extractMemoryKeywords(text: string): string[] {
    const stopWords = new Set([
      'için', 'olan', 'olarak', 'bana', 'bunu', 'şunu', 'şuan', 'şu', 'bir', 've', 'veya',
      'ile', 'gibi', 'daha', 'sonra', 'önce', 'neden', 'nasıl', 'hangi', 'mı', 'mi', 'mu', 'mü',
      'de', 'da', 'ki', 'ben', 'biz', 'sen', 'siz', 'moren', 'ai',
    ]);
    return [...new Set(
      String(text || '')
        .toLocaleLowerCase('tr-TR')
        .replace(/[^0-9a-zA-ZçğıöşüÇĞİÖŞÜ\s]/g, ' ')
        .split(/\s+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 4 && !stopWords.has(item)),
    )].slice(0, 8);
  }

  private async buildMemoryContext(tenantId: string, query: string, taxpayerId?: string): Promise<string> {
    try {
      const aiMemory = (this.prisma as any).aiMemory;
      if (!aiMemory?.findMany) return '';

      const keywords = this.extractMemoryKeywords(query);
      const relevantWhere = keywords.length
        ? {
            tenantId,
            isActive: true,
            OR: keywords.flatMap((keyword) => [
              { title: { contains: keyword, mode: 'insensitive' } },
              { content: { contains: keyword, mode: 'insensitive' } },
            ]),
          }
        : null;

      const [coreMemories, taxpayerMemories, relevantMemories] = await Promise.all([
        aiMemory.findMany({
          where: { tenantId, isActive: true, scope: { in: ['office', 'portal', 'agent'] } },
          orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
          take: 8,
        }).catch(() => []),
        taxpayerId
          ? aiMemory.findMany({
              where: { tenantId, isActive: true, taxpayerId },
              orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
              take: 6,
            }).catch(() => [])
          : Promise.resolve([]),
        relevantWhere
          ? aiMemory.findMany({
              where: relevantWhere,
              orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
              take: 8,
            }).catch(() => [])
          : Promise.resolve([]),
      ]);

      const merged = new Map<string, any>();
      for (const memory of [...taxpayerMemories, ...relevantMemories, ...coreMemories]) {
        if (memory?.id && !merged.has(memory.id)) merged.set(memory.id, memory);
      }
      const memories = [...merged.values()].slice(0, 12);
      if (!memories.length) return '';

      const lines = memories.map((memory) => {
        const scope = memory.taxpayerId ? 'mükellef' : memory.scope || 'ofis';
        const content = String(memory.content || '').replace(/\s+/g, ' ').slice(0, 520);
        return `- [${scope}] ${memory.title}: ${content}`;
      });
      return `## MOREN AI Kalıcı Hafıza\nAşağıdaki notlar sistem hafızasından otomatik geldi; cevapta sessizce kullan, gereksiz yere "hafızamda" deme:\n${lines.join('\n')}`;
    } catch {
      return '';
    }
  }

  private shouldAutoLearn(text: string) {
    return /\b(bunu hatırla|hafızaya al|unutma|bundan sonra|her zaman|tercihim|istemiyorum|istiyorum|kısa cevap|uzun cevap|mali müşavir gibi|sürekli öğren|sürekli araştır)\b/i.test(text);
  }

  private async autoLearnFromTurn(args: {
    tenantId: string;
    userId: string | null;
    taxpayerId?: string;
    userMessage: string;
    assistantMessage: string;
  }): Promise<void> {
    const text = String(args.userMessage || '').trim();
    if (!text || !this.shouldAutoLearn(text)) return;
    if (/(şifre|parola|password|token|api\s*key|gizli anahtar)/i.test(text)) return;

    try {
      const aiMemory = (this.prisma as any).aiMemory;
      if (!aiMemory?.create) return;
      const scope = args.taxpayerId ? 'taxpayer' : 'office';
      const title = `Kullanıcı tercihi: ${text.replace(/\s+/g, ' ').slice(0, 80)}`;
      const content = `Kullanıcı talimatı/tercihi (${new Date().toISOString().slice(0, 10)}): ${text.slice(0, 1200)}`;
      const existing = await aiMemory.findFirst({
        where: { tenantId: args.tenantId, scope, title, isActive: true, taxpayerId: args.taxpayerId || null },
      }).catch(() => null);
      if (existing) {
        await aiMemory.update({
          where: { id: existing.id },
          data: { content, importance: 4, tags: ['kullanici-tercihi', 'auto-learn'] },
        }).catch(() => null);
        return;
      }
      await aiMemory.create({
        data: {
          tenantId: args.tenantId,
          taxpayerId: args.taxpayerId || null,
          scope,
          title,
          content,
          source: 'moren-ai-auto-learn',
          importance: 4,
          tags: ['kullanici-tercihi', 'auto-learn'],
          createdBy: args.userId || null,
        },
      }).catch(() => null);
    } catch {}
  }
  // ==========================================================
  // ==========================================================
  // v1.36.82 — PROFESYONEL DASHBOARD BRİFİNGİ
  // 30 dk in-memory cache (tenant başına). JSON çıktı:
  //   { summary: string, alerts: Array<{severity, text, href?}>,
  //     suggestions: Array<{text, href, icon?}>, focus: string, metrics: object }
  // Frontend bu yapıyı render eder. Her 5 dk client refetch — çoğu cache hit.
  // ==========================================================

  private brifingCache = new Map<string, { payload: BrifingPayload; generatedAt: Date }>();
  private readonly BRIFING_TTL_MS = 30 * 60 * 1000; // 30 dk

  async getBrifing(tenantId: string, userId?: string | null, force = false): Promise<BrifingResponse> {
    const cacheKey = `${tenantId}:${userId || 'anonymous'}`;
    const cached = this.brifingCache.get(cacheKey);
    if (!force && cached && (Date.now() - cached.generatedAt.getTime()) < this.BRIFING_TTL_MS) {
      return { ...cached.payload, generatedAt: cached.generatedAt.toISOString(), fromCache: true };
    }

    const ctx = await this.buildBrifingContext(tenantId, userId);
    const prompt = this.buildBrifingPrompt(ctx);

    // Brifing = saf metin (JSON) üretimi; araç/görsel yok. Varsayılan sıra:
    //   1) Claude Max aboneliği — varsa önce bu
    //   2) Deterministik fallback — Max yoksa/başarısızsa sayılardan brifing üret
    //   3) Ücretli Anthropic API yalnızca MOREN_AI_ALLOW_ANTHROPIC_API=1 ise fallback olabilir
    let rawText = '';
    let usedSource: 'brifing-max' | 'brifing' = 'brifing-max';
    let viaMaxCostUsd = 0;
    let apiInputTokens = 0;
    let apiOutputTokens = 0;

    // 1) Max
    if (isMaxAvailable()) {
      try {
        const max = await claudeTextViaMax({ prompt, model: MAX_MODEL_CHEAP, maxTurns: 1 });
        if (max.ok && max.text) {
          rawText = max.text.trim();
          usedSource = 'brifing-max';
          viaMaxCostUsd = max.costUsd;
        } else if (max.error) {
          this.logger.warn(`Brifing Max başarısız: ${max.error}`);
        }
      } catch (e: any) {
        this.logger.warn(`Brifing Max hatası: ${e?.message}`);
      }
    }

    // 2) Ücretli API fallback yalnızca açık izin verilirse çalışır.
    if (!rawText && this.allowAnthropicApiFallback()) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (apiKey && (await canSpendOnApi(this.prisma, tenantId, 'brifing'))) {
        try {
          const res = await fetch(ANTHROPIC_URL, {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: DEFAULT_MODEL,
              max_tokens: 700,
              messages: [{ role: 'user', content: prompt }],
            }),
          });
          if (res.ok) {
            const data: any = await res.json();
            rawText = (data?.content?.[0]?.text || '').trim();
            usedSource = 'brifing';
            apiInputTokens = data?.usage?.input_tokens || 0;
            apiOutputTokens = data?.usage?.output_tokens || 0;
          } else {
            this.logger.warn(`Brifing AI failed ${res.status}`);
          }
        } catch (e: any) {
          this.logger.warn(`Brifing exception: ${e?.message}`);
        }
      }
    }

    // 3) Hiçbir izinli AI kaynağı cevap vermediyse deterministik fallback
    if (!rawText) {
      const fallback = this.buildFallbackPayload(ctx);
      return { ...fallback, generatedAt: new Date().toISOString(), fromCache: false };
    }

    // JSON parse — model bazen markdown code fence ile sarar
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    let parsed: BrifingPayload;
    try {
      const obj = JSON.parse(cleaned);
      parsed = this.validatePayload(obj);
    } catch {
      // JSON parse fail — düz metni summary olarak kullan
      parsed = {
        summary: rawText.slice(0, 500),
        motivation: '',
        alerts: [],
        suggestions: [],
        focus: 'busy',
        sourceTags: [],
        sections: [],
        metrics: ctx.metrics,
      };
    }
    parsed = this.applyRuleDecisions(parsed, this.buildFallbackPayload(ctx));
    parsed.metrics = {
      ...ctx.metrics,
      day: ctx.day,
      periodTone: ctx.day <= 12 ? 'early' : ctx.day <= 16 ? 'prepare' : 'firm',
      bekliyorEvrak: ctx.workflow.bekliyorEvrak,
      nextDeadline: ctx.deadlines[0] || null,
      ...(parsed.metrics || {}),
    };

    // Maliyet logu — Max ise 'brifing-max' (ücretli tavandan HARİÇ), değilse ücretli 'brifing'
    try {
      if (usedSource === 'brifing-max') {
        await logAiUsage(this.prisma, {
          tenantId, source: 'brifing-max', model: MAX_MODEL_CHEAP,
          fixedCostUsd: 0, karar: 'ok', durationMs: 0,
        });
      } else {
        await this.prisma.aiUsageLog.create({
          data: {
            tenantId, source: 'brifing', model: DEFAULT_MODEL,
            inputTokens: apiInputTokens, outputTokens: apiOutputTokens, cacheReadTokens: 0, cacheWriteTokens: 0,
            costUsd: computeCostUsd(DEFAULT_MODEL, { input: apiInputTokens, output: apiOutputTokens, cacheRead: 0, cacheWrite: 0 }),
            karar: 'ok', durationMs: 0,
          },
        });
      }
    } catch {}

    const generatedAt = new Date();
    this.brifingCache.set(cacheKey, { payload: parsed, generatedAt });
    return { ...parsed, generatedAt: generatedAt.toISOString(), fromCache: false };
  }

  /** Genişletilmiş bağlam — workflow + deadlines + agents + 7-day trend + last hour activity */
  private async buildBrifingContext(tenantId: string, userId?: string | null): Promise<BrifingContext> {
    const now = new Date();
    const trNow = turkeyClock(now);
    const year = trNow.year;
    const month = trNow.month;
    const day = trNow.day;
    const todayStart = new Date(year, month - 1, day); todayStart.setHours(0, 0, 0, 0);

    // v1.36.83: Kullanıcının adını dinamik çek — hardcoded "Muzaffer Bey" gitmiş olur
    let userFirstName = 'kullanıcı';
    if (userId) {
      try {
        const u = await this.prisma.user.findFirst({ where: { id: userId }, select: { firstName: true } });
        userFirstName = cleanFirstName(u?.firstName) || 'kullanıcı';
      } catch {}
    }
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const sevenDaysOut = new Date(now.getTime() + 7 * 86400000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // --- WORKFLOW DURUMU
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0, 23, 59, 59);
    const period = `${year}-${String(month).padStart(2, '0')}`;
    const taxpayers = await this.prisma.taxpayer.findMany({
      where: {
        tenantId,
        isActive: true,
        OR: [{ startDate: null }, { startDate: { lte: lastDay } }],
        AND: [{ OR: [{ endDate: null }, { endDate: { gte: firstDay } }] }],
      },
      select: { id: true, companyName: true, firstName: true, lastName: true, isActive: true, startDate: true },
    });
    const monthlyStatuses = taxpayers.length
      ? await this.prisma.taxpayerMonthlyStatus.findMany({
          where: { tenantId, year, month, taxpayerId: { in: taxpayers.map((t) => t.id) } },
        })
      : [];
    const statusMap = new Map(monthlyStatuses.map((s: any) => [s.taxpayerId, s]));
    const aktif = taxpayers.map((taxpayer: any) => ({
      ...(statusMap.get(taxpayer.id) || {
        id: `virtual-${taxpayer.id}-${year}-${month}`,
        updatedAt: taxpayer.startDate || firstDay,
        evraklarGeldi: false,
        evraklarIslendi: false,
        kontrolEdildi: false,
        beyannameVerildi: false,
        indirilecekKdvKontrol: false,
        hesaplananKdvKontrol: false,
        eArsivKontrol: false,
      }),
      taxpayer,
    }));
    let bekliyorEvrak = 0, isleniyor = 0, kontrol = 0, beyan = 0, tamam = 0;
    let enUzunBekleyen: { ad: string; gun: number; stage: string; id: string } | null = null;
    let toplamBekleyenGun = 0, sayilanBekleyen = 0;
    const eskiBeklemeler: Array<{ ad: string; gun: number; stage: string }> = [];
    for (const s of aktif as any[]) {
      const kdvHepsi = s.indirilecekKdvKontrol && s.hesaplananKdvKontrol && s.eArsivKontrol;
      let stage: string;
      if (s.beyannameVerildi) { stage = 'TAMAM'; tamam++; }
      else if (s.kontrolEdildi || kdvHepsi) { stage = 'BEYAN'; beyan++; }
      else if (s.evraklarIslendi) { stage = 'KONTROL'; kontrol++; }
      else if (s.evraklarGeldi) { stage = 'ISLENIYOR'; isleniyor++; }
      else { stage = 'EVRAK_BEKLIYOR'; bekliyorEvrak++; }
      if (stage !== 'TAMAM' && stage !== 'EVRAK_BEKLIYOR') {
        const gun = Math.floor((now.getTime() - new Date(s.updatedAt).getTime()) / 86400000);
        toplamBekleyenGun += gun;
        sayilanBekleyen++;
        const ad = s.taxpayer?.companyName || `${s.taxpayer?.firstName ?? ''} ${s.taxpayer?.lastName ?? ''}`.trim();
        if (!enUzunBekleyen || gun > enUzunBekleyen.gun) {
          enUzunBekleyen = { ad, gun, stage, id: s.taxpayer.id };
        }
        if (gun >= 5) eskiBeklemeler.push({ ad, gun, stage });
      }
    }
    const ortalamaBekleme = sayilanBekleyen > 0 ? Math.round(toplamBekleyenGun / sayilanBekleyen) : 0;
    eskiBeklemeler.sort((a, b) => b.gun - a.gun);

    // --- BU HAFTA SON TARİHLER
    const deadlines = this.buildTaxDeadlines(year, month, day);

    // --- GÖREVLER
    let bugunGorev = 0, haftaGorev = 0, geciken = 0;
    try {
      const tasks = await (this.prisma as any).task.findMany({
        where: {
          tenantId,
          isTemplate: false,
          status: { in: ['OPEN', 'IN_PROGRESS', 'MISSED'] },
          dueDate: { lte: sevenDaysOut },
        },
        select: { dueDate: true, title: true },
      });
      for (const t of tasks as any[]) {
        const d = new Date(t.dueDate); d.setHours(0, 0, 0, 0);
        haftaGorev++;
        if (d.getTime() === todayStart.getTime()) bugunGorev++;
        if (d.getTime() < todayStart.getTime()) geciken++;
      }
    } catch {}

    // --- AJAN ÖZETİ (bugün ve geçen 7 gün)
    let bugunOlay = 0, bugunHata = 0, bugunBasarili = 0;
    let haftaOlay = 0, haftaHata = 0;
    let sonSaatOlay = 0;
    try {
      const events = await (this.prisma as any).agentEvent.findMany({
        where: { tenantId, ts: { gte: sevenDaysAgo } },
        select: { status: true, ts: true, agent: true },
      });
      for (const e of events as any[]) {
        const status = String(e.status || '').toUpperCase();
        const isHata = ['HATA', 'ERROR', 'FAIL', 'FAILED', 'HATALI'].includes(status);
        const isOk = ['OK', 'KAYDET', 'BASARILI', 'SUCCESS', 'ONAYLANDI', 'ONAY', 'DONE', 'TAMAMLANDI'].includes(status);
        haftaOlay++;
        if (isHata) haftaHata++;
        const eventTs = new Date(e.ts);
        if (eventTs >= todayStart) {
          bugunOlay++;
          if (isHata) bugunHata++;
          if (isOk) bugunBasarili++;
        }
        if (eventTs >= oneHourAgo) sonSaatOlay++;
      }
    } catch {}
    const haftaBasariOrani = haftaOlay > 0 ? Math.round(((haftaOlay - haftaHata) / haftaOlay) * 100) : null;
    const bugunBasariOrani = bugunOlay > 0 ? Math.round((bugunBasarili / bugunOlay) * 100) : null;

    // --- KRİTİK UYARI SAYISI (sistem sağlık + kilitli modül drift'i)
    let okunmamisBildirim = 0;
    try {
      const cnt = await (this.prisma as any).notification.count({
        where: { tenantId, isRead: false },
      });
      okunmamisBildirim = cnt;
    } catch {}

    const portal: BrifingContext['portal'] = {
      luca: { pending: 0, running: 0, failed: 0 },
      mihsap: { pending: 0, running: 0, failed: 0, invoiceCount: 0 },
      finance: { borcluMukellef: 0, toplamBakiye: 0 },
      automation: { active: 0, error: 0, failedRuns: 0 },
      approval: { pendingDecisions: 0, pendingCommands: 0, failedCommands: 0 },
    };
    try {
      const recentFailureSince = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const [
        lucaPending, lucaRunning, lucaFailed,
        mihsapPending, mihsapRunning, mihsapFailed, mihsapInvoiceCount,
        cariRows,
        automationActive, automationError, automationFailedRuns,
        pendingDecisions,
        pendingCommands, failedCommands,
      ] = await Promise.all([
        (this.prisma as any).lucaFetchJob.count({ where: { tenantId, donem: period, status: 'pending' } }).catch(() => 0),
        (this.prisma as any).lucaFetchJob.count({ where: { tenantId, donem: period, status: 'running' } }).catch(() => 0),
        (this.prisma as any).lucaFetchJob.count({
          where: {
            tenantId,
            donem: period,
            status: 'failed',
            OR: [
              { finishedAt: { gte: recentFailureSince } },
              { finishedAt: null, createdAt: { gte: recentFailureSince } },
            ],
          },
        }).catch(() => 0),
        (this.prisma as any).mihsapFetchJob.count({ where: { tenantId, donem: period, status: 'pending' } }).catch(() => 0),
        (this.prisma as any).mihsapFetchJob.count({ where: { tenantId, donem: period, status: 'running' } }).catch(() => 0),
        (this.prisma as any).mihsapFetchJob.count({
          where: {
            tenantId,
            donem: period,
            status: 'failed',
            OR: [
              { finishedAt: { gte: recentFailureSince } },
              { finishedAt: null, createdAt: { gte: recentFailureSince } },
            ],
          },
        }).catch(() => 0),
        (this.prisma as any).mihsapInvoice.count({ where: { tenantId, donem: period } }).catch(() => 0),
        (this.prisma as any).cariHareket.findMany({ where: { tenantId }, select: { taxpayerId: true, tip: true, tutar: true } }).catch(() => []),
        (this.prisma as any).automation?.count ? (this.prisma as any).automation.count({ where: { tenantId, status: 'ACTIVE' } }).catch(() => 0) : Promise.resolve(0),
        (this.prisma as any).automation?.count ? (this.prisma as any).automation.count({ where: { tenantId, status: 'ERROR' } }).catch(() => 0) : Promise.resolve(0),
        (this.prisma as any).automationRun?.count ? (this.prisma as any).automationRun.count({ where: { automation: { tenantId }, status: { in: ['failure', 'partial'] } } }).catch(() => 0) : Promise.resolve(0),
        (this.prisma as any).pendingDecision?.count ? (this.prisma as any).pendingDecision.count({ where: { tenantId, durum: 'bekliyor' } }).catch(() => 0) : Promise.resolve(0),
        (this.prisma as any).agentCommand.count({ where: { tenantId, status: { in: ['pending', 'running'] } } }).catch(() => 0),
        (this.prisma as any).agentCommand.count({ where: { tenantId, status: 'failed' } }).catch(() => 0),
      ]);

      const cariByTaxpayer = new Map<string, number>();
      for (const h of cariRows || []) {
        const tutar = Number(h.tutar || 0);
        const sign = h.tip === 'TAHAKKUK' || h.tip === 'IADE' ? 1 : h.tip === 'TAHSILAT' ? -1 : 0;
        cariByTaxpayer.set(h.taxpayerId, (cariByTaxpayer.get(h.taxpayerId) || 0) + sign * tutar);
      }
      const borclular = [...cariByTaxpayer.values()].filter((v) => v > 0);
      portal.luca = { pending: lucaPending, running: lucaRunning, failed: lucaFailed };
      portal.mihsap = { pending: mihsapPending, running: mihsapRunning, failed: mihsapFailed, invoiceCount: mihsapInvoiceCount };
      portal.finance = {
        borcluMukellef: borclular.length,
        toplamBakiye: Math.round(borclular.reduce((sum, value) => sum + value, 0)),
      };
      portal.automation = { active: automationActive, error: automationError, failedRuns: automationFailedRuns };
      portal.approval = { pendingDecisions, pendingCommands, failedCommands };
    } catch {}

    return {
      now,
      year, month, day,
      saat: trNow.hour,
      tarihUzun: now.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      userFirstName,
      workflow: { bekliyorEvrak, isleniyor, kontrol, beyan, tamam, total: aktif.length },
      enUzunBekleyen,
      ortalamaBekleme,
      eskiBeklemeler,
      deadlines,
      gorev: { bugun: bugunGorev, hafta: haftaGorev, geciken },
      ajan: { bugunOlay, bugunHata, bugunBasariOrani, haftaOlay, haftaHata, haftaBasariOrani, sonSaatOlay },
      okunmamisBildirim,
      portal,
      metrics: {
        aktifMukellef: aktif.length,
        aktifIsYuku: isleniyor + kontrol + beyan,
        bugunHata,
        haftaBasariOrani,
        ortalamaBekleme,
        lucaBekleyen: portal.luca.pending + portal.luca.running,
        lucaHata: portal.luca.failed,
        mihsapBekleyen: portal.mihsap.pending + portal.mihsap.running,
        mihsapHata: portal.mihsap.failed,
        mihsapFatura: portal.mihsap.invoiceCount,
        borcluMukellef: portal.finance.borcluMukellef,
        toplamBakiye: portal.finance.toplamBakiye,
        otomasyonHata: portal.automation.error + portal.automation.failedRuns,
        bekleyenOnay: portal.approval.pendingDecisions,
      },
    };
  }

  private buildTaxDeadlines(year: number, month: number, day: number): BrifingDeadline[] {
    const today = utcNoon(year, month, day);
    const lastDay = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
    const deadlines: BrifingDeadline[] = [];

    for (const rule of TAX_DEADLINE_RULES) {
      if (rule.months && !rule.months.includes(month)) continue;
      const originalDay = rule.day === 'last' ? lastDay : rule.day;
      const nominal = utcNoon(year, month, originalDay);
      const adjusted = nextBusinessDate(nominal);
      const gunFark = diffDays(today, adjusted);
      if (gunFark < 0 || gunFark > 7) continue;

      deadlines.push({
        gun: adjusted.getUTCDate(),
        originalGun: originalDay,
        shifted: adjusted.getUTCDate() !== originalDay,
        tip: rule.tip,
        gunFark,
        source: 'calendar',
      });
    }

    return deadlines.sort((a, b) => a.gunFark - b.gunFark);
  }

  /** Profesyonel sistem prompt — JSON dönüşü ister */
  private buildBrifingPrompt(c: BrifingContext): string {
    const saat = c.saat;
    const moodHint = saat < 6 ? 'gece' : saat < 12 ? 'sabah' : saat < 18 ? 'gündüz' : 'akşam';
    const donemTonu = c.day <= 12
      ? 'erken dönem: evrakların yeni gelmesi normal; evrak bekleyenleri "takılı/gecikti" diye yargılama, nazik takip ve hazırlık öner.'
      : c.day <= 16
        ? 'hazırlık dönemi: takip dili netleşsin ama panik dili kullanma; son tarih yaklaşırken öncelik listesi öner.'
        : 'kritik dönem: son tarih yaklaştı/geçtiyse net uyar; geciken işlerde açık ve doğrudan konuş.';
    const allowedRoutes = [
      '/panel/is-yuku',
      '/panel/gorevler',
      '/panel/beyannameler',
      '/panel/kdv-kontrol',
      '/panel/ajanlar/mihsap',
      '/panel/mukellefler',
      '/panel/faturalar',
      '/panel/fatura-isleme',
      '/panel/cari-kasa',
      '/panel/banka-takip',
      '/panel/ajanlar',
      '/panel/otomasyonlar',
      '/panel/onay-kuyrugu',
    ].join(', ');

    return `Sen ${c.userFirstName}'in mali müşavirlik ofisini analiz eden profesyonel bir AI asistanısın. Sayıları okur, anlam çıkarır, AKSİYON ÖNERİSİ sunarsın. Kısa, net, profesyonel Türkçe yazarsın. Gerektiğinde ofisi nazikçe eleştirirsin; aksayan iş varsa üstünü örtmezsin. Tonun canlıdır: küçük bir espri veya tatlı iğneleme kullanabilirsin ama kritik uyarılarda ciddiyeti bozmazsın.

# OFİS DURUMU (${c.tarihUzun}, ${moodHint} saat ${saat})

## Dil ve Takvim Mantığı
- Bugün ayın ${c.day}'i; dönem tonu: ${donemTonu}
- Brifing takvim bilgisini aşağıdaki "Bu Hafta Son Tarihler" bölümünden alır. Son tarih yoksa son tarih uyarısı üretme.
- Ayın 1-12'sinde evrak bekleyen mükellefler için "takılı", "gecikti", "hemen talep et", "hemen harekete geç", "hızlandırılmalı" gibi sert ifadeler kullanma. "takip listesi hazırla", "nazik hatırlatma planı çıkar", "gelişi izleyelim" gibi öneri dili kullan.
- Ayın 13-16'sında dil hazırlık/önceliklendirme dili olsun.
- Ayın 17'si ve sonrası ya da son tarihe 3 gün kaldıysa net uyarı dili kullanabilirsin.
- suggestions.href sadece şu rotalardan biri olabilir: ${allowedRoutes}
- "yapı taşla" gibi anlamsız ifade kullanma; "planla", "önceliklendir", "listeyi aç" gibi açık fiil kullan.

## İş Akışı
- Bu ay iş akışına alınmış ${c.workflow.total} aktif mükellef:
  - ${c.workflow.bekliyorEvrak} mükellef evrak bekliyor
  - ${c.workflow.isleniyor} mükellef evrakları işlenmeyi bekliyor
  - ${c.workflow.kontrol} mükellef KDV kontrol bekliyor
  - ${c.workflow.beyan} mükellef beyanname hazırlanacak
  - ${c.workflow.tamam} mükellef tamamlandı
${c.enUzunBekleyen ? `- En uzun bekleyen: "${c.enUzunBekleyen.ad}" ${c.enUzunBekleyen.gun} gündür ${c.enUzunBekleyen.stage} aşamasında` : '- Aktif iş yok'}
- Ortalama bekleme süresi: ${c.ortalamaBekleme} gün
- 5+ gün geciken: ${c.eskiBeklemeler.length} mükellef${c.eskiBeklemeler.length > 0 ? ` (örn: ${c.eskiBeklemeler.slice(0, 3).map((e) => `${e.ad} ${e.gun}gün`).join(', ')})` : ''}

## Bu Hafta Son Tarihler
${c.deadlines.length === 0 ? '- Bu hafta yaklaşan beyanname yok' : c.deadlines.map((d) => `- ${d.gunFark === 0 ? 'BUGÜN' : d.gunFark === 1 ? 'YARIN' : `${d.gunFark} gün sonra`} (${d.gun}'i): ${d.tip}`).join('\n')}

## Görevler
- Bugün ${c.gorev.bugun} görev
- Bu hafta ${c.gorev.hafta} görev
- Geciken: ${c.gorev.geciken}

## Ajanlar
- Bugün ${c.ajan.bugunOlay} olay (${c.ajan.bugunHata} hata${c.ajan.bugunBasariOrani != null ? `, başarı %${c.ajan.bugunBasariOrani}` : ''})
- Son saatte ${c.ajan.sonSaatOlay} olay
- 7 günlük başarı oranı: ${c.ajan.haftaBasariOrani != null ? '%' + c.ajan.haftaBasariOrani : 'veri yok'}

## Portal Geneli Sinyaller
- Luca çekimleri: ${c.portal.luca.pending} bekleyen, ${c.portal.luca.running} çalışan, ${c.portal.luca.failed} hata
- Mihsap fatura çekimleri: ${c.portal.mihsap.pending} bekleyen, ${c.portal.mihsap.running} çalışan, ${c.portal.mihsap.failed} hata, bu dönem ${c.portal.mihsap.invoiceCount} fatura
- Tahsilat/cari: ${c.portal.finance.borcluMukellef} mükellefte açık bakiye, toplam ${c.portal.finance.toplamBakiye} TL
- Otomasyonlar: ${c.portal.automation.active} aktif, ${c.portal.automation.error} hata durumunda, ${c.portal.automation.failedRuns} sorunlu çalışma
- Onay kuyruğu: ${c.portal.approval.pendingDecisions} AI kararı, ${c.portal.approval.pendingCommands} ajan komutu bekliyor, ${c.portal.approval.failedCommands} komut hata aldı

## Diğer
- ${c.okunmamisBildirim} okunmamış bildirim

# ÇIKTI FORMATI

SADECE aşağıdaki JSON formatında cevap ver, başka hiçbir şey yazma (markdown code fence dahi):

{
  "summary": "Tek kısa cümle; en fazla 150 karakter. Firma/mükellef adı yazma. Sayı + aksiyon ver, uzun açıklama yapma.",
  "motivation": "Sağ üstte gösterilecek tek kısa AI motivasyon cümlesi. En fazla 72 karakter.",
  "alerts": [
    { "severity": "high|medium|low", "text": "Acil dikkat çeken konu; firma/mükellef adı yazma", "href": "/panel/is-yuku" }
  ],
  "suggestions": [
    { "text": "Aksiyon önerisi (örn: 'Mihsap'tan faturaları işle')", "href": "/panel/ajanlar/mihsap", "icon": "Receipt|FileText|FileCheck|Bell|Sparkles" }
  ],
  "focus": "calm|busy|critical|review",
  "metrics": { "aktifIsYuku": ${c.metrics.aktifIsYuku}, "haftaBasariOrani": ${c.metrics.haftaBasariOrani ?? 'null'}, "geciken": ${c.gorev.geciken} }
}

KURALLAR:
- summary: 150 karakteri geçmesin, tek cümle. Firma/mükellef adı yazma; kullanıcıya doğal ve kısa hitap et — adını söyleyebilirsin ("${c.userFirstName}") ama "Bey/Hanım" eki ekleme, sade kullan.
- summary ve motivation içinde "şunları taradım", "Luca/Mihsap/KDV okundu", "portal verisi tarandı" gibi kaynak sayma cümlesi yazma. Kartta sadece sonuç ve odak görünsün.
- motivation: tek cümle, sıcak ama kısa. Sayı, modül adı veya yapılacak iş detayı yazma. Örnek: "Sırayı sakin tutalım; birkaç net hamle günü toparlar."
- alerts: 0-3 madde. Sadece gerçekten dikkat gerektiren konular. Firma/mükellef adı yazma. Boş varsa boş array.
- suggestions: 1-3 madde. Tıklanabilir somut aksiyon. icon Lucide isim.
- focus: tek kelime. calm=her şey iyi, busy=normal yoğun, critical=acil işler var, review=ay sonu/kontrol günü
- Eleştiri varsa net ve çözüm odaklı olsun; mizah varsa tek cümleyi geçmesin.
- Sadece JSON yaz. Başına/sonuna hiçbir metin/markdown ekleme.
- Türkçe, profesyonel ton, samimi ama mesafeli.`;
  }

  /** API anahtarı yoksa veya AI hata verirse — sayılardan deterministic payload */
  private buildFallbackPayload(c: BrifingContext): BrifingPayload {
    const aktifIsYuku = c.workflow.isleniyor + c.workflow.kontrol + c.workflow.beyan;
    const erkenDonem = c.day <= 12;
    const hazirlikDonemi = c.day > 12 && c.day <= 16;
    const netUyariDonemi = c.day >= 17;
    const alertCandidates: Array<BrifingPayload['alerts'][number] & { score: number }> = [];
    const suggestionCandidates: Array<BrifingPayload['suggestions'][number] & { score: number }> = [];
    const issueScores: Array<{ source: BrifingSourceKey; score: number }> = [];
    let focus: BrifingFocus = aktifIsYuku > 0 ? 'busy' : 'calm';
    let summary = '';

    const addAlert = (score: number, source: BrifingSourceKey, severity: BrifingSeverity, text: string, href: string) => {
      alertCandidates.push({ id: briefingId(`${source}-alert`, text), score, source, severity, text, href });
      issueScores.push({ source, score });
    };
    const addSuggestion = (score: number, source: BrifingSourceKey, text: string, href: string, icon: string) => {
      suggestionCandidates.push({ id: briefingId(`${source}-action`, text), score, source, text, href, icon });
      issueScores.push({ source, score });
    };
    const formatAmount = (value: number) => {
      const abs = Math.abs(value);
      if (abs >= 1_000_000) return `${(value / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} milyon TL`;
      return `${Math.round(value).toLocaleString('tr-TR')} TL`;
    };

    const lucaBekleyen = c.portal.luca.pending + c.portal.luca.running;
    if (c.portal.luca.failed > 0) addAlert(98, 'luca', 'high', `${c.portal.luca.failed} Luca çekimi hata aldı; logları kontrol et`, '/panel/ajanlar');
    if (lucaBekleyen > 0) addSuggestion(94, 'luca', `${lucaBekleyen} Luca çekimini kontrol et`, '/panel/ajanlar', 'RefreshCw');

    const mihsapBekleyen = c.portal.mihsap.pending + c.portal.mihsap.running;
    if (c.portal.mihsap.failed > 0) addAlert(96, 'mihsap', 'high', `${c.portal.mihsap.failed} Mihsap fatura çekimi hata aldı`, '/panel/faturalar');
    if (mihsapBekleyen > 0) addSuggestion(91, 'mihsap', `${mihsapBekleyen} Mihsap fatura çekimini aç`, '/panel/faturalar', 'Receipt');
    if (c.portal.mihsap.invoiceCount > 0 && mihsapBekleyen === 0 && c.portal.mihsap.failed === 0) {
      addSuggestion(58, 'mihsap', `${c.portal.mihsap.invoiceCount} faturanın işlem durumunu kontrol et`, '/panel/fatura-isleme', 'Receipt');
    }

    const financeScore = c.portal.finance.toplamBakiye >= 100_000 ? 86 : c.portal.finance.borcluMukellef >= 5 ? 78 : 62;
    if (c.portal.finance.borcluMukellef > 0) {
      if (c.portal.finance.borcluMukellef >= 5 || c.portal.finance.toplamBakiye >= 100_000) {
        addAlert(
          financeScore,
          'finance',
          c.portal.finance.toplamBakiye >= 250_000 ? 'high' : 'medium',
          `${c.portal.finance.borcluMukellef} mükellefte ${formatAmount(c.portal.finance.toplamBakiye)} açık bakiye var`,
          '/panel/cari-kasa',
        );
      }
      addSuggestion(financeScore - 2, 'finance', 'Riskli carileri sırala', '/panel/cari-kasa', 'Bell');
    }

    const automationIssue = c.portal.automation.error + c.portal.automation.failedRuns + c.ajan.bugunHata;
    if (automationIssue > 0) {
      addAlert(
        automationIssue >= 5 ? 93 : 82,
        'automation',
        automationIssue >= 5 ? 'high' : 'medium',
        `${automationIssue} otomasyon/ajan uyarısı kontrol istiyor`,
        '/panel/otomasyonlar',
      );
      addSuggestion(automationIssue >= 5 ? 92 : 80, 'automation', 'Ajan ve otomasyon hatalarını incele', '/panel/otomasyonlar', 'Zap');
    }

    const totalApproval = c.portal.approval.pendingDecisions + c.portal.approval.pendingCommands;
    if (totalApproval > 0) addSuggestion(76, 'approval', `${totalApproval} onay bekleyen aksiyonu aç`, '/panel/onay-kuyrugu', 'FileCheck');
    if (c.portal.approval.failedCommands > 0) addAlert(84, 'approval', 'medium', `${c.portal.approval.failedCommands} ajan komutu hata aldı`, '/panel/onay-kuyrugu');

    if (c.eskiBeklemeler.length > 0 && !erkenDonem) {
      const text = `${c.eskiBeklemeler.length} iş 5+ gündür aynı aşamada; en eski kayıt ${c.eskiBeklemeler[0].gun} gündür bekliyor`;
      addAlert(netUyariDonemi ? 90 : 74, 'workflow', netUyariDonemi ? 'high' : 'medium', text, '/panel/is-yuku?late=1');
    }

    const yakin = c.deadlines.find((d) => d.gunFark <= 1);
    if (yakin) {
      const shifted = yakin.shifted && yakin.originalGun ? ` (${yakin.originalGun}'den iş gününe kaydı)` : '';
      const text = `${yakin.gunFark === 0 ? 'Bugün' : 'Yarın'}: ${yakin.tip} son tarih${shifted}`;
      addAlert(yakin.gunFark === 0 ? 95 : 83, 'calendar', yakin.gunFark === 0 ? 'high' : 'medium', text, '/panel/beyannameler');
    }

    if (c.gorev.geciken > 0) {
      const text = `${c.gorev.geciken} görev son tarihini geçmiş`;
      addAlert(c.gorev.geciken >= 3 ? 88 : 70, 'tasks', c.gorev.geciken >= 3 ? 'high' : 'medium', text, '/panel/gorevler');
    }

    if (c.ajan.bugunHata >= 3 && automationIssue === 0) {
      addAlert(c.ajan.bugunHata >= 5 ? 91 : 78, 'agents', c.ajan.bugunHata >= 5 ? 'high' : 'medium', `Bugün ${c.ajan.bugunHata} ajan hatası var; logları kontrol et`, '/panel/ajanlar');
    }

    if (c.workflow.bekliyorEvrak > 0 && erkenDonem) addSuggestion(56, 'workflow', 'Evrak takip listesini hazırla', '/panel/mukellefler?filter=evrak-gelmedi', 'FileText');
    if (c.workflow.bekliyorEvrak > 0 && hazirlikDonemi) addSuggestion(66, 'workflow', `${c.workflow.bekliyorEvrak} evrak bekleyen için takip planı aç`, '/panel/mukellefler?filter=evrak-gelmedi', 'FileText');
    if (c.workflow.bekliyorEvrak > 0 && netUyariDonemi) addSuggestion(82, 'workflow', `${c.workflow.bekliyorEvrak} evrak bekleyen kaydı sırala`, '/panel/mukellefler?filter=evrak-gelmedi', 'FileText');
    if (c.workflow.isleniyor > 0) addSuggestion(72, 'workflow', `${c.workflow.isleniyor} işleme bekleyen kaydı aç`, '/panel/is-yuku?stage=ISLENMEYI_BEKLIYOR', 'Receipt');
    if (c.workflow.kontrol > 0) addSuggestion(74, 'workflow', `${c.workflow.kontrol} KDV kontrolünü sıraya al`, '/panel/kdv-kontrol', 'FileCheck');
    if (c.workflow.beyan > 0) addSuggestion(73, 'workflow', `${c.workflow.beyan} beyanname hazırlığını aç`, '/panel/beyannameler', 'FileText');
    if (suggestionCandidates.length === 0) addSuggestion(40, 'workflow', 'İş Akışı sayfasına git', '/panel/is-yuku', 'Sparkles');

    issueScores.sort((a, b) => b.score - a.score);
    const topIssue = issueScores[0];
    if (topIssue?.score >= 90) focus = 'critical';
    else if (topIssue?.score >= 74) focus = 'review';
    else if (topIssue?.score >= 50) focus = 'busy';

    if (c.portal.luca.failed > 0 || lucaBekleyen > 0) {
      const total = c.portal.luca.failed + lucaBekleyen;
      summary = `Luca çekiminde ${total} iş bekliyor; fatura akışını açmak iyi olur.`;
    } else if (c.portal.mihsap.failed > 0 || mihsapBekleyen > 0) {
      const total = c.portal.mihsap.failed + mihsapBekleyen;
      summary = `${total} Mihsap fatura işi kontrol istiyor; fatura akışını toparlayalım.`;
    } else if (c.portal.finance.borcluMukellef > 0 && (c.portal.finance.borcluMukellef >= 5 || c.portal.finance.toplamBakiye >= 100_000)) {
      summary = `${c.portal.finance.borcluMukellef} mükellefte açık bakiye var; tahsilat listesini öne al.`;
    } else if (automationIssue > 0) {
      summary = `${automationIssue} otomasyon/ajan uyarısı var; logları temizlemek günü rahatlatır.`;
    } else if (aktifIsYuku === 0) {
      summary = c.workflow.total === 0
        ? `${c.userFirstName}, bu ay iş akışında kayıt yok; liste doluysa veri akışını kontrol edelim.`
        : erkenDonem
          ? `${c.userFirstName}, ayın ilk akışındayız; evrak gelişini izleyip takip listesini hazırlamak iyi olur.`
          : `${c.userFirstName}, aktif iş yükü yok; bekleyen evrak varsa kısa bir kontrol iyi olur.`;
    } else {
      const parcalar: string[] = [];
      if (c.workflow.kontrol > 0) parcalar.push(`${c.workflow.kontrol} KDV kontrol`);
      if (c.workflow.beyan > 0) parcalar.push(`${c.workflow.beyan} beyanname`);
      if (c.workflow.isleniyor > 0) parcalar.push(`${c.workflow.isleniyor} işlem`);
      summary = `${c.userFirstName}, ${aktifIsYuku} aktif iş var: ${parcalar.join(', ')}.`;
      summary += c.eskiBeklemeler.length > 0
        ? ` ${c.eskiBeklemeler.length} kayıt 5+ gündür aynı aşamada bekliyor.`
        : ' Sırayı bozmadan ilerlersek tablo temiz kalır.';
    }

    const motivationBySource: Record<BrifingSourceKey, string> = {
      luca: 'Önceliği net tutalım; akış bugün toparlanır.',
      mihsap: 'Dağınık başlıkları sadeleştirelim; sıra hızlanır.',
      finance: 'Odağı koruyalım; net liste günü rahatlatır.',
      automation: 'Küçük pürüzleri kapatalım; yarın daha hafif başlar.',
      agents: 'Akışı sakinleştirelim; düzenli sistem günü taşır.',
      approval: 'Bekleyenleri netleştirelim; masa hızla ferahlar.',
      calendar: 'Takvimi öne alalım; günü sakin kapatalım.',
      tasks: 'Küçük kapanışlar büyük rahatlık getirir.',
      workflow: c.eskiBeklemeler.length > 0
        ? 'Önceliği sadeleştirelim; gün kendini toplar.'
        : 'Sırayı sakin tutalım; birkaç net hamle günü toparlar.',
      notifications: 'Bildirimleri süzelim; önemli olanlar masada kalsın.',
    };
    const motivation = motivationBySource[topIssue?.source || 'workflow'];
    const alerts = alertCandidates.sort((a, b) => b.score - a.score).slice(0, 3).map(({ score: _score, ...a }) => a);
    const suggestions = suggestionCandidates.sort((a, b) => b.score - a.score).slice(0, 3).map(({ score: _score, ...s }) => s);

    const sourceTags: BrifingSourceTag[] = [
      { key: 'workflow', label: 'İş Akışı', count: c.workflow.total },
      ...(c.deadlines.length ? [{ key: 'calendar' as const, label: 'Takvim', count: c.deadlines.length }] : []),
      ...(c.gorev.bugun + c.gorev.geciken > 0 ? [{ key: 'tasks' as const, label: 'Görev', count: c.gorev.bugun + c.gorev.geciken }] : []),
      ...(c.ajan.bugunHata > 0 ? [{ key: 'agents' as const, label: 'Ajan', count: c.ajan.bugunHata }] : []),
      ...(c.portal.luca.pending + c.portal.luca.running + c.portal.luca.failed > 0 ? [{ key: 'luca' as const, label: 'Luca', count: c.portal.luca.pending + c.portal.luca.running + c.portal.luca.failed }] : []),
      ...(c.portal.mihsap.pending + c.portal.mihsap.running + c.portal.mihsap.failed > 0 ? [{ key: 'mihsap' as const, label: 'Mihsap', count: c.portal.mihsap.pending + c.portal.mihsap.running + c.portal.mihsap.failed }] : []),
      ...(c.portal.finance.borcluMukellef > 0 ? [{ key: 'finance' as const, label: 'Cari', count: c.portal.finance.borcluMukellef }] : []),
      ...(c.portal.automation.error + c.portal.automation.failedRuns > 0 ? [{ key: 'automation' as const, label: 'Otomasyon', count: c.portal.automation.error + c.portal.automation.failedRuns }] : []),
      ...(c.portal.approval.pendingDecisions + c.portal.approval.pendingCommands > 0 ? [{ key: 'approval' as const, label: 'Onay', count: c.portal.approval.pendingDecisions + c.portal.approval.pendingCommands }] : []),
      ...(c.okunmamisBildirim > 0 ? [{ key: 'notifications' as const, label: 'Bildirim', count: c.okunmamisBildirim }] : []),
    ];

    const todayItems = [
      `${c.workflow.total} aktif mükellef, ${aktifIsYuku} aktif iş`,
      c.gorev.bugun > 0 ? `${c.gorev.bugun} görev bugün tarihli` : 'Bugün tarihli açık görev yok',
      c.deadlines[0]
        ? `${c.deadlines[0].gunFark === 0 ? 'Bugün' : `${c.deadlines[0].gunFark} gün sonra`}: ${c.deadlines[0].tip}`
        : 'Bu hafta görünen son tarih yok',
    ];
    const riskItems = [
      c.portal.luca.failed + c.portal.mihsap.failed > 0 ? `${c.portal.luca.failed + c.portal.mihsap.failed} çekim işi hata aldı` : '',
      c.portal.finance.borcluMukellef > 0 ? `${c.portal.finance.borcluMukellef} açık bakiyeli mükellef` : '',
      c.eskiBeklemeler.length > 0 ? `${c.eskiBeklemeler.length} iş 5+ gündür aynı aşamada` : '5+ gün bekleyen kritik akış yok',
      c.gorev.geciken > 0 ? `${c.gorev.geciken} görev gecikmiş` : 'Geciken görev görünmüyor',
      c.ajan.bugunHata > 0 ? `${c.ajan.bugunHata} ajan hatası izlenmeli` : 'Bugün ajan hatası yok',
    ].filter(Boolean);

    return {
      summary: this.cleanBrifingActionText(summary),
      motivation: this.cleanBrifingMotivation(motivation, motivationBySource.workflow),
      alerts: alerts.map((a) => ({ ...a, text: this.cleanBrifingActionText(a.text), href: a.href ? this.normalizeBrifingHref(a.href) : undefined })),
      suggestions: suggestions.map((s) => ({ ...s, href: this.normalizeBrifingHref(s.href), text: this.cleanBrifingActionText(s.text) })),
      focus,
      sourceTags,
      sections: [
        { key: 'today', title: 'Bugün', items: todayItems.slice(0, 3).map((t) => this.cleanBrifingActionText(t)) },
        { key: 'risk', title: 'Risk', items: riskItems.slice(0, 3).map((t) => this.cleanBrifingActionText(t)) },
        { key: 'action', title: 'Aksiyon', items: suggestions.slice(0, 3).map((s) => this.cleanBrifingActionText(s.text)) },
      ],
      metrics: {
        ...c.metrics,
        lucaBekleyen,
        lucaHata: c.portal.luca.failed,
        mihsapBekleyen,
        mihsapHata: c.portal.mihsap.failed,
        borcluMukellef: c.portal.finance.borcluMukellef,
        toplamBakiye: c.portal.finance.toplamBakiye,
        otomasyonSorun: automationIssue,
        bekleyenOnay: totalApproval,
        day: c.day,
        periodTone: erkenDonem ? 'early' : hazirlikDonemi ? 'prepare' : 'firm',
        bekliyorEvrak: c.workflow.bekliyorEvrak,
        nextDeadline: c.deadlines[0] || null,
      },
    };
  }

  private applyRuleDecisions(aiPayload: BrifingPayload, rulePayload: BrifingPayload): BrifingPayload {
    const aiSummary = this.cleanBrifingActionText(aiPayload.summary || '');
    const aiMotivation = this.cleanBrifingMotivation(aiPayload.motivation || '', rulePayload.motivation);
    return {
      ...rulePayload,
      summary: aiSummary.length >= 20 ? aiSummary.slice(0, 180) : rulePayload.summary,
      motivation: aiMotivation.length >= 20 ? aiMotivation : rulePayload.motivation,
      metrics: {
        ...rulePayload.metrics,
        ...(aiPayload.metrics || {}),
      },
    };
  }

  /** AI'dan gelen JSON'u doğrula, eksik alanları tamamla */
  private validatePayload(obj: any): BrifingPayload {
    const summary = this.cleanBrifingActionText(String(obj?.summary || '')).slice(0, 180);
    const motivation = this.cleanBrifingMotivation(String(obj?.motivation || ''));
    const alerts = Array.isArray(obj?.alerts)
      ? obj.alerts.slice(0, 3).map((a: any) => ({
          severity: ['high', 'medium', 'low'].includes(a?.severity) ? a.severity : 'low',
          text: this.cleanBrifingActionText(String(a?.text || '')).slice(0, 200),
          href: a?.href ? this.normalizeBrifingHref(String(a.href)) : undefined,
        })).filter((a: any) => a.text)
      : [];
    const suggestions = Array.isArray(obj?.suggestions)
      ? obj.suggestions.slice(0, 3).map((s: any) => ({
          text: this.cleanBrifingActionText(String(s?.text || '')).slice(0, 100),
          href: this.normalizeBrifingHref(String(s?.href || '/panel')),
          icon: s?.icon ? String(s.icon).slice(0, 30) : undefined,
        })).filter((s: any) => s.text)
      : [];
    const focus = ['calm', 'busy', 'critical', 'review'].includes(obj?.focus) ? obj.focus : 'busy';
    const metrics = (obj?.metrics && typeof obj.metrics === 'object') ? obj.metrics : {};
    const sourceTags = Array.isArray(obj?.sourceTags)
      ? obj.sourceTags.slice(0, 5).map((s: any) => ({
          key: ['workflow', 'calendar', 'tasks', 'agents', 'notifications', 'luca', 'mihsap', 'finance', 'automation', 'approval'].includes(s?.key) ? s.key : 'workflow',
          label: String(s?.label || 'Kaynak').slice(0, 24),
          count: Number(s?.count || 0),
        }))
      : [];
    const sections = Array.isArray(obj?.sections)
      ? obj.sections.slice(0, 3).map((s: any) => ({
          key: ['today', 'risk', 'action'].includes(s?.key) ? s.key : 'today',
          title: String(s?.title || 'Bölüm').slice(0, 24),
          items: Array.isArray(s?.items)
            ? s.items.slice(0, 3).map((item: any) => this.cleanBrifingActionText(String(item || '')).slice(0, 110)).filter(Boolean)
            : [],
        })).filter((s: any) => s.items.length > 0)
      : [];
    return { summary, motivation, alerts, suggestions, focus, sourceTags, sections, metrics };
  }

  private normalizeBrifingHref(href: string): string {
    const value = String(href || '').trim();
    const [path, query = ''] = value.split('?');
    const routes = [
      '/panel/ajanlar/mihsap',
      '/panel/is-yuku',
      '/panel/gorevler',
      '/panel/beyannameler',
      '/panel/kdv-kontrol',
      '/panel/mukellefler',
      '/panel/ajanlar',
      '/panel/faturalar',
      '/panel/fatura-isleme',
      '/panel/cari-kasa',
      '/panel/banka-takip',
      '/panel/otomasyonlar',
      '/panel/onay-kuyrugu',
      '/panel/e-arsiv',
      '/panel/mizan',
      '/panel/bildirimler',
    ];
    for (const route of routes) {
      if (path === route || path.startsWith(`${route}/`)) return query ? `${route}?${query}` : route;
    }
    return '/panel';
  }

  private cleanBrifingMotivation(text: string, fallback = ''): string {
    const cleaned = this.cleanBrifingActionText(text)
      .replace(/\s*[—–-]\s*/g, '; ')
      .replace(/\s+/g, ' ')
      .trim();
    const firstSentence = (cleaned.split(/(?<=[.!?])\s+/).find(Boolean) || '').trim();
    const operational = /\d|\b(KDV|Luca|Mihsap|evrak|fatura|çekim|hata|mükellef|beyanname|otomasyon|ajan|dosya|takip|hız|hiz|artır|artir|gecik|geciken|liste|talep|kontrol|log|işlem|islem|kayıt|kayit|bekleyen)\b/iu.test(firstSentence);
    const value = !firstSentence || operational ? fallback : firstSentence;
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 78);
  }

  private cleanBrifingActionText(text: string): string {
    return String(text || '')
      .replace(/\b(?!KDV\b|SGK\b|GIB\b|GİB\b|LUCA\b|MIHSAP\b|MİHSAP\b)([A-ZÇĞİÖŞÜ]{2,})(?:\s+[A-ZÇĞİÖŞÜ]{2,}){1,3}\b/g, 'ilgili mükellef')
      .replace(/\byapı\s*taşla\b/gi, 'planla')
      .replace(/\byapi\s*tasla\b/gi, 'planla')
      .replace(/\btakılı\b/gi, 'beklemede')
      .replace(/\btakildi\b/gi, 'beklemede')
      .replace(/\bhemen harekete geç\b/gi, 'öncelik listesine al')
      .replace(/\bhız ver ya da engel varsa çöz\b/gi, 'engeli kontrol edip sıraya al')
      .replace(/\bhızlandırılmalı\b/gi, 'takip edilmeli')
      .replace(/\bhizlandirilmali\b/gi, 'takip edilmeli')
      .replace(/\bhemen talep et\b/gi, 'talep planı çıkar')
      .replace(/\bMOREN AI\s+[^.;!?]{0,80}\btarad[ıi]\b\.?/gi, '')
      .replace(/\bportal verisi\s+[^.;!?]{0,40}\btarand[ıi]\b\.?/gi, '')
      .replace(/\bLuca,\s*Mihsap,\s*KDV\s+[^.;!?]{0,60}\b(okundu|tarandı)\b\.?/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

}
