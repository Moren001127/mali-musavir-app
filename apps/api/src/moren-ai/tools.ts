/**
 * Moren AI Tool Tanımları (Anthropic tool-use format)
 *
 * Her tool: name, description, input_schema (JSON Schema).
 * Description'lar DETAYLI — AI doğru tool'u doğru parametrelerle seçsin.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export const MOREN_AI_TOOLS: ToolDefinition[] = [
  // ============ MÜKELLEF ============
  {
    name: 'list_taxpayers',
    description:
      'Ofisteki mükellefleri listeler. Mükellef adı/ünvanı, VKN/TCKN veya ticari unvan üzerinden arama yapabilir. ' +
      'Kullanıcı bir mükellef adı söylediğinde (örn. "Ali Tekstil") önce bu tool ile ID bul, sonraki çağrılarda taxpayerId kullan.',
    input_schema: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description:
            'Arama metni (mükellef adı, ünvan, vergi numarası). Boş/null ise tüm aktif mükellefler listelenir.',
        },
        limit: {
          type: 'number',
          description: 'Döndürülecek max mükellef sayısı. Varsayılan 20, max 100.',
        },
        onlyActive: {
          type: 'boolean',
          description: 'Sadece aktif mükellefler (true, varsayılan) veya işi bırakmışlar dahil (false).',
        },
      },
    },
  },
  {
    name: 'get_taxpayer',
    description:
      'Bir mükellefin tüm detaylarını getirir: ad/ünvan, VKN, vergi dairesi, iletişim, işe başlama/bırakma tarihi, ' +
      'evrak teslim günü, son hatırlatma, aylık durum kayıtları (son 6 ay). Mükellef ID biliniyorsa bunu çağır.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string', description: 'Mükellefin sistem ID\'si (cuid).' },
      },
      required: ['taxpayerId'],
    },
  },
  {
    name: 'list_taxpayers_monthly_status',
    description:
      'TEK ÇAĞRIDA ofisteki TÜM mükelleflerin belirli bir aydaki evrak/işlem durumunu listeler. ' +
      '"Bu ay evraklarını getirenler kimler", "Bu ay evrakları gelmemiş olanlar", "Nisan kaydı açılmamış mükellefler", ' +
      '"Kimin beyannamesi verilmedi" gibi TOPLU sorularda MUTLAKA bu tool\'u kullan. ' +
      'ASLA `get_taxpayer` ile 50+ mükellefi tek tek çağırma — bu yerine bunu çağır. ' +
      'Ay parametresi YYYY-MM formatında (örn. "2026-04"). evrakDurumu filtresi: ' +
      '"geldi"=evraklarGeldi true, "gelmedi"=false veya kayıt yok, "tumu"=hepsi (varsayılan).',
    input_schema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          description: 'Dönem. "YYYY-MM" (örn. "2026-04"). Boş bırakılırsa bulunulan ay.',
        },
        evrakDurumu: {
          type: 'string',
          enum: ['geldi', 'gelmedi', 'tumu'],
          description: 'Evrak teslim durumu filtresi. Varsayılan "tumu".',
        },
        beyannameDurumu: {
          type: 'string',
          enum: ['verildi', 'verilmedi', 'tumu'],
          description: 'Beyanname verilme durumu filtresi. Varsayılan "tumu".',
        },
        onlyActive: {
          type: 'boolean',
          description: 'Sadece aktif mükellefler (varsayılan true).',
        },
      },
    },
  },

  // ============ MİZAN ============
  {
    name: 'list_mizan_periods',
    description:
      'Bir mükellef için sisteme yüklenmiş tüm mizan dönemlerini listeler. Hangi ayın/çeyreğin verisi var görmek için.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
      },
      required: ['taxpayerId'],
    },
  },
  {
    name: 'get_mizan',
    description:
      'Belirli dönem mizanını getirir: tüm hesap kodları, borç/alacak toplamı ve bakiyesi, anomaliler (TDHP dışı hesap, zıt bakiye). ' +
      'Hesap bazlı sorgular, toplam analiz, hata tespiti için kullan. donem formatı: "2026-03" (aylık) veya "2026-Q1" (geçici dönem).',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        donem: { type: 'string', description: 'Dönem kodu: "2026-03", "2026-Q1", "2025-YILLIK" vb.' },
        hesapKoduFiltresi: {
          type: 'string',
          description:
            'Opsiyonel: belirli hesap koduyla başlayan satırları getir. Örn "1" = dönen varlıklar, "600" = satışlar, "770" = gen. yön. gid.',
        },
      },
      required: ['taxpayerId', 'donem'],
    },
  },

  // ============ GELİR TABLOSU ============
  {
    name: 'get_gelir_tablosu',
    description:
      'Gelir tablosunu (kar/zarar tablosu) getirir. Brüt satışlar, indirimler, net satışlar, satış maliyeti, brüt kâr, ' +
      'faaliyet giderleri, finansman giderleri, olağan kâr, dönem kârı, vergi karşılığı, net kâr. ' +
      'Dönem yorumu, kârlılık analizi, maliyet/gider dağılımı için kullan.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        donem: { type: 'string', description: 'Dönem: "2026-Q1", "2026-03", "2025-YILLIK" vb.' },
      },
      required: ['taxpayerId', 'donem'],
    },
  },

  // ============ BİLANÇO ============
  {
    name: 'get_bilanco',
    description:
      'Bilançoyu (finansal durum tablosu) getirir. Aktif: dönen varlıklar, duran varlıklar. Pasif: KV yabancı kaynak, ' +
      'UV yabancı kaynak, özkaynaklar. Detay kırılımıyla birlikte. Likidite, borçluluk, özkaynak yeterliliği, ' +
      'TTK 376 (sermaye kaybı) kontrolü için kullan.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        donem: { type: 'string' },
      },
      required: ['taxpayerId', 'donem'],
    },
  },

  // ============ KDV ============
  {
    name: 'get_kdv_summary',
    description:
      'Bir mükellefin belirli dönemindeki KDV kontrol oturumlarını özetler: toplam fatura sayısı, eşleşen/eşleşmeyen, ' +
      'toplam KDV matrahı ve tutarı, devir KDV, ödenecek KDV. Fatura-Luca kayıt tutarsızlıklarını listeler.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        donem: { type: 'string', description: 'YYYY-MM, örn "2026-03"' },
      },
      required: ['taxpayerId', 'donem'],
    },
  },

  // ============ FATURALAR ============
  {
    name: 'list_invoices',
    description:
      'Mükellefin faturalarını listeler. Tip (satış/alış), durum (onaylı/taslak), tarih aralığı ve min/max tutara göre ' +
      'filtrele. Fatura bazlı sorgular, müşteri analizi, tutar kontrolü için.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        type: { type: 'string', enum: ['SATIS', 'ALIS', 'ARSIV'] },
        status: { type: 'string' },
        startDate: { type: 'string', description: 'ISO tarih (YYYY-MM-DD)' },
        endDate: { type: 'string' },
        minAmount: { type: 'number' },
        maxAmount: { type: 'number' },
        limit: { type: 'number', description: 'Varsayılan 20, max 100' },
      },
      required: ['taxpayerId'],
    },
  },

  // ============ BORDRO / SGK ============
  {
    name: 'get_payroll_summary',
    description:
      'Bir mükellefin personel ve bordro özetini getirir: aktif çalışan sayısı, toplam brüt/net maaş, SGK primleri ' +
      '(işçi/işveren), stopaj, damga. Dönem bazında veya güncel durum.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        year: { type: 'number' },
        month: { type: 'number', description: '1-12' },
      },
      required: ['taxpayerId'],
    },
  },
  {
    name: 'list_sgk_declarations',
    description:
      'SGK beyannameleri (APHB) listesi. Dönem, durum (taslak/gönderildi) ve referans numarası ile birlikte.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        year: { type: 'number' },
      },
      required: ['taxpayerId'],
    },
  },

  // ============ EVRAK ============
  {
    name: 'list_documents',
    description:
      'Bir mükellefin yüklenmiş evraklarını listeler. Kategori (sözleşme, fatura, SGK, vergi vb.), tarih, boyut bilgisi.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        category: { type: 'string', description: 'SOZLESME | FATURA | SGK_BELGESI | VERGI | DIGER' },
      },
      required: ['taxpayerId'],
    },
  },

  // ============ VERGİ TAKVİMİ ============
  {
    name: 'get_tax_calendar',
    description:
      'Yaklaşan vergi takvimi: beyanname son tarihleri, ödeme tarihleri. "Bu ay neler var", "yarın ne verilecek" ' +
      'tarzı sorular için. Opsiyonel: belirli mükellefin bekleyen beyannameleri.',
    input_schema: {
      type: 'object',
      properties: {
        fromDate: { type: 'string', description: 'ISO tarih, varsayılan bugün' },
        toDate: { type: 'string', description: 'ISO tarih, varsayılan +30 gün' },
        taxpayerId: { type: 'string', description: 'Opsiyonel: sadece bu mükellefin bekleyenleri' },
      },
    },
  },

  // ============ ANALİZ ============
  {
    name: 'compare_periods',
    description:
      'İki dönemi karşılaştırır — gelir tablosu, bilanço veya mizan özelinde. Brüt satışlar, kâr, özkaynak gibi ' +
      'kalemlerde değişim yüzdesi ve mutlak fark. "Geçen yılla kıyasla", "Q1 vs Q2" tarzı sorular için.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        donem1: { type: 'string', description: 'İlk dönem (önceki, kıyaslama tabanı)' },
        donem2: { type: 'string', description: 'İkinci dönem (yeni, kıyaslanan)' },
        kaynak: {
          type: 'string',
          enum: ['gelir_tablosu', 'bilanco', 'mizan'],
          description: 'Karşılaştırılacak tablo tipi',
        },
      },
      required: ['taxpayerId', 'donem1', 'donem2', 'kaynak'],
    },
  },
  {
    name: 'calculate_financial_ratios',
    description:
      'Bir mükellefin dönemindeki finansal rasyolarını hesaplar: cari oran, asit-test, nakit oran, borçluluk oranı, ' +
      'özkaynak çarpanı, brüt kâr marjı, net kâr marjı, faaliyet kâr marjı, özkaynak kârlılığı (ROE), aktif kârlılığı (ROA). ' +
      'Formül + değer + yorum (sağlıklı/dikkat/risk).',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        donem: { type: 'string' },
      },
      required: ['taxpayerId', 'donem'],
    },
  },

  // ============ BEYANNAME KAYITLARI (Hattat ZIP import) ============
  {
    name: 'list_beyan_kayitlari',
    description:
      'İmport edilmiş (Hattat ZIP\'inden veya manuel PDF\'den) geçmiş beyanname kayıtlarını listeler. ' +
      '"X mükellefinin 2025 Mart KDV beyannamesi kaydedilmiş mi?", "Kurumlar beyannamesi yüklenen mükellefler kim?", ' +
      '"2025-03 dönemi MUHSGK eksik olanlar" gibi sorularda kullan. ' +
      'Her kayıt: mükellef, beyanTipi, dönem, onay no, tahakkuk tutarı, PDF var mı içerir.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string', description: 'Belirli bir mükellef için filtre (opsiyonel).' },
        beyanTipi: {
          type: 'string',
          enum: ['KDV1', 'KDV2', 'MUHSGK', 'DAMGA', 'POSET', 'KURUMLAR', 'GELIR', 'BILDIRGE', 'EDEFTER', 'GECICI_VERGI', 'DIGER'],
          description: 'Beyan tipi filtresi (opsiyonel).',
        },
        donem: { type: 'string', description: 'Dönem: yyyy-mm (örn. "2025-03") veya yyyy-YIL (yıllık).' },
        search: { type: 'string', description: 'Mükellef adı/VKN veya onay no içinde arama.' },
        limit: { type: 'number', description: 'Max kayıt (varsayılan 100, max 500).' },
      },
    },
  },

  // ============ ONAY KUYRUĞU (Firma Hafızası sapma tespiti) ============
  {
    name: 'list_pending_decisions',
    description:
      'AI\'ın geçmişten sapmış karar tespit ettiği onay bekleyen faturaları listeler. ' +
      '"Kaç fatura onay bekliyor?", "Hangi mükellefin faturaları duruyor?", "Onay kuyruğunda ne var?" sorularında kullan.',
    input_schema: {
      type: 'object',
      properties: {
        durum: { type: 'string', enum: ['bekliyor', 'onaylandi', 'reddedildi'], description: 'Durum filtresi (varsayılan bekliyor).' },
        mukellef: { type: 'string', description: 'Mükellef adı ile filtre.' },
        limit: { type: 'number', description: 'Max kayıt (varsayılan 50).' },
      },
    },
  },

  // ============ FİRMA HAFIZASI (Vendor Memory) ============
  {
    name: 'get_firma_hafizasi',
    description:
      'Belirli bir karşı firmanın (tedarikçi/alıcı) hafızasını getirir — hangi mükelleflerde hangi hesap koduna kaydedilmiş, ' +
      'kaç defa onaylanmış. "CK Boğaziçi Elektrik\'i hangi mükellefler hangi koda işliyor?", ' +
      '"TTNET faturasını kim hangi hesaba yazmış?" gibi sorularda kullan. ' +
      'search parametresi ile firma unvanı veya VKN ile arama yapabilir.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Firma unvanı veya VKN/TCKN ile arama.' },
        limit: { type: 'number', description: 'Max firma (varsayılan 20).' },
      },
    },
  },

  // ============ GALERİ + HGS ============
  {
    name: 'list_araclar_hgs',
    description:
      'Galeri modülündeki araç listesini ve son HGS ihlal sorgu sonuçlarını getirir. ' +
      '"Kaç aracımız var?", "İhlalli araçlar kim?", "Toplam HGS ceza tutarı ne?", ' +
      '"X plakanın ihlal durumu ne?" sorularında kullan.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Plaka, marka, model veya sahip adında arama.' },
        ihlalliMi: { type: 'boolean', description: 'true=sadece ihlalli araçlar, false=ihlalsizler, null=hepsi.' },
      },
    },
  },

  // ============ BEYANNAME TAKİP KONFİGÜRASYONU ============
  {
    name: 'get_beyanname_config',
    description:
      'Bir veya tüm mükelleflerin beyanname yapılandırmasını döner: hangi beyannameleri veriyor (KDV1/KDV2/MUHSGK/Damga/Poşet/SGK/E-Defter), ' +
      'dönemi aylık mı 3 aylık mı. "TAHİR SUCU hangi beyannameleri veriyor?", ' +
      '"Kaç mükellefte MUHSGK aylık?", "E-Defter vermesi gereken mükellefler" gibi sorularda kullan.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string', description: 'Belirli bir mükellef (opsiyonel).' },
      },
    },
  },

  // ============ TOPLU BEYAN DURUMU (Hattat-stil dashboard tablosu) ============
  {
    name: 'get_beyan_ozet',
    description:
      'Belirli bir dönem için tüm mükelleflerin beyanname durumunu özetler (dashboard\'daki Toplu Beyanname tablosu). ' +
      '"Bu ay kaç KDV bekliyoruz?", "Mart 2026 MUHSGK durumu ne?", "Kaç mükellef beyanname vermedi?" sorularında kullan. ' +
      'Beyan tipi bazında: toplam / onaylanan / bekleyen / hatalı / kalan sayıları döner.',
    input_schema: {
      type: 'object',
      properties: {
        donem: { type: 'string', description: 'Dönem: yyyy-mm (varsayılan bulunulan ay).' },
      },
    },
  },

  // ============ GENEL SORGULAMA ============
  {
    name: 'search_all',
    description:
      'Bir metin sorgusu ile tüm sistemde arama: mükellef adı, fatura no, evrak başlığı, mizan hesap kodu/adı. ' +
      'Kullanıcı bir numara/isim söylediğinde hangi modülde olduğunu bilmediğinde kullan.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', description: 'Her kategoriden kaç sonuç. Varsayılan 5.' },
      },
      required: ['query'],
    },
  },
];
