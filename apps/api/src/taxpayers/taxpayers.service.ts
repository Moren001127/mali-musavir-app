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
        startDate: true,
        endDate: true,
        createdAt: true,
        lucaSlug: true,
        mihsapId: true,
        mihsapDefterTuru: true,
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
}
