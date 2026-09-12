import { MOREN_AI_TOOLS } from '../moren-ai/tools';
import { AUTOMATION_ACTION_CATALOG } from '../automations/action-catalog';
import { LUCA_OPERATOR_ARACLARI } from '../calisan/luca-operator.service';

/**
 * EKİP — ARAÇ KAYIT DEFTERİ (PLAN/13-AJAN-KADROSU.md §5.3)
 *
 * Tüm araçlar TEK listede: 47 portal aracı (MOREN_AI_TOOLS) + Luca operatör
 * araçları + otomasyon eylem kataloğu + ekibin kendi iç araçları.
 * Her araç bir YETKİ KADEMESİ taşır (§4). Kademe koda gömülüdür; env/anahtarla
 * açılmaz. Ajan tanımları (ajan-tanimlari.ts) araçları buradaki adla seçer.
 *
 * Kademeler:
 *  - oku            : yalnız veri okur → serbest
 *  - portal_yaz     : portalda kayıt yazar (dönem durumu, not, hafıza) → serbest, kayıt altında
 *  - luca_yaz       : Luca'da alan doldurur/tıklar → kuru test varsayılan; canlı için sahip onayı
 *  - disari_gonder  : WhatsApp/SMS/e-posta → canlıda bile doğrudan gitmez, OwnerApprovalRequest
 *  - resmi_gonderim : GİB beyanname, SGK bildirge, e-defter berat → HİÇBİR ajan çağıramaz
 */

export type Kademe = 'oku' | 'portal_yaz' | 'luca_yaz' | 'disari_gonder' | 'resmi_gonderim';

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

export const KADEME_SIRASI: Kademe[] = ['oku', 'portal_yaz', 'luca_yaz', 'disari_gonder', 'resmi_gonderim'];

export const KADEME_ACIKLAMALARI: Record<Kademe, string> = {
  oku: 'Yalnız okur — serbest.',
  portal_yaz: 'Portalda kayıt yazar — serbest, iş dosyasına yazılır.',
  luca_yaz: "Luca'da yazar/tıklar — kuru testte ÇALIŞMAZ, canlıda Kaydet/Gönder kilidi sürer.",
  disari_gonder: 'Mükellefe/dışarıya mesaj — doğrudan gitmez, sahip onayı kaydı açılır.',
  resmi_gonderim: 'GİB/SGK/e-defter resmi gönderim — ajan ASLA çağıramaz, yalnız sahip.',
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
    aciklama: 'Sahip onayı bekleyen dışarı-gönderim kayıtları (PRV-XXXX, hangi ajan, hangi araç, hedef, mesaj)',
    parametreler: ['durum', 'limit'],
  },
  {
    ad: 'ekip_onayla',
    kaynak: 'ekip',
    kademe: 'portal_yaz',
    aciklama: 'Sahip "ONAYLIYORUM #PRV-XXXX" dediğinde o onayı yürütür (mesaj GERÇEKTEN gider). Yalnız sahibin açık sözüyle; kendin karar verme',
    parametreler: ['previewId', 'onayMetni'],
  },
  {
    ad: 'ekip_reddet',
    kaynak: 'ekip',
    kademe: 'portal_yaz',
    aciklama: 'Sahip bir onayı reddettiğinde kaydı kapatır',
    parametreler: ['previewId', 'not'],
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
      kademe: PORTAL_YAZAN_ARACLAR.has(t.name) ? 'portal_yaz' : 'oku',
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
      aciklama: (a.description || '').split('.')[0].slice(0, 160),
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

/**
 * Bu ajan bu aracı ŞU AN çağırabilir mi?
 *  - resmi_gonderim → her zaman kapalı (ajan listesinde olsa bile)
 *  - ajanın araç listesinde değilse → kapalı
 *  - dryRun ve kademe luca_yaz / disari_gonder → kapalı ("kuru test": yapılacaktı raporu)
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
      mesaj: `${ad}: resmi gönderim yalnız sahip tarafından yapılır; hiçbir ajan çağıramaz.`,
    };
  }
  if (!Array.isArray(ajan?.araclar) || !ajan.araclar.includes(ad)) {
    return { acik: false, kademe: kayit.kademe, neden: 'ajana_kapali', mesaj: `${ad} aracı "${ajan?.id}" ajanına kapalı.` };
  }
  if (dryRun && (kayit.kademe === 'luca_yaz' || kayit.kademe === 'disari_gonder')) {
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
  const out: Record<Kademe, number> = { oku: 0, portal_yaz: 0, luca_yaz: 0, disari_gonder: 0, resmi_gonderim: 0 };
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
