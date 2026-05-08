import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LucaService } from '../luca/luca.service';
import { ExcelParserService } from '../kdv-control/excel-parser.service';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly luca: LucaService,
    private readonly excelParser: ExcelParserService,
  ) {}

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
      // v1.36.65: kümülatif odenecekGecVergi (gerçekten ödenen). Önceden hesaplananGecVergi
      // kullanılıyordu — yanlış çünkü hesaplanan vergiden önceki ödenenler düşülmüyordu.
      oncekiOdenenGecVergi = oncekiDonemler.reduce(
        (acc: number, x: any) => acc + Number(x.odenecekGecVergi || 0),
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

    // v1.36.24: SMM ve kalanStok TAM MANUEL — bidirectional auto-derive YOK.
    // Kullanıcı her birini bağımsız olarak girer. Luca import bunlara dokunmaz.
    // Önceki versiyonda SMM<->kalanStok arası auto-derive Q1'in stok bilgisinin
    // Q2'ye sızmasına neden oluyordu — tamamen kaldırıldı.
    const satilanMalMaliyeti =
      typeof params.satilanMalMaliyeti === 'number'
        ? r2(params.satilanMalMaliyeti)
        : Number(ozet.satilanMalMaliyeti) || 0;
    const kalanStok =
      typeof params.kalanStok === 'number'
        ? r2(params.kalanStok)
        : Number(ozet.kalanStok) || 0;

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

    // v1.36.24: kalanStok → sonraki çeyrek donemBasiStok PROPAGATION KALDIRILDI.
    // Bu propagation Q1 stoğunun Q2'ye sızmasına ve phantom SMM oluşmasına yol açıyordu.
    // Her çeyreğin donemBasiStok'u manuel veya Luca'dan ayrı ayrı set edilir.

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
        // v1.36.65: Önceki dönem ÖDENEN kümülatif → odenecekGecVergi (hesaplanan değil)
        const onceki = await (this.prisma as any).isletmeHesapOzeti.findMany({
          where: {
            tenantId: params.tenantId,
            taxpayerId: ozet.taxpayerId,
            yil: ozet.yil,
            donem: { lt: sonraki.donem },
          },
          select: { odenecekGecVergi: true },
        });
        const yeniOnceki = onceki.reduce(
          (acc: number, x: any) => acc + Number(x.odenecekGecVergi || 0),
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

  /**
   * v1.36.22 — KULLANICI İSTEĞİ: "Sil" butonu artık kayıt SİLMEZ, sadece tüm
   * tutar alanlarını 0'a çekip kayıt boş hale getirir. Mukellef + dönem kaydı kalır,
   * tekrar Luca'dan çekim yapılabilir.
   */
  async remove(tenantId: string, id: string) {
    const ozet = await (this.prisma as any).isletmeHesapOzeti.findFirst({
      where: { id, tenantId },
    });
    if (!ozet) throw new NotFoundException('Kayıt bulunamadı');
    if (ozet.locked) throw new BadRequestException('Kesin kayıtta temizleme yapılamaz');
    // SOFT-CLEAR: tüm tutar alanlarını sıfırla, kayıt kalsın
    await (this.prisma as any).isletmeHesapOzeti.update({
      where: { id },
      data: {
        satisHasilati: 0,
        digerGelir: 0,
        malAlisi: 0,
        donemBasiStok: 0,
        kalanStok: 0,
        toplamStok: 0,
        satilanMalMaliyeti: 0,
        donemIciGiderler: 0,
        gecmisYilZarari: 0,
        oncekiOdenenGecVergi: 0,
        netSatislar: 0,
        donemKari: 0,
        gecVergiMatrahi: 0,
        hesaplananGecVergi: 0,
        odenecekGecVergi: 0,
        not: null,
      },
    });
    return { cleared: true };
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
    yaz('Dönem İçi Giderler', 'donemIciGiderler');
    yaz('DÖNEM KARI', 'donemKari', { bold: true });

    sectionRow('GEÇİCİ VERGİ', 'FFE0E7FF');
    yaz('Geçmiş Yıl Zararı', 'gecmisYilZarari');
    yaz('Geçici Vergi Matrahı', 'gecVergiMatrahi', { bold: true });
    yaz('Hesaplanan Geçici Vergi (%15)', 'hesaplananGecVergi');
    yaz('(-) Önceki Dönem Ödenen', 'oncekiOdenenGecVergi');
    yaz('Ödenecek Geçici Vergi', 'odenecekGecVergi', { bold: true });

    const buffer = await wb.xlsx.writeBuffer();
    return buffer as Buffer;
  }
  // ═══════════════════════════════════════════════════════
  // LUCA ÇEKİM — İşletme Defteri Excel'den otomatik doldurma
  // ═══════════════════════════════════════════════════════

  /** Bir İHÖ kaydı için Luca çekim job'u yarat (agent runner alacak).
   * Agent IHO_FETCH job'unu görünce: Luca'da firmaya geçer + Gelir/Gider Listesi
   * ekranını açar + tarih aralığını girer + Excel'i çeker + upload-iho'ya yükler. */
  async lucaCek(params: {
    tenantId: string;
    id: string;
    createdBy?: string;
  }) {
    const ozet = await (this.prisma as any).isletmeHesapOzeti.findFirst({
      where: { id: params.id, tenantId: params.tenantId },
    });
    if (!ozet) throw new NotFoundException('İHÖ kaydı bulunamadı');
    if (ozet.locked) throw new BadRequestException('Kesin kayıt — Luca çekim yapılamaz');

    // Mukellef adı — agent Luca'da firma seçimi için kullanır (#SirketCombo text match)
    const taxpayer = await (this.prisma as any).taxpayer.findUnique({
      where: { id: ozet.taxpayerId },
    });
    const mukellefAdi =
      taxpayer?.companyName ||
      [taxpayer?.firstName, taxpayer?.lastName].filter(Boolean).join(' ') ||
      taxpayer?.taxNumber || '';

    // Çeyreğin başlangıç-bitiş tarihleri (DD/MM/YYYY için backend'den YYYY-MM-DD_YYYY-MM-DD)
    const baslangicAyi = (ozet.donem - 1) * 3 + 1;
    const bitisAyi = ozet.donem * 3;
    const sonGun = new Date(ozet.yil, bitisAyi, 0).getDate(); // ay sonu
    const ay = (n: number) => String(n).padStart(2, '0');
    const donemAralik = `${ozet.yil}-${ay(baslangicAyi)}-01_${ozet.yil}-${ay(bitisAyi)}-${ay(sonGun)}`;

    const job = await this.luca.createFetchJob({
      tenantId: params.tenantId,
      sessionId: ozet.id, // İHÖ kaydı id (agent upload-iho?ihoId=... için kullanır)
      mukellefId: ozet.taxpayerId,
      donem: donemAralik, // "YYYY-MM-DD_YYYY-MM-DD"
      tip: 'IHO_FETCH',
      createdBy: params.createdBy,
      mukellefAdi, // [META] mukellefAdi=... olarak errorMsg'e konur
    });

    return {
      jobId: job.id,
      status: 'queued',
      donem: ozet.donem,
      yil: ozet.yil,
      message: `Luca sekmesini açık tut — agent firma seçip Gelir/Gider Listesi'ni otomatik çekecek`,
    };
  }

  /** Çeyreklik dönem aralığı: 1→Oca-Mar, 2→Nis-Haz, 3→Tem-Eyl, 4→Eki-Ara */
  private donemAraligi(yil: number, donem: number): { gte: string; lte: string } {
    const baslangicAyi = (donem - 1) * 3 + 1;
    const bitisAyi = donem * 3;
    const ay = (n: number) => String(n).padStart(2, '0');
    return { gte: `${yil}-${ay(baslangicAyi)}`, lte: `${yil}-${ay(bitisAyi)}` };
  }

  /** Agent runner Excel'i yükledikten sonra parse eder ve İHÖ alanlarını doldurur */
  async applyLucaSnapshot(params: {
    tenantId: string;
    ihoId: string;
    jobId?: string;
    buffer: Buffer;
  }) {
    const ozet = await (this.prisma as any).isletmeHesapOzeti.findFirst({
      where: { id: params.ihoId, tenantId: params.tenantId },
    });
    if (!ozet) throw new NotFoundException('İHÖ kaydı bulunamadı');
    if (ozet.locked) throw new BadRequestException('Kesin kayıt — Luca verisi uygulanamaz');

    // Excel parse — gelir, mal alışı, gider, dönem başı stok ayrı ayrı
    // YENİ: Çeyreğin tarih aralığını parser'a geçir — Luca cumulative dönerse filtrele.
    const yil = Number(ozet.yil);
    const cYrl = Number(ozet.donem); // 1=Q1(Oca-Mar), 2=Q2(Nis-Haz), 3=Q3(Tem-Eyl), 4=Q4(Eki-Ara)
    const startMonth = (cYrl - 1) * 3; // 0,3,6,9
    const start = new Date(yil, startMonth, 1);
    const end = new Date(yil, startMonth + 3, 0); // ay sonu (sonraki ayın 0'ı)
    const parsed = this.excelParser.parseIsletmeExcelDetayli(params.buffer, { start, end });

    this.logger.log(
      `İHÖ Luca uygulanıyor (id=${params.ihoId}, Q${cYrl} ${yil} ${start.toISOString().slice(0,10)}..${end.toISOString().slice(0,10)}): ` +
        `satışlar=${parsed.gelirToplam}, mal=${parsed.malAlisToplam}, ` +
        `gider=${parsed.giderToplam}, donemBasiStok=${parsed.donemBasiStok}`,
    );

    // Mevcut türetilen alanları yeniden hesaplamak için updateManuel kullan.
    // KULLANICI İSTEĞİ (v1.36.22): SMM ve kalanStok MANUEL — Luca import bunlara dokunmaz.
    // updateManuel artık SMM/kalanStok params'ta yoksa mevcut değerleri korur (auto-derive yok).
    const updatePayload: any = {
      tenantId: params.tenantId,
      id: params.ihoId,
      satisHasilati: parsed.gelirToplam,
      malAlisi: parsed.malAlisToplam,
      donemIciGiderler: parsed.giderToplam,
    };
    if (parsed.donemBasiStok > 0) {
      updatePayload.donemBasiStok = parsed.donemBasiStok;
    }
    return this.updateManuel(updatePayload);
  }

  /** Job durumunu kontrol et (frontend polling için) */
  async getLucaJob(jobId: string, tenantId: string) {
    const job = await (this.prisma as any).lucaFetchJob.findFirst({
      where: { id: jobId, tenantId },
    });
    if (!job) throw new NotFoundException('Job bulunamadı');
    return job;
  }
}

