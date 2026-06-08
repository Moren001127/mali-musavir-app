import { Injectable, Logger, BadRequestException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EarsivZipParserService, ParsedEarsivFatura } from './earsiv-zip-parser.service';
import { EarsivRenderService } from './earsiv-render.service';
import { MihsapService } from '../mihsap/mihsap.service';
import { StorageService } from '../storage/storage.service';
import { FaturaMuhasebelestirmeService } from '../fatura-muhasebelestirme/fatura-muhasebelestirme.service';
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
    private readonly storage: StorageService,
    @Inject(forwardRef(() => FaturaMuhasebelestirmeService))
    private readonly accounting: FaturaMuhasebelestirmeService,
  ) {}

  private safeFilePart(value: string | null | undefined, fallback = 'fatura'): string {
    const cleaned = String(value || fallback).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
    return cleaned || fallback;
  }

  private normalizeTaxNo(value: string | null | undefined): string {
    return String(value || '').replace(/\D/g, '');
  }

  private taxNoFromZipFileName(value: string | null | undefined): string {
    const match = String(value || '').match(/#(\d{10,11})(?:\D|$)/);
    return match?.[1] || '';
  }

  private invoiceTaxNoForTip(
    fatura: { tip?: EarsivTip; saticiVergiNo?: string | null; aliciVergiNo?: string | null; zipFileName?: string | null; sourcePath?: string | null },
    tipFallback: EarsivTip,
  ): string {
    const tip = fatura.tip || tipFallback;
    const fromXml = tip === 'SATIS'
      ? this.normalizeTaxNo(fatura.saticiVergiNo)
      : this.normalizeTaxNo(fatura.aliciVergiNo);
    return fromXml || this.taxNoFromZipFileName(fatura.sourcePath || fatura.zipFileName);
  }

  private invoiceTaxpayerMatches(
    fatura: { tip?: EarsivTip; saticiVergiNo?: string | null; aliciVergiNo?: string | null; zipFileName?: string | null; sourcePath?: string | null },
    taxpayerTaxNo: string | null | undefined,
    tipFallback: EarsivTip,
  ): boolean {
    const expected = this.normalizeTaxNo(taxpayerTaxNo);
    if (!expected) return true;
    const actual = this.invoiceTaxNoForTip(fatura, tipFallback);
    return !!actual && actual === expected;
  }

  private buildPdfStorageKey(opts: {
    tenantId: string;
    taxpayerId: string;
    donem: string;
    tip: EarsivTip;
    belgeKaynak: BelgeKaynak;
    faturaNo: string;
  }): string {
    const yon = opts.tip === 'SATIS' ? 'giden' : 'gelen';
    const kaynak = opts.belgeKaynak === 'EFATURA' ? 'e-fatura' : 'e-arsiv';
    return `${opts.tenantId}/earsiv/${opts.taxpayerId}/${opts.donem}/${yon}-${kaynak}/${this.safeFilePart(opts.faturaNo)}.pdf`;
  }

  private buildHtmlStorageKey(opts: {
    tenantId: string;
    taxpayerId: string;
    donem: string;
    tip: EarsivTip;
    belgeKaynak: BelgeKaynak;
    faturaNo: string;
  }): string {
    const yon = opts.tip === 'SATIS' ? 'giden' : 'gelen';
    const kaynak = opts.belgeKaynak === 'EFATURA' ? 'e-fatura' : 'e-arsiv';
    return `${opts.tenantId}/earsiv/${opts.taxpayerId}/${opts.donem}/${yon}-${kaynak}/${this.safeFilePart(opts.faturaNo)}.html`;
  }

  private async storeOriginalPdf(opts: {
    tenantId: string;
    taxpayerId: string;
    donem: string;
    tip: EarsivTip;
    belgeKaynak: BelgeKaynak;
    faturaNo: string;
    pdfBuffer?: Buffer;
  }): Promise<string | null> {
    if (!opts.pdfBuffer?.length) return null;
    const key = this.buildPdfStorageKey(opts);
    await this.storage.putBuffer(key, opts.pdfBuffer, 'application/pdf', {
      originalName: encodeURIComponent(`${this.safeFilePart(opts.faturaNo)}.pdf`),
      faturaNo: opts.faturaNo,
      donem: opts.donem,
      tip: opts.tip,
      belgeKaynak: opts.belgeKaynak,
    });
    return key;
  }

  private async storeOriginalHtml(opts: {
    tenantId: string;
    taxpayerId: string;
    donem: string;
    tip: EarsivTip;
    belgeKaynak: BelgeKaynak;
    faturaNo: string;
    htmlContent?: string;
  }): Promise<string | null> {
    const html = opts.htmlContent?.trim();
    if (!html) return null;
    const key = this.buildHtmlStorageKey(opts);
    await this.storage.putBuffer(key, Buffer.from(html, 'utf8'), 'text/html; charset=utf-8', {
      originalName: encodeURIComponent(`${this.safeFilePart(opts.faturaNo)}.html`),
      faturaNo: opts.faturaNo,
      donem: opts.donem,
      tip: opts.tip,
      belgeKaynak: opts.belgeKaynak,
    });
    return key;
  }

  private async getHtmlForPdf(fatura: any): Promise<string> {
    if (fatura.htmlStorageKey) {
      const html = (await this.storage.getBuffer(fatura.htmlStorageKey)).toString('utf8');
      if (html.trim()) return html;
    }
    return this.render.renderHtml(fatura as any, { autoPrint: false });
  }

  private async queueAccountingSafe(
    tenantId: string,
    faturaId: string,
    _scope?: { tip?: EarsivTip; belgeKaynak?: BelgeKaynak },
  ) {
    // v2.3: 4 tip (GELEN/GIDEN x EFATURA/EARSIV) — hepsi Fatura Merkezi'ne otomatik aktarilir.
    // Onceden sadece ALIS+EARSIV aktarilirdi (kullanici beklentisinin %25'i).
    try {
      await this.accounting.ensureFromEarsivFatura(tenantId, faturaId);
    } catch (e: any) {
      this.logger.warn(`Muhasebelestirme kuyrugu hata (${faturaId}): ${e?.message || e}`);
    }
  }

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
          if (f.pdfStorageKey) {
            pdfBuffer = await this.storage.getBuffer(f.pdfStorageKey);
          } else {
            const html = await this.getHtmlForPdf(f);
            const page = await ctx.newPage();
            await page.setContent(html, { waitUntil: 'networkidle', timeout: 20000 });
            await page.waitForTimeout(500);
            pdfBuffer = await page.pdf({
              format: 'A4',
              printBackground: true,
              margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
            });
            await page.close();
          }
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
          const pdfYon = f.tip === 'SATIS' ? 'giden' : 'gelen';
          const pdfKaynak = f.belgeKaynak === 'EFATURA' ? 'e-fatura' : 'e-arsiv';
          const pdfKlasor = `${pdfYon}-${pdfKaynak}`;
          const pdfSafeName = String(f.faturaNo || f.id).replace(/[^A-Za-z0-9._-]/g, '_');
          if (f.pdfStorageKey) {
            const originalPdf = await this.storage.getBuffer(f.pdfStorageKey);
            if (originalPdf.length) {
              zip.file(`${pdfKlasor}/${pdfYon}-${pdfKaynak}-${pdfSafeName}.pdf`, originalPdf);
              continue;
            }
          }
          const html = await this.getHtmlForPdf(f);
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
    // Agent'ın Luca ekranında SAYDIĞI belge adedi (indirilmeden önce). Kaydedilen
    // sayı bundan azsa "sessiz kayıp" var demektir → görünür uyarı üretilir.
    bulunan?: number;
  }): Promise<{ inserted: number; duplicate: number; skipped: number; total: number; uyarilar?: string[]; meta?: any }> {
    const { tenantId, taxpayerId, donem: jobDonem, tip, fetchJobId, zipBuffer } = opts;
    const bulunan = Number.isFinite(opts.bulunan as any) && (opts.bulunan as number) >= 0 ? Math.floor(opts.bulunan as number) : null;
    const belgeKaynak: BelgeKaynak = opts.belgeKaynak ?? 'EARSIV';
    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      select: { id: true, taxNumber: true, companyName: true, firstName: true, lastName: true },
    });
    if (!taxpayer) throw new BadRequestException('Mükellef bulunamadı');
    const taxpayerTaxNo = this.normalizeTaxNo(taxpayer.taxNumber);
    const taxpayerLabel =
      taxpayer.companyName ||
      [taxpayer.firstName, taxpayer.lastName].filter(Boolean).join(' ') ||
      taxpayer.id;

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
    if (parsed.length === 0) {
      const entries = ((parsed as any).__entries || []).slice(0, 8).join(' | ');
      const diagnostics = ((parsed as any).__diagnostics || []).slice(0, 6).join(' | ');
      throw new BadRequestException(
        `ZIP içinde aktarılabilir fatura bulunamadı (xml=${(parsed as any).__xmlCount || 0}, entries=${(parsed as any).__totalEntries || 0}). ` +
        `${entries ? `İçerik: ${entries}. ` : ''}${diagnostics ? `Tanı: ${diagnostics}` : ''}`,
      );
    }

    let inserted = 0;   // gerçekten YENİ eklenen
    let duplicate = 0;  // önceden vardı, atlandı (mükerrer önleme)
    let skipped = 0;    // hata nedeniyle atlandı
    let pdfStored = 0;
    let pdfBackfilled = 0;
    let htmlStored = 0;
    let htmlBackfilled = 0;
    const errors: string[] = []; // ilk birkaç hata sebebi (debugging için)

    // KAYIP TESPİTİ: her faturanın BENZERSİZ kimliği (ETTN öncelik, yoksa faturaNo).
    // ZIP'te kaç ayrı fatura vardı (parsedKeys) ve kaçı portala düştü (savedKeys)?
    // İkisi tutmazsa = mükerrer-çakışması yüzünden sessiz kayıp → uyarı.
    const kimlik = (f: any): string =>
      ((f?.ettn || '').trim() || (f?.faturaNo || '').trim() || '').toLowerCase();
    const parsedKeys = new Set<string>();
    const savedKeys = new Set<string>();
    for (const f of parsed) { const k = kimlik(f); if (k) parsedKeys.add(k); }

    for (const f of parsed) {
      try {
        // PER-FATURA VKN/TC EŞLEŞME REDDİ KALDIRILDI (kullanıcı kararı, domain bilgisi):
        // Luca e-arşiv indirmesi FİRMA-BAZLI — agent o firmaya giriş yaptıysa
        // başka mükellefin faturası gelmez; gelen her şey bu firmaya aittir.
        // Eski per-fatura VKN reddi ŞAHIS FİRMALARINDA GERÇEK KAYBA yol açıyordu:
        // GİB faturayı bazen mükellefin VKN'sine bazen TC kimlik no'suna kesiyor;
        // portalda yalnızca biri (ör. TC) kayıtlı olduğundan diğerine kesilenler
        // "vergi no uyuşmadı" diye atılıyordu (ör. 16 faturanın 12'si). Artık
        // gelen her fatura bu mükellefe kaydedilir; farklı VKN sadece iz için loglanır.
        if (!this.invoiceTaxpayerMatches(f, taxpayerTaxNo, tip)) {
          const actualTaxNo = this.invoiceTaxNoForTip(f, tip) || 'boş';
          this.logger.log(
            `Fatura VKN farklı, yine de kabul edildi (şahıs TC/VKN olabilir): ${f.faturaNo} beklenen=${taxpayerTaxNo} XML=${actualTaxNo}`,
          );
        }
        const fDonem = donemFromTarih(f.faturaTarihi);
        // MÜKERRER KONTROLÜ — ÖNCELİK BENZERSİZ ETTN (UUID).
        // ESKİ HATA: mükerrer kontrolü yalnızca faturaNo'ya bakıyordu. Parser bazı
        // faturalara boş / 'BILINMIYOR' / tekrarlı no üretince, FARKLI faturalar aynı
        // no'da çakışıp "zaten var" sanılıyor ve kaydedilmiyordu (16 fatura → 4 kayıt).
        // ETTN her gerçek faturada benzersizdir; önce ona, yoksa geçerli faturaNo'ya bak.
        const ettnKey = (f.ettn || '').trim();
        const noKey = (f.faturaNo || '').trim();
        const noKullanilabilir = !!noKey && !/^(BILINMIYOR|NaN)$/i.test(noKey);
        const orKeys: any[] = [];
        if (ettnKey) orKeys.push({ ettn: ettnKey });
        if (noKullanilabilir) orKeys.push({ faturaNo: noKey });
        // Ne ETTN ne geçerli faturaNo varsa: KAYBETMEKTENSE yeni kabul et (existing=null).
        const existing = orKeys.length
          ? await (this.prisma as any).earsivFatura.findFirst({
              where: { tenantId, taxpayerId, tip, belgeKaynak, OR: orKeys },
              select: {
                id: true, donem: true, faturaTarihi: true, pdfStorageKey: true, htmlStorageKey: true,
                satici: true, saticiVergiNo: true, alici: true, aliciVergiNo: true,
              },
            })
          : null;
        if (existing) {
          const updateData: any = {};
          if (existing.donem !== fDonem) {
            updateData.donem = fDonem;
            updateData.faturaTarihi = f.faturaTarihi;
          }
          // KARŞI FİRMA BACKFILL: eski parser ile çekilmiş faturaların satıcı/alıcı
          // ünvanı boş kalmış olabilir (listede "Karşı Firma" boş görünür). Re-fetch'te
          // yeni parser ünvanı çıkardıysa, boş olan alanları doldur. Doluysa dokunma.
          if (!existing.satici && f.satici) updateData.satici = f.satici;
          if (!existing.alici && f.alici) updateData.alici = f.alici;
          if (!existing.saticiVergiNo && f.saticiVergiNo) updateData.saticiVergiNo = this.normalizeTaxNo(f.saticiVergiNo);
          if (!existing.aliciVergiNo && f.aliciVergiNo) updateData.aliciVergiNo = this.normalizeTaxNo(f.aliciVergiNo);
          if (!existing.pdfStorageKey && f.pdfBuffer?.length) {
            let pdfStorageKey: string | null = null;
            try {
              pdfStorageKey = await this.storeOriginalPdf({
                tenantId,
                taxpayerId,
                donem: fDonem,
                tip,
                belgeKaynak,
                faturaNo: f.faturaNo,
                pdfBuffer: f.pdfBuffer,
              });
            } catch (e: any) {
              this.logger.warn(`Fatura PDF saklama hata (${f.faturaNo}): ${e?.message || e}`);
              if (errors.length < 5) errors.push(`${f.faturaNo}: PDF saklanamadi ${(e?.message || '').slice(0, 160)}`);
            }
            if (pdfStorageKey) {
              updateData.pdfStorageKey = pdfStorageKey;
              pdfBackfilled++;
            }
          }
          if (f.htmlContent?.trim()) {
            let htmlStorageKey: string | null = null;
            try {
              htmlStorageKey = await this.storeOriginalHtml({
                tenantId,
                taxpayerId,
                donem: fDonem,
                tip,
                belgeKaynak,
                faturaNo: f.faturaNo,
                htmlContent: f.htmlContent,
              });
            } catch (e: any) {
              this.logger.warn(`Fatura HTML saklama hata (${f.faturaNo}): ${e?.message || e}`);
              if (errors.length < 5) errors.push(`${f.faturaNo}: HTML saklanamadi ${(e?.message || '').slice(0, 160)}`);
            }
            if (htmlStorageKey) {
              updateData.htmlStorageKey = htmlStorageKey;
              htmlBackfilled++;
            }
          }
          if (Object.keys(updateData).length) {
            await (this.prisma as any).earsivFatura.update({
              where: { id: existing.id },
              data: updateData,
            });
          }
          await this.queueAccountingSafe(tenantId, existing.id, { tip, belgeKaynak });
          { const k = kimlik(f); if (k) savedKeys.add(k); }
          duplicate++;
          continue;
        }
        let pdfStorageKey: string | null = null;
        try {
          pdfStorageKey = await this.storeOriginalPdf({
            tenantId,
            taxpayerId,
            donem: fDonem,
            tip,
            belgeKaynak,
            faturaNo: f.faturaNo,
            pdfBuffer: f.pdfBuffer,
          });
        } catch (e: any) {
          this.logger.warn(`Fatura PDF saklama hata (${f.faturaNo}): ${e?.message || e}`);
          if (errors.length < 5) errors.push(`${f.faturaNo}: PDF saklanamadi ${(e?.message || '').slice(0, 160)}`);
        }
        if (pdfStorageKey) pdfStored++;
        let htmlStorageKey: string | null = null;
        try {
          htmlStorageKey = await this.storeOriginalHtml({
            tenantId,
            taxpayerId,
            donem: fDonem,
            tip,
            belgeKaynak,
            faturaNo: f.faturaNo,
            htmlContent: f.htmlContent,
          });
        } catch (e: any) {
          this.logger.warn(`Fatura HTML saklama hata (${f.faturaNo}): ${e?.message || e}`);
          if (errors.length < 5) errors.push(`${f.faturaNo}: HTML saklanamadi ${(e?.message || '').slice(0, 160)}`);
        }
        if (htmlStorageKey) htmlStored++;
        const created = await (this.prisma as any).earsivFatura.create({
          data: {
            tenantId,
            taxpayerId,
            tip,
            belgeKaynak,
            // Fatura tarihinden türetilen donem (Sorgu 2'deki Mayıs faturaları
            // Nisan job'ında bile gelse '2026-05' olarak kaydedilir).
            donem: fDonem,
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
            // v2.1: çoklu KDV oranı detayı
            kdvBreakdown: f.kdvBreakdown ?? undefined,
            toplamTutar: f.toplamTutar,
            paraBirimi: f.paraBirimi,
            xmlContent: f.xmlContent,
            pdfStorageKey,
            htmlStorageKey,
            zipSourceName: f.zipFileName,
            fetchJobId,
          },
          // Sadece id'yi geri al — mihsap* kolonları production DB'de
          // olmayabilir, default geri dönüşte SELECT ediyor ve patlıyordu (P2022).
          select: { id: true },
        });
        await this.queueAccountingSafe(tenantId, created.id, { tip, belgeKaynak });
        { const k = kimlik(f); if (k) savedKeys.add(k); }
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
      pdfCount: (parsed as any).__pdfCount || 0,
      pdfMatched: (parsed as any).__pdfMatched || 0,
      htmlCount: (parsed as any).__htmlCount || 0,
      htmlMatched: (parsed as any).__htmlMatched || 0,
      pdfStored,
      pdfBackfilled,
      htmlStored,
      htmlBackfilled,
      errors,
    };
    if (inserted + duplicate === 0) {
      // Tüm faturalar "vergi no uyuşmadı" sebebiyle skipped olduysa, bu Luca'da
      // FIRMA SEÇİMİ YARIM KALDI demek — geçici durum, agent retry edebilir.
      // Hata mesajına agent'ın TRANSIENT pattern'inin yakaladığı ipucunu
      // ekliyoruz: agent-runtime.js içindeki regex
      //   /Firma DEĞİŞMEDİ|firma degisimi|frm4\/SirketCombo|.../i
      // yakaladığında job otomatik requeue edilir ve agent SSO'dan firma
      // yeniden seçip iş tekrar denenir. Aksi halde job failed olur ve
      // kullanıcı manuel tekrar başlatır.
      const allWrongVkn = skipped > 0 && skipped === parsed.length && errors.every((e) => /vergi no uyu/i.test(e));
      const transientHint = allWrongVkn
        ? 'TRANSIENT_LUCA: frm4/SirketCombo firma değişimi yarım kalmış; ZIP\'teki XML\'ler başka mükellefe ait. Firma seçimi sıfırlanıp tekrar denenecek. '
        : '';
      throw new BadRequestException(
        `${transientHint}ZIP okundu ama portala kaydedilen fatura olmadı (toplam=${parsed.length}, hata=${skipped}). ` +
        `${errors.length ? `İlk hatalar: ${errors.join(' || ')}` : 'Kayıt sebebi tespit edilemedi.'}`,
      );
    }
    // ─── MUTABAKAT / SESSİZ-KAYIP UYARISI ───
    // Kullanıcı isteği: "15 belge varken sisteme daha az inerse uyarı versin, fark
    // etmezsek ruhumuz duymaz." Üç kontrol:
    //  1) Agent Luca'da N belge saymış ama portalda kayıt (yeni+mükerrer) N'den az → eksik.
    //  2) ZIP'te X ayrı fatura vardı ama X'ten azı portala düştü → mükerrer-çakışması (kayıp).
    //  3) Hata nedeniyle atlanan (skipped) varsa → ayrıca belirt.
    const uyarilar: string[] = [];
    const kaydedilen = inserted + duplicate; // portalda artık bu faturalar mevcut
    const distinctParsed = parsedKeys.size;
    const savedDistinct = savedKeys.size;
    if (bulunan != null && kaydedilen < bulunan) {
      uyarilar.push(
        `⚠️ EKSİK: Luca'da ${bulunan} belge görünüyordu ama portala ${kaydedilen} fatura işlendi ` +
        `(${bulunan - kaydedilen} belge eksik). İndirme yarım kalmış olabilir; tekrar çekmeyi deneyin.`,
      );
    }
    if (distinctParsed > savedDistinct) {
      uyarilar.push(
        `⚠️ ÇAKIŞMA: ZIP'te ${distinctParsed} ayrı fatura vardı ama ${savedDistinct} tanesi kaydedilebildi ` +
        `(${distinctParsed - savedDistinct} fatura mükerrer-çakışmasına takıldı). Belge no/ETTN tekrarı olabilir.`,
      );
    }
    if (skipped > 0) {
      uyarilar.push(`⚠️ ${skipped} fatura hata nedeniyle atlandı.${errors.length ? ' İlk: ' + errors[0] : ''}`);
    }
    meta.bulunan = bulunan;
    meta.distinctParsed = distinctParsed;
    meta.savedDistinct = savedDistinct;
    meta.uyarilar = uyarilar;

    // ─── GEÇİCİ TEŞHİS (kök sebep bulununca kaldırılacak) ───
    // 16 ETTN farklı ama inserted=0 → faturaNo çakışması şüphesi. Her faturanın
    // ham ettn:faturaNo değerini ve faturaNo tekrar sayısını job loguna bas.
    try {
      const noSayac: Record<string, number> = {};
      for (const f of parsed as any[]) {
        const n = (f.faturaNo || '-').toString();
        noSayac[n] = (noSayac[n] || 0) + 1;
      }
      const tekrarliNolar = Object.entries(noSayac).filter(([, c]) => c > 1).map(([n, c]) => `${n}×${c}`);
      const ornek = (parsed as any[]).slice(0, 16)
        .map((f) => `${(f.ettn || '-').toString().slice(0, 8)}:${(f.faturaNo || '-')}`)
        .join(' , ');
      uyarilar.push(
        `[TEŞHİS v3] parse=${parsed.length} ins=${inserted} dup=${duplicate} skip=${skipped} | ` +
        `tekrarliBelgeNo=[${tekrarliNolar.join(', ') || 'yok'}] :: ${ornek}`,
      );
    } catch {}

    if (uyarilar.length) {
      this.logger.warn(`[MUTABAKAT] ${taxpayerLabel} ${jobDonem} ${tip}/${belgeKaynak}: ${uyarilar.join(' | ')}`);
    }

    return { inserted, duplicate, skipped, total: parsed.length, uyarilar, meta };
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
          // Mihsap upload tracking — DB'de kolon var (cleanup-migrations PATCH ile eklendi)
          mihsapUploadedAt: true, mihsapUploadStatus: true, mihsapUploadError: true,
          taxpayer: { select: { taxNumber: true } },
        },
      }),
      (this.prisma as any).earsivFatura.count({ where }),
    ]);

    const safeRows = rows
      .filter((row: any) => this.invoiceTaxpayerMatches(row, row.taxpayer?.taxNumber, row.tip))
      .map(({ taxpayer, ...row }: any) => row);

    // v2.3: Her e-arsiv faturasi icin Fatura Merkezi (InvoiceAccountingDocument) durumunu join et
    // - source='earsiv', sourceRefId=earsivFatura.id ile eslestir
    // - UI bu durumu rozet olarak gosterir
    const rowIds = safeRows.map((r: any) => r.id);
    let accountingMap = new Map<string, { id: string; status: string; ocrStatus?: string; lucaStatus?: string }>();
    if (rowIds.length > 0) {
      try {
        const accDocs = await (this.prisma as any).invoiceAccountingDocument.findMany({
          where: { tenantId, source: 'earsiv', sourceRefId: { in: rowIds } },
          select: { id: true, sourceRefId: true, status: true, ocrStatus: true, lucaStatus: true },
        });
        for (const d of accDocs) {
          if (d.sourceRefId) {
            accountingMap.set(d.sourceRefId, {
              id: d.id,
              status: d.status,
              ocrStatus: d.ocrStatus || undefined,
              lucaStatus: d.lucaStatus || undefined,
            });
          }
        }
      } catch (e: any) {
        this.logger.warn(`InvoiceAccountingDocument join hata: ${e?.message || e}`);
      }
    }
    const rowsWithAccounting = safeRows.map((r: any) => ({
      ...r,
      accounting: accountingMap.get(r.id) || null,
    }));

    return { rows: rowsWithAccounting, total: rowsWithAccounting.length, page, pageSize };
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
        xmlContent: true, pdfStorageKey: true, htmlStorageKey: true, zipSourceName: true,
        fetchJobId: true, createdAt: true, updatedAt: true,
      },
    });
    if (!f) throw new NotFoundException('Fatura bulunamadi');
    return f;
  }

  async getOriginalHtml(tenantId: string, id: string): Promise<{ html: string; filename: string }> {
    const f = await (this.prisma as any).earsivFatura.findFirst({
      where: { tenantId, id },
      select: { faturaNo: true, htmlStorageKey: true },
    });
    if (!f) throw new NotFoundException('Fatura bulunamadi');
    if (!f.htmlStorageKey) throw new NotFoundException('Orijinal HTML bulunamadi');
    const html = (await this.storage.getBuffer(f.htmlStorageKey)).toString('utf8');
    if (!html.trim()) throw new NotFoundException('Orijinal HTML bos');
    return { html, filename: `${this.safeFilePart(f.faturaNo)}.html` };
  }

  async getOriginalPdf(tenantId: string, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const f = await (this.prisma as any).earsivFatura.findFirst({
      where: { tenantId, id },
      select: { faturaNo: true, pdfStorageKey: true },
    });
    if (!f) throw new NotFoundException('Fatura bulunamadi');
    if (!f.pdfStorageKey) throw new NotFoundException('Orijinal PDF bulunamadı');
    const buffer = await this.storage.getBuffer(f.pdfStorageKey);
    if (!buffer.length) throw new NotFoundException('Orijinal PDF boş');
    return { buffer, filename: `${this.safeFilePart(f.faturaNo)}.pdf` };
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
        xmlContent: true, pdfStorageKey: true, htmlStorageKey: true, satici: true, alici: true,
      },
    });

    const zip = new JSZip();
    for (const f of faturas) {
      const baseName = `${f.tip}_${f.donem}_${(f.faturaNo || f.id).replace(/[^A-Za-z0-9._-]/g, '_')}`;
      if (f.xmlContent) {
        zip.file(`${baseName}.xml`, f.xmlContent);
      }
      if (f.pdfStorageKey) {
        try {
          const pdf = await this.storage.getBuffer(f.pdfStorageKey);
          if (pdf.length) zip.file(`${baseName}.pdf`, pdf);
        } catch (e: any) {
          this.logger.warn(`Orijinal PDF ZIP'e eklenemedi (${f.faturaNo}): ${e?.message}`);
        }
      }
      if (f.htmlStorageKey) {
        try {
          const html = await this.storage.getBuffer(f.htmlStorageKey);
          if (html.length) zip.file(`${baseName}.html`, html);
        } catch (e: any) {
          this.logger.warn(`Orijinal HTML ZIP'e eklenemedi (${f.faturaNo}): ${e?.message}`);
        }
      }
    }
    return zip.generateAsync({ type: 'nodebuffer' });
  }
}
