import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Mükellef Banka Takip servisi.
 *
 * Akış:
 *  - Bilanço esasında defter tutan mükelleflerin banka hesaplarını yönetir.
 *  - Aylık ekstre takibi yapar (geldi mi / işlendi mi).
 *  - Banka Takip sayfası, defterTuru=BILANCO mükelleflerini listeler;
 *    her mükellefin tüm hesaplarının seçili dönemdeki ekstre durumunu gösterir.
 */
@Injectable()
export class BankaTakipService {
  constructor(private readonly prisma: PrismaService) {}

  // ============= BANKA HESABI CRUD =============

  async listBankaHesaplari(tenantId: string, taxpayerId?: string) {
    const where: any = { tenantId };
    if (taxpayerId) where.taxpayerId = taxpayerId;
    return (this.prisma as any).bankaHesap.findMany({
      where,
      orderBy: [{ taxpayerId: 'asc' }, { sira: 'asc' }, { bankaAdi: 'asc' }],
    });
  }

  async createBankaHesap(
    tenantId: string,
    data: {
      taxpayerId: string;
      bankaAdi: string;
      hesapNo?: string;
      iban?: string;
      sube?: string;
      paraBirimi?: string;
      aciklama?: string;
      sira?: number;
    },
  ) {
    if (!data.taxpayerId || !data.bankaAdi?.trim()) {
      throw new BadRequestException('taxpayerId ve bankaAdi zorunlu');
    }
    // Mükellef bu tenant'a ait mi?
    const tp = await (this.prisma as any).taxpayer.findFirst({
      where: { id: data.taxpayerId, tenantId },
      select: { id: true },
    });
    if (!tp) throw new NotFoundException('Mükellef bulunamadı');

    return (this.prisma as any).bankaHesap.create({
      data: {
        tenantId,
        taxpayerId: data.taxpayerId,
        bankaAdi: data.bankaAdi.trim(),
        hesapNo: data.hesapNo?.trim() || null,
        iban: data.iban?.trim() || null,
        sube: data.sube?.trim() || null,
        paraBirimi: data.paraBirimi || 'TRY',
        aciklama: data.aciklama?.trim() || null,
        sira: data.sira ?? 0,
      },
    });
  }

  async updateBankaHesap(
    tenantId: string,
    id: string,
    data: Partial<{
      bankaAdi: string;
      hesapNo: string | null;
      iban: string | null;
      sube: string | null;
      paraBirimi: string;
      aciklama: string | null;
      aktif: boolean;
      sira: number;
    }>,
  ) {
    const mevcut = await (this.prisma as any).bankaHesap.findFirst({
      where: { id, tenantId },
    });
    if (!mevcut) throw new NotFoundException('Banka hesabı bulunamadı');
    return (this.prisma as any).bankaHesap.update({ where: { id }, data });
  }

  async deleteBankaHesap(tenantId: string, id: string) {
    const mevcut = await (this.prisma as any).bankaHesap.findFirst({
      where: { id, tenantId },
    });
    if (!mevcut) throw new NotFoundException('Banka hesabı bulunamadı');
    return (this.prisma as any).bankaHesap.delete({ where: { id } });
  }

  // ============= EKSTRE KAYIT =============

  /**
   * Dönem bazlı upsert — ekstre kaydı yoksa oluşturur, varsa günceller.
   * bankaHesapId null verilirse mükellef-genel ekstre kaydı (tüm hesaplar).
   */
  async upsertEkstreKaydi(
    tenantId: string,
    data: {
      taxpayerId: string;
      bankaHesapId?: string | null;
      donem: string; // "YYYY-MM"
      ekstreGeldi?: boolean;
      ekstreIslendi?: boolean;
      islenmeNotu?: string;
      notlar?: string;
    },
  ) {
    if (!data.taxpayerId || !data.donem) {
      throw new BadRequestException('taxpayerId ve donem zorunlu');
    }
    if (!/^\d{4}-\d{2}$/.test(data.donem)) {
      throw new BadRequestException('donem formatı YYYY-MM olmalı');
    }
    const tp = await (this.prisma as any).taxpayer.findFirst({
      where: { id: data.taxpayerId, tenantId },
      select: { id: true },
    });
    if (!tp) throw new NotFoundException('Mükellef bulunamadı');

    // Banka hesabı bu tenant'a ait mi?
    if (data.bankaHesapId) {
      const bh = await (this.prisma as any).bankaHesap.findFirst({
        where: { id: data.bankaHesapId, tenantId },
        select: { id: true },
      });
      if (!bh) throw new NotFoundException('Banka hesabı bulunamadı');
    }

    const now = new Date();
    const updateData: any = {};
    if (typeof data.ekstreGeldi === 'boolean') {
      updateData.ekstreGeldi = data.ekstreGeldi;
      updateData.geldiTarihi = data.ekstreGeldi ? now : null;
    }
    if (typeof data.ekstreIslendi === 'boolean') {
      updateData.ekstreIslendi = data.ekstreIslendi;
      updateData.islenmeTarihi = data.ekstreIslendi ? now : null;
    }
    if (data.islenmeNotu !== undefined) updateData.islenmeNotu = data.islenmeNotu || null;
    if (data.notlar !== undefined) updateData.notlar = data.notlar || null;

    // Prisma upsert (composite unique: tenantId+taxpayerId+bankaHesapId+donem)
    // bankaHesapId null olabilir → upsert için where Composite null'u destekler.
    const existing = await (this.prisma as any).bankaEkstreKaydi.findFirst({
      where: {
        tenantId,
        taxpayerId: data.taxpayerId,
        bankaHesapId: data.bankaHesapId || null,
        donem: data.donem,
      },
    });
    if (existing) {
      return (this.prisma as any).bankaEkstreKaydi.update({
        where: { id: existing.id },
        data: updateData,
      });
    }
    return (this.prisma as any).bankaEkstreKaydi.create({
      data: {
        tenantId,
        taxpayerId: data.taxpayerId,
        bankaHesapId: data.bankaHesapId || null,
        donem: data.donem,
        ekstreGeldi: data.ekstreGeldi ?? false,
        geldiTarihi: data.ekstreGeldi ? now : null,
        ekstreIslendi: data.ekstreIslendi ?? false,
        islenmeTarihi: data.ekstreIslendi ? now : null,
        islenmeNotu: data.islenmeNotu || null,
        notlar: data.notlar || null,
      },
    });
  }

  // ============= ANA LİSTE — Banka Takip sayfası için =============

  /**
   * Verilen dönem (YYYY-MM) için tüm Bilanço mükelleflerini banka hesapları
   * ve ekstre durumlarıyla birlikte döner.
   *
   * Frontend bunu tek istekte alır → mükellef-by-mükellef, banka-by-banka satır gösterir.
   */
  async listForDonem(tenantId: string, donem: string) {
    if (!/^\d{4}-\d{2}$/.test(donem)) {
      throw new BadRequestException('donem formatı YYYY-MM olmalı');
    }
    // 1) Bilanço mükellefleri
    const taxpayers = await (this.prisma as any).taxpayer.findMany({
      where: {
        tenantId,
        defterTuru: 'BILANCO',
        isActive: true,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        companyName: true,
        taxNumber: true,
      },
      orderBy: [{ companyName: 'asc' }, { firstName: 'asc' }],
    });
    if (taxpayers.length === 0) return { donem, items: [] };

    const taxpayerIds = taxpayers.map((t: any) => t.id);

    // 2) Banka hesapları (aktif olanlar)
    const bankaHesaplar = await (this.prisma as any).bankaHesap.findMany({
      where: { tenantId, taxpayerId: { in: taxpayerIds }, aktif: true },
      orderBy: [{ sira: 'asc' }, { bankaAdi: 'asc' }],
    });

    // 3) Bu dönem için ekstre kayıtları
    const ekstreler = await (this.prisma as any).bankaEkstreKaydi.findMany({
      where: { tenantId, taxpayerId: { in: taxpayerIds }, donem },
    });

    // 4) Mükellef-by-mükellef topla
    const ekstreByKey = new Map<string, any>();
    for (const e of ekstreler) {
      const key = `${e.taxpayerId}::${e.bankaHesapId || 'GENEL'}`;
      ekstreByKey.set(key, e);
    }
    const hesaplarByTaxpayer = new Map<string, any[]>();
    for (const bh of bankaHesaplar) {
      const list = hesaplarByTaxpayer.get(bh.taxpayerId) || [];
      list.push(bh);
      hesaplarByTaxpayer.set(bh.taxpayerId, list);
    }

    const items = taxpayers.map((tp: any) => {
      const hesaplar = hesaplarByTaxpayer.get(tp.id) || [];
      const hesapDetay = hesaplar.map((bh: any) => {
        const e = ekstreByKey.get(`${tp.id}::${bh.id}`);
        return {
          bankaHesap: bh,
          ekstreGeldi: e?.ekstreGeldi ?? false,
          geldiTarihi: e?.geldiTarihi ?? null,
          ekstreIslendi: e?.ekstreIslendi ?? false,
          islenmeTarihi: e?.islenmeTarihi ?? null,
          islenmeNotu: e?.islenmeNotu ?? null,
          notlar: e?.notlar ?? null,
        };
      });
      // Mükellef-genel ekstre kaydı (bankaHesapId=null)
      const genel = ekstreByKey.get(`${tp.id}::GENEL`);
      // Özet: tüm hesaplar geldi/işlendi mi
      const tumGeldi =
        hesapDetay.length > 0 && hesapDetay.every((h: any) => h.ekstreGeldi);
      const tumIslendi =
        hesapDetay.length > 0 && hesapDetay.every((h: any) => h.ekstreIslendi);
      return {
        taxpayer: tp,
        hesaplar: hesapDetay,
        genel: genel
          ? {
              ekstreGeldi: genel.ekstreGeldi,
              ekstreIslendi: genel.ekstreIslendi,
              islenmeNotu: genel.islenmeNotu,
              notlar: genel.notlar,
            }
          : null,
        ozet: {
          hesapSayisi: hesapDetay.length,
          tumGeldi,
          tumIslendi,
          eksikGeldi: hesapDetay.filter((h: any) => !h.ekstreGeldi).length,
          eksikIslendi: hesapDetay.filter((h: any) => !h.ekstreIslendi).length,
        },
      };
    });

    return { donem, items };
  }

  async createEksikEkstreTasks(
    tenantId: string,
    userId: string,
    data: { donem: string; taxpayerIds?: string[] },
  ) {
    if (!/^\d{4}-\d{2}$/.test(data.donem)) {
      throw new BadRequestException('donem formatÄ± YYYY-MM olmalÄ±');
    }
    const list = await this.listForDonem(tenantId, data.donem);
    const selected = new Set(data.taxpayerIds || []);
    const targets = list.items.filter((item: any) => {
      if (selected.size && !selected.has(item.taxpayer.id)) return false;
      return item.ozet.hesapSayisi === 0 || item.ozet.eksikGeldi > 0 || item.ozet.eksikIslendi > 0;
    });

    const due = new Date();
    due.setDate(due.getDate() + 2);
    due.setHours(9, 0, 0, 0);

    const created = [];
    for (const item of targets) {
      const ad = item.taxpayer.companyName || `${item.taxpayer.firstName || ''} ${item.taxpayer.lastName || ''}`.trim();
      const eksikler = item.ozet.hesapSayisi === 0
        ? 'Banka hesabÄ± tanÄ±mlÄ± deÄŸil'
        : `${item.ozet.eksikGeldi} ekstre bekleniyor, ${item.ozet.eksikIslendi} ekstre iÅŸlenmeyi bekliyor`;
      const task = await (this.prisma as any).task.create({
        data: {
          tenantId,
          title: `${ad} - ${data.donem} banka ekstresi`,
          description: eksikler,
          category: 'BANKA',
          priority: item.ozet.hesapSayisi === 0 ? 'HIGH' : 'MEDIUM',
          taxpayerId: item.taxpayer.id,
          createdById: userId,
          dueDate: due,
          dueTime: '09:00',
          allDay: false,
          notifyInApp: true,
          notifyBrowser: true,
        },
      });
      created.push(task);
    }

    return { count: created.length, items: created };
  }
}
