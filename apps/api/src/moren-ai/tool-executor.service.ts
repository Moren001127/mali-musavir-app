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
    ctx: { tenantId: string },
  ): Promise<any> {
    try {
      switch (name) {
        case 'list_taxpayers':      return this.listTaxpayers(input, ctx);
        case 'get_taxpayer':        return this.getTaxpayer(input, ctx);
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
    const [d1, d2] = await Promise.all([
      this.fetchPeriodData(kaynak, input.taxpayerId, input.donem1, ctx),
      this.fetchPeriodData(kaynak, input.taxpayerId, input.donem2, ctx),
    ]);

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
    const [b, gt] = await Promise.all([
      this.getBilanco(input, ctx),
      this.getGelirTablosu(input, ctx),
    ]);

    if (b?.error && gt?.error) {
      return { error: 'Bu dönem için ne bilanço ne gelir tablosu bulundu' };
    }

    const ratios: any = {};
    const notes: string[] = [];

    if (!b?.error) {
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

    if (!gt?.error) {
      const k = gt.kalemler;
      if (k.netSatislar > 0) {
        ratios.brutKarMarji = { deger: k.brutSatisKari / k.netSatislar, formul: 'Brüt Satış Kârı / Net Satışlar' };
        ratios.faaliyetKarMarji = { deger: k.faaliyetKari / k.netSatislar, formul: 'Faaliyet Kârı / Net Satışlar' };
        ratios.netKarMarji = { deger: k.donemNetKari / k.netSatislar, formul: 'Dönem Net Kârı / Net Satışlar' };
      }
      if (!b?.error && b.pasif.ozkaynaklar > 0) {
        ratios.roe = { deger: k.donemNetKari / b.pasif.ozkaynaklar, formul: 'Dönem Net Kârı / Özkaynak (ROE)' };
      }
      if (!b?.error && b.aktif.aktifToplami > 0) {
        ratios.roa = { deger: k.donemNetKari / b.aktif.aktifToplami, formul: 'Dönem Net Kârı / Aktif Toplamı (ROA)' };
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
}
