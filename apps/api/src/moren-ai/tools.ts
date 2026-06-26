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
    name: 'get_my_profile',
    description:
      'Taxpayer WhatsApp mode only. Aktif WhatsApp konusmasindaki mukellefin temel profilini getirir. ' +
      'Backend aktif mukellefi kendisi baglar; taxpayerId veya baska mukellef bilgisi gonderme.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_my_work_status',
    description:
      'Taxpayer WhatsApp mode only. Aktif mukellefin kendi donem evrak/islem durumunu read-only getirir. ' +
      'Backend aktif mukellefi kendisi baglar; taxpayerId veya baska mukellef bilgisi gonderme.',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', description: 'Opsiyonel donem: YYYY-MM. Bos ise guncel ay.' },
      },
    },
  },
  {
    name: 'get_my_documents',
    description:
      'Taxpayer WhatsApp mode only. Aktif mukellefin kendi yuklu evrak listesini read-only getirir. ' +
      'Dosya URL veya gizli anahtar dondurmez. Backend aktif mukellefi kendisi baglar.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Varsayilan 10, max 20.' },
      },
    },
  },
  {
    name: 'get_my_open_tasks',
    description:
      'Taxpayer WhatsApp mode only. Aktif mukellefle ilgili acik takip/gorevleri read-only getirir. ' +
      'Backend aktif mukellefi kendisi baglar; taxpayerId gonderme.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Varsayilan 8, max 20.' },
      },
    },
  },
  {
    name: 'get_my_recent_messages',
    description:
      'Taxpayer WhatsApp mode only. Aktif mukellefin kendi son WhatsApp konusma gecmisini read-only getirir. ' +
      'Backend aktif mukellefi kendisi baglar; baska mukellef gecmisi asla okunmaz.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Varsayilan 8, max 20.' },
      },
    },
  },
  {
    name: 'get_my_kdv',
    description:
      'Taxpayer WhatsApp mode only. Aktif mukellefin KENDI donem KDV ozetini (fatura/eslesme/tutar) read-only getirir. ' +
      '"KDV\'m ne kadar", "KDV durumum" gibi sorularda kullan. Backend aktif mukellefi kendisi baglar; taxpayerId gonderme.',
    input_schema: {
      type: 'object',
      properties: {
        donem: { type: 'string', description: 'Opsiyonel donem YYYY-MM. Bos ise guncel ay.' },
      },
    },
  },
  {
    name: 'get_my_invoices',
    description:
      'Taxpayer WhatsApp mode only. Aktif mukellefin KENDI faturalarini (tutar, karsi firma, tarih) read-only listeler. ' +
      '"Faturalarim", "su firmaya kestigim fatura", "bu ay kac fatura" gibi sorularda kullan. Backend aktif mukellefi kendisi baglar.',
    input_schema: {
      type: 'object',
      properties: {
        donem: { type: 'string', description: 'Opsiyonel donem YYYY-MM.' },
        type: { type: 'string', enum: ['SATIS', 'ALIS'], description: 'Opsiyonel fatura tipi.' },
        counterpartySearch: { type: 'string', description: 'Opsiyonel karsi firma adi / VKN / fatura no aramasi.' },
        limit: { type: 'number', description: 'Varsayilan 20, max 50.' },
      },
    },
  },
  {
    name: 'get_my_beyanname',
    description:
      'Taxpayer WhatsApp mode only. Aktif mukellefin KENDI beyanname DURUMUNU read-only getirir (durum: verildi/hazirlanmis + beyanTarihi). ' +
      '"Verildi mi" sorusunda durum alanina bak; onayNo BOS olmasi "verilmedi" anlamina GELMEZ (beyanTarihi varsa verilmistir). ' +
      'ODENECEK/TAHAKKUK TUTARINI DONMEZ ve musteriye soyleme; tutar sorulursa "musavirimiz kesinlestirince iletir" de. ' +
      'Backend aktif mukellefi kendisi baglar; taxpayerId gonderme.',
    input_schema: {
      type: 'object',
      properties: {
        donem: { type: 'string', description: 'Opsiyonel donem YYYY-MM.' },
      },
    },
  },
  {
    name: 'get_my_balance',
    description:
      'Taxpayer WhatsApp mode only. Aktif mukellefin KENDI cari bakiyesini, son hareketlerini ve SON ODEMESINI (sonOdeme) read-only getirir. ' +
      '"Borcum ne kadar", "bakiyem", "odeme gecmisim", "en son ne zaman odeme yaptim", "en son ne kadar odedim" gibi sorularda kullan. Backend aktif mukellefi kendisi baglar.',
    input_schema: {
      type: 'object',
      properties: {},
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
    name: 'list_tax_payable',
    description:
      'TEK ÇAĞRIDA ofisteki TÜM mükelleflerin belirli bir dönemde ÖDEYECEĞİ vergiyi (beyanname tahakkuk) TÜR bazında listeler + tutarlar. ' +
      'PORTFÖY-GENELİ "kimlere ÖDEME/vergi çıkıyor", "X çıkan mükellefler ve tutarları", "kim ne kadar ödeyecek" sorularında MUTLAKA bunu kullan — ' +
      'get_kdv_summary TEK mükellef içindir, onu 50 kez çağırma. ' +
      'beyanTipi: KDV (varsayılan), MUHSGK (muhtasar/SGK/stopaj), GECICI (geçici vergi), DAMGA, KURUMLAR, GELIR. ' +
      'Kullanıcı "muhtasar/SGK ödemesi çıkanlar"→MUHSGK, "geçici vergi çıkanlar"→GECICI, "damga"→DAMGA, sadece "ödeme/vergi çıkanlar"→KDV. ' +
      'Dönem aylıkta "YYYY-MM" (2026-05), geçici/çeyreklikte "YYYY-Qn" (2026-Q1). Dönem BOŞ bırakılırsa o türün tahakkuku DOLU EN SON dönem otomatik seçilir — dönemi GERİ SORMA, listeyi hemen ver. ' +
      'Sonuç para içerir → YALNIZ ofis sahibi (owner) için.',
    input_schema: {
      type: 'object',
      properties: {
        beyanTipi: {
          type: 'string',
          description: 'Vergi türü: KDV | MUHSGK | GECICI | DAMGA | KURUMLAR | GELIR. Belirtilmezse KDV.',
        },
        period: {
          type: 'string',
          description: 'Dönem "YYYY-MM" (aylık) veya "YYYY-Qn" (geçici/çeyreklik). Boş=o türün tahakkuku dolu en son dönem.',
        },
        sadeceOdemeCikan: {
          type: 'boolean',
          description: 'true=sadece ödeme çıkanlar (tahakkuk>0, varsayılan). false=devreden/sıfır dahil hepsi.',
        },
        onlyActive: {
          type: 'boolean',
          description: 'Sadece aktif mükellefler (varsayılan true).',
        },
      },
    },
  },
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
      'Mükellefin İşlenen Faturalar modülündeki faturalarını listeler (/panel/faturalar, MihsapInvoice). ' +
      'taxpayerId bilinmiyorsa taxpayerName/mukellefName ile mükellefi bulur; period/donem YYYY-MM veya "Nisan" gibi ay adı olabilir. ' +
      'Alış/satış tipi, karşı firma, tarih aralığı ve tutara göre filtreler; özet toplamları ve fatura satırlarını döndürür.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string', description: 'Biliniyorsa mükellef ID' },
        taxpayerName: { type: 'string', description: 'Mükellef adı/ünvanı. Örn: "Doğan Özkan"' },
        mukellefName: { type: 'string', description: 'taxpayerName alternatifi' },
        period: { type: 'string', description: 'YYYY-MM veya ay adı. Örn: "2026-04", "Nisan"' },
        donem: { type: 'string', description: 'period alternatifi, YYYY-MM' },
        source: {
          type: 'string',
          enum: ['ISLENEN_FATURALAR', 'EARSIV', 'EFATURA', 'MUHASEBE', 'ALL'],
          description: 'Varsayılan ISLENEN_FATURALAR. ALL istenirse diğer fatura kaynaklarını da ekler.',
        },
        type: { type: 'string', enum: ['SATIS', 'ALIS', 'ARSIV'] },
        faturaTuru: { type: 'string', enum: ['SATIS', 'ALIS', 'ARSIV'] },
        counterpartySearch: { type: 'string', description: 'Karşı firma adı, VKN/TCKN veya fatura no araması' },
        firmaSearch: { type: 'string', description: 'counterpartySearch alternatifi' },
        status: { type: 'string' },
        startDate: { type: 'string', description: 'ISO tarih (YYYY-MM-DD)' },
        endDate: { type: 'string' },
        minAmount: { type: 'number' },
        maxAmount: { type: 'number' },
        limit: { type: 'number', description: 'Varsayılan 50, max 200' },
      },
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
      '"2025-03 dönemi MUHSGK eksik olanlar", "X beyannamesi verildi mi?" gibi sorularda kullan. ' +
      'Her kayıt: mükellef, beyanTipi, dönem, durum(verildi/hazirlanmis), beyanTarihi, onay no, tahakkuk tutarı, PDF var mı. ' +
      '"Verildi mi" sorusunda durum/verildi alanına bak; onayNo BOŞ olması "verilmedi" anlamına GELMEZ (beyanTarihi/tahakkuk varsa verilmiştir).',
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

  // ============ AJAN KOMUTLARI + MALİYET ============
  {
    name: 'get_agent_status',
    description:
      'Mihsap/Luca gibi yerel ajanların canlı durumunu ve son komutlarını getirir. "Fatura agent çalışıyor mu?", ' +
      '"Son komut ne oldu?", "Mihsap agent son durum" sorularında kullan.',
    input_schema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          enum: ['mihsap', 'mihsap-supervised-agent', 'mihsap-fatura-isleme-agent', 'luca', 'sgk', 'tebligat', 'kdv', 'beyan-hazirlik', 'luca-beyanname', 'kdv-beyan', 'tahsilat', 'banka-ekstre', 'edefter', 'whatsapp'],
          description: 'Opsiyonel ajan filtresi.',
        },
        limit: { type: 'number', description: 'Son komut sayısı. Varsayılan 10.' },
      },
    },
  },
  {
    name: 'get_system_health',
    description:
      'Portalın ve ajanların sistem sağlığını + AÇIK (çözülmemiş) uyarılarını döner: ajan ping, token yaşı, bekleyen kuyruk, ' +
      'hata oranı, modül hash, agent sürüm, veritabanı. "Sistemde sorun var mı?", "Her şey yolunda mı?", "Bir aksaklık var mı?", ' +
      '"Sistem durumu ne?", "Ajanlar ayakta mı?" sorularında kullan.',
    input_schema: {
      type: 'object',
      properties: {
        onlyProblems: { type: 'boolean', description: 'true (varsayılan) sadece WARNING/CRITICAL döner; false hepsini.' },
        limit: { type: 'number', description: 'En fazla uyarı sayısı. Varsayılan 20.' },
      },
    },
  },
  {
    name: 'get_operation_briefing',
    description:
      'Ofisin bugünkü operasyon brifingini döner: evrak/beyan hazırlığı, banka ekstre eksikleri, cari tahsilat riski, agent hataları, onay kuyruğu ve önerilen işler. ' +
      '"Bugün ne yapmalıyım?", "Neyi unutuyorum?", "Ofisin durumu ne?" sorularında ilk kullanılacak tool budur.',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', description: 'Dönem YYYY-MM. Boşsa cari ay.' },
      },
    },
  },
  {
    name: 'get_taxpayer_work_status',
    description:
      'Tek mükellef için beyanname/fatura/KDV/LUCA/Mihsap/cari/banka hazırlık durumunu ve eksikleri özetler. ' +
      '"ABC hazır mı?", "Bu mükellefte ne eksik?", "KDV öncesi durumu ne?" sorularında kullan.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        period: { type: 'string', description: 'Dönem YYYY-MM. Boşsa cari ay.' },
      },
      required: ['taxpayerId'],
    },
  },
  {
    name: 'get_luca_agent_jobs',
    description:
      'LUCA agent komutları, son olayları ve durumunu döner. LUCA’dan fatura/mizan çekme işleri nerede kaldı sorularında kullan.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Varsayılan 20, max 100.' },
      },
    },
  },
  {
    name: 'get_mihsap_agent_jobs',
    description:
      'Mihsap agent işleri, fatura çekme/işleme jobları, son loglar ve hataları döner. "Mihsap nerede hata verdi?" sorularında kullan.',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', description: 'Dönem YYYY-MM. Boşsa cari ay.' },
        limit: { type: 'number', description: 'Varsayılan 20, max 100.' },
      },
    },
  },
  {
    name: 'preview_agent_command',
    description:
      'Riskli bir portal agent komutunu çalıştırmadan önce önizler. LUCA/Mihsap/KDV/SGK/Tebligat/WhatsApp işlemleri için OwnerApprovalRequest, previewId ve 5 dakika geçerlilik üretir. ' +
      'WhatsApp için action örnekleri: document_send, document_request, conversation_reply, conversation_start, call_request. Kullanıcıya onay metni ve etki özeti göstermek için kullan.',
    input_schema: {
      type: 'object',
      properties: {
        agent: { type: 'string', enum: ['mihsap', 'mihsap-supervised-agent', 'mihsap-fatura-isleme-agent', 'luca', 'sgk', 'tebligat', 'kdv', 'beyan-hazirlik', 'luca-beyanname', 'kdv-beyan', 'tahsilat', 'banka-ekstre', 'edefter', 'whatsapp'] },
        action: { type: 'string' },
        payload: { type: 'object' },
      },
      required: ['agent', 'action', 'payload'],
    },
  },
  {
    name: 'create_confirmed_agent_command',
    description:
      'Sadece kullanıcı net onay verdikten sonra agent komutu oluşturur. confirmationText kesin olarak ONAYLIYORUM #PRV-XXXX formatında olmalıdır; agent/action/payload preview kaydından okunur. ' +
      'WhatsApp belge gönderme, evrak talebi, konuşma yanıtı/başlatma ve arama isteği de bu onaylı komut akışından geçirilir.',
    input_schema: {
      type: 'object',
      properties: {
        agent: { type: 'string', enum: ['mihsap', 'mihsap-supervised-agent', 'mihsap-fatura-isleme-agent', 'luca', 'sgk', 'tebligat', 'kdv', 'beyan-hazirlik', 'luca-beyanname', 'kdv-beyan', 'tahsilat', 'banka-ekstre', 'edefter', 'whatsapp'] },
        action: { type: 'string' },
        payload: { type: 'object' },
        previewId: { type: 'string', description: 'Preview ID, orn PRV-AB12. Opsiyonel; confirmationText icinden de okunur.' },
        confirmationText: { type: 'string', description: 'ONAYLIYORUM #PRV-XXXX formatinda kullanici onayi.' },
      },
      required: ['confirmationText'],
    },
  },
  {
    name: 'get_collection_risk_summary',
    description:
      'Cari kasa tahsilat riskini özetler: borçlu sayısı, toplam açık bakiye, 90+ gün riski ve WhatsApp uygun kayıtlar.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'En riskli mükellef sayısı. Varsayılan 20.' },
      },
    },
  },
  {
    name: 'get_bank_status',
    description:
      'Bir mükellefin banka hesaplarını (banka adı, IBAN, şube, para birimi) ve dönem ekstre durumunu (ekstre geldi mi / işlendi mi + tarih + not) getirir. "X firmanın ekstresi geldi mi", "IBAN ne", "ekstre işlendi mi" sorularında kullan.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        taxpayerName: { type: 'string', description: 'Mükellef adı (taxpayerId yoksa).' },
        donem: { type: 'string', description: 'YYYY-MM ekstre dönemi (opsiyonel; yoksa son dönemler).' },
      },
    },
  },
  {
    name: 'get_cari_hareketler',
    description:
      'Bir mükellefin cari kasa hareketlerini (TAHAKKUK/TAHSILAT/IADE/DUZELTME) listeler: tarih, tip, tutar, ödeme yöntemi (nakit/havale/POS/çek), belge no, dönem. Net bakiye + son tahsilat da döner. "Son tahsilat ne zaman nasıl yapıldı", "bu mükellef ne ödedi", "cari hareketleri" sorularında kullan.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        taxpayerName: { type: 'string', description: 'Mükellef adı (taxpayerId yoksa).' },
        tip: { type: 'string', description: 'Filtre: TAHSILAT | TAHAKKUK | IADE | DUZELTME (opsiyonel).' },
        limit: { type: 'number', description: 'Kayıt sayısı (varsayılan 20).' },
      },
    },
  },
  {
    name: 'list_earsiv_invoices',
    description:
      'Bir mükellefin e-arşiv/e-fatura DETAYINI listeler (gerçek EarsivFatura tablosu): satıcı/alıcı, matrah, KDV oranı/tutarı, toplam, fatura no, tarih, ETTN. tip=SATIS/ALIS, kaynak=EARSIV/EFATURA, dönem filtreli. "X firmanın nisan e-arşiv satış faturaları", "en büyük alış faturaları" sorularında kullan. (list_invoices İŞLENEN faturadır; bu HAM e-belge.)',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        taxpayerName: { type: 'string' },
        donem: { type: 'string', description: 'YYYY-MM' },
        tip: { type: 'string', description: 'SATIS | ALIS' },
        kaynak: { type: 'string', description: 'EARSIV | EFATURA' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'list_tasks',
    description:
      'Görev modülündeki görevleri listeler: başlık, durum (OPEN/IN_PROGRESS/DONE...), öncelik, kategori, son tarih, bağlı mükellef. "açık görevler", "geciken görevler", "X için görevler" sorularında kullan. status/onlyOverdue/mükellef filtreli.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        taxpayerName: { type: 'string' },
        status: { type: 'string', description: 'OPEN | IN_PROGRESS | DONE (opsiyonel)' },
        onlyOverdue: { type: 'boolean', description: 'Yalnız son tarihi geçmiş, kapanmamış görevler' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'list_etebligat',
    description:
      'Mükelleflerin e-Tebligat ve portal belgelerini (PortalDocument: GİB e-tebligat, SGK belgeleri) listeler: belge türü, başlık, dönem, tebliğ/alınma tarihi, referans no, görüntülendi mi. "bugün gelen e-tebligatlar", "X firmanın e-tebligatları" sorularında kullan.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        taxpayerName: { type: 'string' },
        belgeTuru: { type: 'string', description: 'E_TEBLIGAT (varsayılan) veya TUMU' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'get_isletme_hesap_ozeti',
    description:
      'İşletme defteri mükellefi için dönem hesap özeti: satış hasılatı, mal alışı, satılan mal maliyeti, net satışlar, dönem giderleri, dönem kârı, geçici vergi matrahı ve ödenecek geçici vergi. İşletme defteri (2. sınıf) mükellefleri için kullan.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        taxpayerName: { type: 'string' },
        yil: { type: 'number' },
        donem: { type: 'number', description: 'çeyrek 1-4' },
      },
    },
  },
  {
    name: 'get_accounting_reference',
    description:
      'TDHP (Tek Düzen Hesap Planı) hesap kodu→isim ve GÜNCEL vergi oranı (kurumlar/geçici/KDV/KDV2 tevkifat) için DOĞRULANMIŞ referans. Hesap kodu ("100 101 hangi hesaplar"), hesap planı veya vergi oranı sorulursa EZBERDEN cevap verme; bunu çağır. kodlar verilirse o kodların adı; oranTipi verilirse o verginin oranı döner.',
    input_schema: {
      type: 'object',
      properties: {
        kodlar: { type: 'array', items: { type: 'string' }, description: 'TDHP hesap kodları (örn. ["100","101","391"]). Boşsa tam cetvel.' },
        oranTipi: { type: 'string', description: 'Vergi oranı: kurumlar | gecici | kdv | kdv2' },
      },
    },
  },
  {
    name: 'get_beyanname_readiness_summary',
    description:
      'Tüm mükellefler için beyanname hazırlık skorunu üretir: evrak, işleme, KDV kontrol, banka ekstresi, mizan, beyan kaydı ve cari risk eksikleri.',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', description: 'Dönem YYYY-MM. Boşsa cari ay.' },
        limit: { type: 'number', description: 'En sorunlu mükellef sayısı. Varsayılan 30.' },
      },
    },
  },
  {
    name: 'get_portal_capability_map',
    description:
      'MOREN AI’ın portaldaki hangi modüllerden veri okuyabildiğini, hangilerinde analiz yapabildiğini ve hangi agent/komutlarla işlem başlatabildiğini döner. ' +
      'Kullanıcı "neler yapabiliyorsun", "bütün modüllere entegre misin", "şu işi hangi modülle yaparsın" gibi geniş kapsamlı soru sorarsa kullan.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'research_official_sources',
    description:
      'Güncel vergi, SGK, iş hukuku, ticaret hukuku, e-belge, beyanname, ceza, had, süre ve mevzuat soruları için resmi kaynak araştırması yapar. ' +
      'GİB, SGK, Resmi Gazete, mevzuat.gov.tr, TÜRMOB, Hazine ve Maliye, KGK, TCMB ve ilgili kamu/meslek kurumu kaynakları dışındaki sonuçları filtreler. ' +
      'Güncel rakam/süre/ceza, finansal düzenleme, mesleki duyuru ve vergi planlama sorularında cevap vermeden önce kullan.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Araştırılacak mevzuat sorusu veya anahtar kelimeler.' },
        domains: {
          type: 'array',
          items: { type: 'string' },
          description: 'Opsiyonel resmi alan adı filtresi. Örn: ["gib.gov.tr", "sgk.gov.tr"]. Boşsa tüm güvenilir resmi kaynaklar aranır.',
        },
        limit: { type: 'number', description: 'Döndürülecek resmi kaynak sayısı. Varsayılan 2, max 4.' },
        remember: { type: 'boolean', description: 'Bulunan resmi kaynak özetini MOREN AI hafızasına yaz. Varsayılan true.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_ai_memory',
    description:
      'MOREN AI hafızasında arama yapar. Ofis alışkanlıkları, mükellef özel notları, portal/mobil/agent hafızası için kullan.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        taxpayerId: { type: 'string' },
        scope: { type: 'string', enum: ['office', 'taxpayer', 'portal', 'mobile', 'agent'] },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'save_ai_memory',
    description:
      'Kullanıcı açıkça "bunu hatırla", "hafızaya al" dediğinde MOREN AI hafızasına not kaydeder. Hassas işlemler veya tahminler kaydedilmez.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        taxpayerId: { type: 'string' },
        scope: { type: 'string', enum: ['office', 'taxpayer', 'portal', 'mobile', 'agent'] },
        importance: { type: 'number' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'create_agent_command',
    description:
      'Kullanıcı AÇIKÇA ONAYLADIKTAN sonra yerel ajana işlem komutu gönderir. İlk istekte bu tool kullanılmaz; önce preview_agent_command ile previewId oluştur. ' +
      'Sadece kullanıcı "ONAYLIYORUM #PRV-XXXX" formatında net ikinci onay verdikten sonra çağır. Agent/action/payload preview kaydından okunur.',
    input_schema: {
      type: 'object',
      properties: {
        agent: { type: 'string', enum: ['mihsap', 'mihsap-supervised-agent', 'mihsap-fatura-isleme-agent', 'luca', 'sgk', 'tebligat', 'kdv', 'beyan-hazirlik', 'luca-beyanname', 'kdv-beyan', 'tahsilat', 'banka-ekstre', 'edefter', 'whatsapp'] },
        action: { type: 'string', description: 'Örn: isle_alis, isle_satis, isle_alis_isletme, isle_satis_isletme.' },
        payload: { type: 'object', description: 'Ajanın beklediği komut yükü.' },
        previewId: { type: 'string', description: 'Preview ID, örn. PRV-AB12. Opsiyonel; confirmationText içinden de okunur.' },
        confirmationText: { type: 'string', description: 'Güvenlik için kullanıcı onay metni. ONAYLIYORUM #PRV-XXXX olmalı.' },
      },
      required: ['confirmationText'],
    },
  },
  {
    name: 'get_ai_cost_summary',
    description:
      'AI maliyetlerini modül bazında özetler. Fatura başı maliyet, Moren AI sohbet maliyeti, toplam günlük/aylık harcama gibi sorularda kullan.',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'month', 'all'], description: 'Varsayılan month.' },
        source: { type: 'string', description: 'Opsiyonel kaynak filtresi: mihsap-fatura, mihsap-isletme, moren-ai vb.' },
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
