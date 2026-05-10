import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
    ctx: { tenantId: string; userId?: string | null },
  ): Promise<any> {
    try {
      switch (name) {
        case 'list_taxpayers':      return this.listTaxpayers(input, ctx);
        case 'get_taxpayer':        return this.getTaxpayer(input, ctx);
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
        case 'get_operation_briefing': return this.getOperationBriefing(input, ctx);
        case 'get_taxpayer_work_status': return this.getTaxpayerWorkStatus(input, ctx);
        case 'get_luca_agent_jobs':   return this.getLucaAgentJobs(input, ctx);
        case 'get_mihsap_agent_jobs': return this.getMihsapAgentJobs(input, ctx);
        case 'preview_agent_command': return this.previewAgentCommand(input, ctx);
        case 'create_confirmed_agent_command': return this.createAgentCommand(input, ctx);
        case 'get_collection_risk_summary': return this.getCollectionRiskSummary(input, ctx);
        case 'get_beyanname_readiness_summary': return this.getBeyannameReadinessSummary(input, ctx);
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
      where.OR = [
        { companyName: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { taxNumber: { contains: search } },
      ];
    }

    const rows = await this.prisma.taxpayer.findMany({
      where,
      take: limit,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, type: true, companyName: true, firstName: true, lastName: true,
        taxNumber: true, taxOffice: true, startDate: true, endDate: true, isActive: true,
      },
    });

    return {
      count: rows.length,
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

    const donem = `${year}-${String(month).padStart(2, '0')}`;
    return {
      donem,
      toplamMukellef: taxpayers.length,
      sonuc: rows.length,
      evrakFiltresi: evrakFilter,
      beyannameFiltresi: beyannameFilter,
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
    const mizan = await this.prisma.mizan.findFirst({
      where: { tenantId: ctx.tenantId, taxpayerId: input.taxpayerId, donem: input.donem },
      include: {
        hesaplar: { orderBy: { hesapKodu: 'asc' } },
        anomaliler: true,
      },
    });
    if (!mizan) return { error: `${input.donem} dönemine ait mizan bulunamadı` };

    let hesaplar = mizan.hesaplar;
    if (input?.hesapKoduFiltresi) {
      hesaplar = hesaplar.filter((h) => h.hesapKodu.startsWith(input.hesapKoduFiltresi));
    }

    const toplamBorc = hesaplar.reduce((s, h) => s + this.toNum(h.borcToplami), 0);
    const toplamAlacak = hesaplar.reduce((s, h) => s + this.toNum(h.alacakToplami), 0);

    return {
      donem: mizan.donem,
      donemTipi: mizan.donemTipi,
      kaynak: mizan.kaynak,
      status: mizan.status,
      kilitli: mizan.locked,
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
    const gt = await this.prisma.gelirTablosu.findFirst({
      where: { tenantId: ctx.tenantId, taxpayerId: input.taxpayerId, donem: input.donem },
      orderBy: { createdAt: 'desc' },
    });
    if (!gt) return { error: `${input.donem} dönemine ait gelir tablosu bulunamadı` };

    return {
      donem: gt.donem,
      donemTipi: gt.donemTipi,
      donemBaslangic: gt.donemBaslangic?.toISOString().slice(0, 10),
      donemBitis: gt.donemBitis?.toISOString().slice(0, 10),
      kilitli: gt.locked,
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
    const b = await this.prisma.bilanco.findFirst({
      where: { tenantId: ctx.tenantId, taxpayerId: input.taxpayerId, donem: input.donem },
      orderBy: { createdAt: 'desc' },
    });
    if (!b) return { error: `${input.donem} dönemine ait bilanço bulunamadı` };

    return {
      donem: b.donem,
      donemTipi: b.donemTipi,
      tarih: b.tarih?.toISOString().slice(0, 10),
      kilitli: b.locked,
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

    return {
      aktifSeanslar: liveSummary,
      arsivlenenlerden: outputSummary,
    };
  }

  // ------------------------------------------------------------
  // FATURALAR
  // ------------------------------------------------------------
  private async listInvoices(input: any, ctx: { tenantId: string }) {
    // Taxpayer'ın bu tenant'ta olduğunu doğrula
    const t = await this.prisma.taxpayer.findFirst({
      where: { id: input.taxpayerId, tenantId: ctx.tenantId },
      select: { id: true },
    });
    if (!t) return { error: 'Mükellef bulunamadı' };

    const where: any = { taxpayerId: input.taxpayerId };
    if (input.type) where.type = input.type;
    if (input.status) where.status = input.status;
    if (input.startDate || input.endDate) {
      where.issueDate = {};
      if (input.startDate) where.issueDate.gte = new Date(input.startDate);
      if (input.endDate) where.issueDate.lte = new Date(input.endDate);
    }
    if (input.minAmount !== undefined) where.totalAmount = { gte: input.minAmount };
    if (input.maxAmount !== undefined) {
      where.totalAmount = { ...(where.totalAmount || {}), lte: input.maxAmount };
    }

    const limit = Math.min(input.limit || 20, 100);
    const rows = await this.prisma.invoice.findMany({
      where,
      take: limit,
      orderBy: { issueDate: 'desc' },
    });

    const toplamTutar = rows.reduce((s, r) => s + this.toNum(r.totalAmount), 0);
    const toplamKdv = rows.reduce((s, r) => s + this.toNum(r.vatAmount), 0);

    return {
      count: rows.length,
      toplamTutar,
      toplamKdv,
      invoices: rows.map((r) => ({
        id: r.id,
        faturaNo: r.invoiceNo,
        tip: r.type,
        durum: r.status,
        tarih: r.issueDate.toISOString().slice(0, 10),
        vadeTarihi: r.dueDate?.toISOString().slice(0, 10),
        matrah: this.toNum(r.subtotal),
        kdv: this.toNum(r.vatAmount),
        genelToplam: this.toNum(r.totalAmount),
        parabirimi: r.currency,
      })),
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
    const { taxpayerId, beyanTipi, donem, search, limit } = input || {};
    const where: any = { tenantId: ctx.tenantId };
    if (taxpayerId) where.taxpayerId = taxpayerId;
    if (beyanTipi) where.beyanTipi = beyanTipi;
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
      kayitlar: kayitlar.map((k: any) => ({
        id: k.id,
        mukellef: k.taxpayer?.companyName || `${k.taxpayer?.firstName || ''} ${k.taxpayer?.lastName || ''}`.trim() || '—',
        vkn: k.taxpayer?.taxNumber,
        beyanTipi: k.beyanTipi,
        donem: k.donem,
        onayNo: k.onayNo,
        tahakkukTutari: k.tahakkukTutari ? Number(k.tahakkukTutari) : null,
        pdfVar: !!k.pdfUrl,
        beyannameVar: !!k.beyannameUrl,
        kaynak: k.kaynak,
        kayitTarihi: k.createdAt,
      })),
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

  private async createAgentCommand(input: any, ctx: { tenantId: string; userId?: string | null }) {
    const confirmation = String(input?.confirmationText || '').trim().toLocaleUpperCase('tr-TR');
    if (confirmation !== 'ONAYLIYORUM') {
      return {
        error: 'Komut oluşturulmadı. Önce kullanıcıya yapılacak işlemi özetle ve net onay iste.',
        requiresConfirmation: true,
      };
    }
    const agent = String(input?.agent || '').trim();
    const action = String(input?.action || '').trim();
    const payload = input?.payload && typeof input.payload === 'object' ? input.payload : {};
    const allowedAgents = ['mihsap', 'luca', 'sgk', 'tebligat', 'kdv', 'beyan-hazirlik', 'luca-beyanname', 'kdv-beyan', 'tahsilat', 'banka-ekstre', 'edefter', 'whatsapp'];
    const allowedMihsapActions = ['isle_alis', 'isle_satis', 'isle_alis_isletme', 'isle_satis_isletme'];
    if (!allowedAgents.includes(agent)) return { error: `Desteklenmeyen agent: ${agent}` };
    if (agent === 'mihsap' && !allowedMihsapActions.includes(action)) {
      return { error: `Mihsap için desteklenmeyen action: ${action}` };
    }
    if (agent === 'mihsap') {
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
    return {
      ok: true,
      commandId: cmd.id,
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
      (this.prisma as any).agentEvent.findMany({ where: { tenantId: ctx.tenantId, mukellef: { contains: '', mode: 'insensitive' } }, orderBy: { ts: 'desc' }, take: 20 }).catch(() => []),
      (this.prisma as any).aiMemory?.findMany
        ? (this.prisma as any).aiMemory.findMany({ where: { tenantId: ctx.tenantId, taxpayerId, isActive: true }, orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }], take: 5 })
        : Promise.resolve([]),
    ]);
    if (!taxpayer) return { error: 'Mükellef bulunamadı' };
    const s: any = status || {};
    const cariBakiye = (cariRows || []).reduce((sum: number, h: any) => sum + (h.tip === 'TAHAKKUK' ? this.toNum(h.tutar) : h.tip === 'TAHSILAT' ? -this.toNum(h.tutar) : 0), 0);
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
        sonAgentOlaylari: agentEvents,
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

  private previewAgentCommand(input: any, ctx: { tenantId: string }) {
    const agent = String(input?.agent || '').trim();
    const action = String(input?.action || '').trim();
    const payload = input?.payload && typeof input.payload === 'object' ? input.payload : {};
    const requiresConfirmation = true;
    const supported: Record<string, string[]> = {
      mihsap: ['isle_alis', 'isle_satis', 'isle_alis_isletme', 'isle_satis_isletme'],
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
      whatsapp: ['owner_alert', 'portal_message_preview', 'portal_message_send'],
    };
    const errors: string[] = [];
    if (!supported[agent]) errors.push(`Desteklenmeyen agent: ${agent}`);
    else if (!supported[agent].includes(action)) errors.push(`${agent} için desteklenmeyen action: ${action}`);
    if (agent === 'mihsap' && (!payload.ay || !Array.isArray(payload.mukellefler) || payload.mukellefler.length === 0)) {
      errors.push('Mihsap komutu için payload.ay ve payload.mukellefler gerekir');
    }
    return {
      ok: errors.length === 0,
      errors,
      requiresConfirmation,
      confirmationText: 'ONAYLIYORUM',
      agent,
      action,
      payload,
      etki: this.describeAgentImpact(agent, action, payload),
      not: 'Bu önizleme komut oluşturmaz. Kullanıcı net onay verirse create_confirmed_agent_command çalıştırılır.',
    };
  }

  private describeAgentImpact(agent: string, action: string, payload: any) {
    if (agent === 'luca' && action === 'prepare_beyanname') return 'LUCA beyanname ekranında taslak hazırlık başlatılır; gönderim ayrıca onay gerektirir.';
    if (agent === 'luca' && action === 'fetch_mizan') return 'LUCA’dan mizan çekimi başlatılır ve portala işlenir.';
    if (agent === 'mihsap') return `${payload?.mukellefler?.length || 0} mükellef için Mihsap fatura işleme komutu hazırlanır.`;
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
    return {
      period,
      toplam: base.ozet.aktifMukellef,
      hazir: base.riskliMukellefler.filter((r: any) => r.durum === 'HAZIR').length,
      eksik: base.riskliMukellefler.filter((r: any) => r.durum === 'EKSIK').length,
      riskli: base.riskliMukellefler.filter((r: any) => r.durum === 'RISKLI').length,
      enSorunlu: base.riskliMukellefler.slice(0, limit),
      ozet: base.ozet,
    };
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
