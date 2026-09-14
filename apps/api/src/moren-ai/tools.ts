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
      'Kullanıcı bir mükellef adı söylediğinde (örn. "Ali Tekstil") önce bu tool ile ID bul, sonraki çağrılarda taxpayerId kullan. ' +
      'Her satırda defterTuru (BILANCO | ISLETME | null) da döner; birden çok eşleşme varsa işlem yapmadan sahibe sor.',
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
      'evrak teslim günü, son hatırlatma, aylık durum kayıtları (son 6 ay), defterTuru (BILANCO | ISLETME | null — KDV Kontrol oturum türü ve İHÖ/GT dalı bunu belirler). ' +
      'Mükellef ID biliniyorsa bunu çağır.',
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
    name: 'get_my_tebligat',
    description:
      'Taxpayer WhatsApp mode only. Aktif mukellefin KENDI e-Tebligatlari (GIB elektronik tebligat) — baslik, donem, tarih, okundu mu. ' +
      '"tebligat var mi", "bana tebligat gelmis mi", "e-tebligatim" sorularinda kullan. Backend aktif mukellefi kendisi baglar.',
    input_schema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'get_my_sgk',
    description:
      'Taxpayer WhatsApp mode only. Aktif mukellefin KENDI SGK belgeleri (tahakkuk fisi, hizmet listesi). ' +
      '"sgk tahakkukum", "hizmet listem", "sgk belgem" sorularinda kullan.',
    input_schema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'get_my_isletme_hesap_ozeti',
    description:
      'Taxpayer WhatsApp mode only. Aktif mukellefin KENDI isletme hesap ozeti (isletme defteri geçici vergi donemi): satis, gider, donem kari, odenecek gecici vergi. ' +
      '"isletme hesap ozetim", "kar zararim", "gecici vergim ne kadar" sorularinda kullan. yil/donem verilebilir.',
    input_schema: { type: 'object', properties: { yil: { type: 'number' }, donem: { type: 'number' } } },
  },
  {
    name: 'get_my_vergi_takvimi',
    description:
      'Taxpayer WhatsApp mode only. Aktif mukellefin KENDI yaklasan beyanname/odeme son gunleri. ' +
      '"ne zaman odemem gerek", "son gun ne zaman", "vergi takvimim" sorularinda kullan.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_my_odeme_listesi',
    description:
      'Taxpayer WhatsApp mode only. Aktif mukellefin KENDI aylik ODEME CETVELI: bu ay odenecek vergi tahakkuklari ' +
      '(KDV, muhtasar, gecici vergi, yillik gelir/kurumlar taksiti) + SGK primi; her kalemde son odeme gunu (hafta sonu/tatil ' +
      'kaydirilmis) ve tutar, toplam, cetvelin musavirlikce gonderilip gonderilmedigi. ' +
      '"bu ay ne odeyecegim", "odeme listem", "odeme cetvelim", "bu ay ne kadar vergi cikti", "SGK primim ne kadar" sorularinda kullan. ' +
      'Bu aractan gelen tutarlar OFISIN mukellefe gonderdigi cetvel tutarlaridir; soylenebilir. Backend aktif mukellefi kendisi baglar.',
    input_schema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'Opsiyonel ODEME AYI YYYY-MM (bos ise icinde bulunulan ay).' },
      },
    },
  },
  {
    name: 'list_fatura_merkezi',
    description:
      'FATURA ISLEME MERKEZI kayitlari (islenen/onaylanan faturalar, Luca aktarim durumu, kopya uyarilari). ' +
      '"kac fatura islendi", "hangi faturalar Lucaya gitti", "onay bekleyen fatura var mi", "kopya fatura" sorularinda BUNU kullan. ' +
      'DIKKAT: list_invoices HAM Mihsap/e-arsiv listesidir; ISLENEN fatura sayisi BURADAN gelir. ' +
      'Suzgecler: taxpayerId/taxpayerName, donem (yyyy-mm), durum (NEEDS_REVIEW|READY|APPROVED|REJECTED), lucaDurum (NOT_STARTED|QUEUED|POSTED|FAILED), tur (ALIS|SATIS).',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' }, taxpayerName: { type: 'string' }, donem: { type: 'string' },
        durum: { type: 'string' }, lucaDurum: { type: 'string' }, tur: { type: 'string' }, limit: { type: 'number' },
      },
    },
  },
  {
    name: 'list_edefter_sessions',
    description:
      'e-DEFTER KONTROL oturumlari: donem, kaynak (LUCA/EXCEL), durum, satir/fis sayisi ve BULGU sayisi. ' +
      '"e-defter kontrolu yapildi mi", "kac bulgu cikti", "hangi donem kontrol edildi" sorularinda kullan. Mizan araclariyla KARISTIRMA.',
    input_schema: { type: 'object', properties: { taxpayerId: { type: 'string' }, taxpayerName: { type: 'string' }, donem: { type: 'string' }, limit: { type: 'number' } } },
  },
  {
    name: 'list_automations',
    description:
      'OTOMASYONLAR modulu: tanimli otomasyonlar, durumlari, son calisma zamani ve sonucu. ' +
      '"otomasyonlar calisiyor mu", "hangi otomasyon hata verdi", "son ne zaman calisti" sorularinda kullan. ' +
      'AJAN (Luca/Mihsap) isleriyle KARISTIRMA — onlar get_agent_status / get_luca_agent_jobs.',
    input_schema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'get_gundem',
    description:
      'Gunun gundemi: TCMB doviz kurlari, TUFE/enflasyon ve kira artis tavani, piyasa (BIST/altin), Resmi Gazete ozetleri. ' +
      'Kamuya acik veri; hem owner hem mukellef sorabilir. "dolar kac", "kur ne", "enflasyon", "kira artis orani", "resmi gazetede ne var" sorularinda kullan. ' +
      'bolum: kur | piyasa | enflasyon | mevzuat (bos birakilirsa ozet doner).',
    input_schema: { type: 'object', properties: { bolum: { type: 'string' } } },
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
      'Hesap bazlı sorgular, toplam analiz, hata tespiti için kullan. donem formatı: "2026-03" (aylık) veya "2026-Q1" (geçici dönem). ' +
      // 2026-09-12: 100 hesap tavanı kalktı (144 hesaplık mizanda 44 hesap ajana görünmüyordu → Denetçi görmediği hesabı uydurdu).
      'Varsayılan tek seferde 400 hesap; daha kalabalık mizanda truncated:true + toplamHesap döner → hesapKodu öneki ya da sayfa ile daralt.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        donem: { type: 'string', description: 'Dönem kodu: "2026-03", "2026-Q1", "2025-YILLIK" vb.' },
        hesapKoduFiltresi: {
          type: 'string',
          description:
            'Opsiyonel: belirli hesap koduyla başlayan satırları getir. Örn "1" = dönen varlıklar, "600" = satışlar, "770" = gen. yön. gid. ' +
            'Birden çok önek için virgülle ayır ("100,102,131") ya da dizi ver.',
        },
        hesapKodu: {
          type: 'string',
          description: 'hesapKoduFiltresi ile aynı: hesap kodu öneki ("136" → 136 ve tüm alt hesapları). Virgülle çoklu önek olur.',
        },
        sayfa: {
          type: 'number',
          description: 'Opsiyonel sayfa numarası (1\'den başlar). Çıktıda truncated:true görürsen sayfa:2, 3… ile devam et.',
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
      'Dönem yorumu, kârlılık analizi, maliyet/gider dağılımı için kullan. Aynı dönemde birden çok kopya varsa KİLİTLİ olan döner ' +
      '(kopyaSayisi, kilitliKopyaVar, mizanId, duzeltmeler, geciciVergiHesabi alanları da gelir); hazır tablo varken Luca çekimi İSTEME.',
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
  // ============ MALİ TABLO YARDIMCILARI (PLAN/17 R2 — 2026-09-13) ============
  {
    name: 'mali_donemler_listele',
    description:
      'Mali tablo sorusunda (gelir tablosu/bilanço/mizan analizi, yorumu) ÖNCE bunu çağır: mükellefin portalda HAZIR mali tablo dönemlerini tek listede verir ' +
      '(gelir tablosu + bilanço + mizan; e-Defter kaynaklı mizanlar süzülür, kilitli kayıt önce gelir). Hazır tablo varsa Luca çekimi/Denetçi ÖNERME, tabloyu oku. ' +
      'Satır: {tur, donem, id, kilitli, kaynak, createdAt}.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string', description: 'Mükellef id (list_taxpayers ile bul).' },
      },
      required: ['taxpayerId'],
    },
  },
  {
    name: 'mali_yorum_oku',
    description:
      'Sahibin portalda kayıtlı Mali Yorum (AI değerlendirme) metnini okur — gelir tablosu/bilanço/mizan/İHÖ yorumlarken "kayıtlı yorum var mı, çelişiyor muyum" diye bak. ' +
      'Yorum ÜRETMEZ/kaydetmez. Sonuç {ozet, model, updatedAt} ya da null (kayıtlı yorum yok).',
    input_schema: {
      type: 'object',
      properties: {
        kaynak: { type: 'string', enum: ['MIZAN', 'BILANCO', 'GELIR_TABLOSU', 'IHO'], description: 'Tablo türü.' },
        kaynakId: { type: 'string', description: 'İlgili kaydın id\'si (get_gelir_tablosu → kayitId; get_mizan → mizanId; IHO için "taxpayerId:yil").' },
      },
      required: ['kaynak', 'kaynakId'],
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
  {
    name: 'get_kdv1_on_hazirlik',
    description:
      'KDV1 beyanname ön hazırlığı: matrah, hesaplanan, indirilecek, devreden (önceki beyannameden), ödenecek/sonraki aya devreden — tek kaynak KDV Kontrol. ' +
      'Beyanname taslağı, tahakkuk fişi (391/191 → 360 veya 190) ve devreden KDV için BU aracı kullan; list_beyan_kayitlari yalnız tahakkuk/durum ("verildi mi") içindir. ' +
      'KDV Kontrol oturumu yoksa ok:false ve error="KDV Kontrol oturumu yok" döner; ham fatura listesinden rakam ÜRETİLMEZ, uydurma yok. ' +
      'Luca çapraz kontrol farkı (391/191), eksik veriler ve veri güveni uyarilar/eksikVeriler/veriGuveni alanlarındadır; kritik uyarı varken "hazır" deme.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string', description: 'Mükellefin sistem ID\'si (cuid). Bilinmiyorsa önce list_taxpayers.' },
        donem: { type: 'string', description: 'Beyan dönemi YYYY-MM, örn "2026-08".' },
      },
      required: ['taxpayerId', 'donem'],
    },
  },

  // ============ FATURALAR ============
  {
    name: 'list_invoices',
    description:
      'HAM fatura listesi (Mihsap/e-arsiv/e-fatura kaynaklarindan cekilen kayitlar). ISLENEN/muhasebelestirilen fatura sayisi icin list_fatura_merkezi kullan. Mükellefin İşlenen Faturalar modülündeki faturalarını listeler (/panel/faturalar, MihsapInvoice). ' +
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
      'kalemlerde değişim yüzdesi ve mutlak fark. "Geçen yılla kıyasla", "Q1 vs Q2" tarzı sorular için. ' +
      // 2026-09-12: bilanco/mizan boş dönüyordu; artık hesap/kalem bazında en büyük 30 fark + toplamlar döner.
      'bilanco → grup ve hesap kırılımı, mizan → hesap kodu bazında bakiye farkı (enBuyukFarklar: en büyük 30 fark, toplamlar). ' +
      'Kaynak değeri KÜÇÜK HARF: gelir_tablosu | bilanco | mizan. Dönem biçimi: YYYY-MM ya da YYYY-Qn.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        donem1: { type: 'string', description: 'İlk dönem (önceki, kıyaslama tabanı): "2026-Q1", "2026-03"' },
        donem2: { type: 'string', description: 'İkinci dönem (yeni, kıyaslanan): "2026-Q2", "2026-06"' },
        kaynak: {
          type: 'string',
          enum: ['gelir_tablosu', 'bilanco', 'mizan'],
          description: 'Karşılaştırılacak tablo tipi (küçük harf): gelir_tablosu | bilanco | mizan',
        },
        hesapKoduFiltresi: {
          type: 'string',
          description: 'Opsiyonel (yalnız mizan): hesap kodu öneki, ör. "6" = gelir tablosu hesapları. Virgülle çoklu önek olur.',
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
      'Formül + değer + yorum (sağlıklı/dikkat/risk). ' +
      // 2026-09-12: çeyrek (geçici vergi) dönemi kabul edilir; bilanço/gelir tablosu yoksa mevcut dönemler listelenir.
      'Dönem: "2026-Q2" (geçici vergi/çeyrek), "2026-06" (aylık) ya da donem:"Q2" + yil:2026. ' +
      'Bilanço ya da gelir tablosu o dönem için yoksa hangi dönemlerin mevcut olduğunu söyler — rakam uydurma.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        donem: { type: 'string', description: '"2026-Q2", "2026-06" ya da "Q2" (yil ile birlikte)' },
        yil: { type: 'number', description: 'Opsiyonel: donem yalnız "Q2" gibi verildiyse yıl (ör. 2026)' },
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
      'Tek mükellef için beyanname/fatura/KDV/LUCA/cari/banka hazırlık durumunu ve eksikleri özetler. veri.faturaMerkezi = Fatura Merkezi dönem sayımları (toplam/bekleyen/onaylı/Luca/okunmadı/çelişki/mükerrer); veri.mihsapFatura yalnız eski Mihsap sayısı. ' +
      'KDV Kontrol oturumları periodLabel (YYYY/MM) ile, mizan çeyrek etiketiyle (2026-06 → 2026-Q2) aranır; "LUCA mizan yok" yalnız kilitli (e-Defter dışı) mizan yoksa yazılır. ' +
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

// =====================================================================================
// FATURA MERKEZİ AJAN ARAÇLARI (fm_*) — PLAN/15 Faz 5
//
// Ekip'teki Fatura Muhasebecisi'nin Fatura İşleme Merkezi'ne (InvoiceAccountingDocument)
// bakan araç seti. MOREN_AI_TOOLS'a KASITLI OLARAK EKLENMEDİ: genel WhatsApp/portal botu
// bu araçları görmez (orada list_fatura_merkezi kalır). Ekip runner'ı + araç defteri bu
// listeyi ayrıca yükler; çalıştırıcı ToolExecutorService.execute içindedir (fm_* dalları).
// Kademeler arac-defteri.ts'te: fm_belge_listele/fm_belge_detay/fm_donem_ozeti/
// fm_uyumsuzluklar/fm_hesap_plani_ara = oku; fm_hesap_ata/fm_ai_ile_oku/fm_isaretle/
// fm_onayla = portal_yaz; fm_luca_gonder = luca_yaz.
// =====================================================================================
export const FATURA_MERKEZI_AJAN_ARACLARI: ToolDefinition[] = [
  {
    name: 'fm_belge_listele',
    description:
      'Fatura Merkezi belge listesi (mükellef + dönem). Her belge için: id, belgeNo, tarih, karşı taraf, tutar, KDV, tevkifat var mı, ' +
      'durum, uyarılar ve hesap satırı özeti. durum süzgeci: bekleyen | eslesti (bekleyen + tüm matrah hesapları dolu) | kod_eksik ' +
      '(bekleyen + boş hesap satırı) | celiski (doğrulama sorunu var) | demirbas | okunmadi (ham/okunmamış) | onaylandi | luca (Luca\'ya gitti). ' +
      'yon: alis | satis. Dönem YYYY-MM. Belge açmak için dönen id ile fm_belge_detay çağır.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string', description: 'Mükellef ID (list_taxpayers ile bul).' },
        donem: { type: 'string', description: 'Dönem, YYYY-MM (örn. 2026-08). Fatura tarihine göre.' },
        yon: { type: 'string', enum: ['alis', 'satis'], description: 'Alış / satış süzgeci (isteğe bağlı).' },
        durum: {
          type: 'string',
          enum: ['bekleyen', 'eslesti', 'kod_eksik', 'celiski', 'demirbas', 'okunmadi', 'onaylandi', 'luca'],
          description: 'Durum süzgeci (isteğe bağlı; boşsa hepsi).',
        },
        limit: { type: 'number', description: 'En fazla belge (varsayılan 50, en çok 200).' },
      },
      required: ['taxpayerId', 'donem'],
    },
  },
  {
    name: 'fm_belge_detay',
    description:
      'Tek belgenin tam kartı: taraflar, kalemler, KDV kırılımı (oran/matrah/tutar), tevkifat (kod/oran/tutar), iade işareti, ' +
      'hesap satırları (satır no, grup, hesap kodu + adı, borç/alacak, kaynak: AI | KULLANICI | HAFIZA | AJAN | KURAL | VKN), doğrulama sonucu ve ' +
      'uyarılar (kod + mesaj), muhasebe gerekçesi, işletme defteri sınıfı (varsa), ajan işaretleri. Hesap atamadan önce MUTLAKA bunu oku.',
    input_schema: {
      type: 'object',
      properties: { belgeId: { type: 'string', description: 'Belge id (fm_belge_listele\'den).' } },
      required: ['belgeId'],
    },
  },
  {
    name: 'fm_donem_ozeti',
    description:
      'Mükellef + dönem sayaçları: toplam, bekleyen, eşleşti, kod eksik, çelişki, demirbaş, okunmadı, onaylı, Luca\'ya gitti, Luca hatalı, ' +
      'mükerrer, tevkifatlı; alış/satış kırılımı; hesap planı var mı; defter türü (bilanço/işletme). Dönem işine BUNUNLA başla.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        donem: { type: 'string', description: 'YYYY-MM' },
      },
      required: ['taxpayerId', 'donem'],
    },
  },
  {
    name: 'fm_uyumsuzluklar',
    description:
      'Dönemdeki sorunlu belgeler gruplu: icerikHesapUyumsuz (hesap adı içeriğe uymuyor / grup hesabı / sahiplik ters), tutarTutarsiz (denge, toplam, KDV aritmetiği, eksik tutar), ' +
      'mukerrer, tevkifatSupheli (tevkifat eksik / net tutar / şüpheli), demirbas, iade, okunmadi. Her madde: belgeId, belgeNo, karşı taraf, tutar, uyarı kodu + mesaj. ' +
      'Sonra her belgeyi fm_belge_detay ile aç.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        donem: { type: 'string', description: 'YYYY-MM' },
        limit: { type: 'number', description: 'Grup başına en fazla madde (varsayılan 30).' },
      },
      required: ['taxpayerId', 'donem'],
    },
  },
  {
    name: 'fm_hesap_plani_ara',
    description:
      'Bilanço mükellefinde Luca hesap planından aday hesaplar (yalnız YAPRAK hesaplar; grup hesaba fiş kesilmez): kod, ad, seviye. ' +
      'İşletme defterinde plan YOKTUR: Kayıt Türü + alt tür listesi döner (yon\'a göre gider/gelir). sorgu: hesap adı/kodu ya da içerik kelimesi (örn. "bakım", "770", "akaryakıt").',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        sorgu: { type: 'string', description: 'Aranan kelime / kod öneki.' },
        yon: { type: 'string', enum: ['alis', 'satis'], description: 'İşletme defterinde gider (alis) / gelir (satis) listesi; bilançoda etkisiz.' },
        limit: { type: 'number', description: 'Varsayılan 30.' },
      },
      required: ['taxpayerId', 'sorgu'],
    },
  },
  {
    name: 'fm_hesap_ata',
    description:
      'Belgenin bir hesap satırına GEREKÇELİ hesap önerisi yazar (kaynak = AJAN). KULLANICI kaynaklı satır ASLA ezilmez (hata döner). ' +
      'Bilanço: hesapKodu (plandaki yaprak kod). İşletme defteri: kayitTuruKod (+ kayitAltKod) — hesap kodu yok. ' +
      'satir: fm_belge_detay\'daki satır no (sayı) ya da grup adı (matrah | cari | vergi | vergi-sorumlu); grup adı birden çok satıra denk gelirse sayı zorunlu. ' +
      'Hesap adı içerikle uyuşmuyorsa ÇAĞIRMA — boş bırak ve fm_isaretle(incele) ile onaya sun. Yazdıktan sonra belge yeniden doğrulanır; sonuç döner.',
    input_schema: {
      type: 'object',
      properties: {
        belgeId: { type: 'string' },
        satir: { type: 'string', description: 'Satır no (örn. "0") ya da grup adı (matrah/cari/vergi/vergi-sorumlu). İşletme defterinde gerekmez.' },
        hesapKodu: { type: 'string', description: 'Bilanço: plandaki yaprak hesap kodu (örn. 770.01.003).' },
        kayitTuruKod: { type: 'string', description: 'İşletme defteri: Kayıt Türü kodu (fm_hesap_plani_ara\'dan).' },
        kayitAltKod: { type: 'string', description: 'İşletme defteri: Kayıt alt tür kodu (varsa).' },
        gerekce: { type: 'string', description: 'Tek cümle: içerik → hesap adı neden uyuşuyor.' },
      },
      required: ['belgeId', 'gerekce'],
    },
  },
  {
    name: 'fm_ai_ile_oku',
    description:
      'Okunmamış / ham belgeleri sunucu kuyruğunda AI ile okutur (KDV kırılımı + hesap satırı üretir). Hemen döner (kuyruğa alındı sayısı); ' +
      'sonucu birkaç dakika sonra fm_belge_listele ile kontrol et. Onaylı belge atlanır.',
    input_schema: {
      type: 'object',
      properties: { belgeIdler: { type: 'array', items: { type: 'string' }, description: 'Belge id listesi (en çok 100).' } },
      required: ['belgeIdler'],
    },
  },
  {
    name: 'fm_isaretle',
    description:
      'Belgeye ajan işareti + not koyar ve onay bekleyen listesine düşürür (durum NEEDS_REVIEW). etiket: demirbas | tevkifat_supheli | incele | mukerrer_supheli | iade. ' +
      'Belgeyi DEĞİŞTİRMEZ, hesap yazmaz; sahibin bakması için işaretler.',
    input_schema: {
      type: 'object',
      properties: {
        belgeId: { type: 'string' },
        etiket: { type: 'string', enum: ['demirbas', 'tevkifat_supheli', 'incele', 'mukerrer_supheli', 'iade'] },
        not: { type: 'string', description: 'Tek satır: neden şüpheli / Muzaffer Bey’den ne bekleniyor.' },
      },
      required: ['belgeId', 'etiket', 'not'],
    },
  },
  {
    name: 'fm_onayla',
    description:
      'Belgeyi onaylar (APPROVED → Luca kuyruğu). Fatura ajanına KAPALIDIR — onay sahibindir. Yalnız sahip portaldan onaylar.',
    input_schema: {
      type: 'object',
      properties: { belgeId: { type: 'string' } },
      required: ['belgeId'],
    },
  },
  {
    name: 'fm_luca_gonder',
    description:
      'ONAYLI belgeleri Luca\'ya toplu fiş (Excel Fiş Aktarım) olarak gönderir — mevcut batchPostToLuca kuyruğu. Yalnız APPROVED + doğrulaması OK belgeler gider; ' +
      'dengesiz/eksik kodlu belge atlanır. Kuru testte ÇALIŞMAZ; sahip "canlı" demeden çağırma.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        belgeIdler: { type: 'array', items: { type: 'string' }, description: 'Gönderilecek onaylı belge id\'leri. Boşsa dönem + yön ile seçilir.' },
        donem: { type: 'string', description: 'YYYY-MM (belgeIdler boşsa).' },
        yon: { type: 'string', enum: ['alis', 'satis'] },
      },
      required: ['taxpayerId'],
    },
  },
];

/** fm_* araç adları (runner + defter + çalıştırıcı için tek kaynak). */
export const FM_AJAN_ARAC_ADLARI: string[] = FATURA_MERKEZI_AJAN_ARACLARI.map((t) => t.name);

// =====================================================================================
// EKİP İŞ ZİNCİRİ ARAÇLARI — PLAN/17 §3 (2026-09-13)
//
// KDV Kontrol zinciri (R1: oturum → Luca çekimi → fatura bağlama → OCR → eşleştirme → satırlar),
// Luca iş bekleme ve Koordinatör'ün ajan başlatma/izleme araçları. MOREN_AI_TOOLS'a KASITLI
// OLARAK EKLENMEDİ (fm_* ile aynı gerekçe): genel WhatsApp/portal botu ve otomasyon kataloğu
// (action-catalog READ_ACTIONS = MOREN_AI_TOOLS) bunları görmesin — kdv_kontrol_luca_cek Luca
// işi açar, ocr_baslat Max kotası harcar. Ekip runner'ı + araç defteri bu listeyi ayrıca yükler
// (kademe: luca_cek = luca_yaz; oturum/fatura_bagla/ocr_baslat/eslestir = portal_yaz_agir;
// gerisi oku — eşleme arac-defteri.ts'te). Çalıştırıcı ToolExecutorService.execute içindedir.
// Bekleme araçları (luca_is_bekle, ocr_bekle) SUNUCU tarafında döngü kurar (≤60 sn/çağrı):
// runner'da uyku aracı yoktur, tur sayısı sınırlıdır.
// =====================================================================================
export const EKIP_IS_ZINCIRI_ARACLARI: ToolDefinition[] = [
  {
    name: 'kdv_kontrol_oturum_bul_olustur',
    description:
      'KDV Kontrol zincirinin (R1) 2. adımı: mükellef + dönem için KDV Kontrol oturumunu bulur, yoksa AÇAR. type verilmezse defterTuru\'ndan iki oturum türetir ' +
      '(BILANCO → KDV_191 alış + KDV_391 satış; ISLETME → ISLETME_GIDER + ISLETME_GELIR). Kilitli (COMPLETED) oturumda ZİNCİRE DEVAM ETME, sahibe "kilitli, açayım mı" sor. ' +
      'Kuru testte çalışmaz (yapılacaktı). Çıktı: oturumlar[{sessionId, type, status, yeni, lucaKayitSayisi, faturaSayisi, kilitli}].',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string', description: 'Mükellef id (list_taxpayers ile bul).' },
        periodLabel: { type: 'string', description: 'Dönem "YYYY/MM" (örn. 2026/08). "2026-08" de kabul edilir, çevrilir.' },
        type: {
          type: 'string',
          enum: ['KDV_191', 'KDV_391', 'ISLETME_GELIR', 'ISLETME_GIDER'],
          description: 'İsteğe bağlı tek oturum türü. Boşsa defter türünden iki oturum.',
        },
      },
      required: ['taxpayerId', 'periodLabel'],
    },
  },
  {
    name: 'kdv_kontrol_luca_cek',
    description:
      'KDV Kontrol oturumu için Luca çekim işini kuyruğa alır (R1 adım 3; tür oturumdan türer: 191/391 → Defteri Kebir, ISLETME_* → gelir/gider listesi). ' +
      'Luca ajanı çevrimiçi değilse iş AÇILMAZ, {ok:false, neden} döner → DUR. Aynı iş zaten kuyruktaysa mevcutIs:true ile o iş döner. ' +
      'Sonucu luca_is_bekle {jobId} ile bekle. Kuru testte çalışmaz.',
    input_schema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'kdv_kontrol_oturum_bul_olustur çıktısındaki sessionId.' },
        targetDeviceId: { type: 'string', description: 'İsteğe bağlı hedef Luca ajan cihazı; boşsa yerel Node işçisi alır.' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'luca_is_bekle',
    description:
      'Bir Luca işini (jobId) SUNUCUDA bekler: 5 sn\'de bir durumuna bakar, en çok maxSaniye (≤60). bitti:true (done/failed/cancelled) olana kadar tekrar çağır; ' +
      'iş başına toplam 10 dk (≤10 çağrı) aşılırsa "Luca sürüyor" notuyla DUR. captcha.challengeId doluysa "Luca güvenlik kodu bekliyor" (sahip); ' +
      'pending + retryCount>0 ise "Luca teknik kilit, otomatik tekrar deneniyor"; failed → errorMsgSonSatir rapora, tekrar YOK.',
    input_schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Luca iş id (kdv_kontrol_luca_cek / fm_luca_gonder çıktısı).' },
        maxSaniye: { type: 'number', description: 'Bu çağrıda en çok kaç saniye beklensin (varsayılan 60, tavan 60).' },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'kdv_kontrol_fatura_bagla',
    description:
      'Portal DB\'deki Mihsap faturalarını (mihsap_invoices; Fatura Merkezi/e-Arşiv DEĞİL) KDV Kontrol oturumuna görsel olarak bağlar (R1 adım 4). ' +
      'Fatura yoksa {ok:false, neden:"HAZIR DEĞİL: faturalar portala inmemiş (Mihsap çekimi Muzaffer Bey’de)"} — Mihsap çekimini ajan başlatmaz. Tekrar çağrılabilir (alreadyLinked). Kuru testte çalışmaz.',
    input_schema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
    },
  },
  {
    name: 'kdv_kontrol_ocr_baslat',
    description:
      'Oturuma bağlı faturaların OCR okumasını başlatır (R1 adım 5; Luca çekimini beklemeden, paralel). Hemen döner {queued, total, cacheHits}; işçiler arkada çalışır, ' +
      'bitişi kdv_kontrol_ocr_bekle ile izle. forceFresh YOK (Max kotası). Kuru testte çalışmaz.',
    input_schema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
    },
  },
  {
    name: 'kdv_kontrol_ocr_bekle',
    description:
      'Oturumdaki OCR bitişini SUNUCUDA bekler (R1 adım 7): görsellerin ocrStatus sayımını 5 sn\'de bir alır, en çok maxSaniye (≤60); pending+processing=0 olunca bitti:true. ' +
      'Toplam 15 dk (≤15 çağrı) aşılırsa "OCR sürüyor" notuyla DUR. Çıktı: {pending, processing, success, needsReview, lowConfidence, failed, toplam, bitti, needsOcrConfirm}.',
    input_schema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        maxSaniye: { type: 'number', description: 'Varsayılan 60, tavan 60.' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'kdv_kontrol_eslestir',
    description:
      'Luca kayıtları ↔ fatura görsellerini eşleştirir (R1 adım 8). Ön koşul kapısı araç içinde: Luca kaydı>0, görsel>0, OCR pending/processing=0; sağlanmıyorsa {ok:false, neden} döner, servis ÇAĞRILMAZ. ' +
      'Sorunsuz biterse modül oturumu portaldaki gibi KİLİTLER (otoKilit:true — Muzaffer Bey’in kararı: ayrıca sorulmaz; Word raporu oluşur, yazdırma Muzaffer Bey’de). Kuru testte çalışmaz.',
    input_schema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
    },
  },
  {
    name: 'kdv_kontrol_sonuc_satirlari',
    description:
      'Eşleştirme sonrası sonuç satırlarını sınıflandırıp listeler (R1 adım 9): tam · incele · fatura yok (Luca\'da var) · Luca\'da yok (fatura var) · red. ' +
      'Karar VERME (resolve yok); sorunlu satırları belge no + tarih + KDV + sebep ile rapora yaz. results boşsa eşleştirme çalışmamıştır.',
    input_schema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        yalnizSorunlu: { type: 'boolean', description: 'true (varsayılan): tam eşleşenler listelenmez, yalnız sayılır.' },
        limit: { type: 'number', description: 'En çok satır (varsayılan 100, tavan 100).' },
      },
      required: ['sessionId'],
    },
  },
  // ─── FATURA ÇEKİMİ ZİNCİRİ (R5, 2026-09-15) — Fatura İşleme Merkezi'ndeki "Sorgula / Aktar" düğmelerinin ekip karşılığı.
  //   Muzaffer Bey: "faturaları çek ve işle → Fatura İşleme Merkezi; e-Fatura mükellefi ise e-Fatura sorgulama, değilse GİB e-Arşiv
  //   sorgulama". Yol seçimi araç içinde (Taxpayer.isEFaturaMukellefi / eFaturaEntegrator); ajan yol seçmez, onay kodu (PRV) yok.
  //   Kademe (arac-defteri.ts): baslat/aktar = luca_yaz (kuru testte "yapılacaktı"); durum/bekle = oku.
  {
    name: 'fm_cekim_baslat',
    description:
      'Fatura çekimi zincirinin (R5) 2. adımı: mükellef + dönem için sorguyu portaldaki düğmeyle AYNI yoldan başlatır. Yolu araç seçer: mükellef e-Fatura mükellefiyse ' +
      'e-Fatura Sorgu (mükellefin entegratörü; alış = IN_EFATURA, satış = OUT_EFATURA + OUT_EARSIV), değilse GİB e-Arşiv Sorgu (yalnız SATIŞ; Luca ajanına EARSIV_PORTAL_FETCH işi kuyruklanır). ' +
      'Entegratör tanımsızsa {ok:false, neden:"HAZIR DEĞİL: …"} döner → DUR, Muzaffer Bey’e söyle. Aynı sorgu zaten sürüyorsa mevcutIs:true ile onu döner. ' +
      'Çıktı: {ok, yol:"efatura"|"earsiv", mukellef, donem, saglayicilar, arkaPlan, isler[], kanallar[], mesaj}. Sonucu fm_cekim_bekle ile izle. Kuru testte çalışmaz (yapılacaktı).',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string', description: 'Mükellef id (list_taxpayers ile bul).' },
        donem: { type: 'string', description: 'Dönem "YYYY-MM" (örn. 2026-08). "2026/08" de kabul edilir.' },
        yon: { type: 'string', enum: ['alis', 'satis', 'ikisi'], description: 'Varsayılan ikisi. GİB e-Arşiv yolunda yalnız satış sorgulanır (alış GİB portalında yoktur).' },
      },
      required: ['taxpayerId', 'donem'],
    },
  },
  {
    name: 'fm_cekim_durum',
    description:
      'Fatura çekiminin (R5) anlık durumu — hemen döner, beklemez. e-Fatura yolu: kanal başına sorgu durumu (sürüyor/bitti/hata), gelen satır, aktarılan, indirme bekleyen; ' +
      'GİB e-Arşiv yolu: EARSIV_PORTAL_FETCH işleri (pending/running/done/failed, satır sayısı, hata) + sorgulanan e-Arşiv satırları (aktarılabilir/aktarılmış/iptal). ' +
      'Çıktı: {bitti, yol, ozet, ayrinti}. Döngü kurmak için fm_cekim_bekle kullan.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        donem: { type: 'string', description: 'YYYY-MM' },
        yol: { type: 'string', enum: ['efatura', 'earsiv'], description: 'Boşsa mükellef kartından seçilir (fm_cekim_baslat ile aynı kural).' },
        yon: { type: 'string', enum: ['alis', 'satis', 'ikisi'], description: 'e-Fatura yolunda hangi kanallara bakılsın (varsayılan ikisi).' },
      },
      required: ['taxpayerId', 'donem'],
    },
  },
  {
    name: 'fm_cekim_bekle',
    description:
      'Fatura çekiminin bitişini SUNUCUDA bekler (R5 adım 3): 10 sn’de bir fm_cekim_durum bakar, en çok maxSaniye (≤60). bitti:true olana kadar tekrar çağır; ' +
      'toplam 12 dk (≤12 çağrı) aşılırsa "sorgu sürüyor, bitince aktarılacak" notuyla DUR. Çıktı: fm_cekim_durum alanları + {beklenenSaniye, kontrolSayisi, yorum}.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        donem: { type: 'string', description: 'YYYY-MM' },
        yol: { type: 'string', enum: ['efatura', 'earsiv'] },
        yon: { type: 'string', enum: ['alis', 'satis', 'ikisi'] },
        maxSaniye: { type: 'number', description: 'Bu çağrıda en çok kaç saniye beklensin (varsayılan 60, tavan 60).' },
      },
      required: ['taxpayerId', 'donem'],
    },
  },
  {
    name: 'fm_cekim_aktar',
    description:
      'Sorgulanan faturaları Fatura Merkezi’ne aktarır (R5 adım 4) — portaldaki "Aktar" düğmesiyle AYNI: e-Fatura yolu kanal başına efatura-inbox aktarımı (eşleştirme YOK, skipMatching; ' +
      'aktarım bitince okunmamış belgeler kendiliğinden AI okuma kuyruğuna girer); GİB e-Arşiv yolu sorgulanan satırları Fatura Merkezi’ne alır, belge inmemişse indirme işi kuyruklar (indirmeKuyrukta:true → fm_cekim_bekle sonra tekrar aktar). ' +
      'Belgeler hâlâ iniyorsa {ok:false, neden} döner → fm_cekim_bekle. Çok uzun sürerse arkaPlan:true "aktarım sürüyor" döner (fm_cekim_durum ile izle). Çıktı: {ok, aktarilan, kontrolEdilen, zatenVar, atlanan, hatali, mesaj}. Kuru testte çalışmaz.',
    input_schema: {
      type: 'object',
      properties: {
        taxpayerId: { type: 'string' },
        donem: { type: 'string', description: 'YYYY-MM' },
        yon: { type: 'string', enum: ['alis', 'satis', 'ikisi'], description: 'Varsayılan ikisi.' },
      },
      required: ['taxpayerId', 'donem'],
    },
  },
  {
    name: 'ekip_ajan_baslat',
    description:
      'Koordinatör için: görevi başka bir ekip ajanına verir ve koşuyu ARKA PLANDA başlatır (iç içe koşu yok, hemen döner). Aynı ajan + mükellef için çalışan koşu varsa {ok:false, mevcutIsId}. ' +
      'dryRun varsayılan true (kuru test); canlı (dryRun:false) yalnız Muzaffer Bey açıkça "canlı" dediyse ve oturumda kullanıcı varsa. Durumu ekip_is_durum {isId} ile izle.',
    input_schema: {
      type: 'object',
      properties: {
        ajanId: { type: 'string', description: 'Ajan kimliği (beyanname, analist, fatura, denetci, evrak, banka-kasa, musteri, luca-operator ...).' },
        gorev: { type: 'string', description: 'Ajanın göreceği görev cümlesi: reçete + mükellef + dönem (çevrilmiş etiket) + kuru/canlı.' },
        taxpayerId: { type: 'string', description: 'Mükellef id (biliniyorsa; tekrar kilidi buna göre çalışır).' },
        dryRun: { type: 'boolean', description: 'Varsayılan true. false = canlı (Muzaffer Bey’in onayı şart).' },
      },
      required: ['ajanId', 'gorev'],
    },
  },
  {
    name: 'ekip_is_durum',
    description:
      'ekip_ajan_baslat ile açılan bir ekip işinin durumunu okur: {status, rapor (ilk 1500 kr), hata, durationMs}. Takılan iş 2. kontrolde de bitmediyse sahibe tek satır soru.',
    input_schema: {
      type: 'object',
      properties: { isId: { type: 'string', description: 'ekip_ajan_baslat çıktısındaki isId.' } },
      required: ['isId'],
    },
  },
];

/** Ekip iş zinciri araç adları (runner + defter + çalıştırıcı için tek kaynak). */
export const EKIP_IS_ZINCIRI_ARAC_ADLARI: string[] = EKIP_IS_ZINCIRI_ARACLARI.map((t) => t.name);
