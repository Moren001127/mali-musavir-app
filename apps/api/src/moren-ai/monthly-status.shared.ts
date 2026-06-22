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
