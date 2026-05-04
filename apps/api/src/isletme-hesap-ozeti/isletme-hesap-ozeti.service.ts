import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * İşletme Hesap Özeti — TAMAMI MANUEL.
 *
 * İşletme defteri tutan (2.sınıf tüccar / basit usul) mükellefler için her çeyrek (Q1-Q4)
 * ayrı kayıt. Hiçbir alan otomatik çekilmez — kullanıcı el ile girer.
 *
 * Tek otomatik bağ: Q2-Q4 dönem başı stoğu, önceki çeyreğin kalan stoğunu kullanır
 * (kullanıcı isterse override edebilir).
 *
 * Hesaplanan alanlar:
 *   - toplamStok          = donemBasiStok + malAlisi
 *   - satilanMalMaliyeti  = toplamStok - kalanStok
 *   - netSatislar         = satisHasilati - satilanMalMaliyeti
 *   - donemKari           = netSatislar - donemIciGiderler
 *   - gecVergiMatrahi     = max(0, donemKari - gecmisYilZarari)
 *   - hesaplananGecVergi  = gecVergiMatrahi * 0.15
 *   - odenecekGecVergi    = max(0, hesaplananGecVergi - oncekiOdenenGecVergi)
 */
@Injectable()
export class IsletmeHesapOzetiService {
  private readonly logger = new Logger(IsletmeHesapOzetiService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Boş bir çeyrek kaydı oluştur (manuel veri girişine açık) */
  async olustur(params: {
    tenantId: string;
    taxpayerId: string;
    yil: number;
    donem: number; // 1-4
    createdBy?: string;
  }) {
    const { tenantId, taxpayerId, yil, donem, createdBy } = params;
    if (donem < 1 || donem > 4) {
      throw new BadRequestException('Dönem 1-4 arası olmalı (1=Q1, 4=Q4)');
    }

    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
    });
    if (!taxpayer) throw new NotFoundException('Mükellef bulunamadı');

    // Mevcut kayıt varsa onu döndür
    const existing = await (this.prisma as any).isletmeHesapOzeti.findUnique({
      where: { tenantId_taxpayerId_yil_donem: { tenantId, taxpayerId, yil, donem } },
      include: { taxpayer: true },
    });
    if (existing) return existing;

    // Önceki çeyreğin kalan stoğunu dönem başı stok olarak getir (Q1 hariç)
    let donemBasiStok = 0;
    let oncekiOdenenGecVergi = 0;
    if (donem > 1) {
      const oncekiCeyrek = await (this.prisma as any).isletmeHesapOzeti.findUnique({
        where: {
          tenantId_taxpayerId_yil_donem: { tenantId, taxpayerId, yil, donem: donem - 1 },
        },
      });
      if (oncekiCeyrek) {
        donemBasiStok = Number(oncekiCeyrek.kalanStok || 0);
      }
      // Önceki dönemlerde hesaplanan geçici vergilerin toplamı
      const oncekiDonemler = await (this.prisma as any).isletmeHesapOzeti.findMany({
        where: { tenantId, taxpayerId, yil, donem: { lt: donem } },
        select: { hesaplananGecVergi: true },
      });
      oncekiOdenenGecVergi = oncekiDonemler.reduce(
        (acc: number, x: any) => acc + Number(x.hesaplananGecVergi || 0),
        0,
      );
    }

    return (this.prisma as any).isletmeHesapOzeti.create({
      data: {
        tenantId, taxpayerId, yil, donem,
        donemBasiStok,
        oncekiOdenenGecVergi,
        createdBy: createdBy || null,
      },
      include: {
        taxpayer: {
          select: { firstName: true, lastName: true, companyName: true, taxNumber: true },
        },
      },
    });
  }

  /** Q1-Q4 boş kayıtları sırayla oluştur (yıl başlatma) */
  async olusturYil(params: {
    tenantId: string;
    taxpayerId: string;
    yil: number;
    createdBy?: string;
  }) {
    const sonuclar = [] as any[];
    for (const donem of [1, 2, 3, 4]) {
      try {
        const ozet = await this.olustur({ ...params, donem });
        sonuclar.push(ozet);
      } catch (e: any) {
        this.logger.warn(`Q${donem} oluşturulamadı: ${e?.message}`);
      }
    }
    return sonuclar;
  }

  /** Bir mükellef için belirli yılın 4 çeyreğini birden getir (karşılaştırmalı görünüm için) */
  async getYil(tenantId: string, taxpayerId: string, yil: number) {
    const ceyrekler = await (this.prisma as any).isletmeHesapOzeti.findMany({
      where: { tenantId, taxpayerId, yil },
      orderBy: { donem: 'asc' },
      include: {
        taxpayer: {
          select: { firstName: true, lastName: true, companyName: true, taxNumber: true },
        },
      },
    });

    const map: Record<number, any> = {};
    for (const c of ceyrekler) map[c.donem] = c;

    return {
      yil,
      taxpayer: ceyrekler[0]?.taxpayer || null,
      ceyrekler: [1, 2, 3, 4].map((d) => map[d] || null),
    };
  }

  async getOne(tenantId: string, taxpayerId: string, yil: number, donem: number) {
    const ozet = await (this.prisma as any).isletmeHesapOzeti.findUnique({
      where: { tenantId_taxpayerId_yil_donem: { tenantId, taxpayerId, yil, donem } },
      include: {
        taxpayer: {
          select: { firstName: true, lastName: true, companyName: true, taxNumber: true },
        },
      },
    });
    if (!ozet) throw new NotFoundException('Kayıt bulunamadı — önce çeyrek oluştur');
    return ozet;
  }

  async list(tenantId: string, taxpayerId?: string, yil?: number) {
    const where: any = { tenantId };
    if (taxpayerId) where.taxpayerId = taxpayerId;
    if (yil) where.yil = yil;
    return (this.prisma as any).isletmeHesapOzeti.findMany({
      where,
      include: {
        taxpayer: {
          select: { id: true, firstName: true, lastName: true, companyName: true, taxNumber: true },
        },
      },
      orderBy: [{ yil: 'desc' }, { donem: 'desc' }, { updatedAt: 'desc' }],
      take: 400,
    });
  }

  /**
   * Manuel alanları güncelle. Tüm finansal alanlar manueldir:
   * satisHasilati, digerGelir, malAlisi, donemBasiStok (Q1 manuel, Q2-Q4 önceki kalanı default),
   * kalanStok, donemIciGiderler, gecmisYilZarari, oncekiOdenenGecVergi, not.
   * Türetilen alanlar otomatik hesaplanır.
   */
  async updateManuel(params: {
    tenantId: string;
    id: string;
    satisHasilati?: number;
    digerGelir?: number;
    malAlisi?: number;
    donemBasiStok?: number;
    kalanStok?: number;
    satilanMalMaliyeti?: number; // doğrudan girilebilir — kalanStok otomatik hesaplanır
    donemIciGiderler?: number;
    gecmisYilZarari?: number;
    oncekiOdenenGecVergi?: number;
    not?: string;
  }) {
    const ozet = await (this.prisma as any).isletmeHesapOzeti.findFirst({
      where: { id: params.id, tenantId: params.tenantId },
    });
    if (!ozet) throw new NotFoundException('Kayıt bulunamadı');
    if (ozet.locked) {
      throw new BadRequestException('Kesin kayıtta düzeltme yapılamaz');
    }

    const r2 = (n: number) => Math.round(n * 100) / 100;
    const num = (v: any, fallback: number) =>
      typeof v === 'number' ? r2(v) : Number(fallback);

    // Yeni değerleri belirle (gönderilmeyenler mevcut)
    const satisHasilati = num(params.satisHasilati, ozet.satisHasilati);
    const digerGelir = num(params.digerGelir, ozet.digerGelir);
    const malAlisi = num(params.malAlisi, ozet.malAlisi);
    const donemBasiStok = num(params.donemBasiStok, ozet.donemBasiStok);
    const donemIciGiderler = num(params.donemIciGiderler, ozet.donemIciGiderler);
    const gecmisYilZarari = num(params.gecmisYilZarari, ozet.gecmisYilZarari);
    const oncekiOdenenGecVergi = num(params.oncekiOdenenGecVergi, ozet.oncekiOdenenGecVergi);

    const toplamStok = r2(donemBasiStok + malAlisi);

    // SMM ↔ Kalan Stok iki yönlü:
    // - Eğer SMM doğrudan gönderildiyse: kalanStok = toplamStok - SMM
    // - Aksi halde kalanStok'tan SMM hesaplanır (eski davranış)
    let kalanStok: number;
    let satilanMalMaliyeti: number;
    if (typeof params.satilanMalMaliyeti === 'number') {
      satilanMalMaliyeti = r2(params.satilanMalMaliyeti);
      kalanStok = r2(toplamStok - satilanMalMaliyeti);
    } else {
      kalanStok = num(params.kalanStok, ozet.kalanStok);
      satilanMalMaliyeti = r2(toplamStok - kalanStok);
    }

    // Türetilen alanlar (kalan)
    const toplamSatis = r2(satisHasilati + digerGelir);
    const netSatislar = r2(toplamSatis - satilanMalMaliyeti);
    const donemKari = r2(netSatislar - donemIciGiderler);
    const gecVergiMatrahi = Math.max(0, r2(donemKari - gecmisYilZarari));
    const hesaplananGecVergi = r2(gecVergiMatrahi * 0.15);
    const odenecekGecVergi = Math.max(0, r2(hesaplananGecVergi - oncekiOdenenGecVergi));

    const updated = await (this.prisma as any).isletmeHesapOzeti.update({
      where: { id: params.id },
      data: {
        satisHasilati,
        digerGelir,
        malAlisi,
        donemBasiStok,
        kalanStok,
        donemIciGiderler,
        gecmisYilZarari,
        oncekiOdenenGecVergi,
        toplamStok,
        satilanMalMaliyeti,
        netSatislar,
        donemKari,
        gecVergiMatrahi,
        hesaplananGecVergi,
        odenecekGecVergi,
        not: typeof params.not === 'string' ? params.not : ozet.not,
      },
      include: { taxpayer: true },
    });

    // Bu çeyreğin kalan stoğu değiştiyse → sonraki çeyreğin dönem başı stoğunu güncelle
    if (typeof params.kalanStok === 'number' && ozet.donem < 4) {
      const sonraki = await (this.prisma as any).isletmeHesapOzeti.findUnique({
        where: {
          tenantId_taxpayerId_yil_donem: {
            tenantId: params.tenantId,
            taxpayerId: ozet.taxpayerId,
            yil: ozet.yil,
            donem: ozet.donem + 1,
          },
        },
      });
      if (sonraki && !sonraki.locked) {
        await this.updateManuel({
          tenantId: params.tenantId,
          id: sonraki.id,
          donemBasiStok: kalanStok,
        });
      }
    }

    // Bu çeyreğin hesaplananGecVergi değiştiyse → sonraki çeyreğin oncekiOdenenGecVergi'sini güncelle
    if (
      ozet.donem < 4 &&
      Number(updated.hesaplananGecVergi) !== Number(ozet.hesaplananGecVergi)
    ) {
      const sonrakiCeyrekler = await (this.prisma as any).isletmeHesapOzeti.findMany({
        where: {
          tenantId: params.tenantId,
          taxpayerId: ozet.taxpayerId,
          yil: ozet.yil,
          donem: { gt: ozet.donem },
        },
        orderBy: { donem: 'asc' },
      });
      for (const sonraki of sonrakiCeyrekler) {
        if (sonraki.locked) continue;
        // Bu çeyrekten önceki tüm hesaplananGecVergi toplamı
        const onceki = await (this.prisma as any).isletmeHesapOzeti.findMany({
          where: {
            tenantId: params.tenantId,
            taxpayerId: ozet.taxpayerId,
            yil: ozet.yil,
            donem: { lt: sonraki.donem },
          },
          select: { hesaplananGecVergi: true },
        });
        const yeniOnceki = onceki.reduce(
          (acc: number, x: any) => acc + Number(x.hesaplananGecVergi || 0),
          0,
        );
        await this.updateManuel({
          tenantId: params.tenantId,
          id: sonraki.id,
          oncekiOdenenGecVergi: yeniOnceki,
        });
      }
    }

    return updated;
  }

  async lock(tenantId: string, id: string, userId: string, note?: string) {
    const ozet = await (this.prisma as any).isletmeHesapOzeti.findFirst({
      where: { id, tenantId },
    });
    if (!ozet) throw new NotFoundException('Kayıt bulunamadı');
    if (ozet.locked) throw new BadRequestException('Zaten kesin kayıt');
    return (this.prisma as any).isletmeHesapOzeti.update({
      where: { id },
      data: { locked: true, lockedAt: new Date(), lockedBy: userId, lockNote: note || null },
    });
  }

  async unlock(tenantId: string, id: string, userId: string, reason: string) {
    const ozet = await (this.prisma as any).isletmeHesapOzeti.findFirst({
      where: { id, tenantId },
    });
    if (!ozet) throw new NotFoundException('Kayıt bulunamadı');
    if (!ozet.locked) throw new BadRequestException('Kesin kayıt değil');
    return (this.prisma as any).isletmeHesapOzeti.update({
      where: { id },
      data: { locked: false, lockedAt: null, lockedBy: null, lockNote: `[${userId} açtı] ${reason}` },
    });
  }

  async remove(tenantId: string, id: string) {
    const ozet = await (this.prisma as any).isletmeHesapOzeti.findFirst({
      where: { id, tenantId },
    });
    if (!ozet) throw new NotFoundException('Kayıt bulunamadı');
    if (ozet.locked) throw new BadRequestException('Kesin kayıtta silinemez');
    await (this.prisma as any).isletmeHesapOzeti.delete({ where: { id } });
    return { deleted: true };
  }

  /** Excel — Yılın 4 çeyreği yan yana karşılaştırmalı (Q4 → Q1 ters sıra) */
  async exportYilExcel(tenantId: string, taxpayerId: string, yil: number): Promise<Buffer> {
    const ExcelJS = await import('exceljs');
    const yilData = await this.getYil(tenantId, taxpayerId, yil);

    const tp = yilData.taxpayer;
    const mukellefAd =
      (tp as any)?.companyName ||
      [(tp as any)?.firstName, (tp as any)?.lastName].filter(Boolean).join(' ') ||
      '—';

    const wb = new (ExcelJS as any).Workbook();
    const ws = wb.addWorksheet(`İHÖ ${yil}`);

    const tersDonemler = [4, 3, 2, 1];

    ws.columns = [
      { width: 36 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
    ];

    ws.mergeCells('A1:E1');
    ws.getCell('A1').value = 'İŞLETME HESAP ÖZETİ — ÇEYREKLİK KARŞILAŞTIRMA';
    ws.getCell('A1').font = { size: 14, bold: true };
    ws.getCell('A1').alignment = { horizontal: 'center' };

    ws.mergeCells('A2:E2');
    ws.getCell('A2').value = `${mukellefAd} · ${yil} Yılı`;
    ws.getCell('A2').alignment = { horizontal: 'center' };

    let row = 4;
    ws.getCell(`A${row}`).value = 'AÇIKLAMA';
    ws.getCell(`A${row}`).font = { bold: true };
    ws.getCell(`A${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    tersDonemler.forEach((d, i) => {
      const col = String.fromCharCode(66 + i);
      ws.getCell(`${col}${row}`).value = `${yil}-Q${d}`;
      ws.getCell(`${col}${row}`).font = { bold: true };
      ws.getCell(`${col}${row}`).alignment = { horizontal: 'center' };
      ws.getCell(`${col}${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    });
    row++;

    const valOf = (donem: number, key: string) => {
      const c = yilData.ceyrekler[donem - 1];
      if (!c) return null;
      return Number((c as any)[key] || 0);
    };

    const yaz = (label: string, key: string, opts?: { bold?: boolean }) => {
      ws.getCell(`A${row}`).value = label;
      if (opts?.bold) ws.getCell(`A${row}`).font = { bold: true };
      tersDonemler.forEach((d, i) => {
        const col = String.fromCharCode(66 + i);
        ws.getCell(`${col}${row}`).value = valOf(d, key);
        ws.getCell(`${col}${row}`).numFmt = '#,##0.00';
        if (opts?.bold) ws.getCell(`${col}${row}`).font = { bold: true };
      });
      row++;
    };

    const sectionRow = (label: string, color: string) => {
      ws.getCell(`A${row}`).value = label;
      ws.getCell(`A${row}`).font = { bold: true, size: 12 };
      ws.getCell(`A${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
      ws.mergeCells(`A${row}:E${row}`);
      row++;
    };

    sectionRow('GELİR', 'FFE8F5E9');
    yaz('Dönem İçi Satışlar', 'satisHasilati');
    yaz('Diğer Gelirler', 'digerGelir');

    sectionRow('STOK HAREKETİ', 'FFFEF3C7');
    yaz('Dönem Başı Stok', 'donemBasiStok');
    yaz('(+) Satın Alınan Mal Bedeli', 'malAlisi');
    yaz('(=) Toplam Stok', 'toplamStok', { bold: true });
    yaz('(-) Kalan Stok', 'kalanStok');
    yaz('Satılan Malın Maliyeti', 'satilanMalMaliyeti', { bold: true });
    yaz('NET SATIŞLAR', 'netSatislar', { bold: true });

    sectionRow('GİDER', 'FFFCE8E8');
    yaz('Dönem İçi Giderler', 'd