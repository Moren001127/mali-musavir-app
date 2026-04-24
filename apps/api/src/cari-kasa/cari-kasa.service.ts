import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Cari Kasa Servisi — muhasebe ofisi müşteri hesapları.
 *
 * Mantık:
 *  - Her mükellefe birden fazla hizmet tanımlanabilir (muhasebe, bordro, SGK, yıllık).
 *  - Her ayın 1. günü cron otomatik TAHAKKUK hareketi oluşturur (hizmetin periyoduna göre).
 *  - Ödemeler elle TAHSILAT olarak eklenir.
 *  - Bakiye = SUM(TAHAKKUK + IADE) - SUM(TAHSILAT + DUZELTME).
 */
@Injectable()
export class CariKasaService {
  private readonly logger = new Logger(CariKasaService.name);
  constructor(private readonly prisma: PrismaService) {}

  // ==================== HİZMET CRUD ====================

  async listHizmetler(tenantId: string, taxpayerId?: string) {
    const where: any = { tenantId };
    if (taxpayerId) where.taxpayerId = taxpayerId;
    return (this.prisma as any).cariHizmet.findMany({
      where,
      orderBy: [{ aktif: 'desc' }, { createdAt: 'asc' }],
      include: { taxpayer: { select: { id: true, firstName: true, lastName: true, companyName: true, taxNumber: true } } },
    });
  }

  async getHizmet(tenantId: string, id: string) {
    const h = await (this.prisma as any).cariHizmet.findFirst({ where: { id, tenantId } });
    if (!h) throw new NotFoundException('Hizmet bulunamadı');
    return h;
  }

  async createHizmet(
    tenantId: string,
    data: {
      taxpayerId: string;
      hizmetAdi: string;
      tutar: number;
      periyot: 'AYLIK' | 'UCAYLIK' | 'ALTIAYLIK' | 'YILLIK';
      baslangicAy: string; // "2026-01"
      bitisAy?: string;
      notlar?: string;
    },
  ) {
    if (!data.taxpayerId || !data.hizmetAdi || data.tutar == null) {
      throw new BadRequestException('taxpayerId, hizmetAdi, tutar zorunlu');
    }
    if (!/^\d{4}-\d{2}$/.test(data.baslangicAy)) {
      throw new BadRequestException('baslangicAy formatı: "2026-01"');
    }
    return (this.prisma as any).cariHizmet.create({
      data: {
        tenantId,
        taxpayerId: data.taxpayerId,
        hizmetAdi: data.hizmetAdi.trim(),
        tutar: data.tutar,
        periyot: data.periyot || 'AYLIK',
        baslangicAy: data.baslangicAy,
        bitisAy: data.bitisAy || null,
        notlar: data.notlar?.trim() || null,
      },
    });
  }

  async updateHizmet(tenantId: string, id: string, data: Partial<{
    hizmetAdi: string;
    tutar: number;
    periyot: string;
    baslangicAy: string;
    bitisAy: string | null;
    aktif: boolean;
    notlar: string | null;
  }>) {
    await this.getHizmet(tenantId, id);
    return (this.prisma as any).cariHizmet.update({ where: { id }, data });
  }

  async deleteHizmet(tenantId: string, id: string) {
    await this.getHizmet(tenantId, id);
    // Hareketleri koruyoruz — sadece hizmet tanımını sil. Hareketlerin hizmetId'si SetNull olur.
    return (this.prisma as any).cariHizmet.delete({ where: { id } });
  }

  // ==================== HAREKET CRUD ====================

  async listHareketler(
    tenantId: string,
    params: { taxpayerId?: string; baslangic?: string; bitis?: string; tip?: string; limit?: number },
  ) {
    const where: any = { tenantId };
    if (params.taxpayerId) where.taxpayerId = params.taxpayerId;
    if (params.tip) where.tip = params.tip;
    if (params.baslangic || params.bitis) {
      where.tarih = {};
      if (params.baslangic) where.tarih.gte = new Date(params.baslangic);
      if (params.bitis) where.tarih.lte = new Date(params.bitis);
    }
    return (this.prisma as any).cariHareket.findMany({
      where,
      orderBy: [{ tarih: 'desc' }, { createdAt: 'desc' }],
      take: params.limit || 500,
      include: {
        hizmet: { select: { id: true, hizmetAdi: true } },
        taxpayer: { select: { id: true, firstName: true, lastName: true, companyName: true, taxNumber: true } },
      },
    });
  }

  async createTahsilat(
    tenantId: string,
    data: {
      taxpayerId: string;
      tarih: string;
      tutar: number;
      odemeYontemi?: string;
      belgeNo?: string;
      aciklama?: string;
      donem?: string;
    },
    createdBy?: string,
  ) {
    if (!data.taxpayerId || data.tutar == null) {
      throw new BadRequestException('taxpayerId ve tutar zorunlu');
    }
    if (Number(data.tutar) <= 0) {
      throw new BadRequestException('Tahsilat tutarı pozitif olmalı');
    }
    return (this.prisma as any).cariHareket.create({
      data: {
        tenantId,
        taxpayerId: data.taxpayerId,
        tarih: data.tarih ? new Date(data.tarih) : new Date(),
        tip: 'TAHSILAT',
        tutar: data.tutar,
        odemeYontemi: data.odemeYontemi || 'NAKIT',
        belgeNo: data.belgeNo || null,
        aciklama: data.aciklama || null,
        donem: data.donem || null,
        otoOlusturuldu: false,
        createdBy: createdBy || null,
      },
    });
  }

  async createManuelTahakkuk(
    tenantId: string,
    data: {
      taxpayerId: string;
      hizmetId?: string;
      tarih: string;
      tutar: number;
      donem: string;
      aciklama?: string;
    },
    createdBy?: string,
  ) {
    if (!data.taxpayerId || data.tutar == null || !data.donem) {
      throw new BadRequestException('taxpayerId, tutar, donem zorunlu');
    }
    return (this.prisma as any).cariHareket.create({
      data: {
        tenantId,
        taxpayerId: data.taxpayerId,
        hizmetId: data.hizmetId || null,
        tarih: data.tarih ? new Date(data.tarih) : new Date(),
        tip: 'TAHAKKUK',
        tutar: data.tutar,
        donem: data.donem,
        aciklama: data.aciklama || 'Manuel tahakkuk',
        otoOlusturuldu: false,
        createdBy: createdBy || null,
      },
    });
  }

  async deleteHareket(tenantId: string, id: string) {
    const h = await (this.prisma as any).cariHareket.findFirst({ where: { id, tenantId } });
    if (!h) throw new NotFoundException('Hareket bulunamadı');
    return (this.prisma as any).cariHareket.delete({ where: { id } });
  }

  // ==================== BAKİYE ====================

  /**
   * Mükellefin bakiyesi:
   *   borç = SUM(TAHAKKUK) - SUM(IADE)
   *   alacak = SUM(TAHSILAT) - SUM(DUZELTME)
   *   bakiye = borç - alacak  (pozitifse müşteri borçlu)
   */
  async hesaplaBakiye(tenantId: string, taxpayerId: string, tariheKadar?: Date) {
    const where: any = { tenantId, taxpayerId };
    if (tariheKadar) where.tarih = { lte: tariheKadar };
    const hareketler = await (this.prisma as any).cariHareket.findMany({
      where,
      select: { tip: true, tutar: true },
    });
    let tahakkuk = 0, tahsilat = 0, iade = 0, duzeltme = 0;
    for (const h of hareketler) {
      const v = Number(h.tutar);
      if (h.tip === 'TAHAKKUK') tahakkuk += v;
      else if (h.tip === 'TAHSILAT') tahsilat += v;
      else if (h.tip === 'IADE') iade += v;
      else if (h.tip === 'DUZELTME') duzeltme += v;
    }
    const borc = tahakkuk - iade;
    const alacak = tahsilat - duzeltme;
    return {
      tahakkuk: Math.round(tahakkuk * 100) / 100,
      tahsilat: Math.round(tahsilat * 100) / 100,
      iade: Math.round(iade * 100) / 100,
      duzeltme: Math.round(duzeltme * 100) / 100,
      borc: Math.round(borc * 100) / 100,
      alacak: Math.round(alacak * 100) / 100,
      bakiye: Math.round((borc - alacak) * 100) / 100,
    };
  }

  // ==================== EKSTRE ====================

  async getEkstre(
    tenantId: string,
    taxpayerId: string,
    baslangic: string,
    bitis: string,
  ) {
    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
    });
    if (!taxpayer) throw new NotFoundException('Mükellef bulunamadı');

    const basTarih = new Date(baslangic);
    const bitTarih = new Date(bitis);
    bitTarih.setHours(23, 59, 59, 999);

    // Açılış bakiyesi — başlangıç tarihinden önceki hareketler
    const acilisBakiye = await this.hesaplaBakiye(
      tenantId,
      taxpayerId,
      new Date(basTarih.getTime() - 1),
    );

    // Dönem hareketleri
    const hareketler = await (this.prisma as any).cariHareket.findMany({
      where: {
        tenantId,
        taxpayerId,
        tarih: { gte: basTarih, lte: bitTarih },
      },
      orderBy: [{ tarih: 'asc' }, { createdAt: 'asc' }],
      include: { hizmet: { select: { hizmetAdi: true } } },
    });

    // Kapanış bakiyesi — bitiş tarihine kadar
    const kapanisBakiye = await this.hesaplaBakiye(tenantId, taxpayerId, bitTarih);

    // Running bakiye hesaplama
    let runningBorc = acilisBakiye.borc;
    let runningAlacak = acilisBakiye.alacak;
    const satirlar = hareketler.map((h: any) => {
      const v = Number(h.tutar);
      if (h.tip === 'TAHAKKUK') runningBorc += v;
      else if (h.tip === 'IADE') runningBorc -= v;
      else if (h.tip === 'TAHSILAT') runningAlacak += v;
      else if (h.tip === 'DUZELTME') runningAlacak -= v;
      return {
        ...h,
        tutar: Number(h.tutar),
        runningBakiye: Math.round((runningBorc - runningAlacak) * 100) / 100,
      };
    });

    return {
      taxpayer: {
        id: taxpayer.id,
        ad: taxpayer.companyName || `${taxpayer.firstName || ''} ${taxpayer.lastName || ''}`.trim(),
        taxNumber: taxpayer.taxNumber,
        taxOffice: taxpayer.taxOffice,
      },
      donem: { baslangic, bitis },
      acilisBakiye: acilisBakiye.bakiye,
      kapanisBakiye: kapanisBakiye.bakiye,
      toplamTahakkuk: satirlar.reduce((s: number, h: any) => s + (h.tip === 'TAHAKKUK' ? h.tutar : 0), 0),
      toplamTahsilat: satirlar.reduce((s: number, h: any) => s + (h.tip === 'TAHSILAT' ? h.tutar : 0), 0),
      satirlar,
    };
  }

  // ==================== OTOMATİK TAHAKKUK (CRON) ====================

  /**
   * Cron tarafından ayın 1. günü çağrılır. Aktif hizmetler için o ayın
   * TAHAKKUK hareketini oluşturur. Duplicate önleme: sonTahakkukAy.
   */
  async otoTahakkukUret(donem: string /* "2026-04" */) {
    this.logger.log(`[CariKasa] Otomatik tahakkuk başladı · donem=${donem}`);

    const hizmetler = await (this.prisma as any).cariHizmet.findMany({
      where: { aktif: true },
    });

    let olusturulan = 0;
    let atlanan = 0;
    const hatalar: string[] = [];

    for (const h of hizmetler) {
      try {
        // Başlangıç ayı kontrolü
        if (donem < h.baslangicAy) { atlanan++; continue; }
        // Bitiş ayı kontrolü
        if (h.bitisAy && donem > h.bitisAy) { atlanan++; continue; }
        // Duplicate önleme
        if (h.sonTahakkukAy === donem) { atlanan++; continue; }

        // Periyot kontrolü
        if (!this.periyotMatch(h.periyot, h.baslangicAy, donem)) { atlanan++; continue; }

        // Tahakkuk kaydı
        const [year, month] = donem.split('-');
        const tarih = new Date(Number(year), Number(month) - 1, 1); // ayın 1. günü

        await (this.prisma as any).cariHareket.create({
          data: {
            tenantId: h.tenantId,
            taxpayerId: h.taxpayerId,
            hizmetId: h.id,
            tarih,
            tip: 'TAHAKKUK',
            tutar: h.tutar,
            donem,
            aciklama: `${h.hizmetAdi} · ${donem}`,
            otoOlusturuldu: true,
          },
        });
        await (this.prisma as any).cariHizmet.update({
          where: { id: h.id },
          data: { sonTahakkukAy: donem },
        });
        olusturulan++;
      } catch (e: any) {
        hatalar.push(`${h.id}: ${e?.message || 'hata'}`);
      }
    }

    this.logger.log(
      `[CariKasa] Otomatik tahakkuk bitti · olusturulan=${olusturulan} atlanan=${atlanan} hata=${hatalar.length}`,
    );
    return { olusturulan, atlanan, hatalar };
  }

  /**
   * Hizmet periyoduna göre bu ay tahakkuk edilecek mi kontrolü.
   * AYLIK → her ay
   * UCAYLIK → Q1/Q2/Q3/Q4 (Ocak, Nisan, Temmuz, Ekim)
   * ALTIAYLIK → H1/H2 (Ocak, Temmuz)
   * YILLIK → sadece başlangıç ayıyla aynı ay
   */
  private periyotMatch(periyot: string, baslangicAy: string, donem: string): boolean {
    const baslangicM = Number(baslangicAy.split('-')[1]);
    const donemM = Number(donem.split('-')[1]);
    if (periyot === 'AYLIK') return true;
    if (periyot === 'UCAYLIK') {
      // Başlangıç ayıyla 3 ay arayla
      return (donemM - baslangicM) % 3 === 0;
    }
    if (periyot === 'ALTIAYLIK') {
      return (donemM - baslangicM) % 6 === 0;
    }
    if (periyot === 'YILLIK') {
      return donemM === baslangicM;
    }
    return false;
  }

  // ==================== GENEL ÖZET (tüm mükellefler) ====================

  async genelOzet(tenantId: string) {
    const hareketler = await (this.prisma as any).cariHareket.findMany({
      where: { tenantId },
      select: { taxpayerId: true, tip: true, tutar: true },
    });
    const map = new Map<string, { tahakkuk: number; tahsilat: number; bakiye: number }>();
    for (const h of hareketler) {
      const r = map.get(h.taxpayerId) || { tahakkuk: 0, tahsilat: 0, bakiye: 0 };
      const v = Number(h.tutar);
      if (h.tip === 'TAHAKKUK') r.tahakkuk += v;
      else if (h.tip === 'IADE') r.tahakkuk -= v;
      else if (h.tip === 'TAHSILAT') r.tahsilat += v;
      else if (h.tip === 'DUZELTME') r.tahsilat -= v;
      r.bakiye = r.tahakkuk - r.tahsilat;
      map.set(h.taxpayerId, r);
    }
    const taxpayers = await (this.prisma as any).taxpayer.findMany({
      where: { tenantId, id: { in: Array.from(map.keys()) } },
      select: { id: true, firstName: true, lastName: true, companyName: true, taxNumber: true },
    });
    return taxpayers.map((t: any) => ({
      ...t,
      ad: t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim(),
      ...map.get(t.id)!,
    })).sort((a: any, b: any) => b.bakiye - a.bakiye);
  }
}
