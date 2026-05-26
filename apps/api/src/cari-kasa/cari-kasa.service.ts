import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsApp: WhatsAppService,
  ) {}

  private readonly defaultBudgetCategories = [
    { name: 'Müşteri Tahsilatı', type: 'GELIR', color: '#4ade80', icon: 'wallet', sortOrder: 10 },
    { name: 'Ek Hizmet Geliri', type: 'GELIR', color: '#60a5fa', icon: 'receipt', sortOrder: 20 },
    { name: 'Danışmanlık Geliri', type: 'GELIR', color: '#a78bfa', icon: 'briefcase', sortOrder: 30 },
    { name: 'Diğer Gelir', type: 'GELIR', color: '#d4b876', icon: 'plus', sortOrder: 90 },
    { name: 'Kira', type: 'GIDER', color: '#f97316', icon: 'building', sortOrder: 10 },
    { name: 'Personel', type: 'GIDER', color: '#fb7185', icon: 'users', sortOrder: 20 },
    { name: 'Vergi ve SGK', type: 'GIDER', color: '#facc15', icon: 'file-text', sortOrder: 30 },
    { name: 'Yazılım ve Abonelik', type: 'GIDER', color: '#38bdf8', icon: 'monitor', sortOrder: 40 },
    { name: 'Ofis Gideri', type: 'GIDER', color: '#94a3b8', icon: 'package', sortOrder: 50 },
    { name: 'Ulaşım', type: 'GIDER', color: '#22c55e', icon: 'car', sortOrder: 60 },
    { name: 'Pazarlama', type: 'GIDER', color: '#c084fc', icon: 'megaphone', sortOrder: 70 },
    { name: 'Diğer Gider', type: 'GIDER', color: '#ef4444', icon: 'minus', sortOrder: 90 },
  ];

  private readonly defaultFinancialAccounts = [
    { name: 'Ziraat Bankası', type: 'BANKA', color: '#dc2626', sortOrder: 10 },
    { name: 'Enpara', type: 'BANKA', color: '#7c3aed', sortOrder: 20 },
    { name: 'Nakit', type: 'NAKIT', color: '#d4b876', sortOrder: 30 },
  ];

  private normalizeBudgetType(type?: string) {
    const value = String(type || '').toUpperCase();
    if (value !== 'GELIR' && value !== 'GIDER') {
      throw new BadRequestException('type GELIR veya GIDER olmalı');
    }
    return value;
  }

  private normalizeAccountType(type?: string) {
    const value = String(type || 'BANKA').toUpperCase();
    if (!['BANKA', 'NAKIT', 'KREDI_KARTI', 'DIGER'].includes(value)) {
      throw new BadRequestException('type BANKA, NAKIT, KREDI_KARTI veya DIGER olmalı');
    }
    return value;
  }

  private normalizePeriod(period?: string) {
    const value = period || this.currentPeriod();
    if (!/^\d{4}-\d{2}$/.test(value)) {
      throw new BadRequestException('period formatı YYYY-MM olmalı');
    }
    const month = Number(value.slice(5, 7));
    if (month < 1 || month > 12) {
      throw new BadRequestException('period ayı 01-12 arasında olmalı');
    }
    return value;
  }

  private currentPeriod() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private periodFromDate(date: Date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private yearMonths(year: number) {
    return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  }

  private taxpayerName(t: any) {
    return (t?.companyName || `${t?.firstName || ''} ${t?.lastName || ''}`.trim() || t?.taxNumber || '').trim();
  }

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
    const hizmet = await (this.prisma as any).cariHizmet.create({
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

    // Otomatik backfill — başlangıç ayından şu ana kadar TAHAKKUK kayıtları üret.
    // Kullanıcı "2.000 TL Muhasebe Ücreti Aylık 2026-01" dediğinde borç görünsün.
    await this.backfillTahakkuk(hizmet);
    return hizmet;
  }

  /**
   * Başlangıç ayından bugüne kadar periyoda uygun TAHAKKUK hareketlerini üretir.
   * Hem createHizmet sonrası hem manuel tetikleme (updateHizmet) için kullanılır.
   */
  private async backfillTahakkuk(hizmet: any) {
    const now = new Date();
    const bugunAy = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const hareketler: any[] = [];
    let donem = hizmet.baslangicAy;
    let sonUretilen: string | null = null;
    let iter = 0;
    while (donem <= bugunAy && iter < 60) {
      iter++;
      if (hizmet.bitisAy && donem > hizmet.bitisAy) break;
      if (this.periyotMatch(hizmet.periyot, hizmet.baslangicAy, donem)) {
        const [y, m] = donem.split('-');
        const tarih = new Date(Number(y), Number(m) - 1, 1);
        hareketler.push({
          tenantId: hizmet.tenantId,
          taxpayerId: hizmet.taxpayerId,
          hizmetId: hizmet.id,
          tarih,
          tip: 'TAHAKKUK',
          tutar: hizmet.tutar,
          donem,
          aciklama: `${hizmet.hizmetAdi} · ${donem}`,
          otoOlusturuldu: true,
        });
        sonUretilen = donem;
      }
      // Sonraki ay
      const [y, m] = donem.split('-').map(Number);
      const next = new Date(y, m, 1); // ay+1
      donem = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    }
    if (hareketler.length > 0) {
      await (this.prisma as any).cariHareket.createMany({ data: hareketler });
      await (this.prisma as any).cariHizmet.update({
        where: { id: hizmet.id },
        data: { sonTahakkukAy: sonUretilen },
      });
    }
    this.logger.log(
      `[CariKasa] Backfill: hizmet=${hizmet.id} periyot=${hizmet.periyot} → ${hareketler.length} tahakkuk`,
    );
    return { count: hareketler.length };
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
        account: { select: { id: true, name: true, type: true, color: true } },
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
      accountId?: string;
    },
    createdBy?: string,
  ) {
    if (!data.taxpayerId || data.tutar == null || !data.accountId) {
      throw new BadRequestException('taxpayerId, accountId ve tutar zorunlu');
    }
    if (Number(data.tutar) <= 0) {
      throw new BadRequestException('Tahsilat tutarı pozitif olmalı');
    }
    const account = await this.getFinancialAccount(tenantId, data.accountId);
    return (this.prisma as any).cariHareket.create({
      data: {
        tenantId,
        taxpayerId: data.taxpayerId,
        accountId: account.id,
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
  //
  // Tablo görünümü için — HER mükellef dönülür (hareket yoksa 0 bakiye).
  // aylikMuhasebeUcreti: aktif ve AYLIK olan ilk hizmetin tutarı (muhasebe ücreti).
  // baslangic/bitis verilirse o tarih aralığındaki tahakkuk+tahsilat; yoksa tümü.
  async genelOzet(tenantId: string, baslangic?: string, bitis?: string) {
    // 1. Tüm aktif mükellefler (hareket olmasa bile tabloda görünsün)
    const taxpayers = await (this.prisma as any).taxpayer.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true, firstName: true, lastName: true, companyName: true,
        taxNumber: true, phone: true, email: true, startDate: true, endDate: true,
      },
    });

    // 2. Hareketler — tarih aralığı verilmişse filtrele, değilse hepsi
    const hareketWhere: any = { tenantId };
    if (baslangic || bitis) {
      hareketWhere.tarih = {};
      if (baslangic) hareketWhere.tarih.gte = new Date(baslangic);
      if (bitis) {
        const b = new Date(bitis);
        b.setHours(23, 59, 59, 999);
        hareketWhere.tarih.lte = b;
      }
    }
    const hareketler = await (this.prisma as any).cariHareket.findMany({
      where: hareketWhere,
      select: { taxpayerId: true, tip: true, tutar: true },
    });
    const harMap = new Map<string, { tahakkuk: number; tahsilat: number }>();
    for (const h of hareketler) {
      const r = harMap.get(h.taxpayerId) || { tahakkuk: 0, tahsilat: 0 };
      const v = Number(h.tutar);
      if (h.tip === 'TAHAKKUK') r.tahakkuk += v;
      else if (h.tip === 'IADE') r.tahakkuk -= v;
      else if (h.tip === 'TAHSILAT') r.tahsilat += v;
      else if (h.tip === 'DUZELTME') r.tahsilat -= v;
      harMap.set(h.taxpayerId, r);
    }

    // 3. Aylık muhasebe ücreti — aktif AYLIK hizmetler (mukellef başına toplam)
    const hizmetler = await (this.prisma as any).cariHizmet.findMany({
      where: { tenantId, aktif: true, periyot: 'AYLIK' },
      select: { taxpayerId: true, tutar: true },
    });
    const ucretMap = new Map<string, number>();
    for (const h of hizmetler) {
      ucretMap.set(h.taxpayerId, (ucretMap.get(h.taxpayerId) || 0) + Number(h.tutar));
    }

    // Türkçe alfabetik sıralama için Intl.Collator
    const collator = new Intl.Collator('tr', { sensitivity: 'base' });
    const adOf = (t: any) =>
      (t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || t.taxNumber || '').trim();

    return taxpayers
      .map((t: any) => {
        const h = harMap.get(t.id) || { tahakkuk: 0, tahsilat: 0 };
        const bakiye = Math.round((h.tahakkuk - h.tahsilat) * 100) / 100;
        return {
          id: t.id,
          ad: adOf(t),
          taxNumber: t.taxNumber,
          phone: t.phone,
          email: t.email,
          aylikMuhasebeUcreti: ucretMap.get(t.id) || 0,
          tahakkuk: Math.round(h.tahakkuk * 100) / 100,
          tahsilat: Math.round(h.tahsilat * 100) / 100,
          bakiye,
        };
      })
      .sort((a: any, b: any) => collator.compare(a.ad, b.ad));
  }

  private roundMoney(n: number) {
    return Math.round(n * 100) / 100;
  }

  private fmtMoney(n: number) {
    return this.roundMoney(n).toLocaleString('tr-TR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  private primaryPhone(t: any): string | null {
    if (t.phone?.trim()) return t.phone.trim();
    const list = Array.isArray(t.phones) ? t.phones : [];
    return list.find((p: string) => p?.trim())?.trim() || null;
  }

  private renderTahsilatMesaji(template: string, row: any, donem: string) {
    return template
      .split('{ad}').join(row.ad || 'Mükellefimiz')
      .split('{bakiye}').join(`${this.fmtMoney(row.bakiye)} TL`)
      .split('{dönem}').join(donem)
      .split('{donem}').join(donem);
  }

  private calculateAgingFromMovements(hareketler: any[], today = new Date()) {
    const tahakkuklar = hareketler
      .filter((h) => h.tip === 'TAHAKKUK' || h.tip === 'IADE')
      .sort((a, b) => new Date(a.tarih).getTime() - new Date(b.tarih).getTime())
      .map((h) => ({
        tarih: new Date(h.tarih),
        kalan: Number(h.tutar) * (h.tip === 'IADE' ? -1 : 1),
      }))
      .filter((h) => h.kalan > 0);

    let tahsilat = hareketler.reduce((sum, h) => {
      if (h.tip === 'TAHSILAT') return sum + Number(h.tutar);
      if (h.tip === 'DUZELTME') return sum - Number(h.tutar);
      return sum;
    }, 0);

    for (const item of tahakkuklar) {
      if (tahsilat <= 0) break;
      const used = Math.min(item.kalan, tahsilat);
      item.kalan = this.roundMoney(item.kalan - used);
      tahsilat = this.roundMoney(tahsilat - used);
    }

    const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
    for (const item of tahakkuklar) {
      if (item.kalan <= 0) continue;
      const ageDays = Math.max(0, Math.floor((today.getTime() - item.tarih.getTime()) / 86400000));
      if (ageDays <= 0) buckets.current += item.kalan;
      else if (ageDays <= 30) buckets.d1_30 += item.kalan;
      else if (ageDays <= 60) buckets.d31_60 += item.kalan;
      else if (ageDays <= 90) buckets.d61_90 += item.kalan;
      else buckets.d90plus += item.kalan;
    }

    return Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, this.roundMoney(v)]));
  }

  async yaslandirma(tenantId: string) {
    const taxpayers = await (this.prisma as any).taxpayer.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true, firstName: true, lastName: true, companyName: true, taxNumber: true,
        phone: true, phones: true,
      },
    });
    const ids = taxpayers.map((t: any) => t.id);
    const hareketler = ids.length
      ? await (this.prisma as any).cariHareket.findMany({
          where: { tenantId, taxpayerId: { in: ids } },
          select: { taxpayerId: true, tip: true, tutar: true, tarih: true },
          orderBy: [{ tarih: 'asc' }, { createdAt: 'asc' }],
        })
      : [];

    const byTaxpayer = new Map<string, any[]>();
    for (const h of hareketler) {
      const list = byTaxpayer.get(h.taxpayerId) || [];
      list.push(h);
      byTaxpayer.set(h.taxpayerId, list);
    }

    const adOf = (t: any) =>
      (t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || t.taxNumber || '').trim();

    const rows = taxpayers.map((t: any) => {
      const movements = byTaxpayer.get(t.id) || [];
      const aging = this.calculateAgingFromMovements(movements);
      const bakiye = this.roundMoney(Object.values(aging).reduce((s: number, v: any) => s + Number(v), 0));
      const maxBucket = aging.d90plus > 0 ? '90+' : aging.d61_90 > 0 ? '61-90' : aging.d31_60 > 0 ? '31-60' : aging.d1_30 > 0 ? '1-30' : bakiye > 0 ? 'Güncel' : 'Yok';
      return {
        id: t.id,
        ad: adOf(t),
        taxNumber: t.taxNumber,
        phone: this.primaryPhone(t),
        bakiye,
        maxBucket,
        aging,
      };
    }).filter((r: any) => r.bakiye > 0);

    const totals = rows.reduce((acc: any, r: any) => {
      for (const key of Object.keys(acc)) acc[key] = this.roundMoney(acc[key] + Number(r.aging[key] || 0));
      return acc;
    }, { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 });

    return {
      totals,
      toplamBakiye: this.roundMoney(Object.values(totals).reduce<number>((s, v) => s + Number(v), 0)),
      rows: rows.sort((a: any, b: any) => b.bakiye - a.bakiye),
    };
  }

  async tahsilatAjandasi(tenantId: string) {
    const [yas, sonTahsilatlar, logs] = await Promise.all([
      this.yaslandirma(tenantId),
      (this.prisma as any).cariHareket.findMany({
        where: { tenantId, tip: 'TAHSILAT' },
        select: { taxpayerId: true, tarih: true },
        orderBy: { tarih: 'desc' },
      }),
      (this.prisma as any).communicationLog.findMany({
        where: { taxpayer: { tenantId }, channel: 'WHATSAPP', subject: { contains: 'Tahsilat' } },
        select: { taxpayerId: true, occurredAt: true },
        orderBy: { occurredAt: 'desc' },
      }),
    ]);

    const lastPay = new Map<string, Date>();
    for (const h of sonTahsilatlar) if (!lastPay.has(h.taxpayerId)) lastPay.set(h.taxpayerId, h.tarih);
    const lastReminder = new Map<string, Date>();
    for (const l of logs) if (!lastReminder.has(l.taxpayerId)) lastReminder.set(l.taxpayerId, l.occurredAt);

    return {
      totals: yas.totals,
      toplamBakiye: yas.toplamBakiye,
      rows: yas.rows.map((r: any) => ({
        ...r,
        sonTahsilatTarihi: lastPay.get(r.id) || null,
        sonHatirlatmaTarihi: lastReminder.get(r.id) || null,
        telefonVar: Boolean(r.phone),
        whatsappUygun: Boolean(r.phone && r.bakiye > 0),
      })),
    };
  }

  async tahsilatHatirlatmaPreview(tenantId: string, body: { taxpayerIds?: string[]; minBakiye?: number }) {
    const ajanda = await this.tahsilatAjandasi(tenantId);
    const selected = new Set(body.taxpayerIds || []);
    const minBakiye = Number(body.minBakiye || 0);
    const donem = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const template = await (this.prisma as any).smsTemplate.findUnique({ where: { tenantId } });
    const mesajSablonu = template?.tahsilatHatirlatmaMesaji
      || 'Sayın {ad}, cari hesabınızda {bakiye} açık bakiye görünmektedir. Ödeme yaptıysanız dekontu iletmenizi rica ederiz. Moren Mali Müşavirlik';

    const rows = ajanda.rows
      .filter((r: any) => selected.size === 0 || selected.has(r.id))
      .map((r: any) => {
        const reasons: string[] = [];
        if (r.bakiye <= 0) reasons.push('Pozitif bakiye yok');
        if (r.bakiye < minBakiye) reasons.push('Minimum bakiye altında');
        if (!r.phone) reasons.push('Telefon yok');
        return {
          taxpayerId: r.id,
          ad: r.ad,
          phone: r.phone,
          bakiye: r.bakiye,
          gonderilebilir: reasons.length === 0,
          atlamaSebebi: reasons.join(', ') || null,
          mesaj: this.renderTahsilatMesaji(mesajSablonu, r, donem),
          templateParameters: [r.ad, `${this.fmtMoney(r.bakiye)} TL`, donem],
        };
      });

    return {
      donem,
      gonderilecek: rows.filter((r: any) => r.gonderilebilir).length,
      atlanacak: rows.filter((r: any) => !r.gonderilebilir).length,
      rows,
      whatsapp: this.whatsApp.getStatus(tenantId),
    };
  }

  async tahsilatHatirlatmaSend(tenantId: string, body: { taxpayerIds?: string[]; minBakiye?: number }) {
    const preview = await this.tahsilatHatirlatmaPreview(tenantId, body);
    const templateName = process.env.WHATSAPP_COLLECTION_TEMPLATE_NAME || process.env.WHATSAPP_TEMPLATE_NAME || undefined;
    const results: any[] = [];

    for (const row of preview.rows.filter((r: any) => r.gonderilebilir)) {
      const ok = await this.whatsApp.sendTemplate(row.phone, row.templateParameters, templateName, tenantId);
      await (this.prisma as any).communicationLog.create({
        data: {
          taxpayerId: row.taxpayerId,
          channel: 'WHATSAPP',
          subject: `Tahsilat hatırlatma - ${preview.donem} - ${ok ? 'Gönderildi' : 'Başarısız'}`,
          content: row.mesaj,
          occurredAt: new Date(),
        },
      });
      results.push({ taxpayerId: row.taxpayerId, ad: row.ad, phone: row.phone, ok });
    }

    return {
      ...preview,
      results,
      basarili: results.filter((r) => r.ok).length,
      basarisiz: results.filter((r) => !r.ok).length,
    };
  }

  // ==================== OFIS BUTCE TAKIBI ====================

  async ensureBudgetCategories(tenantId: string) {
    const existing = await (this.prisma as any).officeBudgetCategory.findMany({
      where: { tenantId },
      select: { name: true, type: true },
    });
    const existingKeys = new Set(existing.map((c: any) => `${c.type}:${c.name}`));
    const missing = this.defaultBudgetCategories
      .filter((c) => !existingKeys.has(`${c.type}:${c.name}`))
      .map((c) => ({ ...c, tenantId }));

    if (missing.length) {
      await (this.prisma as any).officeBudgetCategory.createMany({
        data: missing,
        skipDuplicates: true,
      });
    }

    return (this.prisma as any).officeBudgetCategory.findMany({
      where: { tenantId },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async ensureFinancialAccounts(tenantId: string) {
    const existing = await (this.prisma as any).officeFinancialAccount.findMany({
      where: { tenantId },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((a: any) => a.name));
    const missing = this.defaultFinancialAccounts
      .filter((a) => !existingNames.has(a.name))
      .map((a) => ({
        ...a,
        tenantId,
        openingBalance: 0,
        openingDate: new Date(),
        isActive: true,
      }));

    if (missing.length) {
      await (this.prisma as any).officeFinancialAccount.createMany({
        data: missing,
        skipDuplicates: true,
      });
    }

    return (this.prisma as any).officeFinancialAccount.findMany({
      where: { tenantId },
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async listFinancialAccounts(tenantId: string, includeInactive = false) {
    await this.ensureFinancialAccounts(tenantId);
    return (this.prisma as any).officeFinancialAccount.findMany({
      where: includeInactive ? { tenantId } : { tenantId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  private async getFinancialAccount(tenantId: string, accountId: string) {
    const account = await (this.prisma as any).officeFinancialAccount.findFirst({
      where: { tenantId, id: accountId },
    });
    if (!account) throw new NotFoundException('Hesap bulunamadi');
    return account;
  }

  async createFinancialAccount(tenantId: string, data: any) {
    const name = String(data?.name || '').trim();
    if (!name) throw new BadRequestException('Hesap adi zorunlu');
    const openingDate = data?.openingDate ? new Date(data.openingDate) : new Date();
    if (Number.isNaN(openingDate.getTime())) throw new BadRequestException('Acilis tarihi gecersiz');
    return (this.prisma as any).officeFinancialAccount.create({
      data: {
        tenantId,
        name,
        type: this.normalizeAccountType(data?.type),
        color: data?.color || '#d4b876',
        openingBalance: Number(data?.openingBalance || 0),
        openingDate,
        sortOrder: Number(data?.sortOrder || 100),
        isActive: data?.isActive !== false,
      },
    });
  }

  async updateFinancialAccount(tenantId: string, id: string, data: any) {
    await this.getFinancialAccount(tenantId, id);
    const update: any = {};
    if (data?.name != null) {
      const name = String(data.name).trim();
      if (!name) throw new BadRequestException('Hesap adi zorunlu');
      update.name = name;
    }
    if (data?.type != null) update.type = this.normalizeAccountType(data.type);
    if (data?.color != null) update.color = data.color;
    if (data?.openingBalance != null) update.openingBalance = Number(data.openingBalance);
    if (data?.openingDate != null) {
      const openingDate = new Date(data.openingDate);
      if (Number.isNaN(openingDate.getTime())) throw new BadRequestException('Acilis tarihi gecersiz');
      update.openingDate = openingDate;
    }
    if (data?.sortOrder != null) update.sortOrder = Number(data.sortOrder);
    if (data?.isActive != null) update.isActive = Boolean(data.isActive);
    return (this.prisma as any).officeFinancialAccount.update({ where: { id }, data: update });
  }

  async deleteFinancialAccount(tenantId: string, id: string) {
    await this.getFinancialAccount(tenantId, id);
    return (this.prisma as any).officeFinancialAccount.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async createAccountTransfer(tenantId: string, data: any, createdBy?: string) {
    if (!data?.fromAccountId || !data?.toAccountId) throw new BadRequestException('Cikis ve giris hesabi zorunlu');
    if (data.fromAccountId === data.toAccountId) throw new BadRequestException('Ayni hesaplar arasinda transfer yapilamaz');
    const amount = Number(data?.amount || 0);
    if (amount <= 0) throw new BadRequestException('Transfer tutari pozitif olmali');
    const date = data?.date ? new Date(data.date) : new Date();
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Tarih gecersiz');
    await this.getFinancialAccount(tenantId, data.fromAccountId);
    await this.getFinancialAccount(tenantId, data.toAccountId);
    return (this.prisma as any).officeAccountTransfer.create({
      data: {
        tenantId,
        fromAccountId: data.fromAccountId,
        toAccountId: data.toAccountId,
        date,
        period: this.periodFromDate(date),
        amount,
        description: data?.description?.trim() || null,
        documentNo: data?.documentNo?.trim() || null,
        createdBy: createdBy || null,
      },
      include: {
        fromAccount: { select: { id: true, name: true, type: true, color: true } },
        toAccount: { select: { id: true, name: true, type: true, color: true } },
      },
    });
  }

  async deleteAccountTransfer(tenantId: string, id: string) {
    const transfer = await (this.prisma as any).officeAccountTransfer.findFirst({ where: { tenantId, id } });
    if (!transfer) throw new NotFoundException('Transfer bulunamadi');
    return (this.prisma as any).officeAccountTransfer.delete({ where: { id } });
  }

  async listBudgetCategories(tenantId: string, includeInactive = false) {
    await this.ensureBudgetCategories(tenantId);
    return (this.prisma as any).officeBudgetCategory.findMany({
      where: includeInactive ? { tenantId } : { tenantId, isActive: true },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createBudgetCategory(tenantId: string, data: any) {
    const name = String(data?.name || '').trim();
    if (!name) throw new BadRequestException('Kategori adı zorunlu');
    const type = this.normalizeBudgetType(data?.type);
    return (this.prisma as any).officeBudgetCategory.create({
      data: {
        tenantId,
        name,
        type,
        color: data?.color || (type === 'GELIR' ? '#4ade80' : '#ef4444'),
        icon: data?.icon || null,
        sortOrder: Number(data?.sortOrder || 100),
        isActive: data?.isActive !== false,
      },
    });
  }

  private async getBudgetCategory(tenantId: string, categoryId: string) {
    const category = await (this.prisma as any).officeBudgetCategory.findFirst({
      where: { tenantId, id: categoryId },
    });
    if (!category) throw new NotFoundException('Bütçe kategorisi bulunamadı');
    return category;
  }

  async updateBudgetCategory(tenantId: string, id: string, data: any) {
    await this.getBudgetCategory(tenantId, id);
    const update: any = {};
    if (data?.name != null) update.name = String(data.name).trim();
    if (data?.color != null) update.color = data.color;
    if (data?.icon !== undefined) update.icon = data.icon || null;
    if (data?.sortOrder != null) update.sortOrder = Number(data.sortOrder);
    if (data?.isActive != null) update.isActive = Boolean(data.isActive);
    return (this.prisma as any).officeBudgetCategory.update({ where: { id }, data: update });
  }

  async deleteBudgetCategory(tenantId: string, id: string) {
    await this.getBudgetCategory(tenantId, id);
    return (this.prisma as any).officeBudgetCategory.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async listBudgetEntries(tenantId: string, params: { period?: string; type?: string }) {
    await this.ensureBudgetCategories(tenantId);
    await this.ensureFinancialAccounts(tenantId);
    const where: any = { tenantId, period: this.normalizePeriod(params.period) };
    if (params.type) where.type = this.normalizeBudgetType(params.type);
    return (this.prisma as any).officeBudgetEntry.findMany({
      where,
      include: { category: true, account: true },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createBudgetEntry(tenantId: string, data: any, createdBy?: string) {
    const category = await this.getBudgetCategory(tenantId, data?.categoryId);
    if (!data?.accountId) throw new BadRequestException('Hesap secimi zorunlu');
    const account = await this.getFinancialAccount(tenantId, data.accountId);
    const amount = Number(data?.amount || 0);
    if (amount <= 0) throw new BadRequestException('Tutar pozitif olmalı');
    const date = data?.date ? new Date(data.date) : new Date();
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Tarih geçersiz');
    return (this.prisma as any).officeBudgetEntry.create({
      data: {
        tenantId,
        categoryId: category.id,
        accountId: account.id,
        date,
        period: this.periodFromDate(date),
        type: category.type,
        amount,
        description: data?.description?.trim() || null,
        paymentMethod: data?.paymentMethod || null,
        documentNo: data?.documentNo?.trim() || null,
        isRecurring: Boolean(data?.isRecurring),
        createdBy: createdBy || null,
      },
      include: { category: true, account: true },
    });
  }

  async updateBudgetEntry(tenantId: string, id: string, data: any) {
    const entry = await (this.prisma as any).officeBudgetEntry.findFirst({ where: { tenantId, id } });
    if (!entry) throw new NotFoundException('Bütçe hareketi bulunamadı');
    const update: any = {};
    if (data?.categoryId) {
      const category = await this.getBudgetCategory(tenantId, data.categoryId);
      update.categoryId = category.id;
      update.type = category.type;
    }
    if (data?.accountId !== undefined) {
      if (!data.accountId) throw new BadRequestException('Hesap secimi zorunlu');
      const account = await this.getFinancialAccount(tenantId, data.accountId);
      update.accountId = account.id;
    }
    if (data?.date) {
      const date = new Date(data.date);
      if (Number.isNaN(date.getTime())) throw new BadRequestException('Tarih geçersiz');
      update.date = date;
      update.period = this.periodFromDate(date);
    }
    if (data?.amount != null) {
      const amount = Number(data.amount);
      if (amount <= 0) throw new BadRequestException('Tutar pozitif olmalı');
      update.amount = amount;
    }
    if (data?.description !== undefined) update.description = data.description?.trim() || null;
    if (data?.paymentMethod !== undefined) update.paymentMethod = data.paymentMethod || null;
    if (data?.documentNo !== undefined) update.documentNo = data.documentNo?.trim() || null;
    if (data?.isRecurring !== undefined) update.isRecurring = Boolean(data.isRecurring);

    return (this.prisma as any).officeBudgetEntry.update({
      where: { id },
      data: update,
      include: { category: true, account: true },
    });
  }

  async deleteBudgetEntry(tenantId: string, id: string) {
    const entry = await (this.prisma as any).officeBudgetEntry.findFirst({ where: { tenantId, id } });
    if (!entry) throw new NotFoundException('Bütçe hareketi bulunamadı');
    return (this.prisma as any).officeBudgetEntry.delete({ where: { id } });
  }

  async listBudgetPlans(tenantId: string, period?: string) {
    await this.ensureBudgetCategories(tenantId);
    return (this.prisma as any).officeBudgetPlan.findMany({
      where: { tenantId, period: this.normalizePeriod(period) },
      include: { category: true },
      orderBy: [{ category: { type: 'asc' } }, { category: { sortOrder: 'asc' } }],
    });
  }

  async upsertBudgetPlans(tenantId: string, data: any) {
    await this.ensureBudgetCategories(tenantId);
    const period = this.normalizePeriod(data?.period);
    const items = Array.isArray(data?.items) ? data.items : [data];
    const results: any[] = [];

    for (const item of items) {
      if (!item?.categoryId) continue;
      const category = await this.getBudgetCategory(tenantId, item.categoryId);
      const plannedAmount = Math.max(0, Number(item.plannedAmount || 0));
      results.push(await (this.prisma as any).officeBudgetPlan.upsert({
        where: {
          tenantId_categoryId_period: {
            tenantId,
            categoryId: category.id,
            period,
          },
        },
        update: {
          plannedAmount,
          notes: item.notes?.trim() || null,
        },
        create: {
          tenantId,
          categoryId: category.id,
          period,
          plannedAmount,
          notes: item.notes?.trim() || null,
        },
      }));
    }

    return { period, count: results.length, items: results };
  }

  async budgetSummary(tenantId: string, params: { year?: string | number; period?: string }) {
    const rawYear = Number(params.year || new Date().getFullYear());
    const year = rawYear >= 2000 && rawYear <= 2100 ? rawYear : new Date().getFullYear();
    const period = this.normalizePeriod(params.period || `${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}`);
    const categories = await this.ensureBudgetCategories(tenantId);
    const accounts = await this.ensureFinancialAccounts(tenantId);
    const categoryMap = new Map<string, any>(categories.map((c: any) => [c.id, c]));
    const customerIncomeCategory = categories.find((c: any) => c.type === 'GELIR' && c.name === 'Müşteri Tahsilatı')
      || categories.find((c: any) => c.type === 'GELIR');

    const months = this.yearMonths(year).map((ay) => ({
      period: ay,
      label: `${ay.slice(5, 7)}/${ay.slice(2, 4)}`,
      income: 0,
      expense: 0,
      net: 0,
      plannedIncome: 0,
      plannedExpense: 0,
      plannedNet: 0,
      variance: 0,
    }));
    const monthMap = new Map(months.map((m) => [m.period, m]));
    const selectedTotals = new Map<string, { actual: number; planned: number }>();
    const annualTotals = new Map<string, { actual: number; planned: number }>();
    const categoryMonthlyTotals = new Map<string, Map<string, { actual: number; planned: number }>>();
    for (const c of categories) {
      selectedTotals.set(c.id, { actual: 0, planned: 0 });
      annualTotals.set(c.id, { actual: 0, planned: 0 });
      categoryMonthlyTotals.set(c.id, new Map(months.map((m) => [m.period, { actual: 0, planned: 0 }])));
    }

    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));
    const [entries, plans, cariTahsilatlar] = await Promise.all([
      (this.prisma as any).officeBudgetEntry.findMany({
        where: { tenantId, date: { gte: start, lt: end } },
        include: { category: true, account: true },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      }),
      (this.prisma as any).officeBudgetPlan.findMany({
        where: { tenantId, period: { gte: `${year}-01`, lte: `${year}-12` } },
        include: { category: true },
      }),
      (this.prisma as any).cariHareket.findMany({
        where: { tenantId, tip: 'TAHSILAT', tarih: { gte: start, lt: end } },
        select: {
          id: true,
          tarih: true,
          tutar: true,
          odemeYontemi: true,
          belgeNo: true,
          aciklama: true,
          accountId: true,
          account: { select: { id: true, name: true, type: true, color: true } },
          taxpayer: { select: { firstName: true, lastName: true, companyName: true, taxNumber: true } },
        },
        orderBy: [{ tarih: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);

    const addActual = (categoryId: string | null, entryPeriod: string, type: string, amount: number) => {
      const month = monthMap.get(entryPeriod);
      if (!month) return;
      if (type === 'GELIR') month.income = this.roundMoney(month.income + amount);
      else month.expense = this.roundMoney(month.expense + amount);
      if (categoryId) {
        const annual = annualTotals.get(categoryId) || { actual: 0, planned: 0 };
        annual.actual = this.roundMoney(annual.actual + amount);
        annualTotals.set(categoryId, annual);
        const monthly = categoryMonthlyTotals.get(categoryId)?.get(entryPeriod);
        if (monthly) monthly.actual = this.roundMoney(monthly.actual + amount);
        if (entryPeriod === period) {
          const selected = selectedTotals.get(categoryId) || { actual: 0, planned: 0 };
          selected.actual = this.roundMoney(selected.actual + amount);
          selectedTotals.set(categoryId, selected);
        }
      }
    };

    const addPlan = (categoryId: string, planPeriod: string, type: string, amount: number) => {
      const month = monthMap.get(planPeriod);
      if (!month) return;
      if (type === 'GELIR') month.plannedIncome = this.roundMoney(month.plannedIncome + amount);
      else month.plannedExpense = this.roundMoney(month.plannedExpense + amount);
      const annual = annualTotals.get(categoryId) || { actual: 0, planned: 0 };
      annual.planned = this.roundMoney(annual.planned + amount);
      annualTotals.set(categoryId, annual);
      const monthly = categoryMonthlyTotals.get(categoryId)?.get(planPeriod);
      if (monthly) monthly.planned = this.roundMoney(monthly.planned + amount);
      if (planPeriod === period) {
        const selected = selectedTotals.get(categoryId) || { actual: 0, planned: 0 };
        selected.planned = this.roundMoney(selected.planned + amount);
        selectedTotals.set(categoryId, selected);
      }
    };

    for (const entry of entries) {
      addActual(entry.categoryId, entry.period, entry.type, Number(entry.amount));
    }
    if (customerIncomeCategory) {
      for (const h of cariTahsilatlar) {
        addActual(customerIncomeCategory.id, this.periodFromDate(new Date(h.tarih)), 'GELIR', Number(h.tutar));
      }
    }
    for (const plan of plans) {
      const category = categoryMap.get(plan.categoryId);
      if (!category) continue;
      addPlan(plan.categoryId, plan.period, category.type, Number(plan.plannedAmount));
    }

    for (const month of months) {
      month.net = this.roundMoney(month.income - month.expense);
      month.plannedNet = this.roundMoney(month.plannedIncome - month.plannedExpense);
      month.variance = this.roundMoney(month.net - month.plannedNet);
    }

    const selectedMonth = monthMap.get(period) || months[0];
    const annualIncome = this.roundMoney(months.reduce((s, m) => s + m.income, 0));
    const annualExpense = this.roundMoney(months.reduce((s, m) => s + m.expense, 0));
    const annualPlannedIncome = this.roundMoney(months.reduce((s, m) => s + m.plannedIncome, 0));
    const annualPlannedExpense = this.roundMoney(months.reduce((s, m) => s + m.plannedExpense, 0));

    const categoryRows = categories
      .map((category: any) => {
        const selected = selectedTotals.get(category.id) || { actual: 0, planned: 0 };
        const annual = annualTotals.get(category.id) || { actual: 0, planned: 0 };
        const variance = category.type === 'GIDER'
          ? this.roundMoney(selected.planned - selected.actual)
          : this.roundMoney(selected.actual - selected.planned);
        const realizationPct = selected.planned > 0
          ? Math.round((selected.actual / selected.planned) * 1000) / 10
          : selected.actual > 0 ? 100 : 0;
        return {
          categoryId: category.id,
          name: category.name,
          type: category.type,
          color: category.color,
          icon: category.icon,
          isActive: category.isActive,
          planned: this.roundMoney(selected.planned),
          actual: this.roundMoney(selected.actual),
          variance,
          realizationPct,
          annualActual: this.roundMoney(annual.actual),
          annualPlanned: this.roundMoney(annual.planned),
        };
      })
      .filter((r: any) => r.isActive || r.actual || r.planned || r.annualActual || r.annualPlanned);

    const selectedEntries = entries
      .filter((e: any) => e.period === period)
      .map((e: any) => ({
        id: e.id,
        source: e.source || 'MANUAL',
        date: e.date,
        period: e.period,
        type: e.type,
        amount: Number(e.amount),
        description: e.description,
        paymentMethod: e.paymentMethod,
        documentNo: e.documentNo,
        account: e.account ? {
          id: e.account.id,
          name: e.account.name,
          type: e.account.type,
          color: e.account.color,
        } : null,
        category: e.category ? {
          id: e.category.id,
          name: e.category.name,
          color: e.category.color,
          type: e.category.type,
        } : null,
      }));

    const customerCollections = cariTahsilatlar
      .filter((h: any) => this.periodFromDate(new Date(h.tarih)) === period)
      .slice(0, 50)
      .map((h: any) => ({
        id: h.id,
        source: 'CARI_TAHSILAT',
        date: h.tarih,
        period,
        type: 'GELIR',
        amount: Number(h.tutar),
        description: this.taxpayerName(h.taxpayer) || h.aciklama || 'Müşteri tahsilatı',
        paymentMethod: h.odemeYontemi,
        documentNo: h.belgeNo,
        account: h.account ? {
          id: h.account.id,
          name: h.account.name,
          type: h.account.type,
          color: h.account.color,
        } : null,
        category: customerIncomeCategory ? {
          id: customerIncomeCategory.id,
          name: customerIncomeCategory.name,
          color: customerIncomeCategory.color,
          type: customerIncomeCategory.type,
        } : null,
      }));

    const categoryMonthlyRows = categoryRows.map((row: any) => {
      const perMonth = categoryMonthlyTotals.get(row.categoryId);
      return {
        ...row,
        months: months.map((m) => {
          const totals = perMonth?.get(m.period) || { actual: 0, planned: 0 };
          const variance = row.type === 'GIDER'
            ? this.roundMoney(totals.planned - totals.actual)
            : this.roundMoney(totals.actual - totals.planned);
          return {
            period: m.period,
            label: m.label,
            actual: this.roundMoney(totals.actual),
            planned: this.roundMoney(totals.planned),
            variance,
          };
        }),
      };
    });

    const unassignedCollectionsCount = cariTahsilatlar.filter((h: any) => !h.accountId).length;
    const unassignedCollectionsAmount = this.roundMoney(
      cariTahsilatlar.reduce((sum: number, h: any) => sum + (!h.accountId ? Number(h.tutar) : 0), 0),
    );

    return {
      year,
      period,
      categories,
      accounts,
      months,
      categoryRows,
      categoryMonthlyRows,
      entries: [...selectedEntries, ...customerCollections]
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()),
      unassignedCollections: {
        count: unassignedCollectionsCount,
        amount: unassignedCollectionsAmount,
      },
      kpi: {
        periodIncome: this.roundMoney(selectedMonth.income),
        periodExpense: this.roundMoney(selectedMonth.expense),
        periodNet: this.roundMoney(selectedMonth.net),
        periodPlannedIncome: this.roundMoney(selectedMonth.plannedIncome),
        periodPlannedExpense: this.roundMoney(selectedMonth.plannedExpense),
        periodPlannedNet: this.roundMoney(selectedMonth.plannedNet),
        periodVariance: this.roundMoney(selectedMonth.variance),
        annualIncome,
        annualExpense,
        annualNet: this.roundMoney(annualIncome - annualExpense),
        annualPlannedIncome,
        annualPlannedExpense,
        annualPlannedNet: this.roundMoney(annualPlannedIncome - annualPlannedExpense),
      },
    };
  }

  // ==================== İSTATİSTİKLER ====================
  //
  // Son 12 aylık tahakkuk/tahsilat trendi + en borçlu 10 + en çok tahsilat + KPI'lar.
  async cashflowSummary(tenantId: string, params: { year?: string | number; period?: string }) {
    const rawYear = Number(params.year || new Date().getFullYear());
    const year = rawYear >= 2000 && rawYear <= 2100 ? rawYear : new Date().getFullYear();
    const period = this.normalizePeriod(params.period || `${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}`);
    const months = this.yearMonths(year).map((ay) => ({
      period: ay,
      label: `${ay.slice(5, 7)}/${ay.slice(2, 4)}`,
      income: 0,
      expense: 0,
      transferIn: 0,
      transferOut: 0,
      net: 0,
    }));
    const monthMap = new Map(months.map((m) => [m.period, m]));

    const [accounts, entries, collections, transfers] = await Promise.all([
      this.ensureFinancialAccounts(tenantId),
      (this.prisma as any).officeBudgetEntry.findMany({
        where: { tenantId },
        include: {
          category: true,
          account: { select: { id: true, name: true, type: true, color: true } },
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      }),
      (this.prisma as any).cariHareket.findMany({
        where: { tenantId, tip: 'TAHSILAT' },
        select: {
          id: true,
          accountId: true,
          tarih: true,
          tutar: true,
          odemeYontemi: true,
          belgeNo: true,
          aciklama: true,
          account: { select: { id: true, name: true, type: true, color: true } },
          taxpayer: { select: { firstName: true, lastName: true, companyName: true, taxNumber: true } },
        },
        orderBy: [{ tarih: 'desc' }, { createdAt: 'desc' }],
      }),
      (this.prisma as any).officeAccountTransfer.findMany({
        where: { tenantId },
        include: {
          fromAccount: { select: { id: true, name: true, type: true, color: true } },
          toAccount: { select: { id: true, name: true, type: true, color: true } },
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);

    const accountStats = new Map<string, any>();
    for (const account of accounts) {
      accountStats.set(account.id, {
        id: account.id,
        name: account.name,
        type: account.type,
        color: account.color,
        openingBalance: Number(account.openingBalance || 0),
        openingDate: account.openingDate,
        sortOrder: account.sortOrder,
        isActive: account.isActive,
        currentBalance: Number(account.openingBalance || 0),
        monthInflow: 0,
        monthOutflow: 0,
        monthIncome: 0,
        monthExpense: 0,
        monthTransferIn: 0,
        monthTransferOut: 0,
        monthNet: 0,
      });
    }

    const selectedEntries: any[] = [];
    const addMonthBusiness = (entryPeriod: string, type: string, amount: number) => {
      const row = monthMap.get(entryPeriod);
      if (!row) return;
      if (type === 'GELIR') row.income = this.roundMoney(row.income + amount);
      else row.expense = this.roundMoney(row.expense + amount);
    };
    const addMonthTransfer = (entryPeriod: string, amount: number) => {
      const row = monthMap.get(entryPeriod);
      if (!row) return;
      row.transferIn = this.roundMoney(row.transferIn + amount);
      row.transferOut = this.roundMoney(row.transferOut + amount);
    };

    for (const entry of entries) {
      const amount = Number(entry.amount || 0);
      const stat = entry.accountId ? accountStats.get(entry.accountId) : null;
      if (stat) {
        if (entry.type === 'GELIR') stat.currentBalance = this.roundMoney(stat.currentBalance + amount);
        else stat.currentBalance = this.roundMoney(stat.currentBalance - amount);
        if (entry.period === period) {
          if (entry.type === 'GELIR') {
            stat.monthInflow = this.roundMoney(stat.monthInflow + amount);
            stat.monthIncome = this.roundMoney(stat.monthIncome + amount);
          } else {
            stat.monthOutflow = this.roundMoney(stat.monthOutflow + amount);
            stat.monthExpense = this.roundMoney(stat.monthExpense + amount);
          }
        }
      }
      addMonthBusiness(entry.period, entry.type, amount);
      if (entry.period === period) {
        selectedEntries.push({
          id: entry.id,
          source: 'MANUAL',
          date: entry.date,
          period: entry.period,
          type: entry.type,
          amount,
          description: entry.description,
          paymentMethod: entry.paymentMethod,
          documentNo: entry.documentNo,
          account: entry.account,
          category: entry.category ? {
            id: entry.category.id,
            name: entry.category.name,
            type: entry.category.type,
            color: entry.category.color,
          } : null,
        });
      }
    }

    let unassignedCollectionsCount = 0;
    let unassignedCollectionsAmount = 0;
    for (const h of collections) {
      const amount = Number(h.tutar || 0);
      const hPeriod = this.periodFromDate(new Date(h.tarih));
      const stat = h.accountId ? accountStats.get(h.accountId) : null;
      if (stat) {
        stat.currentBalance = this.roundMoney(stat.currentBalance + amount);
        if (hPeriod === period) {
          stat.monthInflow = this.roundMoney(stat.monthInflow + amount);
          stat.monthIncome = this.roundMoney(stat.monthIncome + amount);
        }
      } else {
        unassignedCollectionsCount++;
        unassignedCollectionsAmount = this.roundMoney(unassignedCollectionsAmount + amount);
      }
      addMonthBusiness(hPeriod, 'GELIR', amount);
      if (hPeriod === period) {
        selectedEntries.push({
          id: h.id,
          source: 'CARI_TAHSILAT',
          date: h.tarih,
          period: hPeriod,
          type: 'GELIR',
          amount,
          description: this.taxpayerName(h.taxpayer) || h.aciklama || 'Musteri tahsilati',
          paymentMethod: h.odemeYontemi,
          documentNo: h.belgeNo,
          account: h.account || null,
          category: null,
        });
      }
    }

    const selectedTransfers: any[] = [];
    for (const transfer of transfers) {
      const amount = Number(transfer.amount || 0);
      const fromStat = accountStats.get(transfer.fromAccountId);
      const toStat = accountStats.get(transfer.toAccountId);
      if (fromStat) fromStat.currentBalance = this.roundMoney(fromStat.currentBalance - amount);
      if (toStat) toStat.currentBalance = this.roundMoney(toStat.currentBalance + amount);
      if (transfer.period === period) {
        if (fromStat) {
          fromStat.monthOutflow = this.roundMoney(fromStat.monthOutflow + amount);
          fromStat.monthTransferOut = this.roundMoney(fromStat.monthTransferOut + amount);
        }
        if (toStat) {
          toStat.monthInflow = this.roundMoney(toStat.monthInflow + amount);
          toStat.monthTransferIn = this.roundMoney(toStat.monthTransferIn + amount);
        }
      }
      addMonthTransfer(transfer.period, amount);
      if (transfer.period === period) {
        selectedTransfers.push({
          id: transfer.id,
          source: 'TRANSFER',
          date: transfer.date,
          period: transfer.period,
          amount,
          description: transfer.description,
          documentNo: transfer.documentNo,
          fromAccount: transfer.fromAccount,
          toAccount: transfer.toAccount,
        });
      }
    }

    for (const month of months) month.net = this.roundMoney(month.income - month.expense);
    for (const stat of accountStats.values()) {
      stat.monthNet = this.roundMoney(stat.monthInflow - stat.monthOutflow);
      stat.currentBalance = this.roundMoney(stat.currentBalance);
    }

    const accountRows = Array.from(accountStats.values())
      .filter((a: any) => a.isActive || a.currentBalance || a.monthInflow || a.monthOutflow)
      .sort((a: any, b: any) => (a.sortOrder - b.sortOrder) || String(a.name).localeCompare(String(b.name), 'tr'));
    const selectedMonth = monthMap.get(period) || months[0];

    return {
      year,
      period,
      accounts: accountRows,
      months,
      recentEntries: selectedEntries
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 75),
      transfers: selectedTransfers,
      kpi: {
        totalBalance: this.roundMoney(accountRows.reduce((sum: number, a: any) => sum + a.currentBalance, 0)),
        monthIncome: this.roundMoney(selectedMonth.income),
        monthExpense: this.roundMoney(selectedMonth.expense),
        monthNet: this.roundMoney(selectedMonth.net),
        monthInflow: this.roundMoney(accountRows.reduce((sum: number, a: any) => sum + a.monthInflow, 0)),
        monthOutflow: this.roundMoney(accountRows.reduce((sum: number, a: any) => sum + a.monthOutflow, 0)),
        unassignedCollectionsCount,
        unassignedCollectionsAmount: this.roundMoney(unassignedCollectionsAmount),
      },
    };
  }

  async istatistikler(tenantId: string) {
    const now = new Date();
    const onIkiAyOnce = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const hareketler = await (this.prisma as any).cariHareket.findMany({
      where: { tenantId, tarih: { gte: onIkiAyOnce } },
      select: { tip: true, tutar: true, tarih: true, taxpayerId: true, odemeYontemi: true, donem: true },
    });

    // Aylık trend (son 12 ay)
    const aylar: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      aylar.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const trend = aylar.map((ay) => ({
      ay,
      tahakkuk: 0,
      tahsilat: 0,
    }));
    const trendMap = new Map(trend.map((t) => [t.ay, t]));
    for (const h of hareketler) {
      const d = new Date(h.tarih);
      const ay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const row = trendMap.get(ay);
      if (!row) continue;
      const v = Number(h.tutar);
      if (h.tip === 'TAHAKKUK') row.tahakkuk += v;
      else if (h.tip === 'TAHSILAT') row.tahsilat += v;
    }

    // Ödeme yöntemi dağılımı (tahsilatlar)
    const odemeYontemMap = new Map<string, number>();
    for (const h of hareketler) {
      if (h.tip !== 'TAHSILAT') continue;
      const k = h.odemeYontemi || 'BELIRTILMEMIS';
      odemeYontemMap.set(k, (odemeYontemMap.get(k) || 0) + Number(h.tutar));
    }
    const odemeYontemi = Array.from(odemeYontemMap.entries())
      .map(([k, v]) => ({ yontem: k, tutar: Math.round(v * 100) / 100 }))
      .sort((a, b) => b.tutar - a.tutar);

    // En borçlu 10 mükellef (tüm zamanlar)
    const ozet = await this.genelOzet(tenantId);
    const enBorclular = ozet.filter((o: any) => o.bakiye > 0).slice(0, 10);

    // KPI — son 12 ayın toplamları
    const toplamTahakkuk = trend.reduce((s, t) => s + t.tahakkuk, 0);
    const toplamTahsilat = trend.reduce((s, t) => s + t.tahsilat, 0);
    const buAy = trend[trend.length - 1];
    const gecenAy = trend[trend.length - 2];

    // Bu ayki hedef (aktif aylık hizmetlerin toplamı)
    const aktifAylikHizmetler = await (this.prisma as any).cariHizmet.findMany({
      where: { tenantId, aktif: true, periyot: 'AYLIK' },
      select: { tutar: true },
    });
    const aylikHedef = aktifAylikHizmetler.reduce(
      (s: number, h: any) => s + Number(h.tutar),
      0,
    );

    // Tahsilat oranı (son 12 ay)
    const tahsilatOrani = toplamTahakkuk > 0
      ? Math.round((toplamTahsilat / toplamTahakkuk) * 10000) / 100
      : 0;

    return {
      kpi: {
        aylikHedef: Math.round(aylikHedef * 100) / 100,
        buAyTahakkuk: Math.round(buAy.tahakkuk * 100) / 100,
        buAyTahsilat: Math.round(buAy.tahsilat * 100) / 100,
        gecenAyTahsilat: Math.round(gecenAy.tahsilat * 100) / 100,
        toplamTahakkuk12Ay: Math.round(toplamTahakkuk * 100) / 100,
        toplamTahsilat12Ay: Math.round(toplamTahsilat * 100) / 100,
        tahsilatOrani, // %
        toplamAktifBorc: ozet.reduce((s: number, o: any) => s + (o.bakiye > 0 ? o.bakiye : 0), 0),
        borcluMukellefAdet: ozet.filter((o: any) => o.bakiye > 0).length,
      },
      trend: trend.map((t) => ({
        ay: t.ay,
        tahakkuk: Math.round(t.tahakkuk * 100) / 100,
        tahsilat: Math.round(t.tahsilat * 100) / 100,
      })),
      odemeYontemi,
      enBorclular: enBorclular.map((o: any) => ({
        id: o.id,
        ad: o.ad,
        taxNumber: o.taxNumber,
        bakiye: o.bakiye,
      })),
    };
  }
}
