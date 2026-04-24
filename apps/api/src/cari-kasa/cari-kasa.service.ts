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

  // ==================== İSTATİSTİKLER ====================
  //
  // Son 12 aylık tahakkuk/tahsilat trendi + en borçlu 10 + en çok tahsilat + KPI'lar.
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
