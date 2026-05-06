import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EarsivZipParserService, ParsedEarsivFatura } from './earsiv-zip-parser.service';
import { EarsivRenderService } from './earsiv-render.service';
import { MihsapService } from '../mihsap/mihsap.service';
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
    private readonly mihsap: MihsapService,
  ) {}

  /**
   * Seçili Gelen E-Arşiv faturalarını Mihsap'a "Gider Faturası" olarak yükler.
   * Sadece tip=ALIS, belgeKaynak=EARSIV faturalar kabul edilir.
   * Her biri için PDF üretir (playwright), Mihsap API'sine POST atar.
   */
  async uploadFaturasToMihsap(tenantId: string, ids: string[]): Promise<{
    total: number;
    uploaded: number;
    failed: number;
    skipped: number;
    details: Array<{ id: string; faturaNo: string; status: 'uploaded' | 'failed' | 'skipped'; error?: string }>;
  }> {
    if (!ids || ids.length === 0) throw new BadRequestException('id listesi gerekli');
    if (ids.length > 200) throw new BadRequestException('En fazla 200 fatura tek seferde yüklenebilir');

    const faturas = await (this.prisma as any).earsivFatura.findMany({
      where: { tenantId, id: { in: ids } },
      include: { taxpayer: { select: { id: true, mihsapId: true, companyName: true, firstName: true, lastName: true } } },
    });
    if (faturas.length === 0) throw new BadRequestException('Fatura bulunamadı');

    this.logger.log(`Mihsap upload başlıyor: ${faturas.length} fatura`);

    const browser = await pwChromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROMIUM_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const details: Array<{ id: string; faturaNo: string; status: 'uploaded' | 'failed' | 'skipped'; error?: string }> = [];
    let uploaded = 0, failed = 0, skipped = 0;

    try {
      const ctx = await browser.newContext();
      for (const f of faturas) {
        // Sadece Gelen E-Arşiv (ALIS+EARSIV)
        if (f.tip !== 'ALIS' || f.belgeKaynak !== 'EARSIV') {
          skipped++;
          details.push({ id: f.id, faturaNo: f.faturaNo, status: 'skipped', error: 'Sadece Gelen E-Arşiv yüklenir' });
          await this.markMihsapStatus(f.id, { status: 'skipped', error: 'Tip uygun değil' });
          continue;
        }
        const mihsapId = f.taxpayer?.mihsapId;
        if (!mihsapId) {
          failed++;
          details.push({ id: f.id, faturaNo: f.faturaNo, status: 'failed', error: 'Mukellefin mihsapId tanımlı değil' });
          await this.markMihsapStatus(f.id, { status: 'failed', error: 'Mukellefin mihsapId tanımlı değil' });
          continue;
        }
        let pdfBuffer: Buffer;
        try {
          const html = this.render.renderHtml(f as any, { autoPrint: false });
          const page = await ctx.newPage();
          await page.setContent(html, { waitUntil: 'networkidle', timeout: 20000 });
          await page.waitForTimeout(500);
          pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
          });
          await page.close();
        } catch (e: any) {
          failed++;
          const msg = `PDF render hatası: ${e?.message || e}`;
          details.push({ id: f.id, faturaNo: f.faturaNo, status: 'failed', error: msg });
          await this.markMihsapStatus(f.id, { status: 'failed', error: msg });
          continue;
        }
        // Mihsap'a yükle
        const safeName = String(f.faturaNo || f.id).replace(/[^A-Za-z0-9._-]/g, '_');
        const result = await this.mihsap.uploadGiderFatura(tenantId, mihsapId, pdfBuffer, `${safeName}.pdf`);
        if (result.ok) {
          uploaded++;
          details.push({ id: f.id, faturaNo: f.faturaNo, status: 'uploaded' });
          await this.markMihsapStatus(f.id, { status: 'uploaded' });
        } else {
          failed++;
          const msg = `Mihsap red: ${result.error || `HTTP ${result.status}`}`;
          details.push({ id: f.id, faturaNo: f.faturaNo, status: 'failed', error: msg });
          await this.markMihsapStatus(f.id, { status: 'failed', error: msg });
        }
      }
      await ctx.close();
    } finally {
      await browser.close().catch(() => {});
    }

    this.logger.log(`Mihsap upload tamam: ${uploaded} yüklendi, ${failed} hata, ${skipped} atlandı`);
    return { total: faturas.length, uploaded, failed, skipped, details };
  }

  private async markMihsapStatus(faturaId: string, opts: { status: 'uploaded' | 'failed' | 'skipped'; error?: string }) {
    try {
      const data: any = {
        mihsapUploadStatus: opts.status,
        mihsapUploadError: opts.error || null,
      };
      if (opts.status === 'uploaded') data.mihsapUploadedAt = new Date();
      await (this.prisma as any).earsivFatura.update({ where: { id: faturaId }, data });
    } catch (e: any) {
      this.logger.warn(`Mihsap status update hatası (${faturaId}): ${e?.message}`);
    }
  }

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
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROMIUM_PATH,
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
          // Tipe göre dosya adı: <yön>-<kaynak>-<faturaNo>.pdf, klasöre de gruplanır
          // Örn: gelen-e-arsiv/SR0202600005.pdf, giden-e-fatura/YJC2026...pdf
          const yon = f.tip === 'SATIS' ? 'giden' : 'gelen';
          const kaynak = f.belgeKaynak === 'EFATURA' ? 'e-fatura' : 'e-arsiv';
          const klasor = `${yon}-${kaynak}`;
          const safeName = String(f.faturaNo || f.id).replace(/[^A-Za-z0-9._-]/g, '_');
          zip.file(`${klasor}/${yon}-${kaynak}-${safeName}.pdf`, pdf);
        } catch (e: any) {
          this.logger.warn(`PDF üretim hata (${f.faturaNo}): ${e?.message}`);
          // Yine de ZIP'e bir hata raporu ekle (aynı klasör mantığı)
          const yon = f.tip === 'SATIS' ? 'giden' : 'gelen';
          const kaynak = f.belgeKaynak === 'EFATURA' ? 'e-fatura' : 'e-arsiv';
          zip.file(`${yon}-${kaynak}/HATA_${f.faturaNo || f.id}.txt`, `PDF üretilemedi: ${e?.message || 'bilinmeyen'}`);
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
  }): Promise<{ inserted: number; duplicate: number; skipped: number; total: number; meta?: any }> {
    const { tenantId, taxpayerId, donem: jobDonem, tip, fetchJobId, zipBuffer } = opts;
    const belgeKaynak: BelgeKaynak = opts.belgeKaynak ?? 'EARSIV';

    // Fatura tarihinden donem türet — Sorgu 2 (sonraki ay başı→bugün) faturaları
    // job.donem (örn 2026-04) ile gelse bile, faturanın gerçek ay'ına yazılsın.
    const donemFromTarih = (d?: Date | null): string => {
      if (!d) return jobDonem;
      const dt = d instanceof Date ? d : new Date(d as any);
      if (isNaN(dt.getTime())) return jobDonem;
      const y = dt.getUTCFullYear();
      const m = dt.getUTCMonth() + 1;
      return `${y}-${String(m).padStart(2, '0')}`;
    };

    const parsed = await this.parser.parseZip(zipBuffer);
    this.logger.log(`ZIP parse: ${parsed.length} fatura bulundu (tip=${tip}, kaynak=${belgeKaynak})`);

    let inserted = 0;   // gerçekten YENİ eklenen
    let duplicate = 0;  // önceden vardı, atlandı (mükerrer önleme)
    let skipped = 0;    // hata nedeniyle atlandı
    const errors: string[] = []; // ilk birkaç hata sebebi (debugging için)

    for (const f of parsed) {
      try {
        // Önce mevcut mu kontrol et — varsa SKIP (yeniden indirip üzerine yazma)
        const existing = await (this.prisma as any).earsivFatura.findFirst({
          where: { tenantId, taxpayerId, tip, belgeKaynak, faturaNo: f.faturaNo },
          select: { id: true },
        });
        if (existing) {
          duplicate++;
          continue;
        }
        await (this.prisma as any).earsivFatura.create({
          data: {
            tenantId,
            taxpayerId,
            tip,
            belgeKaynak,
            // Fatura tarihinden türetilen donem (Sorgu 2'deki Mayıs faturaları
            // Nisan job'ında bile gelse '2026-05' olarak kaydedilir).
            donem: donemFromTarih(f.faturaTarihi),
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
          // Sadece id'yi geri al — mihsap* kolonları production DB'de
          // olmayabilir, default geri dönüşte SELECT ediyor ve patlıyordu (P2022).
          select: { id: true },
        });
        inserted++;
      } catch (e: any) {
        this.logger.warn(`Fatura kaydetme hata (${f.faturaNo}): ${e.message}`);
        skipped++;
        if (errors.length < 5) {
          // Prisma error code + kısa mesaj — agent loguna düşsün
          const code = e?.code || '';
          errors.push(`${f.faturaNo}: ${code} ${(e?.message || '').slice(0, 200)}`);
        }
      }
    }

    const meta: any = {
      bufferSize: zipBuffer ? zipBuffer.length : 0,
      totalEntries: (parsed as any).__totalEntries || 0,
      xmlCount: (parsed as any).__xmlCount || 0,
      entries: (parsed as any).__entries || [],
      diagnostics: (parsed as any).__diagnostics || [],
      errors,
    };
    return { inserted, duplicate, skipped, total: parsed.length, meta };
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
    if (taxpayerId) {
      // Multi-select: virgülle ayrılmış birden fazla id gelebilir
      const ids = String(taxpayerId).split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length === 1) where.taxpayerId = ids[0];
      else if (ids.length > 1) where.taxpayerId = { in: ids };
    }
    // Liste filtresi donem (kayıt saklama anahtarı) — kayıtlar bu alanla saklanır.
    // (Daha önce faturaTarihi aralığına çevrilmişti, eski kayıtlar görünmüyordu — geri alındı.)
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
        orderBy: { faturaTarihi: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, tip: true, belgeKaynak: true, donem: true, faturaNo: true, faturaTarihi: true, ettn: true,
          satici: true, saticiVergiNo: true, alici: true, aliciVergiNo: true,
          matrah: true, kdvTutari: true, kdvOrani: true, toplamTutar: true, paraBirimi: true,
          durum: true, taxpayerId: true, createdAt: true,
          // mihsap* alanları liste SELECT'inden kaldırıldı — production DB'de
          // henüz bu kolonlar olmayabilir, raw query yapıp eksik kolon hatası alıyorduk.
          // Mihsap status badge'ini şimdilik göstermiyoruz; tekil getById hâlâ döner.
        },
      }),
      (this.prisma as any).earsivFatura.count({ where }),
    ]);

    return { rows, total, page, pageSize };
  }

  async getById(tenantId: string, id: string) {
    // mihsap* kolonları DB'de olmayabilir — explicit select ile sınırlı tut
    const f = await (this.prisma as any).earsivFatura.findFirst({
      where: { tenantId, id },
      select: {
        id: true, tenantId: true, taxpayerId: true,
        tip: true, belgeKaynak: true, donem: true,
        faturaNo: true, faturaTarihi: true, ettn: true,
        satici: true, saticiVergiNo: true, alici: true, aliciVergiNo: true,
        matrah: true, kdvTutari: true, kdvOrani: true, toplamTutar: true,
        paraBirimi: true, aciklama: true, durum: true,
        xmlContent: true, pdfStorageKey: true, zipSourceName: true,
        fetchJobId: true, createdAt: true, updatedAt: true,
      },
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
