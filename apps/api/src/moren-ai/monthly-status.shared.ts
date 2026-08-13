/**
 * TEK KAYNAK — Aylık mükellef durum listesi (evrak/işleme/kontrol/beyanname).
 *
 * Bu fonksiyon, "kimlerin evrakı geldi / işlendi / kontrolü bitti / beyannamesi
 * verildi" sorularının ALTINDAKİ VERİYİ tek yerde hesaplar. Hem WhatsApp owner
 * kısayolu (whatsapp-bot.controller maybeHandleOwnerStatusQuery) hem MOREN AI
 * tool'u (tool-executor listTaxpayersMonthlyStatus) BUNU çağırır; böylece sayfa
 * ile WhatsApp HARFİ HARFİNE aynı cevabı verir, iki kopya birbirinden kaymaz.
 *
 * DÖNEM MODELİ: Aylık durum kayıtları İŞLEM ayına göre saklanır. Owner/mükellef
 * "dönem" derken BEYANNAME dönemini (= işlem ayı − 1) kasteder. Mayıs'ın faturaları
 * Haziran'da işlenir "Mayıs dönemi" verisi İŞLEM ayı Haziran'dadır.
 *   - Gelen period = BEYANNAME dönemi kabul edilir; sorgu İŞLEM ayı (= period + 1).
 *   - period yoksa cari beyanname dönemi = (bu ay − 1).
 *   - verildiMode (beyannamesi VERİLMİŞ olanlar sorgusu) + period verilmemişse: cari
 *     ay henüz verilmemiş olabilir (vade gelmemiş) "0/yok" yanlışı çıkar. Bu yüzden
 *     GERÇEKTEN beyanname verilen EN SON işlem ayını bulup onu gösteririz.
 */

const AYLAR = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

import { cariIsaret, hesaplaCariBakiyeler, borcluOzeti } from '../common/cari-bakiye';

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
  /** Portaldaki deriveStage ile AYNI: İND+HES+ARŞİV üçü de . */
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
  /** İstenen işlem ayı boştu veri bulunan en son işlem ayına düşüldü mü. */
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

  // 1) Beyanname dönemi işlem ayı
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

  // 2) verildiMode + dönem verilmemiş gerçekten verilen EN SON işlem ayına geç.
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
  // DONEM PENCERESI (panel ile AYNI kume). Panel /taxpayers ucu bu iki kosulu
  // uyguluyor (taxpayers.service findAll, monthly scope); burada YOKTU. Sonuc: isi
  // BIRAKMIS mukellefler (endDate gecmis) listeye giriyor, durum kaydi olmadigi icin
  // "evraki gelmedi" sayiliyordu. Canli olcum 2026-08 islem ayi: panel 66, burasi 74
  // -> "evrak bekleyen" 26 yerine 34 cikiyordu; fazladan 8 kisinin HEPSI isi birakmis.
  if (opts.onlyActive !== false) {
    const ilkGun = new Date(year, month - 1, 1);
    const sonGun = new Date(year, month, 0, 23, 59, 59);
    whereTaxpayer.AND = [
      { OR: [{ startDate: null }, { startDate: { lte: sonGun } }] },
      { OR: [{ endDate: null }, { endDate: { gte: ilkGun } }] },
    ];
  }
  // SANAL WHATSAPP KİŞİLERİNİ HARİÇ TUT: owner'ın kendi WhatsApp kaydı
  // (taxNumber 'WHATSAPP-OWNER-*', companyName "Moren Mali Müşavirlik") ve
  // kayıtsız gelen numaralar (taxNumber 'WHATSAPP-*') gerçek mükellef değildir;
  // durum listelerine ve "aktif mükellef sayısı"na girmemeli.
  whereTaxpayer.NOT = { taxNumber: { startsWith: 'WHATSAPP-' } };

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

    // OTORİTER BEYAN İŞARETİ (panel Aylık Takip ile AYNI mantık — taxpayers.service):
    // Aylık checklist'teki elle 'beyannameVerildi' kutusu bayat kalabiliyor; bu yüzden
    // bot/brifing "52 verilmedi" derken panel/Beyanname Takip "~14 kalan" diyordu.
    // Düzeltme: beyanname dönemi (= işlem ayı − 1) için KDV1 BeyanKaydı'nda PDF/URL
    // varsa beyanname GİB'e VERİLMİŞ say (otoriter kayıt), elle kutu boş olsa bile.
    const byY = m === 1 ? y - 1 : y;
    const byM = m === 1 ? 12 : m - 1;
    const beyannameDonem = `${byY}-${String(byM).padStart(2, '0')}`;
    const autoVerildi = new Set<string>();
    try {
      const kayitlar = await (prisma as any).beyanKaydi.findMany({
        where: {
          tenantId: opts.tenantId,
          taxpayerId: { in: taxpayers.map((t: any) => t.id) },
          donem: beyannameDonem,
          beyanTipi: { in: ['KDV1', 'KDV'] }, // KDV2 (tevkifat) ayrı beyanname → sayma
          OR: [{ beyannameUrl: { not: null } }, { pdfUrl: { not: null } }],
        },
        select: { taxpayerId: true },
      });
      for (const k of kayitlar) if (k?.taxpayerId) autoVerildi.add(k.taxpayerId);
    } catch { /* beyan kaydı sorgusu başarısızsa otomatik işaret atlanır, akış bozulmaz */ }

    const rows: MonthlyStatusRow[] = taxpayers.map((t: any) => {
      const s = t.monthlyStatuses?.[0] || null;
      const kontrolBitti = !!(s?.indirilecekKdvKontrol && s?.hesaplananKdvKontrol && s?.eArsivKontrol);
      const beyannameVerildi = (s?.beyannameVerildi ?? false) || autoVerildi.has(t.id);
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
        beyannameVerildi,
        beyannameHazir: !!(s?.evraklarGeldi && s?.evraklarIslendi && kontrolBitti) && !beyannameVerildi,
        kayitVar: !!s,
      };
    });
    return { rows, toplam: taxpayers.length };
  };

  let { rows, toplam } = await queryRows(year, month);

  // 4) BOŞ AY KORUMASI: çözülen işlem ayında HİÇBİR durum kaydı yoksa (örn. AI "bu ay"ı
  // beyanname dönemi sanıp GELECEK/boş işlem ayını sorgulattıysa "0/yok" yanlışı), veri
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
// (moren-ai.service.chat owner fast-path) BUNU çağırır "kimler evrak getirdi /
// beyannamesi verildi" soruları her yüzeyde AYNI, güvenilir, hızlı cevaplanır
// (agentic AI'nın 'çekmem gerekiyor' yarım-cevabına düşmeden).
// ============================================================================

export type OwnerStatusIntent =
  | 'beyanname_hazir' | 'kontrol_bekleyen' | 'evrak_islenen' | 'evrak_gelen'
  | 'evrak_bekleyen' | 'islem_bekleyen' | 'verildi' | 'verilmedi' | 'mukellef_sayisi';

/** Türkçe aksanı sıyırır (şs, ıi, çc …) + küçük harf. */
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
  // MEVZUAT/TARİH/ORAN sorusu = portföy listesi DEĞİL. "beyanname hangi tarihe kadar
  // verilir", "kaç gün", "hangi oran", "ne zaman", "yüzde kaç" gibi sorular mükellef
  // listesi istemez; AI cevaplamalı. ("hangi" tek başına listeyi yanlış tetikliyordu.)
  if (/\bne zaman\b|hangi tarih|son tarih|kaca kadar|hangi oran|yuzde kac|hangi hesap|hangi kod|\bnasil\b|ne kadar sure|kac gun|kac ay|kac saat|hangi gun/.test(n)) return null;
  const isList = /\b(kim|kimler|kac|listele|hangi|kimlerin|olanlar)\b/.test(n) || /\bvar m[ıi]\b/.test(n);
  if (!isList) return null;

  // ── ÖNCE OLUMSUZ / BEKLEYEN kalıplar (en spesifik) ──
  // "bitmeyen / tamamlanmayan / kalan" da OLUMSUZ sayilir. Canli denemede
  // "Kontrolu bitmeyen kimler var" hicbir kalibi tutturamayip AI'ya dusuyor,
  // AI da "listeyi cekme erisimim yok" diyordu.
  if (/kontrol[^.]*?(bekle|edilmed|edilmemis|edilmeyen|edilecek|edilmeli|edilsin|yapilmad|yapilmamis|yapilacak|yapilmali|bitmemis|bitmedi|bitmeyen|bitmeme|tamamlanmam|tamamlanmayan|kalan|eksik)/.test(n)) return 'kontrol_bekleyen';
  if (/(beyanname|beyan)[^.]*?(verilmed|verilmeyen|verilmemis|vermedi|vermeyen|vermemis|gecik|eksik|kalan)/.test(n)) return 'verilmedi';
  if (/(evrak|evrag|belge)[^.]*?(bekle|gelmedi|gelmemis|gelmeyen|gelmiyen|yok)/.test(n)) return 'evrak_bekleyen';
  // "islenecek / islenmesi gereken / islenmeyi bekleyen" = HENUZ ISLENMEMIS.
  // Eskiden bunlar asagidaki OLUMLU dala ("gelip...islen") dusup ISLENMIS listesi
  // donduruyordu; owner "islenen degil islenecek" diye duzeltmek zorunda kaliyordu.
  if (/islenecek|islenmesi gerek|islenmeli|islenmeyi bekle|islenmesi kalan|islem[^.]*?(bitmeyen|tamamlanmayan)/.test(n)) return 'islem_bekleyen';
  if (/islenmemis|islenmeyen|islenmedi|henuz islen|(islem|islenme)[^.]*?(bekle|memis|meyen|medi)/.test(n)) return 'islem_bekleyen';

  // ── OLUMLU kalıplar ──
  if (/(beyanname|beyan)[^.]*?(verilebil|verilecek|verilir|hazir)|kontrol[^.]*?(edilen|edildi|biten|bitti|bitmis|yapilan|yapildi|yapilmis|gecen|gecti|gecmis|gecirildi|tamamlan)|kontrolden gec/.test(n)) return 'beyanname_hazir';
  if (/(beyanname|beyan)[^.]*?(verildi|verilen|verilmis|gonderildi|tamamlan)/.test(n)) return 'verildi';
  // Olumlu dal yalniz GECMIS/SIMDIKI zaman eklerini kabul eder; "islenecek" gelecek
  // zamani yukarida olumsuz dala yakalanir.
  if (/(evrak|evrag|belge)[^.]*?islen(en|di|mis|ip)|gelip[^.]*?islen(en|di|mis|ip)|islenip|islenen|islenmis/.test(n)) return 'evrak_islenen';
  if (/(evrak|evrag|belge)[^.]*?(gel(en|di|mis)|teslim|getir)/.test(n)) return 'evrak_gelen';
  if (/(mukellef|musteri|firma)/.test(n) && /(kac|toplam|sayisi|adet|ne kadar)/.test(n)) return 'mukellef_sayisi';
  return null;
}

/** Owner durum listesi ŞABLONU: başlık + dönem/sayı + her firma AYRI SATIR (numaralı). */
export function formatOwnerStatusList(baslik: string, donemLabel: string, names: string[]): string {
  if (!names.length) {
    return `${baslik}\n${donemLabel} dönemi\n\nBu durumda mükellef yok.`;
  }
  const gosterilecek = names.slice(0, 60);
  const satirlar = gosterilecek.map((ad, i) => `${i + 1}. ${ad}`).join('\n');
  const fazla = names.length > 60 ? `\n… ve ${names.length - 60} mükellef daha.` : '';
  return `${baslik}\n${donemLabel} dönemi · ${names.length} mükellef\n\n${satirlar}${fazla}`;
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
      reply: `Toplam ${list.toplamMukellef} aktif mükellefin takipte.`,
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
      // "beyannamesi verilmeyen / kalan / eksik kimler" = müşavirin İŞ KUYRUĞU:
      // kontrolü bitmiş ama henüz verilmemiş (verilmeye HAZIR) mükellefler.
      // Ham "hiç verilmemiş herkes" (evrakı bile gelmemişler dahil) değil —
      // o liste eyleme dönük değil ve tüm portföyü dökerdi.
      filtered = rows.filter((r) => r.evraklarGeldi && r.evraklarIslendi && r.kontrolBitti && !r.beyannameVerildi);
      baslik = 'Beyannamesi verilmeye hazır — kalan iş (kontrolü bitmiş, henüz verilmemiş)';
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
    ? `${label.toLocaleUpperCase('tr-TR')} ÖDEMESİ ÇIKAN MÜKELLEFLER — ${donem}\n\n${satirlar}` +
      `${liste.length > 60 ? `\n… ve ${liste.length - 60} mükellef daha.` : ''}` +
      `\n\nToplam: ${fmtTLshared(toplam)} · ${liste.length} mükellef`
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
  opts: { tenantId: string; period?: string | null; limit?: number; onlyActive?: boolean; kind?: 'ciro' | 'kar' },
): Promise<RevenueRankingResult> {
  const onlyActive = opts.onlyActive !== false;
  const kind = opts.kind === 'kar' ? 'kar' : 'ciro';
  const limit = Math.min(Math.max(Number(opts.limit) || 10, 1), 60);
  const reqPeriod = String(opts.period || '').trim();
  const explicit = /^\d{4}-(\d{2}|Q[1-4])$/i.test(reqPeriod);
  let donem = explicit ? reqPeriod : '';
  let donemDinamikSecildi = false;
  // NOT: gelirTablosu'nda `taxpayer` İLİŞKİSİ YOK (sadece taxpayerId skaler) ilişki
  // filtresi/select HATA verir. İsimler ayrı taxpayer sorgusuyla çekilir, aktiflik orada süzülür.
  if (!donem) {
    const son = await prisma.gelirTablosu.findFirst({
      where: { tenantId: opts.tenantId },
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
    where: { tenantId: opts.tenantId, donem },
    select: { netSatislar: true, brutSatislar: true, donemNetKari: true, taxpayerId: true },
  }).catch(() => []);
  // Mükellef adlarını + aktiflik durumunu tek sorguda çek.
  const ids = Array.from(new Set(rows.map((r: any) => r.taxpayerId).filter(Boolean)));
  const txs = ids.length
    ? await prisma.taxpayer.findMany({
        where: { id: { in: ids } },
        select: { id: true, companyName: true, firstName: true, lastName: true, isActive: true },
      }).catch(() => [])
    : [];
  const txMap = new Map<string, any>(txs.map((t: any) => [t.id, t]));
  const liste = rows
    .map((r: any) => {
      const t = txMap.get(r.taxpayerId);
      return {
        mukellef: (t?.companyName || `${t?.firstName || ''} ${t?.lastName || ''}`).trim() || 'Mükellef',
        ciro: Number(r.netSatislar) || Number(r.brutSatislar) || 0,
        kar: Number(r.donemNetKari) || 0,
        _aktif: t ? t.isActive !== false : true,
      };
    })
    .filter((r: any) => (onlyActive ? r._aktif : true))
    .sort((a: any, b: any) => (kind === 'kar' ? b.kar - a.kar : b.ciro - a.ciro));

  const top = liste.slice(0, limit);
  const deger = (r: any) => kind === 'kar' ? r.kar : r.ciro;
  const satirlar = top.map((r: any, i: number) =>
    `${i + 1}. ${r.mukellef}: ${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(deger(r))} ₺`).join('\n');
  const baslik = kind === 'kar' ? 'EN ÇOK KÂR EDEN MÜKELLEFLER' : 'EN ÇOK CİRO YAPAN MÜKELLEFLER';
  const dipnot = kind === 'kar' ? 'Dönem net kârı' : 'Net satışlar';
  const whatsappOzet = top.length
    ? `${baslik} — ${donem}\n\n${satirlar}\n\n(${dipnot}; ${liste.length} mükellefin gelir tablosu var)`
    : `${donem} için gelir tablosu kaydı yok.`;
  return { donem, liste: top, whatsappOzet, donemDinamikSecildi };
}

/** "en çok ciro/satış/kâr yapan" sıralaması mı? Değilse null. kind: ciro|kar. */
export function detectRevenueRankingIntent(text: string): { limit: number; kind: 'ciro' | 'kar' } | null {
  const n = normalizeForIntent(text);
  const karWord = /(en (cok|fazla) kar|en karli|net kar|kar eden|kar yapan|kazanc|en cok kazan)/.test(n);
  const ciro = /(ciro|satis|hasilat|kazan|gelir(?!\s*vergi)|en buyuk mukellef|en buyuk musteri)/.test(n) || karWord;
  const ranking = /(en cok|en fazla|en yuksek|en buyuk|en karli|siralama|sirala|top\s*\d|ilk\s*\d|liste)/.test(n);
  if (!ciro || !ranking) return null;
  const m = n.match(/\b(\d{1,2})\b/);
  return { limit: m ? parseInt(m[1], 10) : 10, kind: karWord ? 'kar' : 'ciro' };
}

export async function buildOwnerRevenueRankingReply(
  prisma: any, tenantId: string, text: string,
): Promise<{ reply: string; donem: string; count: number } | null> {
  const intent = detectRevenueRankingIntent(text);
  if (!intent) return null;
  const pm = text.match(/\b(\d{4})-(\d{2}|Q[1-4])\b/i);
  const r = await computeRevenueRanking(prisma, { tenantId, period: pm ? pm[0] : '', limit: intent.limit, kind: intent.kind });
  return { reply: r.whatsappOzet, donem: r.donem, count: r.liste.length };
}

// ============================================================================
// BORÇ/CARİ SIRALAMASI — "borcu en yüksek / borçlu mükellefler". cariHareket
// (TAHAKKUK − TAHSILAT). getCollectionRiskSummary ile AYNI mantık, deterministik.
// ============================================================================

export function detectDebtRankingIntent(text: string): { limit: number } | null {
  const n = normalizeForIntent(text);
  const borc = /(borc|borclu|acik bakiye|acik cari|odemeyen|odememiş|tahsil edil|alacag|alacak)/.test(n);
  const liste = /(en cok|en fazla|en yuksek|en buyuk|kim|kimler|liste|sirala|siralama|hangi|top\s*\d|var m)/.test(n);
  if (!borc || !liste) return null;
  const m = n.match(/\b(\d{1,2})\b/);
  return { limit: m ? parseInt(m[1], 10) : 20 };
}

/**
 * OFIS GENELI TOPLAM acik cari bakiye. "toplam acik cari bakiye ne kadar",
 * "toplam ne kadar alacagimiz var" gibi sorular siralama niyetine takilmiyordu
 * (liste kelimesi yok) ve AI'ya dusup meta cevap uretiyordu (canli deneme #8).
 */
export async function buildOwnerDebtTotalReply(
  prisma: any, tenantId: string, text: string,
): Promise<{ reply: string } | null> {
  const n = normalizeForIntent(text);
  const toplamSoru = /(toplam|genel toplam|hepsi|ne kadar)/.test(n);
  const cariSoru = /(acik cari|acik bakiye|cari bakiye|alacag|alacak|borc)/.test(n);
  const liste = /(kim|kimler|liste|sirala|en cok|en fazla|en yuksek)/.test(n);
  if (!toplamSoru || !cariSoru || liste) return null;

  const [taxpayers, hareketler] = await Promise.all([
    prisma.taxpayer.findMany({ where: { tenantId, isActive: true, NOT: { taxNumber: { startsWith: 'WHATSAPP-' } } }, select: { id: true } }).catch(() => []),
    prisma.cariHareket.findMany({ where: { tenantId }, select: { taxpayerId: true, tip: true, tutar: true } }).catch(() => []),
  ]);
  const ozet = borcluOzeti(hesaplaCariBakiyeler(hareketler, new Set(taxpayers.map((t: any) => t.id))));
  const fmt = (x: number) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x) + ' ₺';
  return {
    reply: `TOPLAM AÇIK CARİ BAKİYE

• Borçlu mükellef: ${ozet.borcluSayisi}
• Toplam: ${fmt(ozet.toplamBakiye)}

(Cari Kasa ekranıyla aynı hesap.)`,
  };
}

export async function buildOwnerDebtRankingReply(
  prisma: any, tenantId: string, text: string,
): Promise<{ reply: string; count: number } | null> {
  const intent = detectDebtRankingIntent(text);
  if (!intent) return null;
  const limit = Math.min(Math.max(intent.limit, 1), 60);
  const [taxpayers, rows] = await Promise.all([
    prisma.taxpayer.findMany({ where: { tenantId }, select: { id: true, companyName: true, firstName: true, lastName: true, isActive: true } }).catch(() => []),
    prisma.cariHareket.findMany({ where: { tenantId }, select: { taxpayerId: true, tip: true, tutar: true } }).catch(() => []),
  ]);
  const tMap = new Map<string, any>(taxpayers.map((t: any) => [t.id, t]));
  const bal = new Map<string, number>();
  for (const h of rows) {
    let cur = bal.get(h.taxpayerId) || 0;
    if (h.tip === 'TAHAKKUK') cur += Number(h.tutar) || 0;
    else if (h.tip === 'TAHSILAT') cur -= Number(h.tutar) || 0;
    bal.set(h.taxpayerId, cur);
  }
  const liste = [...bal.entries()]
    .map(([id, b]) => {
      const t = tMap.get(id);
      return { ad: (t?.companyName || `${t?.firstName || ''} ${t?.lastName || ''}`).trim() || 'Mükellef', bakiye: b, aktif: t ? t.isActive !== false : true };
    })
    .filter((r) => r.bakiye > 0 && r.aktif)
    .sort((a, b) => b.bakiye - a.bakiye);
  const toplam = liste.reduce((s, r) => s + r.bakiye, 0);
  const fmt = (n: number) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' ₺';
  const satirlar = liste.slice(0, limit).map((r, i) => `${i + 1}. ${r.ad}: ${fmt(r.bakiye)}`).join('\n');
  const reply = liste.length
    ? `BORÇLU MÜKELLEFLER (açık cari bakiye)\n\n${satirlar}` +
      `${liste.length > limit ? `\n… ve ${liste.length - limit} mükellef daha.` : ''}` +
      `\n\nToplam: ${fmt(toplam)} · ${liste.length} borçlu mükellef`
    : 'Açık cari bakiyesi (borcu) olan mükellef yok.';
  return { reply, count: liste.length };
}

// ============================================================================
// TOPLAM VERGİ TAHAKKUKU — "bu dönem toplam ne kadar vergi/tahakkuk çıktı".
// beyanKaydi tahakkuk, tür kırılımıyla.
// ============================================================================

export function detectTaxTotalIntent(text: string): boolean {
  const n = normalizeForIntent(text);
  // TEK MÜKELLEF sorusu → portföy TOPLAM tahakkuku ÜRETME (tek-mükellef şablonu/AI cevaplasın).
  // Aksi halde "Sultan Osman İnşaat'a ne kadar geçici vergi çıkar" gibi soruya 91-beyannamelik
  // portföy toplamı dökülüyordu. Sinyal: (a) şirket türü eki, (b) özel isme yönelme/tamlama eki.
  if (/(limited|\bltd\b|anonim|insaat|ticaret|nakliye|lojistik|\bgida\b|sanayi|otomotiv|mimarl|veteriner|klinik)/.test(n)) return false;
  if (/['’](a|e|ya|ye|na|ne|n[ıi]n|n[uü]n|[ıi]n|[uü]n)\b/i.test(text)) return false;
  // HİPOTETİK HESAP sorusu (verilen rakamlarla "…ise ne kadar") → portföy TOPLAMI değil.
  // "kurum kazancı 5.000.000, kkeg 200.000 ise kurumlar vergisi ne kadar" gibi.
  // Yaziyla yazilan tutarlar da hipotetik sayilir. Canli olay: "45 bin tl faturayi
  // isledigim zaman ne kadar kdv oderim" sorusuna 37 beyannamelik OFIS GENELI toplam
  // dondu — cunku "45.000" bicimi olmadigi icin bu korumaya takilmiyordu.
  if (/\bise\b|kkeg|matrah|kazanc|\d{1,3}[.,]\d{3}/.test(n)) return false;
  if (/\d+\s*(bin|milyon|milyar)\b/.test(n)) return false;
  // "…islersem / …oderim / …cikar" gibi VARSAYIM kipleri de tek-olay hesabidir.
  if (/(isledigim|islersem|kesersem|kessem|alirsam|odersem|oderim|odemem gerek)/.test(n)) return false;
  const toplam = /(toplam|ne kadar|kac tl|kac para|genel toplam|hepsi)/.test(n);
  const vergi = /(vergi|tahakkuk|ödeme|odeme|beyanname)/.test(n);
  const liste = /(kim|kimler|hangi mukellef|listele)/.test(n); // liste sorusu DEĞİL (o tax-payable)
  return toplam && vergi && !liste;
}

/**
 * "1. donem / birinci donem / 2.donem" -> 2026-Q1 bicimi. Eskiden yalniz
 * 2026-06 / 2026-Q2 yazimi taniniyor, "1. donemde" denince SESSIZCE en son kayda
 * dusuluyor ve owner'a YANLIS DONEMIN toplami gidiyordu.
 */
/**
 * "haziranda", "Mayıs ayında", "Ocak 2025" gibi TÜRKÇE AY ADINI YYYY-MM'e çevirir.
 * Owner da mükellef de dönemi "2026-06" diye yazmıyor; ay adı tanınmayınca dönem
 * sorgusu sessizce "son beyannameler"e düşüyordu.
 */
export function ayAdindanDonem(text: string): string {
  const n = normalizeForIntent(text);
  const AYLAR: Array<[string, string]> = [
    ['ocak', '01'], ['subat', '02'], ['mart', '03'], ['nisan', '04'],
    ['mayis', '05'], ['haziran', '06'], ['temmuz', '07'], ['agustos', '08'],
    ['eylul', '09'], ['ekim', '10'], ['kasim', '11'], ['aralik', '12'],
  ];
  // Turkce eklemeli dildir ("haziranda", "haziranin"); sondaki sinir aranmaz.
  const bulunan = AYLAR.find(([ad]) => new RegExp(`\\b${ad}`).test(n));
  if (!bulunan) return '';
  const yil = text.match(/\b(20\d{2})\b/);
  return `${yil ? yil[1] : new Date().getFullYear()}-${bulunan[1]}`;
}

export function ceyrekDonemOku(text: string): string {
  const n = normalizeForIntent(text);
  const sozle: Record<string, string> = { birinci: '1', ikinci: '2', ucuncu: '3', dorduncu: '4' };
  const m = n.match(/\b([1-4])\s*\.?\s*donem/) || n.match(/\b(birinci|ikinci|ucuncu|dorduncu)\s+donem/);
  if (!m) return '';
  const q = /^[1-4]$/.test(m[1]) ? m[1] : sozle[m[1]];
  if (!q) return '';
  const yil = text.match(/\b(20\d{2})\b/);
  return `${yil ? yil[1] : new Date().getFullYear()}-Q${q}`;
}

export async function buildOwnerTaxTotalReply(
  prisma: any, tenantId: string, text: string,
): Promise<{ reply: string } | null> {
  if (!detectTaxTotalIntent(text)) return null;
  // ADI GECEN MUKELLEF VARSA OFIS TOPLAMI VERME. Eski korumalar yalniz sirket eki
  // ("Ltd/Insaat") ve iyelik eki ("...'in") ariyordu; SADE BIR KISI ADI gecince
  // tetiklenmiyordu. Canli olay: "hasan rauf saydan 2026 1.donemde ne kadar vergi
  // odedi" sorusuna 98 beyannamelik TUM OFIS toplami dondu, ustune "mukellefin adini
  // yaz" denildi — ad zaten yaziliydi.
  const adaylar = await prisma.taxpayer.findMany({
    where: { tenantId, isActive: true, NOT: { taxNumber: { startsWith: 'WHATSAPP-' } } },
    select: { id: true, companyName: true, firstName: true, lastName: true },
  }).catch(() => []);
  if (resolveTaxpayerByText(adaylar, text)) return null;
  const pm = text.match(/\b(\d{4})-(\d{2}|Q[1-4])\b/i);
  let donem = pm ? pm[0] : ceyrekDonemOku(text);
  if (!donem) {
    const son = await prisma.beyanKaydi.findFirst({
      where: { tenantId, tahakkukTutari: { not: null, gt: 0 }, taxpayer: { isActive: true } },
      orderBy: [{ beyanTarihi: 'desc' }, { createdAt: 'desc' }],
      select: { donem: true },
    }).catch(() => null);
    donem = son?.donem || '';
  }
  if (!donem) return { reply: 'Tahakkuk verisi bulunamadı.' };
  const kayitlar = await prisma.beyanKaydi.findMany({
    where: { tenantId, donem, tahakkukTutari: { not: null, gt: 0 }, taxpayer: { isActive: true } },
    select: { beyanTipi: true, tahakkukTutari: true },
  }).catch(() => []);
  const byType = new Map<string, number>();
  let toplam = 0;
  for (const k of kayitlar) {
    const tutar = Number(k.tahakkukTutari) || 0;
    toplam += tutar;
    byType.set(k.beyanTipi, (byType.get(k.beyanTipi) || 0) + tutar);
  }
  const fmt = (n: number) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' ₺';
  const satirlar = [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([t, v]) => `• ${t}: ${fmt(v)}`).join('\n');
  // Baslikta "TUM OFIS" ACIKCA yazar: owner tek mukellef sorup ofis geneli toplam
  // aldiginda bunu fark edemiyordu (canli dokumde iki kez yasandi).
  const reply = kayitlar.length
    ? `TOPLAM TAHAKKUK — TÜM OFİS · ${donem}\n\n${satirlar}\n\nGENEL TOPLAM: ${fmt(toplam)} (${kayitlar.length} beyanname)\n\n(Tek bir mükellefin rakamını istiyorsan mükellefin adını yaz.)`
    : `${donem} için tahakkuk kaydı yok.`;
  return { reply };
}

// ============================================================================
// MİZAN YÜKLEME DURUMU — "kimlerin mizanı yüklenmemiş/eksik / kimde mizan var".
// mizan tablosu (taxpayerId × donem). Aktif mükelleflerle karşılaştırır.
// ============================================================================

export function detectMizanStatusIntent(text: string): { durum: 'yok' | 'var' } | null {
  const n = normalizeForIntent(text);
  if (!/mizan/.test(n)) return null;
  const isList = /(kim|kimler|kimlerin|hangi|liste|listele|kac|tum|olan|olmayan|var m|eksik)/.test(n);
  if (!isList) return null;
  const yok = /(yok|eksik|yuklenmemis|yuklenmedi|gelmemis|gelmedi|olmayan|girilmemis|girilmedi|cekilmemis)/.test(n);
  const varr = /(yuklenmis|yuklendi|gelmis|geldi|girilmis|girildi|cekilmis|olan)/.test(n);
  return { durum: yok ? 'yok' : (varr ? 'var' : 'yok') };
}

export async function buildOwnerMizanStatusReply(
  prisma: any, tenantId: string, text: string,
): Promise<{ reply: string; count: number } | null> {
  const intent = detectMizanStatusIntent(text);
  if (!intent) return null;
  const pm = text.match(/\b(\d{4})-(\d{2}|Q[1-4])\b/i);
  let donem = pm ? pm[0] : '';
  if (!donem) {
    const son = await prisma.mizan.findFirst({
      where: { tenantId },
      orderBy: [{ donem: 'desc' }, { createdAt: 'desc' }],
      select: { donem: true },
    }).catch(() => null);
    donem = son?.donem || '';
  }
  if (!donem) return { reply: 'Mizan verisi bulunamadı.', count: 0 };

  const [taxpayers, mizanlar] = await Promise.all([
    prisma.taxpayer.findMany({ where: { tenantId, isActive: true }, select: { id: true, companyName: true, firstName: true, lastName: true } }).catch(() => []),
    prisma.mizan.findMany({ where: { tenantId, donem }, select: { taxpayerId: true }, distinct: ['taxpayerId'] }).catch(() => []),
  ]);
  // "X'in mizanı var mı" tek mükellef sorusu; portföy listesi DEĞİL tek-mükellef kısayoluna bırak.
  if (resolveTaxpayerByText(taxpayers, text)) return null;
  const mizanliIds = new Set<string>(mizanlar.map((m: any) => m.taxpayerId).filter(Boolean));
  const ad = (t: any) => (t.companyName || `${t.firstName || ''} ${t.lastName || ''}`).trim() || 'Mükellef';
  const olan = taxpayers.filter((t: any) => mizanliIds.has(t.id)).map(ad).sort((a: string, b: string) => a.localeCompare(b, 'tr'));
  const olmayan = taxpayers.filter((t: any) => !mizanliIds.has(t.id)).map(ad).sort((a: string, b: string) => a.localeCompare(b, 'tr'));

  const hedef = intent.durum === 'var' ? olan : olmayan;
  const baslik = intent.durum === 'var' ? `MİZANI YÜKLENMİŞ MÜKELLEFLER — ${donem}` : `MİZANI EKSİK (YÜKLENMEMİŞ) MÜKELLEFLER — ${donem}`;
  const satirlar = hedef.slice(0, 60).map((isim: string, i: number) => `${i + 1}. ${isim}`).join('\n');
  const reply = hedef.length
    ? `${baslik}\n\n${satirlar}${hedef.length > 60 ? `\n… ve ${hedef.length - 60} mükellef daha.` : ''}` +
      `\n\n${hedef.length} mükellef (toplam ${taxpayers.length} aktif; ${olan.length} mizanlı / ${olmayan.length} eksik)`
    : (intent.durum === 'var' ? `${donem} için mizanı yüklenmiş mükellef yok.` : `${donem} için tüm aktif mükelleflerin mizanı yüklenmiş `);
  return { reply, count: hedef.length };
}

// ============================================================================
// TEK-MÜKELLEF KDV — "X'in/X'e ne kadar KDV çıkıyor/ödeyecek". TEMKİNLİ isim eşleme
// (tek-net kazanan yoksa nullagentic). En son dönem KDV kontrol seansından
// 391(hesaplanan)−191(indirilecek)=ödenecek. ŞABLON + anında.
// ============================================================================

const KDV_AYLAR = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const SIRKET_GENERIK = new Set([
  'limited','sirketi','sirket','sti','ltd','anonim','as','kollektif','komandit','kooperatif',
  've','dis','ic','sanayi','ticaret','hizmetleri','hizmet','organizasyon','ltdsti',
]);

/** Sorgu metninden TEK-NET mükellef çöz (ayırt edici ad-kelimeleri sorguda geçiyorsa). Belirsizse null. */
export function resolveTaxpayerByText(taxpayers: any[], text: string): any | null {
  const q = normalizeForIntent(text);
  const qTokens = new Set(q.split(/\s+/).filter((t) => t.length >= 2));
  if (!qTokens.size) return null;
  const qArr = Array.from(qTokens);
  // Türkçe ek toleransı: sorgu-kelimesi ad-kökünü AYNEN içerir VEYA onunla BAŞLAR
  // ("akgozun""akgoz", "madeninin""madeni"; kök ≥3 harf olmalı, kısa yanlış-eşleşme olmasın).
  const eslesir = (nameTok: string) =>
    qTokens.has(nameTok) || (nameTok.length >= 3 && qArr.some((qt) => qt.startsWith(nameTok)));
  let best: any = null, bestScore = 0, secondScore = 0;
  for (const t of taxpayers) {
    const ad = (t.companyName || `${t.firstName || ''} ${t.lastName || ''}`).trim();
    const nameTokens = normalizeForIntent(ad).split(/\s+/).filter((w) => w.length >= 2 && !SIRKET_GENERIK.has(w));
    let score = 0;
    for (const w of nameTokens) if (eslesir(w)) score++;
    if (score > bestScore) { secondScore = bestScore; bestScore = score; best = t; }
    else if (score > secondScore) secondScore = score;
  }
  // GÜVENLİ: en az 2 ayırt edici ad-kelimesi eşleşmeli VE net kazanan olmalı (yanlış mükellef riski yüksek).
  return bestScore >= 2 && bestScore > secondScore ? best : null;
}

export interface SingleKdv { periodLabel: string; donemLabel: string; hesaplanan: number; indirilecek: number; odenecek: number; }

export async function computeTaxpayerKdvPayable(prisma: any, tenantId: string, taxpayerId: string, periodLabel?: string): Promise<SingleKdv | null> {
  let pl = periodLabel || '';
  if (!pl) {
    const son = await prisma.kdvControlSession.findFirst({
      where: { tenantId, taxpayerId, status: 'COMPLETED' },
      orderBy: [{ periodLabel: 'desc' }, { createdAt: 'desc' }],
      select: { periodLabel: true },
    }).catch(() => null);
    pl = son?.periodLabel || '';
  }
  if (!pl) return null;
  const sessions = await prisma.kdvControlSession.findMany({
    where: { tenantId, taxpayerId, periodLabel: pl },
    orderBy: { createdAt: 'desc' },
    include: { kdvRecords: { select: { kdvTutari: true } } },
  }).catch(() => []);
  let hesaplanan: number | null = null, indirilecek: number | null = null;
  for (const s of sessions) {
    const tot = (s.kdvRecords || []).reduce((a: number, r: any) => a + (Number(r.kdvTutari) || 0), 0);
    if (/391/.test(String(s.type)) && hesaplanan === null) hesaplanan = tot;
    if (/191/.test(String(s.type)) && indirilecek === null) indirilecek = tot;
  }
  if (hesaplanan === null && indirilecek === null) return null;
  const h = hesaplanan || 0, i = indirilecek || 0;
  const m = pl.match(/^(\d{4})[\/-](\d{2})$/);
  const donemLabel = m ? `${KDV_AYLAR[parseInt(m[2], 10) - 1]} ${m[1]}` : pl;
  return { periodLabel: pl, donemLabel, hesaplanan: h, indirilecek: i, odenecek: h - i };
}

/**
 * MÜKELLEF HIZLI-YOL: mükellefin KENDİ sık sorularını (borç/bakiye, son ödeme, KDV durumu,
 * beyanname durumu) agentic+LLM-yargıç+retry zincirini ATLAYIP anında + şablonlu cevaplar.
 * AKTİF MÜKELLEFE KİLİTLİ (taxpayerId parametreyle gelir; isim çözümü YOK yanlış mükellef
 * imkânsız). Eşleşme yoksa null agentic akışa bırakır. Beyanname TUTARI verilmez (sadece durum).
 */
// Ham beyanname kodunu insan diline cevirir (musteri "GGECICI" degil "Gelir Gecici
// Vergi" gorsun). Hem vergi tutari hem beyanname durumu dallari kullanir.
const BEYAN_TIP_ADI: Record<string, string> = {
  KDV1: 'KDV', KDV2: 'KDV tevkifat (2 No.lu)', MUHSGK: 'Muhtasar-SGK', DAMGA: 'Damga Vergisi',
  GGECICI: 'Gelir Geçici Vergi', KGECICI: 'Kurumlar Geçici Vergi', GECICI_VERGI: 'Geçici Vergi',
  KURUMLAR: 'Kurumlar Vergisi', GELIR: 'Yıllık Gelir Vergisi', POSET: 'Poşet Beyannamesi',
  BILDIRGE: 'Bildirim', EDEFTER: 'e-Defter Beratı', DIGER: 'Beyanname',
};
export function beyanTipiAdi(t: string): string { return BEYAN_TIP_ADI[t] || t; }

export async function buildTaxpayerSelfReply(
  prisma: any, tenantId: string, taxpayerId: string, text: string,
): Promise<{ reply: string; kind: string } | null> {
  const n = normalizeForIntent(text);

  // ── UCUNCU KISI / PORTFOY KORUMASI (canli deneme bulgusu) ────────────────────
  // Hizli-yol kaliplari fazla genisti: "Ahmet Bey'in borcu ne kadar", "En cok borcu
  // olan kim", "Vergi cezasi geldi ne kadar odeyecegim" sorularinin UCUNDE de
  // SORANIN KENDI BAKIYESI cevap olarak donuyordu. Baska mukellefin verisi sizmiyor
  // ama cevap YANLIS ve yaniltici. Bu kaliplarda hizli-yol DEVREDEN CIKAR; soru
  // AI'ya gider, o da gizlilik kuralina gore reddeder/eskale eder.
  const ucuncuKisi = /\b(bey'?in|bey in|hanim'?in|hanimin)\b/.test(n)
    || /\b(baska|digerleri?nin|onun|onlarin)\s+(borc|bakiye|kdv|beyanname|fatura)/.test(n);
  const portfoySorusu = /\b(kim|kimin|kimler|en cok|en fazla|en yuksek|listele|hangi mukellef|kac mukellef)\b/.test(n);
  if (ucuncuKisi || portfoySorusu) return null;
  // "ceza" sorusu BAKIYE sorusu degildir — kendi bakiyesini cevap diye vermesin.
  if (/ceza/.test(n) && !/(bakiye|cari|hesabim)/.test(n)) return null;

  const fmtTL = (x: number) =>
    new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x) + ' ₺';
  const aylar = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const tarihTR = (d: any) => { const x = new Date(d); return `${x.getDate()} ${aylar[x.getMonth()]} ${x.getFullYear()}`; };

  // SON ÖDEME: "en son ne zaman ÖDEDİM" (geçmiş, kendi ödemem). "ne zaman ÖDENİR/ödenmeli"
  // (geçici vergi takvimi gibi) buraya GİRMEZ — onu son-ödeme sanıp yanlış cevap veriyordu.
  const wantsSonOdeme = /(en son (ne (zaman|kadar) )?ode|son odeme(m|miz|yi)?\b|ne zaman odedi|en son ne kadar)/.test(n)
    && !/oden(ir|ecek|meli|mes|me )|ne zaman oden|yatir/.test(n);
  // KDV (kendi verisi): "kdvm/kdvim" (iyelik = benim kdv'm) veya tutar/durum kelimesi.
  const wantsKdv = /kdv/.test(n) && (/(ne kadar|odeyecek|odecek|cikiyor|cikti|durum|borc|kac tl|kac para|tutar|hesaplanan|indirilecek|odemem)/.test(n) || /kdvm|kdvim/.test(n));
  // NOT: "alacag" KALDIRILDI — "eleman alacağım" (alma fiili) ile "alacak" (receivable) çakışıyor.
  // VERGI (kendi tahakkuku). "ne kadar vergi odeyecegim" sorusu CARI BORC dalina
  // dusuyordu ve musavirlik ucreti bakiyesi cevap olarak veriliyordu — mukellefe
  // yanlis rakam. Vergi/tahakkuk sorusu kendi beyanname tahakkukundan cevaplanir.
  const wantsVergi = !wantsKdv
    && /(vergi|tahakkuk)/.test(n)
    && /(ne kadar|kac tl|kac para|tutar|odeyecek|odecek|odedim|cikti|cikiyor|borcum)/.test(n)
    && !/(oran|yuzde|ne zaman|son tarih|nedir|ne demek)/.test(n);
  const wantsBorc = !wantsKdv && !wantsVergi && (/(\bborc|borcum|bakiye|hesabim|odemem (var|gerek|olan)|odenecek (bir|var|tutar)|ne kadar.*ode)/.test(n) || wantsSonOdeme);
  // Beyanname DURUMU: beyanname + tüm tipler (muhtasar/geçici) + durum kelimesi.
  const wantsBeyan = /(beyanname|beyannamem|beyanim|muhtasar|gecici vergi)/.test(n) && /(veril|hazir|durum|oldu mu|verildi mi|hazir mi|yapildi)/.test(n);

  // KDV durumu (kendi)
  if (wantsKdv) {
    const pm = text.match(/\b(\d{4})[\/-](\d{2})\b/);
    const kdv = await computeTaxpayerKdvPayable(prisma, tenantId, taxpayerId, pm ? `${pm[1]}/${pm[2]}` : '');
    if (!kdv) return { reply: 'KDV tutarınız için kontrolümüz henüz tamamlanmadı; en kısa sürede netleştirip ileteceğiz.', kind: 'kdv' };
    const sonuc = kdv.odenecek >= 0 ? `Ödenecek KDV: ${fmtTL(kdv.odenecek)}` : `Devreden KDV: ${fmtTL(-kdv.odenecek)} (ödeme çıkmıyor)`;
    return { reply: `${kdv.donemLabel} KDV durumunuz:\nHesaplanan: ${fmtTL(kdv.hesaplanan)}\nİndirilecek: ${fmtTL(kdv.indirilecek)}\n${sonuc}`, kind: 'kdv' };
  }

  // Borç / bakiye / son ödeme (kendi)
  if (wantsBorc) {
    const hareketler = await prisma.cariHareket.findMany({
      where: { tenantId, taxpayerId },
      select: { tip: true, tutar: true, tarih: true, odemeYontemi: true },
      orderBy: { tarih: 'desc' },
    }).catch(() => []);
    // Isaret tanimi TEK KAYNAKTAN (common/cari-bakiye) — owner tarafi ile ayni olsun.
    let bakiye = 0;
    for (const h of hareketler) bakiye += cariIsaret(h.tip) * (Number(h.tutar) || 0);
    const sonO = hareketler.find((h: any) => h.tip === 'TAHSILAT');
    if (wantsSonOdeme) {
      if (!sonO) return { reply: 'Sistemde kayıtlı bir ödemeniz görünmüyor.', kind: 'son-odeme' };
      return { reply: `En son ${tarihTR(sonO.tarih)} tarihinde ${fmtTL(Number(sonO.tutar) || 0)} ödeme yapmışsınız${sonO.odemeYontemi ? ' (' + sonO.odemeYontemi + ')' : ''}.`, kind: 'son-odeme' };
    }
    const durum = bakiye > 0 ? `Açık bakiyeniz: ${fmtTL(bakiye)}` : bakiye < 0 ? `${fmtTL(-bakiye)} alacaklı/avans görünüyorsunuz` : 'Açık borcunuz görünmüyor (hesap kapalı)';
    const sonLine = sonO ? `\nSon ödeme: ${tarihTR(sonO.tarih)} · ${fmtTL(Number(sonO.tutar) || 0)}` : '';
    return { reply: `${durum}${sonLine}`, kind: 'borc' };
  }

  // VERGİ TUTARI (kendi) — beyanname tahakkuklarından. Dönem yazılmışsa o dönem,
  // yazılmamışsa son verilen beyannameler.
  if (wantsVergi) {
    const kayitlar = await prisma.beyanKaydi.findMany({
      where: { tenantId, taxpayerId },
      orderBy: [{ donem: 'desc' }],
      take: 60,
      select: { beyanTipi: true, donem: true, tahakkukTutari: true, beyanTarihi: true },
    }).catch(() => []);
    if (!kayitlar.length) return { reply: 'Vergi tahakkukunuzu sistemde henüz görmüyorum; beyannameniz verilince tutarı iletiriz.', kind: 'vergi' };
    const ayEs = text.match(/\b(\d{4})-(\d{2})\b/);
    const ayAd = ayEs ? '' : ayAdindanDonem(text);
    const ayM: string[] | null = ayEs ? [ayEs[0]] : (ayAd ? [ayAd] : null);
    const qM = text.match(/\b(\d{4})-Q([1-4])\b/i);
    const ceyrek = ceyrekDonemOku(text) || (qM ? qM[0].toUpperCase() : '');
    let sec: any[] = kayitlar;
    let etiket = '';
    if (ayM) {
      sec = kayitlar.filter((k: any) => String(k.donem) === ayM[0]);
      etiket = donemOku(ayM[0]);
    } else if (ceyrek) {
      const [yil, q] = ceyrek.split('-Q');
      const aylarHar: Record<string, string[]> = { '1': ['01', '02', '03'], '2': ['04', '05', '06'], '3': ['07', '08', '09'], '4': ['10', '11', '12'] };
      const ayListe = aylarHar[q] || [];
      sec = kayitlar.filter((k: any) => {
        const d = String(k.donem || '').toUpperCase();
        return d === `${yil}-Q${q}` || ayListe.some((a) => d === `${yil}-${a}`);
      });
      etiket = `${yil} ${q}. dönem`;
    }
    if (!sec.length) return { reply: `${etiket || 'İstediğiniz dönem'} için tahakkuk kaydınızı görmüyorum.`, kind: 'vergi' };
    let toplamYaz = true;
    if (!etiket) {
      sec = sec.slice().sort((a: any, b: any) => {
        const ta = a.beyanTarihi ? new Date(a.beyanTarihi).getTime() : 0;
        const tb = b.beyanTarihi ? new Date(b.beyanTarihi).getTime() : 0;
        return tb - ta;
      }).slice(0, 5);
      etiket = '';
      toplamYaz = false; // karisik donemlerin toplami anlamsiz
    }
    const cokDonem = new Set(sec.map((k: any) => String(k.donem))).size > 1;
    const sat = sec
      .slice()
      .sort((a: any, b: any) => String(a.donem).localeCompare(String(b.donem)))
      .map((k: any) => `- ${beyanTipiAdi(k.beyanTipi)}${cokDonem ? ' ' + donemOku(String(k.donem)) : ''}: ${fmtTL(Number(k.tahakkukTutari) || 0)}`)
      .join('\n');
    const top = sec.reduce((a: number, k: any) => a + (Number(k.tahakkukTutari) || 0), 0);
    const topSat = (toplamYaz && top > 0) ? `\n\nToplam: ${fmtTL(top)}` : '';
    const baslik = etiket
      ? `${etiket} tahakkuk eden vergileriniz:`
      : 'Son beyannamelerinize göre tahakkuk eden vergileriniz:';
    return { reply: `${baslik}\n\n${sat}${topSat}`, kind: 'vergi' };
  }

  // Beyanname DURUMU (kendi) — tutar VERME, sadece verildi/hazırlanıyor
  if (wantsBeyan) {
    const kayitlar = await prisma.beyanKaydi.findMany({
      where: { tenantId, taxpayerId },
      orderBy: [{ donem: 'desc' }],
      take: 25,
      select: { beyanTipi: true, donem: true, beyanTarihi: true },
    }).catch(() => []);
    if (!kayitlar.length) return { reply: 'Beyanname kaydınızı sistemde henüz görmüyorum; hazırlanınca size bilgi vereceğiz.', kind: 'beyanname' };
    const adKodu = beyanTipiAdi;
    // Dönemi düzgün yaz: 2026-05"Mayıs 2026", 2026-Q1"2026 1. geçici vergi dönemi", 2025-YIL"2025 yıllık"
    const donemFmt = (d: string) => {
      const mm = d.match(/^(\d{4})[\/-](\d{2})$/); if (mm) return `${aylar[parseInt(mm[2], 10) - 1]} ${mm[1]}`;
      const qq = d.match(/^(\d{4})[\/-]?Q(\d)$/i); if (qq) return `${qq[1]} ${qq[2]}. geçici vergi dönemi`;
      if (/yil/i.test(d)) return `${(d.match(/\d{4}/) || [d])[0]} yıllık`;
      return d;
    };
    const verildi = kayitlar.filter((k: any) => k.beyanTarihi)
      .sort((a: any, b: any) => new Date(b.beyanTarihi).getTime() - new Date(a.beyanTarihi).getTime())
      .slice(0, 5);
    const bekleyen = kayitlar.filter((k: any) => !k.beyanTarihi).slice(0, 5);
    let r = 'Beyanname durumunuz:\n';
    if (verildi.length) r += '\nVerilenler:\n' + verildi.map((k: any) => `- ${adKodu(k.beyanTipi)} — ${donemFmt(k.donem)}`).join('\n') + '\n';
    if (bekleyen.length) r += '\nHazırlananlar:\n' + bekleyen.map((k: any) => `- ${adKodu(k.beyanTipi)} — ${donemFmt(k.donem)}`).join('\n');
    if (!verildi.length && !bekleyen.length) r += '\nKayıt görünmüyor.';
    return { reply: r.trim(), kind: 'beyanname' };
  }

  return null;
}

/**
 * MÜKELLEF HIZLI-YOL 2 (mevzuat + selamlama): SABİT-kurallı sık sorular (KDV oranı, fatura
 * süresi, yıllık izin, SGK giriş/çıkış süreleri) ve selamlama/teşekkür agentic'i ATLAYIP
 * anında + DOĞRU + saçma-sız cevaplar. SADECE değişmeyen kurallar (yıldan yıla değişen TUTAR/
 * had/ceza BURADA YOK — onlar agentic'te güncel kaynakla). Veri sorusu DEĞİL (o buildTaxpayerSelfReply'da).
 * Eşleşmezse null agentic.
 */
export function buildTaxpayerQuickReply(text: string): { reply: string; kind: string } | null {
  const n = normalizeForIntent(text);
  const wc = n.split(/\s+/).filter(Boolean).length;

  // SELAMLAMA (sadece kısa, başka niyet yoksa). "selamun aleykum / esselamu aleykum /
  //   aleykum selam" varyasyonları da yakalanır — yoksa agentic'e düşüp laubali cevap üretiyordu.
  if (wc <= 4 &&
      (/\b(merhaba|merhabalar|selam|selamlar|slm|mrb|gunaydin|iyi gunler|iyi aksamlar|kolay gelsin|nasilsin|nasilsiniz|naber|ne haber)\b/.test(n)
        || /selam[uü]?n? ?aleyk[uü]m|esselam[uü]? ?aleyk[uü]m|aleyk[uü]m ?selam/.test(n))
      && !/(borc|kdv|beyan|fatura|odeme|ne kadar|ne zaman|kac|mi$|var mi)/.test(n)) {
    // Dini selama dini karşılık; diğerlerine nötr — ikisi de KURUMSAL, "siz" dili, laubalilik yok.
    const diniSelam = /aleyk[uü]m|selam[uü]n|esselam/.test(n);
    return {
      reply: diniSelam
        ? 'Aleykümselam, hoş geldiniz. Size nasıl yardımcı olabilirim?'
        : 'Merhaba, hoş geldiniz. Size nasıl yardımcı olabilirim?',
      kind: 'selamlama',
    };
  }
  // TEŞEKKÜR
  if (wc <= 5 && (/\b(tesekkur|tesekkurler|eyvallah|tsk)\b/.test(n) || /\bsag\s?ol/.test(n) || /\bsaol/.test(n))) {
    return { reply: 'Rica ederim, her zaman buradayız. Başka bir konuda yardımcı olabilirsem yazmanız yeterli.', kind: 'tesekkur' };
  }

  // KDV ORANI (sabit: %20 / %10 / %1). SADECE "oran/yüzde" sorusu — "kdvm/kdvim/durumum/ne kadar"
  // (kendi KDV tutarı) BURAYA GİRMEZ, o veri sorusudur (buildTaxpayerSelfReply'da cevaplanır).
  if (/kdv/.test(n) && /(oran|yuzde|kacta)/.test(n)
      && !/(kdvm|kdvim|benim|durumum|borcum|odemem|hesaplanan|indirilecek|ne kadar)/.test(n)) {
    return { reply: 'KDV oranları: genel oran %20; indirimli oranlar mal/hizmet türüne göre %10 ve %1 (örn. temel gıda %1). Hangi ürün/hizmet için sorduğunuzu yazarsanız netleştirebilirim.', kind: 'mevzuat:kdv-oran' };
  }
  // FATURA DÜZENLEME SÜRESİ (7 gün, VUK 231/5)
  if (/fatura/.test(n) && /(kac gun|ne zaman|sure|kac gunde|gun icinde|ne kadar sure)/.test(n) && /(kes|duzenle|olustur|fatura)/.test(n)) {
    return { reply: 'Fatura, mal teslimi veya hizmetin yapılmasından itibaren 7 gün içinde düzenlenir (VUK 231/5). Bu süreyi aşmamaya dikkat edin; geç düzenleme cezaya tabi olabilir.', kind: 'mevzuat:fatura-sure' };
  }
  // YILLIK ÜCRETLİ İZİN (İş K. 53: 14/20/26)
  if (/(yillik|ucretli)?\s*(izin|izn)/.test(n) && /(kac gun|ne kadar|hak|gun)/.test(n)) {
    return { reply: 'Yıllık ücretli izin (İş Kanunu 53): 1-5 yıl kıdem 14 gün, 5-15 yıl 20 gün, 15 yıldan fazla 26 gün. 18 yaş altı ve 50 yaş üstü çalışanlarda en az 20 gündür.', kind: 'mevzuat:izin' };
  }
  // SGK İŞE GİRİŞ bildirimi (en geç 1 gün önce)
  if (/sgk|sigorta|ise giris|ise alma|yeni eleman|eleman al|isci al/.test(n) && /(giris|baslama|alacag|alirken|bildir|ne yap|nasil)/.test(n) && !/cikis|cikar|ayril/.test(n)) {
    return { reply: 'Yeni işçinin SGK işe giriş bildirgesi, çalışmaya başlamadan EN GEÇ bir gün önce verilir (inşaat, tarım, balıkçılık ve yeni işyeri açılışında istisnalar vardır). Bildirimi yapmamız için kimlik ve işe başlama tarihini iletmeniz yeterli.', kind: 'mevzuat:sgk-giris' };
  }
  // SGK İŞTEN ÇIKIŞ (10 gün)
  if (/(isten cikis|cikis bildir|isci cikar|isten ayril|isten cikar)/.test(n)) {
    return { reply: 'İşten çıkış bildirimi, çıkış tarihinden itibaren 10 gün içinde SGK\'ya yapılır. Çıkış tarihini ve nedenini iletirseniz işlemi biz yürütürüz.', kind: 'mevzuat:sgk-cikis' };
  }

  return null;
}

export function detectSingleTaxpayerKdvIntent(text: string): boolean {
  const n = normalizeForIntent(text);
  if (!/kdv/.test(n)) return false;
  if (/(kim|kimler|kimlere|liste|listele|herkes|tum|hangi mukellef)/.test(n)) return false; // portföy sorusu
  return /(ne kadar|odeyecek|odecek|cikiyor|cikti|cikan|durum|detay|borc|kac tl|tutar|hesaplanan|indirilecek)/.test(n);
}

export async function buildOwnerSingleTaxpayerKdvReply(
  prisma: any, tenantId: string, text: string,
): Promise<{ reply: string; mukellef: string } | null> {
  if (!detectSingleTaxpayerKdvIntent(text)) return null;
  const taxpayers = await prisma.taxpayer.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, companyName: true, firstName: true, lastName: true },
  }).catch(() => []);
  const t = resolveTaxpayerByText(taxpayers, text);
  if (!t) return null; // belirsiz agentic
  const pm = text.match(/\b(\d{4})[\/-](\d{2})\b/);
  const kdv = await computeTaxpayerKdvPayable(prisma, tenantId, t.id, pm ? `${pm[1]}/${pm[2]}` : '');
  const ad = (t.companyName || `${t.firstName || ''} ${t.lastName || ''}`).trim();
  if (!kdv) {
    // KDV Kontrol (Luca-mutabik) yoksa soruyu bos birakma: GIB'den cekilmis
    // beyanname tahakkuku varsa KAYNAGI ACIKCA yazarak onu ver. KDV beyani
    // hazirlarken kaynak yine yalniz KDV Kontrol'dur; bu satir sadece bilgi.
    const donem = pm ? `${pm[1]}-${pm[2]}` : '';
    const bk = await prisma.beyanKaydi.findMany({
      where: { tenantId, taxpayerId: t.id, beyanTipi: { startsWith: 'KDV' }, ...(donem ? { donem } : {}) },
      orderBy: [{ donem: 'desc' }],
      take: donem ? 5 : 3,
      select: { beyanTipi: true, donem: true, tahakkukTutari: true },
    }).catch(() => []);
    if (bk.length) {
      const sat = bk
        .filter((b: any) => Number(b.tahakkukTutari) > 0)
        .map((b: any) => `• ${donemOku(String(b.donem))} ${b.beyanTipi}: ${TL2(Number(b.tahakkukTutari))}`)
        .join('\n');
      if (sat) {
        return {
          reply: `${ad} için tamamlanmış KDV kontrolü yok. Beyannameye göre ödenen KDV:\n\n${sat}\n\n(Kaynak: GİB beyanname tahakkuku. KDV kontrolü yapılınca 391−191 ayrıntısını da iletebilirim.)`,
          mukellef: ad,
        };
      }
    }
    return { reply: `${ad} için tamamlanmış KDV kontrolü bulamadım; kontrol yapılınca KDV tutarını iletebilirim.`, mukellef: ad };
  }
  const fmt = (x: number) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x) + ' ₺';
  const sonuc = kdv.odenecek >= 0
    ? `Ödenecek KDV: ${fmt(kdv.odenecek)}`
    : `Devreden KDV: ${fmt(-kdv.odenecek)} (ödeme çıkmıyor)`;
  const reply =
    `KDV — ${ad}\n${kdv.donemLabel}\n\n` +
    `• Hesaplanan (391): ${fmt(kdv.hesaplanan)}\n` +
    `• İndirilecek (191): ${fmt(kdv.indirilecek)}\n` +
    `────────────\n${sonuc}`;
  return { reply, mukellef: ad };
}

// ============================================================================
// TEK-MÜKELLEF (genel) — borç/cari, beyanname durumu, gelir tablosu. TEK resolve
// + tip dispatch. KDV ayrı (buildOwnerSingleTaxpayerKdvReply) kalıyor; bu onun
// kapsamadığı tek-mükellef veri tiplerini şablonla anında verir.
// ============================================================================

const TL2 = (x: number) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x || 0) + ' ₺';
const donemOku = (d: string) => {
  const m = String(d || '').match(/^(\d{4})[\/-](\d{2})$/);
  if (m) return `${KDV_AYLAR[parseInt(m[2], 10) - 1]} ${m[1]}`;
  const q = String(d || '').match(/^(\d{4})[\/-]?Q([1-4])$/i);
  if (q) return `${q[1]} ${q[2]}. dönem`;
  return d;
};

export async function buildOwnerSingleTaxpayerReply(
  prisma: any, tenantId: string, text: string,
): Promise<{ reply: string; mukellef: string } | null> {
  const n = normalizeForIntent(text);
  if (/(kim|kimler|kimlere|liste|listele|herkes|hangi mukellef)/.test(n)) return null; // portföy
  let kind = '';
  // ISLETME HESAP OZETI en basta: "hesap ozeti" ifadesi asagidaki gelir/borc
  // kaliplarina kaciyordu ve owner "isletme hesap ozetini gonder" deyince istek
  // BELGE gonderme akisina dusup alakasiz evraklar listeleniyordu (canli olay 06:34).
  if (/(isletme hesap ozet|isletme ozet|hesap ozet|\biho\b|ihö)/.test(n)) kind = 'iho';
  else if (/mizan/.test(n)) kind = 'mizan';
  else if (/(borc|cari|bakiye|alacak)/.test(n)) kind = 'borc';
  // "kar zarar ozeti" de gelir tablosudur — eskiden taninmiyor, istek BELGE akisina
  // dusup "Gelir PDF'i bulamadim" cevabi doniyordu (canli olay 06:37).
  else if (/(gelir tablo|kar ?zarar|kar-zarar|ciro|hasilat|net satis|kar(?!\w)|kazanc|karli)/.test(n)) kind = 'gelir';
  // "ne kadar vergi odedi/cikti", "vergisi ne kadar", "tahakkuku ne" → beyanname/tahakkuk dali.
  else if (/(beyanname|beyan(?!\w)|verildi mi|verildi mı|tahakkuk|vergi (odedi|odemis|cikti|ciktı)|ne kadar vergi|vergisi ne)/.test(n)) kind = 'beyanname';
  else return null;

  const taxpayers = await prisma.taxpayer.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, companyName: true, firstName: true, lastName: true },
  }).catch(() => []);
  const t = resolveTaxpayerByText(taxpayers, text);
  if (!t) return null; // belirsiz/ad yok agentic
  const ad = (t.companyName || `${t.firstName || ''} ${t.lastName || ''}`).trim();

  if (kind === 'mizan') {
    const m = await prisma.mizan.findFirst({
      where: { tenantId, taxpayerId: t.id },
      orderBy: [{ donem: 'desc' }, { createdAt: 'desc' }],
      include: { hesaplar: { select: { borcToplami: true, alacakToplami: true } }, anomaliler: { select: { id: true } } },
    }).catch(() => null);
    if (!m) return { reply: `${ad} için yüklenmiş mizan bulamadım.`, mukellef: ad };
    const tBorc = (m.hesaplar || []).reduce((s: number, h: any) => s + (Number(h.borcToplami) || 0), 0);
    const tAlacak = (m.hesaplar || []).reduce((s: number, h: any) => s + (Number(h.alacakToplami) || 0), 0);
    const fark = Math.abs(tBorc - tAlacak);
    const denge = fark < 1 ? 'Tutarlı' : `${TL2(fark)} fark`;
    const anomali = (m.anomaliler || []).length;
    const reply =
      `MİZAN — ${ad}\n${donemOku(m.donem)}\n\n` +
      `• Toplam Borç: ${TL2(tBorc)}\n` +
      `• Toplam Alacak: ${TL2(tAlacak)}\n` +
      `• Denge: ${denge}\n` +
      `• Hesap sayısı: ${(m.hesaplar || []).length}` +
      (anomali ? `\n• Anomali: ${anomali} adet` : '');
    return { reply, mukellef: ad };
  }

  if (kind === 'borc') {
    const rows = await prisma.cariHareket.findMany({ where: { tenantId, taxpayerId: t.id }, select: { tip: true, tutar: true } }).catch(() => []);
    let bakiye = 0;
    for (const h of rows) {
      if (h.tip === 'TAHAKKUK') bakiye += Number(h.tutar) || 0;
      else if (h.tip === 'TAHSILAT') bakiye -= Number(h.tutar) || 0;
    }
    const reply = bakiye > 0
      ? `CARİ DURUM — ${ad}\n\n• Açık bakiye (borç): ${TL2(bakiye)}\n\n(Tahsil edilince kapanır.)`
      : bakiye < 0
        ? `CARİ DURUM — ${ad}\n\n• Alacaklı bakiye: ${TL2(-bakiye)} (fazla ödeme)`
        : `CARİ DURUM — ${ad}\n\nAçık borcu yok, bakiye sıfır. `;
    return { reply, mukellef: ad };
  }

  if (kind === 'iho') {
    // Istenen donem(ler): "2026 1. ve 2. donem" -> yil 2026, donemler [1,2].
    const yilM = text.match(/\b(20\d{2})\b/);
    const yil = yilM ? Number(yilM[1]) : new Date().getFullYear();
    // "2026 1. ve 2. donem" -> [1,2]. Tek regex yalniz "2. donem"i yakaliyordu ("1. ve"
    // dogrudan 'donem' ile bitisik olmadigi icin dusuyordu); canli denemede 1. donem
    // eksik geldi. Once "donem" gecen cumledeki TUM sira sayilarini topla.
    const nText = normalizeForIntent(text);
    const donemler: number[] = [];
    if (/donem/.test(nText)) {
      const bolge = nText.slice(0, nText.lastIndexOf('donem') + 5);
      for (const m of bolge.matchAll(/\b([1-4])\s*\./g)) {
        const d = Number(m[1]);
        if (d >= 1 && d <= 4 && !donemler.includes(d)) donemler.push(d);
      }
      if (!donemler.length) {
        for (const m of bolge.matchAll(/\b([1-4])\s*\.?\s*donem/g)) {
          const d = Number(m[1]);
          if (d >= 1 && d <= 4 && !donemler.includes(d)) donemler.push(d);
        }
      }
    }
    donemler.sort((a, b) => a - b);
    const kayitlar = await prisma.isletmeHesapOzeti.findMany({
      where: { tenantId, taxpayerId: t.id, yil, ...(donemler.length ? { donem: { in: donemler } } : {}) },
      orderBy: [{ donem: 'asc' }],
    }).catch(() => []);
    if (!kayitlar.length) {
      const dLabel = donemler.length ? donemler.map((d) => `${d}. dönem`).join(' ve ') : 'ilgili dönem';
      return { reply: `${ad} için ${yil} ${dLabel} işletme hesap özeti kaydı bulamadım.`, mukellef: ad };
    }
    const ARALIK: Record<number, string> = { 1: 'Ocak–Mart', 2: 'Nisan–Haziran', 3: 'Temmuz–Eylül', 4: 'Ekim–Aralık' };
    const bloklar = kayitlar.map((o: any) => {
      const satis = Number(o.satisHasilati) || 0;
      const digerGelir = Number(o.digerGelir) || 0;
      const smm = Number(o.satilanMalMaliyeti) || 0;
      const gider = Number(o.donemIciGiderler) || 0;
      const kar = Number(o.donemKari) || 0;
      const odenecek = Number(o.odenecekGecVergi) || 0;
      const satirlar = [
        `${o.donem}. dönem (${ARALIK[o.donem] || ''})`,
        `• Satışlar: ${TL2(satis)}`,
        ...(digerGelir > 0 ? [`• Diğer gelirler: ${TL2(digerGelir)}`] : []),
        ...(smm > 0 ? [`• Satılan malın maliyeti: ${TL2(smm)}`] : []),
        `• Giderler: ${TL2(gider)}`,
        kar >= 0 ? `• Dönem kârı: ${TL2(kar)}` : `• Dönem zararı: ${TL2(Math.abs(kar))}`,
        `• Ödenecek geçici vergi: ${TL2(odenecek)}`,
      ];
      return satirlar.join('\n');
    });
    const reply =
      `İŞLETME HESAP ÖZETİ — ${ad}\n${yil}\n\n` +
      bloklar.join('\n\n') +
      `\n\n(Tutarlar 1 Ocak ${yil} tarihinden dönem sonuna kadarki kümülatif toplamdır.)`;
    return { reply, mukellef: ad };
  }

  if (kind === 'gelir') {
    const g = await prisma.gelirTablosu.findFirst({ where: { tenantId, taxpayerId: t.id }, orderBy: [{ donem: 'desc' }, { createdAt: 'desc' }], select: { donem: true, netSatislar: true, brutSatislar: true, donemNetKari: true, satisMaliyeti: true } }).catch(() => null);
    if (!g) return { reply: `${ad} için gelir tablosu kaydı bulamadım.`, mukellef: ad };
    // Cizgi KALDIRILDI: "net satis − satis maliyeti = donem net kari" izlenimi veriyordu,
    // oysa aradaki faaliyet giderleri/diger gelir-gider satirlari yazilmiyor. Owner
    // cikarmayi elle yapip tutmadigini goruyordu (canli dokumde 3/3 ornek hatali,
    // birinde 8 kat sapma). Artik brut kar ACIKCA yaziliyor ve net karin neyi icerdigi
    // tek cumleyle soyleniyor.
    const netSatis = Number(g.netSatislar) || Number(g.brutSatislar) || 0;
    const maliyet = Number(g.satisMaliyeti) || 0;
    const reply =
      `GELİR TABLOSU — ${ad}\n${donemOku(g.donem)}\n\n` +
      `• Net satış (ciro): ${TL2(netSatis)}\n` +
      `• Satış maliyeti: ${TL2(maliyet)}\n` +
      `• Brüt kâr: ${TL2(netSatis - maliyet)}\n\n` +
      `• Dönem net kârı: ${TL2(Number(g.donemNetKari) || 0)}\n` +
      `  (faaliyet giderleri ve diğer gelir/giderler düşülmüş hâlidir — brüt kârdan farkı gider toplamıdır)`;
    return { reply, mukellef: ad };
  }

  // beyanname
  const bk = await prisma.beyanKaydi.findMany({
    where: { tenantId, taxpayerId: t.id },
    orderBy: [{ donem: 'desc' }, { beyanTarihi: 'desc' }],
    // 8 kayit YETMIYOR: "2026 1. donem" sorusunda ceyrek 4 dilime yayiliyor
    // (2026-Q1 + 2026-01/02/03) ve Ocak KDV'si listenin disinda kalip toplami
    // eksik gosteriyordu.
    take: 60,
    select: { beyanTipi: true, donem: true, tahakkukTutari: true, beyanTarihi: true },
  }).catch(() => []);
  if (!bk.length) return { reply: `${ad} için beyanname kaydı bulamadım.`, mukellef: ad };
  // ISTENEN DONEM SUZGECI. Eskiden HER ZAMAN en son donem gosteriliyordu; owner
  // "2026 1. donemde ne kadar vergi odedi" dediginde istedigi donem yok sayiliyordu.
  const ayEsleme = text.match(/\b(\d{4})-(\d{2})\b/);
  const ayAdi = ayEsleme ? '' : ayAdindanDonem(text);
  const istenenAy: string[] | null = ayEsleme ? [ayEsleme[0]] : (ayAdi ? [ayAdi] : null);
  const qm = text.match(/\b(\d{4})-Q([1-4])\b/i);
  const istenenCeyrek = ceyrekDonemOku(text) || (qm ? qm[0].toUpperCase() : '');
  let secilenler: any[] = bk;
  let donemEtiketi = '';
  let donemSorulmadi = false;
  if (istenenAy) {
    secilenler = bk.filter((b: any) => String(b.donem) === istenenAy[0]);
    donemEtiketi = donemOku(istenenAy[0]);
  } else if (istenenCeyrek) {
    const parca = istenenCeyrek.split('-Q');
    const yil = parca[0];
    const q = parca[1];
    const aylarHar: Record<string, string[]> = { '1': ['01', '02', '03'], '2': ['04', '05', '06'], '3': ['07', '08', '09'], '4': ['10', '11', '12'] };
    const aylar = aylarHar[q] || [];
    secilenler = bk.filter((b: any) => {
      const d = String(b.donem || '').toUpperCase();
      return d === `${yil}-Q${q}` || aylar.some((a) => d === `${yil}-${a}`);
    });
    donemEtiketi = `${yil} ${q}. dönem`;
  }
  if (!secilenler.length) {
    return { reply: `${ad} için ${donemEtiketi || 'istenen dönem'} beyanname/tahakkuk kaydı bulamadım.`, mukellef: ad };
  }
  if (!donemEtiketi) {
    // Donem belirtilmemis. Eskiden SADECE en son donem gosteriliyordu; "beyannameleri
    // verildi mi" sorusuna cogu zaman tek satir donuyordu (string siralamasinda
    // 2026-Q2 > 2026-06 oldugu icin aylik KDV'ler disarida kaliyordu).
    secilenler = secilenler
      .slice()
      .sort((a: any, b: any) => {
        const ta = a.beyanTarihi ? new Date(a.beyanTarihi).getTime() : 0;
        const tb = b.beyanTarihi ? new Date(b.beyanTarihi).getTime() : 0;
        return tb - ta;
      })
      .slice(0, 6);
    donemEtiketi = 'son beyannameler';
    donemSorulmadi = true;
  }
  // Ceyrek sorusunda ayni tipten birden cok satir olabiliyor (3 ayri KDV1); hangi
  // aya ait oldugu yazilmazsa satirlar ayirt edilemiyor.
  const cokDonem = new Set(secilenler.map((b: any) => String(b.donem))).size > 1;
  const satirlar = secilenler
    .slice()
    .sort((a: any, b: any) => String(a.donem).localeCompare(String(b.donem)))
    .map((b: any) => {
      const verildi = !!b.beyanTarihi;
      const tar = b.beyanTarihi ? ` (${new Date(b.beyanTarihi).toLocaleDateString('tr-TR')})` : '';
      const tah = b.tahakkukTutari != null ? ` · tahakkuk ${TL2(Number(b.tahakkukTutari))}` : '';
      const dilim = cokDonem ? ` ${donemOku(String(b.donem))}` : '';
      return `• ${b.beyanTipi}${dilim}: ${verildi ? 'VERİLDİ' : 'hazırlandı'}${tar}${tah}`;
    }).join('\n');
  const toplam = secilenler.reduce((a: number, b: any) => a + (Number(b.tahakkukTutari) || 0), 0);
  // Donem sorulmadiysa liste farkli donemlerden geliyor; toplamini yazmak yanlis
  // olur (birbirine karisik donemlerin toplami hicbir seyi ifade etmez).
  const toplamSatir = (toplam > 0 && !donemSorulmadi) ? `\n\nTOPLAM TAHAKKUK: ${TL2(toplam)}` : '';
  const reply = `BEYANNAME / TAHAKKUK — ${ad}\n${donemEtiketi}\n\n${satirlar}${toplamSatir}`;
  return { reply, mukellef: ad };
}

// ============================================================================
// İŞLENEN FATURA ADEDİ (portföy) — "bu ay kaç fatura işledik / fatura sayısı".
// mihsapInvoice.donem; "bu ay" belirsizliği işlenen dönem (önceki ay) + bu ay
// gelen NET etiketle gösterilir (bot eskiden "Haziran 0/henüz yok" diyordu).
// ============================================================================

export function detectInvoiceCountIntent(text: string): boolean {
  const n = normalizeForIntent(text);
  if (!/fatura/.test(n)) return false;
  // SADECE sayım/hacim sorusu (komut "fatura çek" DEĞİL).
  return /(kac fatura|fatura sayi|fatura adet|fatura adedi|fatura hacm|kac tane fatura|fatura isled|toplam fatura|fatura islend)/.test(n);
}

export async function buildOwnerInvoiceCountReply(
  prisma: any, tenantId: string, text: string,
): Promise<{ reply: string } | null> {
  if (!detectInvoiceCountIntent(text)) return null;
  // Tek-mükellef ("X'in kaç faturası") ise portföy sayımı DEĞİL agentic'e bırak.
  const txp = await prisma.taxpayer.findMany({ where: { tenantId, isActive: true }, select: { id: true, companyName: true, firstName: true, lastName: true } }).catch(() => []);
  if (resolveTaxpayerByText(txp, text)) return null;
  const pm = text.match(/\b(\d{4})-(\d{2})\b/);
  const now = new Date();
  const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const pd = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prev = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}`;
  const target = pm ? pm[0] : prev; // varsayılan: işlenen (önceki) dönem
  const [byTuru, curCount] = await Promise.all([
    prisma.mihsapInvoice.groupBy({ by: ['faturaTuru'], where: { tenantId, donem: target }, _count: { _all: true } }).catch(() => []),
    prisma.mihsapInvoice.count({ where: { tenantId, donem: cur } }).catch(() => 0),
  ]);
  let alis = 0, satis = 0;
  for (const r of byTuru) { if (/ALIS/i.test(String(r.faturaTuru))) alis += r._count._all; else satis += r._count._all; }
  const targetTotal = alis + satis;
  if (targetTotal === 0 && curCount === 0) {
    return { reply: 'Henüz işlenmiş fatura kaydı bulamadım.' };
  }
  const fmtN = (x: number) => new Intl.NumberFormat('tr-TR').format(x);
  const lines = [`İŞLENEN FATURA ADEDİ`, ''];
  if (targetTotal > 0) {
    lines.push(`${donemOku(target)} dönemi: *${fmtN(targetTotal)} fatura*`);
    lines.push(`   • Alış: ${fmtN(alis)} · Satış: ${fmtN(satis)}`);
  }
  if (!pm) lines.push(`${donemOku(cur)} (bu ay gelen): ${fmtN(curCount)}`);
  return { reply: lines.join('\n') };
}
