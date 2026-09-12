import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ModuleRef } from '@nestjs/core';
import { MIHSAP_FATURA_ACTIONS, isMihsapFaturaCommandAgent } from '../agent-events/agent-registry';
import { calculateBeyannameDeadline, kalanGunHesapla, gunAdi } from '../schedule/beyanname-deadline.util';
import { hesaplaCariBakiyeler, borcluOzeti } from '../common/cari-bakiye';
import { ISLEM_OPERATIONS, ISLEM_ACTION_KEYS, islemCapabilityList, isIslemAction } from './islem-operations';
import { TDHP, tdhpAciklama, vergiOranlari, vergiOraniAciklama } from '../common/accounting-reference';
import { computeMonthlyStatusList, computeTaxPayableList } from './monthly-status.shared';
import { randomBytes } from 'crypto';

const OFFICIAL_SOURCE_DOMAINS = [
  'gib.gov.tr',
  'sgk.gov.tr',
  'resmigazete.gov.tr',
  'mevzuat.gov.tr',
  'bedesten.adalet.gov.tr',
  'turkiye.gov.tr',
  'calisma.gov.tr',
  'csgb.gov.tr',
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

  constructor(
    private prisma: PrismaService,
    // GundemService dinamik cozulur (modul dongusu olmasin) — Isletme Hesap Ozeti
    // servisinin WhatsAppService icin kullandigi desenin aynisi.
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  /**
   * Tool çağrısını execute eder. name + input → result (JSON-serializable).
   * Hata olursa { error } döner — AI bunu görüp yanıtı uyarır.
   */
  async execute(
    name: string,
    input: any,
    ctx: { tenantId: string; userId?: string | null; taxpayerId?: string | null; signal?: AbortSignal },
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
        case 'get_kdv1_on_hazirlik': return this.getKdv1OnHazirlik(input, ctx);
        case 'list_tax_payable':    return this.getTaxPayableList(input, ctx);
        case 'list_kdv_payable':    return this.getTaxPayableList({ ...input, beyanTipi: input?.beyanTipi || 'KDV' }, ctx);
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
        case 'get_accounting_reference': return this.getAccountingReference(input);
        case 'get_bank_status': return this.getBankStatus(input, ctx);
        case 'get_cari_hareketler': return this.getCariHareketler(input, ctx);
        case 'list_earsiv_invoices': return this.listEarsivInvoices(input, ctx);
        case 'list_tasks': return this.listTasks(input, ctx);
        case 'list_etebligat': return this.listETebligat(input, ctx);
        case 'get_gundem': return this.getGundem(input, ctx);
        case 'list_fatura_merkezi': return this.listFaturaMerkezi(input, ctx);
        case 'list_edefter_sessions': return this.listEdefterSessions(input, ctx);
        case 'list_automations': return this.listAutomations(input, ctx);
        case 'get_my_tebligat': return this.getMyTebligat(input, ctx);
        case 'get_my_sgk': return this.getMySgk(input, ctx);
        case 'get_my_isletme_hesap_ozeti': return this.getMyIsletmeHesapOzeti(input, ctx);
        case 'get_my_vergi_takvimi': return this.getMyVergiTakvimi(input, ctx);
        case 'get_isletme_hesap_ozeti': return this.getIsletmeHesapOzeti(input, ctx);
        case 'get_beyanname_readiness_summary': return this.getBeyannameReadinessSummary(input, ctx);
        case 'get_portal_capability_map': return this.getPortalCapabilityMap();
        case 'research_official_sources': return this.researchOfficialSources(input, ctx);
        case 'search_ai_memory':      return this.searchAiMemory(input, ctx);
        case 'save_ai_memory':        return this.saveAiMemory(input, ctx);
        case 'create_agent_command':  return this.createAgentCommand(input, ctx);
        case 'get_ai_cost_summary':   return this.getAiCostSummary(input, ctx);
        // FATURA MERKEZİ AJAN ARAÇLARI (fm_*) — PLAN/15 Faz 5; FmAjanService dinamik çözülür.
        case 'fm_belge_listele':
        case 'fm_belge_detay':
        case 'fm_donem_ozeti':
        case 'fm_uyumsuzluklar':
        case 'fm_hesap_plani_ara':
        case 'fm_hesap_ata':
        case 'fm_ai_ile_oku':
        case 'fm_isaretle':
        case 'fm_onayla':
        case 'fm_luca_gonder':
          return this.fmAjanAraci(name, input, ctx);
        // MALİ TABLO YARDIMCILARI + EKİP İŞ ZİNCİRİ (PLAN/17 §3 — 2026-09-13)
        case 'mali_donemler_listele':  return this.maliDonemlerListele(input, ctx);
        case 'mali_yorum_oku':         return this.maliYorumOku(input, ctx);
        case 'kdv_kontrol_oturum_bul_olustur': return this.kdvKontrolOturumBulOlustur(input, ctx);
        case 'kdv_kontrol_luca_cek':   return this.kdvKontrolLucaCek(input, ctx);
        case 'luca_is_bekle':          return this.lucaIsBekle(input, ctx);
        case 'kdv_kontrol_fatura_bagla': return this.kdvKontrolFaturaBagla(input, ctx);
        case 'kdv_kontrol_ocr_baslat': return this.kdvKontrolOcrBaslat(input, ctx);
        case 'kdv_kontrol_ocr_bekle':  return this.kdvKontrolOcrBekle(input, ctx);
        case 'kdv_kontrol_eslestir':   return this.kdvKontrolEslestir(input, ctx);
        case 'kdv_kontrol_sonuc_satirlari': return this.kdvKontrolSonucSatirlari(input, ctx);
        case 'ekip_ajan_baslat':       return this.ekipAjanBaslat(input, ctx);
        case 'ekip_is_durum':          return this.ekipIsDurum(input, ctx);
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
    const tam: any = await this.getTaxpayerWorkStatus({ ...input, taxpayerId: taxpayer.id }, ctx);
    if (tam?.error) return tam;
    // GIZLILIK KALKANI: getTaxpayerWorkStatus OFIS ICI alanlar donduruyor —
    // hafizaNotlari (mukellef hakkinda ic notlar), sonAgentOlaylari (otomasyon
    // gunlugu), score/durum (ic risk puani) ve "banka hesabi yok / acik cari bakiye
    // var" gibi ic degerlendirmeler. Bunlar MUKELLEFE GITMEZ. Mukellefe yalnizca
    // KENDI is akisindaki somut asamalar bildirilir.
    const v = tam?.veri || {};
    const eksikler: string[] = Array.isArray(tam?.eksikler) ? tam.eksikler : [];
    const mukellefeUygun = eksikler.filter((e) => /evrak/i.test(e));
    return {
      ad: tam.ad,
      donem: tam.period,
      evrakDurumu: mukellefeUygun.length ? mukellefeUygun.join(', ') : 'evrak akisinda eksik gorunmuyor',
      beyannameKaydiVar: Number(v.beyanKaydi || 0) > 0,
      faturaSayisi: v.mihsapFatura ?? null,
      not: 'Ayrintili durum icin musavirinize danisin.',
    };
  }

  /** Mukellefin KENDI e-Tebligat/SGK belgeleri (PortalDocument). taxpayerId kilitli. */
  private async getMyPortalDocuments(input: any, ctx: { tenantId: string; taxpayerId?: string | null }, turler: string[]) {
    const taxpayer = await this.scopedTaxpayer(ctx);
    if (!taxpayer) return { error: 'Aktif mukellef baglami yok.' };
    const limit = Math.min(Math.max(Number(input?.limit) || 10, 1), 25);
    const docs = await (this.prisma as any).portalDocument.findMany({
      where: { tenantId: ctx.tenantId, taxpayerId: taxpayer.id, belgeTuru: { in: turler } },
      orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: { belgeTuru: true, title: true, period: true, referenceNo: true, issuedAt: true, viewedAt: true },
    }).catch(() => []);
    const iso = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : null);
    return {
      adet: docs.length,
      belgeler: docs.map((d: any) => ({
        tur: d.belgeTuru, baslik: d.title, donem: d.period || '-',
        refNo: d.referenceNo || '-', tarih: iso(d.issuedAt), okundu: !!d.viewedAt,
      })),
      not: docs.length === 0 ? 'Bu turde belgeniz gorunmuyor.' : undefined,
    };
  }

  /** Mukellefin KENDI e-Tebligatlari. */
  private async getMyTebligat(input: any, ctx: { tenantId: string; taxpayerId?: string | null }) {
    return this.getMyPortalDocuments(input, ctx, ['E_TEBLIGAT']);
  }

  /** Mukellefin KENDI SGK belgeleri (tahakkuk fisi, hizmet listesi). */
  private async getMySgk(input: any, ctx: { tenantId: string; taxpayerId?: string | null }) {
    return this.getMyPortalDocuments(input, ctx, ['SGK_TAHAKKUK', 'SGK_HIZMET_LISTESI', 'SGK']);
  }

  /** Mukellefin KENDI isletme hesap ozeti (yil + istege bagli donem). */
  private async getMyIsletmeHesapOzeti(input: any, ctx: { tenantId: string; taxpayerId?: string | null }) {
    const taxpayer = await this.scopedTaxpayer(ctx);
    if (!taxpayer) return { error: 'Aktif mukellef baglami yok.' };
    return this.getIsletmeHesapOzeti({ ...input, taxpayerId: taxpayer.id }, ctx as any);
  }

  /** Mukellefin KENDI vergi takvimi — yaklasan beyanname/odeme son gunleri. */
  private async getMyVergiTakvimi(input: any, ctx: { tenantId: string; taxpayerId?: string | null }) {
    const taxpayer = await this.scopedTaxpayer(ctx);
    if (!taxpayer) return { error: 'Aktif mukellef baglami yok.' };
    return this.getTaxCalendar({ ...input, taxpayerId: taxpayer.id }, ctx as any);
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
        return this.redactKdvForTaxpayer({ ...fallback, not: `${donem} icin KDV kontrol kaydi yok; en son ${latestDonem} donemi gosteriliyor.` });
      }
    }
    return this.redactKdvForTaxpayer(res);
  }

  /**
   * MÜKELLEF KORUMASI: KDV özetindeki PARASAL tutarları (toplam/ödenecek KDV) mükelleften
   * GİZLE. Mükellef yalnız DURUM görmeli (kontrol tamam mı, eşleşme); ödenecek/tahakkuk
   * tutarını müşavir kesinleştirir. Eskiden tutar sızıyor + iki figür "X ile Y arası" gibi
   * kafa karıştırıcı aralık olarak çıkıyordu. (Owner'ın get_kdv_summary'si bu kırpmadan GEÇMEZ.)
   */
  private redactKdvForTaxpayer(res: any): any {
    if (!res || res.error) return res;
    const stripAmount = (arr: any[]) =>
      Array.isArray(arr) ? arr.map(({ lucaToplamKdv, ...rest }: any) => rest) : arr;
    let ozet = res.whatsappOzet;
    if (typeof ozet === 'string') {
      ozet = ozet
        .split('\n')
        .filter((ln: string) => !/(toplam kdv|odenecek|ödenecek|tahakkuk|₺)/i.test(ln))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }
    return {
      ...res,
      ...(ozet ? { whatsappOzet: ozet } : { whatsappOzet: undefined }),
      aktifSeanslar: stripAmount(res.aktifSeanslar),
      arsivlenenlerden: stripAmount(res.arsivlenenlerden),
      tutarPolitikasi:
        'MÜKELLEFE KDV ödenecek/tahakkuk/toplam TUTARINI SÖYLEME ve RAKAM ARALIĞI ("X ile Y arası") VERME. ' +
        'Sadece kontrol DURUMUNU söyle (ör. "Mayıs KDV kontrolü tamamlandı, eşleşmeler tamam"). ' +
        'Tutar sorulursa: "Müşavirimiz kesinleştirince size iletecek" de. Rakam UYDURMA.',
    };
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
      select: { beyanTipi: true, donem: true, onayNo: true, beyanTarihi: true, beyannameUrl: true, pdfUrl: true, tahakkukTutari: true, createdAt: true },
    }).catch(() => []);
    return {
      adet: kayitlar.length,
      // POLİTİKA: Ödenecek/tahakkuk tutarı burada PAYLAŞILMAZ (müşavir kesinleştirir).
      tutarPolitikasi: 'Odenecek/tahakkuk tutarini musteriye verme; "musavirimiz kesinlestirince iletir" de.',
      durumNotu: 'durum=verildi ise beyanname GİB\'e verilmiştir; onayNo boş olması "verilmedi" anlamına GELMEZ. Belge (beyanname/tahakkuk PDF) varsa beyanname VERİLMİŞTİR — "verilmemiş" deme.',
      kayitlar: (kayitlar || []).map((k: any) => {
        const verildi = Boolean(k.beyanTarihi || k.onayNo || k.beyannameUrl || k.pdfUrl || k.tahakkukTutari);
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
    const [sonHareketler, tumHareketler, sonOdemeRow] = await Promise.all([
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
      // "En son ne zaman ödeme yaptım" sorusunu GARANTİLE: son 12 hareket hep tahakkuk
      // olsa bile en güncel TAHSILAT'ı ayrıca çek (yoksa AI ödeme tarihini uyduramasın).
      cariClient.findFirst({
        where: { tenantId: ctx.tenantId, taxpayerId: taxpayer.id, tip: 'TAHSILAT' },
        orderBy: { tarih: 'desc' },
        select: { tarih: true, tutar: true, odemeYontemi: true, aciklama: true },
      }).catch(() => null),
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
      // Son ödeme (en güncel tahsilat) — "en son ne zaman/ne kadar ödedim" sorularını cevaplar.
      sonOdeme: sonOdemeRow
        ? {
            tarih: sonOdemeRow.tarih?.toISOString?.().slice(0, 10),
            tutar: this.toNum(sonOdemeRow.tutar),
            odemeYontemi: sonOdemeRow.odemeYontemi || '-',
            aciklama: sonOdemeRow.aciklama || '',
          }
        : null,
      sonOdemeNotu: sonOdemeRow ? undefined : 'Sistemde kayıtlı tahsilat/ödeme görünmüyor.',
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

  /** Mali tablo araçlarının kabul ettiği dönem biçimleri — hata mesajlarında ajana aynen gösterilir. */
  private static readonly MALI_DONEM_BICIMI =
    'Dönem biçimi: "YYYY-MM" (aylık, ör. 2026-06), "YYYY-Qn" (geçici vergi/çeyrek, ör. 2026-Q2) ya da "YYYY-YILLIK".';

  /**
   * Ajanların yazdığı dönem ifadesini tek biçime indirir (2026-09-12: pilotta "Q2", "2026/Q2", "2026-6" gibi
   * yazımlar geliyordu). Dönüş: "YYYY-MM" | "YYYY-Qn" | "YYYY-YILLIK" | null (anlaşılamadı).
   * `yil` yalnız "Q2" gibi yılsız çeyrek yazımında kullanılır; yıl bilinmiyorsa null (varsayımla yanlış yıla gitmesin).
   */
  private normalizeFinancialPeriod(donem: any, yil?: any): string | null {
    const raw = String(donem ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!raw) return null;
    const yilNo = Number(yil);
    const yilStr = Number.isInteger(yilNo) && yilNo >= 1990 && yilNo <= 2100 ? String(yilNo) : null;

    // "2026-Q2", "2026Q2", "2026/Q2", "2026 Q2", "2026-2Q"
    let m = raw.match(/^(\d{4})[\s/._-]?Q([1-4])$/) || raw.match(/^(\d{4})[\s/._-]?([1-4])Q$/);
    if (m) return `${m[1]}-Q${m[2]}`;
    // "Q2 2026", "Q2-2026", "Q2/2026"
    m = raw.match(/^Q([1-4])[\s/._-]?(\d{4})$/);
    if (m) return `${m[2]}-Q${m[1]}`;
    // "Q2" (yıl ayrı parametreyle)
    m = raw.match(/^Q([1-4])$/);
    if (m) return yilStr ? `${yilStr}-Q${m[1]}` : null;
    // "2026-06", "2026/6", "2026.06"
    m = raw.match(/^(\d{4})[\s/._-](\d{1,2})$/);
    if (m) {
      const ay = Number(m[2]);
      if (ay >= 1 && ay <= 12) return `${m[1]}-${String(ay).padStart(2, '0')}`;
      return null;
    }
    // "2026", "2026-YILLIK", "2026 YILLIK", "2026-YIL"
    m = raw.match(/^(\d{4})(?:[\s/._-]?Y[Iİ]L(?:L[Iİ]K)?)?$/);
    if (m) return `${m[1]}-YILLIK`;
    return null;
  }

  private financialPeriodCandidates(donem: any, yil?: any): string[] {
    const raw = String(donem || '').trim();
    if (!raw) return [];
    const out = new Set<string>([raw]);
    const norm = this.normalizeFinancialPeriod(raw, yil);
    if (norm) out.add(norm);

    const quarter = (norm || raw).match(/^(\d{4})-?Q([1-4])$/i);
    if (quarter) {
      out.add(`${quarter[1]}-${String(Number(quarter[2]) * 3).padStart(2, '0')}`);
      out.add(`${quarter[1]}-Q${quarter[2]}`);
    }

    const monthly = (norm || raw).match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    if (monthly) {
      const month = Number(monthly[2]);
      if ([3, 6, 9, 12].includes(month)) out.add(`${monthly[1]}-Q${month / 3}`);
    }

    // Yıllık: kayıtlar "2025-YILLIK", "2025", "2025-12" ya da "2025-Q4" etiketiyle durabiliyor.
    const yillik = (norm || raw).match(/^(\d{4})-YILLIK$/);
    if (yillik) {
      out.add(yillik[1]);
      out.add(`${yillik[1]}-12`);
      out.add(`${yillik[1]}-Q4`);
    }

    return Array.from(out);
  }

  /**
   * Mükellefin sistemde mevcut mali tablo dönemleri (mizan / bilanço / gelir tablosu; tekil, yeniden eskiye).
   * "Bulunamadı" hatalarında ajana listelenir → boş dönemde rakam uydurmak yerine mevcut dönemi seçer.
   */
  private async mevcutMaliDonemler(taxpayerId: string, ctx: { tenantId: string }) {
    const where = { tenantId: ctx.tenantId, taxpayerId };
    const select = { donem: true } as const;
    const [mizan, bilanco, gelirTablosu] = await Promise.all([
      this.prisma.mizan.findMany({ where, select, distinct: ['donem'] }).catch(() => [] as { donem: string }[]),
      this.prisma.bilanco.findMany({ where, select, distinct: ['donem'] }).catch(() => [] as { donem: string }[]),
      this.prisma.gelirTablosu.findMany({ where, select, distinct: ['donem'] }).catch(() => [] as { donem: string }[]),
    ]);
    const sirala = (rows: { donem: string }[]) =>
      Array.from(new Set(rows.map((r) => r.donem))).sort((a, b) => b.localeCompare(a));
    return { mizan: sirala(mizan), bilanco: sirala(bilanco), gelirTablosu: sirala(gelirTablosu) };
  }

  private donemListesiMetni(liste: string[]): string {
    return liste.length ? liste.join(', ') : 'yok';
  }

  /** "100,102" / ["100","102"] / "6" → önek listesi (boşsa []). */
  private hesapKoduOnekleri(girdi: any): string[] {
    const ham: any[] = Array.isArray(girdi) ? girdi : girdi == null ? [] : String(girdi).split(/[,;|\s]+/);
    return Array.from(new Set(ham.map((x) => String(x ?? '').trim()).filter(Boolean)));
  }

  private yuvarla2(n: number): number {
    return Math.round(n * 100) / 100;
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

  /**
   * Arama motoru yonlendirme linkini GERCEK adrese cevirir.
   *  - DuckDuckGo: //duckduckgo.com/l/?uddg=<url-encoded>
   *  - Bing:       /ck/a?...&u=a1<base64url>
   * Bu cozum olmadan sonuclarin TAMAMI "resmi alan adi degil" diye eleniyordu:
   * canli testte Bing'in 10 sonucunun 10'u da ck/a yonlendirmesiydi, yani
   * research_official_sources her cagrida 0 kaynak donuyordu (arac fiilen oluydu).
   */
  private cozYonlendirme(raw: string): string {
    let url = this.decodeHtml(String(raw || '')).replace(/&amp;/g, '&');
    if (url.startsWith('//')) url = 'https:' + url;
    try {
      const u = new URL(url);
      const uddg = u.searchParams.get('uddg');
      if (uddg) return uddg;
      if (/bing\.com$/i.test(u.hostname.replace(/^www\./, '')) && u.pathname.startsWith('/ck/')) {
        const raw64 = u.searchParams.get('u') || '';
        const b64 = raw64.replace(/^a1/, '').replace(/-/g, '+').replace(/_/g, '/');
        if (b64) {
          const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
          const cozulen = Buffer.from(pad, 'base64').toString('utf8');
          if (/^https?:\/\//i.test(cozulen)) return cozulen;
        }
      }
    } catch { /* bozuk adres — ham hali donsun, suzgec elesin */ }
    return url;
  }

  /**
   * DuckDuckGo HTML sonuclari. Bing'in yerine BIRINCIL arama yolu; canli testte
   * Bing tum sonuclari yonlendirmeye sardigi icin guvenilir degil.
   */
  private parseDuckDuckGoResults(html: string, allowedDomains: string[], limit: number) {
    const results: Array<{ title: string; url: string; snippet: string; domain: string }> = [];
    const bloklar = html.match(/<div class="result__body"[\s\S]*?<\/div>\s*<\/div>/gi)
      || html.match(/<a[^>]+class="result__a"[\s\S]{0,1200}?<\/a>/gi)
      || [];
    for (const blok of bloklar) {
      const link = blok.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!link) continue;
      const url = this.cozYonlendirme(link[1]);
      if (!this.isAllowedOfficialUrl(url, allowedDomains)) continue;
      const snip = blok.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)
        || blok.match(/class="result__snippet"[^>]*>([\s\S]*?)<\//i);
      let domain = '';
      try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch {}
      results.push({
        title: this.decodeHtml(link[2]).replace(/<[^>]+>/g, '').trim(),
        url,
        domain,
        snippet: snip ? this.decodeHtml(snip[1]).replace(/<[^>]+>/g, '').trim() : '',
      });
      if (results.length >= limit) break;
    }
    return results;
  }

  private parseBingResults(html: string, allowedDomains: string[], limit: number) {
    const results: Array<{ title: string; url: string; snippet: string; domain: string }> = [];
    const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/gi) || [];
    for (const block of blocks) {
      const link = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!link) continue;
      const url = this.cozYonlendirme(link[1]);
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
        defterTuru: true, mihsapDefterTuru: true,
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
          defterTuru: true, mihsapDefterTuru: true,
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
        // PLAN/17 §0 bulgu 6 (2026-09-13): defter türü ajana görünsün — işletme/bilanço dalı buradan seçilir.
        defterTuru: this.defterTuruNormalize(t),
      })),
    };
  }

  /**
   * Defter türü tek değere indirgenir: BILANCO | ISLETME | null.
   * Öncelik taxpayer.defterTuru; boşsa Mihsap alanı (BILANCO | DEFTER_BEYAN | BASIT → DEFTER_BEYAN/BASIT = ISLETME).
   * Canlı 2026-09-13: 87 BILANCO/BILANCO, 74 ISLETME/DEFTER_BEYAN, 1 ISLETME/BASIT, 13 boş.
   */
  private defterTuruNormalize(t: { defterTuru?: string | null; mihsapDefterTuru?: string | null } | null | undefined): 'BILANCO' | 'ISLETME' | null {
    const oz = String(t?.defterTuru || '').trim().toUpperCase();
    if (oz === 'BILANCO' || oz === 'ISLETME') return oz;
    const mh = String(t?.mihsapDefterTuru || '').trim().toUpperCase();
    if (mh === 'BILANCO') return 'BILANCO';
    if (mh === 'DEFTER_BEYAN' || mh === 'BASIT' || mh === 'ISLETME') return 'ISLETME';
    return null;
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
      // PLAN/17 §0 bulgu 6 (2026-09-13): defter türü — KDV Kontrol oturum türü / İHÖ-GT dalı buna göre.
      defterTuru: this.defterTuruNormalize(t),
      mihsapDefterTuru: t.mihsapDefterTuru ?? null,
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
    // TEK KAYNAK: Aylık durum listesini WhatsApp kısayolu ile AYNI fonksiyondan al
    // (monthly-status.shared → computeMonthlyStatusList). Böylece sayfa ve WhatsApp
    // harfi harfine aynı cevabı verir, dönem mantığı (verildi→dinamik dönem dahil) tek yerde.
    const evrakFilter = (input?.evrakDurumu || 'tumu') as string;
    const beyannameFilter = (input?.beyannameDurumu || 'tumu') as string;
    const onlyActive = input?.onlyActive !== false;

    const list = await computeMonthlyStatusList(this.prisma, {
      tenantId: ctx.tenantId,
      period: input?.period,
      verildiMode: beyannameFilter === 'verildi',
      onlyActive,
    });
    const { year, month, islemAyi, beyannameDonem } = list;

    // Satırlar tek kaynaktan; filtreyi BURADA uygula (aynı satırlar → aynı sonuç).
    let rows = list.rows;
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

    return {
      // Kullanıcıya-dönük dönem = BEYANNAME dönemi (veri dönemi). Bot bunu söylemeli.
      donem: beyannameDonem,
      beyannameDonem,
      islemAyi,
      // İstenen ay boştu, veri olan en son işlem ayına düşüldü → AI uydurma "yok" demesin,
      // gerçek dönemi söylesin.
      bosDonemFallback: list.bosDonemFallback || undefined,
      bosDonemNotu: list.bosDonemFallback
        ? `Sorulan ay için kayıt yoktu; veri bulunan en son dönem olan ${beyannameDonem} gösteriliyor. Cevapta bu dönemi (${beyannameDonem}) açıkça belirt.`
        : undefined,
      donemNotu: `Bu evrak/işlem kayıtları İŞLEM ayı ${islemAyi}'de tutulur ama ait oldukları VERİ/beyanname dönemi ${beyannameDonem}'dir (işlem ayı−1). Owner'a/mükellefe dönemden bahsederken DAİMA beyanname dönemini (${beyannameDonem}) söyle; işlem ayını (${islemAyi}) SÖYLEME — "${islemAyi}'da evrak geldi" YANLIŞ/kafa karıştırıcı, doğrusu "${beyannameDonem} dönemi evrakı (${islemAyi}'da işlenir)".`,
      toplamMukellef: list.toplamMukellef,
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

  /** get_mizan tek seferde en çok bu kadar hesap döndürür (2026-09-12: eski sabit 100 tavanı kalktı). */
  private static readonly MIZAN_SAYFA_BOYUTU = 400;

  private async getMizan(input: any, ctx: { tenantId: string }) {
    const donemler = this.financialPeriodCandidates(input.donem, input?.yil);
    const mizan = await this.prisma.mizan.findFirst({
      where: { tenantId: ctx.tenantId, taxpayerId: input.taxpayerId, donem: donemler.length ? { in: donemler } : input.donem },
      include: {
        hesaplar: { orderBy: { hesapKodu: 'asc' } },
        anomaliler: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!mizan) {
      const mevcut = await this.mevcutMaliDonemler(input.taxpayerId, ctx);
      return {
        error:
          `${input.donem} dönemine ait mizan bulunamadı. Mevcut mizan dönemleri: ${this.donemListesiMetni(mevcut.mizan)}. ` +
          ToolExecutorService.MALI_DONEM_BICIMI,
        mevcutDonemler: mevcut.mizan,
      };
    }

    let hesaplar = mizan.hesaplar;
    // Önek süzgeci: hesapKoduFiltresi ya da hesapKodu; "100,102" / ["100","102"] de kabul (pilotta dizi geliyordu → boş dönüyordu).
    const onekler = this.hesapKoduOnekleri(input?.hesapKoduFiltresi ?? input?.hesapKodu);
    if (onekler.length) {
      hesaplar = hesaplar.filter((h) => onekler.some((p) => h.hesapKodu.startsWith(p)));
    }

    const toplamBorc = hesaplar.reduce((s, h) => s + this.toNum(h.borcToplami), 0);
    const toplamAlacak = hesaplar.reduce((s, h) => s + this.toNum(h.alacakToplami), 0);

    // Sayfalama: eski sabit 100 tavanı 144 hesaplık mizanda 44 hesabı gizliyordu (Denetçi görmediği 136.2x hesabı uydurdu).
    // Varsayılan 400; aşarsa truncated:true + toplamHesap + daraltma yolu (önek ya da sayfa) açıkça söylenir.
    const sayfaBoyutuHam = Number(input?.sayfaBoyutu);
    const sayfaBoyutu = Number.isFinite(sayfaBoyutuHam) && sayfaBoyutuHam >= 1
      ? Math.min(Math.floor(sayfaBoyutuHam), 1000)
      : ToolExecutorService.MIZAN_SAYFA_BOYUTU;
    const toplamHesap = hesaplar.length;
    const toplamSayfa = Math.max(1, Math.ceil(toplamHesap / sayfaBoyutu));
    const sayfaHam = Number(input?.sayfa);
    const sayfa = Number.isFinite(sayfaHam) && sayfaHam >= 1 ? Math.floor(sayfaHam) : 1;
    if (sayfa > toplamSayfa) {
      return {
        error: `sayfa ${sayfa} yok; bu süzgeçte toplam ${toplamHesap} hesap, ${toplamSayfa} sayfa (sayfa başına ${sayfaBoyutu}).`,
        toplamHesap,
        toplamSayfa,
      };
    }
    const gosterilen = hesaplar.slice((sayfa - 1) * sayfaBoyutu, sayfa * sayfaBoyutu);
    const truncated = toplamHesap > gosterilen.length;

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
      // Aynı dönemde birden çok çekim olabilir; en yenisi döner — raporda "hangi çekim" diyebilsin.
      mizanId: mizan.id,
      cekimTarihi: mizan.createdAt?.toISOString().slice(0, 10),
      // Hazır WhatsApp şablonu — bot bunu AYNEN gönderir, altına 1-2 cümle yorum ekler.
      whatsappOzet: mizanWhatsappOzet,
      toplamBorc,
      toplamAlacak,
      dengeliMi: Math.abs(toplamBorc - toplamAlacak) < 1,
      hesapSayisi: toplamHesap,
      hesapKoduFiltresi: onekler.length ? onekler : undefined,
      hesaplar: gosterilen.map((h) => ({
        hesapKodu: h.hesapKodu,
        hesapAdi: h.hesapAdi,
        borcToplami: this.toNum(h.borcToplami),
        alacakToplami: this.toNum(h.alacakToplami),
        borcBakiye: this.toNum(h.borcBakiye),
        alacakBakiye: this.toNum(h.alacakBakiye),
      })),
      // Sayfalama bilgisi — truncated:true ise gösterilmeyen hesaplar VAR; ajan bunları "yok" sayamaz.
      truncated,
      toplamHesap,
      sayfa,
      toplamSayfa,
      sayfaBoyutu,
      ...(truncated
        ? {
            daraltmaNotu:
              `Mizanda ${toplamHesap} hesap var, bu sayfada ${gosterilen.length} tanesi gösterildi (sayfa ${sayfa}/${toplamSayfa}). ` +
              `Kalanı görmek için grup (ör. hesapKodu:'136') ya da sayfa (sayfa:${sayfa + 1}) ile daralt; görmediğin hesabı yazma.`,
          }
        : {}),
      // Geriye uyum (eski alan adları)
      hesapSayisiGosterilenMaksimum: gosterilen.length,
      hesapSayisiToplam: toplamHesap,
      anomaliler: mizan.anomaliler.map((a) => ({
        hesapKodu: a.hesapKodu, tip: a.tip, seviye: a.seviye, mesaj: a.mesaj,
      })),
    };
  }

  // ------------------------------------------------------------
  // GELİR TABLOSU
  // ------------------------------------------------------------
  private async getGelirTablosu(input: any, ctx: { tenantId: string }) {
    const donemler = this.financialPeriodCandidates(input.donem, input?.yil);
    // PLAN/17 R2 adım 3 (2026-09-13): aynı dönemde birden çok kopya varsa KİLİTLİ olan tercih edilir
    // (canlıda 12 mükellef×dönem çiftinde çoklu GT; eski sıralama yalnız createdAt desc → kilitsiz taslak dönüyordu).
    const gtWhere = { tenantId: ctx.tenantId, taxpayerId: input.taxpayerId, donem: donemler.length ? { in: donemler } : input.donem };
    const gt = await this.prisma.gelirTablosu.findFirst({
      where: gtWhere,
      orderBy: [{ locked: 'desc' }, { createdAt: 'desc' }],
    });
    if (!gt) {
      // 2026-09-12: "bulunamadı" tek başına ajanı boşlukta bırakıyordu → mevcut dönemler + biçim eklendi.
      const mevcut = await this.mevcutMaliDonemler(input.taxpayerId, ctx);
      return {
        error:
          `${input.donem} dönemine ait gelir tablosu bulunamadı. Mevcut gelir tablosu dönemleri: ${this.donemListesiMetni(mevcut.gelirTablosu)}` +
          (mevcut.mizan.length ? `; mizan dönemleri: ${this.donemListesiMetni(mevcut.mizan)} (get_mizan hesapKoduFiltresi "6" ile türetilebilir)` : '') +
          `. ${ToolExecutorService.MALI_DONEM_BICIMI}`,
        mevcutDonemler: mevcut,
      };
    }

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

    // Kopya sayımı + geçici vergi hesabı (GelirTablosuService.getGelirTablosu türetir; mizan modülü kilitli → yalnız çağrılır).
    const kopyalar: Array<{ id: string; locked: boolean }> = await this.prisma.gelirTablosu
      .findMany({ where: gtWhere, select: { id: true, locked: true } })
      .catch(() => [] as Array<{ id: string; locked: boolean }>);
    let geciciVergiHesabi: any = null;
    try {
      const { GelirTablosuService } = await import('../mizan/gelir-tablosu.service');
      const gtSvc: any = this.moduleRef?.get?.(GelirTablosuService, { strict: false });
      if (gtSvc?.getGelirTablosu) {
        const detay = await gtSvc.getGelirTablosu(gt.id, ctx.tenantId);
        geciciVergiHesabi = detay?.geciciVergiHesabi ?? null;
      }
    } catch (e: any) {
      this.logger.warn(`get_gelir_tablosu geçici vergi hesabı alınamadı: ${e?.message || e}`);
    }

    return {
      donem: gt.donem,
      donemTipi: gt.donemTipi,
      kayitId: gt.id,
      donemBaslangic: gt.donemBaslangic?.toISOString().slice(0, 10),
      donemBitis: gt.donemBitis?.toISOString().slice(0, 10),
      kilitli: gt.locked,
      kilitTarihi: gt.lockedAt ? gt.lockedAt.toISOString().slice(0, 10) : null,
      kopyaSayisi: kopyalar.length || 1,
      kilitliKopyaVar: kopyalar.some((k) => k.locked) || gt.locked === true,
      mizanId: gt.mizanId ?? null,
      duzeltmeler: gt.duzeltmeler ?? null,
      geciciVergiHesabi,
      kaynak: `portal GT ${gt.id}${gt.locked ? ` (kilitli${gt.lockedAt ? ' ' + gt.lockedAt.toISOString().slice(0, 10) : ''})` : ' (kilitsiz taslak)'}`,
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
    const donemler = this.financialPeriodCandidates(input.donem, input?.yil);
    const b = await this.prisma.bilanco.findFirst({
      where: { tenantId: ctx.tenantId, taxpayerId: input.taxpayerId, donem: donemler.length ? { in: donemler } : input.donem },
      orderBy: { createdAt: 'desc' },
    });
    if (!b) {
      // 2026-09-12: "bulunamadı" tek başına ajanı boşlukta bırakıyordu → mevcut dönemler + biçim eklendi.
      const mevcut = await this.mevcutMaliDonemler(input.taxpayerId, ctx);
      return {
        error:
          `${input.donem} dönemine ait bilanço bulunamadı. Mevcut bilanço dönemleri: ${this.donemListesiMetni(mevcut.bilanco)}` +
          (mevcut.mizan.length ? `; mizan dönemleri: ${this.donemListesiMetni(mevcut.mizan)}` : '') +
          `. ${ToolExecutorService.MALI_DONEM_BICIMI}`,
        mevcutDonemler: mevcut,
      };
    }

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
      kayitId: b.id,
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

  /**
   * PORTFÖY-GENELİ VERGİ ÖDEMESİ — TEK KAYNAK (monthly-status.shared.computeTaxPayableList).
   * Deterministik fast-path (buildOwnerTaxPayableReply) ile AYNI fonksiyon → tutarsızlık yok.
   * SADECE owner (tutar içerir).
   */
  private async getTaxPayableList(input: any, ctx: { tenantId: string }) {
    const list = await computeTaxPayableList(this.prisma, {
      tenantId: ctx.tenantId,
      beyanTipi: input?.beyanTipi || input?.tip || input?.vergiTuru,
      period: input?.period || input?.donem,
      onlyActive: input?.onlyActive,
      onlyPayable: input?.sadeceOdemeCikan,
    });
    return {
      vergiTuru: list.vergiTuru,
      donem: list.donem,
      mukellefSayisi: list.mukellefSayisi,
      toplamTutar: list.toplamTutar,
      whatsappOzet: list.whatsappOzet,
      liste: list.liste,
      not: list.donemDinamikSecildi
        ? `Dönem belirtilmedi; ${list.vergiTuru} tahakkuku dolu EN SON dönem (${list.donem}) gösteriliyor. Dönemi geri SORMA.`
        : undefined,
    };
  }

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

  /**
   * KDV1 BEYANNAME ÖN HAZIRLIĞI — KdvBeyannameService.kdv1OnHazirlik'in ajan/bot için sadeleştirilmiş hali.
   * Portaldaki KDV Beyanname sayfasıyla AYNI hesap: tek kaynak KDV Kontrol (Luca-mutabık), devreden önceki
   * ayın GERÇEK beyannamesinden (computePrevDevreden). Beyanname ajanı devredeni list_beyan_kayitlari'ndan
   * tahmin ediyordu (pilot koşu bulgusu) — bu araç gerçek paketi verir.
   * KDV Kontrol oturumu yoksa ok:false — ham listeden rakam üretilmez (kurallar.md: uydurma yok).
   * Servis dinamik çözülür (getGundem ile aynı desen): moren-ai jest koşuları xlsx/pdf-parse zincirini yüklemesin.
   */
  private async getKdv1OnHazirlik(input: any, ctx: { tenantId: string; taxpayerId?: string | null }) {
    const taxpayerId = String(input?.taxpayerId || input?.mukellefId || ctx.taxpayerId || '').trim();
    const donem = this.normalizeDonemYYYYMM(input?.donem || input?.period);
    if (!taxpayerId) return { ok: false, error: 'taxpayerId gerekli (list_taxpayers ile bul).' };
    if (!donem) return { ok: false, error: 'donem YYYY-MM biçiminde olmalı (örn. 2026-08).' };

    let svc: any = null;
    try {
      const { KdvBeyannameService } = await import('../kdv-beyanname/kdv-beyanname.service');
      svc = this.moduleRef?.get?.(KdvBeyannameService, { strict: false });
    } catch (e: any) {
      this.logger.warn(`KdvBeyannameService çözülemedi: ${e?.message || e}`);
    }
    if (!svc?.kdv1OnHazirlik) return { ok: false, error: 'KDV Beyanname servisi kullanılamıyor.' };

    const oh: any = await svc.kdv1OnHazirlik({ tenantId: ctx.tenantId, mukellefId: taxpayerId, donem, computePrevDevreden: true });
    const eksik: any[] = Array.isArray(oh?.eksikVeriler) ? oh.eksikVeriler : [];

    // "KDV Kontrol verisi bulunamadı" — servis her taraf (SATIS/ALIS) için kritik kdv_kontrol kaydı üretir.
    const kontrolYok = (taraf: 'SATIS' | 'ALIS') =>
      eksik.some(
        (e) => e.tur === 'kdv_kontrol' && e.seviye === 'kritik' && e.taraf === taraf && /KDV Kontrol verisi bulunamad/i.test(String(e.mesaj || '')),
      );
    const satisKontrolYok = kontrolYok('SATIS');
    const alisKontrolYok = kontrolYok('ALIS');
    const kdvKontrolVar = !(satisKontrolYok && alisKontrolYok);

    const DEVREDEN_KAYNAK: Record<string, string> = {
      manuel: 'Bu dönem için elle girilen devreden tutarı.',
      beyanname_pdf: 'Önceki ayın GİB KDV1 beyannamesindeki "Sonraki Döneme Devreden" (resmî kaynak).',
      beyan_durumu: 'Önceki dönem beyan durumuna aktarılan "sonraki aya devreden" tutarı.',
      hesaplanan: 'Önceki dönemin KDV Kontrol verisinden hesaplandı (beyanname PDF bulunamadı) — sahibe teyit ettir.',
      beyan_kaydi: 'Önceki dönem beyan kaydının notundan okundu.',
      luca_mizan: 'Luca mizan 190 Devreden KDV bakiyesi.',
      yok: 'Önceki dönem devreden kaydı bulunamadı; 0 kabul edildi — sahibe sor, tahmin etme.',
    };
    const devreden = {
      tutar: this.toNum(oh?.devreden?.tutar),
      kaynak: oh?.devreden?.kaynak || 'yok',
      sonKayitDonem: oh?.devreden?.sonKayitDonem ?? null,
      kaynakAciklama: DEVREDEN_KAYNAK[String(oh?.devreden?.kaynak || 'yok')] || '',
    };

    const uyarilar: string[] = [];
    const uyariEkle = (s: any) => {
      const t = String(s || '').trim();
      if (t && !uyarilar.includes(t) && uyarilar.length < 25) uyarilar.push(t);
    };
    for (const e of eksik) if (e.seviye === 'kritik' || e.seviye === 'uyari') uyariEkle(`[${e.taraf || 'GENEL'}] ${e.mesaj}`);
    for (const u of oh?.lucaKontrol?.uyarilar || []) uyariEkle(`[LUCA] ${u}`);
    for (const u of oh?.kaliteRapor?.uyarilar || []) uyariEkle(`[KALİTE] ${u}`);

    const eksikVeriler = eksik.slice(0, 40).map((e) => ({
      tur: e.tur,
      seviye: e.seviye,
      taraf: e.taraf || 'GENEL',
      belgeNo: e.belgeNo ?? null,
      mesaj: e.mesaj,
      aksiyon: e.aksiyon ?? null,
    }));
    const kritikAdet = eksik.filter((e) => e.seviye === 'kritik').length;

    if (!kdvKontrolVar) {
      return {
        ok: false,
        error: 'KDV Kontrol oturumu yok',
        donem,
        mukellefId: oh?.mukellefId || taxpayerId,
        mukellefAd: oh?.mukellefAd || null,
        kdvKontrolVar: false,
        devreden,
        eksikVeriler,
        eksikVeriAdet: eksik.length,
        uyarilar,
        aciklama:
          `Bu dönem (${donem}) KDV Kontrol'den geçmemiş; beyan rakamı ÜRETİLMEZ. ` +
          'Önce KDV Kontrol oturumu açılmalı (fatura görselleri OCR + Luca eşleştirme). Rapor: "hazır değil — KDV Kontrol yok".',
      };
    }

    const oranSatir = (o: any) => ({
      oran: this.toNum(o?.oran),
      matrah: this.toNum(o?.matrah),
      kdv: this.toNum(o?.kdv),
      adet: this.toNum(o?.adet),
    });
    const lk = oh?.lucaKontrol || {};
    const hazirMi = kritikAdet === 0 && oh?.veriGuveni?.seviye === 'kesin';

    return {
      ok: true,
      donem,
      mukellefId: oh?.mukellefId || taxpayerId,
      mukellefAd: oh?.mukellefAd || null,
      kdvKontrolVar: true,
      hazirMi,
      sonuc: {
        matrah: this.toNum(oh?.satis?.toplamMatrah),
        hesaplananKdv: this.toNum(oh?.sonuc?.hesaplananKdv),
        indirilecekKdv: this.toNum(oh?.sonuc?.indirilecekKdv),
        devredenKdv: this.toNum(oh?.sonuc?.devredenKdv),
        odenecekKdv: this.toNum(oh?.sonuc?.odenecekKdv),
        sonrakiAyaDevreden: this.toNum(oh?.sonuc?.sonrakiAyaDevreden),
      },
      satis: {
        toplamMatrah: this.toNum(oh?.satis?.toplamMatrah),
        toplamHesaplananKdv: this.toNum(oh?.satis?.toplamHesaplananKdv),
        faturaAdet: this.toNum(oh?.satis?.faturaAdet),
        oranlar: (oh?.satis?.oranlar || []).map(oranSatir),
        oranBelirsizKdv: this.toNum(oh?.satis?.oranBelirsizKdv),
        oranBelirsizAdet: this.toNum(oh?.satis?.oranBelirsizAdet),
        kdvKontrolVar: !satisKontrolYok,
      },
      alis: {
        toplamMatrah: this.toNum(oh?.alis?.toplamMatrah),
        toplamIndirilecekKdv: this.toNum(oh?.alis?.toplamIndirilecekKdv),
        faturaAdet: this.toNum(oh?.alis?.faturaAdet),
        oranlar: (oh?.alis?.oranlar || []).map(oranSatir),
        tevkifatsiz: oh?.alis?.tevkifatsiz || null,
        tevkifatli: oh?.alis?.tevkifatli || null,
        oranBelirsizKdv: this.toNum(oh?.alis?.oranBelirsizKdv),
        oranBelirsizAdet: this.toNum(oh?.alis?.oranBelirsizAdet),
        kdvKontrolVar: !alisKontrolYok,
      },
      devreden,
      lucaKontrol: {
        mizanVar: !!lk.mizanVar,
        luca391Bakiye: lk.luca391Bakiye ?? null,
        luca191Bakiye: lk.luca191Bakiye ?? null,
        luca190Bakiye: lk.luca190Bakiye ?? null,
        fark391: lk.fark391 ?? null,
        fark191: lk.fark191 ?? null,
        cekildiAt: lk.cekildiAt ?? null,
        uyarilar: lk.uyarilar || [],
      },
      isletmeGelirGider: oh?.isletmeGelirGider ?? null,
      veriGuveni: oh?.veriGuveni ?? null,
      eksikVeriler,
      eksikVeriAdet: eksik.length,
      uyarilar,
      aciklama:
        'Rakamlar KDV Kontrol (Luca-mutabık) verisidir; ham fatura listesi değildir. ' +
        'Tahakkuk fişi: 391 borç=hesaplananKdv, 191 alacak=indirilecekKdv; odenecekKdv>0 → 360, değilse sonrakiAyaDevreden → 190. ' +
        'sonuc.matrah 0 ise oran satırlarından matrah okunmamıştır (ofis kuralı: oran + KDV tutarı yeter). ' +
        (hazirMi ? 'Veri güveni kesin, kritik uyarı yok.' : 'Kritik/uyarı var veya veri güveni kesin değil — "hazır" deme, uyarıları rapora yaz.'),
    };
  }

  /** "2026-08" | "2026/08" | "2026-8" → "2026-08"; geçersizse null. */
  private normalizeDonemYYYYMM(v: any): string | null {
    const m = /^(\d{4})[-/.](\d{1,2})$/.exec(String(v || '').trim());
    if (!m) return null;
    const ay = Number(m[2]);
    if (ay < 1 || ay > 12) return null;
    return `${m[1]}-${String(ay).padStart(2, '0')}`;
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
  /** TDHP hesap kodu→isim + güncel vergi oranı — DOĞRULANMIŞ referans (uydurma yok). */
  private getAccountingReference(input: any) {
    const kodlar = Array.isArray(input?.kodlar) ? input.kodlar.map((k: any) => String(k).trim()).filter(Boolean) : [];
    const oranTipi = input?.oranTipi ? String(input.oranTipi).trim() : '';
    const out: any = { kaynak: 'TDHP standart + güncel vergi oranları (doğrulanmış; ezberden cevap verme, bunu kullan)' };
    if (kodlar.length) {
      out.hesaplar = kodlar.map((kod: string) => ({ kod, ad: TDHP[kod] || TDHP[kod.slice(0, 3)] || null, bilinmiyor: !(TDHP[kod] || TDHP[kod.slice(0, 3)]) }));
      out.metin = tdhpAciklama(kodlar);
    }
    if (oranTipi) {
      out.vergiOrani = vergiOraniAciklama(oranTipi);
    }
    if (!kodlar.length && !oranTipi) {
      // Genel istek: tam cetvel + oran tablosu.
      out.hesapPlani = TDHP;
      out.vergiOranlari = vergiOranlari();
    }
    return out;
  }

  private async getBankStatus(input: any, ctx: { tenantId: string }) {
    const taxpayer = await this.resolveTaxpayerFromInput(input, ctx);
    if (!taxpayer) return { error: 'Mükellef bulunamadı', ipucu: 'taxpayerId veya taxpayerName gönder.' };
    const hesaplar = await (this.prisma as any).bankaHesap.findMany({
      where: { tenantId: ctx.tenantId, taxpayerId: taxpayer.id },
      orderBy: [{ aktif: 'desc' }, { sira: 'asc' }],
      select: { bankaAdi: true, iban: true, hesapNo: true, sube: true, paraBirimi: true, aciklama: true, aktif: true },
    });
    const donem = String(input?.donem || '').match(/^\d{4}-\d{2}$/) ? input.donem : null;
    const ekstreWhere: any = { tenantId: ctx.tenantId, taxpayerId: taxpayer.id };
    if (donem) ekstreWhere.donem = donem;
    const ekstreler = await (this.prisma as any).bankaEkstreKaydi.findMany({
      where: ekstreWhere,
      orderBy: [{ donem: 'desc' }],
      take: donem ? 20 : 12,
      select: { donem: true, ekstreGeldi: true, geldiTarihi: true, ekstreIslendi: true, islenmeTarihi: true, islenmeNotu: true, notlar: true },
    });
    const adi = (taxpayer.companyName || `${taxpayer.firstName || ''} ${taxpayer.lastName || ''}`).trim();
    const iso = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : null);
    return {
      mukellef: adi,
      hesapSayisi: hesaplar.length,
      bankaHesaplari: hesaplar.map((h: any) => ({ banka: h.bankaAdi, iban: h.iban || '-', hesapNo: h.hesapNo || '-', sube: h.sube || '-', paraBirimi: h.paraBirimi, not: h.aciklama || '', aktif: h.aktif })),
      ekstreDurumu: ekstreler.map((e: any) => ({ donem: e.donem, geldi: e.ekstreGeldi, geldiTarihi: iso(e.geldiTarihi), islendi: e.ekstreIslendi, islenmeTarihi: iso(e.islenmeTarihi), not: e.islenmeNotu || e.notlar || '' })),
      not: hesaplar.length === 0 ? 'Bu mükellef için kayıtlı banka hesabı yok.' : undefined,
    };
  }

  private async getCariHareketler(input: any, ctx: { tenantId: string }) {
    const taxpayer = await this.resolveTaxpayerFromInput(input, ctx);
    if (!taxpayer) return { error: 'Mükellef bulunamadı', ipucu: 'taxpayerId veya taxpayerName gönder.' };
    const tip = String(input?.tip || '').trim().toUpperCase();
    const where: any = { tenantId: ctx.tenantId, taxpayerId: taxpayer.id };
    if (['TAHSILAT', 'TAHAKKUK', 'IADE', 'DUZELTME'].includes(tip)) where.tip = tip;
    const limit = Math.min(Number(input?.limit) || 20, 100);
    const hareketler = await (this.prisma as any).cariHareket.findMany({
      where, orderBy: [{ tarih: 'desc' }], take: limit,
      select: { tarih: true, tip: true, tutar: true, aciklama: true, odemeYontemi: true, belgeNo: true, donem: true },
    });
    // Net bakiye: TAHAKKUK borç(+), TAHSILAT/IADE alacak(-). Tüm hareketlerden hesaplanır.
    const tumu = await (this.prisma as any).cariHareket.findMany({
      where: { tenantId: ctx.tenantId, taxpayerId: taxpayer.id }, select: { tip: true, tutar: true },
    });
    let bakiye = 0;
    for (const h of tumu) {
      const t = this.toNum(h.tutar);
      if (h.tip === 'TAHAKKUK') bakiye += t;
      else if (h.tip === 'TAHSILAT' || h.tip === 'IADE') bakiye -= t;
    }
    const iso = (d: any) => new Date(d).toISOString().slice(0, 10);
    const sonTahsilat = hareketler.find((h: any) => h.tip === 'TAHSILAT');
    const adi = (taxpayer.companyName || `${taxpayer.firstName || ''} ${taxpayer.lastName || ''}`).trim();
    return {
      mukellef: adi,
      netBakiye: Math.round(bakiye * 100) / 100,
      bakiyeAciklama: tumu.length === 0 ? 'Cari hareket kaydı yok' : bakiye > 0 ? 'borçlu görünüyor' : bakiye < 0 ? 'alacaklı/avans' : 'kapalı (0)',
      hareketSayisi: tumu.length,
      sonTahsilat: sonTahsilat ? { tarih: iso(sonTahsilat.tarih), tutar: this.toNum(sonTahsilat.tutar), yontem: sonTahsilat.odemeYontemi || '-' } : null,
      hareketler: hareketler.map((h: any) => ({ tarih: iso(h.tarih), tip: h.tip, tutar: this.toNum(h.tutar), yontem: h.odemeYontemi || '-', belgeNo: h.belgeNo || '-', donem: h.donem || '-', aciklama: h.aciklama || '' })),
    };
  }

  private async listEarsivInvoices(input: any, ctx: { tenantId: string }) {
    const taxpayer = await this.resolveTaxpayerFromInput(input, ctx);
    if (!taxpayer) return { error: 'Mükellef bulunamadı', ipucu: 'taxpayerId veya taxpayerName gönder.' };
    const where: any = { tenantId: ctx.tenantId, taxpayerId: taxpayer.id };
    const tip = String(input?.tip || '').trim().toUpperCase();
    if (tip === 'SATIS' || tip === 'ALIS') where.tip = tip;
    const kaynak = String(input?.kaynak || '').trim().toUpperCase();
    if (kaynak === 'EARSIV' || kaynak === 'EFATURA') where.belgeKaynak = kaynak;
    const donem = String(input?.donem || '').match(/^\d{4}-\d{2}$/) ? input.donem : null;
    if (donem) where.donem = donem;
    const limit = Math.min(Number(input?.limit) || 30, 100);
    const faturalar = await (this.prisma as any).earsivFatura.findMany({
      where, orderBy: [{ faturaTarihi: 'desc' }], take: limit,
      select: { tip: true, belgeKaynak: true, donem: true, faturaNo: true, faturaTarihi: true, ettn: true, satici: true, alici: true, matrah: true, kdvOrani: true, kdvTutari: true, toplamTutar: true },
    });
    const iso = (d: any) => new Date(d).toISOString().slice(0, 10);
    const adi = (taxpayer.companyName || `${taxpayer.firstName || ''} ${taxpayer.lastName || ''}`).trim();
    return {
      mukellef: adi, donem: donem || 'tümü', tip: tip || 'tümü', adet: faturalar.length,
      toplamMatrah: Math.round(faturalar.reduce((s: number, f: any) => s + this.toNum(f.matrah), 0) * 100) / 100,
      toplamKdv: Math.round(faturalar.reduce((s: number, f: any) => s + this.toNum(f.kdvTutari), 0) * 100) / 100,
      faturalar: faturalar.map((f: any) => ({ tip: f.tip, kaynak: f.belgeKaynak, no: f.faturaNo, tarih: iso(f.faturaTarihi), karsiTaraf: f.tip === 'SATIS' ? (f.alici || '-') : (f.satici || '-'), matrah: this.toNum(f.matrah), kdvOrani: f.kdvOrani != null ? this.toNum(f.kdvOrani) : null, kdv: this.toNum(f.kdvTutari), toplam: this.toNum(f.toplamTutar), ettn: f.ettn || '-' })),
      not: faturalar.length === 0 ? 'Bu kriterlerde e-belge bulunamadı.' : undefined,
    };
  }

  private async listTasks(input: any, ctx: { tenantId: string }) {
    const where: any = { tenantId: ctx.tenantId };
    if (input?.taxpayerId || input?.taxpayerName || input?.mukellefId) {
      const t = await this.resolveTaxpayerFromInput(input, ctx);
      if (t) where.taxpayerId = t.id;
    }
    const status = String(input?.status || '').trim().toUpperCase();
    if (['OPEN', 'IN_PROGRESS', 'DONE', 'SNOOZED', 'MISSED', 'CANCELLED'].includes(status)) where.status = status;
    if (input?.onlyOverdue) { where.status = { notIn: ['DONE', 'CANCELLED'] }; where.dueDate = { lt: new Date() }; }
    const limit = Math.min(Number(input?.limit) || 25, 100);
    const tasks = await (this.prisma as any).task.findMany({
      where, orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }], take: limit,
      select: { title: true, status: true, priority: true, category: true, dueDate: true, dueTime: true, taxpayer: { select: { companyName: true, firstName: true, lastName: true } } },
    });
    const iso = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : null);
    return {
      adet: tasks.length,
      gorevler: tasks.map((t: any) => ({ baslik: t.title, durum: t.status, oncelik: t.priority, kategori: t.category || '-', sonTarih: iso(t.dueDate), saat: t.dueTime || null, mukellef: t.taxpayer ? (t.taxpayer.companyName || `${t.taxpayer.firstName || ''} ${t.taxpayer.lastName || ''}`).trim() : null })),
      not: tasks.length === 0 ? 'Bu kriterlerde görev yok.' : undefined,
    };
  }

  private async listETebligat(input: any, ctx: { tenantId: string }) {
    const where: any = { tenantId: ctx.tenantId };
    const belgeTuru = String(input?.belgeTuru || 'E_TEBLIGAT').trim().toUpperCase();
    if (belgeTuru && belgeTuru !== 'TUMU' && belgeTuru !== 'HEPSI') where.belgeTuru = belgeTuru;
    if (input?.taxpayerId || input?.taxpayerName || input?.mukellefId) {
      const t = await this.resolveTaxpayerFromInput(input, ctx);
      if (t) where.taxpayerId = t.id;
    }
    const limit = Math.min(Number(input?.limit) || 25, 100);
    const docs = await (this.prisma as any).portalDocument.findMany({
      where, orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }], take: limit,
      select: { belgeTuru: true, title: true, period: true, referenceNo: true, issuedAt: true, receivedAt: true, viewedAt: true, taxpayer: { select: { companyName: true, firstName: true, lastName: true } } },
    });
    const iso = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : null);
    return {
      adet: docs.length, belgeTuru,
      belgeler: docs.map((d: any) => ({ tur: d.belgeTuru, baslik: d.title, donem: d.period || '-', refNo: d.referenceNo || '-', tebligTarihi: iso(d.issuedAt), alinmaTarihi: iso(d.receivedAt), goruntulendi: !!d.viewedAt, mukellef: d.taxpayer ? (d.taxpayer.companyName || `${d.taxpayer.firstName || ''} ${d.taxpayer.lastName || ''}`).trim() : null })),
      not: docs.length === 0 ? 'Bu kriterlerde belge yok.' : undefined,
    };
  }

  private async getIsletmeHesapOzeti(input: any, ctx: { tenantId: string }) {
    const taxpayer = await this.resolveTaxpayerFromInput(input, ctx);
    if (!taxpayer) return { error: 'Mükellef bulunamadı', ipucu: 'taxpayerId veya taxpayerName gönder.' };
    const where: any = { tenantId: ctx.tenantId, taxpayerId: taxpayer.id };
    if (Number(input?.yil)) where.yil = Number(input.yil);
    if (Number(input?.donem)) where.donem = Number(input.donem);
    const ozet = await (this.prisma as any).isletmeHesapOzeti.findFirst({ where, orderBy: [{ yil: 'desc' }, { donem: 'desc' }] });
    const adi = (taxpayer.companyName || `${taxpayer.firstName || ''} ${taxpayer.lastName || ''}`).trim();
    if (!ozet) return { mukellef: adi, not: 'İşletme hesap özeti kaydı bulunamadı (mükellef işletme defteri olmayabilir).' };
    return {
      mukellef: adi, yil: ozet.yil, donem: `${ozet.donem}. dönem`,
      satisHasilati: this.toNum(ozet.satisHasilati), digerGelir: this.toNum(ozet.digerGelir),
      malAlisi: this.toNum(ozet.malAlisi), satilanMalMaliyeti: this.toNum(ozet.satilanMalMaliyeti),
      netSatislar: this.toNum(ozet.netSatislar), donemIciGiderler: this.toNum(ozet.donemIciGiderler),
      donemKari: this.toNum(ozet.donemKari), gecmisYilZarari: this.toNum(ozet.gecmisYilZarari),
      gecVergiMatrahi: this.toNum(ozet.gecVergiMatrahi), hesaplananGecVergi: this.toNum(ozet.hesaplananGecVergi),
      oncekiOdenenGecVergi: this.toNum(ozet.oncekiOdenenGecVergi), odenecekGecVergi: this.toNum(ozet.odenecekGecVergi),
    };
  }

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
  private static readonly KARSILASTIRMA_KAYNAKLARI = ['gelir_tablosu', 'bilanco', 'mizan'] as const;
  /** compare_periods tek seferde en çok bu kadar hesap/kalem farkı listeler (en büyükten küçüğe). */
  private static readonly KARSILASTIRMA_FARK_TAVANI = 30;

  /** "GELIR_TABLOSU", "Bilanço", "gelir tablosu" gibi yazımları geçerli kaynak adına indirir; tanınmazsa null. */
  private normalizeKarsilastirmaKaynagi(kaynak: any): 'gelir_tablosu' | 'bilanco' | 'mizan' | null {
    const k = String(kaynak ?? '')
      .trim()
      .toLowerCase()
      .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u')
      .replace(/[\s\-.]+/g, '_');
    if (['gelir_tablosu', 'gelirtablosu', 'gelir_tablo', 'gt', 'kar_zarar', 'karzarar'].includes(k)) return 'gelir_tablosu';
    if (['bilanco', 'bilanco_tablosu', 'balance', 'balance_sheet'].includes(k)) return 'bilanco';
    if (['mizan', 'trial_balance', 'hesap', 'hesaplar'].includes(k)) return 'mizan';
    return null;
  }

  private karsilastirmaHatasi(mesaj: string) {
    return {
      error: `${mesaj} Geçerli kaynak: ${ToolExecutorService.KARSILASTIRMA_KAYNAKLARI.join(' | ')} (küçük harf). ${ToolExecutorService.MALI_DONEM_BICIMI}`,
      gecerliKaynaklar: [...ToolExecutorService.KARSILASTIRMA_KAYNAKLARI],
      donemBicimi: ToolExecutorService.MALI_DONEM_BICIMI,
    };
  }

  /** İki değer arası fark satırı (yüzde: taban 0 ise null — sıfıra bölme yok). */
  private farkSatiri(v1: number, v2: number) {
    const fark = this.yuvarla2(v2 - v1);
    const degismeYuzdesi = Math.abs(v1) >= 0.005 ? this.yuvarla2((fark / Math.abs(v1)) * 100) : null;
    return { donem1: this.yuvarla2(v1), donem2: this.yuvarla2(v2), fark, degismeYuzdesi };
  }

  /**
   * compare_periods — 2026-09-12'ye kadar anahtarları `d1.aktif`'ten alıp değerleri `d1[key]`'den okuyordu:
   * bilançoda hiçbir anahtar eşleşmiyor (BOŞ), mizanda ise yalnız toplamlar çıkıyordu (hesap kırılımı YOK).
   * Şimdi: kaynak/dönem doğrulanır (hatada geçerli değerler listelenir), bilanço grup+hesap kırılımı,
   * mizan hesap kodu bazında bakiye farkı; en büyük 30 fark + toplamlar döner.
   */
  private async comparePeriods(input: any, ctx: { tenantId: string }) {
    const kaynak = this.normalizeKarsilastirmaKaynagi(input?.kaynak);
    if (!kaynak) return this.karsilastirmaHatasi(`Geçersiz kaynak: "${input?.kaynak ?? ''}".`);
    const donem1 = this.normalizeFinancialPeriod(input?.donem1, input?.yil);
    const donem2 = this.normalizeFinancialPeriod(input?.donem2, input?.yil);
    if (!donem1 || !donem2) {
      const bozuk = [!donem1 ? `donem1="${input?.donem1 ?? ''}"` : '', !donem2 ? `donem2="${input?.donem2 ?? ''}"` : '']
        .filter(Boolean)
        .join(', ');
      return this.karsilastirmaHatasi(`Dönem anlaşılamadı: ${bozuk}.`);
    }
    if (donem1 === donem2) return this.karsilastirmaHatasi(`donem1 ve donem2 aynı (${donem1}); iki FARKLI dönem ver.`);
    if (!input?.taxpayerId) return this.karsilastirmaHatasi('taxpayerId zorunlu.');

    const onekler = this.hesapKoduOnekleri(input?.hesapKoduFiltresi ?? input?.hesapKodu);
    const d1: any = await this.fetchPeriodData(kaynak, input.taxpayerId, donem1, ctx, onekler);
    const d2: any = await this.fetchPeriodData(kaynak, input.taxpayerId, donem2, ctx, onekler);
    if (!d1?.error && !d2?.error && (d1.mizanId ?? d1.kayitId) && (d1.mizanId ?? d1.kayitId) === (d2.mizanId ?? d2.kayitId)) {
      // "2026-06" ile "2026-Q2" aynı kayda çözülür → kendisiyle kıyaslayıp sıfır fark üretmesin.
      return this.karsilastirmaHatasi(`donem1 (${donem1}) ve donem2 (${donem2}) aynı kayda (${d1.donem}) çözüldü; iki FARKLI dönem ver.`);
    }
    if (d1?.error || d2?.error) {
      // Bulunamayan dönem(ler) + mevcut dönemler tek mesajda — ajan boş dönem için rakam uydurmasın, mevcut dönemi seçsin.
      const mevcut = d1?.mevcutDonemler || d2?.mevcutDonemler || (await this.mevcutMaliDonemler(input.taxpayerId, ctx));
      const kaynakDonemleri: string[] =
        kaynak === 'mizan' ? mevcut?.mizan : kaynak === 'bilanco' ? mevcut?.bilanco : mevcut?.gelirTablosu;
      const eksik = [d1?.error ? donem1 : '', d2?.error ? donem2 : ''].filter(Boolean).join(' ve ');
      const kaynakAdi = kaynak === 'gelir_tablosu' ? 'gelir tablosu' : kaynak === 'bilanco' ? 'bilanço' : 'mizan';
      return {
        error:
          `${eksik} için ${kaynakAdi} yok; karşılaştırma yapılamadı. Mevcut ${kaynakAdi} dönemleri: ${this.donemListesiMetni(
            Array.isArray(kaynakDonemleri) ? kaynakDonemleri : [],
          )}. ` +
          `Geçerli kaynak: ${ToolExecutorService.KARSILASTIRMA_KAYNAKLARI.join(' | ')}. ${ToolExecutorService.MALI_DONEM_BICIMI}`,
        kaynak,
        donem1,
        donem2,
        mevcutDonemler: mevcut,
      };
    }

    // ---- GELİR TABLOSU: kalem bazında (eski davranış korunur; ek olarak sıralı liste) ----
    if (kaynak === 'gelir_tablosu') {
      const diff: Record<string, ReturnType<ToolExecutorService['farkSatiri']>> = {};
      for (const key of Object.keys(d1.kalemler || {})) {
        const v1 = d1.kalemler[key];
        const v2 = d2.kalemler?.[key];
        if (typeof v1 === 'number' && typeof v2 === 'number') diff[key] = this.farkSatiri(v1, v2);
      }
      const enBuyukFarklar = Object.entries(diff)
        .map(([kalem, v]) => ({ kalem, ...v }))
        .sort((a, b) => Math.abs(b.fark) - Math.abs(a.fark))
        .slice(0, ToolExecutorService.KARSILASTIRMA_FARK_TAVANI);
      return {
        kaynak,
        donem1,
        donem2,
        donem1Kayit: d1.donem,
        donem2Kayit: d2.donem,
        karsilaştırma: diff,
        enBuyukFarklar,
        not: 'Geçici vergi dönemleri KÜMÜLATİFTİR (Q2 = 6 ay). Çeyreklik tutar için Q2 − Q1 farkını kullan.',
      };
    }

    // ---- BİLANÇO: ana toplamlar + grup/hesap kırılımı ----
    if (kaynak === 'bilanco') {
      const toplamAnahtarlari: Array<[string, (d: any) => number]> = [
        ['donenVarliklar', (d) => d.aktif?.donenVarliklar],
        ['duranVarliklar', (d) => d.aktif?.duranVarliklar],
        ['aktifToplami', (d) => d.aktif?.aktifToplami],
        ['kvYabanciKaynak', (d) => d.pasif?.kvYabanciKaynak],
        ['uvYabanciKaynak', (d) => d.pasif?.uvYabanciKaynak],
        ['ozkaynaklar', (d) => d.pasif?.ozkaynaklar],
        ['pasifToplami', (d) => d.pasif?.pasifToplami],
      ];
      const toplamlar: Record<string, ReturnType<ToolExecutorService['farkSatiri']>> = {};
      for (const [key, al] of toplamAnahtarlari) {
        toplamlar[key] = this.farkSatiri(this.toNum(al(d1)), this.toNum(al(d2)));
      }

      // detay JSON: { grupAnahtari: { grup, toplam, hesaplar: [{kod, ad, tutar}] } } → düz harita (kod → tutar)
      type Kirilim = Map<string, { ad: string; tutar: number; tur: 'grup' | 'hesap'; taraf: 'aktif' | 'pasif' }>;
      const kirilim = (d: any): Kirilim => {
        const out: Kirilim = new Map();
        for (const taraf of ['aktif', 'pasif'] as const) {
          const detay = d?.[taraf]?.detay;
          if (!detay || typeof detay !== 'object') continue;
          for (const grup of Object.values<any>(detay)) {
            if (!grup || typeof grup !== 'object') continue;
            const grupAdi = String(grup.grup || '').trim();
            if (grupAdi) out.set(`G:${grupAdi}`, { ad: grupAdi, tutar: this.toNum(grup.toplam), tur: 'grup', taraf });
            for (const h of Array.isArray(grup.hesaplar) ? grup.hesaplar : []) {
              const kod = String(h?.kod || '').trim();
              if (!kod) continue;
              const onceki = out.get(`H:${kod}`);
              out.set(`H:${kod}`, { ad: String(h?.ad || onceki?.ad || ''), tutar: (onceki?.tutar || 0) + this.toNum(h?.tutar), tur: 'hesap', taraf });
            }
          }
        }
        return out;
      };
      const k1 = kirilim(d1);
      const k2 = kirilim(d2);
      const anahtarlar = new Set<string>([...k1.keys(), ...k2.keys()]);
      const satirlar = Array.from(anahtarlar).map((key) => {
        const a = k1.get(key);
        const b = k2.get(key);
        const s = this.farkSatiri(a?.tutar || 0, b?.tutar || 0);
        return {
          tur: (a || b)!.tur,
          taraf: (a || b)!.taraf,
          hesapKodu: key.startsWith('H:') ? key.slice(2) : undefined,
          ad: (b || a)!.ad,
          ...s,
          durum: !a ? 'yeni' : !b ? 'kapandi' : undefined,
        };
      });
      const enBuyukFarklar = satirlar
        .filter((s) => Math.abs(s.fark) >= 0.005)
        .sort((a, b) => Math.abs(b.fark) - Math.abs(a.fark))
        .slice(0, ToolExecutorService.KARSILASTIRMA_FARK_TAVANI);
      return {
        kaynak,
        donem1,
        donem2,
        donem1Kayit: d1.donem,
        donem2Kayit: d2.donem,
        // WhatsApp şablonu + geriye uyum: düz toplam haritası
        karsilaştırma: toplamlar,
        toplamlar,
        kirilimSatirSayisi: satirlar.length,
        enBuyukFarklar,
        not: `Kırılımda ${satirlar.length} grup/hesap karşılaştırıldı; en büyük ${enBuyukFarklar.length} fark listelendi (grup satırları "G", hesap satırları hesapKodu ile).`,
      };
    }

    // ---- MİZAN: hesap kodu bazında net bakiye farkı ----
    const hesapHarita = (d: any) => {
      const m = new Map<string, { hesapAdi: string; borcToplami: number; alacakToplami: number; netBakiye: number }>();
      for (const h of Array.isArray(d?.hesaplar) ? d.hesaplar : []) {
        m.set(String(h.hesapKodu), {
          hesapAdi: String(h.hesapAdi || ''),
          borcToplami: this.toNum(h.borcToplami),
          alacakToplami: this.toNum(h.alacakToplami),
          netBakiye: this.toNum(h.borcBakiye) - this.toNum(h.alacakBakiye),
        });
      }
      return m;
    };
    const m1 = hesapHarita(d1);
    const m2 = hesapHarita(d2);
    const kodlar = Array.from(new Set<string>([...m1.keys(), ...m2.keys()])).sort();
    const satirlar = kodlar.map((kod) => {
      const a = m1.get(kod);
      const b = m2.get(kod);
      const s = this.farkSatiri(a?.netBakiye || 0, b?.netBakiye || 0);
      return {
        hesapKodu: kod,
        hesapAdi: (b || a)!.hesapAdi,
        ...s,
        borcToplamiFarki: this.yuvarla2((b?.borcToplami || 0) - (a?.borcToplami || 0)),
        alacakToplamiFarki: this.yuvarla2((b?.alacakToplami || 0) - (a?.alacakToplami || 0)),
        durum: !a ? 'yeni' : !b ? 'kapandi' : undefined,
      };
    });
    const degisti = (s: (typeof satirlar)[number]) =>
      Math.abs(s.fark) >= 0.005 || Math.abs(s.borcToplamiFarki) >= 0.005 || Math.abs(s.alacakToplamiFarki) >= 0.005;
    const farkaGoreSirala = (liste: typeof satirlar) => liste.filter(degisti).sort((a, b) => Math.abs(b.fark) - Math.abs(a.fark));
    // Luca mizanı hiyerarşiktir (1 → 12 → 120 → 120.01 → 120.01.001): aynı değişim her kademede tekrar ediyor,
    // ham sıralamada ilk 30'un çoğu tekrar oluyordu (canlı: FATİH GEDİK Q1→Q2). Yaprak (alt hesabı olmayan) ve
    // ana hesap (3 haneli, noktasız) listeleri ayrı verilir.
    const ustHesapMi = (kod: string) =>
      kodlar.some((k) => k !== kod && (k.startsWith(kod + '.') || (!kod.includes('.') && !k.includes('.') && k.startsWith(kod))));
    const yaprakSatirlar = satirlar.filter((s) => !ustHesapMi(s.hesapKodu));
    const anaHesapSatirlar = satirlar.filter((s) => /^\d{3}$/.test(s.hesapKodu));
    const enBuyukFarklar = farkaGoreSirala(yaprakSatirlar).slice(0, ToolExecutorService.KARSILASTIRMA_FARK_TAVANI);
    const anaHesapFarklari = farkaGoreSirala(anaHesapSatirlar)
      .slice(0, ToolExecutorService.KARSILASTIRMA_FARK_TAVANI)
      .map(({ borcToplamiFarki, alacakToplamiFarki, ...kalan }) => kalan);
    const yeniHesaplar = satirlar.filter((s) => s.durum === 'yeni').map((s) => s.hesapKodu);
    const kapananHesaplar = satirlar.filter((s) => s.durum === 'kapandi').map((s) => s.hesapKodu);
    const toplamlar = {
      toplamBorc: this.farkSatiri(this.toNum(d1.toplamBorc), this.toNum(d2.toplamBorc)),
      toplamAlacak: this.farkSatiri(this.toNum(d1.toplamAlacak), this.toNum(d2.toplamAlacak)),
      hesapSayisi: this.farkSatiri(this.toNum(d1.toplamHesap ?? d1.hesapSayisi), this.toNum(d2.toplamHesap ?? d2.hesapSayisi)),
    };
    return {
      kaynak,
      donem1,
      donem2,
      donem1Kayit: d1.donem,
      donem2Kayit: d2.donem,
      donem1MizanId: d1.mizanId,
      donem2MizanId: d2.mizanId,
      hesapKoduFiltresi: onekler.length ? onekler : undefined,
      // WhatsApp şablonu + geriye uyum: düz toplam haritası (hesap sayısı tutar değil, şablona girmesin)
      karsilaştırma: { toplamBorc: toplamlar.toplamBorc, toplamAlacak: toplamlar.toplamAlacak },
      toplamlar,
      karsilastirilanHesap: satirlar.length,
      degisenHesap: satirlar.filter((s) => Math.abs(s.fark) >= 0.005).length,
      yaprakHesapSayisi: yaprakSatirlar.length,
      yeniHesapSayisi: yeniHesaplar.length,
      yeniHesaplar: yeniHesaplar.slice(0, 40),
      kapananHesapSayisi: kapananHesaplar.length,
      kapananHesaplar: kapananHesaplar.slice(0, 40),
      // Yaprak hesaplar (alt kırılımı olmayan, en ayrıntılı satır) — asıl "hangi hesap değişti" listesi
      enBuyukFarklar,
      // Ana hesaplar (3 haneli: 120, 600, 770…) — grup düzeyi görünüm
      anaHesapFarklari,
      not:
        `fark = netBakiye(donem2) − netBakiye(donem1); netBakiye = borçBakiye − alacakBakiye (alacak bakiyeli hesaplar negatif). ` +
        `Geçici vergi mizanları KÜMÜLATİFTİR; çeyreklik tutar için fark sütunu zaten Q2 − Q1'dir. ` +
        (d1.truncated || d2.truncated ? 'UYARI: bir dönemin mizanı sayfa tavanını aştı, kırılım eksik olabilir — hesapKoduFiltresi ile daralt. ' : '') +
        `enBuyukFarklar = yaprak hesaplar (${yaprakSatirlar.length} yaprak, en büyük ${enBuyukFarklar.length} fark); anaHesapFarklari = 3 haneli ana hesaplar (${anaHesapFarklari.length}). ` +
        `Toplam ${satirlar.length} hesap karşılaştırıldı.`,
    };
  }

  private async fetchPeriodData(
    kaynak: string,
    taxpayerId: string,
    donem: string,
    ctx: { tenantId: string },
    hesapKoduOnekleri: string[] = [],
  ) {
    switch (kaynak) {
      case 'gelir_tablosu': return this.getGelirTablosu({ taxpayerId, donem }, ctx);
      case 'bilanco':       return this.getBilanco({ taxpayerId, donem }, ctx);
      // Karşılaştırma tüm hesapları görmeli → sayfa tavanı en yükseğe (1000); daha kalabalık mizanda truncated uyarısı döner.
      case 'mizan':         return this.getMizan({ taxpayerId, donem, hesapKoduFiltresi: hesapKoduOnekleri, sayfaBoyutu: 1000 }, ctx);
      default: return this.karsilastirmaHatasi(`Bilinmeyen kaynak: ${kaynak}.`);
    }
  }

  // ------------------------------------------------------------
  // FİNANSAL RASYOLAR
  // ------------------------------------------------------------
  /**
   * calculate_financial_ratios — 2026-09-12: çeyrek/geçici vergi dönemi ("2026-Q2", "Q2"+yil) kabul edilir;
   * bilanço ya da gelir tablosu o dönem için yoksa ajan "mevcut dönemler" listesini görür, boş/undefined dönmez.
   */
  private async calculateFinancialRatios(input: any, ctx: { tenantId: string }) {
    const donem = this.normalizeFinancialPeriod(input?.donem, input?.yil ?? input?.year);
    if (!donem) {
      return {
        error: `Dönem anlaşılamadı: "${input?.donem ?? ''}". ${ToolExecutorService.MALI_DONEM_BICIMI} Yalnız "Q2" yazdıysan yil:2026 de ver.`,
        donemBicimi: ToolExecutorService.MALI_DONEM_BICIMI,
      };
    }
    if (!input?.taxpayerId) return { error: 'taxpayerId zorunlu.' };

    const bResult: any = await this.getBilanco({ taxpayerId: input.taxpayerId, donem }, ctx);
    const gtResult: any = await this.getGelirTablosu({ taxpayerId: input.taxpayerId, donem }, ctx);

    const bOk = !bResult?.error;
    const gtOk = !gtResult?.error;

    if (!bOk && !gtOk) {
      const mevcut = bResult?.mevcutDonemler || gtResult?.mevcutDonemler || (await this.mevcutMaliDonemler(input.taxpayerId, ctx));
      return {
        error:
          `${donem} için bilanço ve gelir tablosu yok; rasyo hesaplanamadı — rakam üretme. ` +
          `Mevcut bilanço dönemleri: ${this.donemListesiMetni(mevcut.bilanco)}; gelir tablosu dönemleri: ${this.donemListesiMetni(mevcut.gelirTablosu)}; ` +
          `mizan dönemleri: ${this.donemListesiMetni(mevcut.mizan)}. ` +
          (mevcut.mizan.includes(donem)
            ? `${donem} mizanı var: get_mizan (hesapKoduFiltresi "6" / "1" / "3" / "5") ile türetilebilir, raporda "mizandan türetildi" yaz. `
            : '') +
          ToolExecutorService.MALI_DONEM_BICIMI,
        donem,
        mevcutDonemler: mevcut,
      };
    }

    const ratios: any = {};
    const notes: string[] = [];
    const eksik: string[] = [];

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
    } else {
      eksik.push('bilanco');
      const mevcut: string[] = bResult?.mevcutDonemler?.bilanco || [];
      notes.push(
        `${donem} bilançosu yok; mevcut bilanço dönemleri: ${this.donemListesiMetni(mevcut)}. ` +
          'Bilanço rasyoları (cari oran, borçluluk, özkaynak oranı, ROE, ROA) HESAPLANMADI — uydurma.',
      );
    }

    if (gtOk) {
      const k: any = gtResult.kalemler;
      if (k.netSatislar > 0) {
        ratios.brutKarMarji = { deger: k.brutSatisKari / k.netSatislar, formul: 'Brüt Satış Kârı / Net Satışlar' };
        ratios.faaliyetKarMarji = { deger: k.faaliyetKari / k.netSatislar, formul: 'Faaliyet Kârı / Net Satışlar' };
        ratios.netKarMarji = { deger: k.donemNetKari / k.netSatislar, formul: 'Dönem Net Kârı / Net Satışlar' };
      } else {
        notes.push('Net satışlar 0 → marj rasyoları hesaplanmadı.');
      }
      if (bOk && (bResult as any).pasif.ozkaynaklar > 0) {
        ratios.roe = { deger: k.donemNetKari / (bResult as any).pasif.ozkaynaklar, formul: 'Dönem Net Kârı / Özkaynak (ROE)' };
      }
      if (bOk && (bResult as any).aktif.aktifToplami > 0) {
        ratios.roa = { deger: k.donemNetKari / (bResult as any).aktif.aktifToplami, formul: 'Dönem Net Kârı / Aktif Toplamı (ROA)' };
      }
    } else {
      eksik.push('gelir_tablosu');
      const mevcut: string[] = gtResult?.mevcutDonemler?.gelirTablosu || [];
      notes.push(
        `${donem} gelir tablosu yok; mevcut gelir tablosu dönemleri: ${this.donemListesiMetni(mevcut)}. ` +
          'Marj rasyoları (brüt/faaliyet/net kâr marjı, ROE, ROA) HESAPLANMADI — uydurma; mizan varsa get_mizan "6" kökünden türet.',
      );
    }

    return {
      donem,
      bilancoDonemi: bOk ? bResult.donem : null,
      gelirTablosuDonemi: gtOk ? gtResult.donem : null,
      eksik: eksik.length ? eksik : undefined,
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
      aciklama: 'verildi=true ise beyanname verilmiştir. onayNo boş olması "verilmedi" anlamına GELMEZ. Belge (beyanname/tahakkuk PDF) varsa beyanname VERİLMİŞTİR — "verilmemiş" deme.',
      tahakkukTutarNotu: 'tahakkukTutari doluysa O RAKAMI ver. null ise "tutar kaydı sistemde yok, tahakkuk fişi PDF\'inde yazılı" de. Net kâr × oran (veya matrah × oran) ile TEORİK tahakkuk HESAPLAYIP gerçekmiş gibi sunmak KESİNLİKLE YASAK — bu uydurmadır.',
      kayitlar: kayitlar.map((k: any) => {
        const belgeVar = !!(k.beyannameUrl || k.pdfUrl);
        const verildi = Boolean(k.beyanTarihi || k.onayNo || belgeVar || k.tahakkukTutari);
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
            ? `VERİLDİ — GİB kaydı mevcut (${belgeVar ? 'belge (beyanname/tahakkuk PDF) var; ' : ''}tahakkuk/beyan tarihi var; onay no boş olsa bile verilmiştir)`
            : 'henüz verildiğine dair kayıt yok (tahakkuk, beyan tarihi veya belge bulunamadı)',
          beyanTarihi: k.beyanTarihi ? k.beyanTarihi.toISOString().slice(0, 10) : null,
          // null onayNo modeli yanlış "verilmedi" hükmüne itiyordu — sadece doluysa döner.
          ...(k.onayNo ? { onayNo: k.onayNo } : {}),
          tahakkukTutari: k.tahakkukTutari ? Number(k.tahakkukTutari) : null,
          tahakkukKayitliMi: k.tahakkukTutari != null, // false → tutarı PDF'ten söyle, UYDURMA
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
    const allowedAgents = ['mihsap', 'mihsap-supervised-agent', 'mihsap-fatura-isleme-agent', 'luca', 'sgk', 'tebligat', 'kdv', 'beyan-hazirlik', 'luca-beyanname', 'kdv-beyan', 'tahsilat', 'banka-ekstre', 'edefter', 'whatsapp', 'islem'];
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
    const todayDay = new Date().getDate();
    // "Aktif mükellef" = bu ay GERÇEKTEN aktif olan (portal panel brifingi buildBrifingContext
    // ile AYNI tanım). isActive olup gelecek ay başlayacak / geçen ay kapanmış mükellefi saymaz.
    // Eskiden bu filtre yoktu → WhatsApp brifingi "154" derken panel "72" diyordu (tutarsızlık).
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0, 23, 59, 59);
    // Beyanname dönemi = işlem ayı − 1 (Mayıs faturası Haziran'da işlenir, beyanı Mayıs dönemi).
    const byMonth = month === 1 ? 12 : month - 1;
    const byYear = month === 1 ? year - 1 : year;
    const beyannameDonem = `${byYear}-${String(byMonth).padStart(2, '0')}`;

    const [taxpayers, statuses, bankAccounts, bankRecords, cariRows, agentEvents, pendingDecisions, tasks, beyanDurumlari] = await Promise.all([
      this.prisma.taxpayer.findMany({
        where: {
          tenantId: ctx.tenantId,
          isActive: true,
          OR: [{ startDate: null }, { startDate: { lte: lastDay } }],
          AND: [{ OR: [{ endDate: null }, { endDate: { gte: firstDay } }] }],
        },
        select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true, type: true, evrakTeslimGunu: true },
        orderBy: [{ companyName: 'asc' }, { firstName: 'asc' }],
      }),
      (this.prisma as any).taxpayerMonthlyStatus.findMany({ where: { tenantId: ctx.tenantId, year, month } }),
      (this.prisma as any).bankaHesap.findMany({ where: { tenantId: ctx.tenantId, aktif: true }, select: { taxpayerId: true } }),
      (this.prisma as any).bankaEkstreKaydi.findMany({ where: { tenantId: ctx.tenantId, donem: period } }),
      // Borçlu verisi catch'siz olunca tek hata TÜM brifingi boşaltıyor (veya "borçlu yok"
      // yalanı çıkıyordu). İzole et: hata → null (= "veri alınamadı", 0 ile karıştırma).
      (this.prisma as any).cariHareket.findMany({ where: { tenantId: ctx.tenantId }, select: { taxpayerId: true, tip: true, tutar: true } }).catch(() => null),
      (this.prisma as any).agentEvent.findMany({
        where: { tenantId: ctx.tenantId, ts: { gte: todayStart } },
        orderBy: { ts: 'desc' },
        take: 80,
      }),
      (this.prisma as any).pendingDecision?.findMany
        ? (this.prisma as any).pendingDecision.findMany({ where: { tenantId: ctx.tenantId, durum: 'bekliyor' }, take: 50 })
        : Promise.resolve([]),
      (this.prisma as any).task.findMany({
        where: { tenantId: ctx.tenantId, isTemplate: false, status: { in: ['OPEN', 'IN_PROGRESS', 'MISSED'] } },
        select: { id: true, title: true, dueDate: true, status: true },
        take: 200,
      }).catch(() => []),
      // Beyanname dönemi (işlem ayı−1) için henüz onaylanmamış beyan durumları → son gün hesabı.
      (this.prisma as any).beyanDurumu.findMany({
        where: { tenantId: ctx.tenantId, donem: beyannameDonem, durum: 'beklemede' },
        include: { taxpayer: { select: { companyName: true, firstName: true, lastName: true } } },
        take: 1000,
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

    let evrakEksik = 0, islenmemis = 0, kdvKontrolEksik = 0, bankaEksik = 0, beyannameVerilebilir = 0;
    const readinessRows: any[] = [];
    const verilebilirler: string[] = [];
    for (const t of taxpayers as any[]) {
      const s: any = statusMap.get(t.id) || {};
      const ad = this.displayName(t);
      const bankaVar = bankAccountSet.has(t.id);
      const ekstreRows = bankRecordMap.get(t.id) || [];
      const ekstreTamam = !bankaVar || (ekstreRows.length > 0 && ekstreRows.every((r: any) => r.ekstreGeldi && r.ekstreIslendi));
      // Portal deriveStage ile aynı "kontrol bitti": İND+HES+ARŞİV (veya kdvKontrolEdildi).
      const kontrolBitti = !!(s.kdvKontrolEdildi || (s.indirilecekKdvKontrol && s.hesaplananKdvKontrol && s.eArsivKontrol));
      const eksikler: string[] = [];
      if (!s.evraklarGeldi) { evrakEksik++; eksikler.push('evrak gelmedi'); }
      if (s.evraklarGeldi && !s.evraklarIslendi) { islenmemis++; eksikler.push('evrak işlenmedi'); }
      if (s.evraklarGeldi && s.evraklarIslendi && !kontrolBitti) { kdvKontrolEksik++; eksikler.push('KDV kontrol eksik'); }
      // "Banka hesabı yok" ARTIK eksik sayılmaz (banka takibi olmayan mükellef normaldir,
      // yanlış alarm üretiyordu). Yalnız hesabı VARSA ekstre eksikliği aksiyondur.
      if (bankaVar && !ekstreTamam) { bankaEksik++; eksikler.push('banka ekstresi eksik/işlenmedi'); }
      // Beyanname VERİLEBİLİR = portal "beyan-hazir": evrak+işlem+kontrol ✓, henüz verilmemiş.
      if (s.evraklarGeldi && s.evraklarIslendi && kontrolBitti && !s.beyannameVerildi) {
        beyannameVerilebilir++;
        verilebilirler.push(ad);
      }
      const score = Math.max(0, 100 - (eksikler.length * 22));
      if (eksikler.length) readinessRows.push({ id: t.id, ad, score, durum: this.riskLevel(score), eksikler: eksikler.slice(0, 4) });
    }

    // Yaklaşan / geciken beyanname (BeyanDurumu beklemede + TC standart son gün, tek kaynak util).
    const fmtTr = (d: Date) => d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const yaklasanSureler: any[] = [];
    const gecikenBeyanname: any[] = [];
    for (const bd of beyanDurumlari as any[]) {
      const deadline = calculateBeyannameDeadline(bd.beyanTipi, bd.donem);
      if (!deadline) continue;
      // Gun basina yuvarlanmis fark. Eskiden ham Math.ceil aliniyordu ve son tarih
      // 23:59:59 oldugu icin kalan gun HER ZAMAN 1 fazla cikiyordu (canli dokumde
      // taranan 16 ifadenin tamami hatalidi). donem ve gunAdi da hazir veriliyor ki
      // model bunlari tahmin etmesin.
      const kalanGun = kalanGunHesapla(deadline, todayStart);
      const ad = this.displayName(bd.taxpayer || {});
      if (kalanGun < 0) {
        gecikenBeyanname.push({
          mukellef: ad, beyanTipi: bd.beyanTipi, donem: bd.donem,
          sonGun: fmtTr(deadline), sonGunAdi: gunAdi(deadline), gecenGun: -kalanGun,
        });
      } else if (kalanGun <= 14) {
        yaklasanSureler.push({
          mukellef: ad, beyanTipi: bd.beyanTipi, donem: bd.donem,
          sonGun: fmtTr(deadline), sonGunAdi: gunAdi(deadline), kalanGun,
        });
      }
    }
    yaklasanSureler.sort((a, b) => a.kalanGun - b.kalanGun);
    gecikenBeyanname.sort((a, b) => b.gecenGun - a.gecenGun);

    // Bugün evrakı gelmesi gereken mükellefler (evrakTeslimGunu = ayın günü).
    const bugunEvrakGelecek = (taxpayers as any[])
      .filter((t) => Number(t.evrakTeslimGunu) === todayDay)
      .map((t) => this.displayName(t));

    const cariVeriYok = cariRows === null; // sorgu hata verdi → "veri alınamadı" (0 borçlu DEĞİL)
    const aktifIdSet = new Set((taxpayers as any[]).map((t) => t.id));
    // TEK KAYNAK: common/cari-bakiye. Eskiden bu hesap uc ayri yerde farkli yapiliyordu
    // (biri pasifi eliyor biri elemiyor, IADE isareti Cari Kasa ile ters) ve owner'a ayni
    // gun sabah/aksam FARKLI toplam gidiyordu.
    const cariOzet = borcluOzeti(hesaplaCariBakiyeler(cariRows as any[], aktifIdSet));
    const borclular = cariOzet.borclular;
    const toplamBakiye = cariOzet.toplamBakiye;
    const bugunHata = (agentEvents || []).filter((e: any) => /hata|error|fail/i.test(String(e.status || ''))).length;
    const gecikenGorev = (tasks || []).filter((t: any) => t.dueDate && new Date(t.dueDate) < todayStart).length;

    return {
      period,
      beyannameDonem,
      ozet: {
        aktifMukellef: taxpayers.length,
        evrakEksik,
        islenmemis,
        kdvKontrolEksik,
        beyannameVerilebilir,
        gecikenBeyanname: gecikenBeyanname.length,
        yaklasanBeyanname: yaklasanSureler.length,
        bankaEksik,
        borcluMukellef: cariVeriYok ? null : borclular.length,
        toplamBakiye: cariVeriYok ? null : toplamBakiye,
        cariVeriYok,
        bugunEvrakGelecek: bugunEvrakGelecek.length,
        bugunAgentHata: bugunHata,
        bekleyenOnay: (pendingDecisions || []).length,
        gecikenGorev,
      },
      oneriler: [
        gecikenBeyanname.length ? `${gecikenBeyanname.length} beyannamede SÜRE GEÇTİ (acil)` : null,
        yaklasanSureler.length ? `${yaklasanSureler.length} beyannamenin son günü yaklaşıyor` : null,
        beyannameVerilebilir ? `${beyannameVerilebilir} mükellefin beyannamesi verilebilir (kontrol bitti)` : null,
        evrakEksik ? `${evrakEksik} mükellefte evrak bekleniyor` : null,
        bankaEksik ? `${bankaEksik} mükellefte banka ekstresi eksik/işlenmedi` : null,
        kdvKontrolEksik ? `${kdvKontrolEksik} mükellefte KDV kontrolü eksik` : null,
        cariVeriYok ? 'Borçlu/cari verisi şu an alınamadı (sıfır değil — sistem tekrar deneyecek)' : null,
        !cariVeriYok && borclular.length ? `${borclular.length} mükellefte açık cari bakiye var` : null,
        bugunEvrakGelecek.length ? `Bugün ${bugunEvrakGelecek.length} mükellefin evrakı gelmeli` : null,
        bugunHata ? `Bugün ${bugunHata} agent hatası var` : null,
      ].filter(Boolean),
      yaklasanSureler: yaklasanSureler.slice(0, 20),
      gecikenBeyanname: gecikenBeyanname.slice(0, 20),
      beyannameVerilebilirler: verilebilirler.slice(0, 20),
      bugunEvrakGelecek: bugunEvrakGelecek.slice(0, 20),
      riskliMukellefler: readinessRows.sort((a, b) => a.score - b.score).slice(0, 15),
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
      // PLAN/17 §0 bulgu 5 (2026-09-13): oturum alanı `periodLabel` ('YYYY/MM'); eski kod var olmayan `period` ile arıyordu → hep 0.
      (this.prisma as any).kdvControlSession.findMany({ where: { tenantId: ctx.tenantId, taxpayerId, periodLabel: this.periodLabelSlash(period) }, orderBy: { createdAt: 'desc' }, take: 6 }).catch(() => []),
      (this.prisma as any).beyanKaydi.findMany({ where: { tenantId: ctx.tenantId, taxpayerId, donem: period }, take: 10 }).catch(() => []),
      // Mizan çeyrek etiketiyle durur ('2026-06' ↔ '2026-Q2'); e-Defter kaynaklı mizan sahibin gördüğü mizan değildir, süzülür; kilitli önce.
      (this.prisma as any).mizan.findFirst({
        where: { tenantId: ctx.tenantId, taxpayerId, donem: { in: this.mizanDonemAdaylari(period) }, kaynak: { not: 'EDEFTER' } },
        orderBy: [{ locked: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, donem: true, locked: true, kaynak: true, donemTipi: true },
      }).catch(() => null),
      (this.prisma as any).cariHareket.findMany({ where: { tenantId: ctx.tenantId, taxpayerId }, select: { tip: true, tutar: true } }).catch(() => []),
      (this.prisma as any).agentEvent.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { ts: 'desc' }, take: 100 }).catch(() => []),
      (this.prisma as any).aiMemory?.findMany
        ? (this.prisma as any).aiMemory.findMany({ where: { tenantId: ctx.tenantId, taxpayerId, isActive: true }, orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }], take: 5 })
        : Promise.resolve([]),
    ]);
    if (!taxpayer) return { error: 'Mükellef bulunamadı' };
    // FATURA MERKEZİ sayımları (PLAN/15 Faz 5): Mihsap sayımının YANINA; mevcut alanlar bozulmaz.
    const faturaMerkezi = await this.faturaMerkeziSayimlari(ctx.tenantId, taxpayerId, period);
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
    // "LUCA mizan yok" yalnız KİLİTLİ (e-Defter dışı) mizan yoksa; kilitsiz taslak varsa ayrı uyarı.
    if (!mizan) eksikler.push('LUCA mizan yok');
    else if (!mizan.locked) eksikler.push('mizan var ama kilitsiz (taslak)');
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
        faturaMerkezi,
        lucaEarsivFatura: earsiv,
        kdvKontrolOturumu: kdvSessions.length,
        kdvKontrolOturumlari: (kdvSessions || []).map((k: any) => ({ sessionId: k.id, type: k.type, status: k.status, periodLabel: k.periodLabel, kilitli: k.status === 'COMPLETED' })),
        beyanKaydi: beyanlar.length,
        mizanVar: !!mizan,
        mizan: mizan ? { id: mizan.id, donem: mizan.donem, kilitli: !!mizan.locked, kaynak: mizan.kaynak, donemTipi: mizan.donemTipi } : null,
        bankaHesapSayisi: bankAccounts.length,
        cariBakiye,
        hafizaNotlari: memories.map((m: any) => ({ title: m.title, content: m.content, tags: m.tags })),
        sonAgentOlaylari: relevantAgentEvents,
      },
    };
  }

  /**
   * Fatura Merkezi (InvoiceAccountingDocument) dönem sayımları — get_taxpayer_work_status için.
   * Dönem = faturaTarihi (YYYY-MM); tarihi boş belge createdAt ile sayılır (servis summary() ile aynı kural).
   */
  private async faturaMerkeziSayimlari(tenantId: string, taxpayerId: string, period: string) {
    const bos = { toplam: 0, bekleyen: 0, onayli: 0, lucayaGitti: 0, lucaHatali: 0, okunmadi: 0, celiski: 0, mukerrer: 0 };
    const m = String(period || '').match(/^(\d{4})-(\d{2})$/);
    if (!taxpayerId || !m) return bos;
    const start = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
    const end = new Date(Date.UTC(Number(m[1]), Number(m[2]), 1));
    const docs: any[] = await (this.prisma as any).invoiceAccountingDocument.findMany({
      where: {
        tenantId, taxpayerId,
        OR: [{ faturaTarihi: { gte: start, lt: end } }, { faturaTarihi: null, createdAt: { gte: start, lt: end } }],
      },
      select: { status: true, lucaStatus: true, ocrStatus: true, validationStatus: true, validationIssues: true, duplicateOfId: true, ocrData: true },
      take: 5000,
    }).catch(() => []);
    const out = { ...bos, toplam: docs.length };
    for (const d of docs) {
      const st = String(d.status || '').toUpperCase();
      if (['READY', 'NEEDS_REVIEW', 'PENDING', 'PROCESSING'].includes(st)) out.bekleyen++;
      if (st === 'APPROVED') out.onayli++;
      const ls = String(d.lucaStatus || '').toUpperCase();
      if (ls === 'POSTED') out.lucayaGitti++;
      if (ls === 'FAILED') out.lucaHatali++;
      const os = String(d.ocrStatus || '').toUpperCase();
      if (['PENDING', 'IN_PROGRESS', 'FAILED', 'CANCELLED'].includes(os) || d?.ocrData?.matchDeferred === true) out.okunmadi++;
      const vs = String(d.validationStatus || d?.ocrData?.validationStatus || '').toUpperCase();
      if (vs === 'INVALID' || vs === 'INCOMPLETE' || (Array.isArray(d.validationIssues) && d.validationIssues.length > 0)) out.celiski++;
      if (d.duplicateOfId) out.mukerrer++;
    }
    return out;
  }

  /**
   * fm_* araçları → FmAjanService (fatura-muhasebelestirme/fm-ajan.service.ts). Servis dinamik çözülür
   * (getKdv1OnHazirlik deseni): moren-ai jest koşuları Fatura Merkezi zincirini (xlsx/pdf) yüklemesin.
   * Kademe kontrolü (kuru test, ajan listesi) EKİP runner'ındadır; burası yalnız çalıştırır.
   */
  private async fmAjanAraci(name: string, input: any, ctx: { tenantId: string; userId?: string | null; taxpayerId?: string | null }) {
    let svc: any = null;
    try {
      const { FmAjanService } = await import('../fatura-muhasebelestirme/fm-ajan.service');
      svc = this.moduleRef?.get?.(FmAjanService, { strict: false });
    } catch (e: any) {
      this.logger.warn(`FmAjanService çözülemedi: ${e?.message || e}`);
    }
    if (!svc) return { ok: false, error: 'Fatura Merkezi ajan servisi kullanılamıyor.' };
    const taxpayerId = String(input?.taxpayerId || ctx.taxpayerId || '').trim();
    const donem = this.normalizeDonemYYYYMM(input?.donem || input?.period);
    const yon = (() => {
      const y = String(input?.yon || '').toLowerCase();
      return y === 'alis' || y === 'satis' ? y : null;
    })();
    const idListesi = (v: any): string[] => (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []).map((s) => String(s || '').trim()).filter(Boolean);
    const mukellefSart = () => (!taxpayerId ? { ok: false, error: 'taxpayerId gerekli (list_taxpayers ile bul).' } : null);
    const donemSart = () => (!donem ? { ok: false, error: 'donem YYYY-MM biçiminde olmalı (örn. 2026-08).' } : null);
    try {
      switch (name) {
        case 'fm_belge_listele': {
          const e = mukellefSart() || donemSart(); if (e) return e;
          return await svc.belgeListele(ctx.tenantId, { taxpayerId, donem, yon, durum: input?.durum || null, limit: input?.limit });
        }
        case 'fm_belge_detay':
          return await svc.belgeDetay(ctx.tenantId, String(input?.belgeId || input?.id || ''));
        case 'fm_donem_ozeti': {
          const e = mukellefSart() || donemSart(); if (e) return e;
          return await svc.donemOzeti(ctx.tenantId, taxpayerId, donem);
        }
        case 'fm_uyumsuzluklar': {
          const e = mukellefSart() || donemSart(); if (e) return e;
          return await svc.uyumsuzluklar(ctx.tenantId, taxpayerId, donem, input?.limit);
        }
        case 'fm_hesap_plani_ara': {
          const e = mukellefSart(); if (e) return e;
          return await svc.hesapPlaniAra(ctx.tenantId, { taxpayerId, sorgu: String(input?.sorgu || input?.q || ''), yon, limit: input?.limit });
        }
        case 'fm_hesap_ata':
          return await svc.hesapAta(ctx.tenantId, {
            belgeId: String(input?.belgeId || ''), satir: input?.satir ?? input?.satirNo ?? null,
            hesapKodu: input?.hesapKodu ?? null, kayitTuruKod: input?.kayitTuruKod ?? null, kayitAltKod: input?.kayitAltKod ?? null,
            gerekce: String(input?.gerekce || ''), userId: ctx.userId || null,
          });
        case 'fm_ai_ile_oku':
          return await svc.aiIleOku(ctx.tenantId, idListesi(input?.belgeIdler ?? input?.belgeId));
        case 'fm_isaretle':
          return await svc.isaretle(ctx.tenantId, { belgeId: String(input?.belgeId || ''), etiket: input?.etiket, not: String(input?.not || input?.aciklama || ''), userId: ctx.userId || null });
        case 'fm_onayla':
          return await svc.onayla(ctx.tenantId, String(input?.belgeId || ''), ctx.userId || null);
        case 'fm_luca_gonder': {
          const e = mukellefSart(); if (e) return e;
          return await svc.lucaGonder(ctx.tenantId, { taxpayerId, belgeIdler: idListesi(input?.belgeIdler), donem, yon, userId: ctx.userId || null });
        }
        default:
          return { ok: false, error: `Bilinmeyen fm aracı: ${name}` };
      }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
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
    const action = String(input?.action || '').trim();
    // OTOMATİK DÜZELTME: action bir İŞLEM registry key'iyse (edefter_kontrol, mizan_cek...)
    // agent HER ZAMAN 'islem'dir. Model "edefter"/"luca" gibi yanlış agent seçse bile
    // doğru çalışsın (kullanıcı "e-defter kontrolünü başlat" deyince agent uydurmasın).
    const agent = isIslemAction(action) ? 'islem' : String(input?.agent || '').trim();
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
      // GERÇEKTEN yürütülen owner işlemleri — TEK kaynak ISLEM_OPERATIONS registry'si.
      // payload: { taxpayerId, donem: "YYYY-MM" }. Yeni operasyon = registry'ye 1 satır.
      islem: ISLEM_ACTION_KEYS,
    };
    const errors: string[] = [];
    if (!supported[agent]) errors.push(`Desteklenmeyen agent: ${agent}`);
    else if (!supported[agent].includes(action)) errors.push(`${agent} için desteklenmeyen action: ${action}`);
    if (isMihsapFaturaCommandAgent(agent) && (!payload.ay || !Array.isArray(payload.mukellefler) || payload.mukellefler.length === 0)) {
      errors.push('Mihsap komutu için payload.ay ve payload.mukellefler gerekir');
    }
    // Dönem: aylık "YYYY-MM", geçici/3-aylık "YYYY-Qn" (e-defter "1. dönem"=Q1), yıllık "YYYY".
    if (agent === 'islem' && (!payload.taxpayerId || !/^\d{4}(-(\d{2}|Q[1-4]))?$/i.test(String(payload.donem || '')))) {
      errors.push('İşlem komutu için payload.taxpayerId ve payload.donem ("YYYY-MM" / "YYYY-Qn" / "YYYY") gerekir');
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
    if (agent === 'islem') {
      const op = ISLEM_OPERATIONS[action];
      const d = String(payload?.donem || '');
      return (op ? op.impact(d) : `${action} işlemi çalıştırılır`) + '. Onaylarsan GERÇEKTEN çalışır; sonucu sana bildiririm.';
    }
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
      // isActive suzgeci: brifing ile AYNI mukellef kumesi kullanilsin diye eklendi.
      // Eskiden pasif/kapanmis mukellefler de borclu sayiliyor, ayni gun brifingden
      // FARKLI toplam cikiyordu.
      this.prisma.taxpayer.findMany({ where: { tenantId: ctx.tenantId, isActive: true }, select: { id: true, companyName: true, firstName: true, lastName: true, phone: true, phones: true } }),
      (this.prisma as any).cariHareket.findMany({ where: { tenantId: ctx.tenantId }, select: { taxpayerId: true, tip: true, tutar: true, tarih: true } }),
    ]);
    const tMap = new Map((taxpayers as any[]).map((t) => [t.id, t]));
    // TEK KAYNAK + AKTIF SUZGECI: bu fonksiyon eskiden pasif mukellefi elemiyor ve IADE'yi
    // hic saymiyordu; brifingle ayni gun farkli toplam uretiyordu.
    const aktifIdSet = new Set((taxpayers as any[]).map((t) => t.id));
    const riskli = borcluOzeti(hesaplaCariBakiyeler(rows as any[], aktifIdSet)).borclular
      .map((b) => {
        const t: any = tMap.get(b.taxpayerId);
        const phone = t?.phone || (Array.isArray(t?.phones) ? t.phones.find(Boolean) : null);
        return { taxpayerId: b.taxpayerId, ad: t ? this.displayName(t) : b.taxpayerId, bakiye: b.bakiye, sonTahsilat: b.sonTahsilat, whatsappUygun: !!phone };
      });
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
      // GERÇEKTEN çalıştırılabilen owner işlemleri (preview→ONAYLIYORUM→çalışır).
      // agent="islem", action=aşağıdakilerden biri, payload={taxpayerId, donem:"YYYY-MM"}.
      calistirilabilirIslemler: islemCapabilityList(),
      // Mihsap fatura işleme (kendi runner'ı) — agent="mihsap", action=isle_*.
      mihsapFaturaIsleme: actionAgents.mihsap,
      executionRule: 'Okuma/analiz doğrudan yapılır. İŞLEM çalıştırma: agent="islem" + yukarıdaki bir action + payload{taxpayerId,donem} ile preview_agent_command → kullanıcıya NE YAPACAĞINI tekrar et + ONAYLIYORUM #PRV-XXXX iste → create_confirmed_agent_command. Yalnız calistirilabilirIslemler GERÇEKTEN çalışır; listede olmayan bir işlemi (beyanname verme, e-tebligat tarama, mesaj gönderme vb.) "yaptım/başlattım" DEME, kullanıcıya "portaldan yapılması gerek" de.',
      currentLimits: [
        'Yalnız calistirilabilirIslemler listesindeki işlemler otomatik çalışır; diğer işlemler şimdilik portaldan yapılır (bot uydurmaz, "yapamam, portaldan" der).',
        'Mükellefe mesaj/SMS gönderme bot tarafından yapılmaz (proaktif-mesaj kuralı).',
        'Resmi kaynak araştırması internet erişimine bağlıdır.',
        'Kalıcı öğrenme ofis/mükellef hafızasına yazılan notlarla yapılır.',
      ],
    };
  }

  /**
   * GUNDEM — TCMB kuru, TUFE/kira artis tavani, piyasa, Resmi Gazete ozetleri.
   * gundem.service gunluk onbellek tutuyor; panelde gorunen bu veri bota KAPALIYDI.
   * Kamuya acik veri: hem owner hem mukellef kullanabilir.
   */
  private async getGundem(input: any, _ctx: { tenantId: string }) {
    try {
      const { GundemService } = await import('../gundem/gundem.service');
      const svc: any = this.moduleRef?.get?.(GundemService, { strict: false });
      if (!svc?.getGundem) return { error: 'Gundem servisi kullanilamiyor.' };
      const d: any = await svc.getGundem();
      const bolum = String(input?.bolum || '').toLowerCase();
      if (bolum === 'kur') return { tarih: d?.tarih, kurTarihi: d?.kurTarihi, kurlar: d?.kurlar || [] };
      if (bolum === 'piyasa') return { tarih: d?.tarih, piyasa: d?.piyasa || [] };
      if (bolum === 'enflasyon') return { tarih: d?.tarih, enflasyon: d?.enflasyon || null };
      if (bolum === 'mevzuat') return { tarih: d?.tarih, mevzuat: (d?.mevzuat || []).slice(0, 10), toplam: d?.mevzuatToplam };
      return {
        tarih: d?.tarih, kurlar: (d?.kurlar || []).slice(0, 6), piyasa: (d?.piyasa || []).slice(0, 6),
        enflasyon: d?.enflasyon || null, mevzuat: (d?.mevzuat || []).slice(0, 5), uyarilar: d?.uyarilar || [],
      };
    } catch (e: any) {
      return { error: `Gundem verisi alinamadi: ${e?.message || e}` };
    }
  }

  /**
   * FATURA ISLEME MERKEZI — InvoiceAccountingDocument. Bota TAMAMEN kapaliydi;
   * "kac fatura islendi / hangileri Luca'ya gitti / eslesmeyen var mi" sorularinda
   * bot ham Mihsap listesini "islenen fatura" diye sunuyordu (yanlis sayi).
   */
  private async listFaturaMerkezi(input: any, ctx: { tenantId: string }) {
    const where: any = { tenantId: ctx.tenantId };
    if (input?.taxpayerId || input?.taxpayerName || input?.mukellefId) {
      const t = await this.resolveTaxpayerFromInput(input, ctx);
      if (t) where.taxpayerId = t.id;
    }
    if (input?.durum) where.status = String(input.durum).toUpperCase();
    if (input?.lucaDurum) where.lucaStatus = String(input.lucaDurum).toUpperCase();
    if (input?.tur) where.invoiceKind = String(input.tur).toUpperCase();
    const donem = String(input?.donem || '').trim();
    if (/^\d{4}-\d{2}$/.test(donem)) {
      const [y, m] = donem.split('-').map(Number);
      where.faturaTarihi = { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) };
    }
    const limit = Math.min(Number(input?.limit) || 25, 100);
    const [kayitlar, toplam] = await Promise.all([
      (this.prisma as any).invoiceAccountingDocument.findMany({
        where, orderBy: [{ faturaTarihi: 'desc' }, { createdAt: 'desc' }], take: limit,
        select: {
          id: true, documentType: true, invoiceKind: true, status: true, belgeNo: true,
          faturaTarihi: true, vendorName: true, customerName: true, totalAmount: true,
          lucaStatus: true, lucaFisNo: true, duplicateOfId: true,
          taxpayer: { select: { companyName: true, firstName: true, lastName: true } },
        },
      }).catch(() => []),
      (this.prisma as any).invoiceAccountingDocument.count({ where }).catch(() => 0),
    ]);
    const sayim = (alan: string) => kayitlar.reduce((a: any, k: any) => { const v = k[alan] || '-'; a[v] = (a[v] || 0) + 1; return a; }, {});
    return {
      modul: 'Fatura İşleme Merkezi',
      toplam,
      gosterilen: kayitlar.length,
      durumDagilimi: sayim('status'),
      lucaDagilimi: sayim('lucaStatus'),
      faturalar: kayitlar.map((k: any) => ({
        belgeNo: k.belgeNo || '-', tur: k.documentType, yon: k.invoiceKind,
        tarih: k.faturaTarihi ? new Date(k.faturaTarihi).toISOString().slice(0, 10) : null,
        karsiTaraf: k.vendorName || k.customerName || '-',
        tutar: this.toNum(k.totalAmount), durum: k.status,
        luca: k.lucaStatus, lucaFisNo: k.lucaFisNo || null,
        kopyaMi: !!k.duplicateOfId,
        mukellef: k.taxpayer ? (k.taxpayer.companyName || `${k.taxpayer.firstName || ''} ${k.taxpayer.lastName || ''}`).trim() : null,
      })),
      not: toplam === 0 ? 'Bu kriterlerde Fatura Merkezi kaydi yok.' : undefined,
    };
  }

  /** E-DEFTER KONTROL oturumlari ve bulgu sayilari. Bota kapaliydi. */
  private async listEdefterSessions(input: any, ctx: { tenantId: string }) {
    const where: any = { tenantId: ctx.tenantId };
    if (input?.taxpayerId || input?.taxpayerName || input?.mukellefId) {
      const t = await this.resolveTaxpayerFromInput(input, ctx);
      if (t) where.taxpayerId = t.id;
    }
    if (input?.donem) where.donem = String(input.donem);
    const limit = Math.min(Number(input?.limit) || 15, 50);
    const rows = await (this.prisma as any).eDefterControlSession.findMany({
      where, orderBy: [{ createdAt: 'desc' }], take: limit,
      select: {
        id: true, donem: true, donemTipi: true, kaynak: true, status: true,
        totalLines: true, totalVouchers: true, findingCount: true, createdAt: true,
        taxpayer: { select: { companyName: true, firstName: true, lastName: true } },
      },
    }).catch(() => []);
    return {
      modul: 'e-Defter Kontrol',
      adet: rows.length,
      oturumlar: rows.map((r: any) => ({
        donem: r.donem, tip: r.donemTipi, kaynak: r.kaynak, durum: r.status,
        satir: r.totalLines, fis: r.totalVouchers, bulgu: r.findingCount,
        tarih: r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : null,
        mukellef: r.taxpayer ? (r.taxpayer.companyName || `${r.taxpayer.firstName || ''} ${r.taxpayer.lastName || ''}`).trim() : null,
      })),
      not: rows.length === 0 ? 'e-Defter kontrol oturumu yok.' : undefined,
    };
  }

  /** OTOMASYONLAR — Automation + son calismalar. Bota kapaliydi, ajan islerine karisiyordu. */
  private async listAutomations(input: any, ctx: { tenantId: string }) {
    const limit = Math.min(Number(input?.limit) || 20, 50);
    const rows = await (this.prisma as any).automation.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ lastRunAt: 'desc' }], take: limit,
      select: { id: true, name: true, status: true, lastRunAt: true, lastRunStatus: true, totalRuns: true },
    }).catch(() => []);
    return {
      modul: 'Otomasyonlar',
      adet: rows.length,
      otomasyonlar: rows.map((r: any) => ({
        ad: r.name, durum: r.status, sonCalisma: r.lastRunAt ? new Date(r.lastRunAt).toISOString().slice(0, 16).replace('T', ' ') : null,
        sonSonuc: r.lastRunStatus || '-', toplamCalisma: r.totalRuns,
      })),
      not: rows.length === 0 ? 'Tanimli otomasyon yok.' : undefined,
    };
  }

  private async researchOfficialSources(input: any, ctx: { tenantId: string; userId?: string | null }) {
    const query = String(input?.query || '').trim();
    if (!query) return { error: 'query zorunlu' };

    const limit = Math.max(1, Math.min(Number(input?.limit || 2), 4));
    const domains = this.normalizeOfficialDomains(input?.domains);
    const domainFilter = domains.map((domain) => `site:${domain}`).join(' OR ');
    const searchQuery = `${query} ${domainFilter}`;
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
    const bingUrl = `https://www.bing.com/search?setlang=tr&q=${encodeURIComponent(searchQuery)}`;
    // HIZ: araştırma WhatsApp cevabını bekletmesin. Bing taraması + sayfa okuma
    // timeout'ları düşürüldü (12s→7s, 9s→6s); boş dönerse model bilgisinden + uydurma
    // yasağıyla (stabil kural/formül) hızlı cevap verir, takılmaz.
    // ARAMA YOLU (canli olcumle secildi):
    //  - DuckDuckGo site: filtresine UYAR ama arka arkaya sorguda HIZ SINIRINA takilir
    //    (HTTP 202 + "anomaly" sayfasi, 0 sonuc).
    //  - Bing hep 200 doner ama sonuclari /ck/a yonlendirmesine sarar (cozuluyor) ve
    //    site: filtresini cogu zaman YOK SAYAR, o yuzden resmi olmayan alan adlari gelir.
    // Bu yuzden: once DDG (anomalide bir kez tekrar), sonra Bing yedegi.
    let motor = 'duckduckgo';
    let ddgHtml = await this.fetchText(ddgUrl, 7000);
    if (/anomaly|unusual traffic/i.test(ddgHtml) || !/result__a/.test(ddgHtml)) {
      ddgHtml = await this.fetchText(ddgUrl, 7000);
    }
    let searchResults = this.parseDuckDuckGoResults(ddgHtml, domains, limit);
    if (!searchResults.length) {
      motor = 'bing';
      searchResults = this.parseBingResults(await this.fetchText(bingUrl, 7000), domains, limit);
    }
    if (!searchResults.length) {
      motor = 'yok';
      // SESSIZ KALMA: arac bozulursa (motor HTML'i degisirse) fark edilmeli. Eskiden
      // bu durum hic loglanmiyordu ve arac AYLARCA 0 kaynak donerken kimse gormedi.
      this.logger.warn(`[research_official_sources] 0 KAYNAK — sorgu: ${searchQuery.slice(0, 160)}`);
    }

    const sources = await Promise.all(
      searchResults.map(async (result) => {
        const markdown = await this.fetchText(this.readerUrl(result.url), 6000);
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
      motor,
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
  // =====================================================================================
  // EKİP İŞ ZİNCİRİ ARAÇLARI — PLAN/17 §3 (2026-09-13)
  //
  // KDV Kontrol / Mizan / Luca servisleri KİLİTLİ modüllerdir: burada yalnız ÇAĞRILIR
  // (moduleRef.get(..., {strict:false}); KdvControlModule'ü MorenAiModule'e almak döngü yaratır).
  // Bekleme araçları sunucu tarafında 5 sn döngü kurar (≤60 sn/çağrı): runner'da uyku aracı yok.
  // Kademe/kuru test kesimi EKİP runner + arac-defteri'ndedir; burası yalnız çalıştırır.
  // =====================================================================================

  /** 'YYYY-MM' | 'YYYY/MM' | 'YYYY/M' → 'YYYY/MM' (KDV Kontrol oturum etiketi). Tanınmazsa null. */
  private periodLabelSlash(v: any): string | null {
    const m = String(v || '').trim().match(/^(\d{4})[\s/._-](\d{1,2})$/);
    if (!m) return null;
    const ay = Number(m[2]);
    if (ay < 1 || ay > 12) return null;
    return `${m[1]}/${String(ay).padStart(2, '0')}`;
  }

  /**
   * Aylık dönem için mizan etiket adayları: financialPeriodCandidates (çeyrek sonu ayı ↔ 'YYYY-Qn') + ayın
   * içinde bulunduğu çeyrek ('2026-08' → '2026-Q3'; çeyrek mizanı ay kapanmadan da oluşmuş olabilir).
   */
  private mizanDonemAdaylari(period: string): string[] {
    const out = new Set<string>(this.financialPeriodCandidates(period));
    const m = String(period || '').match(/^(\d{4})-(\d{2})$/);
    if (m) out.add(`${m[1]}-Q${Math.ceil(Number(m[2]) / 3)}`);
    return Array.from(out);
  }

  /** Test edilebilir uyku (spec jest.spyOn ile kısaltır). İptal sinyali gelirse erken döner. */
  private bekle(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        signal?.removeEventListener?.('abort', bitir);
        resolve();
      }, ms);
      const bitir = () => {
        clearTimeout(t);
        resolve();
      };
      signal?.addEventListener?.('abort', bitir, { once: true });
    });
  }

  private bekleSaniye(v: any, varsayilan = 60, tavan = 60): number {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return varsayilan;
    return Math.min(Math.floor(n), tavan);
  }

  /** Kilitli modül servisini dinamik çöz (getKdv1OnHazirlik deseni); yoksa null. */
  private async kdvKontrolServisi(): Promise<any> {
    try {
      const { KdvControlService } = await import('../kdv-control/kdv-control.service');
      return this.moduleRef?.get?.(KdvControlService, { strict: false }) || null;
    } catch (e: any) {
      this.logger.warn(`KdvControlService çözülemedi: ${e?.message || e}`);
      return null;
    }
  }

  private async lucaServisi(): Promise<any> {
    try {
      const { LucaService } = await import('../luca/luca.service');
      return this.moduleRef?.get?.(LucaService, { strict: false }) || null;
    } catch (e: any) {
      this.logger.warn(`LucaService çözülemedi: ${e?.message || e}`);
      return null;
    }
  }

  /**
   * Oturum açan kullanıcı (createdBy zorunlu — schema KdvControlSession.createdBy String).
   * ctx.userId yoksa (cron/Koordinatör yolu) tenant sahibi: MOREN_OWNER_EMAIL / MOREN_BUTCE_OWNER_EMAIL
   * (OwnerOnlyGuard ile aynı sıra) → yoksa ADMIN rollü ilk aktif kullanıcı → yoksa en eski aktif kullanıcı.
   */
  private async oturumKullaniciId(ctx: { tenantId: string; userId?: string | null }): Promise<string | null> {
    if (ctx.userId) return ctx.userId;
    const user = (this.prisma as any).user;
    if (!user?.findFirst) return null;
    const ownerEmail = String(process.env.MOREN_BUTCE_OWNER_EMAIL || process.env.MOREN_OWNER_EMAIL || '').trim().toLowerCase();
    if (ownerEmail) {
      const sahip = await user
        .findFirst({ where: { tenantId: ctx.tenantId, isActive: true, email: { equals: ownerEmail, mode: 'insensitive' } }, select: { id: true } })
        .catch(() => null);
      if (sahip?.id) return sahip.id;
    }
    const admin = await user
      .findFirst({
        where: { tenantId: ctx.tenantId, isActive: true, userRoles: { some: { role: { name: { in: ['OWNER', 'ADMIN'] } } } } },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })
      .catch(() => null);
    if (admin?.id) return admin.id;
    const ilk = await user
      .findFirst({ where: { tenantId: ctx.tenantId, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } })
      .catch(() => null);
    return ilk?.id || null;
  }

  /** Defter türünden oturum türleri (R1 dallar). */
  private kdvOturumTurleri(defterTuru: 'BILANCO' | 'ISLETME' | null): Array<'KDV_191' | 'KDV_391' | 'ISLETME_GIDER' | 'ISLETME_GELIR'> {
    if (defterTuru === 'BILANCO') return ['KDV_191', 'KDV_391'];
    if (defterTuru === 'ISLETME') return ['ISLETME_GIDER', 'ISLETME_GELIR'];
    return [];
  }

  /** NestJS HttpException → {status, mesaj}; düz hata → {status:null}. */
  private hataBilgisi(e: any): { status: number | null; mesaj: string } {
    const status = typeof e?.getStatus === 'function' ? e.getStatus() : typeof e?.status === 'number' ? e.status : null;
    const r = typeof e?.getResponse === 'function' ? e.getResponse() : null;
    const mesaj = String((r && typeof r === 'object' ? (r as any).message : r) || e?.message || e || 'bilinmeyen hata');
    return { status, mesaj: Array.isArray(mesaj) ? mesaj.join('; ') : mesaj };
  }

  private async maliDonemlerListele(input: any, ctx: { tenantId: string; taxpayerId?: string | null }) {
    const taxpayerId = String(input?.taxpayerId || ctx.taxpayerId || '').trim();
    if (!taxpayerId) return { ok: false, error: 'taxpayerId gerekli (list_taxpayers ile bul).' };
    const where = { tenantId: ctx.tenantId, taxpayerId };
    const tarih = (d: any) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
    const [gtler, bilancolar, mizanlar] = await Promise.all([
      this.prisma.gelirTablosu
        .findMany({ where, select: { id: true, donem: true, donemTipi: true, locked: true, lockedAt: true, mizanId: true, createdAt: true }, orderBy: [{ donem: 'desc' }, { locked: 'desc' }, { createdAt: 'desc' }], take: 100 })
        .catch(() => [] as any[]),
      this.prisma.bilanco
        .findMany({ where, select: { id: true, donem: true, donemTipi: true, locked: true, lockedAt: true, mizanId: true, createdAt: true }, orderBy: [{ donem: 'desc' }, { locked: 'desc' }, { createdAt: 'desc' }], take: 100 })
        .catch(() => [] as any[]),
      // e-Defter kaynaklı mizanlar sahibin Mizan sayfasında gördüğü mizan değildir → süzülür (canlı: 125 EDEFTER / 58 kilitli EXCEL).
      this.prisma.mizan
        .findMany({ where: { ...where, kaynak: { not: 'EDEFTER' } }, select: { id: true, donem: true, donemTipi: true, locked: true, lockedAt: true, kaynak: true, status: true, createdAt: true }, orderBy: [{ donem: 'desc' }, { locked: 'desc' }, { createdAt: 'desc' }], take: 100 })
        .catch(() => [] as any[]),
    ]);
    const satir = (tur: 'GELIR_TABLOSU' | 'BILANCO' | 'MIZAN', r: any) => ({
      tur,
      donem: r.donem,
      donemTipi: r.donemTipi ?? null,
      id: r.id,
      kilitli: !!r.locked,
      kilitTarihi: tarih(r.lockedAt),
      kaynak: tur === 'MIZAN' ? r.kaynak ?? null : r.mizanId ? `mizan ${r.mizanId}` : 'manuel/bilinmiyor',
      ...(tur === 'MIZAN' ? { status: r.status ?? null } : {}),
      createdAt: tarih(r.createdAt),
    });
    const liste = [
      ...(gtler as any[]).map((r) => satir('GELIR_TABLOSU', r)),
      ...(bilancolar as any[]).map((r) => satir('BILANCO', r)),
      ...(mizanlar as any[]).map((r) => satir('MIZAN', r)),
    ].sort((a, b) => String(b.donem).localeCompare(String(a.donem)) || Number(b.kilitli) - Number(a.kilitli) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    // Aynı tür+dönemde birden çok kopya → ajan kilitli olanı seçsin diye işaret.
    const kopya: Record<string, number> = {};
    for (const r of liste) kopya[`${r.tur}|${r.donem}`] = (kopya[`${r.tur}|${r.donem}`] || 0) + 1;
    return {
      ok: true,
      taxpayerId,
      sayim: { gelirTablosu: gtler.length, bilanco: bilancolar.length, mizan: mizanlar.length, toplam: liste.length },
      donemler: liste.map((r) => ({ ...r, kopyaSayisi: kopya[`${r.tur}|${r.donem}`] })),
      not:
        liste.length === 0
          ? 'HAZIR DEĞİL: portalda mali tablo yok — sahip Mizan/Gelir Tablosu sayfasından oluşturmalı (ajan Luca çekimi istemez).'
          : 'Aynı dönemde birden çok kopya varsa KİLİTLİ olanı oku. Mizan listesinde e-Defter kaynaklılar süzüldü.',
    };
  }

  private async maliYorumOku(input: any, ctx: { tenantId: string }) {
    const kaynak = String(input?.kaynak || '').trim().toUpperCase();
    const kaynakId = String(input?.kaynakId || '').trim();
    if (!['MIZAN', 'BILANCO', 'GELIR_TABLOSU', 'IHO'].includes(kaynak)) return { ok: false, error: 'kaynak MIZAN | BILANCO | GELIR_TABLOSU | IHO olmalı.' };
    if (!kaynakId) return { ok: false, error: 'kaynakId gerekli (get_gelir_tablosu → kayitId, get_mizan → mizanId).' };
    let svc: any = null;
    try {
      const { MaliYorumService } = await import('../mali-yorum/mali-yorum.service');
      svc = this.moduleRef?.get?.(MaliYorumService, { strict: false });
    } catch (e: any) {
      this.logger.warn(`MaliYorumService çözülemedi: ${e?.message || e}`);
    }
    if (!svc?.get) return { ok: false, error: 'Mali Yorum servisi kullanılamıyor.' };
    const row = await svc.get(ctx.tenantId, kaynak, kaynakId);
    if (!row) return { ok: true, yorum: null, not: 'kayıtlı yorum yok' };
    return {
      ok: true,
      yorum: {
        ozet: row.ozet,
        model: row.model,
        donem: row.donem ?? null,
        updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt ?? null,
      },
      not: 'Sahibin kayıtlı yorumu; ajan yorum üretmez/kaydetmez, çelişkiyi belirtir.',
    };
  }

  /** R1 adım 2 — oturumu bul/aç; type boşsa defter türünden iki oturum. */
  private async kdvKontrolOturumBulOlustur(input: any, ctx: { tenantId: string; userId?: string | null; taxpayerId?: string | null }) {
    const taxpayerId = String(input?.taxpayerId || ctx.taxpayerId || '').trim();
    const periodLabel = this.periodLabelSlash(input?.periodLabel || input?.period || input?.donem);
    if (!taxpayerId) return { ok: false, error: 'taxpayerId gerekli (list_taxpayers ile bul).' };
    if (!periodLabel) return { ok: false, error: 'periodLabel "YYYY/MM" biçiminde olmalı (örn. 2026/08).' };

    const taxpayer = await this.prisma.taxpayer.findFirst({
      where: { id: taxpayerId, tenantId: ctx.tenantId },
      select: { id: true, companyName: true, firstName: true, lastName: true, defterTuru: true, mihsapDefterTuru: true },
    });
    if (!taxpayer) return { ok: false, error: 'Mükellef bulunamadı' };
    const defterTuru = this.defterTuruNormalize(taxpayer);

    const GECERLI = ['KDV_191', 'KDV_391', 'ISLETME_GELIR', 'ISLETME_GIDER'];
    const istenen = String(input?.type || '').trim().toUpperCase();
    let turler: string[];
    if (istenen) {
      if (!GECERLI.includes(istenen)) return { ok: false, error: `Geçersiz kontrol türü: ${istenen} (KDV_191 | KDV_391 | ISLETME_GELIR | ISLETME_GIDER)` };
      turler = [istenen];
    } else {
      turler = this.kdvOturumTurleri(defterTuru);
      if (!turler.length) {
        return { ok: false, error: 'DUR: defter türü tanımsız — mükellef kartından BILANCO/ISLETME seçilmeli (type verilmeden oturum türetilemez).', defterTuru: null };
      }
    }

    const svc = await this.kdvKontrolServisi();
    if (!svc?.findOrCreateSession) return { ok: false, error: 'KDV Kontrol servisi kullanılamıyor.' };
    const userId = await this.oturumKullaniciId(ctx);
    if (!userId) return { ok: false, error: 'Oturum açacak kullanıcı bulunamadı (ctx.userId boş, tenant sahibi çözülemedi).' };

    const oturumlar: any[] = [];
    for (const type of turler) {
      try {
        const r = await svc.findOrCreateSession(ctx.tenantId, userId, { type, periodLabel, taxpayerId });
        const s = r?.session || {};
        // Yeni oturumda _count yok (createSession include'u yalnız taxpayer) → ayrı sayım.
        let lucaKayitSayisi = Number(s?._count?.kdvRecords ?? NaN);
        let faturaSayisi = Number(s?._count?.images ?? NaN);
        if (!Number.isFinite(lucaKayitSayisi)) lucaKayitSayisi = await this.prisma.kdvRecord.count({ where: { sessionId: s.id } }).catch(() => 0);
        if (!Number.isFinite(faturaSayisi)) faturaSayisi = await this.prisma.receiptImage.count({ where: { sessionId: s.id } }).catch(() => 0);
        oturumlar.push({
          sessionId: s.id,
          type: s.type || type,
          status: s.status,
          yeni: r?.created === true,
          lucaKayitSayisi,
          faturaSayisi,
          kilitli: s.status === 'COMPLETED',
        });
      } catch (e: any) {
        const h = this.hataBilgisi(e);
        oturumlar.push({ sessionId: null, type, status: null, yeni: false, lucaKayitSayisi: 0, faturaSayisi: 0, kilitli: false, hata: h.mesaj });
      }
    }
    const kilitliler = oturumlar.filter((o) => o.kilitli);
    return {
      ok: oturumlar.some((o) => o.sessionId),
      taxpayerId,
      mukellef: this.displayName(taxpayer),
      periodLabel,
      defterTuru,
      oturumlar,
      ...(kilitliler.length
        ? { uyari: `${kilitliler.map((o) => `${o.type} (${o.sessionId})`).join(', ')} KİLİTLİ (COMPLETED): zincire DEVAM ETME; sahibe "kilitli, açayım mı" diye sor. Kilit açma yalnız sahipte.` }
        : {}),
    };
  }

  /** R1 adım 3 — Luca çekim işi. Luca ajanı çevrimiçi değilse iş açılmaz. */
  private async kdvKontrolLucaCek(input: any, ctx: { tenantId: string; userId?: string | null }) {
    const sessionId = String(input?.sessionId || '').trim();
    if (!sessionId) return { ok: false, error: 'sessionId gerekli.' };
    const targetDeviceId = String(input?.targetDeviceId || '').trim() || undefined;

    // Çevrimiçi Luca ajanı: son 3 dk içinde ping (luca.service findOnlineOperatorDevice ile aynı eşik).
    // Hedef cihaz verilmediyse atamasız işi yalnız yerel Node işçisi alır (DEV-* Chrome uzantısı alamaz).
    const since = new Date(Date.now() - 3 * 60 * 1000);
    const cihazlar: any[] = await (this.prisma as any).agentStatus
      .findMany({
        where: { tenantId: ctx.tenantId, agent: 'luca', lastPing: { gte: since }, ...(targetDeviceId ? { deviceId: targetDeviceId } : {}) },
        select: { deviceId: true, lastPing: true, running: true },
        orderBy: { lastPing: 'desc' },
      })
      .catch(() => []);
    const uygun = targetDeviceId ? cihazlar : cihazlar.filter((c) => c.deviceId && !/^DEV-/i.test(String(c.deviceId)));
    if (!uygun.length) {
      return {
        ok: false,
        neden: targetDeviceId
          ? `Luca ajanı bağlı değil: ${targetDeviceId} son 3 dakikadır ping atmadı — DUR, sahibe bildir.`
          : 'Luca ajanı bağlı değil (son 3 dakikada çevrimiçi yerel Luca işçisi yok) — iş açılmadı, DUR, sahibe bildir.',
        cevrimiciCihazlar: cihazlar.map((c) => c.deviceId),
      };
    }

    const svc = await this.kdvKontrolServisi();
    if (!svc?.queueLucaImport) return { ok: false, error: 'KDV Kontrol servisi kullanılamıyor.' };
    const userId = await this.oturumKullaniciId(ctx);
    if (!userId) return { ok: false, error: 'İşi açacak kullanıcı bulunamadı.' };

    // mevcutIs: createFetchJob aynı oturum+dönem+tip için pending/running iş varsa yenisini açmaz, onu döner.
    const oncekiAcik: any = await (this.prisma as any).lucaFetchJob
      .findFirst({ where: { tenantId: ctx.tenantId, sessionId, status: { in: ['pending', 'running'] } }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true } })
      .catch(() => null);
    try {
      const r = await svc.queueLucaImport(sessionId, ctx.tenantId, userId, targetDeviceId);
      const mevcutIs = !!oncekiAcik && oncekiAcik.id === r?.jobId;
      return {
        ok: true,
        jobId: r?.jobId ?? null,
        status: mevcutIs ? oncekiAcik.status : r?.status ?? 'queued',
        mevcutIs,
        hedefCihaz: targetDeviceId || uygun[0]?.deviceId || null,
        mesaj: mevcutIs ? 'Aynı Luca çekimi zaten kuyruktaydı; yeni kopya açılmadı.' : r?.message || 'Luca işi kuyruğa alındı.',
        sonraki: 'luca_is_bekle {jobId} ile bekle (≤60 sn/çağrı, toplam 10 dk).',
      };
    } catch (e: any) {
      const h = this.hataBilgisi(e);
      if (h.status === 400 && /kilitli/i.test(h.mesaj)) return { ok: false, neden: `Oturum kilitli: ${h.mesaj} — kilit açma sahipte; adım 2'ye dön.` };
      return { ok: false, neden: h.mesaj };
    }
  }

  /** Luca işini sunucuda bekle (5 sn döngü, ≤60 sn). */
  private async lucaIsBekle(input: any, ctx: { tenantId: string; signal?: AbortSignal }) {
    const jobId = String(input?.jobId || '').trim();
    if (!jobId) return { ok: false, error: 'jobId gerekli.' };
    const maxSaniye = this.bekleSaniye(input?.maxSaniye);
    const bitisDurumlari = new Set(['done', 'failed', 'cancelled']);
    const baslangic = Date.now();
    let job: any = null;
    let tur = 0;
    for (;;) {
      job = await (this.prisma as any).lucaFetchJob.findFirst({ where: { id: jobId, tenantId: ctx.tenantId } }).catch(() => null);
      if (!job) return { ok: false, error: 'Luca işi bulunamadı (jobId/tenant uyuşmuyor).' };
      tur++;
      if (bitisDurumlari.has(String(job.status))) break;
      if (ctx.signal?.aborted) break;
      if (Date.now() - baslangic + 5000 > maxSaniye * 1000) break;
      await this.bekle(5000, ctx.signal);
    }
    let captcha: { challengeId: string | null } = { challengeId: null };
    if (!bitisDurumlari.has(String(job.status))) {
      try {
        const luca = await this.lucaServisi();
        const ch = luca?.getActiveCaptchaChallenge ? await luca.getActiveCaptchaChallenge(ctx.tenantId) : null;
        captcha = { challengeId: ch?.id || null };
      } catch {
        captcha = { challengeId: null };
      }
    }
    const errorMsgSonSatir = job.errorMsg ? String(job.errorMsg).trim().split(/\r?\n/).filter(Boolean).pop() || null : null;
    const bitti = bitisDurumlari.has(String(job.status));
    const retryCount = Number(job.retryCount || 0);
    const tarih = (d: any) => (d instanceof Date ? d.toISOString() : d ? String(d) : null);
    let yorum: string;
    if (job.status === 'done') yorum = Number(job.recordCount || 0) > 0 ? `Luca çekimi bitti: ${job.recordCount} satır.` : "Luca çekimi bitti ama 0 satır: Luca'da o ay kayıt yok — sahibe bildir.";
    else if (job.status === 'failed') yorum = `Luca işi başarısız: ${errorMsgSonSatir || 'sebep yok'} — tekrar deneme YOK, rapora yaz.`;
    else if (job.status === 'cancelled') yorum = 'Luca işi iptal edilmiş.';
    else if (captcha.challengeId) yorum = 'Luca güvenlik kodu bekliyor — sahip portaldaki Luca Oturum Yöneticisi\'nden girmeli.';
    else if (job.status === 'pending' && retryCount > 0) yorum = `Luca teknik kilit, otomatik tekrar deneniyor (${retryCount}. tekrar${job.nextRetryAt ? ', sıradaki ' + tarih(job.nextRetryAt) : ''}).`;
    else if (ctx.signal?.aborted) yorum = 'Koşu iptal sinyali aldı; bekleme kesildi.';
    else yorum = `Luca işi sürüyor (${job.status}); tekrar luca_is_bekle çağır (toplam 10 dk tavanı).`;
    return {
      ok: true,
      jobId,
      status: job.status,
      tip: job.tip ?? null,
      donem: job.donem ?? null,
      recordCount: Number(job.recordCount || 0),
      errorMsgSonSatir,
      retryCount,
      nextRetryAt: tarih(job.nextRetryAt),
      captcha,
      startedAt: tarih(job.startedAt),
      finishedAt: tarih(job.finishedAt),
      bitti,
      beklenenSaniye: Math.round((Date.now() - baslangic) / 1000),
      kontrolSayisi: tur,
      yorum,
    };
  }

  /** R1 adım 4 — Mihsap faturalarını oturuma bağla. */
  private async kdvKontrolFaturaBagla(input: any, ctx: { tenantId: string }) {
    const sessionId = String(input?.sessionId || '').trim();
    if (!sessionId) return { ok: false, error: 'sessionId gerekli.' };
    const svc = await this.kdvKontrolServisi();
    if (!svc?.linkMihsapInvoices) return { ok: false, error: 'KDV Kontrol servisi kullanılamıyor.' };
    try {
      const r = await svc.linkMihsapInvoices(sessionId, ctx.tenantId);
      const linked = Number(r?.linked || 0);
      const alreadyLinked = Number(r?.alreadyLinked || 0);
      const toplam = Number(r?.total ?? linked + alreadyLinked);
      return { ok: true, sessionId, linked, alreadyLinked, toplam, mesaj: `${linked} yeni bağlandı, ${alreadyLinked} zaten bağlıydı (toplam ${toplam}).` };
    } catch (e: any) {
      const h = this.hataBilgisi(e);
      if (h.status === 400 && /Mihsap'tan çekilmiş faturası yok|Mihsap.tan .*fatura/i.test(h.mesaj)) {
        return { ok: false, neden: 'HAZIR DEĞİL: faturalar portala inmemiş (Mihsap çekimi Muzaffer Bey’de)', detay: h.mesaj };
      }
      if (h.status === 400 && /kilitli/i.test(h.mesaj)) return { ok: false, neden: `Oturum kilitli: ${h.mesaj} — kilit açma sahipte.` };
      return { ok: false, neden: h.mesaj };
    }
  }

  /** R1 adım 5 — OCR başlat (forceFresh YOK). */
  private async kdvKontrolOcrBaslat(input: any, ctx: { tenantId: string }) {
    const sessionId = String(input?.sessionId || '').trim();
    if (!sessionId) return { ok: false, error: 'sessionId gerekli.' };
    const svc = await this.kdvKontrolServisi();
    if (!svc?.startOcrForSession) return { ok: false, error: 'KDV Kontrol servisi kullanılamıyor.' };
    try {
      const r = await svc.startOcrForSession(sessionId, ctx.tenantId, {});
      return {
        ok: true,
        sessionId,
        queued: Number(r?.queued || 0),
        total: Number(r?.total ?? r?.queued ?? 0),
        cacheHits: Number(r?.cacheHits || 0),
        mesaj: r?.message || (Number(r?.queued || 0) > 0 ? `${r.queued} fatura OCR kuyruğuna alındı; arkada çalışır.` : 'Bekleyen görsel yok.'),
        sonraki: 'kdv_kontrol_ocr_bekle {sessionId} ile bitişi izle (Luca beklemesiyle paralel).',
      };
    } catch (e: any) {
      const h = this.hataBilgisi(e);
      if (h.status === 400 && /kilitli/i.test(h.mesaj)) return { ok: false, neden: `Oturum kilitli: ${h.mesaj} — kilit açma sahipte.` };
      return { ok: false, neden: h.mesaj };
    }
  }

  /** Oturum görsellerinin ocrStatus sayımı (getSessionStats pending/processing DÖNDÜRMÜYOR → getImages). */
  private ocrSayim(images: any[]) {
    const say = { pending: 0, processing: 0, success: 0, needsReview: 0, lowConfidence: 0, failed: 0, toplam: images.length };
    for (const i of images) {
      switch (String(i?.ocrStatus || '').toUpperCase()) {
        case 'PENDING': say.pending++; break;
        case 'PROCESSING': say.processing++; break;
        case 'SUCCESS': say.success++; break;
        case 'NEEDS_REVIEW': say.needsReview++; break;
        case 'LOW_CONFIDENCE': say.lowConfidence++; break;
        case 'FAILED': say.failed++; break;
        default: break;
      }
    }
    return say;
  }

  /** R1 adım 7 — OCR bitişini sunucuda bekle. */
  private async kdvKontrolOcrBekle(input: any, ctx: { tenantId: string; signal?: AbortSignal }) {
    const sessionId = String(input?.sessionId || '').trim();
    if (!sessionId) return { ok: false, error: 'sessionId gerekli.' };
    const svc = await this.kdvKontrolServisi();
    if (!svc?.getImages) return { ok: false, error: 'KDV Kontrol servisi kullanılamıyor.' };
    const maxSaniye = this.bekleSaniye(input?.maxSaniye);
    const baslangic = Date.now();
    let say = this.ocrSayim([]);
    let tur = 0;
    for (;;) {
      let images: any[];
      try {
        images = await svc.getImages(sessionId, ctx.tenantId);
      } catch (e: any) {
        return { ok: false, neden: this.hataBilgisi(e).mesaj };
      }
      say = this.ocrSayim(Array.isArray(images) ? images : []);
      tur++;
      if (say.pending + say.processing === 0) break;
      if (ctx.signal?.aborted) break;
      if (Date.now() - baslangic + 5000 > maxSaniye * 1000) break;
      await this.bekle(5000, ctx.signal);
    }
    const bitti = say.pending + say.processing === 0;
    const needsOcrConfirm = say.needsReview + say.lowConfidence + say.failed;
    return {
      ok: true,
      sessionId,
      ...say,
      needsOcrConfirm,
      bitti,
      beklenenSaniye: Math.round((Date.now() - baslangic) / 1000),
      kontrolSayisi: tur,
      yorum: bitti
        ? say.toplam === 0
          ? 'Oturumda görsel yok (fatura bağlanmamış).'
          : `OCR bitti: ${say.success} ok · ${needsOcrConfirm} teyit bekler (incele ${say.needsReview}, düşük güven ${say.lowConfidence}, hata ${say.failed}). Teyit sahipte; eşleştirmeye geçilebilir.`
        : `OCR sürüyor: ${say.pending} bekliyor, ${say.processing} işleniyor — tekrar kdv_kontrol_ocr_bekle çağır (toplam 15 dk tavanı).`,
    };
  }

  /** R1 adım 8 — ön koşul kapısı + eşleştirme. */
  private async kdvKontrolEslestir(input: any, ctx: { tenantId: string }) {
    const sessionId = String(input?.sessionId || '').trim();
    if (!sessionId) return { ok: false, error: 'sessionId gerekli.' };
    const svc = await this.kdvKontrolServisi();
    if (!svc?.runReconciliation || !svc?.findSession || !svc?.getImages) return { ok: false, error: 'KDV Kontrol servisi kullanılamıyor.' };

    // ÖN KOŞUL KAPISI (backend yapmıyor; yalnız kilitli kdv-kontrol/page.tsx'te vardı): Luca kaydı>0, görsel>0, OCR bitmiş.
    let session: any;
    try {
      session = await svc.findSession(sessionId, ctx.tenantId);
    } catch (e: any) {
      return { ok: false, neden: this.hataBilgisi(e).mesaj };
    }
    if (session?.status === 'COMPLETED') return { ok: false, neden: 'Oturum kilitli (COMPLETED) — eşleştirme çağrılmadı; kilit açma sahipte, adım 2\'ye dön.' };
    const images: any[] = await svc.getImages(sessionId, ctx.tenantId).catch(() => []);
    const say = this.ocrSayim(Array.isArray(images) ? images : []);
    const kdvRecord = Number(session?._count?.kdvRecords ?? NaN);
    const lucaKayit = Number.isFinite(kdvRecord) ? kdvRecord : await this.prisma.kdvRecord.count({ where: { sessionId } }).catch(() => 0);
    const eksik: string[] = [];
    if (lucaKayit <= 0) eksik.push('Luca kaydı yok (kdv_kontrol_luca_cek + luca_is_bekle)');
    if (say.toplam <= 0) eksik.push('fatura görseli yok (kdv_kontrol_fatura_bagla)');
    if (say.pending + say.processing > 0) eksik.push(`OCR bitmedi (${say.pending} bekliyor, ${say.processing} işleniyor — kdv_kontrol_ocr_bekle)`);
    if (eksik.length) {
      return { ok: false, neden: `Ön koşul sağlanmadı, eşleştirme çağrılmadı: ${eksik.join('; ')}`, kdvRecord: lucaKayit, receiptImage: say.toplam, ocr: say };
    }

    try {
      const r = await svc.runReconciliation(sessionId, ctx.tenantId);
      const sonra: any = await this.prisma.kdvControlSession.findFirst({ where: { id: sessionId, tenantId: ctx.tenantId }, select: { status: true } }).catch(() => null);
      const sessionStatus = sonra?.status || null;
      const otoKilit = sessionStatus === 'COMPLETED';
      let mismatch = 0;
      try {
        const stats = svc.getSessionStats ? await svc.getSessionStats(sessionId, ctx.tenantId) : null;
        mismatch = Number(stats?.mismatch || 0) + Number(stats?.rejected || 0);
      } catch {
        mismatch = 0;
      }
      return {
        ok: true,
        sessionId,
        matched: Number(r?.matched || 0),
        partial: Number(r?.partial || 0),
        needsReview: Number(r?.needsReview || 0),
        unmatched: Number(r?.unmatched || 0),
        mismatch,
        sessionStatus,
        otoKilit,
        aciklama: otoKilit
          ? 'Sorunsuz eşleşti; oturum portaldaki gibi kendiliğinden KİLİTLENDİ (COMPLETED). Muzaffer Bey’in kararı (2026-09-13): ajanın işi kendi işi gibidir — karşı taraf da kilitliyse fiş Word raporu oluşur (yazıcıya otomatik gitmez), aylık takip işaretlenir, Luca KDV çekimi başlar; bunları raporda bildir, kilit için ayrıca sorma.'
          : 'Eşleştirme bitti; oturum REVIEWING, kilit sahipte. Satırları kdv_kontrol_sonuc_satirlari ile oku.',
      };
    } catch (e: any) {
      const h = this.hataBilgisi(e);
      if (h.status === 400 && /kilitli/i.test(h.mesaj)) return { ok: false, neden: `Oturum kilitli: ${h.mesaj} — adım 2'ye dön.` };
      return { ok: false, neden: `eşleştirme hatası: ${h.mesaj} — DUR, rapora yaz.` };
    }
  }

  /** "1.234,56" | "1234.56" | 1234.56 → sayı; boş/okunamaz → 0. */
  private kdvTutarSayi(v: any): number {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v?.toNumber === 'function') return v.toNumber();
    let s = String(v).trim().replace(/[^\d,.\-]/g, '');
    if (!s) return 0;
    if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (s.includes(',')) s = s.replace(',', '.');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * R1 adım 9 — tek sonuç satırının sınıfı:
   *  MATCHED/CONFIRMED = tam (KDV farkı > %1 → incele); PARTIAL_MATCH/NEEDS_REVIEW = incele;
   *  UNMATCHED + imageId null = fatura_yok (Luca'da var); UNMATCHED + kdvRecordId null = luca_yok (fatura var);
   *  MISMATCH/REJECTED = red. Tutar farkı: çok oranlı faturada (aynı görsel birden çok Luca satırı) kırılımın
   *  oranı eşleşen bileşeni, yoksa görsel toplamı Luca satırıyla karşılaştırılır; tolerans motorla aynı (max(1 kr, %1)).
   */
  private sonucSatiriSinifla(r: any, fanOut: number): { sinif: 'tam' | 'incele' | 'fatura_yok' | 'luca_yok' | 'red'; sebep: string } {
    const st = String(r?.status || '').toUpperCase();
    const sebepler: string[] = Array.isArray(r?.mismatchReasons) ? r.mismatchReasons.filter(Boolean).map(String) : [];
    if (st === 'MISMATCH' || st === 'REJECTED') return { sinif: 'red', sebep: st === 'REJECTED' ? `sahip reddetti${sebepler.length ? ': ' + sebepler.join('; ') : ''}` : sebepler.join('; ') || 'uyumsuz' };
    if (st === 'PARTIAL_MATCH' || st === 'NEEDS_REVIEW') return { sinif: 'incele', sebep: sebepler.join('; ') || (st === 'PARTIAL_MATCH' ? 'kısmi eşleşme' : 'inceleme gerekli') };
    if (st === 'UNMATCHED') {
      if (r?.kdvRecordId && !r?.imageId) return { sinif: 'fatura_yok', sebep: "Luca'da var, fatura görseli yok" };
      if (r?.imageId && !r?.kdvRecordId) return { sinif: 'luca_yok', sebep: "fatura var, Luca'da kayıt yok" };
      return { sinif: 'incele', sebep: sebepler.join('; ') || 'eşleşme bulunamadı' };
    }
    if (st === 'MATCHED' || st === 'CONFIRMED') {
      const luca = this.kdvTutarSayi(r?.kdvRecord?.kdvTutari);
      if (luca > 0 && r?.image && fanOut <= 1) {
        let fatura = this.kdvTutarSayi(r.image.confirmedKdvTutari || r.image.ocrKdvTutari);
        const kirilim = r.image.confirmedKdvBreakdown ?? r.image.ocrKdvBreakdown;
        const oran = this.kdvTutarSayi(r?.kdvRecord?.kdvOrani);
        if (Array.isArray(kirilim) && oran > 0) {
          const bilesen = kirilim.find((k: any) => Math.abs(this.kdvTutarSayi(k?.oran) - oran) < 0.5);
          const bt = bilesen ? this.kdvTutarSayi(bilesen.tutar) : 0;
          if (bt > 0 && Math.abs(bt - luca) / luca < 0.01) fatura = bt;
        }
        if (fatura > 0) {
          const fark = Math.abs(Number((luca - fatura).toFixed(2)));
          if (fark > Math.max(0.01, luca * 0.01)) {
            return { sinif: 'incele', sebep: `KDV tutar farkı: Luca ${luca.toFixed(2)} / fatura ${fatura.toFixed(2)} (fark ${fark.toFixed(2)})` };
          }
        }
      }
      return { sinif: 'tam', sebep: st === 'CONFIRMED' ? 'sahip teyit etti' : 'tam eşleşme' };
    }
    return { sinif: 'incele', sebep: `bilinmeyen durum ${st}` };
  }

  /** R1 adım 9 — sonuç satırları + sayaçlar (matchSummary ile tutarlı). Karar verilmez (resolve yok). */
  private async kdvKontrolSonucSatirlari(input: any, ctx: { tenantId: string }) {
    const sessionId = String(input?.sessionId || '').trim();
    if (!sessionId) return { ok: false, error: 'sessionId gerekli.' };
    const yalnizSorunlu = input?.yalnizSorunlu !== false;
    const limit = Math.min(Math.max(Number(input?.limit) || 100, 1), 100);
    const svc = await this.kdvKontrolServisi();
    if (!svc?.getResults) return { ok: false, error: 'KDV Kontrol servisi kullanılamıyor.' };
    let results: any[];
    try {
      results = await svc.getResults(sessionId, ctx.tenantId);
    } catch (e: any) {
      return { ok: false, neden: this.hataBilgisi(e).mesaj };
    }
    results = Array.isArray(results) ? results : [];
    let stats: any = null;
    try {
      stats = svc.getSessionStats ? await svc.getSessionStats(sessionId, ctx.tenantId) : null;
    } catch (e: any) {
      this.logger.warn(`kdv_kontrol_sonuc_satirlari getSessionStats: ${e?.message || e}`);
    }
    if (results.length === 0) {
      return {
        ok: true,
        sessionId,
        sonucYok: true,
        not: 'results boş — eşleştirme (kdv_kontrol_eslestir) çalışmamış; bir kez tekrar dene.',
        sayaclar: { tam: 0, incele: 0, faturaYok: 0, lucaYok: 0, red: 0, toplam: 0 },
        satirlar: [],
      };
    }
    const fanOutMap = new Map<string, number>();
    for (const r of results) if (r?.imageId && r?.kdvRecordId) fanOutMap.set(r.imageId, (fanOutMap.get(r.imageId) || 0) + 1);
    const tarih = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
    const sinifli = results.map((r: any) => {
      const { sinif, sebep } = this.sonucSatiriSinifla(r, r?.imageId ? fanOutMap.get(r.imageId) || 0 : 0);
      const img = r?.image || null;
      const rec = r?.kdvRecord || null;
      return {
        resultId: r.id,
        sinif,
        sebep,
        status: r.status,
        belgeNo: rec?.belgeNo || img?.confirmedBelgeNo || img?.ocrBelgeNo || null,
        tarih: rec?.belgeDate ? tarih(rec.belgeDate) : img?.confirmedDate || img?.ocrDate || null,
        karsiTaraf: rec?.karsiTaraf || img?.ocrSatici || null,
        kdv: rec ? this.kdvTutarSayi(rec.kdvTutari) : img ? this.kdvTutarSayi(img.confirmedKdvTutari || img.ocrKdvTutari) : null,
        tutar: rec?.kdvMatrahi != null ? this.kdvTutarSayi(rec.kdvMatrahi) : null,
        lucaKdv: rec ? this.kdvTutarSayi(rec.kdvTutari) : null,
        faturaKdv: img ? this.kdvTutarSayi(img.confirmedKdvTutari || img.ocrKdvTutari) : null,
        ocrStatus: img?.ocrStatus || null,
        kdvRecordId: r.kdvRecordId || null,
        imageId: r.imageId || null,
      };
    });
    const yerelSayac = { tam: 0, incele: 0, faturaYok: 0, lucaYok: 0, red: 0, toplam: sinifli.length };
    for (const s of sinifli) {
      if (s.sinif === 'tam') yerelSayac.tam++;
      else if (s.sinif === 'incele') yerelSayac.incele++;
      else if (s.sinif === 'fatura_yok') yerelSayac.faturaYok++;
      else if (s.sinif === 'luca_yok') yerelSayac.lucaYok++;
      else yerelSayac.red++;
    }
    const ms = stats?.matchSummary || null;
    // Sayaçlar portal ekranıyla birebir olsun diye matchSummary'den; yoksa yerel sayım.
    const sayaclar = ms
      ? {
          tam: Number(ms.matched || 0),
          incele: Number(ms.reviewTotal || 0),
          faturaYok: Number(ms.lucaOnlyMissing || 0),
          lucaYok: Number(ms.imageOnlyMissing || 0),
          red: Number(ms.rejected || 0) + Number(ms.mismatch || 0),
          digerEslesmeyen: Number(ms.otherUnmatched || 0),
          toplam: Number(ms.totalResults || sinifli.length),
          kaynak: 'matchSummary',
        }
      : { ...yerelSayac, kaynak: 'yerel' };
    const sorunlu = sinifli.filter((s) => s.sinif !== 'tam');
    const satirlar = (yalnizSorunlu ? sorunlu : sinifli).slice(0, limit);
    return {
      ok: true,
      sessionId,
      sayaclar,
      hataliToplam: Number(sayaclar.faturaYok) + Number(sayaclar.lucaYok) + Number(sayaclar.red),
      sorunluToplam: sorunlu.length,
      needsOcrConfirm: Number(stats?.needsOcrConfirm || 0),
      seriUyarilari: Array.isArray(stats?.seriUyarilari) ? stats.seriUyarilari.slice(0, 10) : [],
      satirlar,
      kesildi: (yalnizSorunlu ? sorunlu.length : sinifli.length) > limit,
      not: 'Karar VERME (resolve/kilit sahipte). Sınıf: tam · incele · fatura_yok (Luca\'da var) · luca_yok (fatura var) · red.',
    };
  }

  /** Koordinatör: başka ajanı ARKA PLANDA başlat (iç içe koşu yok). */
  private async ekipAjanBaslat(input: any, ctx: { tenantId: string; userId?: string | null; taxpayerId?: string | null }) {
    const ajanId = String(input?.ajanId || '').trim();
    const gorev = String(input?.gorev || '').trim();
    const taxpayerId = String(input?.taxpayerId || ctx.taxpayerId || '').trim() || null;
    if (!ajanId) return { ok: false, error: 'ajanId gerekli.' };
    if (!gorev) return { ok: false, error: 'gorev boş olamaz.' };
    if (ajanId === 'koordinator') return { ok: false, error: 'Koordinatör kendini başlatamaz.' };
    let dryRun = input?.dryRun !== false;
    let not: string | undefined;
    if (!dryRun && !ctx.userId) {
      dryRun = true;
      not = 'Canlı koşu yalnız oturumdaki kullanıcıyla açılır (ctx.userId boş) — kuru teste düşürüldü.';
    }

    let runner: any = null;
    try {
      const { EkipRunnerService } = await import('../ekip/ekip-runner.service');
      runner = this.moduleRef?.get?.(EkipRunnerService, { strict: false });
    } catch (e: any) {
      this.logger.warn(`EkipRunnerService çözülemedi: ${e?.message || e}`);
    }
    if (!runner?.calistir) return { ok: false, error: 'Ekip runner servisi kullanılamıyor.' };

    // TEKRAR KİLİDİ: aynı ajan + mükellef için pending/running iş varsa yenisi açılmaz (AgentCommand agent='ekip:<ajan>').
    const acik: any[] = await (this.prisma as any).agentCommand
      .findMany({
        where: { tenantId: ctx.tenantId, agent: `ekip:${ajanId}`, status: { in: ['pending', 'running'] } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, status: true, payload: true, createdAt: true },
      })
      .catch(() => []);
    const mevcut = acik.find((r) => String(r?.payload?.taxpayerId || '') === String(taxpayerId || ''));
    if (mevcut) {
      return { ok: false, mevcutIsId: mevcut.id, status: mevcut.status, neden: `${ajanId} için${taxpayerId ? ' bu mükellefte' : ''} çalışan koşu var (${mevcut.id}); yenisi açılmadı — ekip_is_durum ile izle.` };
    }

    let isId: string | null = null;
    let baslangicCoz: (() => void) | null = null;
    const baslangicSozu = new Promise<void>((resolve) => {
      baslangicCoz = resolve;
    });
    const kosu = runner.calistir({
      ajanId,
      gorev,
      tenantId: ctx.tenantId,
      userId: ctx.userId ?? null,
      taxpayerId,
      dryRun,
      kaynak: 'koordinator',
      emit: (e: any) => {
        if (e?.type === 'baslangic' && e.isId) {
          isId = e.isId;
          baslangicCoz?.();
        }
        if (e?.type === 'error') baslangicCoz?.();
      },
    });
    // await ETME: koşu arka planda sürer; hata yalnız loglanır (Koordinatör'ün turu beklemez).
    Promise.resolve(kosu)
      .then((s: any) => {
        if (s?.hata) this.logger.warn(`ekip_ajan_baslat ${ajanId} (${s?.isId || '-'}) hata: ${s.hata}`);
        else this.logger.log(`ekip_ajan_baslat ${ajanId} bitti (${s?.isId || '-'}, ${s?.durationMs ?? '?'} ms)`);
      })
      .catch((e: any) => this.logger.warn(`ekip_ajan_baslat ${ajanId} koşu hatası: ${e?.message || e}`));
    await Promise.race([baslangicSozu, this.bekle(500)]);
    return {
      ok: true,
      baslatildi: true,
      isId,
      ajanId,
      taxpayerId,
      dryRun,
      ...(not ? { not } : {}),
      mesaj: isId
        ? `${ajanId} ajanına atandı, ${dryRun ? 'kuru testte' : 'CANLI'} başladı (iş ${isId}). ekip_is_durum {isId} ile izle.`
        : `${ajanId} ajanına atandı, arka planda başlatıldı; iş kimliği henüz gelmedi — ekip_isler ile bul.`,
    };
  }

  /** ekip_ajan_baslat ile açılan işin durumu. */
  private async ekipIsDurum(input: any, ctx: { tenantId: string }) {
    const isId = String(input?.isId || '').trim();
    if (!isId) return { ok: false, error: 'isId gerekli.' };
    let runner: any = null;
    try {
      const { EkipRunnerService } = await import('../ekip/ekip-runner.service');
      runner = this.moduleRef?.get?.(EkipRunnerService, { strict: false });
    } catch (e: any) {
      this.logger.warn(`EkipRunnerService çözülemedi: ${e?.message || e}`);
    }
    if (!runner?.isGetir) return { ok: false, error: 'Ekip runner servisi kullanılamıyor.' };
    const is = await runner.isGetir(ctx.tenantId, isId);
    if (!is) return { ok: false, error: 'İş bulunamadı.' };
    const rapor = typeof is?.result?.rapor === 'string' ? is.result.rapor : null;
    const bitti = is.status === 'done' || is.status === 'failed';
    return {
      ok: true,
      isId,
      ajanId: is.ajanId,
      status: is.status,
      dryRun: is.dryRun,
      taxpayerId: is.taxpayerId ?? null,
      bitti,
      rapor: rapor ? rapor.slice(0, 1500) : null,
      raporKesildi: !!rapor && rapor.length > 1500,
      hata: is.hata || null,
      durationMs: is.durationMs ?? null,
      kuruTestSayisi: is.kuruTestSayisi ?? 0,
      onayBekleyenSayisi: is.onayBekleyenSayisi ?? 0,
      startedAt: is.startedAt ?? null,
      finishedAt: is.finishedAt ?? null,
    };
  }
}
