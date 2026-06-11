import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MIHSAP_FATURA_ACTIONS, isMihsapFaturaCommandAgent } from '../agent-events/agent-registry';
import { randomBytes } from 'crypto';

const OFFICIAL_SOURCE_DOMAINS = [
  'gib.gov.tr',
  'sgk.gov.tr',
  'resmigazete.gov.tr',
  'mevzuat.gov.tr',
  'bedesten.adalet.gov.tr',
  'turkiye.gov.tr',
  'calisma.gov.tr',
  'ticaret.gov.tr',
  'kgk.gov.tr',
  'turmob.org.tr',
  'hmb.gov.tr',
  'tuik.gov.tr',
  'kvkk.gov.tr',
  'tcmb.gov.tr',
  'spk.gov.tr',
  'bddk.org.tr',
  'rekabet.gov.tr',
];

const WHATSAPP_AGENT_ACTIONS = [
  'owner_alert',
  'portal_message_preview',
  'portal_message_send',
  'document_send',
  'document_request',
  'conversation_reply',
  'conversation_start',
  'call_request',
];

/**
 * Moren AI tool'larının gerçek Prisma sorgularını çalıştıran servis.
 * Her tool için bir metod. Tenant izolasyonu MUTLAKA uygulanır.
 */
@Injectable()
export class ToolExecutorService {
  private readonly logger = new Logger(ToolExecutorService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Tool çağrısını execute eder. name + input → result (JSON-serializable).
   * Hata olursa { error } döner — AI bunu görüp yanıtı uyarır.
   */
  async execute(
    name: string,
    input: any,
    ctx: { tenantId: string; userId?: string | null; taxpayerId?: string | null },
  ): Promise<any> {
    try {
      switch (name) {
        case 'list_taxpayers':      return this.listTaxpayers(input, ctx);
        case 'get_taxpayer':        return this.getTaxpayer(input, ctx);
        case 'get_my_profile':      return this.getMyProfile(ctx);
        case 'get_my_work_status':  return this.getMyWorkStatus(input, ctx);
        case 'get_my_documents':    return this.getMyDocuments(input, ctx);
        case 'get_my_open_tasks':   return this.getMyOpenTasks(input, ctx);
        case 'get_my_recent_messages': return this.getMyRecentMessages(input, ctx);
        case 'get_my_kdv':          return this.getMyKdv(input, ctx);
        case 'get_my_invoices':     return this.getMyInvoices(input, ctx);
        case 'get_my_beyanname':    return this.getMyBeyanname(input, ctx);
        case 'get_my_balance':      return this.getMyBalance(input, ctx);
        case 'list_taxpayers_monthly_status': return this.listTaxpayersMonthlyStatus(input, ctx);
        case 'list_mizan_periods':  return this.listMizanPeriods(input, ctx);
        case 'get_mizan':           return this.getMizan(input, ctx);
        case 'get_gelir_tablosu':   return this.getGelirTablosu(input, ctx);
        case 'get_bilanco':         return this.getBilanco(input, ctx);
        case 'get_kdv_summary':     return this.getKdvSummary(input, ctx);
        case 'list_invoices':       return this.listInvoices(input, ctx);
        case 'get_payroll_summary': return this.getPayrollSummary(input, ctx);
        case 'list_sgk_declarations': return this.listSgkDeclarations(input, ctx);
        case 'list_documents':      return this.listDocuments(input, ctx);
        case 'get_tax_calendar':    return this.getTaxCalendar(input, ctx);
        case 'compare_periods':     return this.comparePeriods(input, ctx);
        case 'calculate_financial_ratios': return this.calculateFinancialRatios(input, ctx);
        case 'search_all':          return this.searchAll(input, ctx);
        // FAZ 1 — Yeni modül tool'ları
        case 'list_beyan_kayitlari':  return this.listBeyanKayitlari(input, ctx);
        case 'list_pending_decisions':return this.listPendingDecisions(input, ctx);
        case 'get_firma_hafizasi':    return this.getFirmaHafizasi(input, ctx);
        case 'list_araclar_hgs':      return this.listAraclarHgs(input, ctx);
        case 'get_beyanname_config':  return this.getBeyannameConfig(input, ctx);
        case 'get_beyan_ozet':        return this.getBeyanOzet(input, ctx);
        case 'get_agent_status':      return this.getAgentStatus(input, ctx);
        case 'get_system_health':     return this.getSystemHealth(input, ctx);
        case 'get_operation_briefing': return this.getOperationBriefing(input, ctx);
        case 'get_taxpayer_work_status': return this.getTaxpayerWorkStatus(input, ctx);
        case 'get_luca_agent_jobs':   return this.getLucaAgentJobs(input, ctx);
        case 'get_mihsap_agent_jobs': return this.getMihsapAgentJobs(input, ctx);
        case 'preview_agent_command': return this.previewAgentCommand(input, ctx);
        case 'create_confirmed_agent_command': return this.createAgentCommand(input, ctx);
        case 'get_collection_risk_summary': return this.getCollectionRiskSummary(input, ctx);
        case 'get_beyanname_readiness_summary': return this.getBeyannameReadinessSummary(input, ctx);
        case 'get_portal_capability_map': return this.getPortalCapabilityMap();
        case 'research_official_sources': return this.researchOfficialSources(input, ctx);
        case 'search_ai_memory':      return this.searchAiMemory(input, ctx);
        case 'save_ai_memory':        return this.saveAiMemory(input, ctx);
        case 'create_agent_command':  return this.createAgentCommand(input, ctx);
        case 'get_ai_cost_summary':   return this.getAiCostSummary(input, ctx);
        default:
          return { error: `Bilinmeyen tool: ${name}` };
      }
    } catch (e: any) {
      this.logger.error(`Tool "${name}" hata: ${e?.message || e}`);
      return { error: `Tool çalıştırılamadı: ${e?.message || 'bilinmeyen hata'}` };
    }
  }

  // ------------------------------------------------------------
  // Yardımcılar
  // ------------------------------------------------------------
  private toNum(d: any): number {
    if (d === null || d === undefined) return 0;
    if (typeof d === 'number') return d;
    if (typeof d === 'string') return parseFloat(d) || 0;
    // Prisma Decimal
    if (typeof d.toNumber === 'function') return d.toNumber();
    if (typeof d.toString === 'function') return parseFloat(d.toString()) || 0;
    return 0;
  }

  private displayName(t: { companyName?: string | null; firstName?: string | null; lastName?: string | null }) {
    if (t.companyName) return t.companyName;
    return `${t.firstName || ''} ${t.lastName || ''}`.trim() || '(isimsiz)';
  }

  /** Türk para formatı: 1.234.567,89 ₺ (WhatsApp şablon blokları için). */
  private fmtTL(n: number): string {
    const v = Number.isFinite(n) ? n : 0;
    return `${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
  }

  /** Oran yüzdesi " (%12,3)"; payda 0 ise boş. */
  private pct(pay: number, payda: number): string {
    if (!payda) return '';
    return ` (%${((pay / payda) * 100).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })})`;
  }

  private async scopedTaxpayer(ctx: { tenantId: string; taxpayerId?: string | null }) {
    if (!ctx.taxpayerId) return null;
    return this.prisma.taxpayer.findFirst({
      where: { id: ctx.taxpayerId, tenantId: ctx.tenantId },
      select: {
        id: true,
        type: true,
        companyName: true,
        firstName: true,
        lastName: true,
        taxNumber: true,
        taxOffice: true,
        isActive: true,
      },
    });
  }

  private async getMyProfile(ctx: { tenantId: string; taxpayerId?: string | null }) {
    const taxpayer = await this.scopedTaxpayer(ctx);
    if (!taxpayer) return { error: 'Aktif mukellef baglami yok.' };
    return {
      id: taxpayer.id,
      ad: this.displayName(taxpayer),
      tip: taxpayer.type,
      vkn: taxpayer.taxNumber,
      vergiDairesi: taxpayer.taxOffice,
      aktif: taxpayer.isActive,
    };
  }

  private async getMyWorkStatus(input: any, ctx: { tenantId: string; taxpayerId?: string | null }) {
    const taxpayer = await this.scopedTaxpayer(ctx);
    if (!taxpayer) return { error: 'Aktif mukellef baglami yok.' };
    return this.getTaxpayerWorkStatus({ ...input, taxpayerId: taxpayer.id }, ctx);
  }

  private async getMyDocuments(input: any, ctx: { tenantId: string; taxpayerId?: string | null }) {
    const taxpayer = await this.scopedTaxpayer(ctx);
    if (!taxpayer) return { error: 'Aktif mukellef baglami yok.' };
    const limit = Math.min(Math.max(Number(input?.limit) || 10, 1), 20);
    const docs = await this.prisma.document.findMany({
      where: { taxpayerId: taxpayer.id, isDeleted: false },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        category: true,
        mimeType: true,
        sizeBytes: true,
        updatedAt: true,
      },
    });
    return {
      count: docs.length,
      documents: docs.map((d) => ({
        id: d.id,
        baslik: d.title,
        kategori: d.category,
        mimeType: d.mimeType,
        boyutKb: Math.round((d.sizeBytes || 0) / 1024),
        tarih: d.updatedAt.toISOString().slice(0, 10),
      })),
    };
  }

  private async getMyOpenTasks(input: any, ctx: { tenantId: string; taxpayerId?: string | null }) {
    const taxpayer = await this.scopedTaxpayer(ctx);
    if (!taxpayer) return { error: 'Aktif mukellef baglami yok.' };
    const limit = Math.min(Math.max(Number(input?.limit) || 8, 1), 20);
    const reminders = await this.prisma.taskReminder.findMany({
      where: { taxpayerId: taxpayer.id, isCompleted: false },
      orderBy: { dueDate: 'asc' },
      take: limit,
      select: { id: true, title: true, description: true, dueDate: true },
    });
    return {
      count: reminders.length,
      tasks: reminders.map((task) => ({
        id: task.id,
        baslik: task.title,
        aciklama: task.description,
        tarih: task.dueDate?.toISOString().slice(0, 10),
      })),
    };
  }

  private async getMyRecentMessages(input: any, ctx: { tenantId: string; taxpayerId?: string | null }) {
    const taxpayer = await this.scopedTaxpayer(ctx);
    if (!taxpayer) return { error: 'Aktif mukellef baglami yok.' };
    const limit = Math.min(Math.max(Number(input?.limit) || 8, 1), 20);
    const logs = await this.prisma.communicationLog.findMany({
      where: { taxpayerId: taxpayer.id, channel: 'WHATSAPP' },
      orderBy: { occurredAt: 'desc' },
      take: limit,
      select: { id: true, subject: true, content: true, occurredAt: true },
    });
    return {
      count: logs.length,
      messages: logs.reverse().map((log) => ({
        id: log.id,
        direction: /gelen/i.test(log.subject || '') ? 'incoming' : 'outgoing',
        text: String(log.content || '')
          .replace(/\[\[document:([^|\]]+)\|([^\]]+)\]\]/g, '[dosya: $2]')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 500),
        occurredAt: log.occurredAt,
      })),
    };
  }

  // ------------------------------------------------------------
  // FAZ 1 — Mükellefe-KİLİTLİ WhatsApp veri tool'ları (taxpayer-readonly)
  // Hepsi scopedTaxpayer(ctx) ile aktif mükellefe sabitlenir; input'taki
  // taxpayerId/mükellef hedefi YOK SAYILIR → başka mükellefin verisi okunamaz.
  // ------------------------------------------------------------
  private async getMyKdv(input: any, ctx: { tenantId: string; taxpayerId?: string | null }) {
    const taxpayer = await this.scopedTaxpayer(ctx);
    if (!taxpayer) return { error: 'Aktif mukellef baglami yok.' };
    const requested = String(input?.donem || input?.period || '').trim();
    const explicit = /^\d{4}-\d{2}$/.test(requested);

    // En son KDV kontrol dönemini bul (periodLabel "YYYY/MM" formatında).
    const latest = await (this.prisma as any).kdvControlSession.findFirst({
      where: { tenantId: ctx.tenantId, taxpayerId: taxpayer.id },
      orderBy: { createdAt: 'desc' },
      select: { periodLabel: true },
    }).catch(() => null);
    const latestDonem = latest?.periodLabel ? String(latest.periodLabel).replace('/', '-') : null;

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    // Açık dönem verildiyse onu; yoksa en son kayıtlı dönemi; o da yoksa güncel ayı kullan.
    const donem = explicit ? requested : (latestDonem || currentMonth);
    const res: any = await this.getKdvSummary({ taxpayerId: taxpayer.id, donem }, ctx);

    // İstenen dönemde kayıt yoksa en son döneme düş, müşteriye hangi dönem olduğunu belirt.
    if (res?.error && latestDonem && latestDonem !== donem) {
      const fallback: any = await this.getKdvSummary({ taxpayerId: taxpayer.id, donem: latestDonem }, ctx);
      if (!fallback?.error) {
        return { ...fallback, not: `${donem} icin KDV kontrol kaydi yok; en son ${latestDonem} donemi gosteriliyor.` };
      }
    }
    return res;
  }

  private async getMyInvoices(input: any, ctx: { tenantId: string; taxpayerId?: string | null }) {
    const taxpayer = await this.scopedTaxpayer(ctx);
    if (!taxpayer) return { error: 'Aktif mukellef baglami yok.' };
    // taxpayerId sabitlenir; mükellef adı/arama alanları temizlenir ki başka
    // mükellefe çözümlenmesin. Karşı-firma filtresi (counterpartySearch) kalır.
    return this.listModuleInvoices({
      donem: input?.donem,
      period: input?.period,
      type: input?.type,
      faturaTuru: input?.faturaTuru,
      source: input?.source,
      counterpartySearch: input?.counterpartySearch || input?.firma || input?.firmaSearch,
      startDate: input?.startDate,
      endDate: input?.endDate,
      minAmount: input?.minAmount,
      maxAmount: input?.maxAmount,
      limit: Math.min(Number(input?.limit) || 20, 50),
      taxpayerId: taxpayer.id,
    }, ctx);
  }

  private async getMyBeyanname(input: any, ctx: { tenantId: string; taxpayerId?: string | null }) {
    const taxpayer = await this.scopedTaxpayer(ctx);
    if (!taxpayer) return { error: 'Aktif mukellef baglami yok.' };
    const donem = String(input?.donem || input?.period || '').trim();
    const where: any = { tenantId: ctx.tenantId, taxpayerId: taxpayer.id };
    if (/^\d{4}-\d{2}$/.test(donem)) where.donem = donem;
    const kayitlar = await (this.prisma as any).beyanKaydi.findMany({
      where,
      orderBy: [{ donem: 'desc' }],
      take: 20,
      // tahakkukTutari/beyannameUrl sadece "verildi" hesabı için çekilir, çıktıda PAYLAŞILMAZ.
      select: { beyanTipi: true, donem: true, onayNo: true, beyanTarihi: true, beyannameUrl: true, tahakkukTutari: true, createdAt: true },
    }).catch(() => []);
    return {
      adet: kayitlar.length,
      // POLİTİKA: Ödenecek/tahakkuk tutarı burada PAYLAŞILMAZ (müşavir kesinleştirir).
      tutarPolitikasi: 'Odenecek/tahakkuk tutarini musteriye verme; "musavirimiz kesinlestirince iletir" de.',
      durumNotu: 'durum=verildi ise beyanname GİB\'e verilmiştir; onayNo boş olması "verilmedi" anlamına GELMEZ.',
      kayitlar: (kayitlar || []).map((k: any) => {
        const verildi = Boolean(k.beyanTarihi || k.onayNo || k.beyannameUrl || k.tahakkukTutari);
        return {
          beyanTipi: k.beyanTipi,
          donem: k.donem,
          durum: verildi ? 'verildi' : 'hazirlanmis',
          // Hüküm cümlesi hazır — model kendi çıkarımıyla "verilmemiş" demesin.
          durumAciklama: verildi
            ? 'VERİLDİ — beyanname GİB\'e sunulmuştur'
            : 'hazırlık aşamasında — henüz verildiğine dair kayıt yok',
          beyanTarihi: k.beyanTarihi ? k.beyanTarihi.toISOString().slice(0, 10) : null,
          kayitTarihi: k.createdAt?.toISOString?.().slice(0, 10),
        };
      }),
    };
  }

  private async getMyBalance(_input: any, ctx: { tenantId: string; taxpayerId?: string | null }) {
    const taxpayer = await this.scopedTaxpayer(ctx);
    if (!taxpayer) return { error: 'Aktif mukellef baglami yok.' };
    const cariClient = (this.prisma as any).cariHareket;
    const [sonHareketler, tumHareketler] = await Promise.all([
      cariClient.findMany({
        where: { tenantId: ctx.tenantId, taxpayerId: taxpayer.id },
        orderBy: { tarih: 'desc' },
        take: 12,
        select: { tarih: true, tip: true, tutar: true, aciklama: true, odemeYontemi: true },
      }).catch(() => []),
      cariClient.findMany({
        where: { tenantId: ctx.tenantId, taxpayerId: taxpayer.id },
        select: { tip: true, tutar: true },
      }).catch(() => []),
    ]);
    const bakiye = (tumHareketler || []).reduce((sum: number, r: any) => {
      const t = this.toNum(r.tutar);
      if (r.tip === 'TAHAKKUK') return sum + t;
      if (r.tip === 'TAHSILAT') return sum - t;
      return sum;
    }, 0);
    return {
      acikBakiye: bakiye > 0 ? bakiye : 0,
      bakiyeAciklama: bakiye > 0 ? `${bakiye} TL acik bakiye gorunuyor` : 'Acik borc gorunmuyor',
      sonHareketler: (sonHareketler || []).map((r: any) => ({
        tarih: r.tarih?.toISOString?.().slice(0, 10),
        tip: r.tip,
        tutar: this.toNum(r.tutar),
        aciklama: r.aciklama,
        odemeYontemi: r.odemeYontemi,
      })),
    };
  }

  private normalizeSearchText(value: any): string {
    return String(value || '')
      .toLocaleLowerCase('tr-TR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ı/g, 'i')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private taxpayerSearchWhere(search: string) {
    const tokens = String(search || '').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return undefined;
    return {
      AND: tokens.map((token) => ({
        OR: [
          { companyName: { contains: token, mode: 'insensitive' } },
          { firstName: { contains: token, mode: 'insensitive' } },
          { lastName: { contains: token, mode: 'insensitive' } },
          { taxNumber: { contains: token } },
        ],
      })),
    };
  }

  private filterTaxpayerCandidates(rows: any[], search: string) {
    const tokens = this.normalizeSearchText(search).split(' ').filter(Boolean);
    if (!tokens.length) return rows;
    return rows
      .filter((t) => {
        const text = this.normalizeSearchText(
          `${this.displayName(t)} ${t.taxNumber || ''} ${t.taxOffice || ''}`,
        );
        return tokens.every((token) => text.includes(token));
      })
      .sort((a, b) => {
        const q = this.normalizeSearchText(search);
        const an = this.normalizeSearchText(this.displayName(a));
        const bn = this.normalizeSearchText(this.displayName(b));
        const as = an === q ? 3 : an.includes(q) ? 2 : 1;
        const bs = bn === q ? 3 : bn.includes(q) ? 2 : 1;
        return bs - as;
      });
  }

  /** İki kelime arası düzenleme (Levenshtein) mesafesi — yazım hatası toleransı için. */
  private levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const prev = new Array(b.length + 1);
    const curr = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 0; i < a.length; i++) {
      curr[0] = i + 1;
      for (let j = 0; j < b.length; j++) {
        const cost = a[i] === b[j] ? 0 : 1;
        curr[j + 1] = Math.min(prev[j + 1] + 1, curr[j] + 1, prev[j] + cost);
      }
      for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
    }
    return prev[b.length];
  }

  /** İki kelime arası benzerlik (0..1): tam/kısmi içerme yüksek, değilse edit-distance oranı. */
  private tokenSim(st: string, ct: string): number {
    if (!st || !ct) return 0;
    if (ct.includes(st) || st.includes(ct)) {
      return Math.max(0.85, Math.min(st.length, ct.length) / Math.max(st.length, ct.length));
    }
    return 1 - this.levenshtein(st, ct) / Math.max(st.length, ct.length);
  }

  // Çok yaygın hukuki/genel ek kelimeler — tek başına bir eşleşmeyi SÜRÜKLEMEMELİ
  // (ör. "gıda", "ticaret" birçok unvanda var). Ayırt edici kelime varsa bunlar elenir.
  private static readonly TAXPAYER_STOPWORDS = new Set([
    've', 'ltd', 'sti', 'limited', 'sirket', 'sirketi', 'as', 'anonim',
    'sanayi', 'ticaret', 'san', 'tic', 'dis', 'holding', 'grup',
  ]);

  /**
   * Substring araması boş dönünce SON çare: yazım-hatası toleranslı bulanık eşleştirme.
   * GÜVENLİK: HER ayırt edici (stopword olmayan) arama kelimesi adayda GÜÇLÜ eşleşmeli
   * (min token benzerliği >= minToken). Böylece "gito gıda" araması, ortak "gıda" kelimesi
   * yüzünden "Yılmaz Göktaş Gıda"ya YANLIŞ eşleşmez — yalnız ayırt edici "gito" tutarsa eşleşir.
   * "Ditekt"→"Direkt" (0,83) gibi gerçek yazım hatalarını yakalamaya devam eder.
   */
  private fuzzyTaxpayerCandidates(rows: any[], search: string, minToken = 0.8) {
    const allTokens = this.normalizeSearchText(search).split(' ').filter((t) => t.length >= 2);
    if (!allTokens.length) return [] as any[];
    const distinctive = allTokens.filter((t) => !ToolExecutorService.TAXPAYER_STOPWORDS.has(t));
    const useTokens = distinctive.length ? distinctive : allTokens;
    return rows
      .map((t) => {
        const candTokens = this.normalizeSearchText(`${this.displayName(t)} ${t.taxNumber || ''}`)
          .split(' ')
          .filter(Boolean);
        const sims = useTokens.map((st) => Math.max(0, ...candTokens.map((ct) => this.tokenSim(st, ct))));
        const minSim = sims.length ? Math.min(...sims) : 0;
        const avgSim = sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : 0;
        return { t, minSim, avgSim };
      })
      .filter((s) => s.minSim >= minToken)
      .sort((a, b) => b.avgSim - a.avgSim)
      .map((s) => s.t);
  }

  private parseMonthPeriod(input: any): string | undefined {
    const raw = String(input?.period || input?.donem || input?.ay || input?.month || '').trim();
    if (!raw) return undefined;
    const exact = raw.match(/\b(\d{4})-(0[1-9]|1[0-2])\b/);
    if (exact) return exact[0];

    const normalized = this.normalizeSearchText(raw);
    const months: Record<string, number> = {
      ocak: 1,
      subat: 2,
      mart: 3,
      nisan: 4,
      mayis: 5,
      haziran: 6,
      temmuz: 7,
      agustos: 8,
      eylul: 9,
      ekim: 10,
      kasim: 11,
      aralik: 12,
    };
    const monthName = Object.keys(months).find((name) => normalized.includes(name));
    if (!monthName) return undefined;
    const yearMatch = raw.match(/\b(20\d{2}|19\d{2})\b/);
    const year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();
    return `${year}-${String(months[monthName]).padStart(2, '0')}`;
  }

  private financialPeriodCandidates(donem: any): string[] {
    const raw = String(donem || '').trim();
    if (!raw) return [];
    const out = new Set<string>([raw]);

    const quarter = raw.match(/^(\d{4})-?Q([1-4])$/i);
    if (quarter) {
      out.add(`${quarter[1]}-${String(Number(quarter[2]) * 3).padStart(2, '0')}`);
      out.add(`${quarter[1]}-Q${quarter[2]}`);
    }

    const monthly = raw.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    if (monthly) {
      const month = Number(monthly[2]);
      if ([3, 6, 9, 12].includes(month)) out.add(`${monthly[1]}-Q${month / 3}`);
    }

    return Array.from(out);
  }

  private async resolveTaxpayerFromInput(input: any, ctx: { tenantId: string }) {
    const taxpayerId = input?.taxpayerId || input?.mukellefId;
    const select = {
      id: true,
      type: true,
      companyName: true,
      firstName: true,
      lastName: true,
      taxNumber: true,
      taxOffice: true,
      mihsapId: true,
      isActive: true,
    };

    if (taxpayerId) {
      return this.prisma.taxpayer.findFirst({
        where: { id: taxpayerId, tenantId: ctx.tenantId },
        select,
      });
    }

    const search = String(
      input?.taxpayerName || input?.mukellefName || input?.mukellef || input?.search || '',
    ).trim();
    if (!search) return null;

    const where: any = { tenantId: ctx.tenantId };
    const searchWhere = this.taxpayerSearchWhere(search);
    if (searchWhere) Object.assign(where, searchWhere);

    let candidates = await this.prisma.taxpayer.findMany({
      where,
      take: 10,
      orderBy: { updatedAt: 'desc' },
      select,
    });

    if (!candidates.length) {
      const fallback = await this.prisma.taxpayer.findMany({
        where: { tenantId: ctx.tenantId },
        take: 750,
        orderBy: { updatedAt: 'desc' },
        select,
      });
      candidates = this.filterTaxpayerCandidates(fallback, search);
      if (!candidates.length) {
        // Substring de bulamadı → yazım-hatası toleranslı bulanık eşleştirme.
        // (Geri-alınamaz işlemler preview + ONAYLIYORUM ile korunur; sahip yanlışı görür.)
        candidates = this.fuzzyTaxpayerCandidates(fallback, search);
      }
    }

    return candidates[0] || null;
  }

  private currentPeriod(input?: any): { period: string; year: number; month: number } {
    const raw = String(input?.period || '').trim();
    const m = raw.match(/^(\d{4})-(\d{2})$/);
    if (m) return { period: raw, year: Number(m[1]), month: Number(m[2]) };
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    return { period: `${year}-${String(month).padStart(2, '0')}`, year, month };
  }

  private startOfDay(d = new Date()) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  private riskLevel(score: number) {
    if (score >= 80) return 'HAZIR';
    if (score >= 55) return 'EKSIK';
    return 'RISKLI';
  }

  private decodeHtml(input: string) {
    return String(input || '')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isAllowedOfficialUrl(rawUrl: string, allowedDomains = OFFICIAL_SOURCE_DOMAINS) {
    try {
      const url = new URL(rawUrl);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      return allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
    } catch {
      return false;
    }
  }

  private normalizeOfficialDomains(domains?: any): string[] {
    const raw = Array.isArray(domains) ? domains : [];
    const clean = raw
      .map((item) => String(item || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim())
      .filter(Boolean)
      .filter((domain) => OFFICIAL_SOURCE_DOMAINS.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`)));
    return clean.length ? [...new Set(clean)] : OFFICIAL_SOURCE_DOMAINS;
  }

  private async fetchText(url: string, timeoutMs = 12000): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 MOREN-AI/1.0',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
        },
      });
      if (!res.ok) return '';
      return await res.text();
    } catch {
      return '';
    } finally {
      clearTimeout(timer);
    }
  }

  private parseBingResults(html: string, allowedDomains: string[], limit: number) {
    const results: Array<{ title: string; url: string; snippet: string; domain: string }> = [];
    const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/gi) || [];
    for (const block of blocks) {
      const link = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!link) continue;
      const url = this.decodeHtml(link[1]);
      if (!this.isAllowedOfficialUrl(url, allowedDomains)) continue;
      const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      let domain = '';
      try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch {}
      results.push({
        title: this.decodeHtml(link[2]),
        url,
        domain,
        snippet: snippetMatch ? this.decodeHtml(snippetMatch[1]) : '',
      });
      if (results.length >= limit) break;
    }
    return results;
  }

  private readerUrl(rawUrl: string) {
    return `https://r.jina.ai/http://${rawUrl.replace(/^https?:\/\//, '')}`;
  }

  // ------------------------------------------------------------
  // MÜKELLEF
  // ------------------------------------------------------------
  private async listTaxpayers(input: any, ctx: { tenantId: string }) {
    const search = (input?.search || '').trim();
    const limit = Math.min(input?.limit || 20, 100);
    const onlyActive = input?.onlyActive !== false;

    const where: any = { tenantId: ctx.tenantId };
    if (onlyActive) where.isActive = true;
    if (search) {
      Object.assign(where, this.taxpayerSearchWhere(search));
    }

    let rows = await this.prisma.taxpayer.findMany({
      where,
      take: limit,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, type: true, companyName: true, firstName: true, lastName: true,
        taxNumber: true, taxOffice: true, startDate: true, endDate: true, isActive: true,
      },
    });

    let bulanikEslesme = false;
    if (search && rows.length === 0) {
      const fallback = await this.prisma.taxpayer.findMany({
        where: { tenantId: ctx.tenantId, ...(onlyActive ? { isActive: true } : {}) },
        take: 750,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true, type: true, companyName: true, firstName: true, lastName: true,
          taxNumber: true, taxOffice: true, startDate: true, endDate: true, isActive: true,
        },
      });
      rows = this.filterTaxpayerCandidates(fallback, search).slice(0, limit);
      if (rows.length === 0) {
        // Substring de bulamadı → yazım-hatası toleranslı bulanık eşleştirme ("Ditekt"→"Direkt").
        rows = this.fuzzyTaxpayerCandidates(fallback, search).slice(0, limit);
        bulanikEslesme = rows.length > 0;
      }
    }

    return {
      count: rows.length,
      ...(bulanikEslesme
        ? { bulanikEslesme: true, not: 'Tam eşleşme yok; yazılışa en yakın mükellef(ler) listelendi. İşlem yapmadan önce doğru mükellefi teyit et.' }
        : {}),
      taxpayers: rows.map((t) => ({
        id: t.id,
        isim: this.displayName(t),
        tip: t.type,
        vkn_tckn: t.taxNumber,
        vergiDairesi: t.taxOffice,
        baslangicTarihi: t.startDate?.toISOString().slice(0, 10),
        bitisTarihi: t.endDate?.toISOString().slice(0, 10),
        aktif: t.isActive,
      })),
    };
  }

  private async getTaxpayer(input: any, ctx: { tenantId: string }) {
    const t = await this.prisma.taxpayer.findFirst({
      where: { id: input.taxpayerId, tenantId: ctx.tenantId },
      include: {
        monthlyStatuses: {
          take: 6,
          orderBy: [{ year: 'desc' }, { month: 'desc' }],
        },
        contacts: true,
      },
    });
    if (!t) return { error: 'Mükellef bulunamadı' };

    return {
      id: t.id,
      isim: this.displayName(t),
      tip: t.type,
      vkn_tckn: t.taxNumber,
      vergiDairesi: t.taxOffice,
      email: t.email,
      telefon: t.phone,
      tumTelefonlar: t.phones,
      adres: t.address,
      notlar: t.notes,
      baslangicTarihi: t.startDate?.toISOString().slice(0, 10),
      bitisTarihi: t.endDate?.toISOString().slice(0, 10),
      evrakTeslimGunu: t.evrakTeslimGunu,
      whatsappEvrakTalep: t.whatsappEvrakTalep,
      whatsappEvrakGeldi: t.whatsappEvrakGeldi,
      sonHatirlatma: t.lastReminderSentAt?.toISOString().slice(0, 10),
      aktif: t.isActive,
      lucaSlug: t.lucaSlug,
      mihsapId: t.mihsapId,
      kontaklar: t.contacts.map((c) => ({
        ad: c.name, unvan: c.title, email: c.email, telefon: c.phone, birincil: c.isPrimary,
      })),
      sonAylikDurumlar: t.monthlyStatuses.map((s: any) => ({
        donem: `${s.year}-${String(s.month).padStart(2, '0')}`,
        evraklarGeldi: s.evraklarGeldi,
        evraklarIslendi: s.evraklarIslendi,
        kontrolEdildi: s.kontrolEdildi,
        beyannameVerildi: s.beyannameVerildi,
        kdvKontrolEdildi: s.kdvKontrolEdildi,
      })),
    };
  }

  /**
   * Tek cagri ile TUM mukelleflerin belirli bir aydaki durumunu doner.
   * "Bu ay evrak getirenler kimler" tarzi toplu sorulara cevap — get_taxpayer
   * ile 73 kez cagri yapmak yerine tek JOIN ile hepsini doker.
   */
  private async listTaxpayersMonthlyStatus(input: any, ctx: { tenantId: string }) {
    // Donem parse
    let year: number;
    let month: number;
    const period = (input?.period || '').trim();
    const m = period.match(/^(\d{4})-(\d{2})$/);
    if (m) {
      year = parseInt(m[1], 10);
      month = parseInt(m[2], 10);
    } else {
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth() + 1;
    }

    const evrakFilter = (input?.evrakDurumu || 'tumu') as string;
    const beyannameFilter = (input?.beyannameDurumu || 'tumu') as string;
    const onlyActive = input?.onlyActive !== false;

    // Tum mukellefleri + o aydaki durum kaydini JOIN ile cek.
    // Aylik durum kaydi yoksa null doner (henuz hicbir islem yapilmamis demektir).
    const whereTaxpayer: any = { tenantId: ctx.tenantId };
    if (onlyActive) whereTaxpayer.isActive = true;

    const taxpayers = await this.prisma.taxpayer.findMany({
      where: whereTaxpayer,
      select: {
        id: true, type: true, companyName: true, firstName: true, lastName: true,
        taxNumber: true, evrakTeslimGunu: true,
        monthlyStatuses: {
          where: { year, month },
          select: {
            evraklarGeldi: true,
            evraklarIslendi: true,
            kontrolEdildi: true,
            beyannameVerildi: true,
            kdvKontrolEdildi: true,
          },
          take: 1,
        },
      },
      orderBy: [{ companyName: 'asc' }, { firstName: 'asc' }],
    });

    // Satirlari hazirla
    let rows = taxpayers.map((t) => {
      const s = t.monthlyStatuses[0] || null;
      return {
        id: t.id,
        isim: this.displayName(t),
        vkn_tckn: t.taxNumber,
        tip: t.type,
        evrakTeslimGunu: t.evrakTeslimGunu,
        evraklarGeldi: s?.evraklarGeldi ?? false,
        evraklarIslendi: s?.evraklarIslendi ?? false,
        kontrolEdildi: s?.kontrolEdildi ?? false,
        beyannameVerildi: s?.beyannameVerildi ?? false,
        kdvKontrolEdildi: s?.kdvKontrolEdildi ?? false,
        // BEYANNAME HAZIR = kontrolü yapılmış AMA henüz verilmemiş = "beyannamesi verilebilecek".
        // (Aylık Takip ekranındaki "Beyanname hazır" sayacı bununla aynıdır.)
        beyannameHazir: (s?.kontrolEdildi ?? false) && !(s?.beyannameVerildi ?? false),
        kayitVar: !!s, // Bu ay icin durum kaydi olusturulmus mu
      };
    });

    // Filtre uygula
    if (evrakFilter === 'geldi') {
      rows = rows.filter((r) => r.evraklarGeldi === true);
    } else if (evrakFilter === 'gelmedi') {
      rows = rows.filter((r) => r.evraklarGeldi !== true);
    }
    if (beyannameFilter === 'verildi') {
      rows = rows.filter((r) => r.beyannameVerildi === true);
    } else if (beyannameFilter === 'verilmedi') {
      rows = rows.filter((r) => r.beyannameVerildi !== true);
    }

    const islemAyi = `${year}-${String(month).padStart(2, '0')}`;
    // İŞLEM ayı = faturaların İŞLENDİĞİ takvim ayı (örn. Haziran). Bu işlemlerin ait
    // olduğu VERİ dönemi = BEYANNAME dönemi = işlem ayı − 1 (örn. Mayıs). Mayıs'ın
    // faturaları Haziran'da işlenir. Owner/mükellef "dönem" derken Mayıs'ı kasteder.
    const byMonth = month === 1 ? 12 : month - 1;
    const byYear = month === 1 ? year - 1 : year;
    const beyannameDonem = `${byYear}-${String(byMonth).padStart(2, '0')}`;
    return {
      // Kullanıcıya-dönük dönem = BEYANNAME dönemi (veri dönemi). Bot bunu söylemeli.
      donem: beyannameDonem,
      beyannameDonem,
      islemAyi,
      donemNotu: `Bu evrak/işlem kayıtları İŞLEM ayı ${islemAyi}'de tutulur ama ait oldukları VERİ/beyanname dönemi ${beyannameDonem}'dir (işlem ayı−1). Owner'a/mükellefe dönemden bahsederken DAİMA beyanname dönemini (${beyannameDonem}) söyle; işlem ayını (${islemAyi}) SÖYLEME — "${islemAyi}'da evrak geldi" YANLIŞ/kafa karıştırıcı, doğrusu "${beyannameDonem} dönemi evrakı (${islemAyi}'da işlenir)".`,
      toplamMukellef: taxpayers.length,
      sonuc: rows.length,
      evrakFiltresi: evrakFilter,
      beyannameFiltresi: beyannameFilter,
      // "Beyannamesi verilebilecek" = kontrolü yapılmış, henüz verilmemiş = beyannameHazir.
      // Bu veri BURADADIR — "WhatsApp'tan çekemiyorum" DEME, aşağıdaki listeyi kullan.
      beyannameHazirSayisi: rows.filter((r) => r.beyannameHazir).length,
      beyannameHazirlar: rows.filter((r) => r.beyannameHazir).map((r) => r.isim).slice(0, 50),
      beyannameHazirNotu: 'beyannameHazirlar = beyannamesi verilebilecek (kontrolü bitmiş, verilmemiş) mükellefler. Bu listeyi doğrudan kullan; portala yönlendirme.',
      // beyannameVerildi = Aylık Takip'te ELLE işaretlenen ofis-içi kutudur.
      beyannameNotu: 'beyannameVerildi ofis içi takip kutusudur, GİB hükmü DEĞİLDİR. Beyannamenin gerçekten verilip verilmediği için list_beyan_kayitlari "durum" alanı esastır; çelişkide beyan kayıtları kazanır.',
      mukellefler: rows,
    };
  }

  // ------------------------------------------------------------
  // MİZAN
  // ------------------------------------------------------------
  private async listMizanPeriods(input: any, ctx: { tenantId: string }) {
    const mizanlar = await this.prisma.mizan.findMany({
      where: { tenantId: ctx.tenantId, taxpayerId: input.taxpayerId },
      select: {
        id: true, donem: true, donemTipi: true, status: true, locked: true,
        createdAt: true, kaynak: true,
      },
      orderBy: { donem: 'desc' },
    });
    return {
      count: mizanlar.length,
      periods: mizanlar.map((m) => ({
        id: m.id, donem: m.donem, tip: m.donemTipi, status: m.status,
        kaynak: m.kaynak, kilitli: m.locked,
        olusturmaTarihi: m.createdAt.toISOString().slice(0, 10),
      })),
    };
  }

  private async getMizan(input: any, ctx: { tenantId: string }) {
    const donemler = this.financialPeriodCandidates(input.donem);
    const mizan = await this.prisma.mizan.findFirst({
      where: { tenantId: ctx.tenantId, taxpayerId: input.taxpayerId, donem: donemler.length ? { in: donemler } : input.donem },
      include: {
        hesaplar: { orderBy: { hesapKodu: 'asc' } },
        anomaliler: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!mizan) return { error: `${input.donem} dönemine ait mizan bulunamadı` };

    let hesaplar = mizan.hesaplar;
    if (input?.hesapKoduFiltresi) {
      hesaplar = hesaplar.filter((h) => h.hesapKodu.startsWith(input.hesapKoduFiltresi));
    }

    const toplamBorc = hesaplar.reduce((s, h) => s + this.toNum(h.borcToplami), 0);
    const toplamAlacak = hesaplar.reduce((s, h) => s + this.toNum(h.alacakToplami), 0);

    const mizanDengeli = Math.abs(toplamBorc - toplamAlacak) < 1;
    const mizanWhatsappOzet = [
      `📒 MİZAN — ${mizan.donem}`,
      '',
      '💰 TOPLAMLAR',
      `• Toplam Borç: ${this.fmtTL(toplamBorc)}`,
      `• Toplam Alacak: ${this.fmtTL(toplamAlacak)}`,
      `• Denge: ${mizanDengeli ? '✅ Tutarlı' : `⚠️ ${this.fmtTL(Math.abs(toplamBorc - toplamAlacak))} fark`}`,
      `• Hesap Sayısı: ${hesaplar.length}`,
      ...(mizan.anomaliler.length ? [`• Anomali: ⚠️ ${mizan.anomaliler.length} adet`] : []),
    ].join('\n');

    return {
      donem: mizan.donem,
      donemTipi: mizan.donemTipi,
      kaynak: mizan.kaynak,
      status: mizan.status,
      kilitli: mizan.locked,
      // Hazır WhatsApp şablonu — bot bunu AYNEN gönderir, altına 1-2 cümle yorum ekler.
      whatsappOzet: mizanWhatsappOzet,
      toplamBorc,
      toplamAlacak,
      dengeliMi: Math.abs(toplamBorc - toplamAlacak) < 1,
      hesapSayisi: hesaplar.length,
      hesaplar: hesaplar.slice(0, 100).map((h) => ({
        hesapKodu: h.hesapKodu,
        hesapAdi: h.hesapAdi,
        borcToplami: this.toNum(h.borcToplami),
        alacakToplami: this.toNum(h.alacakToplami),
        borcBakiye: this.toNum(h.borcBakiye),
        alacakBakiye: this.toNum(h.alacakBakiye),
      })),
      hesapSayisiGosterilenMaksimum: hesaplar.length > 100 ? 100 : hesaplar.length,
      hesapSayisiToplam: hesaplar.length,
      anomaliler: mizan.anomaliler.map((a) => ({
        hesapKodu: a.hesapKodu, tip: a.tip, seviye: a.seviye, mesaj: a.mesaj,
      })),
    };
  }

  // ------------------------------------------------------------
  // GELİR TABLOSU
  // ------------------------------------------------------------
  private async getGelirTablosu(input: any, ctx: { tenantId: string }) {
    const donemler = this.financialPeriodCandidates(input.donem);
    const gt = await this.prisma.gelirTablosu.findFirst({
      where: { tenantId: ctx.tenantId, taxpayerId: input.taxpayerId, donem: donemler.length ? { in: donemler } : input.donem },
      orderBy: { createdAt: 'desc' },
    });
    if (!gt) return { error: `${input.donem} dönemine ait gelir tablosu bulunamadı` };

    const gtNs = this.toNum(gt.netSatislar);
    const gtWhatsappOzet = [
      `📈 GELİR TABLOSU — ${gt.donem}`,
      '',
      '💰 KALEMLER',
      `• Net Satışlar: ${this.fmtTL(gtNs)}`,
      `• Satış Maliyeti (SMM): ${this.fmtTL(this.toNum(gt.satisMaliyeti))}`,
      `• Brüt Satış Kârı: ${this.fmtTL(this.toNum(gt.brutSatisKari))}${this.pct(this.toNum(gt.brutSatisKari), gtNs)}`,
      `• Faaliyet Giderleri: ${this.fmtTL(this.toNum(gt.faaliyetGiderleri))}`,
      `• Faaliyet Kârı: ${this.fmtTL(this.toNum(gt.faaliyetKari))}${this.pct(this.toNum(gt.faaliyetKari), gtNs)}`,
      `• Dönem Net Kârı: ${this.fmtTL(this.toNum(gt.donemNetKari))}${this.pct(this.toNum(gt.donemNetKari), gtNs)}`,
    ].join('\n');

    return {
      donem: gt.donem,
      donemTipi: gt.donemTipi,
      donemBaslangic: gt.donemBaslangic?.toISOString().slice(0, 10),
      donemBitis: gt.donemBitis?.toISOString().slice(0, 10),
      kilitli: gt.locked,
      // Hazır WhatsApp şablonu — bot bunu AYNEN gönderir, altına 1-2 cümle yorum ekler.
      whatsappOzet: gtWhatsappOzet,
      kalemler: {
        brutSatislar: this.toNum(gt.brutSatislar),
        satisIndirimleri: this.toNum(gt.satisIndirimleri),
        netSatislar: this.toNum(gt.netSatislar),
        satisMaliyeti: this.toNum(gt.satisMaliyeti),
        brutSatisKari: this.toNum(gt.brutSatisKari),
        faaliyetGiderleri: this.toNum(gt.faaliyetGiderleri),
        faaliyetKari: this.toNum(gt.faaliyetKari),
        digerGelirler: this.toNum(gt.digerGelirler),
        digerGiderler: this.toNum(gt.digerGiderler),
        finansmanGiderleri: this.toNum(gt.finansmanGiderleri),
        olaganKar: this.toNum(gt.olaganKar),
        olaganDisiGelir: this.toNum(gt.olaganDisiGelir),
        olaganDisiGider: this.toNum(gt.olaganDisiGider),
        donemKari: this.toNum(gt.donemKari),
        vergiKarsiligi: this.toNum(gt.vergiKarsiligi),
        donemNetKari: this.toNum(gt.donemNetKari),
      },
      notlar: gt.notes,
    };
  }

  // ------------------------------------------------------------
  // BİLANÇO
  // ------------------------------------------------------------
  private async getBilanco(input: any, ctx: { tenantId: string }) {
    const donemler = this.financialPeriodCandidates(input.donem);
    const b = await this.prisma.bilanco.findFirst({
      where: { tenantId: ctx.tenantId, taxpayerId: input.taxpayerId, donem: donemler.length ? { in: donemler } : input.donem },
      orderBy: { createdAt: 'desc' },
    });
    if (!b) return { error: `${input.donem} dönemine ait bilanço bulunamadı` };

    const bWhatsappOzet = [
      `📊 BİLANÇO — ${b.donem}`,
      '',
      '🏦 AKTİF',
      `• Dönen Varlıklar: ${this.fmtTL(this.toNum(b.donenVarliklar))}`,
      `• Duran Varlıklar: ${this.fmtTL(this.toNum(b.duranVarliklar))}`,
      `• Aktif Toplamı: ${this.fmtTL(this.toNum(b.aktifToplami))}`,
      '',
      '📉 PASİF',
      `• KV Yabancı Kaynak: ${this.fmtTL(this.toNum(b.kvYabanciKaynak))}`,
      `• UV Yabancı Kaynak: ${this.fmtTL(this.toNum(b.uvYabanciKaynak))}`,
      `• Özkaynaklar: ${this.fmtTL(this.toNum(b.ozkaynaklar))}`,
    ].join('\n');

    return {
      donem: b.donem,
      donemTipi: b.donemTipi,
      tarih: b.tarih?.toISOString().slice(0, 10),
      kilitli: b.locked,
      // Hazır WhatsApp şablonu — bot bunu AYNEN gönderir, altına rasyo + 1-2 cümle yorum ekler.
      whatsappOzet: bWhatsappOzet,
      aktif: {
        donenVarliklar: this.toNum(b.donenVarliklar),
        duranVarliklar: this.toNum(b.duranVarliklar),
        aktifToplami: this.toNum(b.aktifToplami),
        detay: b.aktif,
      },
      pasif: {
        kvYabanciKaynak: this.toNum(b.kvYabanciKaynak),
        uvYabanciKaynak: this.toNum(b.uvYabanciKaynak),
        ozkaynaklar: this.toNum(b.ozkaynaklar),
        pasifToplami: this.toNum(b.pasifToplami),
        detay: b.pasif,
      },
      dengeliMi: Math.abs(this.toNum(b.aktifToplami) - this.toNum(b.pasifToplami)) < 1,
    };
  }

  // ------------------------------------------------------------
  // KDV
  // ------------------------------------------------------------
  private async getKdvSummary(input: any, ctx: { tenantId: string }) {
    // KdvControlOutput — arşiv tablosu, "YYYY-MM" formatında donem alanı var
    const outputs = await this.prisma.kdvControlOutput.findMany({
      where: {
        tenantId: ctx.tenantId,
        taxpayerId: input.taxpayerId,
        donem: input.donem,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Ayrıca canlı oturumları — periodLabel "YYYY/MM" formatı, dönüştür
    const periodLabel = input.donem?.replace('-', '/');
    const sessions = await this.prisma.kdvControlSession.findMany({
      where: {
        tenantId: ctx.tenantId,
        taxpayerId: input.taxpayerId,
        periodLabel,
      },
      include: {
        kdvRecords: { select: { kdvTutari: true } },
        images: { select: { id: true } },
        results: { select: { status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (sessions.length === 0 && outputs.length === 0) {
      return { error: `${input.donem} dönemine ait KDV kontrol kaydı bulunamadı` };
    }

    const liveSummary = sessions.map((s: any) => {
      const toplamKdv = s.kdvRecords.reduce((acc: number, r: any) => acc + this.toNum(r.kdvTutari), 0);
      const matched = s.results.filter((r: any) => r.status === 'MATCHED' || r.status === 'CONFIRMED').length;
      const partial = s.results.filter((r: any) => r.status === 'PARTIAL_MATCH' || r.status === 'NEEDS_REVIEW').length;
      const unmatched = s.results.filter((r: any) => r.status === 'UNMATCHED' || r.status === 'MISMATCH' || r.status === 'REJECTED').length;
      return {
        seansId: s.id,
        donem: s.periodLabel,
        tip: s.type,
        status: s.status,
        olusturma: s.createdAt.toISOString().slice(0, 10),
        lucaKayitSayisi: s.kdvRecords.length,
        faturaSayisi: s.images.length,
        lucaToplamKdv: toplamKdv,
        eslesen: matched,
        kismiEslesen: partial,
        eslesmeyen: unmatched,
      };
    });

    const outputSummary = outputs.map((o) => ({
      id: o.id,
      donem: o.donem,
      tip: o.tip,
      mukellef: o.mukellefName,
      tamEslesen: o.matchedCount,
      kismiEslesen: o.partialCount,
      eslesmeyen: o.unmatchedCount,
      toplamKayit: o.totalRecords,
      toplamFatura: o.totalImages,
      olusturma: o.createdAt.toISOString().slice(0, 10),
    }));

    // Hazır WhatsApp şablonu — en güncel kaynak (canlı seans > arşiv) üzerinden.
    const kdvRef: any = liveSummary[0] || outputSummary[0] || null;
    const kdvWhatsappOzet = kdvRef
      ? [
          `🧾 KDV KONTROL — ${kdvRef.donem}`,
          '',
          '📊 EŞLEŞME',
          `• Eşleşen: ${kdvRef.eslesen ?? kdvRef.tamEslesen ?? 0}`,
          `• Kısmi: ${kdvRef.kismiEslesen ?? 0}`,
          `• Eşleşmeyen: ${kdvRef.eslesmeyen ?? 0}`,
          ...(kdvRef.lucaToplamKdv != null ? [`• Luca Toplam KDV: ${this.fmtTL(this.toNum(kdvRef.lucaToplamKdv))}`] : []),
        ].join('\n')
      : undefined;

    return {
      // Bot bunu AYNEN gönderir, altına 1-2 cümle yorum ekler.
      ...(kdvWhatsappOzet ? { whatsappOzet: kdvWhatsappOzet } : {}),
      aktifSeanslar: liveSummary,
      arsivlenenlerden: outputSummary,
    };
  }

  // ------------------------------------------------------------
  // FATURALAR
  // ------------------------------------------------------------
  private async listInvoices(input: any, ctx: { tenantId: string }) {
    return this.listModuleInvoices(input, ctx);
  }

  private async listModuleInvoices(input: any, ctx: { tenantId: string }) {
    const taxpayer = await this.resolveTaxpayerFromInput(input, ctx);
    if (!taxpayer) {
      return {
        error: 'Mükellef bulunamadı',
        ipucu: 'taxpayerId veya taxpayerName/mukellefName gönder. Örn: { "taxpayerName": "Doğan Özkan", "period": "2026-04" }',
      };
    }

    const period = this.parseMonthPeriod(input);
    const type = String(input?.type || input?.faturaTuru || '').trim().toUpperCase();
    const source = String(input?.source || 'ISLENEN_FATURALAR').trim().toUpperCase();
    const counterpartySearch = String(
      input?.counterpartySearch || input?.firmaSearch || input?.firmaUnvan || input?.firma || input?.faturaNo || '',
    ).trim();
    const limit = Math.min(Number(input?.limit) || 50, 200);

    const dateFilter: any = {};
    if (input?.startDate) dateFilter.gte = new Date(input.startDate);
    if (input?.endDate) dateFilter.lte = new Date(input.endDate);

    const amountFilter: any = {};
    if (input?.minAmount !== undefined) amountFilter.gte = Number(input.minAmount);
    if (input?.maxAmount !== undefined) amountFilter.lte = Number(input.maxAmount);

    const mihsapWhere: any = { tenantId: ctx.tenantId, mukellefId: taxpayer.id };
    if (period) mihsapWhere.donem = period;
    if (type && type !== 'ARSIV') {
      mihsapWhere.faturaTuru = { contains: type, mode: 'insensitive' };
    }
    if (input?.belgeTuru) {
      mihsapWhere.belgeTuru = { contains: String(input.belgeTuru), mode: 'insensitive' };
    }
    if (Object.keys(dateFilter).length) mihsapWhere.faturaTarihi = dateFilter;
    if (Object.keys(amountFilter).length) mihsapWhere.toplamTutar = amountFilter;
    if (counterpartySearch) {
      mihsapWhere.OR = [
        { firmaUnvan: { contains: counterpartySearch, mode: 'insensitive' } },
        { firmaKimlikNo: { contains: counterpartySearch } },
        { faturaNo: { contains: counterpartySearch, mode: 'insensitive' } },
      ];
    }

    const mihsapClient = (this.prisma as any).mihsapInvoice;
    const [mihsapCount, mihsapGroups, mihsapRows] = await Promise.all([
      mihsapClient.count({ where: mihsapWhere }),
      mihsapClient.groupBy({
        by: ['faturaTuru'],
        where: mihsapWhere,
        _count: { _all: true },
        _sum: { toplamTutar: true },
      }),
      mihsapClient.findMany({
        where: mihsapWhere,
        take: limit,
        orderBy: [{ faturaTarihi: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);

    const includeMuhasebe = source === 'ALL' || source === 'MUHASEBE' || source === 'INVOICE';
    const includeEarsiv = source === 'ALL' || source === 'EARSIV' || source === 'EFATURA';

    const muhasebeWhere: any = {
      taxpayerId: taxpayer.id,
      ...(type ? { type } : {}),
      ...(input?.status ? { status: input.status } : {}),
      ...(Object.keys(dateFilter).length ? { issueDate: dateFilter } : {}),
      ...(Object.keys(amountFilter).length ? { totalAmount: amountFilter } : {}),
    };
    const muhasebeRows = includeMuhasebe ? await this.prisma.invoice.findMany({
      where: muhasebeWhere,
      take: Math.min(limit, 50),
      orderBy: { issueDate: 'desc' },
    }) : [];

    const earsivWhere: any = { tenantId: ctx.tenantId, taxpayerId: taxpayer.id };
    if (period) earsivWhere.donem = period;
    if (type === 'SATIS' || type === 'ALIS') earsivWhere.tip = type;
    if (Object.keys(dateFilter).length) earsivWhere.faturaTarihi = dateFilter;
    if (Object.keys(amountFilter).length) earsivWhere.toplamTutar = amountFilter;
    if (counterpartySearch) {
      earsivWhere.OR = [
        { satici: { contains: counterpartySearch, mode: 'insensitive' } },
        { saticiVergiNo: { contains: counterpartySearch } },
        { alici: { contains: counterpartySearch, mode: 'insensitive' } },
        { aliciVergiNo: { contains: counterpartySearch } },
        { faturaNo: { contains: counterpartySearch, mode: 'insensitive' } },
      ];
    }
    const earsivRows = includeEarsiv ? await (this.prisma as any).earsivFatura.findMany({
      where: earsivWhere,
      take: Math.min(limit, 50),
      orderBy: { faturaTarihi: 'desc' },
    }) : [];

    const toplamTutar = mihsapGroups.reduce(
      (sum: number, group: any) => sum + this.toNum(group?._sum?.toplamTutar),
      0,
    );

    return {
      modul: 'İşlenen Faturalar',
      kaynak: 'MihsapInvoice',
      filtre: {
        mukellef: this.displayName(taxpayer),
        mukellefId: taxpayer.id,
        vkn_tckn: taxpayer.taxNumber,
        donem: period || null,
        tip: type || null,
        karsiFirma: counterpartySearch || null,
      },
      count: mihsapCount,
      toplamTutar,
      ozet: mihsapGroups.map((group: any) => ({
        faturaTuru: group.faturaTuru,
        adet: group._count?._all || 0,
        toplamTutar: this.toNum(group._sum?.toplamTutar),
      })),
      invoices: mihsapRows.map((r: any) => ({
        id: r.id,
        kaynak: 'ISLENEN_FATURALAR',
        donem: r.donem,
        faturaNo: r.faturaNo,
        tip: r.faturaTuru,
        belgeTuru: r.belgeTuru,
        karsiFirma: r.firmaUnvan,
        karsiFirmaVknTckn: r.firmaKimlikNo,
        tarih: r.faturaTarihi?.toISOString?.().slice(0, 10),
        genelToplam: this.toNum(r.toplamTutar),
        durum: r.onayDurumu,
        dosyaVar: !!(r.storageKey || r.storageUrl || r.mihsapFileLink),
        indirildi: !!r.downloadedAt,
      })),
      digerKaynaklar: {
        muhasebeFaturalari: muhasebeRows.map((r) => ({
          id: r.id,
          kaynak: 'MUHASEBE',
          faturaNo: r.invoiceNo,
          tip: r.type,
          durum: r.status,
          tarih: r.issueDate.toISOString().slice(0, 10),
          genelToplam: this.toNum(r.totalAmount),
        })),
        eFaturaEArsiv: earsivRows.map((r: any) => ({
          id: r.id,
          kaynak: r.belgeKaynak,
          faturaNo: r.faturaNo,
          tip: r.tip,
          tarih: r.faturaTarihi?.toISOString?.().slice(0, 10),
          satici: r.satici,
          alici: r.alici,
          matrah: this.toNum(r.matrah),
          kdv: this.toNum(r.kdvTutari),
          genelToplam: this.toNum(r.toplamTutar),
        })),
      },
      not:
        mihsapCount > limit
          ? `İlk ${limit} kayıt döndü. Toplam ${mihsapCount} kayıt var; daha dar filtre istenebilir.`
          : undefined,
    };
  }

  // ------------------------------------------------------------
  // BORDRO / SGK
  // ------------------------------------------------------------
  private async getPayrollSummary(input: any, ctx: { tenantId: string }) {
    const t = await this.prisma.taxpayer.findFirst({
      where: { id: input.taxpayerId, tenantId: ctx.tenantId },
      select: { id: true },
    });
    if (!t) return { error: 'Mükellef bulunamadı' };

    const employees = await this.prisma.employee.findMany({
      where: { taxpayerId: input.taxpayerId },
      include: {
        payrollItems: input.year && input.month ? {
          where: {
            payrollPeriod: { periodYear: input.year, periodMonth: input.month },
          },
        } : { take: 1, orderBy: { createdAt: 'desc' } },
      },
    });

    const aktifSayi = employees.filter((e) => e.isActive).length;
    const toplamBrut = employees.reduce((s, e) => s + e.payrollItems.reduce((ps, p) => ps + this.toNum(p.grossSalary), 0), 0);
    const toplamNet = employees.reduce((s, e) => s + e.payrollItems.reduce((ps, p) => ps + this.toNum(p.netSalary), 0), 0);
    const toplamSgkIsci = employees.reduce((s, e) => s + e.payrollItems.reduce((ps, p) => ps + this.toNum(p.sgkWorkerShare), 0), 0);
    const toplamSgkIsveren = employees.reduce((s, e) => s + e.payrollItems.reduce((ps, p) => ps + this.toNum(p.sgkEmployerShare), 0), 0);
    const toplamStopaj = employees.reduce((s, e) => s + e.payrollItems.reduce((ps, p) => ps + this.toNum(p.incomeTax), 0), 0);
    const toplamDamga = employees.reduce((s, e) => s + e.payrollItems.reduce((ps, p) => ps + this.toNum(p.stampTax), 0), 0);

    return {
      donem: input.year && input.month ? `${input.year}-${String(input.month).padStart(2, '0')}` : 'En son dönem',
      toplamPersonel: employees.length,
      aktifPersonel: aktifSayi,
      toplamBrutMaas: toplamBrut,
      toplamNetMaas: toplamNet,
      toplamSgkIsci,
      toplamSgkIsveren,
      toplamStopaj,
      toplamDamga,
      toplamSgk: toplamSgkIsci + toplamSgkIsveren,
      personeller: employees.slice(0, 20).map((e) => ({
        id: e.id,
        adSoyad: `${e.firstName} ${e.lastName}`,
        unvan: e.jobTitle,
        brutMaas: this.toNum(e.grossSalary),
        iseBaslama: e.startDate.toISOString().slice(0, 10),
        ciksTarihi: e.endDate?.toISOString().slice(0, 10),
        aktif: e.isActive,
      })),
    };
  }

  private async listSgkDeclarations(input: any, ctx: { tenantId: string }) {
    // Mükellefin ofisine ait payrollPeriod'ları üzerinden git
    const t = await this.prisma.taxpayer.findFirst({
      where: { id: input.taxpayerId, tenantId: ctx.tenantId },
      select: { id: true, tenantId: true },
    });
    if (!t) return { error: 'Mükellef bulunamadı' };

    const year = input.year;
    const decls = await this.prisma.sgkDeclaration.findMany({
      where: {
        payrollPeriod: {
          tenantId: ctx.tenantId,
          ...(year ? { periodYear: year } : {}),
        },
      },
      include: { payrollPeriod: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    return {
      count: decls.length,
      declarations: decls.map((d: any) => ({
        id: d.id,
        donem: `${d.payrollPeriod.periodYear}-${String(d.payrollPeriod.periodMonth).padStart(2, '0')}`,
        status: d.status,
        referansNo: d.referenceNumber,
        gonderilmeTarihi: d.submittedAt?.toISOString().slice(0, 10),
      })),
    };
  }

  // ------------------------------------------------------------
  // EVRAK
  // ------------------------------------------------------------
  private async listDocuments(input: any, ctx: { tenantId: string }) {
    const t = await this.prisma.taxpayer.findFirst({
      where: { id: input.taxpayerId, tenantId: ctx.tenantId },
      select: { id: true },
    });
    if (!t) return { error: 'Mükellef bulunamadı' };

    const where: any = { taxpayerId: input.taxpayerId, isDeleted: false };
    if (input.category) where.category = input.category;

    const docs = await this.prisma.document.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    return {
      count: docs.length,
      documents: docs.map((d) => ({
        id: d.id,
        baslik: d.title,
        kategori: d.category,
        boyutKb: Math.round(d.sizeBytes / 1024),
        tarih: d.updatedAt.toISOString().slice(0, 10),
      })),
    };
  }

  // ------------------------------------------------------------
  // VERGİ TAKVİMİ
  // ------------------------------------------------------------
  private async getTaxCalendar(input: any, ctx: { tenantId: string }) {
    const from = input?.fromDate ? new Date(input.fromDate) : new Date();
    const to = input?.toDate ? new Date(input.toDate) : new Date(from.getTime() + 30 * 86400_000);

    const calendar = await this.prisma.taxCalendar.findMany({
      where: {
        dueDate: { gte: from, lte: to },
      },
      orderBy: { dueDate: 'asc' },
      take: 100,
    });

    let taxpayerDecls: any[] = [];
    if (input?.taxpayerId) {
      taxpayerDecls = await this.prisma.taxDeclaration.findMany({
        where: {
          taxpayerId: input.taxpayerId,
          status: { in: ['PENDING', 'PREPARING', 'READY'] as any[] },
          taxpayer: { tenantId: ctx.tenantId },
        },
        include: { taxCalendar: true },
        take: 50,
      });
    }

    return {
      donemAraligi: {
        baslangic: from.toISOString().slice(0, 10),
        bitis: to.toISOString().slice(0, 10),
      },
      yaklasanBeyannameler: calendar.map((c: any) => ({
        tip: c.declarationType,
        ayYil: c.periodMonth ? `${c.periodYear}-${String(c.periodMonth).padStart(2, '0')}` :
               c.periodQuarter ? `${c.periodYear}-Q${c.periodQuarter}` : `${c.periodYear}`,
        sonTarih: c.dueDate?.toISOString().slice(0, 10),
        aciklama: c.description,
      })),
      mukellefinBekleyenleri: taxpayerDecls.map((d: any) => ({
        tip: d.declarationType,
        donem: d.periodLabel,
        durum: d.status,
        sonTarih: d.taxCalendar?.dueDate?.toISOString().slice(0, 10),
      })),
    };
  }

  // ------------------------------------------------------------
  // KARŞILAŞTIRMA
  // ------------------------------------------------------------
  private async comparePeriods(input: any, ctx: { tenantId: string }) {
    const kaynak = input.kaynak;
    const d1: any = await this.fetchPeriodData(kaynak, input.taxpayerId, input.donem1, ctx);
    const d2: any = await this.fetchPeriodData(kaynak, input.taxpayerId, input.donem2, ctx);

    if (d1?.error || d2?.error) {
      return { error: d1?.error || d2?.error };
    }

    const diff: any = {};
    const keys = Object.keys(d1.kalemler || d1.aktif || d1);
    for (const key of keys) {
      const v1 = typeof d1.kalemler?.[key] === 'number' ? d1.kalemler[key] :
                 typeof d1[key] === 'number' ? d1[key] : null;
      const v2 = typeof d2.kalemler?.[key] === 'number' ? d2.kalemler[key] :
                 typeof d2[key] === 'number' ? d2[key] : null;
      if (v1 !== null && v2 !== null) {
        const fark = v2 - v1;
        const yuzde = v1 !== 0 ? (fark / Math.abs(v1)) * 100 : null;
        diff[key] = { donem1: v1, donem2: v2, fark, degismeYuzdesi: yuzde };
      }
    }

    return {
      kaynak,
      donem1: input.donem1,
      donem2: input.donem2,
      karsilaştırma: diff,
    };
  }

  private async fetchPeriodData(kaynak: string, taxpayerId: string, donem: string, ctx: { tenantId: string }) {
    switch (kaynak) {
      case 'gelir_tablosu': return this.getGelirTablosu({ taxpayerId, donem }, ctx);
      case 'bilanco':       return this.getBilanco({ taxpayerId, donem }, ctx);
      case 'mizan':         return this.getMizan({ taxpayerId, donem }, ctx);
      default: return { error: `Bilinmeyen kaynak: ${kaynak}` };
    }
  }

  // ------------------------------------------------------------
  // FİNANSAL RASYOLAR
  // ------------------------------------------------------------
  private async calculateFinancialRatios(input: any, ctx: { tenantId: string }) {
    const bResult: any = await this.getBilanco(input, ctx);
    const gtResult: any = await this.getGelirTablosu(input, ctx);

    const bOk = !bResult?.error;
    const gtOk = !gtResult?.error;

    if (!bOk && !gtOk) {
      return { error: 'Bu dönem için ne bilanço ne gelir tablosu bulundu' };
    }

    const ratios: any = {};
    const notes: string[] = [];

    if (bOk) {
      const b: any = bResult;
      const dv = b.aktif.donenVarliklar;
      const kv = b.pasif.kvYabanciKaynak;
      const at = b.aktif.aktifToplami;
      const oz = b.pasif.ozkaynaklar;
      const toplamBorc = (b.pasif.kvYabanciKaynak || 0) + (b.pasif.uvYabanciKaynak || 0);

      if (kv > 0) {
        ratios.cariOran = { deger: dv / kv, formul: 'Dönen Varlıklar / KV Yabancı Kaynak', yorum: (dv / kv) >= 1.5 ? 'Sağlıklı' : (dv / kv) >= 1 ? 'Dikkat' : 'Risk' };
      }
      if (at > 0) {
        ratios.borcluluk = { deger: toplamBorc / at, formul: '(KV + UV Y.K.) / Aktif Toplamı', yorum: (toplamBorc / at) <= 0.5 ? 'Sağlıklı' : (toplamBorc / at) <= 0.7 ? 'Dikkat' : 'Yüksek borçluluk' };
      }
      if (at > 0 && oz !== null) {
        ratios.ozkaynakOrani = { deger: oz / at, formul: 'Özkaynak / Aktif Toplamı' };
      }
      if (oz < 0) {
        notes.push('⚠️ **Özkaynak negatif** — TTK m.376 gereği sermaye kaybı durumu söz konusu olabilir. Genel kurul + sermaye artırımı/tamamlama kararı gerekli.');
      }
    }

    if (gtOk) {
      const k: any = gtResult.kalemler;
      if (k.netSatislar > 0) {
        ratios.brutKarMarji = { deger: k.brutSatisKari / k.netSatislar, formul: 'Brüt Satış Kârı / Net Satışlar' };
        ratios.faaliyetKarMarji = { deger: k.faaliyetKari / k.netSatislar, formul: 'Faaliyet Kârı / Net Satışlar' };
        ratios.netKarMarji = { deger: k.donemNetKari / k.netSatislar, formul: 'Dönem Net Kârı / Net Satışlar' };
      }
      if (bOk && (bResult as any).pasif.ozkaynaklar > 0) {
        ratios.roe = { deger: k.donemNetKari / (bResult as any).pasif.ozkaynaklar, formul: 'Dönem Net Kârı / Özkaynak (ROE)' };
      }
      if (bOk && (bResult as any).aktif.aktifToplami > 0) {
        ratios.roa = { deger: k.donemNetKari / (bResult as any).aktif.aktifToplami, formul: 'Dönem Net Kârı / Aktif Toplamı (ROA)' };
      }
    }

    return {
      donem: input.donem,
      rasyolar: ratios,
      uyarilar: notes,
    };
  }

  // ------------------------------------------------------------
  // GENEL ARAMA
  // ------------------------------------------------------------
  private async searchAll(input: any, ctx: { tenantId: string }) {
    const q = (input?.query || '').trim();
    if (!q) return { error: 'Arama metni boş' };
    const limit = Math.min(input?.limit || 5, 20);

    const [taxpayers, invoices, documents] = await Promise.all([
      this.prisma.taxpayer.findMany({
        where: {
          tenantId: ctx.tenantId,
          OR: [
            { companyName: { contains: q, mode: 'insensitive' } },
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { taxNumber: { contains: q } },
          ],
        },
        take: limit,
        select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true },
      }),
      this.prisma.invoice.findMany({
        where: {
          taxpayer: { tenantId: ctx.tenantId },
          invoiceNo: { contains: q, mode: 'insensitive' },
        },
        take: limit,
        include: { taxpayer: { select: { companyName: true, firstName: true, lastName: true } } },
      }),
      this.prisma.document.findMany({
        where: {
          taxpayer: { tenantId: ctx.tenantId },
          title: { contains: q, mode: 'insensitive' },
          isDeleted: false,
        },
        take: limit,
      }),
    ]);

    return {
      mukellefler: taxpayers.map((t) => ({ id: t.id, isim: this.displayName(t), vkn: t.taxNumber })),
      faturalar: invoices.map((i: any) => ({
        id: i.id, faturaNo: i.invoiceNo, mukellef: this.displayName(i.taxpayer),
        tutar: this.toNum(i.totalAmount), tarih: i.issueDate.toISOString().slice(0, 10),
      })),
      evraklar: documents.map((d) => ({
        id: d.id, baslik: d.title, kategori: d.category,
      })),
    };
  }

  // ══════════════════════════════════════════════════════════
  // FAZ 1 — Yeni modül tool handler'ları
  // ══════════════════════════════════════════════════════════

  /** İmport edilmiş beyanname kayıtlarını listele */
  private async listBeyanKayitlari(input: any, ctx: { tenantId: string }) {
    const { taxpayerId, beyanTipi, beyanTipiIn, donem, search, limit } = input || {};
    const where: any = { tenantId: ctx.tenantId };
    if (taxpayerId) where.taxpayerId = taxpayerId;
    if (beyanTipi) where.beyanTipi = beyanTipi;
    else if (Array.isArray(beyanTipiIn) && beyanTipiIn.length) where.beyanTipi = { in: beyanTipiIn };
    if (donem) where.donem = donem;
    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { onayNo: { contains: q, mode: 'insensitive' } },
        { taxpayer: { companyName: { contains: q, mode: 'insensitive' } } },
        { taxpayer: { taxNumber: { contains: q } } },
      ];
    }
    const kayitlar = await (this.prisma as any).beyanKaydi.findMany({
      where,
      include: {
        taxpayer: { select: { companyName: true, firstName: true, lastName: true, taxNumber: true } },
      },
      orderBy: [{ donem: 'desc' }],
      take: Math.min(limit || 100, 500),
    });
    return {
      adet: kayitlar.length,
      // ÖNEMLİ: "verildi mi" sorusunda 'durum'/'verildi' alanına bak. beyanTarihi
      // (verildiği tarih), tahakkuk veya beyanname belgesi varsa beyanname GİB'e
      // SUNULMUŞTUR — onayNo BOŞ olsa bile (içe aktarımda numara yakalanmamış olabilir).
      aciklama: 'verildi=true ise beyanname verilmiştir. onayNo boş olması "verilmedi" anlamına GELMEZ.',
      kayitlar: kayitlar.map((k: any) => {
        const verildi = Boolean(k.beyanTarihi || k.onayNo || k.beyannameUrl || k.tahakkukTutari);
        return {
          id: k.id,
          mukellef: k.taxpayer?.companyName || `${k.taxpayer?.firstName || ''} ${k.taxpayer?.lastName || ''}`.trim() || '—',
          vkn: k.taxpayer?.taxNumber,
          beyanTipi: k.beyanTipi,
          donem: k.donem,
          verildi,
          durum: verildi ? 'verildi' : 'hazirlanmis',
          // Hüküm cümlesi HAZIR verilir — model "onay no boş → verilmemiş" çıkarımı yapmasın.
          durumAciklama: verildi
            ? 'VERİLDİ — GİB kaydı mevcut (tahakkuk/beyan tarihi/beyanname belgesi var; onay no boş olsa bile verilmiştir)'
            : 'henüz verildiğine dair kayıt yok (tahakkuk, beyan tarihi veya belge bulunamadı)',
          beyanTarihi: k.beyanTarihi ? k.beyanTarihi.toISOString().slice(0, 10) : null,
          // null onayNo modeli yanlış "verilmedi" hükmüne itiyordu — sadece doluysa döner.
          ...(k.onayNo ? { onayNo: k.onayNo } : {}),
          tahakkukTutari: k.tahakkukTutari ? Number(k.tahakkukTutari) : null,
          pdfVar: !!k.pdfUrl,
          beyannameVar: !!k.beyannameUrl,
          kaynak: k.kaynak,
          kayitTarihi: k.createdAt,
        };
      }),
    };
  }

  /** Onay bekleyen AI kararlarını listele */
  private async listPendingDecisions(input: any, ctx: { tenantId: string }) {
    const { durum, mukellef, limit } = input || {};
    const where: any = { tenantId: ctx.tenantId };
    where.durum = durum || 'bekliyor';
    if (mukellef && mukellef.trim()) {
      where.mukellef = { contains: mukellef.trim(), mode: 'insensitive' };
    }
    const rows = await (this.prisma as any).pendingDecision.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit || 50, 200),
      select: {
        id: true, mukellef: true, firmaUnvan: true, firmaKimlikNo: true,
        belgeNo: true, tutar: true, kararTipi: true, sapmaSebep: true,
        durum: true, createdAt: true,
      },
    });
    return {
      adet: rows.length,
      kayitlar: rows.map((r: any) => ({
        ...r,
        tutar: r.tutar ? Number(r.tutar) : null,
      })),
    };
  }

  /** Firma Hafızası — belirli firma veya arama */
  private async getFirmaHafizasi(input: any, ctx: { tenantId: string }) {
    const { search, limit } = input || {};
    const where: any = { tenantId: ctx.tenantId };
    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { firmaUnvan: { contains: q, mode: 'insensitive' } },
        { firmaKimlikNo: { contains: q } },
      ];
    }
    const firmalar = await (this.prisma as any).vendorMemory.findMany({
      where,
      take: Math.min(limit || 20, 100),
      orderBy: [{ toplamOnay: 'desc' }, { sonKullanim: 'desc' }],
      include: {
        decisions: {
          orderBy: { onayAdedi: 'desc' },
          take: 10,
          include: {
            taxpayer: { select: { companyName: true, firstName: true, lastName: true, taxNumber: true } },
          },
        },
      },
    });

    return {
      adet: firmalar.length,
      firmalar: firmalar.map((f: any) => {
        // Mükellef bazında grupla
        const byMukellef: Record<string, any[]> = {};
        for (const d of f.decisions || []) {
          const ad = d.taxpayer
            ? (d.taxpayer.companyName || `${d.taxpayer.firstName || ''} ${d.taxpayer.lastName || ''}`.trim())
            : '(ortak)';
          if (!byMukellef[ad]) byMukellef[ad] = [];
          byMukellef[ad].push({
            kategori: d.altKategori ? `${d.kategori} → ${d.altKategori}` : d.kategori,
            kararTipi: d.kararTipi,
            kullanimSayisi: d.onayAdedi,
          });
        }
        return {
          firmaUnvan: f.firmaUnvan,
          vkn: f.firmaKimlikNo,
          toplamOnay: f.toplamOnay,
          sonKullanim: f.sonKullanim,
          mukellefBazliKararlar: byMukellef,
        };
      }),
    };
  }

  /** Galeri araçları + HGS durumları */
  private async listAraclarHgs(input: any, ctx: { tenantId: string }) {
    const { search, ihlalliMi } = input || {};
    const where: any = { tenantId: ctx.tenantId, aktif: true };
    if (search && search.trim()) {
      const q = search.trim().toUpperCase();
      where.OR = [
        { plaka: { contains: q } },
        { marka: { contains: q, mode: 'insensitive' } },
        { model: { contains: q, mode: 'insensitive' } },
        { sahipAd: { contains: q, mode: 'insensitive' } },
      ];
    }
    const araclar = await (this.prisma as any).arac.findMany({
      where,
      include: {
        hgsSonuclari: { orderBy: { sorguTarihi: 'desc' }, take: 1 },
      },
    });

    let liste = araclar.map((a: any) => {
      const s = a.hgsSonuclari?.[0];
      return {
        plaka: a.plaka,
        marka: a.marka,
        model: a.model,
        sahipAd: a.sahipAd,
        sonSorguTarihi: s?.sorguTarihi || null,
        ihlalSayisi: s?.ihlalSayisi || 0,
        toplamTutar: s?.toplamTutar ? Number(s.toplamTutar) : 0,
        sorguDurumu: s?.durum || 'henüz-sorgulanmamis',
      };
    });

    if (ihlalliMi === true) liste = liste.filter((a: any) => a.ihlalSayisi > 0);
    if (ihlalliMi === false) liste = liste.filter((a: any) => a.ihlalSayisi === 0);

    const toplamArac = liste.length;
    const ihlalliArac = liste.filter((a: any) => a.ihlalSayisi > 0).length;
    const toplamTutar = liste.reduce((s: number, a: any) => s + a.toplamTutar, 0);

    return {
      ozet: { toplamArac, ihlalliArac, toplamTutar },
      araclar: liste,
    };
  }

  /** Mükellef beyanname yapılandırması */
  private async getBeyannameConfig(input: any, ctx: { tenantId: string }) {
    const { taxpayerId } = input || {};

    if (taxpayerId) {
      const tp = await (this.prisma as any).taxpayer.findFirst({
        where: { id: taxpayerId, tenantId: ctx.tenantId },
        include: { beyanConfig: true },
      });
      if (!tp) return { error: 'Mükellef bulunamadı' };
      return {
        mukellef: tp.companyName || `${tp.firstName || ''} ${tp.lastName || ''}`.trim(),
        config: tp.beyanConfig || {
          incomeTaxType: null, kdv1Period: null, kdv2Enabled: false,
          muhtasarPeriod: null, damgaEnabled: false, posetEnabled: false,
          sgkBildirgeEnabled: false, eDefterPeriod: null,
          yapilandirilmamis: true,
        },
      };
    }

    // Tümü
    const taxpayers = await (this.prisma as any).taxpayer.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      include: { beyanConfig: true },
      orderBy: [{ companyName: 'asc' }, { firstName: 'asc' }],
    });

    const configlu = taxpayers.filter((t: any) => t.beyanConfig);
    return {
      toplam: taxpayers.length,
      yapilandirilmis: configlu.length,
      yapilandirilmamis: taxpayers.length - configlu.length,
      mukellefler: taxpayers.map((t: any) => ({
        ad: t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim(),
        config: t.beyanConfig ? {
          incomeTaxType: t.beyanConfig.incomeTaxType,
          kdv1Period: t.beyanConfig.kdv1Period,
          kdv2Enabled: t.beyanConfig.kdv2Enabled,
          muhtasarPeriod: t.beyanConfig.muhtasarPeriod,
          damgaEnabled: t.beyanConfig.damgaEnabled,
          posetEnabled: t.beyanConfig.posetEnabled,
          sgkBildirgeEnabled: t.beyanConfig.sgkBildirgeEnabled,
          eDefterPeriod: t.beyanConfig.eDefterPeriod,
        } : null,
      })),
    };
  }

  /** Toplu beyan özeti (dashboard tablosu eşdeğeri) */
  private async getBeyanOzet(input: any, ctx: { tenantId: string }) {
    let donem = input?.donem;
    if (!donem) {
      const now = new Date();
      donem = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    if (!/^\d{4}-\d{2}$/.test(donem)) return { error: 'Geçersiz dönem (yyyy-mm)' };

    const [yilStr, ayStr] = donem.split('-');
    const yil = parseInt(yilStr, 10);
    const ay = parseInt(ayStr, 10);

    const taxpayers = await (this.prisma as any).taxpayer.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      include: { beyanConfig: true },
    });

    const durumlar = await (this.prisma as any).beyanDurumu.findMany({
      where: { tenantId: ctx.tenantId, donem },
    });
    const durumMap = new Map<string, any>();
    for (const d of durumlar) durumMap.set(`${d.taxpayerId}::${d.beyanTipi}`, d);

    const agg: Record<string, { toplam: number; onaylanan: number; bekleyen: number; hatali: number }> = {
      KDV1: { toplam: 0, onaylanan: 0, bekleyen: 0, hatali: 0 },
      KDV2: { toplam: 0, onaylanan: 0, bekleyen: 0, hatali: 0 },
      MUHSGK: { toplam: 0, onaylanan: 0, bekleyen: 0, hatali: 0 },
      DAMGA: { toplam: 0, onaylanan: 0, bekleyen: 0, hatali: 0 },
      POSET: { toplam: 0, onaylanan: 0, bekleyen: 0, hatali: 0 },
      BILDIRGE: { toplam: 0, onaylanan: 0, bekleyen: 0, hatali: 0 },
      EDEFTER: { toplam: 0, onaylanan: 0, bekleyen: 0, hatali: 0 },
      KURUMLAR: { toplam: 0, onaylanan: 0, bekleyen: 0, hatali: 0 },
      GELIR: { toplam: 0, onaylanan: 0, bekleyen: 0, hatali: 0 },
    };

    for (const tp of taxpayers) {
      const cfg = tp.beyanConfig;
      if (!cfg) continue;
      // Mükellef aktiflik kontrolü
      if (tp.endDate && new Date(tp.endDate) < new Date(yil, ay - 1, 1)) continue;

      const beklenen: string[] = [];
      if (cfg.kdv1Period === 'AYLIK' || (cfg.kdv1Period === 'UCAYLIK' && [3, 6, 9, 12].includes(ay))) beklenen.push('KDV1');
      if (cfg.kdv2Enabled) beklenen.push('KDV2');
      if (cfg.muhtasarPeriod === 'AYLIK' || (cfg.muhtasarPeriod === 'UCAYLIK' && [3, 6, 9, 12].includes(ay))) beklenen.push('MUHSGK');
      if (cfg.damgaEnabled) beklenen.push('DAMGA');
      if (cfg.posetEnabled && [1, 4, 7, 10].includes(ay)) beklenen.push('POSET');
      if (cfg.sgkBildirgeEnabled) beklenen.push('BILDIRGE');
      if (cfg.eDefterPeriod === 'AYLIK' || (cfg.eDefterPeriod === 'UCAYLIK' && [3, 6, 9, 12].includes(ay))) beklenen.push('EDEFTER');
      if (cfg.incomeTaxType === 'KURUMLAR' && ay === 4) beklenen.push('KURUMLAR');
      if (cfg.incomeTaxType === 'GELIR' && ay === 3) beklenen.push('GELIR');

      for (const tip of beklenen) {
        if (!agg[tip]) continue;
        agg[tip].toplam++;
        const d = durumMap.get(`${tp.id}::${tip}`);
        if (d?.durum === 'onaylandi') agg[tip].onaylanan++;
        else if (d?.durum === 'hatali') agg[tip].hatali++;
        else agg[tip].bekleyen++;
      }
    }

    // Sadece toplam > 0 olanları döndür
    const aktifTipler = Object.entries(agg).filter(([_, v]) => v.toplam > 0);
    return {
      donem,
      satirlar: aktifTipler.map(([tip, v]) => ({
        beyanTipi: tip,
        toplam: v.toplam,
        onaylanan: v.onaylanan,
        bekleyen: v.bekleyen,
        hatali: v.hatali,
        yuzde: v.toplam > 0 ? Math.round((v.onaylanan / v.toplam) * 100) : 0,
      })),
    };
  }

  // ------------------------------------------------------------
  // SİSTEM SAĞLIĞI — açık (çözülmemiş) uyarılar
  // ------------------------------------------------------------
  private async getSystemHealth(input: any, ctx: { tenantId: string }) {
    const onlyProblems = input?.onlyProblems !== false;
    const limit = Math.min(Number(input?.limit) || 20, 50);
    const shc = (this.prisma as any).systemHealthCheck;
    if (!shc?.findMany) return { error: 'Sistem sağlık modülü kullanılamıyor.' };
    const where: any = {
      resolved: false,
      // tenant'a özel + sistem-genel (tenantId null) uyarıları birlikte.
      OR: [{ tenantId: ctx.tenantId }, { tenantId: null }],
    };
    if (onlyProblems) where.severity = { in: ['WARNING', 'CRITICAL'] };
    const checks = await shc.findMany({
      where,
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });
    const kritik = checks.filter((c: any) => c.severity === 'CRITICAL').length;
    const uyari = checks.filter((c: any) => c.severity === 'WARNING').length;
    return {
      durum: kritik > 0 ? 'KRITIK' : uyari > 0 ? 'UYARI' : 'IYI',
      ozet: { toplam: checks.length, kritik, uyari, sonKontrol: checks[0]?.createdAt || null },
      uyarilar: checks.map((c: any) => ({
        tip: c.type,
        onem: c.severity,
        durum: c.status,
        mesaj: c.message,
        tavsiye: c.acilTavsiye || null,
        zaman: c.createdAt,
      })),
    };
  }

  private async getAgentStatus(input: any, ctx: { tenantId: string }) {
    const agent = input?.agent || undefined;
    const limit = Math.min(input?.limit || 10, 50);
    const [statuses, commands] = await Promise.all([
      (this.prisma as any).agentStatus.findMany({
        where: { tenantId: ctx.tenantId, ...(agent ? { agent } : {}) },
        orderBy: { lastPing: 'desc' },
      }),
      (this.prisma as any).agentCommand.findMany({
        where: { tenantId: ctx.tenantId, ...(agent ? { agent } : {}) },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);
    return {
      ajanlar: statuses.map((s: any) => ({
        agent: s.agent,
        calisiyor: s.running,
        sonPing: s.lastPing,
        hedefAy: s.hedefAy,
        meta: s.meta,
      })),
      sonKomutlar: commands.map((c: any) => ({
        id: c.id,
        agent: c.agent,
        action: c.action,
        status: c.status,
        payload: c.payload,
        result: c.result,
        createdAt: c.createdAt,
        startedAt: c.startedAt,
        finishedAt: c.finishedAt,
      })),
    };
  }

  private async writeOwnerApprovalAudit(
    ctx: { tenantId: string; userId?: string | null },
    action: string,
    resourceId: string | null,
    data: any,
  ) {
    await this.prisma.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        userId: ctx.userId || null,
        action,
        resource: 'owner_approval_request',
        resourceId,
        newData: data,
      },
    }).catch(() => null);
  }

  private extractPreviewId(value: any): string | null {
    const raw = String(value || '').trim().toLocaleUpperCase('tr-TR');
    const match = raw.match(/#?(PRV-[A-F0-9]{4})\b/);
    return match ? match[1] : null;
  }

  private async nextPreviewId(): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const previewId = `PRV-${randomBytes(2).toString('hex').toUpperCase()}`;
      const exists = await (this.prisma as any).ownerApprovalRequest.findUnique({
        where: { previewId },
        select: { id: true },
      }).catch(() => null);
      if (!exists) return previewId;
    }
    return `PRV-${Date.now().toString(36).slice(-4).toUpperCase()}`;
  }

  private async createAgentCommand(input: any, ctx: { tenantId: string; userId?: string | null }) {
    const confirmationRaw = String(input?.confirmationText || '').trim();
    const previewId = this.extractPreviewId(input?.previewId || confirmationRaw);
    const confirmation = confirmationRaw.toLocaleUpperCase('tr-TR');
    if (!previewId || confirmation !== `ONAYLIYORUM #${previewId}`) {
      return {
        error: 'Komut olusturulmadi. Once preview_agent_command ile 5 dakika gecerliligi olan bir preview olustur ve kullanicidan "ONAYLIYORUM #PRV-XXXX" formatinda onay iste.',
        requiresConfirmation: true,
        confirmationFormat: 'ONAYLIYORUM #PRV-XXXX',
      };
    }
    const approval = await (this.prisma as any).ownerApprovalRequest.findFirst({
      where: { tenantId: ctx.tenantId, previewId },
    });
    if (!approval) {
      return { error: `Preview bulunamadi veya tenant ile eslesmedi: ${previewId}`, requiresConfirmation: true };
    }
    if (approval.status !== 'PENDING') {
      return { error: `Preview artik kullanilamaz: ${approval.status}`, requiresConfirmation: true, previewId };
    }
    if (new Date(approval.expiresAt).getTime() < Date.now()) {
      await (this.prisma as any).ownerApprovalRequest.update({
        where: { id: approval.id },
        data: { status: 'EXPIRED', responseText: confirmationRaw },
      }).catch(() => null);
      await this.writeOwnerApprovalAudit(ctx, 'EXPIRE', approval.id, { previewId, agent: approval.agent, action: approval.action });
      return { error: `Preview suresi doldu: ${previewId}. Yeni onizleme olusturun.`, requiresConfirmation: true, expired: true };
    }

    const agent = String(approval.agent || '').trim();
    const action = String(approval.action || '').trim();
    const payload = approval.payload && typeof approval.payload === 'object' ? approval.payload : {};
    const allowedAgents = ['mihsap', 'mihsap-supervised-agent', 'mihsap-fatura-isleme-agent', 'luca', 'sgk', 'tebligat', 'kdv', 'beyan-hazirlik', 'luca-beyanname', 'kdv-beyan', 'tahsilat', 'banka-ekstre', 'edefter', 'whatsapp'];
    const allowedMihsapActions = [...MIHSAP_FATURA_ACTIONS];
    if (!allowedAgents.includes(agent)) return { error: `Desteklenmeyen agent: ${agent}` };
    if (isMihsapFaturaCommandAgent(agent) && !allowedMihsapActions.includes(action as any)) {
      return { error: `Mihsap için desteklenmeyen action: ${action}` };
    }
    if (isMihsapFaturaCommandAgent(agent)) {
      if (!payload.ay || !Array.isArray(payload.mukellefler) || payload.mukellefler.length === 0) {
        return { error: 'Mihsap komutu için payload.ay ve payload.mukellefler zorunlu.' };
      }
    }
    const cmd = await (this.prisma as any).agentCommand.create({
      data: {
        tenantId: ctx.tenantId,
        agent,
        action,
        payload,
        createdBy: ctx.userId || null,
      },
    });
    await (this.prisma as any).ownerApprovalRequest.update({
      where: { id: approval.id },
      data: {
        status: 'EXECUTED',
        approvedAt: new Date(),
        consumedAt: new Date(),
        responseText: confirmationRaw,
      },
    });
    await this.writeOwnerApprovalAudit(ctx, 'EXECUTE', approval.id, {
      previewId,
      commandId: cmd.id,
      agent,
      action,
      payload,
    });
    return {
      ok: true,
      commandId: cmd.id,
      previewId,
      agent: cmd.agent,
      action: cmd.action,
      status: cmd.status,
      createdAt: cmd.createdAt,
    };
  }

  private async getOperationBriefing(input: any, ctx: { tenantId: string }) {
    const { period, year, month } = this.currentPeriod(input);
    const todayStart = this.startOfDay();
    const [taxpayers, statuses, bankAccounts, bankRecords, cariRows, agentEvents, pendingDecisions, commands, tasks] = await Promise.all([
      this.prisma.taxpayer.findMany({
        where: { tenantId: ctx.tenantId, isActive: true },
        select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true, type: true },
        orderBy: [{ companyName: 'asc' }, { firstName: 'asc' }],
      }),
      (this.prisma as any).taxpayerMonthlyStatus.findMany({ where: { tenantId: ctx.tenantId, year, month } }),
      (this.prisma as any).bankaHesap.findMany({ where: { tenantId: ctx.tenantId, aktif: true }, select: { taxpayerId: true } }),
      (this.prisma as any).bankaEkstreKaydi.findMany({ where: { tenantId: ctx.tenantId, donem: period } }),
      (this.prisma as any).cariHareket.findMany({ where: { tenantId: ctx.tenantId }, select: { taxpayerId: true, tip: true, tutar: true } }),
      (this.prisma as any).agentEvent.findMany({
        where: { tenantId: ctx.tenantId, ts: { gte: todayStart } },
        orderBy: { ts: 'desc' },
        take: 80,
      }),
      (this.prisma as any).pendingDecision?.findMany
        ? (this.prisma as any).pendingDecision.findMany({ where: { tenantId: ctx.tenantId, durum: 'bekliyor' }, take: 50 })
        : Promise.resolve([]),
      (this.prisma as any).agentCommand.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: 'desc' }, take: 20 }),
      (this.prisma as any).task.findMany({
        where: { tenantId: ctx.tenantId, isTemplate: false, status: { in: ['OPEN', 'IN_PROGRESS', 'MISSED'] } },
        select: { id: true, title: true, dueDate: true, status: true },
        take: 200,
      }).catch(() => []),
    ]);

    const statusMap = new Map((statuses || []).map((s: any) => [s.taxpayerId, s]));
    const bankAccountSet = new Set((bankAccounts || []).map((b: any) => b.taxpayerId));
    const bankRecordMap = new Map<string, any[]>();
    for (const r of bankRecords || []) {
      const list = bankRecordMap.get(r.taxpayerId) || [];
      list.push(r);
      bankRecordMap.set(r.taxpayerId, list);
    }

    let evrakEksik = 0, islenmemis = 0, kdvKontrolEksik = 0, beyanEksik = 0, bankaEksik = 0, bankaHesapsiz = 0;
    const readinessRows: any[] = [];
    for (const t of taxpayers as any[]) {
      const s: any = statusMap.get(t.id) || {};
      const bankaVar = bankAccountSet.has(t.id);
      const ekstreRows = bankRecordMap.get(t.id) || [];
      const ekstreTamam = !bankaVar || (ekstreRows.length > 0 && ekstreRows.every((r: any) => r.ekstreGeldi && r.ekstreIslendi));
      const kdvTamam = !!(s.kdvKontrolEdildi || (s.indirilecekKdvKontrol && s.hesaplananKdvKontrol && s.eArsivKontrol));
      const eksikler: string[] = [];
      if (!s.evraklarGeldi) { evrakEksik++; eksikler.push('evrak gelmedi'); }
      if (s.evraklarGeldi && !s.evraklarIslendi) { islenmemis++; eksikler.push('evrak işlenmedi'); }
      if (!kdvTamam) { kdvKontrolEksik++; eksikler.push('KDV kontrol eksik'); }
      if (!s.beyannameVerildi) { beyanEksik++; eksikler.push('beyanname işaretlenmedi'); }
      if (!bankaVar) { bankaHesapsiz++; eksikler.push('banka hesabı yok'); }
      else if (!ekstreTamam) { bankaEksik++; eksikler.push('banka ekstresi eksik/işlenmedi'); }
      const score = Math.max(0, 100 - (eksikler.length * 18));
      if (eksikler.length) readinessRows.push({ id: t.id, ad: this.displayName(t), score, durum: this.riskLevel(score), eksikler: eksikler.slice(0, 4) });
    }

    const cariByTaxpayer = new Map<string, number>();
    for (const h of cariRows || []) {
      const tutar = this.toNum(h.tutar);
      const sign = h.tip === 'TAHAKKUK' ? 1 : h.tip === 'TAHSILAT' ? -1 : h.tip === 'IADE' ? 1 : 0;
      cariByTaxpayer.set(h.taxpayerId, (cariByTaxpayer.get(h.taxpayerId) || 0) + sign * tutar);
    }
    const borclular = [...cariByTaxpayer.entries()].filter(([, v]) => v > 0);
    const toplamBakiye = borclular.reduce((s, [, v]) => s + v, 0);
    const bugunHata = (agentEvents || []).filter((e: any) => /hata|error|fail/i.test(String(e.status || ''))).length;
    const gecikenGorev = (tasks || []).filter((t: any) => t.dueDate && new Date(t.dueDate) < todayStart).length;

    return {
      period,
      ozet: {
        aktifMukellef: taxpayers.length,
        evrakEksik,
        islenmemis,
        kdvKontrolEksik,
        beyanEksik,
        bankaEksik,
        bankaHesapsiz,
        borcluMukellef: borclular.length,
        toplamBakiye,
        bugunAgentOlay: (agentEvents || []).length,
        bugunAgentHata: bugunHata,
        bekleyenOnay: (pendingDecisions || []).length,
        gecikenGorev,
      },
      oneriler: [
        evrakEksik ? `${evrakEksik} mükellefte evrak bekleniyor` : null,
        bankaEksik || bankaHesapsiz ? `${bankaEksik + bankaHesapsiz} mükellefte banka takip aksiyonu var` : null,
        kdvKontrolEksik ? `${kdvKontrolEksik} mükellefte KDV/beyan hazırlığı eksik` : null,
        borclular.length ? `${borclular.length} mükellefte açık cari bakiye var` : null,
        bugunHata ? `Bugün ${bugunHata} agent hatası var` : null,
      ].filter(Boolean),
      riskliMukellefler: readinessRows.sort((a, b) => a.score - b.score).slice(0, 15),
      sonAgentKomutlari: commands,
      sonAgentOlaylari: (agentEvents || []).slice(0, 15),
    };
  }

  private async getTaxpayerWorkStatus(input: any, ctx: { tenantId: string }) {
    const { period, year, month } = this.currentPeriod(input);
    const taxpayerId = input?.taxpayerId;
    const [taxpayer, status, bankAccounts, bankRecords, invoices, earsiv, kdvSessions, beyanlar, mizan, cariRows, agentEvents, memories] = await Promise.all([
      this.prisma.taxpayer.findFirst({ where: { tenantId: ctx.tenantId, id: taxpayerId } }),
      (this.prisma as any).taxpayerMonthlyStatus.findFirst({ where: { tenantId: ctx.tenantId, taxpayerId, year, month } }),
      (this.prisma as any).bankaHesap.findMany({ where: { tenantId: ctx.tenantId, taxpayerId, aktif: true } }),
      (this.prisma as any).bankaEkstreKaydi.findMany({ where: { tenantId: ctx.tenantId, taxpayerId, donem: period } }),
      (this.prisma as any).mihsapInvoice.count({ where: { tenantId: ctx.tenantId, mukellefId: taxpayerId, donem: period } }).catch(() => 0),
      (this.prisma as any).earsivFatura.count({ where: { tenantId: ctx.tenantId, taxpayerId, donem: period } }).catch(() => 0),
      (this.prisma as any).kdvControlSession.findMany({ where: { tenantId: ctx.tenantId, taxpayerId, period }, orderBy: { createdAt: 'desc' }, take: 3 }).catch(() => []),
      (this.prisma as any).beyanKaydi.findMany({ where: { tenantId: ctx.tenantId, taxpayerId, donem: period }, take: 10 }).catch(() => []),
      (this.prisma as any).mizan.findFirst({ where: { tenantId: ctx.tenantId, taxpayerId, donem: period }, orderBy: { createdAt: 'desc' } }).catch(() => null),
      (this.prisma as any).cariHareket.findMany({ where: { tenantId: ctx.tenantId, taxpayerId }, select: { tip: true, tutar: true } }).catch(() => []),
      (this.prisma as any).agentEvent.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { ts: 'desc' }, take: 100 }).catch(() => []),
      (this.prisma as any).aiMemory?.findMany
        ? (this.prisma as any).aiMemory.findMany({ where: { tenantId: ctx.tenantId, taxpayerId, isActive: true }, orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }], take: 5 })
        : Promise.resolve([]),
    ]);
    if (!taxpayer) return { error: 'Mükellef bulunamadı' };
    const s: any = status || {};
    const cariBakiye = (cariRows || []).reduce((sum: number, h: any) => sum + (h.tip === 'TAHAKKUK' ? this.toNum(h.tutar) : h.tip === 'TAHSILAT' ? -this.toNum(h.tutar) : 0), 0);
    const taxpayerLabel = this.displayName(taxpayer).toLocaleLowerCase('tr-TR');
    const relevantAgentEvents = (agentEvents || [])
      .filter((event: any) => {
        const metaTaxpayerId = event?.meta && typeof event.meta === 'object' ? String(event.meta.taxpayerId || event.meta.mukellefId || '') : '';
        if (metaTaxpayerId === taxpayerId) return true;
        return [event.mukellef, event.firma, event.message]
          .filter(Boolean)
          .some((value: any) => String(value).toLocaleLowerCase('tr-TR').includes(taxpayerLabel));
      })
      .slice(0, 20);
    const eksikler: string[] = [];
    if (!s.evraklarGeldi) eksikler.push('evrak gelmedi');
    if (s.evraklarGeldi && !s.evraklarIslendi) eksikler.push('evrak işlenmedi');
    if (!s.kdvKontrolEdildi && !(s.indirilecekKdvKontrol && s.hesaplananKdvKontrol && s.eArsivKontrol)) eksikler.push('KDV kontrol eksik');
    if (!mizan) eksikler.push('LUCA mizan yok');
    if (!bankAccounts.length) eksikler.push('banka hesabı yok');
    else if (!bankRecords.length || bankRecords.some((r: any) => !r.ekstreGeldi || !r.ekstreIslendi)) eksikler.push('banka ekstresi eksik/işlenmedi');
    if (!beyanlar.length && !s.beyannameVerildi) eksikler.push('beyan kaydı yok');
    if (cariBakiye > 0) eksikler.push('açık cari bakiye var');
    const score = Math.max(0, 100 - eksikler.length * 14);
    return {
      taxpayerId,
      ad: this.displayName(taxpayer),
      period,
      score,
      durum: this.riskLevel(score),
      eksikler,
      veri: {
        mihsapFatura: invoices,
        lucaEarsivFatura: earsiv,
        kdvKontrolOturumu: kdvSessions.length,
        beyanKaydi: beyanlar.length,
        mizanVar: !!mizan,
        bankaHesapSayisi: bankAccounts.length,
        cariBakiye,
        hafizaNotlari: memories.map((m: any) => ({ title: m.title, content: m.content, tags: m.tags })),
        sonAgentOlaylari: relevantAgentEvents,
      },
    };
  }

  private async getLucaAgentJobs(input: any, ctx: { tenantId: string }) {
    const limit = Math.min(input?.limit || 20, 100);
    return this.getAgentJobs('luca', limit, ctx);
  }

  private async getMihsapAgentJobs(input: any, ctx: { tenantId: string }) {
    const limit = Math.min(input?.limit || 20, 100);
    const { period } = this.currentPeriod(input);
    const base = await this.getAgentJobs('mihsap', limit, ctx);
    const jobs = await (this.prisma as any).mihsapFetchJob.findMany({
      where: { tenantId: ctx.tenantId, donem: period },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }).catch(() => []);
    return { ...base, period, mihsapFetchJobs: jobs };
  }

  private async getAgentJobs(agent: string, limit: number, ctx: { tenantId: string }) {
    const [status, commands, events] = await Promise.all([
      (this.prisma as any).agentStatus.findFirst({ where: { tenantId: ctx.tenantId, agent } }),
      (this.prisma as any).agentCommand.findMany({ where: { tenantId: ctx.tenantId, agent }, orderBy: { createdAt: 'desc' }, take: limit }),
      (this.prisma as any).agentEvent.findMany({ where: { tenantId: ctx.tenantId, agent }, orderBy: { ts: 'desc' }, take: limit }),
    ]);
    return { agent, status, commands, events };
  }

  private async previewAgentCommand(input: any, ctx: { tenantId: string; userId?: string | null }) {
    const agent = String(input?.agent || '').trim();
    const action = String(input?.action || '').trim();
    const payload = input?.payload && typeof input.payload === 'object' ? input.payload : {};
    const requiresConfirmation = true;
    const supported: Record<string, string[]> = {
      mihsap: [...MIHSAP_FATURA_ACTIONS],
      'mihsap-supervised-agent': [...MIHSAP_FATURA_ACTIONS],
      'mihsap-fatura-isleme-agent': [...MIHSAP_FATURA_ACTIONS],
      luca: ['fetch_earsiv', 'fetch_efatura', 'fetch_mizan', 'prepare_beyanname'],
      kdv: ['prepare_kdv1', 'prepare_kdv2', 'kontrol'],
      sgk: ['prepare_muhsgk'],
      tebligat: ['scan'],
      'beyan-hazirlik': ['kontrol', 'create_tasks'],
      'luca-beyanname': ['prepare_kdv1', 'prepare_kdv2', 'prepare_muhsgk', 'prepare_damga'],
      'kdv-beyan': ['kontrol', 'prepare_kdv1', 'prepare_kdv2'],
      tahsilat: ['risk_scan', 'whatsapp_preview', 'payment_promise_followup'],
      'banka-ekstre': ['scan_missing', 'create_tasks'],
      edefter: ['scan_berat'],
      whatsapp: [...WHATSAPP_AGENT_ACTIONS],
    };
    const errors: string[] = [];
    if (!supported[agent]) errors.push(`Desteklenmeyen agent: ${agent}`);
    else if (!supported[agent].includes(action)) errors.push(`${agent} için desteklenmeyen action: ${action}`);
    if (isMihsapFaturaCommandAgent(agent) && (!payload.ay || !Array.isArray(payload.mukellefler) || payload.mukellefler.length === 0)) {
      errors.push('Mihsap komutu için payload.ay ve payload.mukellefler gerekir');
    }
    const impact = this.describeAgentImpact(agent, action, payload);
    let approval: any = null;
    if (errors.length === 0) {
      const previewId = await this.nextPreviewId();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      approval = await (this.prisma as any).ownerApprovalRequest.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId || null,
          previewId,
          agent,
          action,
          payload,
          impact,
          expiresAt,
        },
      });
      await this.writeOwnerApprovalAudit(ctx, 'CREATE', approval.id, {
        previewId,
        agent,
        action,
        payload,
        expiresAt,
      });
    }
    return {
      ok: errors.length === 0,
      errors,
      requiresConfirmation,
      previewId: approval?.previewId || null,
      expiresAt: approval?.expiresAt || null,
      validForSeconds: approval ? 300 : 0,
      confirmationText: approval ? `ONAYLIYORUM #${approval.previewId}` : 'ONAYLIYORUM #PRV-XXXX',
      agent,
      action,
      payload,
      etki: impact,
      not: 'Bu onizleme komut olusturmaz. Kullanici 5 dakika icinde confirmationText degerini aynen yazarsa create_confirmed_agent_command calisir.',
    };
  }

  private describeAgentImpact(agent: string, action: string, payload: any) {
    if (agent === 'luca' && action === 'prepare_beyanname') return 'LUCA beyanname ekranında taslak hazırlık başlatılır; gönderim ayrıca onay gerektirir.';
    if (agent === 'luca' && action === 'fetch_mizan') return 'LUCA’dan mizan çekimi başlatılır ve portala işlenir.';
    if (isMihsapFaturaCommandAgent(agent)) return `${payload?.mukellefler?.length || 0} mükellef için Mihsap fatura işleme komutu hazırlanır.`;
    if (agent === 'whatsapp' && action === 'document_send') return 'Seçilen belge WhatsApp ile ilgili alıcıya gönderilmek üzere komut kuyruğuna alınır.';
    if (agent === 'whatsapp' && action === 'document_request') return 'Mükelleften WhatsApp üzerinden evrak/belge talep etmek üzere komut kuyruğuna alınır.';
    if (agent === 'whatsapp' && action === 'conversation_reply') return 'Seçili WhatsApp konuşmasına portal adına yanıt gönderme komutu hazırlanır.';
    if (agent === 'whatsapp' && action === 'conversation_start') return 'Yeni WhatsApp konuşması başlatma komutu hazırlanır; 24 saat penceresi kapalıysa şablon gerekebilir.';
    if (agent === 'whatsapp' && action === 'call_request') return 'WhatsApp araması için portal içinden çağrı/arama isteği hazırlanır; gerçek çağrı başlatma WhatsApp Web oturum izinlerine bağlıdır.';
    if (agent === 'kdv') return 'KDV kontrol / beyan ön hazırlık komutu hazırlanır.';
    return `${agent} agent için ${action} komutu hazırlanır.`;
  }

  private async getCollectionRiskSummary(input: any, ctx: { tenantId: string }) {
    const limit = Math.min(input?.limit || 20, 100);
    const [taxpayers, rows] = await Promise.all([
      this.prisma.taxpayer.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, companyName: true, firstName: true, lastName: true, phone: true, phones: true } }),
      (this.prisma as any).cariHareket.findMany({ where: { tenantId: ctx.tenantId }, select: { taxpayerId: true, tip: true, tutar: true, tarih: true } }),
    ]);
    const tMap = new Map((taxpayers as any[]).map((t) => [t.id, t]));
    const balances = new Map<string, { bakiye: number; sonTahsilat?: Date }>();
    for (const h of rows || []) {
      const cur = balances.get(h.taxpayerId) || { bakiye: 0 };
      if (h.tip === 'TAHAKKUK') cur.bakiye += this.toNum(h.tutar);
      if (h.tip === 'TAHSILAT') {
        cur.bakiye -= this.toNum(h.tutar);
        if (!cur.sonTahsilat || new Date(h.tarih) > cur.sonTahsilat) cur.sonTahsilat = new Date(h.tarih);
      }
      balances.set(h.taxpayerId, cur);
    }
    const riskli = [...balances.entries()]
      .map(([taxpayerId, b]) => {
        const t: any = tMap.get(taxpayerId);
        const phone = t?.phone || (Array.isArray(t?.phones) ? t.phones.find(Boolean) : null);
        return { taxpayerId, ad: t ? this.displayName(t) : taxpayerId, bakiye: b.bakiye, sonTahsilat: b.sonTahsilat, whatsappUygun: !!phone };
      })
      .filter((r) => r.bakiye > 0)
      .sort((a, b) => b.bakiye - a.bakiye);
    return {
      toplamBorclu: riskli.length,
      toplamBakiye: riskli.reduce((s, r) => s + r.bakiye, 0),
      whatsappUygun: riskli.filter((r) => r.whatsappUygun).length,
      enRiskli: riskli.slice(0, limit),
    };
  }

  private async getBeyannameReadinessSummary(input: any, ctx: { tenantId: string }) {
    const { period } = this.currentPeriod(input);
    const limit = Math.min(input?.limit || 30, 100);
    const base = await this.getOperationBriefing({ period }, ctx);
    const sorunlu = Array.isArray(base.riskliMukellefler) ? base.riskliMukellefler : [];
    const toplam = Number(base?.ozet?.aktifMukellef || 0);
    return {
      period,
      toplam,
      hazir: Math.max(0, toplam - sorunlu.length),
      eksik: sorunlu.filter((r: any) => r.durum !== 'RISKLI').length,
      riskli: sorunlu.filter((r: any) => r.durum === 'RISKLI').length,
      enSorunlu: sorunlu.slice(0, limit),
      ozet: base.ozet,
    };
  }

  private getPortalCapabilityMap() {
    const actionAgents = {
      mihsap: ['isle_alis', 'isle_satis', 'isle_alis_isletme', 'isle_satis_isletme'],
      luca: ['fetch_earsiv', 'fetch_efatura', 'fetch_mizan', 'prepare_beyanname'],
      kdv: ['kontrol', 'prepare_kdv1', 'prepare_kdv2'],
      sgk: ['prepare_muhsgk'],
      tebligat: ['scan'],
      tahsilat: ['risk_scan', 'whatsapp_preview', 'payment_promise_followup'],
      'banka-ekstre': ['scan_missing', 'create_tasks'],
      edefter: ['scan_berat'],
      whatsapp: [...WHATSAPP_AGENT_ACTIONS],
    };
    return {
      readAndAnalyze: [
        { module: 'Mükellefler', tools: ['list_taxpayers', 'get_taxpayer', 'list_taxpayers_monthly_status'], scope: 'kimlik, evrak, aylık durum, aktif/pasif durum' },
        { module: 'Mizan', tools: ['list_mizan_periods', 'get_mizan'], scope: 'hesap kodu, bakiye, TDHP/anomali, dönem karşılaştırma' },
        { module: 'Gelir Tablosu', tools: ['get_gelir_tablosu'], scope: 'karlılık, satış, maliyet, gider analizi' },
        { module: 'Bilanço', tools: ['get_bilanco', 'calculate_financial_ratios'], scope: 'likidite, borçluluk, özkaynak, TTK 376 riski' },
        { module: 'KDV', tools: ['get_kdv_summary', 'get_beyanname_readiness_summary'], scope: 'KDV kontrol, beyan hazırlığı, eksik evrak ve fatura uyuşmazlığı' },
        { module: 'Faturalar', tools: ['list_invoices', 'get_firma_hafizasi'], scope: 'Mihsap/e-belge, karşı firma kod hafızası, alış/satış analizi' },
        { module: 'Beyannameler', tools: ['list_beyan_kayitlari', 'get_beyanname_config', 'get_beyan_ozet'], scope: 'beyan tipi, onay no, tahakkuk, dönemsel takip' },
        { module: 'Banka/Cari/Tahsilat', tools: ['get_collection_risk_summary', 'get_operation_briefing'], scope: 'açık bakiye, tahsilat riski, banka aksiyonu' },
        { module: 'Görevler ve Agentlar', tools: ['get_agent_status', 'get_luca_agent_jobs', 'get_mihsap_agent_jobs', 'list_pending_decisions'], scope: 'agent durumu, hata, onay bekleyen karar, iş yükü' },
        { module: 'Sistem Sağlığı', tools: ['get_system_health'], scope: 'açık uyarılar: ajan ping, token yaşı, kuyruk, hata oranı, modül hash, agent sürüm, veritabanı' },
        { module: 'Evrak ve Galeri', tools: ['list_documents', 'list_araclar_hgs'], scope: 'belge, sözleşme, araç/HGS ihlal durumu' },
        { module: 'Hafıza', tools: ['search_ai_memory', 'save_ai_memory'], scope: 'ofis tercihi, mükellef notu, araştırma kaydı, tekrar öğrenme' },
        { module: 'Mevzuat Araştırma', tools: ['research_official_sources'], scope: 'GİB, SGK, Resmi Gazete, mevzuat.gov.tr, TÜRMOB, HMB, KGK, TCMB ve resmi/mesleki kaynaklar' },
      ],
      commandAndAction: actionAgents,
      executionRule: 'Okuma ve analiz dogrudan yapilir. Portalda islem baslatan komutlar once preview_agent_command ile previewId uretir; kullanici ONAYLIYORUM #PRV-XXXX yazarsa create_confirmed_agent_command calisir.',
      currentLimits: [
        'Agent tarafında olmayan yeni bir işlem doğrudan yapılmaz; önce uygun agent/action olarak komut kuyruğuna alınır.',
        'WhatsApp belge gönderme, evrak talebi, konuşma başlatma ve arama istekleri onaylı komut olarak hazırlanır; gerçek gönderim/arama bağlı WhatsApp oturumunun desteklediği işlemlerle sınırlıdır.',
        'Resmi kaynak araştırması internet erişimi ve resmi sitelerin erişilebilirliğine bağlıdır.',
        'Kalıcı öğrenme yalnızca ofis/mükellef/portal hafızasına yazılan notlarla yapılır; gereksiz kişisel veri saklanmaz.',
      ],
    };
  }

  private async researchOfficialSources(input: any, ctx: { tenantId: string; userId?: string | null }) {
    const query = String(input?.query || '').trim();
    if (!query) return { error: 'query zorunlu' };

    const limit = Math.max(1, Math.min(Number(input?.limit || 2), 4));
    const domains = this.normalizeOfficialDomains(input?.domains);
    const domainFilter = domains.map((domain) => `site:${domain}`).join(' OR ');
    const searchQuery = `${query} ${domainFilter}`;
    const bingUrl = `https://www.bing.com/search?setlang=tr&q=${encodeURIComponent(searchQuery)}`;
    const html = await this.fetchText(bingUrl, 12000);
    const searchResults = this.parseBingResults(html, domains, limit);

    const sources = await Promise.all(
      searchResults.map(async (result) => {
        const markdown = await this.fetchText(this.readerUrl(result.url), 9000);
        const cleaned = markdown
          .replace(/\n{3,}/g, '\n\n')
          .replace(/[ \t]{2,}/g, ' ')
          .trim();
        return {
          ...result,
          excerpt: cleaned.slice(0, 900),
          fetched: cleaned.length > 0,
        };
      }),
    );

    const payload = {
      query,
      searchedAt: new Date().toISOString(),
      officialOnly: true,
      searchedDomains: domains,
      count: sources.length,
      sources,
      note: sources.length
        ? 'Cevapta bu resmi kaynaklara dayan; kaynakta açıkça görünmeyen tutarı kesinmiş gibi yazma.'
        : 'Resmi kaynak sonucu bulunamadı. Sayısal tutar/aralık uydurma; uygulanacak yolu ve hangi bilgiyle netleşeceğini kısa söyle.',
    };

    if (sources.length > 0 && input?.remember !== false) {
      try {
        const title = `Mevzuat araştırması: ${query.slice(0, 100)}`;
        const content = sources
          .slice(0, 4)
          .map((source, index) => `${index + 1}. ${source.title}\n${source.url}\n${source.snippet || source.excerpt.slice(0, 500)}`)
          .join('\n\n');
        const existing = await (this.prisma as any).aiMemory.findFirst({
          where: { tenantId: ctx.tenantId, scope: 'portal', title, isActive: true },
        }).catch(() => null);
        if (existing) {
          await (this.prisma as any).aiMemory.update({
            where: { id: existing.id },
            data: { content, importance: 3, tags: ['mevzuat', 'resmi-kaynak', 'auto-research'] },
          }).catch(() => null);
        } else {
          await (this.prisma as any).aiMemory.create({
            data: {
              tenantId: ctx.tenantId,
              scope: 'portal',
              title,
              content,
              source: 'official-research',
              importance: 3,
              tags: ['mevzuat', 'resmi-kaynak', 'auto-research'],
              createdBy: ctx.userId || null,
            },
          }).catch(() => null);
        }
      } catch {}
    }

    return payload;
  }

  private async searchAiMemory(input: any, ctx: { tenantId: string }) {
    const limit = Math.min(input?.limit || 10, 50);
    const query = String(input?.query || '').trim();
    const where: any = { tenantId: ctx.tenantId, isActive: true };
    if (input?.taxpayerId) where.taxpayerId = input.taxpayerId;
    if (input?.scope) where.scope = input.scope;
    if (query) {
      where.OR = [
        { title: { contains: query, mode: 'insensitive' } },
        { content: { contains: query, mode: 'insensitive' } },
      ];
    }
    const rows = await (this.prisma as any).aiMemory.findMany({
      where,
      orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
    });
    return { count: rows.length, memories: rows };
  }

  private async saveAiMemory(input: any, ctx: { tenantId: string; userId?: string | null }) {
    const title = String(input?.title || '').trim();
    const content = String(input?.content || '').trim();
    if (!title || !content) return { error: 'title ve content zorunlu' };
    const row = await (this.prisma as any).aiMemory.create({
      data: {
        tenantId: ctx.tenantId,
        taxpayerId: input?.taxpayerId || null,
        scope: input?.scope || (input?.taxpayerId ? 'taxpayer' : 'office'),
        title: title.slice(0, 160),
        content,
        source: 'moren-ai',
        importance: Math.max(1, Math.min(Number(input?.importance || 3), 5)),
        tags: Array.isArray(input?.tags) ? input.tags.slice(0, 12).map(String) : [],
        createdBy: ctx.userId || null,
      },
    });
    return { ok: true, memory: row };
  }

  private async getAiCostSummary(input: any, ctx: { tenantId: string }) {
    const now = new Date();
    const period = input?.period || 'month';
    const where: any = { tenantId: ctx.tenantId };
    if (period === 'today') where.createdAt = { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) };
    if (period === 'month') where.createdAt = { gte: new Date(now.getFullYear(), now.getMonth(), 1) };
    if (input?.source) where.source = input.source;

    const [usageRows, faturaEvents] = await Promise.all([
      (this.prisma as any).aiUsageLog.findMany({
        where,
        select: { source: true, costUsd: true, inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true, karar: true },
      }),
      (this.prisma as any).agentEvent.findMany({
        where: {
          tenantId: ctx.tenantId,
          agent: 'mihsap',
          status: { in: ['onaylandi', 'ok', 'basarili'] },
          ...(where.createdAt ? { ts: where.createdAt } : {}),
        },
        select: { id: true, action: true },
      }),
    ]);

    const bySource: Record<string, any> = {};
    for (const r of usageRows) {
      const key = r.source || 'other';
      bySource[key] ||= { source: key, sorguSayisi: 0, maliyetUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, kararlar: {} };
      bySource[key].sorguSayisi++;
      bySource[key].maliyetUsd += Number(r.costUsd || 0);
      bySource[key].inputTokens += r.inputTokens || 0;
      bySource[key].outputTokens += r.outputTokens || 0;
      bySource[key].cacheReadTokens += r.cacheReadTokens || 0;
      bySource[key].cacheWriteTokens += r.cacheWriteTokens || 0;
      bySource[key].totalTokens += (r.inputTokens || 0) + (r.outputTokens || 0) + (r.cacheReadTokens || 0) + (r.cacheWriteTokens || 0);
      bySource[key].kararlar[r.karar || 'unknown'] = (bySource[key].kararlar[r.karar || 'unknown'] || 0) + 1;
    }
    const totalTokens = usageRows.reduce(
      (s: number, r: any) => s + (r.inputTokens || 0) + (r.outputTokens || 0) + (r.cacheReadTokens || 0) + (r.cacheWriteTokens || 0),
      0,
    );
    const totalUsd = usageRows.reduce((s: number, r: any) => s + Number(r.costUsd || 0), 0);
    const faturaCostUsd = usageRows
      .filter((r: any) => r.source === 'mihsap-fatura')
      .reduce((s: number, r: any) => s + Number(r.costUsd || 0), 0);
    const successfulInvoices = faturaEvents.filter((e: any) => ['isle_alis', 'isle_satis'].includes(e.action)).length;
    return {
      period,
      toplam: {
        sorguSayisi: usageRows.length,
        maliyetUsd: totalUsd,
        totalTokens,
      },
      moduller: Object.values(bySource),
      fatura: {
        basariliF2Adedi: successfulInvoices,
        aiMaliyetUsd: faturaCostUsd,
        birimMaliyetUsd: successfulInvoices > 0 ? faturaCostUsd / successfulInvoices : null,
      },
    };
  }
}
