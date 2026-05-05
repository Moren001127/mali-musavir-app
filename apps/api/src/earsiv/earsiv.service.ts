import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EarsivZipParserService, ParsedEarsivFatura } from './earsiv-zip-parser.service';
import { EarsivRenderService } from './earsiv-render.service';
import { chromium as pwChromium } from 'playwright-core';
import * as JSZip from 'jszip';

export type EarsivTip = 'SATIS' | 'ALIS';
export type BelgeKaynak = 'EFATURA' | 'EARSIV';

@Injectable()
export class EarsivService {
  private readonly logger = new Logger(EarsivService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: EarsivZipParserService,
    private readonly render: EarsivRenderService,
  ) {}

  /**
   * Seçili faturaları AYRI AYRI PDF olarak render et, ZIP içinde dön.
   * Her PDF'in adı: <faturaNo>.pdf
   * Browser-based PDF üretimi için playwright-core kullanır (text vector korunur).
   */
  async generateBulkPdfsZip(tenantId: string, ids: string[]): Promise<Buffer> {
    if (!ids || ids.length === 0) throw new BadRequestException('id listesi gerekli');
    if (ids.length > 200) throw new BadRequestException('En fazla 200 fatura tek seferde indirilebilir');

    const faturas = await (this.prisma as any).earsivFatura.findMany({
      where: { tenantId, id: { in: ids } },
      orderBy: { faturaTarihi: 'asc' },
    });
    if (faturas.length === 0) throw new BadRequestException('Fatura bulunamadı');

    this.logger.log(`Bulk PDF üretimi başlıyor: ${faturas.length} fatura`);

    const browser = await pwChromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const zip = new JSZip();
    try {
      const ctx = await browser.newContext();
      for (const f of faturas) {
        try {
          const html = this.render.renderHtml(f as any, { autoPrint: false });
          const page = await ctx.newPage();
          // setContent + waitUntil networkidle: gömülü XSLT JS'inin tamamlanmasını bekle
          await page.setContent(html, { waitUntil: 'networkidle', timeout: 15000 });
          // XSLT processing biraz daha zaman alabilir
          await page.waitForTimeout(400);
          const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
          });
          await page.close();
          const safeName = String(f.faturaNo || f.id).replace(/[^A-Za-z0-9._-]/g, '_');
          zip.file(`${safeName}.pdf`, pdf);
        } catch (e: any) {
          this.logger.warn(`PDF üretim hata (${f.faturaNo}): ${e?.message}`);
          // Yine de ZIP'e bir hata raporu ekle
          zip.file(`HATA_${f.faturaNo || f.id}.txt`, `PDF üretilemedi: ${e?.message || 'bilinmeyen'}`);
        }
      }
      await ctx.close();
    } finally {
      await browser.close().catch(() => {});
    }

    this.logger.log(`Bulk PDF tamam: ZIP oluşturuluyor`);
    return zip.generateAsync({ type: 'nodebuffer' });
  }

  /**
   * Agent'ın yüklediği ZIP dosyasını parse edip DB'ye yaz.
   * tip: SATIS (e-arşiv kestiklerimiz) veya ALIS (gelen e-fatura)
   */
  async importFromZip(opts: {
    tenantId: string;
    taxpayerId: string;
    donem: string;
    tip: EarsivTip;
    belgeKaynak?: BelgeKaynak;
    fetchJobId?: string;
    zipBuffer: Buffer;
  }): Promise<{ inserted: number; skipped: number; total: number; meta?: any }> {
    const { tenantId, taxpayerId, donem, tip, fetchJobId, zipBuffer } = opts;
    const belgeKaynak: BelgeKaynak = opts.belgeKaynak ?? 'EARSIV';

    const parsed = await this.parser.parseZip(zipBuffer);
    this.logger.log(`ZIP parse: ${parsed.length} fatura bulundu (tip=${tip}, kaynak=${belgeKaynak})`);

    let inserted = 0;
    let skipped = 0;

    for (const f of parsed) {
      try {
        await (this.prisma as any).earsivFatura.upsert({
          where: {
            tenantId_taxpayerId_tip_belgeKaynak_faturaNo: {
              tenantId, taxpayerId, tip, belgeKaynak, faturaNo: f.faturaNo,
            },
          },
          create: {
            tenantId,
            taxpayerId,
            tip,
            belgeKaynak,
            donem,
            faturaNo: f.faturaNo,
            faturaTarihi: f.faturaTarihi,
            ettn: f.ettn,
            satici: f.satici,
            saticiVergiNo: f.saticiVergiNo,
            alici: f.alici,
            aliciVergiNo: f.aliciVergiNo,
            matrah: f.matrah,
            kdvTutari: f.kdvTutari,
            kdvOrani: f.kdvOrani,
            toplamTutar: f.toplamTutar,
            paraBirimi: f.paraBirimi,
            xmlContent: f.xmlContent,
            zipSourceName: f.zipFileName,
            fetchJobId,
          },
          update: {
            // Mevcut kaydı güncelle (tarih, tutar değişmiş olabilir)
            faturaTarihi: f.faturaTarihi,
            ettn: f.ettn,
            satici: f.satici,
            saticiVergiNo: f.saticiVergiNo,
            alici: f.alici,
            aliciVergiNo: f.aliciVergiNo,
            matrah: f.matrah,
            kdvTutari: f.kdvTutari,
            kdvOrani: f.kdvOrani,
            toplamTutar: f.toplamTutar,
            updatedAt: new Date(),
          },
        });
        inserted++;
      } catch (e: any) {
        this.logger.warn(`Fatura kaydetme hata (${f.faturaNo}): ${e.message}`);
        skipped++;
      }
    }

    const meta: any = {
      bufferSize: zipBuffer ? zipBuffer.length : 0,
      totalEntries: (parsed as any).__totalEntries || 0,
      xmlCount: (parsed as any).__xmlCount || 0,
      entries: (parsed as any).__entries || [],
      diagnostics: (parsed as any).__diagnostics || [],
    };
    return { inserted, skipped, total: parsed.length, meta };
  }

  /**
   * Filtreli liste — taxpayerId, donem, tip, arama, tarih aralığı
   */
  async list(opts: {
    tenantId: string;
    taxpayerId?: string;
    donem?: string;
    tip?: EarsivTip;
    belgeKaynak?: BelgeKaynak;
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const { tenantId, taxpayerId, donem, tip, belgeKaynak, search, page = 1, pageSize = 50 } = opts;
    const where: any = { tenantId };
    if (taxpayerId) where.taxpayerId = taxpayerId;
    if (donem) where.donem = donem;
    if (tip) where.tip = tip;
    if (belgeKaynak) where.belgeKaynak = belgeKaynak;
    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { faturaNo: { contains: q, mode: 'insensitive' } },
        { satici: { contains: q, mode: 'insensitive' } },
        { alici: { contains: q, mode: 'insensitive' } },
        { saticiVergiNo: { contains: q } },
        { aliciVergiNo: { contains: q } },
      ];
    }

    const [rows, total] = await Promise.all([
      (this.prisma as any).earsivFatura.findMany({
        where,
        orderBy: { faturaTarihi: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, tip: true, belgeKaynak: true, donem: true, faturaNo: true, faturaTarihi: true, ettn: true,
          satici: true, saticiVergiNo: true, alici: true, aliciVergiNo: true,
          matrah: true, kdvTutari: true, kdvOrani: true, toplamTutar: true, paraBirimi: true,
          durum: true, taxpayerId: true, createdAt: true,
        },
      }),
      (this.prisma as any).earsivFatura.count({ where }),
    ]);

    return { rows, total, page, pageSize };
  }

  async getById(tenantId: string, id: string) {
    const f = await (this.prisma as any).earsivFatura.findFirst({
      where: { tenantId, id },
    });
    if (!f) throw new NotFoundException('Fatura bulunamadı');
    return f;
  }

  /**
   * Seçili faturaları ZIP olarak topla (orijinal XML + PDF)
   */
  async downloadBulkZip(tenantId: string, ids: string[]): Promise<Buffer> {
    if (!ids || ids.length === 0) throw new BadRequestException('id listesi gerekli');
    const faturas = await (this.prisma as any).earsivFatura.findMany({
      where: { tenantId, id: { in: ids } },
      select: {
        id: true, faturaNo: true, tip: true, donem: true,
        xmlContent: true, pdfStorageKey: true, satici: true, alici: true,
      },
    });

    const zip = new JSZip();
    for (const f of faturas) {
      const baseName = `${f.tip}_${f.donem}_${(f.faturaNo || f.id).replace(/[^A-Za-z0-9._-]/g, '_')}`;
      if (f.xmlContent) {
        zip.file(`${baseName}.xml`, f.xmlContent);
      }
      // PDF storage key varsa S3'ten al — şimdilik atlıyoruz
    }
    return zip.generateAsync({ type: 'nodebuffer' });
  }
}
