/**
 * Moren AI Otomasyon Motoru — Aksiyon Kataloğu (Faz 2)
 *
 * Parser bu kataloğa bakarak hangi adımları üretebileceğini bilir.
 * Çalıştırıcı motor (Faz 3) bu kataloğa bakarak hangi adımı nasıl çalıştıracağını bilir.
 *
 * KATEGORİLER:
 *  - READ: Sadece veri okur (mevcut moren-ai/tools.ts'teki 38 tool'un çoğu).
 *  - WRITE: Sistemde değişiklik yapar (mesaj atar, kayıt oluşturur).
 *  - AI: Çalışma sırasında Claude'a çağrı yapar (özetleme, ekstraksiyon).
 *  - FLOW: Akış kontrol meta-aksiyonu (for_each, if, wait).
 *
 * MALİYET ETİKETLERİ (run başına tahmini USD):
 *  - 0: hiç Claude yok
 *  - 0.005-0.02: küçük Claude çağrısı (özetleme, kısa ekstraksiyon)
 *  - 0.02-0.10: büyük Claude çağrısı (uzun belge analizi)
 */

import { MOREN_AI_TOOLS, ToolDefinition } from '../moren-ai/tools';

export type ActionCategory = 'READ' | 'WRITE' | 'AI' | 'FLOW';

export interface AutomationAction extends ToolDefinition {
  category: ActionCategory;
  /** Run başına ortalama Claude maliyeti (USD). Sıfır = Claude'a hiç gitmez. */
  estimatedClaudeCostPerCall: number;
  /** Bu aksiyonu çağırmak için hangi domain modülünün yüklü olması gerekir? */
  requires?: string[];
}

// ---------------------------------------------------------------
// AKSIYON: Mevcut READ-only tool'lar (moren-ai/tools.ts'ten geliyor)
// Otomasyonda da AYNI tool isimleriyle kullanılırlar.
// ---------------------------------------------------------------

const READ_ACTIONS: AutomationAction[] = MOREN_AI_TOOLS.map((tool) => ({
  ...tool,
  category: 'READ' as const,
  estimatedClaudeCostPerCall: 0,
}));

// ---------------------------------------------------------------
// AKSIYON: İletişim (WRITE)
// ---------------------------------------------------------------

const COMMUNICATION_ACTIONS: AutomationAction[] = [
  {
    name: 'send_whatsapp_template',
    category: 'WRITE',
    estimatedClaudeCostPerCall: 0,
    requires: ['whatsapp'],
    description:
      'Onaylı bir WhatsApp şablon mesajını belirtilen numaraya gönderir. ' +
      'Şablon Meta Business Manager\'da önceden onaylanmış olmalı. ' +
      'Bilinmeyen kişiye serbest mesaj YASAK — şablon kullan. ' +
      'Toplu gönderim için for_each ile sar.',
    input_schema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Hedef telefon numarası (E.164 formatında, örn. "+905551234567").',
        },
        templateName: {
          type: 'string',
          description: 'Meta\'da onaylı şablon adı (örn. "kdv_hatirlatma").',
        },
        languageCode: {
          type: 'string',
          description: 'Şablon dili. Türkçe için "tr". Varsayılan "tr".',
        },
        variables: {
          type: 'object',
          description: 'Şablon değişkenleri (örn. { "1": "Ali Tekstil", "2": "Nisan 2026" }).',
        },
      },
      required: ['to', 'templateName'],
    },
  },
  {
    name: 'send_whatsapp_freeform',
    category: 'WRITE',
    estimatedClaudeCostPerCall: 0,
    requires: ['whatsapp'],
    description:
      'Mükellefle AÇIK 24 saatlik konuşma penceresi içinde serbest WhatsApp mesajı gönderir (Meta Cloud API). ' +
      'Pencere kapalıysa atlanır.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Telefon numarası (E.164).' },
        message: { type: 'string', description: 'Mesaj metni (max 4096 karakter).' },
      },
      required: ['to', 'message'],
    },
  },
  {
    name: 'send_email',
    category: 'WRITE',
    estimatedClaudeCostPerCall: 0,
    requires: ['notifications'],
    description:
      'SMTP üzerinden e-posta gönderir. HTML veya düz metin olabilir. ' +
      'Toplu gönderim için for_each ile sar — her e-posta ayrı kayıt olarak gönderilir.',
    input_schema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Tek alıcı veya virgülle ayrılmış adres listesi.',
        },
        subject: { type: 'string' },
        body: { type: 'string', description: 'HTML veya düz metin.' },
        isHtml: { type: 'boolean', description: 'Varsayılan false.' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'send_sms',
    category: 'WRITE',
    estimatedClaudeCostPerCall: 0,
    requires: ['sms-templates'],
    description: 'SMS gönderir. Türkçe karakterler GSM-7\'ye çevrilir.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Telefon numarası (E.164).' },
        message: { type: 'string', description: 'Mesaj metni (max 459 karakter).' },
      },
      required: ['to', 'message'],
    },
  },
  {
    name: 'create_pending_action',
    category: 'WRITE',
    estimatedClaudeCostPerCall: 0,
    requires: ['pending-actions'],
    description:
      'Sana veya bir kullanıcıya "yapılacaklar" listesinde görünecek bir görev/bildirim oluşturur. ' +
      'Müvekkille ilgili olabilir (taxpayerId verilirse).',
    input_schema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'Hedef kullanıcı ID. Boş ise tenant geneli (herkes görür).',
        },
        title: { type: 'string' },
        body: { type: 'string' },
        taxpayerId: { type: 'string', description: 'İlgili müvekkel (opsiyonel).' },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'urgent'],
          description: 'Varsayılan "normal".',
        },
      },
      required: ['title', 'body'],
    },
  },
];

// ---------------------------------------------------------------
// AKSIYON: Belge / OCR (WRITE + AI karma)
// ---------------------------------------------------------------

const DOCUMENT_ACTIONS: AutomationAction[] = [
  {
    name: 'ocr_pdf',
    category: 'AI',
    estimatedClaudeCostPerCall: 0.005,
    requires: ['documents', 'azure-ocr'],
    description:
      'Bir PDF\'i OCR ile metne çevirir. Azure Computer Vision birincil, Tesseract yedek. ' +
      'Sayfa numarasıyla yapısal metin döner.',
    input_schema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'documents tablosundaki belge ID, veya S3 anahtarı.',
        },
        engine: {
          type: 'string',
          enum: ['azure', 'tesseract', 'auto'],
          description: 'OCR motoru. Varsayılan "auto".',
        },
      },
      required: ['documentId'],
    },
  },
  {
    name: 'extract_invoice_fields',
    category: 'AI',
    estimatedClaudeCostPerCall: 0.01,
    requires: ['fatura-muhasebelestirme'],
    description:
      'OCR çıktısından fatura alanlarını yapısal olarak çıkarır: ' +
      'unvan, VKN, tarih, KDV oranı/tutarı, toplam, tedarikçi, alıcı, hesap kodu önerisi.',
    input_schema: {
      type: 'object',
      properties: {
        ocrText: { type: 'string', description: 'OCR\'dan gelen ham metin.' },
        taxpayerId: {
          type: 'string',
          description: 'Müvekkel ID (vendor-memory ile hesap kodu önermek için).',
        },
      },
      required: ['ocrText'],
    },
  },
  {
    name: 'post_to_luca',
    category: 'WRITE',
    estimatedClaudeCostPerCall: 0,
    requires: ['luca'],
    description:
      'Luca muhasebe programına bir fiş/kayıt atar. Aşamalı: önce taslak (preview), sonra confirm. ' +
      'Otomasyon önizleme aşamasında preview, kullanıcı onayında confirm.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        entryType: {
          type: 'string',
          enum: ['INVOICE_IN', 'INVOICE_OUT', 'CASH_PAYMENT', 'BANK_TRANSFER'],
        },
        date: { type: 'string', description: 'YYYY-MM-DD.' },
        amount: { type: 'number' },
        vatRate: { type: 'number', description: '0, 1, 8, 18, 20 vb.' },
        accountCode: { type: 'string', description: 'Hesap kodu (örn. "153.01").' },
        description: { type: 'string' },
      },
      required: ['taxpayerId', 'entryType', 'date', 'amount'],
    },
  },
  {
    name: 'generate_fis_word_from_invoices',
    category: 'WRITE',
    estimatedClaudeCostPerCall: 0,
    requires: ['fis-yazdirma', 'mihsap'],
    description:
      'Bir mükellefin verilen dönemdeki FİŞ türü faturalarını MIHSAP\'tan çeker ve Word raporu üretir. ' +
      'Sonuç dosyası /panel/fis-yazdirma sayfasındaki "Çıktılar" listesinde görünür ve oradan indirilebilir. ' +
      'Tipik kullanım: KDV kontrolü kilitlenince ilgili dönemin fişlerini otomatik Word\'e dök.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string', description: 'Mükellefin sistem ID\'si.' },
        donem: {
          type: 'string',
          description: 'YYYY-MM formatında (örn. "2026-05"). Trigger payload\'undan {{trigger.payload.year}}-{{trigger.payload.month}} olarak hesaplanabilir.',
        },
      },
      required: ['taxpayerId', 'donem'],
    },
  },
];

// ---------------------------------------------------------------
// AKSIYON: AI Yardımcıları (AI)
// ---------------------------------------------------------------

const AI_ACTIONS: AutomationAction[] = [
  {
    name: 'print_word_output',
    category: 'WRITE',
    estimatedClaudeCostPerCall: 0,
    requires: ['fis-yazdirma', 'local-agent'],
    description:
      'Bir Word ciktisini (fis-yazdirma outputId) lokal agent uzerinden Windows default yazicisina otomatik gonderir. ' +
      'Lokal agent acik olmali ve default yazici tanimli olmali. Tipik kullanim: generate_fis_word_from_invoices sonrasi outputId al, bu aksiyon ile yazdir.',
    input_schema: {
      type: 'object',
      properties: {
        outputId: { type: 'string', description: 'fis-yazdirma cikti ID\'si (genelde bir onceki adimdan {{prev.outputId}}).' },
        deviceId: { type: 'string', description: '(Opsiyonel) Belirli bir cihaz hedeflenmek isteniyorsa.' },
      },
      required: ['outputId'],
    },
  },
  {
    name: 'fetch_invoices_for_period',
    category: 'WRITE',
    estimatedClaudeCostPerCall: 0,
    requires: ['mihsap', 'local-agent'],
    description:
      'Belirtilen mukellefin belirtilen donemde tum faturalarini (alis + satis) MIHSAP\'tan canli olarak ceker ve portala kaydeder. ' +
      'Yani Faturalar sayfasindaki "Hepsini Cek" butonunun otomasyon esdegeri. ' +
      'Tipik kullanim: Taxpayer.EvraklarHazir event\'inde tetikle, payload\'tan taxpayerId ve donem alirsin.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string', description: 'Mukellefin sistem ID\'si.' },
        donem: { type: 'string', description: 'YYYY-MM formatinda (orn. "2026-04"). Slash veya tek hane ay da kabul edilir, normalize edilir.' },
        faturaTuru: { type: 'string', enum: ['ALIS', 'SATIS', 'ALL'], description: '(Opsiyonel) Sadece alis veya satis. Default: ALL (ikisi).' },
      },
      required: ['taxpayerId', 'donem'],
    },
  },
  {
    name: 'backup_to_drive',
    category: 'WRITE',
    estimatedClaudeCostPerCall: 0,
    requires: ['drive'],
    description:
      'Bir mukellefin belirtilen donemdeki faturalarini Google Drive\'a yedekler (Faturalar sayfasindaki "Drive\'a Yedekle" butonunun otomasyon esdegeri). ' +
      'Google Drive bagli degilse hata verir. Ayni mukellef+donem icin zaten calisan yedek varsa yenisi acilmaz. ' +
      'Tipik kullanim: fetch_invoices_for_period adimindan SONRA, ayni donem icin (beyanname donemi) calistir.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string', description: 'Mukellefin sistem ID\'si (genelde "{{trigger.payload.taxpayerId}}").' },
        donem: { type: 'string', description: 'YYYY-MM (genelde "{{trigger.payload.beyannamePeriodLabel}}" — fatura beyanname donemine aittir).' },
      },
      required: ['taxpayerId', 'donem'],
    },
  },
  {
    name: 'set_monthly_status',
    category: 'WRITE',
    estimatedClaudeCostPerCall: 0,
    requires: ['taxpayers'],
    description:
      'Bir mukellefin AYLIK TAKIP LISTESINDEKI durum kutularini isaretler/gunceller. ' +
      'Alanlar (hepsi opsiyonel boolean): evraklarGeldi, evraklarIslendi, kontrolEdildi, beyannameVerildi, ' +
      'kdvKontrolEdildi, indirilecekKdvKontrol, hesaplananKdvKontrol, eArsivKontrol. ' +
      'Sadece verdigin alanlar degisir, digerlerine dokunulmaz. ' +
      'Tipik kullanim: KDV kontrol kilitlenince (Taxpayer.KdvKontrolKilitlendi) indirilecekKdvKontrol+hesaplananKdvKontrol+eArsivKontrol=true isaretle.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string', description: 'Mukellefin sistem ID\'si (genelde "{{trigger.payload.taxpayerId}}").' },
        year: { type: 'number', description: 'Yil (genelde "{{trigger.payload.year}}").' },
        month: { type: 'number', description: 'Ay 1-12 (genelde "{{trigger.payload.month}}").' },
        evraklarGeldi: { type: 'boolean' },
        evraklarIslendi: { type: 'boolean' },
        kontrolEdildi: { type: 'boolean' },
        beyannameVerildi: { type: 'boolean' },
        kdvKontrolEdildi: { type: 'boolean' },
        indirilecekKdvKontrol: { type: 'boolean' },
        hesaplananKdvKontrol: { type: 'boolean' },
        eArsivKontrol: { type: 'boolean' },
      },
      required: ['taxpayerId', 'year', 'month'],
    },
  },
  {
    name: 'fetch_kdv_from_luca',
    category: 'WRITE',
    estimatedClaudeCostPerCall: 0,
    requires: ['kdv-beyanname', 'luca', 'local-agent'],
    description:
      'Bir mukellefin belirtilen donemde KDV verilerini LUCA\'dan otomatik ceker ve KDV beyanname/durum panosunu besler. ' +
      'Bilanco mukellefi → Luca KDV mizan job\'u (191/391/190); isletme defteri → gelir-gider snapshot. ' +
      'Manuel "Luca\'dan Cek" butonunun otomasyon esdegeri; ayni donem icin bekleyen/calisan job varsa yenisi acilmaz (tekrar onleme). ' +
      'Tipik kullanim: KDV kontrol kutulari (ind.+hes. KDV + e-arsiv) tamamlaninca Taxpayer.KdvKontrolTamam event\'inde tetikle.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string', description: 'Mukellefin sistem ID\'si (genelde "{{trigger.payload.taxpayerId}}").' },
        donem: { type: 'string', description: 'YYYY-MM formatinda (genelde "{{trigger.payload.donem}}"). Slash/tek hane ay normalize edilir.' },
      },
      required: ['taxpayerId', 'donem'],
    },
  },
  {
    name: 'summarize_with_claude',
    category: 'AI',
    estimatedClaudeCostPerCall: 0.01,
    description:
      'Bir metni Claude ile özetler. Resmi Gazete maddesi, müvekkilden gelen uzun e-posta, ' +
      'birikmiş WhatsApp konuşması vb. için. Çıktı Türkçe.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        maxWords: { type: 'number', description: 'Hedef özet uzunluğu. Varsayılan 100.' },
        focus: {
          type: 'string',
          description: 'Neye odaklan (örn. "KDV ile ilgili maddeler", "tarih ve tutar bilgileri").',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'classify_with_claude',
    category: 'AI',
    estimatedClaudeCostPerCall: 0.005,
    description:
      'Bir metni verilen kategorilere ayırır. Örn. gelen e-postanın "fatura mı, sözleşme mi, ' +
      'genel soru mu" olduğunu sınıflandırma.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Olası sınıflar.',
        },
      },
      required: ['text', 'categories'],
    },
  },
];

// ---------------------------------------------------------------
// AKSIYON: Dış kaynak takibi
// ---------------------------------------------------------------

const EXTERNAL_ACTIONS: AutomationAction[] = [
  {
    name: 'check_official_gazette',
    category: 'AI',
    estimatedClaudeCostPerCall: 0.02,
    description:
      'Resmi Gazete\'nin günlük RSS\'ini tarar, son N gündeki yayınlardan filtre anahtar ' +
      'sözcüklerine uyanları döner. Her madde için Claude ile özet üretir.',
    input_schema: {
      type: 'object',
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Aranacak anahtar kelimeler (örn. ["KDV", "katma değer vergisi"]).',
        },
        sinceDays: {
          type: 'number',
          description: 'Kaç gün geriye bak. Varsayılan 1 (sadece dünden bugüne).',
        },
      },
      required: ['keywords'],
    },
  },
  {
    name: 'http_get',
    category: 'WRITE',
    estimatedClaudeCostPerCall: 0,
    description:
      'Bir URL\'e GET isteği atar. Sadece güvenli (allowlist) domain\'ler için açık. ' +
      'Müvekkil verisi DIŞARI gönderilmez.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        headers: { type: 'object' },
      },
      required: ['url'],
    },
  },
];

// ---------------------------------------------------------------
// AKSIYON: Veri biçimlendirme (FLOW yardımcıları)
// ---------------------------------------------------------------

const FORMATTING_ACTIONS: AutomationAction[] = [
  {
    name: 'format_list',
    category: 'FLOW',
    estimatedClaudeCostPerCall: 0,
    description:
      'Bir dizi nesneyi insan-okur metne çevirir. Deterministik (Claude çağırmaz, ücretsiz). ' +
      'Bildirim metni, e-posta gövdesi veya WhatsApp mesajı içine yapısal liste yerleştirmek için MUTLAKA kullan. ' +
      'Aksi halde {{liste}} doğrudan interpolasyon yapılırsa ham JSON görünür.',
    input_schema: {
      type: 'object',
      properties: {
        list: {
          type: 'string',
          description:
            'Biçimlendirilecek dizi referansı (önceki adımın outputAs\'i). ' +
            'Örn. "{{mukellefler}}". DOĞRUDAN bir dizi yerine TEMPLATE referansı olmalı.',
        },
        itemTemplate: {
          type: 'string',
          description:
            'Her eleman için kullanılacak template. {{item.field}} ile alanlara erişilir. ' +
            'Örn. "- {{item.isim}} ({{item.vkn_tckn}})".',
        },
        separator: {
          type: 'string',
          description: 'Elemanları ayıracak metin. Varsayılan "\\n" (yeni satır).',
        },
        emptyMessage: {
          type: 'string',
          description:
            'Dizi boşsa kullanılacak metin. Verilmezse boş string döner. ' +
            'Örn. "Bu dönemde gecikmiş müvekkel yok."',
        },
        prefix: {
          type: 'string',
          description: 'Listenin başına eklenecek metin (opsiyonel).',
        },
        suffix: {
          type: 'string',
          description: 'Listenin sonuna eklenecek metin (opsiyonel).',
        },
        maxItems: {
          type: 'number',
          description:
            'Listede en fazla kaç eleman göster. Aşılırsa "... ve N tane daha" eklenir. ' +
            'Varsayılan: tümü.',
        },
      },
      required: ['list', 'itemTemplate'],
    },
  },
];

// ---------------------------------------------------------------
// AKSIYON: Akış kontrolü (FLOW meta-aksiyonları)
// ---------------------------------------------------------------

const FLOW_ACTIONS: AutomationAction[] = [
  {
    name: 'for_each',
    category: 'FLOW',
    estimatedClaudeCostPerCall: 0,
    description:
      'Bir dizinin her elemanı için iç adımları tekrarlar. ' +
      'Örn. mükellef listesine her biri için WhatsApp atmak.',
    input_schema: {
      type: 'object',
      properties: {
        list: {
          type: 'string',
          description:
            'Yinelenecek diziyi içeren değişken referansı. ' +
            'Önceki bir adımın outputAs ile belirlediği isim (örn. "{{gecikenler}}").',
        },
        as: {
          type: 'string',
          description:
            'Her eleman için kullanılacak değişken adı (örn. "mukellef"). ' +
            'İç adımlarda "{{mukellef.field}}" ile erişilir.',
        },
        steps: {
          type: 'array',
          items: { type: 'object' },
          description: 'Her eleman için sırayla çalıştırılacak adımlar.',
        },
        throttleMs: {
          type: 'number',
          description:
            'Her eleman arasına eklenecek bekleme (milisaniye, 0-10000). Toplu WhatsApp/e-posta ' +
            'gönderiminde sağlayıcı oran sınırına takılmamak için kullan (örn. 500). Varsayılan 0.',
        },
      },
      required: ['list', 'as', 'steps'],
    },
  },
  {
    name: 'branch_if',
    category: 'FLOW',
    estimatedClaudeCostPerCall: 0,
    description: 'Koşul doğruysa "then", değilse "else" dalını çalıştırır.',
    input_schema: {
      type: 'object',
      properties: {
        condition: {
          type: 'object',
          description:
            'Koşul nesnesi. Şu anda desteklenenler: ' +
            '{ left, op, right } — op: "==", "!=", ">", "<", ">=", "<=", "exists", "in". ' +
            'left/right template referansı (örn. "{{gecikenler.length}}") olabilir.',
        },
        then: { type: 'array', items: { type: 'object' } },
        else: { type: 'array', items: { type: 'object' } },
      },
      required: ['condition', 'then'],
    },
  },
  {
    name: 'wait',
    category: 'FLOW',
    estimatedClaudeCostPerCall: 0,
    description:
      'Akışı belirli süre bekletir. Saat/gün cinsinden. ' +
      'Çoklu adımlı kampanyalar için (örn. "7 gün sonra hatırlat").',
    input_schema: {
      type: 'object',
      properties: {
        amount: { type: 'number' },
        unit: {
          type: 'string',
          enum: ['minutes', 'hours', 'days'],
        },
      },
      required: ['amount', 'unit'],
    },
  },
  {
    name: 'parallel',
    category: 'FLOW',
    estimatedClaudeCostPerCall: 0,
    description:
      'Birden çok adımı paralel başlatır, hepsi bitince devam eder. ' +
      'Bağımsız aksiyonları hızlandırmak için.',
    input_schema: {
      type: 'object',
      properties: {
        branches: {
          type: 'array',
          items: { type: 'array', items: { type: 'object' } },
          description: 'Her bir branch, sırayla çalışacak adımlar dizisidir.',
        },
        concurrency: {
          type: 'number',
          description: 'Aynı anda çalışacak en fazla dal sayısı. Varsayılan 5.',
        },
      },
      required: ['branches'],
    },
  },
];

// ---------------------------------------------------------------
// TÜM KATALOG (parser ve runner buradan okur)
// ---------------------------------------------------------------

export const AUTOMATION_ACTION_CATALOG: AutomationAction[] = [
  ...READ_ACTIONS,
  ...COMMUNICATION_ACTIONS,
  ...DOCUMENT_ACTIONS,
  ...AI_ACTIONS,
  ...EXTERNAL_ACTIONS,
  ...FORMATTING_ACTIONS,
  ...FLOW_ACTIONS,
];

export const ACTION_BY_NAME: Record<string, AutomationAction> = Object.fromEntries(
  AUTOMATION_ACTION_CATALOG.map((a) => [a.name, a]),
);

// ---------------------------------------------------------------
// TETİKLEYİCİ TANIMLAMA
// ---------------------------------------------------------------

export interface TriggerSpec {
  type: 'CRON' | 'EVENT' | 'WEBHOOK' | 'MANUAL';
  name: string;
  description: string;
  configSchema: Record<string, any>;
}

export const TRIGGER_SPECS: TriggerSpec[] = [
  {
    type: 'CRON',
    name: 'cron',
    description:
      'Belirli bir takvime göre otomatik tetiklenir. ' +
      'Cron expression formatında (örn. "0 10 22 * *" = her ayın 22\'sinde 10:00).',
    configSchema: {
      cron: { type: 'string', example: '0 10 22 * *' },
      timezone: { type: 'string', example: 'Europe/Istanbul', default: 'Europe/Istanbul' },
    },
  },
  {
    type: 'EVENT',
    name: 'event',
    description: 'Sistemde bir olay olduğunda tetiklenir.',
    configSchema: {
      eventName: {
        type: 'string',
        enum: [
          // Müvekkel evrak/durum güncellemeleri
          'Taxpayer.EvrakDurumuChanged',       // "Müvekkilin evrak geldi" alanı değişti
          'Taxpayer.EvrakIslendiChanged',      // "Evrak işlendi" alanı değişti
          'Taxpayer.KontrolEdildiChanged',     // "Kontrol edildi" alanı değişti
          'Taxpayer.BeyannameDurumuChanged',   // "Beyanname verildi" alanı değişti
          'Taxpayer.KdvKontrolKilitlendi',     // KDV kontrolü tamamlanıp kilitlendi (KDV Kontrol modülü)
          'Taxpayer.KdvKontrolTamam',          // Aylık takipte ind.+hes. KDV + e-arşiv (+evrak geldi/işlendi) hepsi işaretlendi
          'Taxpayer.EvraklarHazir',            // Hem 'evraklar geldi' hem 'evraklar işlendi' true oldu
          'Taxpayer.Created',                   // Yeni müvekkil eklendi
          // İletişim
          'WhatsApp.MessageReceived',           // Müvekkelden WhatsApp mesajı geldi
          // Belge
          'Document.Uploaded',                  // Portala belge yüklendi
          // NOT: WhatsApp.DocumentReceived ve Invoice.Created kataloğdan çıkarıldı —
          // bu olaylar sistemde HENÜZ yayınlanmıyor. "Çalışmayan tetikleyici" sunmak
          // yerine listede yalnız gerçekten ateşlenen olaylar tutulur. Yayınlama
          // noktaları (fatura kaydı / WhatsApp belge) eklenince buraya geri konur.
        ],
      },
      filters: {
        type: 'object',
        description:
          'Olay payload\'una uygulanacak filtreler. Her key payload\'da eşit olmalı. ' +
          'Taxpayer.* event\'leri için kullanılabilir alanlar: taxpayerId, year, month, field, newValue. ' +
          'Örn. Taxpayer.EvrakDurumuChanged için filters: { newValue: true } sadece "evrak geldi" olduğunda tetikler.',
      },
    },
  },
  {
    type: 'WEBHOOK',
    name: 'webhook',
    description:
      'Dışarıdan HTTP POST geldiğinde tetiklenir. URL ve secret otomasyon kurulurken üretilir.',
    configSchema: {
      // secret otomatik üretilir
    },
  },
  {
    type: 'MANUAL',
    name: 'manual',
    description: 'Sadece manuel "Şimdi Çalıştır" butonu ile başlar. Test ve tek seferlik işler için.',
    configSchema: {},
  },
];

/**
 * Parser ve validator için: kullanılabilir tüm event isimleri.
 * Bu listede olmayan bir event ismi otomasyonda KULLANILAMAZ.
 */
export const VALID_EVENT_NAMES: readonly string[] = (() => {
  const eventSpec = TRIGGER_SPECS.find((s) => s.type === 'EVENT');
  const enumVals = (eventSpec?.configSchema as any)?.eventName?.enum;
  return Array.isArray(enumVals) ? enumVals : [];
})();

/**
 * System prompt'a gömülecek katalog özetini üretir.
 * Parser'a her aksiyonun adı, kategorisi ve kısa açıklamasını verir.
 */
export function buildCatalogMarkdown(): string {
  const groupBy: Record<ActionCategory, AutomationAction[]> = {
    READ: [],
    WRITE: [],
    AI: [],
    FLOW: [],
  };
  for (const action of AUTOMATION_ACTION_CATALOG) {
    groupBy[action.category].push(action);
  }

  const sections: string[] = [];

  sections.push('## TETİKLEYİCİ TİPLERİ\n');
  for (const t of TRIGGER_SPECS) {
    sections.push(`- **${t.type}**: ${t.description}`);
  }

  sections.push('\n## AKSIYONLAR\n');

  const catLabels: Record<ActionCategory, string> = {
    READ: '### Veri Okuma (READ)',
    WRITE: '### Sistem Değişikliği (WRITE)',
    AI: '### AI Yardımcıları (Claude çağırır — maliyetli)',
    FLOW: '### Akış Kontrolü (FLOW meta-aksiyonları)',
  };

  for (const cat of ['READ', 'WRITE', 'AI', 'FLOW'] as ActionCategory[]) {
    sections.push(`\n${catLabels[cat]}\n`);
    for (const a of groupBy[cat]) {
      const required = a.input_schema.required ?? [];
      const props = Object.keys(a.input_schema.properties);
      const cost =
        a.estimatedClaudeCostPerCall > 0 ? ` [≈$${a.estimatedClaudeCostPerCall}/çağrı]` : '';
      sections.push(
        `- **${a.name}**${cost}: ${a.description.replace(/\n/g, ' ').slice(0, 200)}` +
          `\n  - Parametreler: ${props.join(', ')}` +
          (required.length ? ` (zorunlu: ${required.join(', ')})` : ''),
      );
    }
  }

  return sections.join('\n');
}
