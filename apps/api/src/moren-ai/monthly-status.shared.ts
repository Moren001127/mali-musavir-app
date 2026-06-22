/**
 * TEK KAYNAK — Aylık mükellef durum listesi (evrak/işleme/kontrol/beyanname).
 *
 * Bu fonksiyon, "kimlerin evrakı geldi / işlendi / kontrolü bitti / beyannamesi
 * verildi" sorularının ALTINDAKİ VERİYİ tek yerde hesaplar. Hem WhatsApp owner
 * kısayolu (whatsapp-bot.controller → maybeHandleOwnerStatusQuery) hem MOREN AI
 * tool'u (tool-executor → listTaxpayersMonthlyStatus) BUNU çağırır; böylece sayfa
 * ile WhatsApp HARFİ HARFİNE aynı cevabı verir, iki kopya birbirinden kaymaz.
 *
 * DÖNEM MODELİ: Aylık durum kayıtları İŞLEM ayına göre saklanır. Owner/mükellef
 * "dönem" derken BEYANNAME dönemini (= işlem ayı − 1) kasteder. Mayıs'ın faturaları
 * Haziran'da işlenir → "Mayıs dönemi" verisi İŞLEM ayı Haziran'dadır.
 *   - Gelen period = BEYANNAME dönemi kabul edilir; sorgu İŞLEM ayı (= period + 1).
 *   - period yoksa cari beyanname dönemi = (bu ay − 1).
 *   - verildiMode (beyannamesi VERİLMİŞ olanlar sorgusu) + period verilmemişse: cari
 *     ay henüz verilmemiş olabilir (vade gelmemiş) → "0/yok" yanlışı çıkar. Bu yüzden
 *     GERÇEKTEN beyanname verilen EN SON işlem ayını bulup onu gösteririz.
 */

const AYLAR = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

export interface MonthlyStatusRow {
  id: string;
  isim: string;
  vkn_tckn: string | null;
  tip: string | null;
  evrakTeslimGunu: number | null;
  evraklarGeldi: boolean;
  evraklarIslendi: boolean;
  /** Aylık takipteki tekil "kontrol edildi" bayrağı (eski alan). */
  kontrolEdildi: boolean;
  /** Portaldaki deriveStage ile AYNI: İND+HES+ARŞİV üçü de ✓. */
  kontrolBitti: boolean;
  kdvKontrolEdildi: boolean;
  beyannameVerildi: boolean;
  /** Beyannamesi verilebilecek = evrak gelmiş + işlenmiş + kontrol bitmiş + verilmemiş. */
  beyannameHazir: boolean;
  /** Bu işlem ayı için durum kaydı oluşturulmuş mu. */
  kayitVar: boolean;
}

export interface MonthlyStatusList {
  rows: MonthlyStatusRow[];
  /** İşlem ayı (kayıtların tutulduğu takvim ayı). */
  year: number;
  month: number;
  islemAyi: string;
  /** Kullanıcıya-dönük dönem (= işlem ayı − 1). */
  beyannameDonem: string;
  /** "Mayıs 2026" gibi okunur etiket (beyanname dönemi). */
  donemLabel: string;
  toplamMukellef: number;
  /** verildiMode'da period verilmediği için dönem dinamik (son verilen ay) seçildi mi. */
  donemDinamikSecildi: boolean;
  /** İstenen işlem ayı boştu → veri bulunan en son işlem ayına düşüldü mü. */
  bosDonemFallback: boolean;
}

function displayName(t: { companyName?: string | null; firstName?: string | null; lastName?: string | null }): string {
  const company = (t.companyName || '').trim();
  if (company) return company;
  const ad = `${t.firstName || ''} ${t.lastName || ''}`.trim();
  return ad || 'Mükellef';
}

function donemLabelOf(beyanDonem: string): string {
  const m = beyanDonem.match(/^(\d{4})-(\d{2})$/);
  if (!m) return beyanDonem;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  return `${AYLAR[mo - 1]} ${y}`;
}

export interface ComputeOpts {
  tenantId: string;
  /** BEYANNAME dönemi 'YYYY-MM' (veri dönemi). Verilmezse cari (bu ay − 1). */
  period?: string | null;
  /** "Beyannamesi verilmiş olanlar" sorgusu mu (dinamik dönem için). */
  verildiMode?: boolean;
  /** Sadece aktif mükellefler (varsayılan true). */
  onlyActive?: boolean;
}

/**
 * Tek kaynak hesap. prisma DI gerektirmez — çağıran kendi PrismaService'ini geçirir.
 */
export async function computeMonthlyStatusList(prisma: any, opts: ComputeOpts): Promise<MonthlyStatusList> {
  const period = String(opts.period || '').trim();
  const explicit = /^\d{4}-\d{2}$/.test(period);

  // 1) Beyanname dönemi → işlem ayı
  let bYear: number;
  let bMonth: number;
  if (explicit) {
    bYear = parseInt(period.slice(0, 4), 10);
    bMonth = parseInt(period.slice(5, 7), 10);
  } else {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    bYear = prev.getFullYear();
    bMonth = prev.getMonth() + 1;
  }
  let year = bYear;
  let month = bMonth + 1;
  if (month === 13) { month = 1; year += 1; }

  // 2) verildiMode + dönem verilmemiş → gerçekten verilen EN SON işlem ayına geç.
  let donemDinamikSecildi = false;
  if (opts.verildiMode && !explicit) {
    const son = await prisma.taxpayerMonthlyStatus.findFirst({
      where: {
        tenantId: opts.tenantId,
        beyannameVerildi: true,
        ...(opts.onlyActive !== false ? { taxpayer: { isActive: true } } : {}),
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      select: { year: true, month: true },
    }).catch(() => null);
    if (son) {
      year = son.year;
      month = son.month;
      donemDinamikSecildi = true;
    }
  }

  // 3) Mükellefler + o işlem ayındaki durum kaydı
  const whereTaxpayer: any = { tenantId: opts.tenantId };
  if (opts.onlyActive !== false) whereTaxpayer.isActive = true;

  const queryRows = async (y: number, m: number) => {
    const taxpayers = await prisma.taxpayer.findMany({
      where: whereTaxpayer,
      select: {
        id: true, type: true, companyName: true, firstName: true, lastName: true,
        taxNumber: true, evrakTeslimGunu: true,
        monthlyStatuses: {
          where: { year: y, month: m },
          select: {
            evraklarGeldi: true,
            evraklarIslendi: true,
            kontrolEdildi: true,
            beyannameVerildi: true,
            kdvKontrolEdildi: true,
            indirilecekKdvKontrol: true,
            hesaplananKdvKontrol: true,
            eArsivKontrol: true,
          },
          take: 1,
        },
      },
      orderBy: [{ companyName: 'asc' }, { firstName: 'asc' }],
    });
    const rows: MonthlyStatusRow[] = taxpayers.map((t: any) => {
      const s = t.monthlyStatuses?.[0] || null;
      const kontrolBitti = !!(s?.indirilecekKdvKontrol && s?.hesaplananKdvKontrol && s?.eArsivKontrol);
      return {
        id: t.id,
        isim: displayName(t),
        vkn_tckn: t.taxNumber ?? null,
        tip: t.type ?? null,
        evrakTeslimGunu: t.evrakTeslimGunu ?? null,
        evraklarGeldi: s?.evraklarGeldi ?? false,
        evraklarIslendi: s?.evraklarIslendi ?? false,
        kontrolEdildi: s?.kontrolEdildi ?? false,
        kontrolBitti,
        kdvKontrolEdildi: s?.kdvKontrolEdildi ?? false,
        beyannameVerildi: s?.beyannameVerildi ?? false,
        beyannameHazir: !!(s?.evraklarGeldi && s?.evraklarIslendi && kontrolBitti) && !(s?.beyannameVerildi ?? false),
        kayitVar: !!s,
      };
    });
    return { rows, toplam: taxpayers.length };
  };

  let { rows, toplam } = await queryRows(year, month);

  // 4) BOŞ AY KORUMASI: çözülen işlem ayında HİÇBİR durum kaydı yoksa (örn. AI "bu ay"ı
  // beyanname dönemi sanıp GELECEK/boş işlem ayını sorgulattıysa → "0/yok" yanlışı), veri
  // bulunan EN SON işlem ayına düş. Deterministik kısayolu etkilemez (cari ay zaten doludur).
  let bosDonemFallback = false;
  if (!donemDinamikSecildi && !rows.some((r) => r.kayitVar)) {
    const sonKayit = await prisma.taxpayerMonthlyStatus.findFirst({
      where: { tenantId: opts.tenantId, ...(opts.onlyActive !== false ? { taxpayer: { isActive: true } } : {}) },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      select: { year: true, month: true },
    }).catch(() => null);
    if (sonKayit && (sonKayit.year !== year || sonKayit.month !== month)) {
      year = sonKayit.year;
      month = sonKayit.month;
      bosDonemFallback = true;
      ({ rows, toplam } = await queryRows(year, month));
    }
  }

  const islemAyi = `${year}-${String(month).padStart(2, '0')}`;
  const byMonth = month === 1 ? 12 : month - 1;
  const byYear = month === 1 ? year - 1 : year;
  const beyannameDonem = `${byYear}-${String(byMonth).padStart(2, '0')}`;

  return {
    rows,
    year,
    month,
    islemAyi,
    beyannameDonem,
    donemLabel: donemLabelOf(beyannameDonem),
    toplamMukellef: toplam,
    donemDinamikSecildi,
    bosDonemFallback,
  };
}

// ============================================================================
// OWNER DURUM-LİSTESİ KISAYOLU (TEK KAYNAK) — intent algılama + biçimlendirme
// Hem WhatsApp owner kısayolu (whatsapp-bot.controller) hem MOREN AI sayfası
// (moren-ai.service.chat owner fast-path) BUNU çağırır → "kimler evrak getirdi /
// beyannamesi verildi" soruları her yüzeyde AYNI, güvenilir, hızlı cevaplanır
// (agentic AI'nın 'çekmem gerekiyor' yarım-cevabına düşmeden).
// ============================================================================

export type OwnerStatusIntent =
  | 'beyanname_hazir' | 'kontrol_bekleyen' | 'evrak_islenen' | 'evrak_gelen'
  | 'evrak_bekleyen' | 'islem_bekleyen' | 'verildi' | 'verilmedi' | 'mukellef_sayisi';

/** Türkçe aksanı sıyırır (ş→s, ı→i, ç→c …) + küçük harf. */
function normalizeForIntent(value: string): string {
  return String(value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Owner mesajından durum-listesi niyetini çıkarır; durum sorusu değilse null. */
export function detectOwnerStatusIntent(text: string): OwnerStatusIntent | null {
  const n = normalizeForIntent(text);
  const isList = /\b(kim|kimler|kac|listele|hangi|kimlerin|olanlar)\b/.test(n) || /\bvar m[ıi]\b/.test(n);
  if (!isList) return null;

  // ── ÖNCE OLUMSUZ / BEKLEYEN kalıplar (en spesifik) ──
  if (/kontrol[^.]*?(bekle|edilmed|edilmemis|edilmeyen|edilecek|edilmeli|edilsin|yapilmad|yapilmamis|yapilacak|yapilmali|bitmemis|bitmedi|gecmemis|gecmedi|olmamis|olmadi)/.test(n)) return 'kontrol_bekleyen';
  if (/(beyanname|beyan)[^.]*?(verilmed|verilmeyen|verilmemis|vermedi|vermeyen|vermemis|gecik|eksik|kalan)/.test(n)) return 'verilmedi';
  if (/(evrak|evrag|belge)[^.]*?(bekle|gelmedi|gelmemis|gelmeyen|gelmiyen|yok)/.test(n)) return 'evrak_bekleyen';
  if (/islenmemis|islenmeyen|islenmedi|henuz islen|(islem|islenme)[^.]*?(bekle|memis|meyen|medi)/.test(n)) return 'islem_bekleyen';

  // ── OLUMLU kalıplar ──
  if (/(beyanname|beyan)[^.]*?(verilebil|verilecek|verilir|hazir)|kontrol[^.]*?(edilen|edildi|biten|bitti|bitmis|yapilan|yapildi|yapilmis|gecen|gecti|gecmis|gecirildi|tamamlan)|kontrolden gec/.test(n)) return 'beyanname_hazir';
  if (/(beyanname|beyan)[^.]*?(verildi|verilen|verilmis|gonderildi|tamamlan)/.test(n)) return 'verildi';
  if (/(evrak|evrag|belge)[^.]*?islen|gelip[^.]*?islen|islenip|islenen|islenmis/.test(n)) return 'evrak_islenen';
  if (/(evrak|evrag|belge)[^.]*?(gel(en|di|mis)|teslim|getir)/.test(n)) return 'evrak_gelen';
  if (/(mukellef|musteri|firma)/.test(n) && /(kac|toplam|sayisi|adet|ne kadar)/.test(n)) return 'mukellef_sayisi';
  return null;
}

/** Owner durum listesi ŞABLONU: başlık + dönem/sayı + her firma AYRI SATIR (numaralı). */
export function formatOwnerStatusList(baslik: string, donemLabel: string, names: string[]): string {
  if (!names.length) {
    return `📋 ${baslik}\n🗓️ ${donemLabel} dönemi\n\nBu durumda mükellef yok.`;
  }
  const gosterilecek = names.slice(0, 60);
  const satirlar = gosterilecek.map((ad, i) => `${i + 1}. ${ad}`).join('\n');
  const fazla = names.length > 60 ? `\n… ve ${names.length - 60} mükellef daha.` : '';
  return `📋 ${baslik}\n🗓️ ${donemLabel} dönemi · ${names.length} mükellef\n\n${satirlar}${fazla}`;
}

/**
 * ÜST DÜZEY: owner durum sorusunu uçtan uca cevaplar (intent + tek-kaynak veri + format).
 * Durum sorusu değilse null döner (çağıran agentic AI'ya devam etsin).
 */
export async function buildOwnerStatusReply(
  prisma: any,
  tenantId: string,
  text: string,
): Promise<{ reply: string; intent: OwnerStatusIntent; count: number; donemLabel: string } | null> {
  const intent = detectOwnerStatusIntent(text);
  if (!intent) return null;

  const list = await computeMonthlyStatusList(prisma, {
    tenantId,
    verildiMode: intent === 'verildi',
    onlyActive: true,
  });

  if (intent === 'mukellef_sayisi') {
    return {
      reply: `👥 Toplam ${list.toplamMukellef} aktif mükellefin takipte.`,
      intent, count: list.toplamMukellef, donemLabel: list.donemLabel,
    };
  }

  const rows = list.rows;
  let filtered: typeof rows;
  let baslik: string;
  switch (intent) {
    case 'beyanname_hazir':
      filtered = rows.filter((r) => r.evraklarGeldi && r.evraklarIslendi && r.kontrolBitti && !r.beyannameVerildi);
      baslik = 'Beyannamesi verilebilecek (kontrolü bitmiş, henüz verilmemiş)';
      break;
    case 'kontrol_bekleyen':
      filtered = rows.filter((r) => r.evraklarGeldi && r.evraklarIslendi && !r.kontrolBitti && !r.beyannameVerildi);
      baslik = 'Kontrol bekleyen (evrak işlendi, kontrol edilmemiş)';
      break;
    case 'evrak_islenen':
      filtered = rows.filter((r) => r.evraklarGeldi && r.evraklarIslendi);
      baslik = 'Evrakı gelip işlenen';
      break;
    case 'evrak_gelen':
      filtered = rows.filter((r) => r.evraklarGeldi);
      baslik = 'Evrakı gelen';
      break;
    case 'evrak_bekleyen':
      filtered = rows.filter((r) => !r.evraklarGeldi);
      baslik = 'Evrak bekleyen (henüz gelmedi)';
      break;
    case 'islem_bekleyen':
      filtered = rows.filter((r) => r.evraklarGeldi && !r.evraklarIslendi);
      baslik = 'Evrakı gelip henüz işlenmemiş';
      break;
    case 'verildi':
      filtered = rows.filter((r) => r.beyannameVerildi);
      baslik = 'Beyannamesi verilmiş';
      break;
    case 'verilmedi':
      filtered = rows.filter((r) => !r.beyannameVerildi);
      baslik = 'Beyannamesi henüz verilmemiş';
      break;
    default:
      return null;
  }
  const names = filtered.map((r) => r.isim);
  return {
    reply: formatOwnerStatusList(baslik, list.donemLabel, names),
    intent, count: names.length, donemLabel: list.donemLabel,
  };
}

// ============================================================================
// PORTFÖY VERGİ ÖDEME LİSTESİ (TEK KAYNAK) — "kimlere kdv/muhtasar/geçici/damga
// ödemesi çıkıyor". Agentic model bu listeyi güvenilir üretemiyordu (124sn dönüp
// "tamamlayamadım" / mevzuat anlatma); deterministik fast-path olarak buradan üretilir.
// tool-executor.getTaxPayableList de computeTaxPayableList'i çağırır (kopya kaymaz).
// ============================================================================

const VERGI_TURLERI: Array<{ re: RegExp; filter: string; label: string }> = [
  { re: /muh|sgk|stopaj|prim|muhtasar/i, filter: 'MUHSGK', label: 'Muhtasar-SGK' },
  { re: /damga/i, filter: 'DAMGA', label: 'Damga Vergisi' },
  { re: /geç|gec|geçici|gecici/i, filter: 'GECICI', label: 'Geçici Vergi' },
  { re: /kurumlar/i, filter: 'KURUMLAR', label: 'Kurumlar Vergisi' },
  { re: /gelir vergi|gelir beyan/i, filter: 'GELIR', label: 'Gelir Vergisi' },
  { re: /kdv/i, filter: 'KDV', label: 'KDV' },
];

export function resolveBeyanTipiFilter(raw: string): { filter: string; label: string } {
  const m = VERGI_TURLERI.find((x) => x.re.test(String(raw || '')));
  return m ? { filter: m.filter, label: m.label } : { filter: 'KDV', label: 'KDV' };
}

export interface TaxPayableList {
  vergiTuru: string;
  donem: string;
  mukellefSayisi: number;
  toplamTutar: number;
  liste: Array<{ mukellef: string; toplam: number }>;
  whatsappOzet: string;
  donemDinamikSecildi: boolean;
}

export interface TaxPayableOpts {
  tenantId: string;
  beyanTipi?: string | null;
  period?: string | null;
  onlyActive?: boolean;
  onlyPayable?: boolean;
}

function fmtTLshared(n: number): string {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0) + ' ₺';
}

/** TEK KAYNAK: bir dönemde bir vergi türü için mükellef+tutar listesi (beyanKaydi tahakkuk). */
export async function computeTaxPayableList(prisma: any, opts: TaxPayableOpts): Promise<TaxPayableList> {
  const { filter, label } = resolveBeyanTipiFilter(opts.beyanTipi || '');
  const onlyActive = opts.onlyActive !== false;
  const onlyPayable = opts.onlyPayable !== false;
  const reqPeriod = String(opts.period || '').trim();
  const explicit = /^\d{4}-(\d{2}|Q[1-4])$/i.test(reqPeriod);
  let donem = explicit ? reqPeriod : '';
  let donemDinamikSecildi = false;

  if (!donem) {
    const son = await prisma.beyanKaydi.findFirst({
      where: {
        tenantId: opts.tenantId,
        beyanTipi: { contains: filter },
        tahakkukTutari: { not: null, gt: 0 },
        ...(onlyActive ? { taxpayer: { isActive: true } } : {}),
      },
      orderBy: [{ beyanTarihi: 'desc' }, { createdAt: 'desc' }],
      select: { donem: true },
    }).catch(() => null);
    donem = son?.donem || '';
    donemDinamikSecildi = true;
  }
  if (!donem) {
    return { vergiTuru: label, donem: '', mukellefSayisi: 0, toplamTutar: 0, liste: [],
      whatsappOzet: `${label} tahakkuk verisi bulunamadı.`, donemDinamikSecildi };
  }

  const where: any = { tenantId: opts.tenantId, donem, beyanTipi: { contains: filter } };
  where.tahakkukTutari = onlyPayable ? { not: null, gt: 0 } : { not: null };
  if (onlyActive) where.taxpayer = { isActive: true };

  const kayitlar = await prisma.beyanKaydi.findMany({
    where,
    select: {
      tahakkukTutari: true,
      taxpayer: { select: { companyName: true, firstName: true, lastName: true } },
    },
  }).catch(() => []);

  const byTaxpayer = new Map<string, { isim: string; toplam: number }>();
  for (const k of kayitlar) {
    const isim = (k.taxpayer?.companyName ||
      `${k.taxpayer?.firstName || ''} ${k.taxpayer?.lastName || ''}`).trim() || 'Mükellef';
    const tutar = Number(k.tahakkukTutari) || 0;
    const g = byTaxpayer.get(isim) || { isim, toplam: 0 };
    g.toplam += tutar;
    byTaxpayer.set(isim, g);
  }
  const liste = Array.from(byTaxpayer.values()).sort((a, b) => b.toplam - a.toplam);
  const toplam = liste.reduce((s, r) => s + r.toplam, 0);

  const satirlar = liste.slice(0, 60).map((r, i) => `${i + 1}. ${r.isim}: ${fmtTLshared(r.toplam)}`).join('\n');
  const whatsappOzet = liste.length
    ? `🧾 ${label.toLocaleUpperCase('tr-TR')} ÖDEMESİ ÇIKAN MÜKELLEFLER — ${donem}\n\n${satirlar}` +
      `${liste.length > 60 ? `\n… ve ${liste.length - 60} mükellef daha.` : ''}` +
      `\n\n💰 Toplam: ${fmtTLshared(toplam)} · ${liste.length} mükellef`
    : `${donem} döneminde ${label} ödemesi çıkan mükellef yok.`;

  return {
    vergiTuru: label, donem, mukellefSayisi: liste.length, toplamTutar: toplam,
    liste: liste.map((r) => ({ mukellef: r.isim, toplam: r.toplam })),
    whatsappOzet, donemDinamikSecildi,
  };
}

/** Owner mesajı portföy vergi-ödeme listesi mi? Değilse null. */
export function detectTaxPayableIntent(text: string): { beyanTipi: string } | null {
  const n = normalizeForIntent(text);
  const isList = /\b(kim|kimler|kimlere|liste|listele|yaz|kaç|kac|tüm|tum|herkes|hangi)\b/.test(n);
  if (!isList) return null;
  // ödeme/çıkıyor/tutar sinyali + bir vergi türü VEYA genel "ödeme/vergi çıkıyor"
  const odemeSinyal = /(çık|cik|öde|ode|ödeyecek|odeyecek|tahakkuk|tutar|ödemesi|odemesi|borç|borc)/.test(n);
  if (!odemeSinyal) return null;
  const turVar = /(kdv|muhtasar|muhsgk|sgk|stopaj|geçici|gecici|damga|kurumlar)/.test(n);
  const genelVergiOdeme = /(vergi|ödeme|odeme).{0,16}(çık|cik|ödeyecek|odeyecek)|(çık|cik).{0,16}(vergi|ödeme|odeme)/.test(n);
  if (!turVar && !genelVergiOdeme) return null;
  const { filter } = resolveBeyanTipiFilter(n);
  return { beyanTipi: filter };
}

/** ÜST DÜZEY: owner vergi-ödeme listesi sorusunu uçtan uca cevaplar. Değilse null. */
export async function buildOwnerTaxPayableReply(
  prisma: any,
  tenantId: string,
  text: string,
): Promise<{ reply: string; vergiTuru: string; donem: string; count: number } | null> {
  const intent = detectTaxPayableIntent(text);
  if (!intent) return null;
  // Dönem metinde açıkça verilmişse al (YYYY-MM veya YYYY-Qn)
  const pm = text.match(/\b(\d{4})-(\d{2}|Q[1-4])\b/i);
  const list = await computeTaxPayableList(prisma, { tenantId, beyanTipi: intent.beyanTipi, period: pm ? pm[0] : '' });
  return { reply: list.whatsappOzet, vergiTuru: list.vergiTuru, donem: list.donem, count: list.mukellefSayisi };
}

// ============================================================================
// CİRO/SATIŞ SIRALAMASI (TEK KAYNAK) — "en çok ciro yapan mükellefler".
// gelirTablosu.netSatislar bazında sıralar. Deterministik fast-path + tool aynı kaynak.
// ============================================================================

export interface RevenueRankingResult {
  donem: string;
  liste: Array<{ mukellef: string; ciro: number; kar: number }>;
  whatsappOzet: string;
  donemDinamikSecildi: boolean;
}

export async function computeRevenueRanking(
  prisma: any,
  opts: { tenantId: string; period?: string | null; limit?: number; onlyActive?: boolean },
): Promise<RevenueRankingResult> {
  const onlyActive = opts.onlyActive !== false;
  const limit = Math.min(Math.max(Number(opts.limit) || 10, 1), 60);
  const reqPeriod = String(opts.period || '').trim();
  const explicit = /^\d{4}-(\d{2}|Q[1-4])$/i.test(reqPeriod);
  let donem = explicit ? reqPeriod : '';
  let donemDinamikSecildi = false;
  if (!donem) {
    const son = await prisma.gelirTablosu.findFirst({
      where: { tenantId: opts.tenantId, ...(onlyActive ? { taxpayer: { isActive: true } } : {}) },
      orderBy: [{ donem: 'desc' }, { createdAt: 'desc' }],
      select: { donem: true },
    }).catch(() => null);
    donem = son?.donem || '';
    donemDinamikSecildi = true;
  }
  if (!donem) {
    return { donem: '', liste: [], whatsappOzet: 'Gelir tablosu verisi bulunamadı.', donemDinamikSecildi };
  }
  const rows = await prisma.gelirTablosu.findMany({
    where: { tenantId: opts.tenantId, donem, ...(onlyActive ? { taxpayer: { isActive: true } } : {}) },
    select: {
      netSatislar: true, brutSatislar: true, donemNetKari: true,
      taxpayer: { select: { companyName: true, firstName: true, lastName: true } },
    },
  }).catch(() => []);
  const liste = rows.map((r: any) => ({
    mukellef: (r.taxpayer?.companyName || `${r.taxpayer?.firstName || ''} ${r.taxpayer?.lastName || ''}`).trim() || 'Mükellef',
    ciro: Number(r.netSatislar) || Number(r.brutSatislar) || 0,
    kar: Number(r.donemNetKari) || 0,
  })).sort((a: any, b: any) => b.ciro - a.ciro);

  const top = liste.slice(0, limit);
  const satirlar = top.map((r: any, i: number) =>
    `${i + 1}. ${r.mukellef}: ${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(r.ciro)} ₺`).join('\n');
  const whatsappOzet = top.length
    ? `📈 EN ÇOK CİRO YAPAN MÜKELLEFLER — ${donem}\n\n${satirlar}\n\n(Net satışlar; ${liste.length} mükellefin gelir tablosu var)`
    : `${donem} için gelir tablosu kaydı yok.`;
  return { donem, liste: top, whatsappOzet, donemDinamikSecildi };
}

/** "en çok ciro/satış yapan" sıralaması mı? Değilse null. */
export function detectRevenueRankingIntent(text: string): { limit: number } | null {
  const n = normalizeForIntent(text);
  const ciro = /(ciro|satis|hasilat|kazan|gelir(?!\s*vergi)|en buyuk mukellef|en buyuk musteri)/.test(n);
  const ranking = /(en cok|en fazla|en yuksek|en buyuk|siralama|sirala|top\s*\d|ilk\s*\d|liste)/.test(n);
  if (!ciro || !ranking) return null;
  const m = n.match(/\b(\d{1,2})\b/);
  return { limit: m ? parseInt(m[1], 10) : 10 };
}

export async function buildOwnerRevenueRankingReply(
  prisma: any, tenantId: string, text: string,
): Promise<{ reply: string; donem: string; count: number } | null> {
  const intent = detectRevenueRankingIntent(text);
  if (!intent) return null;
  const pm = text.match(/\b(\d{4})-(\d{2}|Q[1-4])\b/i);
  const r = await computeRevenueRanking(prisma, { tenantId, period: pm ? pm[0] : '', limit: intent.limit });
  return { reply: r.whatsappOzet, donem: r.donem, count: r.liste.length };
}
