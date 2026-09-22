import { OPERATOR_MODELLERI } from '../calisan/luca-operator.service';

/**
 * EKİP — AJAN TANIMLARI (PLAN/13-AJAN-KADROSU.md §3)
 *
 * 11 aktif ajan; id'ler SABİTTİR (iş dosyası, hafıza ve kimlik klasörü bu id'ye bağlıdır).
 * Araçlar arac-defteri.ts'teki adla seçilir; kademe defterden gelir, burada tekrar yazılmaz.
 * Kimlik klasörü: apps/api/kadro/<id>/ (kimlik.md, kurallar.md, beceriler.md) + apps/api/kadro/00_ORTAK_KURALLAR.md
 * — runner dosya yoksa boş geçer.
 *
 * KURAL: her ajanın `araclar` listesi ile kadro/<id>/kimlik.md "Kullandığım araçlar" bölümü BİREBİR aynıdır
 * (arac-defteri.spec.ts kilit testi 13 ajanı da denetler — 2026-09-13). Araç eklerken/çıkarırken iki yeri birlikte güncelle.
 * Reçeteler: kadro/<id>/receteler.md (PLAN/17) — runner prompta "## REÇETELERİN" olarak koyar.
 *
 * TETİKLER: "planlandı" yazanlar için henüz kod (cron/olay) YOK; bugün gerçek tetikler: cron 08:30 sabah özeti
 * (koordinator.service.ts, EKIP_SABAH_OZETI=on), portal (POST /ekip/:ajanId/calistir), ses (Koordinatör).
 * Ajanlar arası zincir (Koordinatör → ajan) da planlandı: bugün görev metnini Koordinatör hazırlar, Muzaffer Bey portaldan başlatır.
 */

export type AjanModeli = 'opus' | 'sonnet' | 'haiku';

export type AjanId =
  | 'koordinator'
  | 'fatura'
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
  /** Muzaffer Bey’in onayı gereken noktalar (metin — kimlik dosyası ve prompt için). */
  onayNoktalari: string[];
  /** Ne zaman çalışır (cron/olay/Muzaffer Bey komutu). */
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
/** Yalnız koordinatör: Muzaffer Bey’in açık sözüyle onay yürütme / reddetme. */
const EKIP_ONAY = ['ekip_onayla', 'ekip_reddet'];
const ONAY = ['preview_agent_command'];
/** Fatura Merkezi ajan araçları (PLAN/15 Faz 5). fm_onayla BİLEREK YOK: onay sahibindir. */
const FM_OKU = ['fm_belge_listele', 'fm_belge_detay', 'fm_donem_ozeti', 'fm_uyumsuzluklar', 'fm_hesap_plani_ara'];
const FM_YAZ = ['fm_hesap_ata', 'fm_ai_ile_oku', 'fm_isaretle'];
const FM_LUCA = ['fm_luca_gonder'];
/**
 * Fatura çekimi zinciri (R5, 2026-09-15) — Fatura İşleme Merkezi "Sorgula / Aktar" düğmelerinin ekip karşılığı; yolu araç seçer
 * (e-Fatura mükellefi → entegratör e-Fatura sorgusu, değilse GİB e-Arşiv). Kademe: baslat/aktar luca_yaz, durum/bekle oku.
 */
const FM_CEKIM = ['fm_cekim_baslat', 'fm_cekim_durum', 'fm_cekim_bekle', 'fm_cekim_aktar'];
/**
 * KDV Kontrol zinciri (PLAN/17 R1, 2026-09-13) — yalnız beyanname. kdv_kontrol_kilitle / kdv_kontrol_kilit_ac
 * BİLEREK YOK: kilit sahibindir (spec kilidi: hiçbir ajan listesinde olamaz).
 */
const KDV_KONTROL_ZINCIRI = [
  'kdv_kontrol_oturum_bul_olustur', 'kdv_kontrol_luca_cek', 'kdv_kontrol_fatura_bagla', 'kdv_kontrol_ocr_baslat',
  'kdv_kontrol_ocr_bekle', 'kdv_kontrol_eslestir', 'kdv_kontrol_sonuc_satirlari',
  // OCR teyit (R1 7b/9b, 2026-09-22): yeniden okuma (Max-vision) + Teyit Et karşılığı; karar/kilit yine sahipte.
  'kdv_kontrol_belge_yeniden_oku', 'kdv_kontrol_ocr_teyit',
];
/** Koordinatör: başka ajanı arka planda başlatır + iş dosyasını izler (PLAN/17 §3 ekip_ajan_baslat / ekip_is_durum). */
const EKIP_ATAMA = ['ekip_ajan_baslat', 'ekip_is_durum'];

export const AJAN_TANIMLARI: AjanTanimi[] = [
  {
    id: 'koordinator',
    ad: 'Koordinatör',
    unvan: 'Ofis Müdürü',
    aciklama:
      'Ofis takvimini bilir (KDV, muhtasar, geçici vergi, SGK, Ba-Bs, e-defter, yıllık). Mükellef × dönem × aşama panosunu tutar, ' +
      'işi dağıtır, takılanı Muzaffer Bey’e getirir, sabah özetini verir. Sesli muhatap budur.',
    model: 'sonnet',
    araclar: [
      'ekip_bilgi_oku',
      ...MUKELLEF_OKU, ...EKIP_OKU,
      ...EKIP_ONAY,
      // PLAN/17 §4 (2026-09-13): mali tablo sorusunda ÖNCE "hazır tablo var mı" bakar (MALI_OKU + mali_donemler_listele);
      // hazırsa Luca/Denetçi ÖNERMEZ. Başka ajanı ekip_ajan_baslat ile arka planda başlatır, ekip_is_durum ile izler.
      ...MALI_OKU, 'get_kdv_summary', 'mali_donemler_listele', ...EKIP_ATAMA,
      'get_operation_briefing', 'get_tax_calendar', 'get_beyanname_readiness_summary', 'get_collection_risk_summary', 'get_beyanname_config',
      'get_gundem', 'list_pending_decisions', 'list_tasks', 'get_agent_status', 'get_system_health', 'get_ai_cost_summary',
      // get_mihsap_agent_jobs ÇIKARILDI (PLAN/15 Faz 5): fatura işi Fatura Merkezi'nden izlenir (get_taxpayer_work_status.veri.faturaMerkezi).
      'list_beyan_kayitlari', 'get_beyan_ozet', 'get_kdv1_on_hazirlik', 'get_luca_agent_jobs', 'get_portal_capability_map',
      'search_ai_memory', 'save_ai_memory', ...ONAY, 'create_pending_action',
      // PLAN/19 H3 (2026-09-14): Koordinatör sorulan şeyi ajan başlatmadan KENDİ okuyabilsin — hepsi 'oku' kademesi
      // (tebligat, vergi borcu, cari/banka, Fatura Merkezi özeti, e-Arşiv, evrak, SGK, işletme özeti, mali yorum,
      // e-defter oturumları, hesap referansı). fm_donem_ozeti / fm_uyumsuzluklar yalnız OKUR; fm yazma araçları hâlâ yalnız fatura ajanında.
      'list_etebligat', 'list_tax_payable', 'get_cari_hareketler', 'get_bank_status', 'list_fatura_merkezi', 'fm_donem_ozeti',
      'fm_uyumsuzluklar', 'list_earsiv_invoices', 'list_documents', 'list_sgk_declarations', 'get_isletme_hesap_ozeti',
      'mali_yorum_oku', 'list_edefter_sessions', 'get_accounting_reference',
    ],
    onayNoktalari: ['Muzaffer Bey’e giden özet dışında dışarıya mesaj', 'Bir ajanı canlı (kuru test dışı) çalıştırma'],
    tetikler: ['cron 08:30 sabah özeti (koordinator.service.ts; EKIP_SABAH_OZETI=on)', 'Muzaffer Bey komutu (portal/ses)', 'olay (çalışan raporu/onay/hata) — planlandı'],
    kimlikKlasoru: klasor('koordinator'),
  },
  // EVRAK SORUMLUSU KALDIRILDI (2026-09-13, Muzaffer Bey): evrak talep/geldi mesajları portaldaki EVRAK OTOMASYONU'nun işi
  //   (mükellef kartı → teslim günü; 10:00 cron hatırlatma; 'geldi' işaretlenince onay mesajı). Ajan taslak hazırlamaz;
  //   eksik evrak sorusunu Koordinatör list_taxpayers_monthly_status ile kendisi cevaplar. e-Tebligat iletimi → Müşteri İlişkileri (R10).
  {
    id: 'fatura',
    ad: 'Fatura Muhasebecisi',
    unvan: 'Fatura İşleme',
    aciklama:
      "Fatura Merkezi'nin personeli: dönem belgelerini açar, okunmamışı okutur, uyumsuzu inceler, gerekçeli hesap önerir (AJAN kaynaklı), " +
      "demirbaş/tevkifat/mükerreri işaretler, Muzaffer Bey’e onay listesi sunar. Onaylamaz; Luca gönderimi ancak Muzaffer Bey 'canlı' derse. Mihsap'a bakmaz.",
    model: 'opus',
    // PLAN/15 Faz 5: Mihsap araçları ÇIKARILDI — list_invoices (MihsapInvoice), fetch_invoices_for_period,
    // extract_invoice_fields, ocr_pdf (boş kabuk), classify_with_claude (dış API), generate_fis_word_from_invoices,
    // post_to_luca (boş kabuk), LUCA_YAZ (fiş fm_luca_gonder kuyruğuyla gider; Luca'ya elle dokunmaz).
    // fm_onayla BİLEREK YOK: onay sahibindir (kadro/fatura/kurallar.md).
    // preview_agent_command ÇIKARILDI (2026-09-15, Muzaffer Bey: "onay kodu istemiyorum; kuru/canlı ayrımı yeter"): e-Arşiv/e-Fatura
    //   çekimi artık PRV önizlemesiyle değil fm_cekim_* zinciriyle (R5) yürür; fatura ajanının başka önizleme işi yoktu.
    araclar: [
      'ekip_bilgi_oku',
      ...MUKELLEF_OKU, ...HAFIZA, ...FM_OKU, ...FM_YAZ, ...FM_LUCA,
      // R5 (2026-09-15): fatura çekimi zinciri — e-Fatura / GİB e-Arşiv sorgusu, bekleme, aktarım.
      ...FM_CEKIM,
      // PLAN/17 R4 adım 5: fm_luca_gonder sonrası INVOICE_POST işini sunucuda bekler (2026-09-13).
      'luca_is_bekle',
      'list_fatura_merkezi', 'list_earsiv_invoices', 'get_kdv_summary', ...LUCA_OKU,
      'create_pending_action',
      // PLAN/19 H3 (2026-09-14): dönem son günü / beyanname takvimi sorusunda kendi baksın (oku).
      'get_tax_calendar',
    ],
    onayNoktalari: ['Belge onayı: ajan ASLA — Muzaffer Bey portaldan onaylar (fm_onayla listede yok)', "Luca'ya gönderim (kuru test → Muzaffer Bey 'canlı' → fm_luca_gonder)", 'Demirbaş / tevkifat şüpheli / mükerrer kararı', 'Fatura çekimi / aktarımı: kuru testte yapılmaz; canlı koşuda Muzaffer Bey’in sözüyle (fm_cekim_baslat / fm_cekim_aktar)'],
    tetikler: ['Muzaffer Bey komutu / Koordinatör görev metni (portal): "faturaları çek ve işle", "e-Fatura / e-Arşiv sorgula", "entegratörden al"', 'evrak yüklendi olayı — planlandı', 'entegratör çekimi bitti olayı — planlandı'],
    kimlikKlasoru: klasor('fatura'),
  },
  {
    id: 'beyanname',
    ad: 'KDV/Beyanname Uzmanı',
    unvan: 'Beyanname Hazırlık',
    aciklama:
      'KDV Kontrol zincirini portalda kendi yürütür (oturum, Luca çekimi, fatura bağlama, OCR, eşleştirme; sorunsuzsa oturum portaldaki gibi kendiliğinden kilitlenir) → hata yoksa ' +
      'Luca tahakkuk fişi → beyanname hazır → Muzaffer Bey’e sunar. Muhtasar, geçici vergi, yıllık, Ba-Bs aynı kalıpla. GİB gönderimi ASLA yapmaz.',
    model: 'opus',
    araclar: [
      'ekip_bilgi_oku',
      ...MUKELLEF_OKU, ...HAFIZA, ...MALI_OKU, 'get_kdv_summary', 'get_kdv1_on_hazirlik', 'list_tax_payable', 'list_beyan_kayitlari', 'get_beyan_ozet',
      'get_beyanname_config', 'get_beyanname_readiness_summary', 'get_tax_calendar', 'fetch_kdv_from_luca', 'get_isletme_hesap_ozeti',
      // PLAN/17 R1 (2026-09-13): KDV Kontrol zinciri PORTAL işidir ve bu ajanındır — oturum aç → Luca çek + fatura bağla + OCR
      // (paralel) → bekle → eşleştir → satırları oku. get_agent_status: Luca ajanı çevrimiçi mi (adım 3). Kilit araçları YOK.
      ...KDV_KONTROL_ZINCIRI, 'luca_is_bekle', 'get_agent_status',
      // Muhtasar zinciri (beceriler §3): ücret stopajı + APHB; mevzuat teyidi.
      'get_payroll_summary', 'list_sgk_declarations', 'research_official_sources',
      ...LUCA_OKU, ...LUCA_YAZ, 'luca_kural_kaydet', 'set_monthly_status', 'create_pending_action', ...ONAY,
    ],
    onayNoktalari: ["Luca'da tahakkuk fişi (kuru test → onay)", 'Beyanname "hazır" işareti', 'GİB gönderimi: ajan ASLA — yalnız Muzaffer Bey'],
    tetikler: ['Muzaffer Bey komutu / Koordinatör görev metni (portal)', 'KDV Kontrol bitti olayı — planlandı', 'beyanname takvimi (son gün −5) — planlandı'],
    kimlikKlasoru: klasor('beyanname'),
  },
  {
    id: 'bordro-sgk',
    ad: 'Bordro/SGK Sorumlusu',
    unvan: 'Bordro ve SGK',
    aciklama: 'İşe giriş/çıkış, bordro, SGK hizmet/tahakkuk, e-bildirge kontrolü. Bildirge gönderimi yapmaz.',
    model: 'sonnet',
    araclar: [
      'ekip_bilgi_oku',
      ...MUKELLEF_OKU, 'get_payroll_summary', 'list_sgk_declarations', 'list_etebligat', 'get_tax_calendar', 'list_documents',
      // kurallar.md: yıllık değişen rakamlar (asgari ücret, tavan, dilim) ezberden değil referanstan.
      'get_accounting_reference', 'research_official_sources',
      'search_ai_memory', 'save_ai_memory', ...LUCA_OKU, ...LUCA_YAZ, 'create_pending_action', ...ONAY,
    ],
    onayNoktalari: ['Bordro hesabı sonucu', 'SGK bildirge gönderimi: ajan ASLA — yalnız Muzaffer Bey'],
    tetikler: ['Muzaffer Bey komutu / Koordinatör görev metni (portal)', 'ayın 1 bordro / 20 APHB taraması — planlandı', 'işe giriş/çıkış belgesi olayı — planlandı'],
    kimlikKlasoru: klasor('bordro-sgk'),
  },
  {
    id: 'edefter',
    ad: 'e-Defter/Yıl Sonu Sorumlusu',
    unvan: 'e-Defter ve Kapanış',
    aciklama: 'e-Defter kontrol kuralları (kasa/stok/banka negatif, mizan↔fiş), berat takvimi, yıl sonu kapanış hazırlığı.',
    model: 'opus',
    araclar: [
      'ekip_bilgi_oku',
      ...MUKELLEF_OKU, ...HAFIZA, ...MALI_OKU, 'list_edefter_sessions', 'get_beyanname_config', 'get_tax_calendar', 'get_luca_agent_jobs',
      // kurallar.md: enflasyon düzeltmesi / berat süresi gibi yıla bağlı yükümlülük ezberden değil resmi kaynaktan (TEYİT ET).
      'research_official_sources',
      ...LUCA_OKU, ...LUCA_YAZ, 'create_pending_action', ...ONAY,
    ],
    onayNoktalari: ['Düzeltme fişi önerisi', 'Berat yükleme: ajan ASLA — yalnız Muzaffer Bey'],
    tetikler: ['Muzaffer Bey komutu / Koordinatör görev metni (portal)', 'berat takvimi (son gün −10) — planlandı', 'geçici vergi öncesi / yıl sonu — planlandı'],
    kimlikKlasoru: klasor('edefter'),
  },
  {
    id: 'luca-operator',
    ad: 'Luca Operatörü',
    unvan: "Ekibin Luca'daki Eli",
    aciklama: "Diğer ajanların Luca'daki eli: ekran okur, alan doldurur, menü açar, beceri öğrenir. VPS'te 7/24 (Faz B).",
    model: 'sonnet',
    araclar: [
      'ekip_bilgi_oku',
      ...LUCA_OKU, ...LUCA_YAZ, 'luca_menu_haritasi_cikar', 'luca_kural_kaydet', 'luca_kural_sil', 'luca_mizan_cek',
      // Portal yalnız OKUMA (kurallar.md KURAL 2: portala yazma yok). Mizan gerekiyorsa portaldakini oku, çekim tarihini söyle.
      'list_taxpayers', 'get_taxpayer', 'get_mizan', 'list_mizan_periods', 'get_accounting_reference',
      'get_luca_agent_jobs', 'get_agent_status', 'search_ai_memory',
      // PLAN/19 H3 (2026-09-14): beyanname/dönem takvimi (yalnız okuma; portal yazma kuralı değişmedi).
      'get_tax_calendar',
      // PLAN/17 §4 (2026-09-13): tek portal yazma istisnası — DEVİR CEVABI / "Kime döndü" kaydı (portal işi gelirse
      // Beyanname/Analist/Fatura'ya geri verir). Başka portal yazma yine YOK.
      'create_pending_action',
    ],
    onayNoktalari: ['Kaydet / Gönder / Tahakkuk / İmzala / Sil düğmeleri (confirmed=true yalnız Muzaffer Bey’in onayıyla)'],
    tetikler: ['Muzaffer Bey komutu (portal / Luca Operatörü sohbeti)', 'diğer ajanların iş paketi (Koordinatör üzerinden) — planlandı'],
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
      'ekip_bilgi_oku',
      ...MUKELLEF_OKU, ...HAFIZA, ...MALI_OKU, 'get_kdv_summary', 'get_kdv1_on_hazirlik', 'list_edefter_sessions', 'list_beyan_kayitlari', 'get_beyan_ozet',
      'get_luca_agent_jobs',
      // PLAN/17 R6 (2026-09-13): PRV ile açılan mizan çekim işini sunucuda bekler.
      'luca_is_bekle',
      // Yalnız Luca OKUR (luca_yaz/luca_sec/luca_tikla YOK): fiş listesi/mizan çekimi Luca Operatörü'ne paketle istenir.
      ...LUCA_OKU, 'create_pending_action', ...ONAY,
      // PLAN/19 H3 (2026-09-14): geçici vergi / dönem son günü takvimi (oku).
      'get_tax_calendar',
    ],
    onayNoktalari: ['Muzaffer Bey’e uyarı raporu (portal içi — serbest)', 'Mükellefe iletim: onaylı'],
    tetikler: ['Muzaffer Bey komutu / Koordinatör görev metni (portal)', 'geçici vergi öncesi (dönem son günü −10) — planlandı', 'yıl sonu (Ocak) — planlandı'],
    kimlikKlasoru: klasor('denetci'),
  },
  {
    id: 'analist',
    ad: 'Mali Analist',
    unvan: 'Dönemlik Yorum',
    aciklama:
      'Her mükellef için dönemlik yorum: ciro/kâr eğilimi, vergi yükü tahmini, nakit akışı, sektör karşılaştırması, geçici vergi öngörüsü. ' +
      'Rapor "öneri" etiketiyle; Muzaffer Bey’in onayı olmadan mükellefe gitmez.',
    model: 'opus',
    araclar: [
      'ekip_bilgi_oku',
      ...MUKELLEF_OKU, ...HAFIZA, ...MALI_OKU, 'get_kdv_summary', 'list_tax_payable', 'get_cari_hareketler', 'get_bank_status',
      'get_isletme_hesap_ozeti', 'research_official_sources', 'summarize_with_claude',
      // PLAN/17 R2 (2026-09-13): hazır (kilitli) dönemleri listeler, Muzaffer Bey’in kayıtlı Mali Yorum'unu okur; Luca çekimi İSTEMEZ.
      'mali_donemler_listele', 'mali_yorum_oku',
      // kimlik.md: get_gundem (TÜFE/kur → gerçek büyüme düzeltmesi) + vergi takvimi (ödeme vadesi). Pilot 3: kapalı olduğu için enflasyon düzeltmesi yapılamadı.
      'get_gundem', 'get_tax_calendar',
      // Gönderim/komut araçları YOK: kimlik.md "Mükellefle doğrudan konuşmam; onaylı özeti Müşteri İlişkileri iletir".
      // Mükellef özeti ONAY BEKLEYEN maddesi create_pending_action ile kaydedilir.
      'create_pending_action',
    ],
    onayNoktalari: ['Raporun mükellefe gönderimi (Müşteri İlişkileri üzerinden, Muzaffer Bey’in onayıyla)'],
    tetikler: ['Muzaffer Bey komutu / Koordinatör görev metni (portal)', 'dönem kapanışı / geçici vergi sonrası — planlandı'],
    kimlikKlasoru: klasor('analist'),
  },
  {
    id: 'mevzuat',
    ad: 'Mevzuat Takipçisi',
    unvan: 'Mevzuat İzleme',
    aciklama: 'Resmî Gazete / GİB duyurusu → özet → hangi mükellefi ilgilendirir. Muzaffer Bey’e özet.',
    model: 'sonnet',
    araclar: [
      'ekip_bilgi_oku',
      'list_taxpayers', 'get_taxpayer', 'search_all', 'get_beyanname_config',
      'get_gundem', 'check_official_gazette', 'research_official_sources', 'http_get', 'summarize_with_claude',
      'get_accounting_reference', 'get_tax_calendar',
      'search_ai_memory', 'save_ai_memory', 'create_pending_action',
    ],
    onayNoktalari: ['Mükellefe mevzuat bildirimi'],
    tetikler: ['Muzaffer Bey komutu / Koordinatör görev metni (portal)', 'her sabah 07:30 Resmî Gazete taraması — planlandı'],
    kimlikKlasoru: klasor('mevzuat'),
  },
  {
    id: 'risk',
    ad: 'Risk Gözcüsü',
    unvan: 'İnceleme Riski',
    aciklama: 'Vergi incelemesi riski: KDV yüklenim oranı, sürekli devreden, kasa şişkinliği, ortaklar cari, nakit satış oranı. Mükellef bazlı risk puanı.',
    model: 'sonnet',
    araclar: [
      'ekip_bilgi_oku',
      ...MUKELLEF_OKU, ...HAFIZA, ...MALI_OKU, 'get_kdv_summary', 'list_beyan_kayitlari', 'get_beyan_ozet', 'get_cari_hareketler',
      'list_earsiv_invoices', // nakit satış oranı: SATIS e-arşiv + cari ödeme yöntemi dağılımı
      'get_collection_risk_summary', 'create_pending_action',
      // PLAN/19 H3 (2026-09-14): beyan/ödeme takvimi (oku).
      'get_tax_calendar',
    ],
    onayNoktalari: ['Risk puanının mükellefe iletimi'],
    tetikler: ['Muzaffer Bey komutu / Koordinatör görev metni (portal)', 'aylık (KDV beyanı sonrası) / çeyreklik tam kart — planlandı'],
    kimlikKlasoru: klasor('risk'),
  },
  {
    id: 'musteri',
    ad: 'Müşteri İlişkileri',
    unvan: 'Mükellef İletişimi',
    aciklama: 'Mükellef soru-cevap, hatırlatma, tahsilat (mevcut WhatsApp botu genişler). Toplu mesaj onaylı.',
    model: 'sonnet',
    araclar: [
      'ekip_bilgi_oku',
      ...MUKELLEF_OKU, 'get_my_profile', 'get_my_work_status', 'get_my_documents', 'get_my_open_tasks', 'get_my_recent_messages',
      'get_my_kdv', 'get_my_invoices', 'get_my_beyanname', 'get_my_balance', 'get_my_tebligat', 'get_my_sgk', 'get_my_isletme_hesap_ozeti', 'get_my_vergi_takvimi',
      'list_etebligat', 'get_collection_risk_summary', 'get_cari_hareketler', 'list_documents', 'list_tasks', 'get_tax_calendar',
      'search_ai_memory', 'save_ai_memory',
      'send_whatsapp_template', 'send_whatsapp_freeform', 'send_sms', 'send_email', 'create_pending_action', ...ONAY,
    ],
    onayNoktalari: ['Toplu mesaj', 'Mükellefe tek mesaj (kuru testte gitmez)'],
    tetikler: ['Muzaffer Bey komutu / Koordinatör görev metni (portal)', 'gelen WhatsApp mesajı (bugün mevcut WhatsApp botu cevaplar; ekibe bağlanması planlandı)', 'takvim hatırlatması — planlandı'],
    kimlikKlasoru: klasor('musteri'),
  },
];

const AJAN_HARITASI: Map<string, AjanTanimi> = new Map(AJAN_TANIMLARI.map((a) => [a.id, a]));

export function ajanBul(id: string): AjanTanimi | null {
  return AJAN_HARITASI.get(String(id || '').trim()) || null;
}

export const ORTAK_KURALLAR_DOSYASI = `${KADRO_KOKU}/00_ORTAK_KURALLAR.md`;
