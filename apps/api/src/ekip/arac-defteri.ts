import { MOREN_AI_TOOLS, FATURA_MERKEZI_AJAN_ARACLARI, EKIP_IS_ZINCIRI_ARACLARI } from '../moren-ai/tools';
import { MIHSAP_FATURA_ACTIONS } from '../agent-events/agent-registry';
import { AUTOMATION_ACTION_CATALOG } from '../automations/action-catalog';
import { LUCA_OPERATOR_ARACLARI } from '../calisan/luca-operator.service';

/**
 * EKİP — ARAÇ KAYIT DEFTERİ (PLAN/13-AJAN-KADROSU.md §5.3)
 *
 * Tüm araçlar TEK listede: portal araçları (MOREN_AI_TOOLS) + Fatura Merkezi ajan araçları (fm_*)
 * + Luca operatör araçları + otomasyon eylem kataloğu + ekibin kendi iç araçları.
 * Her araç bir YETKİ KADEMESİ taşır (§4). Kademe koda gömülüdür; env/anahtarla
 * açılmaz. Ajan tanımları (ajan-tanimlari.ts) araçları buradaki adla seçer.
 *
 * Kademeler:
 *  - oku             : yalnız veri okur → serbest
 *  - portal_yaz      : portalda kayıt yazar (dönem durumu, not, hafıza) → serbest, kayıt altında
 *  - portal_yaz_agir : portala yazar VE yan etkisi var (Max kotası harcar, otomasyon olayı yayar, oturum durumu
 *                      değiştirir: KDV Kontrol oturumu aç / fatura bağla / OCR / eşleştir) → kuru testte ÇALIŞMAZ
 *                      (PLAN/17 §1.2, 2026-09-13: kuru test pilotunda gerçek oturum açıp oto-kilit tetikleyebiliyordu)
 *  - luca_yaz        : Luca'da alan doldurur/tıklar ya da Luca işi açar → kuru test varsayılan; canlı için Muzaffer Bey’in onayı
 *  - disari_gonder   : WhatsApp/SMS/e-posta → canlıda bile doğrudan gitmez, OwnerApprovalRequest
 *  - resmi_gonderim  : GİB beyanname, SGK bildirge, e-defter berat → HİÇBİR ajan çağıramaz
 */

export type Kademe = 'oku' | 'portal_yaz' | 'portal_yaz_agir' | 'luca_yaz' | 'disari_gonder' | 'resmi_gonderim';

export type AracKaynagi = 'portal' | 'luca' | 'eylem' | 'ekip' | 'resmi';

export interface AracKaydi {
  ad: string;
  kaynak: AracKaynagi;
  kademe: Kademe;
  aciklama: string;
  /** Parametre adları (zorunlu olanlar '*' ile) — sistem promptu kataloğu için. */
  parametreler?: string[];
}

/** aracAcikMi için ajan tanımının gereken kısmı (ajan-tanimlari.ts'e bağımlılık yok). */
export interface AracSahibiAjan {
  id: string;
  araclar: string[];
}

export const KADEME_SIRASI: Kademe[] = ['oku', 'portal_yaz', 'portal_yaz_agir', 'luca_yaz', 'disari_gonder', 'resmi_gonderim'];

export const KADEME_ACIKLAMALARI: Record<Kademe, string> = {
  oku: 'Yalnız okur — serbest.',
  portal_yaz: 'Portalda kayıt yazar — serbest, iş dosyasına yazılır.',
  portal_yaz_agir: 'Portala yazar ve yan etkisi var (Max kotası, otomasyon olayı, oturum durumu) — kuru testte ÇALIŞMAZ, "yapılacaktı" yazılır.',
  luca_yaz: "Luca'da yazar/tıklar — kuru testte ÇALIŞMAZ, canlıda Kaydet/Gönder kilidi sürer.",
  disari_gonder: 'Mükellefe/dışarıya mesaj — doğrudan gitmez, Muzaffer Bey’in onayı kaydı açılır.',
  resmi_gonderim: 'GİB/SGK/e-defter resmi gönderim — ajan ASLA çağıramaz, yalnız Muzaffer Bey.',
};

// ─── PORTAL ARAÇLARI: adı YAZAN olanlar, gerisi oku ───
// (get_kdv1_on_hazirlik → oku: KDV Kontrol verisinden beyanname paketi okur, hiçbir şey yazmaz.)
const PORTAL_YAZAN_ARACLAR = new Set<string>([
  'save_ai_memory',
  'create_agent_command',
  'create_confirmed_agent_command',
  // Önizleme yazmaz ama OwnerApprovalRequest kaydı açar → kayıt altında yazma sayılır.
  'preview_agent_command',
]);

/**
 * PLAN/17 §3 — KDV Kontrol zinciri + mali okuma araçları: kademe eşlemesi ADA GÖRE sabittir (tools.ts şemasından
 * bağımsız). Bu araçlar MOREN_AI_TOOLS'a girdiğinde şema oradan, kademe buradan gelir; henüz girmediyse defterde
 * aşağıdaki açıklama/parametrelerle "bekleyen" kayıt olarak yer alır (runner çağırınca "Çalıştırıcı bulunamadı" der;
 * kademe kontrolü yine işler). PORTAL_YAZAN_ARACLAR'a yazılmayan aracın 'oku' sayılması (kuru testte gerçek iş açması)
 * bu tablo ile önlenir — 2026-09-13.
 */
interface BekleyenPortalAraci {
  kademe: Kademe;
  aciklama: string;
  parametreler: string[];
}
const PORTAL_KADEMELERI: Record<string, BekleyenPortalAraci> = {
  kdv_kontrol_oturum_bul_olustur: {
    kademe: 'portal_yaz_agir',
    aciklama: 'KDV Kontrol oturumunu bulur ya da açar (defter türüne göre 2 oturum: KDV_191+KDV_391 / ISLETME_GIDER+ISLETME_GELIR); COMPLETED oturumda devam etmez',
    parametreler: ['taxpayerId*', 'periodLabel*', 'type'],
  },
  kdv_kontrol_luca_cek: {
    kademe: 'luca_yaz',
    aciklama: 'Oturum için Luca çekim işini kuyruğa alır (Luca ajanı tarayıcı sürer); aynı iş varsa mevcutIs:true döner [jobId döner]',
    parametreler: ['sessionId*', 'targetDeviceId'],
  },
  luca_is_bekle: {
    kademe: 'oku',
    aciklama: 'Luca işini sunucuda en çok 60 sn bekler; status/recordCount/hata/retry/captcha döner (10 dk tavan için ≤10 çağrı)',
    parametreler: ['jobId*', 'maxSaniye'],
  },
  kdv_kontrol_fatura_bagla: {
    kademe: 'portal_yaz_agir',
    aciklama: "Portal DB'deki Mihsap faturalarını KDV Kontrol oturumuna bağlar (linked/alreadyLinked)",
    parametreler: ['sessionId*'],
  },
  kdv_kontrol_ocr_baslat: {
    kademe: 'portal_yaz_agir',
    aciklama: 'Oturumdaki fatura görselleri için OCR kuyruğunu başlatır (Max kotası; forceFresh YOK); {queued,total,cacheHits}',
    parametreler: ['sessionId*'],
  },
  kdv_kontrol_ocr_bekle: {
    kademe: 'oku',
    aciklama: 'OCR bitişini sunucuda en çok 60 sn bekler; pending/processing/success/needsReview/failed sayar, bitti:true dönene kadar tekrar çağır (15 dk tavan)',
    parametreler: ['sessionId*', 'maxSaniye'],
  },
  kdv_kontrol_eslestir: {
    kademe: 'portal_yaz_agir',
    aciklama: 'Ön koşul kapısı (Luca kaydı>0, görsel>0, OCR bitti) sonra eşleştirme; oturum COMPLETED olduysa otoKilit:true bildirir (Muzaffer Bey’in kararı: ajanın işi kendi işi gibi — kilit ve bağlı otomasyonlar portaldaki düzende çalışır)',
    parametreler: ['sessionId*'],
  },
  kdv_kontrol_sonuc_satirlari: {
    kademe: 'oku',
    aciklama: 'Eşleştirme sonuç satırlarını (belge no, tarih, KDV, sebep) ve matchSummary sayaçlarını okur; karar vermez',
    parametreler: ['sessionId*', 'yalnizSorunlu', 'limit'],
  },
  mali_yorum_oku: {
    kademe: 'oku',
    aciklama: "Muzaffer Bey’in kayıtlı Mali Yorum'unu okur (GELIR_TABLOSU/BILANCO/MIZAN/IHO); yoksa null",
    parametreler: ['kaynak*', 'kaynakId*'],
  },
  mali_donemler_listele: {
    kademe: 'oku',
    aciklama: 'Mükellefin hazır gelir tablosu / bilanço / mizan dönemlerini tek listede verir (kilitli mi, kaynak, id)',
    parametreler: ['taxpayerId*'],
  },
  // SAHİP VEKİLİ araçları: tools.ts'e girerse bile kuru testte kapalı; hiçbir ajan listesinde YOK (spec kilidi).
  kdv_kontrol_kilitle: { kademe: 'portal_yaz_agir', aciklama: 'KDV Kontrol oturumunu kilitler — yalnız Muzaffer Bey’in sözüyle', parametreler: ['sessionId*'] },
  kdv_kontrol_kilit_ac: { kademe: 'portal_yaz_agir', aciklama: 'KDV Kontrol oturum kilidini açar — yalnız Muzaffer Bey’in sözüyle', parametreler: ['sessionId*'] },
};
/** Bekleyen kayıt olarak defterde görünecek olanlar (kilit vekilleri hariç — onlar yalnız kademe eşlemesi). */
const BEKLEYEN_PORTAL_ARACLARI = Object.keys(PORTAL_KADEMELERI).filter((ad) => !/^kdv_kontrol_kilit/.test(ad));

// ─── FATURA MERKEZİ AJAN ARAÇLARI (fm_*): kademe eşlemesi (PLAN/15 Faz 5) ───
// MOREN_AI_TOOLS'ta DEĞİL (genel bot görmez); defterde kaynak='portal' olarak yer alır.
// fm_onayla: kademe portal_yaz ama fatura ajanının ve koordinatörün listesinde YOK — onay sahibindir.
const FM_KADEMELERI: Record<string, Kademe> = {
  fm_belge_listele: 'oku',
  fm_belge_detay: 'oku',
  fm_donem_ozeti: 'oku',
  fm_uyumsuzluklar: 'oku',
  fm_hesap_plani_ara: 'oku',
  fm_hesap_ata: 'portal_yaz',
  fm_ai_ile_oku: 'portal_yaz',
  fm_isaretle: 'portal_yaz',
  fm_onayla: 'portal_yaz',
  fm_luca_gonder: 'luca_yaz',
};

// ─── MİHSAP AJAN KOMUTLARI: EKİP'e KAPALI (PLAN/15 Faz 5) ───
// preview_agent_command / create_confirmed_agent_command / create_agent_command ile "mihsap*" ajanına
// ya da isle_alis/isle_satis türevi eyleme komut açmak ekip ajanlarına yasak. Genel WhatsApp/portal botu
// etkilenmez (kontrol yalnız ekip runner'ında çağrılır).
const AJAN_KOMUT_ARACLARI = new Set<string>(['preview_agent_command', 'create_confirmed_agent_command', 'create_agent_command']);
const MIHSAP_EYLEMLERI = new Set<string>(MIHSAP_FATURA_ACTIONS as readonly string[]);

/** Ekip ajanı bu araç çağrısıyla Mihsap'a komut açıyor mu? Evetse ret mesajı, değilse null. */
export function ekipMihsapKomutuYasagi(aracAdi: string, args: any): string | null {
  if (!AJAN_KOMUT_ARACLARI.has(String(aracAdi || ''))) return null;
  const agent = String(args?.agent || '').trim().toLowerCase();
  const action = String(args?.action || '').trim().toLowerCase();
  if (agent.startsWith('mihsap') || MIHSAP_EYLEMLERI.has(action)) {
    return `${aracAdi}: Mihsap ajan komutu (${agent || '-'} / ${action || '-'}) ekibe KAPALI — fatura işi Fatura Merkezi'nden yürür (fm_* araçları).`;
  }
  return null;
}

// ─── LUCA OPERATÖR ARAÇLARI: kademe eşlemesi ───
const LUCA_KADEMELERI: Record<string, Kademe> = {
  luca_ekran_oku: 'oku',
  luca_rapor_oku: 'oku',
  luca_mizan_cek: 'oku', // zaten kapalı yol; okuma niyetli
  luca_kural_listele: 'oku',
  luca_menu_ara: 'oku',
  luca_menu_haritasi_cikar: 'oku', // yalnız "üzerine gel", tıklamaz
  luca_menu_git: 'oku', // ekran açar, veri değiştirmez
  luca_beceri_listele: 'oku',
  luca_beceri_getir: 'oku',
  luca_kural_kaydet: 'portal_yaz',
  luca_kural_sil: 'portal_yaz',
  luca_beceri_kaydet: 'portal_yaz',
  luca_yaz: 'luca_yaz',
  luca_sec: 'luca_yaz',
  luca_tikla: 'luca_yaz',
};

const LUCA_ACIKLAMALARI: Record<string, string> = {
  luca_ekran_oku: "Luca'da o an açık ekranı okur (alanlar, butonlar, pencereler)",
  luca_yaz: "Luca'da bir alanı doldurur [param: etiket*, deger*]",
  luca_sec: "Luca'da açılır listeden seçer [param: etiket*, deger*]",
  luca_tikla: "Luca'da buton/menüye tıklar; geri dönülmez butonlar onaysız bloke [param: hedef*, confirmed]",
  luca_rapor_oku: 'Son inen Luca raporunu (mizan vb.) zamanlamadan bağımsız getirir',
  luca_mizan_cek: 'KAPALI yol — mizanı Luca ekranından oku',
  luca_kural_kaydet: 'Ofis kuralını kalıcı kaydeder [param: baslik*, kural*, onem]',
  luca_kural_sil: 'Ofis kuralını kaldırır [param: baslik*]',
  luca_kural_listele: 'Kayıtlı ofis kurallarını listeler',
  luca_menu_haritasi_cikar: 'Luca menüsünü gezip haritasını çıkarır (salt okuma) [param: derinlik]',
  luca_menu_ara: 'Menü haritasında ekran arar [param: sorgu*]',
  luca_menu_git: 'Menü yolundan ekranı açar [param: yol*]',
  luca_beceri_kaydet: 'Bitmiş bir Luca işini beceri olarak kaydeder [param: ad*, adimlar*, aciklama]',
  luca_beceri_listele: 'Kayıtlı becerileri listeler',
  luca_beceri_getir: 'Bir becerinin adımlarını getirir [param: ad*]',
};

// ─── EYLEM KATALOĞU (automations/action-catalog.ts): kademe eşlemesi ───
const EYLEM_KADEMELERI: Record<string, Kademe> = {
  send_whatsapp_template: 'disari_gonder',
  send_whatsapp_freeform: 'disari_gonder',
  send_email: 'disari_gonder',
  send_sms: 'disari_gonder',
  create_pending_action: 'portal_yaz',
  set_monthly_status: 'portal_yaz',
  generate_fis_word_from_invoices: 'portal_yaz',
  print_word_output: 'portal_yaz',
  fetch_invoices_for_period: 'portal_yaz',
  backup_to_drive: 'portal_yaz',
  post_to_luca: 'luca_yaz',
  // Luca'da iş açar (yerel ajan tarayıcıyı sürer): kuru testte ÇALIŞMAMALI — pilot koşuda
  // "oku" sayılıp gerçek Luca işi açmıştı. Canlıda serbest (veri değiştirmez, yalnız çeker).
  fetch_kdv_from_luca: 'luca_yaz',
  ocr_pdf: 'oku',
  extract_invoice_fields: 'oku',
  summarize_with_claude: 'oku',
  classify_with_claude: 'oku',
  check_official_gazette: 'oku',
  http_get: 'oku',
  format_list: 'oku',
};

// Katalog açıklamasına eklenen uyarılar (sistem promptu kataloğunda görünür).
const EYLEM_ACIKLAMA_EKLERI: Record<string, string> = {
  fetch_kdv_from_luca: " — Luca job açar (ajan makinesinde tarayıcı); kuru testte çağrılmaz, beyan rakamı için get_kdv1_on_hazirlik kullan",
};

// ─── EKİBİN İÇ ARAÇLARI (runner kendisi çalıştırır) ───
const EKIP_ARACLARI: AracKaydi[] = [
  {
    ad: 'ekip_isler',
    kaynak: 'ekip',
    kademe: 'oku',
    aciklama: 'Ekibin son iş dosyalarını listeler (kim, ne istendi, durum, kuru test/onay bekleyen)',
    parametreler: ['ajanId', 'limit'],
  },
  {
    ad: 'ekip_pano',
    kaynak: 'ekip',
    kademe: 'oku',
    aciklama: 'Mükellef × dönem × aşama panosu (son 3 dönem: evrak/yükleme/işleme/kontrol/beyanname)',
    parametreler: ['donemSayisi'],
  },
  {
    ad: 'ekip_onaylar',
    kaynak: 'ekip',
    kademe: 'oku',
    aciklama: 'Muzaffer Bey’in onayı bekleyen dışarı-gönderim kayıtları (PRV-XXXX, hangi ajan, hangi araç, hedef, mesaj)',
    parametreler: ['durum', 'limit'],
  },
  {
    ad: 'ekip_onayla',
    kaynak: 'ekip',
    kademe: 'portal_yaz',
    aciklama: 'Muzaffer Bey "ONAYLIYORUM #PRV-XXXX" dediğinde o onayı yürütür (mesaj GERÇEKTEN gider). Yalnız Muzaffer Bey’in açık sözüyle; kendin karar verme',
    parametreler: ['previewId', 'onayMetni'],
  },
  {
    ad: 'ekip_reddet',
    kaynak: 'ekip',
    kademe: 'portal_yaz',
    aciklama: 'Muzaffer Bey bir onayı reddettiğinde kaydı kapatır',
    parametreler: ['previewId', 'not'],
  },
  // PLAN/17 §3 (2026-09-13): Koordinatör başka ajanı ARKA PLANDA başlatır (iç içe koşu yok, beklemez);
  // aynı ajan + mükellef için çalışan/bekleyen iş varsa {ok:false, mevcutIsId}. Canlı yalnız Muzaffer Bey bu koşuyu canlı açtıysa.
  {
    ad: 'ekip_ajan_baslat',
    kaynak: 'ekip',
    kademe: 'portal_yaz',
    aciklama: 'Başka bir ekip ajanını görev metniyle arka planda başlatır (kuru test varsayılan; beklemez, isId döner; sonucu ekip_is_durum ile izle)',
    parametreler: ['ajanId*', 'gorev*', 'taxpayerId', 'canli'],
  },
  {
    ad: 'ekip_is_durum',
    kaynak: 'ekip',
    kademe: 'oku',
    aciklama: 'Bir ekip iş dosyasının durumunu okur (pending/running/done/failed, rapor, hata, kuru test/onay sayıları)',
    parametreler: ['isId*'],
  },
];

// ─── RESMİ GÖNDERİM: adları defterde görünür, HİÇBİR ajan çağıramaz ───
const RESMI_GONDERIM_ARACLARI: AracKaydi[] = [
  { ad: 'gib_beyanname_gonder', kaynak: 'resmi', kademe: 'resmi_gonderim', aciklama: 'GİB beyanname gönderimi — yalnız sahip' },
  { ad: 'sgk_bildirge_gonder', kaynak: 'resmi', kademe: 'resmi_gonderim', aciklama: 'SGK e-bildirge gönderimi — yalnız sahip' },
  { ad: 'edefter_berat_yukle', kaynak: 'resmi', kademe: 'resmi_gonderim', aciklama: 'e-Defter berat yükleme — yalnız sahip' },
];

function parametreListesi(schema: any): string[] {
  const props = schema?.properties || {};
  const req: string[] = Array.isArray(schema?.required) ? schema.required : [];
  return Object.keys(props).map((p) => (req.includes(p) ? `${p}*` : p));
}

function defteriKur(): AracKaydi[] {
  const out: AracKaydi[] = [];
  const gorulen = new Set<string>();

  for (const t of MOREN_AI_TOOLS) {
    gorulen.add(t.name);
    out.push({
      ad: t.name,
      kaynak: 'portal',
      // Ada göre sabit kademe (PLAN/17) > yazan listesi > varsayılan oku
      kademe: PORTAL_KADEMELERI[t.name]?.kademe || (PORTAL_YAZAN_ARACLAR.has(t.name) ? 'portal_yaz' : 'oku'),
      aciklama: (t.description || '').split('.')[0].slice(0, 160),
      parametreler: parametreListesi(t.input_schema),
    });
  }

  // PLAN/17 §3 zincir araçları (tools.ts EKIP_IS_ZINCIRI_ARACLARI): şema/parametre oradan, kademe ADA GÖRE buradan.
  // ekip_* adları EKIP_ARACLARI'ndan gelir (runner kendi işler); eşlemede olmayan zincir aracı = güvenli tarafa (portal_yaz_agir).
  for (const t of EKIP_IS_ZINCIRI_ARACLARI) {
    if (t.name.startsWith('ekip_') || gorulen.has(t.name)) continue;
    gorulen.add(t.name);
    out.push({
      ad: t.name,
      kaynak: 'portal',
      kademe: PORTAL_KADEMELERI[t.name]?.kademe || 'portal_yaz_agir',
      aciklama: PORTAL_KADEMELERI[t.name]?.aciklama || (t.description || '').split('.')[0].slice(0, 160),
      parametreler: parametreListesi(t.input_schema),
    });
  }

  // tools.ts'e henüz girmemiş PLAN/17 araçları: bekleyen kayıt (kademe + açıklama + parametre buradan).
  for (const ad of BEKLEYEN_PORTAL_ARACLARI) {
    if (gorulen.has(ad)) continue;
    gorulen.add(ad);
    const b = PORTAL_KADEMELERI[ad];
    out.push({ ad, kaynak: 'portal', kademe: b.kademe, aciklama: b.aciklama, parametreler: b.parametreler });
  }

  for (const t of FATURA_MERKEZI_AJAN_ARACLARI) {
    if (gorulen.has(t.name)) continue;
    gorulen.add(t.name);
    out.push({
      ad: t.name,
      kaynak: 'portal',
      kademe: FM_KADEMELERI[t.name] || 'luca_yaz', // eşlemede olmayan fm aracı = güvenli tarafa
      aciklama: (t.description || '').split('.')[0].slice(0, 160),
      parametreler: parametreListesi(t.input_schema),
    });
  }

  for (const ad of LUCA_OPERATOR_ARACLARI) {
    gorulen.add(ad);
    out.push({
      ad,
      kaynak: 'luca',
      kademe: LUCA_KADEMELERI[ad] || 'luca_yaz', // bilinmeyen Luca aracı = yazar sayılır (güvenli taraf)
      aciklama: LUCA_ACIKLAMALARI[ad] || ad,
    });
  }

  for (const a of AUTOMATION_ACTION_CATALOG) {
    if (a.category === 'FLOW') continue; // for_each/branch_if/wait/parallel akış yapısıdır, araç değil
    if (gorulen.has(a.name)) continue; // READ_ACTIONS zaten MOREN_AI_TOOLS kopyası
    gorulen.add(a.name);
    // Katalogda olup eşlemede olmayan WRITE eylemi = güvenli tarafa (dışarı gönder) düşer.
    const kademe: Kademe = EYLEM_KADEMELERI[a.name] || (a.category === 'READ' ? 'oku' : 'disari_gonder');
    out.push({
      ad: a.name,
      kaynak: 'eylem',
      kademe,
      aciklama: (a.description || '').split('.')[0].slice(0, 160) + (EYLEM_ACIKLAMA_EKLERI[a.name] || ''),
      parametreler: parametreListesi(a.input_schema),
    });
  }

  for (const e of [...EKIP_ARACLARI, ...RESMI_GONDERIM_ARACLARI]) {
    if (gorulen.has(e.ad)) continue;
    gorulen.add(e.ad);
    out.push(e);
  }
  return out;
}

/** TEK KAYIT DEFTERİ — modül yüklenince bir kez kurulur. */
export const ARAC_DEFTERI: AracKaydi[] = defteriKur();

const DEFTER_HARITASI: Map<string, AracKaydi> = new Map(ARAC_DEFTERI.map((a) => [a.ad, a]));

/** Araç kaydını getir (yoksa null). */
export function aracKaydi(ad: string): AracKaydi | null {
  return DEFTER_HARITASI.get(String(ad || '')) || null;
}

/** Aracın kademesi (defterde yoksa null). */
export function aracKademesi(ad: string): Kademe | null {
  return aracKaydi(ad)?.kademe ?? null;
}

export type AracKapaliNedeni =
  | 'defterde_yok'
  | 'resmi_gonderim'
  | 'ajana_kapali'
  | 'kuru_test';

export interface AracErisim {
  acik: boolean;
  kademe: Kademe | null;
  neden?: AracKapaliNedeni;
  mesaj?: string;
}

/** Kuru testte ÇALIŞMAYAN kademeler (PLAN/17 §1.2: portal_yaz_agir eklendi, 2026-09-13). */
export const KURU_TESTTE_KAPALI_KADEMELER: ReadonlySet<Kademe> = new Set<Kademe>(['luca_yaz', 'disari_gonder', 'portal_yaz_agir']);

/**
 * Bu ajan bu aracı ŞU AN çağırabilir mi?
 *  - resmi_gonderim → her zaman kapalı (ajan listesinde olsa bile)
 *  - ajanın araç listesinde değilse → kapalı
 *  - dryRun ve kademe luca_yaz / disari_gonder / portal_yaz_agir → kapalı ("kuru test": yapılacaktı raporu)
 * disari_gonder canlıda da doğrudan gitmez; onay kaydı açılır — o kural runner'dadır.
 */
export function aracAcikMi(ajan: AracSahibiAjan, ad: string, dryRun: boolean): AracErisim {
  const kayit = aracKaydi(ad);
  if (!kayit) return { acik: false, kademe: null, neden: 'defterde_yok', mesaj: `Defterde olmayan araç: ${ad}` };
  if (kayit.kademe === 'resmi_gonderim') {
    return {
      acik: false,
      kademe: kayit.kademe,
      neden: 'resmi_gonderim',
      mesaj: `${ad}: resmi gönderim yalnız Muzaffer Bey tarafından yapılır; hiçbir ajan çağıramaz.`,
    };
  }
  if (!Array.isArray(ajan?.araclar) || !ajan.araclar.includes(ad)) {
    return { acik: false, kademe: kayit.kademe, neden: 'ajana_kapali', mesaj: `${ad} aracı "${ajan?.id}" ajanına kapalı.` };
  }
  if (dryRun && KURU_TESTTE_KAPALI_KADEMELER.has(kayit.kademe)) {
    return {
      acik: false,
      kademe: kayit.kademe,
      neden: 'kuru_test',
      mesaj: `${ad}: kuru testte çalıştırılmaz; "yapılacaktı" olarak rapora yazılır.`,
    };
  }
  return { acik: true, kademe: kayit.kademe };
}

/** Ajanın araç listesine göre kademe sayımı ({oku: n, portal_yaz: n, ...}). */
export function kademeOzeti(araclar: string[]): Record<Kademe, number> {
  const out: Record<Kademe, number> = { oku: 0, portal_yaz: 0, portal_yaz_agir: 0, luca_yaz: 0, disari_gonder: 0, resmi_gonderim: 0 };
  for (const ad of araclar || []) {
    const k = aracKademesi(ad);
    if (k) out[k]++;
  }
  return out;
}

/** Sistem promptuna gömülecek araç kataloğu (yalnız verilen adlar). */
export function aracKatalogMetni(araclar: string[]): string {
  const satirlar: string[] = [];
  for (const ad of araclar || []) {
    const k = aracKaydi(ad);
    if (!k || k.kademe === 'resmi_gonderim') continue;
    const p = k.parametreler?.length ? ` [param: ${k.parametreler.join(', ')}]` : '';
    satirlar.push(`- ${k.ad} (${k.kademe}): ${k.aciklama}${p}`);
  }
  return satirlar.join('\n');
}
