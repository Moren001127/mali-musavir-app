import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaxpayerDto } from '@mali-musavir/shared';

@Injectable()
export class TaxpayersService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, search?: string, year?: number, month?: number) {
    // WHERE koşulları düzgün AND ile birleştiriliyor
    const andConditions: any[] = [{ tenantId }, { isActive: true }];

    // İşe başlama / işi bırakma tarihi filtreleri
    if (year && month) {
      const firstDay = new Date(year, month - 1, 1);   // Ayın 1'i
      const lastDay = new Date(year, month, 0, 23, 59, 59); // Ayın son günü
      andConditions.push({
        // İşe başlama: null VEYA seçili ayın son gününden önce başlayanlar
        OR: [
          { startDate: null },
          { startDate: { lte: lastDay } },
        ],
      });
      andConditions.push({
        // İşi bırakma: null VEYA seçili ayın ilk gününden sonra bırakanlar
        OR: [
          { endDate: null },
          { endDate: { gte: firstDay } },
        ],
      });
    }

    // Arama filtresi
    if (search) {
      andConditions.push({
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { companyName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    const taxpayersRaw = await this.prisma.taxpayer.findMany({
      where: { AND: andConditions },
      orderBy: [{ companyName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true,
        type: true,
        firstName: true,
        lastName: true,
        companyName: true,
        taxNumber: true,
        taxOffice: true,
        email: true,
        emails: true,
        phone: true,
        phones: true,
        evrakTeslimGunu: true,
        whatsappEvrakTalep: true,
        whatsappEvrakGeldi: true,
        isActive: true,
        isEFaturaMukellefi: true,
        startDate: true,
        endDate: true,
        createdAt: true,
        lucaSlug: true,
        mihsapId: true,
        mihsapDefterTuru: true,
        defterTuru: true,
        _count: { select: { taxDeclarations: true, documents: true } },
      },
    });

    // Türkçe locale-aware sıralama. PostgreSQL default collation İ/Ğ/Ş/Ç/Ü/Ö
    // karakterlerini yanlış sıralıyor — JS Intl.Collator ile düzeltiyoruz.
    // Görüntü adı: companyName öncelikli, yoksa "firstName lastName".
    const collator = new Intl.Collator('tr', { sensitivity: 'base', numeric: false });
    const displayName = (t: any): string =>
      (t.companyName ||
        `${t.firstName || ''} ${t.lastName || ''}`.trim() ||
        t.taxNumber ||
        '').trim();
    const taxpayers = [...taxpayersRaw].sort((a, b) =>
      collator.compare(displayName(a), displayName(b)),
    );

    if (!year || !month) return taxpayers.map(t => ({ ...t, monthlyStatus: null }));

    const taxpayerIds = taxpayers.map(t => t.id);
    const statuses = await this.prisma.taxpayerMonthlyStatus.findMany({
      where: { taxpayerId: { in: taxpayerIds }, year, month },
    });
    const statusMap = new Map(statuses.map(s => [s.taxpayerId, s]));

    return taxpayers.map(t => ({
      ...t,
      monthlyStatus: statusMap.get(t.id) ?? null,
    }));
  }

  async findOne(id: string, tenantId: string) {
    const taxpayer = await this.prisma.taxpayer.findFirst({
      where: { id, tenantId },
      include: {
        contacts: true,
        _count: {
          select: {
            taxDeclarations: true,
            invoices: true,
            documents: true,
            employees: true,
          },
        },
      },
    });
    if (!taxpayer) throw new NotFoundException('Mükellef bulunamadı');
    return taxpayer;
  }

  async create(tenantId: string, dto: any) {
    try {
      return await this.prisma.taxpayer.create({
        data: { tenantId, ...dto },
      });
    } catch (e: any) {
      if (e.code === 'P2002') {
        throw new BadRequestException('Bu VKN/TCKN ile kayıtlı mükellef zaten mevcut');
      }
      throw e;
    }
  }

  async update(id: string, tenantId: string, dto: Partial<CreateTaxpayerDto>) {
    const taxpayer = await this.prisma.taxpayer.findFirst({ where: { id, tenantId } });
    if (!taxpayer) throw new NotFoundException();
    return this.prisma.taxpayer.update({ where: { id }, data: dto as any });
  }

  async softDelete(id: string, tenantId: string) {
    const taxpayer = await this.prisma.taxpayer.findFirst({ where: { id, tenantId } });
    if (!taxpayer) throw new NotFoundException();
    return this.prisma.taxpayer.update({ where: { id }, data: { isActive: false } });
  }

  /**
   * v1.36.76: Mükellef profil tamamlığı.
   * Üç katman puanlama (toplam 100):
   *  - KRİTİK (50p): Ad/VKN/Vergi Dairesi/Defter Türü/En az 1 mükellefiyet türü
   *  - ÖNEMLİ (30p): Hukuki tip + telefon + email + adres + mali müşavirlik ücreti
   *  - YARARLI (20p): Faaliyet, WA, evrak günü, Luca slug, Mihsap ID, banka, e-posta tercih
   */
  async getCompleteness(id: string, tenantId: string) {
    const tp: any = await this.prisma.taxpayer.findFirst({
      where: { id, tenantId },
      include: {
        beyanConfig: true,
        bankaHesaplar: { where: { aktif: true }, select: { id: true } },
      },
    });
    if (!tp) throw new NotFoundException('Mükellef bulunamadı');

    // Mali müşavirlik ücreti — Cari Hizmet'te kayıt var mı (aktif)
    const cariHizmetCount = await (this.prisma as any).cariHizmet.count({
      where: { tenantId, taxpayerId: id, aktif: true },
    });

    type Field = { key: string; label: string; tier: 'KRITIK' | 'ONEMLI' | 'YARARLI'; value: any; ok: boolean };
    const fields: Field[] = [];

    // === KRİTİK ===
    const adVar = tp.companyName || (tp.firstName && tp.lastName);
    fields.push({ key: 'ad', label: 'Ad / Ünvan', tier: 'KRITIK', value: adVar, ok: !!adVar });
    fields.push({ key: 'taxNumber', label: 'VKN / TCKN', tier: 'KRITIK', value: tp.taxNumber, ok: !!tp.taxNumber });
    fields.push({ key: 'taxOffice', label: 'Vergi Dairesi', tier: 'KRITIK', value: tp.taxOffice, ok: !!tp.taxOffice });
    fields.push({ key: 'defterTuru', label: 'Defter Türü', tier: 'KRITIK', value: tp.defterTuru, ok: !!tp.defterTuru });

    // En az 1 mükellefiyet seçili mi (TaxpayerBeyanConfig)
    const cfg = tp.beyanConfig;
    const hasAnyMukellefiyet = !!cfg && (
      !!cfg.kdv1Period || !!cfg.kdv2Enabled || !!cfg.muhtasarPeriod ||
      !!cfg.damgaEnabled || !!cfg.posetEnabled || !!cfg.sgkBildirgeEnabled ||
      !!cfg.eDefterPeriod || !!cfg.incomeTaxType
    );
    fields.push({
      key: 'mukellefiyetler', label: 'Mükellefiyet Türleri (KDV/Muhtasar/vb.)',
      tier: 'KRITIK', value: hasAnyMukellefiyet, ok: hasAnyMukellefiyet,
    });

    // === ÖNEMLİ ===
    fields.push({ key: 'type', label: 'Hukuki Tip (Gerçek/Tüzel)', tier: 'ONEMLI', value: tp.type, ok: !!tp.type });
    fields.push({
      key: 'telefon', label: 'Telefon', tier: 'ONEMLI',
      value: tp.phone || (tp.phones || []).filter(Boolean).length > 0,
      ok: !!(tp.phone || (tp.phones || []).filter(Boolean).length > 0),
    });
    fields.push({
      key: 'email', label: 'E-posta', tier: 'ONEMLI',
      value: tp.email || (tp.emails || []).filter(Boolean).length > 0,
      ok: !!(tp.email || (tp.emails || []).filter(Boolean).length > 0),
    });
    fields.push({ key: 'adres', label: 'Adres', tier: 'ONEMLI', value: tp.address, ok: !!tp.address });
    fields.push({
      key: 'mmUcret', label: 'Mali Müşavirlik Ücreti (Cari Hizmet)',
      tier: 'ONEMLI', value: cariHizmetCount > 0, ok: cariHizmetCount > 0,
    });

    // === YARARLI ===
    fields.push({ key: 'evrakGunu', label: 'Evrak Teslim Günü', tier: 'YARARLI', value: tp.evrakTeslimGunu, ok: !!tp.evrakTeslimGunu });
    fields.push({ key: 'lucaSlug', label: 'Luca Slug', tier: 'YARARLI', value: tp.lucaSlug, ok: !!tp.lucaSlug });
    fields.push({ key: 'mihsapId', label: 'Mihsap ID', tier: 'YARARLI', value: tp.mihsapId, ok: !!tp.mihsapId });
    fields.push({
      key: 'banka', label: 'Banka Hesabı (en az 1)',
      tier: 'YARARLI', value: tp.bankaHesaplar?.length > 0, ok: (tp.bankaHesaplar?.length ?? 0) > 0,
    });
    fields.push({
      key: 'baslangic', label: 'İşe Başlama Tarihi',
      tier: 'YARARLI', value: tp.startDate, ok: !!tp.startDate,
    });

    // Puanlama
    const kritik = fields.filter((f) => f.tier === 'KRITIK');
    const onemli = fields.filter((f) => f.tier === 'ONEMLI');
    const yararli = fields.filter((f) => f.tier === 'YARARLI');

    const kritikScore = (kritik.filter((f) => f.ok).length / kritik.length) * 50;
    const onemliScore = (onemli.filter((f) => f.ok).length / onemli.length) * 30;
    const yararliScore = (yararli.filter((f) => f.ok).length / yararli.length) * 20;
    const totalScore = Math.round(kritikScore + onemliScore + yararliScore);

    let durum: 'TAM' | 'IYI' | 'EKSIK' | 'KRITIK_EKSIK';
    if (totalScore >= 95) durum = 'TAM';
    else if (totalScore >= 80) durum = 'IYI';
    else if (totalScore >= 60) durum = 'EKSIK';
    else durum = 'KRITIK_EKSIK';

    const eksikler = fields.filter((f) => !f.ok);
    const kritikEksikSayisi = eksikler.filter((f) => f.tier === 'KRITIK').length;

    return {
      taxpayerId: id,
      score: totalScore,
      durum,
      kritikEksikSayisi,
      eksikSayisi: eksikler.length,
      fields,
      eksikler,
      breakdown: {
        kritik: { dolu: kritik.filter((f) => f.ok).length, toplam: kritik.length, puan: Math.round(kritikScore) },
        onemli: { dolu: onemli.filter((f) => f.ok).length, toplam: onemli.length, puan: Math.round(onemliScore) },
        yararli: { dolu: yararli.filter((f) => f.ok).length, toplam: yararli.length, puan: Math.round(yararliScore) },
      },
    };
  }

  /**
   * v1.36.76: Tüm mükelleflerin tamamlık özeti (dashboard widget için).
   * Her mükellefin score'unu hesaplar — N+1 query'den kaçınmak için tek transaction.
   */
  async getCompletenessSummary(tenantId: string) {
    const taxpayers = await this.prisma.taxpayer.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, firstName: true, lastName: true, companyName: true },
    });
    const items = await Promise.all(
      taxpayers.map(async (t) => {
        try {
          const c = await this.getCompleteness(t.id, tenantId);
          return {
            id: t.id,
            ad: t.companyName || `${t.firstName ?? ''} ${t.lastName ?? ''}`.trim(),
            score: c.score,
            durum: c.durum,
            kritikEksikSayisi: c.kritikEksikSayisi,
            eksikSayisi: c.eksikSayisi,
          };
        } catch {
          return null;
        }
      }),
    );
    const valid = items.filter(Boolean) as any[];
    return {
      total: valid.length,
      tam: valid.filter((i) => i.durum === 'TAM').length,
      iyi: valid.filter((i) => i.durum === 'IYI').length,
      eksik: valid.filter((i) => i.durum === 'EKSIK').length,
      kritikEksik: valid.filter((i) => i.durum === 'KRITIK_EKSIK').length,
      averageScore: Math.round(valid.reduce((s, i) => s + i.score, 0) / (valid.length || 1)),
      taxpayers: valid.sort((a, b) => a.score - b.score), // en eksik üstte
    };
  }

  async getMonthlyStatus(taxpayerId: string, tenantId: string, year: number, month: number) {
    const taxpayer = await this.prisma.taxpayer.findFirst({ where: { id: taxpayerId, tenantId } });
    if (!taxpayer) throw new NotFoundException('Mükellef bulunamadı');

    return this.prisma.taxpayerMonthlyStatus.upsert({
      where: { taxpayerId_year_month: { taxpayerId, year, month } },
      create: { taxpayerId, tenantId, year, month },
      update: {},
    });
  }

  async updateMonthlyStatus(
    taxpayerId: string,
    tenantId: string,
    year: number,
    month: number,
    data: {
      evraklarGeldi?: boolean;
      evraklarIslendi?: boolean;
      kontrolEdildi?: boolean;
      beyannameVerildi?: boolean;
      kdvKontrolEdildi?: boolean;
      indirilecekKdvKontrol?: boolean;
      hesaplananKdvKontrol?: boolean;
      eArsivKontrol?: boolean;
    },
  ) {
    const taxpayer = await this.prisma.taxpayer.findFirst({ where: { id: taxpayerId, tenantId } });
    if (!taxpayer) throw new NotFoundException('Mükellef bulunamadı');

    return this.prisma.taxpayerMonthlyStatus.upsert({
      where: { taxpayerId_year_month: { taxpayerId, year, month } },
      create: { taxpayerId, tenantId, year, month, ...data },
      update: data,
    });
  }

  /**
   * Mükellef için son N ayın özet istatistikleri.
   * Karlılık / iş yükü takibi için kullanılır.
   *
   * Not: AiUsageLog'da taxpayerId alanı yok (sadece mukellef adı string).
   * Bu yüzden AI kullanım istatistikleri mükellef adıyla eşleştirilir.
   * CariHareket bakiyesi: TAHAKKUK + → TAHSILAT/IADE − ile net bakiye.
   */
  async getStats(taxpayerId: string, tenantId: string, months: number = 1) {
    const tp = await this.prisma.taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
    });
    if (!tp) throw new NotFoundException('Mükellef bulunamadı');

    const since = new Date();
    since.setMonth(since.getMonth() - months);
    since.setHours(0, 0, 0, 0);

    const p = this.prisma as any;
    const safeCount = async (fn: () => Promise<number>): Promise<number> => {
      try { return await fn(); } catch { return 0; }
    };
    const safeAgg = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try { return await fn(); } catch { return fallback; }
    };

    const [
      kdvSessions,
      mihsapInvoices,
      earsivInvoices,
      documents,
      receiptImages,
      mizanCount,
      beyanCount,
      cariTahakkuk,
      cariTahsilat,
    ] = await Promise.all([
      safeCount(() => p.kdvControlSession.count({
        where: { taxpayerId, createdAt: { gte: since } },
      })),
      safeCount(() => p.mihsapInvoice.count({
        where: { mukellefId: taxpayerId, createdAt: { gte: since } },
      })),
      safeCount(() => p.earsivFatura.count({
        where: { taxpayerId, createdAt: { gte: since } },
      })),
      safeCount(() => p.document.count({
        where: { taxpayerId, isDeleted: false, createdAt: { gte: since } },
      })),
      safeCount(() => p.receiptImage.count({
        where: {
          kdvSession: { taxpayerId },
          createdAt: { gte: since },
        },
      })),
      safeCount(() => p.mizan.count({
        where: { taxpayerId, createdAt: { gte: since } },
      })),
      safeCount(() => p.beyanKaydi.count({
        where: { taxpayerId, createdAt: { gte: since } },
      })),
      safeAgg(
        () => p.cariHareket.aggregate({
          where: { taxpayerId, tip: 'TAHAKKUK' },
          _sum: { tutar: true },
        }),
        { _sum: { tutar: 0 } } as any,
      ),
      safeAgg(
        () => p.cariHareket.aggregate({
          where: { taxpayerId, tip: { in: ['TAHSILAT', 'IADE', 'DUZELTME'] } },
          _sum: { tutar: true },
        }),
        { _sum: { tutar: 0 } } as any,
      ),
    ]);

    const tahakkukToplam = Number((cariTahakkuk as any)?._sum?.tutar ?? 0);
    const tahsilatToplam = Number((cariTahsilat as any)?._sum?.tutar ?? 0);
    const cariBakiye = tahakkukToplam - tahsilatToplam;

    // AI usage — taxpayer.companyName veya firstName lastName'e göre eşleştir
    const tpName =
      tp.companyName ||
      [tp.firstName, tp.lastName].filter(Boolean).join(' ') ||
      '';
    const aiUsage = tpName
      ? await safeAgg(
          () => p.aiUsageLog.aggregate({
            where: {
              tenantId,
              mukellef: { contains: tpName, mode: 'insensitive' },
              createdAt: { gte: since },
            },
            _count: { _all: true },
            _sum: { costUsd: true, inputTokens: true, outputTokens: true },
          }),
          { _count: { _all: 0 }, _sum: {} } as any,
        )
      : { _count: { _all: 0 }, _sum: {} };

    return {
      taxpayerId,
      months,
      since: since.toISOString(),
      counts: {
        kdvSessions,
        mihsapInvoices,
        earsivInvoices,
        documents,
        receiptImages,
        mizanCount,
        beyanCount,
        aiCalls: (aiUsage as any)?._count?._all ?? 0,
      },
      aiUsage: {
        calls: (aiUsage as any)?._count?._all ?? 0,
        inputTokens: Number((aiUsage as any)?._sum?.inputTokens ?? 0),
        outputTokens: Number((aiUsage as any)?._sum?.outputTokens ?? 0),
        costUsd: Number((aiUsage as any)?._sum?.costUsd ?? 0),
      },
      cari: {
        tahakkukToplam,
        tahsilatToplam,
        bakiye: cariBakiye,
      },
    };
  }
}
