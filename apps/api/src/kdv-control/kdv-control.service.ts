import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ExcelParserService } from './excel-parser.service';
import { OcrService } from './ocr.service';
import { ReconciliationEngine } from './reconciliation.engine';
import { LucaService } from '../luca/luca.service';
import { LucaAutoScraperService } from '../luca/luca-auto-scraper.service';
import { randomUUID } from 'crypto';

@Injectable()
export class KdvControlService {
  private readonly logger = new Logger(KdvControlService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private excelParser: ExcelParserService,
    private ocrService: OcrService,
    private reconciliation: ReconciliationEngine,
    @Inject(forwardRef(() => LucaService))
    private luca: LucaService,
    @Inject(forwardRef(() => LucaAutoScraperService))
    private lucaAutoScraper: LucaAutoScraperService,
  ) {}

  private readonly VALID_TYPES = ['KDV_191', 'KDV_391', 'ISLETME_GELIR', 'ISLETME_GIDER'] as const;
  private readonly ISLETME_TYPES = ['ISLETME_GELIR', 'ISLETME_GIDER'];

  /** Oturum listesi */
  async findSessions(tenantId: string) {
    return this.prisma.kdvControlSession.findMany({
      where: { tenantId },
      include: {
        _count: { select: { kdvRecords: true, images: true, results: true } },
        taxpayer: { select: { id: true, firstName: true, lastName: true, companyName: true, taxNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Oturum detayı */
  async findSession(id: string, tenantId: string) {
    const session = await this.prisma.kdvControlSession.findFirst({
      where: { id, tenantId },
      include: {
        _count: { select: { kdvRecords: true, images: true } },
        taxpayer: { select: { id: true, firstName: true, lastName: true, companyName: true, taxNumber: true } },
      },
    });
    if (!session) throw new NotFoundException('Oturum bulunamadı');
    return session;
  }

  /** Oturum sil */
  async deleteSession(id: string, tenantId: string) {
    const session = await this.findSession(id, tenantId);
    
    // İlişkili kayıtları sil (cascade delete yerine manuel)
    await this.prisma.reconciliationResult.deleteMany({ where: { sessionId: id } });
    await this.prisma.kdvRecord.deleteMany({ where: { sessionId: id } });
    await this.prisma.receiptImage.deleteMany({ where: { sessionId: id } });
    await this.prisma.kdvControlSession.delete({ where: { id } });
    
    return { deleted: true };
  }

  /**
   * Mükellef + dönem + tip kombinasyonu için var olan seansı bul;
   * yoksa yenisini oluştur. Ana akışta kullanılır (Mihsap deseni gibi
   * tek ekrandan iş yaparken).
   */
  async findOrCreateSession(
    tenantId: string,
    userId: string,
    dto: {
      type: 'KDV_191' | 'KDV_391' | 'ISLETME_GELIR' | 'ISLETME_GIDER';
      periodLabel: string;
      taxpayerId?: string;
      notes?: string;
    },
  ) {
    if (!this.VALID_TYPES.includes(dto.type as any)) {
      throw new BadRequestException(`Geçersiz kontrol türü: ${dto.type}`);
    }
    const existing = await this.prisma.kdvControlSession.findFirst({
      where: {
        tenantId,
        type: dto.type as any,
        periodLabel: dto.periodLabel,
        taxpayerId: dto.taxpayerId || null,
      },
      include: {
        taxpayer: { select: { id: true, firstName: true, lastName: true, companyName: true, taxNumber: true } },
        _count: { select: { kdvRecords: true, images: true, results: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return { session: existing, created: false };
    const created = await this.createSession(tenantId, userId, dto);
    return { session: created, created: true };
  }

  /** Yeni oturum oluştur */
  async createSession(
    tenantId: string,
    userId: string,
    dto: {
      type: 'KDV_191' | 'KDV_391' | 'ISLETME_GELIR' | 'ISLETME_GIDER';
      periodLabel: string;
      taxpayerId?: string;
      notes?: string;
    },
  ) {
    if (!this.VALID_TYPES.includes(dto.type as any)) {
      throw new BadRequestException(`Geçersiz kontrol türü: ${dto.type}`);
    }

    // taxpayerId varsa tenant'a ait olduğunu doğrula
    if (dto.taxpayerId) {
      const taxpayer = await this.prisma.taxpayer.findFirst({
        where: { id: dto.taxpayerId, tenantId },
      });
      if (!taxpayer) throw new BadRequestException('Mükellef bulunamadı veya yetkisiz erişim');
    }

    return this.prisma.kdvControlSession.create({
      data: {
        tenantId,
        type: dto.type as any,
        periodLabel: dto.periodLabel,
        taxpayerId: dto.taxpayerId || null,
        notes: dto.notes,
        createdBy: userId,
      },
      include: {
        taxpayer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
      },
    });
  }

  /**
   * Excel dosyasını yükle ve parse et.
   * Multipart/form-data yerine buffer + meta alır.
   */
  async uploadExcel(
    sessionId: string,
    tenantId: string,
    buffer: Buffer,
  ) {
    await this.findSession(sessionId, tenantId);

    // Mevcut kayıtları temizle
    await this.prisma.kdvRecord.deleteMany({ where: { sessionId } });

    // Session type'a göre doğru parser'ı seç
    const session = await this.prisma.kdvControlSession.findUnique({ where: { id: sessionId } });
    const rows = this.ISLETME_TYPES.includes(session!.type)
      ? this.excelParser.parseIsletmeExcel(buffer, session!.type as 'ISLETME_GELIR' | 'ISLETME_GIDER')
      : this.excelParser.parseKdvExcel(buffer, session!.type === 'KDV_191' ? '191' : '391');
    if (rows.length === 0) {
      throw new BadRequestException(
        'Excel dosyasında KDV satırı bulunamadı. Sütun isimlerini kontrol edin.',
      );
    }

    try {
      await this.prisma.kdvRecord.createMany({
        data: rows.map((r) => ({
          sessionId,
          rowIndex:   r.rowIndex,
          belgeNo:    r.belgeNo,
          belgeDate:  r.belgeDate,
          karsiTaraf: r.karsiTaraf,
          kdvMatrahi: r.kdvMatrahi,
          kdvTutari:  r.kdvTutari,
          kdvOrani:   r.kdvOrani,
          aciklama:   r.aciklama,
          rawData:    r.rawData,
        })),
      });
    } catch (err: any) {
      this.logger.error(
        `createMany hatası: ${err?.message} | İlk satır: ${JSON.stringify(rows[0]?.rawData ?? {})}`,
      );
      throw new InternalServerErrorException(
        'Kayıt oluşturma hatası: ' + (err?.message ?? 'Bilinmeyen hata'),
      );
    }

    await this.prisma.kdvControlSession.update({
      where: { id: sessionId },
      data: { status: 'PROCESSING' },
    });

    return { parsed: rows.length };
  }

  /** KDV kayıtları listesi */
  async getKdvRecords(sessionId: string, tenantId: string) {
    await this.findSession(sessionId, tenantId);
    return this.prisma.kdvRecord.findMany({
      where: { sessionId },
      include: { result: true },
      orderBy: { rowIndex: 'asc' },
    });
  }

  /**
   * Görsel yükleme — presigned URL al
   */
  async initiateImageUpload(
    sessionId: string,
    tenantId: string,
    dto: { originalName: string; mimeType: string },
  ) {
    await this.findSession(sessionId, tenantId);
    const ext = dto.originalName.split('.').pop() || 'jpg';
    const s3Key = `kdv-control/${tenantId}/${sessionId}/${randomUUID()}.${ext}`;

    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

    // StorageService'in S3 client'ını kullan
    const uploadUrl = await (this.storage as any).getPresignedUploadUrl(
      tenantId,
      sessionId,
      dto.originalName,
      dto.mimeType,
    );

    return { ...uploadUrl, s3Key: uploadUrl.s3Key };
  }

  /**
   * Doğrudan buffer yükleme (presigned URL gerektirmez).
   * Controller'daki multipart upload endpoint'i bunu kullanır.
   */
  async uploadImageBuffer(
    sessionId: string,
    tenantId: string,
    buffer: Buffer,
    originalName: string,
    mimeType: string,
  ) {
    await this.findSession(sessionId, tenantId);
    const ext = originalName.split('.').pop() || 'jpg';
    const s3Key = `kdv-control/${tenantId}/${sessionId}/${randomUUID()}.${ext}`;

    // S3 yüklemesini dene — hata olsa bile DB kaydı ve OCR devam eder
    try {
      await this.storage.putBuffer(s3Key, buffer, mimeType, {
        'original-name': encodeURIComponent(originalName),
        'session-id': sessionId,
      });
    } catch (storageErr) {
      this.logger.warn(`S3 yükleme başarısız (OCR devam ediyor): ${storageErr?.message}`);
    }

    const image = await this.prisma.receiptImage.create({
      data: {
        sessionId,
        s3Key,
        originalName,
        mimeType,
        sizeBytes: buffer.length,
        ocrStatus: 'PENDING',
      },
    });

    // OCR'u bellekteki buffer'dan çalıştır — dosya adını da geçir (belgeNo çıkarımı için)
    this.runOcrForBuffer(image.id, buffer, originalName).catch((e) =>
      this.logger.error(`OCR arka plan hatası [${image.id}]: ${e?.message}`),
    );
    return image;
  }

  /**
   * Görsel onaylama — S3'e yüklendikten sonra DB'ye kaydet + OCR başlat
   */
  async confirmImageUpload(
    sessionId: string,
    tenantId: string,
    dto: { s3Key: string; originalName: string; mimeType: string },
  ) {
    await this.findSession(sessionId, tenantId);
    const meta = await this.storage.getObjectMeta(dto.s3Key);
    if (!meta) throw new BadRequestException('Görsel S3\'e henüz yüklenmemiş');

    const image = await this.prisma.receiptImage.create({
      data: {
        sessionId,
        s3Key: dto.s3Key,
        originalName: dto.originalName,
        mimeType: dto.mimeType,
        sizeBytes: meta.sizeBytes,
        ocrStatus: 'PENDING',
      },
    });

    // OCR'yi asenkron başlat (fire & forget)
    this.runOcrForImage(image.id, dto.s3Key).catch(() => {});

    return image;
  }

  /** OCR işlemi — buffer doğrudan (S3'e gerek yok) */
  private async runOcrForBuffer(imageId: string, buffer: Buffer, originalName?: string) {
    try {
      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: { ocrStatus: 'PROCESSING' },
      });

      const ocrResult = await this.ocrService.extractFromImage(buffer, originalName);
      const isLow = this.ocrService.isLowConfidence(ocrResult);

      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: {
          ocrStatus: isLow ? 'LOW_CONFIDENCE' : 'SUCCESS',
          ocrBelgeNo: ocrResult.belgeNo,
          ocrDate: ocrResult.date,
          ocrKdvTutari: ocrResult.kdvTutari,
          ocrRawText: ocrResult.rawText?.substring(0, 2000),
          ocrConfidence: ocrResult.confidence,
        },
      });
    } catch (err) {
      this.logger.error(`runOcrForBuffer [${imageId}]: ${err?.message}`);
      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: { ocrStatus: 'FAILED' },
      });
    }
  }

  /** OCR işlemi — S3'ten indirerek (presigned upload sonrası kullanılır) */
  private async runOcrForImage(imageId: string, s3Key: string) {
    try {
      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: { ocrStatus: 'PROCESSING' },
      });

      // S3'ten görseli indir
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const s3 = (this.storage as any).s3;
      const bucket = this.storage.getBucket();
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
      const chunks: Buffer[] = [];
      for await (const chunk of res.Body as any) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      const ocrResult = await this.ocrService.extractFromImage(buffer);
      const isLow = this.ocrService.isLowConfidence(ocrResult);

      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: {
          ocrStatus: isLow ? 'LOW_CONFIDENCE' : 'SUCCESS',
          ocrBelgeNo: ocrResult.belgeNo,
          ocrDate: ocrResult.date,
          ocrKdvTutari: ocrResult.kdvTutari,
          ocrRawText: ocrResult.rawText?.substring(0, 2000),
          ocrConfidence: ocrResult.confidence,
        },
      });
    } catch {
      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: { ocrStatus: 'FAILED' },
      });
    }
  }

  /** Görseller listesi */
  async getImages(sessionId: string, tenantId: string) {
    await this.findSession(sessionId, tenantId);
    return this.prisma.receiptImage.findMany({
      where: { sessionId },
      include: { result: true },
      orderBy: { uploadedAt: 'asc' },
    });
  }

  /** Görsel indirme URL'i */
  async getImageDownloadUrl(imageId: string, tenantId: string) {
    const image = await this.prisma.receiptImage.findFirst({
      where: { id: imageId, session: { tenantId } },
    });
    if (!image) throw new NotFoundException('Görsel bulunamadı');
    const url = await this.storage.getPresignedDownloadUrl(
      image.s3Key,
      image.originalName,
    );
    return { url };
  }

  /** Kullanıcı OCR değerlerini düzeltir / teyit eder */
  async confirmImageOcr(
    imageId: string,
    tenantId: string,
    dto: {
      belgeNo?: string;
      date?: string;
      kdvTutari?: string;
    },
  ) {
    const image = await this.prisma.receiptImage.findFirst({
      where: { id: imageId, session: { tenantId } },
    });
    if (!image) throw new NotFoundException('Görsel bulunamadı');

    return this.prisma.receiptImage.update({
      where: { id: imageId },
      data: {
        confirmedBelgeNo: dto.belgeNo ?? image.ocrBelgeNo,
        confirmedDate: dto.date ?? image.ocrDate,
        confirmedKdvTutari: dto.kdvTutari ?? image.ocrKdvTutari,
        isManuallyConfirmed: true,
        ocrStatus: 'SUCCESS',
      },
    });
  }

  /** Görseli sil (DB) — S3'ten silme şimdilik atlanıyor */
  async deleteImage(imageId: string, tenantId: string) {
    const image = await this.prisma.receiptImage.findFirst({
      where: { id: imageId, session: { tenantId } },
    });
    if (!image) throw new NotFoundException('Görsel bulunamadı');

    // DB'den sil (S3'ten silme şimdilik devre dışı — storage.delete metodu yok)
    await this.prisma.receiptImage.delete({ where: { id: imageId } });
    return { deleted: true };
  }

  /** Eşleştirme motorunu çalıştır */
  async runReconciliation(sessionId: string, tenantId: string) {
    await this.findSession(sessionId, tenantId);
    return this.reconciliation.runReconciliation(sessionId);
  }

  /** Eşleştirme sonuçları */
  async getResults(sessionId: string, tenantId: string) {
    await this.findSession(sessionId, tenantId);
    return this.prisma.reconciliationResult.findMany({
      where: { sessionId },
      include: {
        kdvRecord: true,
        image: true,
      },
      orderBy: [{ status: 'asc' }, { matchScore: 'desc' }],
    });
  }

  /**
   * Eşleştirme sonuçlarını Excel olarak dışa aktar — SONUÇ formatı.
   * `autoArchive=true` (default) ise indirilen dosya otomatik olarak
   * `kdvControlOutput` tablosuna arşivlenir.
   */
  async exportResultsToExcel(
    sessionId: string,
    tenantId: string,
    opts: { autoArchive?: boolean; createdBy?: string } = {},
  ): Promise<Buffer> {
    const session = await this.findSession(sessionId, tenantId);
    
    const results = await this.prisma.reconciliationResult.findMany({
      where: { sessionId },
      include: { kdvRecord: true, image: true },
      orderBy: [{ status: 'asc' }, { matchScore: 'desc' }],
    });

    const xlsx = await import('xlsx');
    
    // SONUÇ formatına göre veri hazırla
    const data = results.map((r: any) => {
      const gorselTarih = r.image?.confirmedDate || r.image?.ocrDate || '';
      const excelTarih = r.kdvRecord?.belgeDate ? new Date(r.kdvRecord.belgeDate).toLocaleDateString('tr-TR') : '';
      const gorselBelgeNo = r.image?.confirmedBelgeNo || r.image?.ocrBelgeNo || '';
      const excelBelgeNo = r.kdvRecord?.belgeNo || '';
      const gorselKdv = r.image?.confirmedKdvTutari || r.image?.ocrKdvTutari || '';
      const excelKdv = r.kdvRecord?.kdvTutari || '';
      
      let durum = '';
      if (r.status === 'MATCHED') durum = '✅ Eşleşti';
      else if (r.status === 'PARTIAL') durum = '⚠️ Kısmi Eşleşme';
      else if (r.status === 'UNMATCHED') durum = '❌ Eşleşmedi';
      else if (!r.image) durum = 'Görsel bulunamadı';
      else durum = r.mismatchReasons?.join(', ') || 'Bilinmeyen';
      
      return {
        'Görsel Tarih': gorselTarih,
        'Excel Tarih': excelTarih,
        'Görsel Belge No': gorselBelgeNo,
        'Excel Belge No': excelBelgeNo,
        'Görsel KDV': gorselKdv,
        'Excel İlgili Tutar': excelKdv,
        'Durum': durum,
      };
    });

    const ws = xlsx.utils.json_to_sheet(data);
    
    // Sütun genişliklerini ayarla
    ws['!cols'] = [
      { wch: 15 }, // Görsel Tarih
      { wch: 15 }, // Excel Tarih
      { wch: 20 }, // Görsel Belge No
      { wch: 20 }, // Excel Belge No
      { wch: 15 }, // Görsel KDV
      { wch: 20 }, // Excel İlgili Tutar
      { wch: 25 }, // Durum
    ];
    
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'KDV Kontrol Sonuçları');

    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    // Arşive kaydet (fiş yazdırmadaki gibi — geriye dönük erişim)
    if (opts.autoArchive !== false) {
      try {
        const session = await this.prisma.kdvControlSession.findUnique({
          where: { id: sessionId },
          include: { taxpayer: true },
        });
        const matchedCount = results.filter((r) => r.status === 'MATCHED').length;
        const partialCount = results.filter((r) => r.status === 'PARTIAL_MATCH').length;
        const unmatchedCount = results.filter((r) => r.status === 'UNMATCHED' || r.status === 'NEEDS_REVIEW').length;
        const mukellefName = session?.taxpayer
          ? session.taxpayer.companyName ||
            `${session.taxpayer.firstName ?? ''} ${session.taxpayer.lastName ?? ''}`.trim()
          : null;

        const filename = `kdv-kontrol-${session?.periodLabel?.replace('/', '-') || sessionId}-${new Date().toISOString().slice(0, 10)}.xlsx`;

        await (this.prisma as any).kdvControlOutput.create({
          data: {
            tenantId,
            sessionId,
            taxpayerId: session?.taxpayerId || null,
            mukellefName,
            donem: session?.periodLabel || null,
            tip: session?.type || null,
            matchedCount,
            partialCount,
            unmatchedCount,
            totalRecords: await this.prisma.kdvRecord.count({ where: { sessionId } }),
            totalImages: await this.prisma.receiptImage.count({ where: { sessionId } }),
            filename,
            fileBytes: buffer,
            fileSize: buffer.length,
            createdBy: opts.createdBy || null,
          },
        });
      } catch (e: any) {
        this.logger.warn(`KDV çıktı arşive yazılamadı: ${e?.message}`);
      }
    }

    return buffer;
  }

  // ============================================================
  // ÇIKTI ARŞİVİ (fiş yazdırmadaki gibi)
  // ============================================================

  /** Tenant'a ait tüm KDV kontrol çıktılarını listeler (bayt içeriği hariç). */
  async listOutputs(tenantId: string, limit = 100) {
    return (this.prisma as any).kdvControlOutput.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        sessionId: true,
        taxpayerId: true,
        mukellefName: true,
        donem: true,
        tip: true,
        matchedCount: true,
        partialCount: true,
        unmatchedCount: true,
        totalRecords: true,
        totalImages: true,
        filename: true,
        fileSize: true,
        createdAt: true,
      },
    });
  }

  /** Bir çıktıyı (içeriğiyle birlikte) getirir. */
  async getOutput(tenantId: string, outputId: string) {
    const rec = await (this.prisma as any).kdvControlOutput.findUnique({
      where: { id: outputId },
    });
    if (!rec || rec.tenantId !== tenantId) return null;
    return rec;
  }

  /** Bir çıktıyı siler. */
  async deleteOutput(tenantId: string, outputId: string) {
    const rec = await (this.prisma as any).kdvControlOutput.findUnique({
      where: { id: outputId },
    });
    if (!rec || rec.tenantId !== tenantId) return { deleted: 0 };
    await (this.prisma as any).kdvControlOutput.delete({ where: { id: outputId } });
    return { deleted: 1 };
  }

  /** Oturum özet istatistikleri (sayaç) */
  async getSessionStats(sessionId: string, tenantId: string) {
    await this.findSession(sessionId, tenantId);

    const [totalRecords, totalImages, results] = await Promise.all([
      this.prisma.kdvRecord.count({ where: { sessionId } }),
      this.prisma.receiptImage.count({ where: { sessionId } }),
      this.prisma.reconciliationResult.groupBy({
        by: ['status'],
        where: { sessionId },
        _count: { status: true },
      }),
    ]);

    const statusMap: Record<string, number> = {};
    results.forEach((r) => (statusMap[r.status] = r._count.status));

    const needsConfirm = await this.prisma.receiptImage.count({
      where: { sessionId, ocrStatus: { in: ['LOW_CONFIDENCE', 'FAILED'] }, isManuallyConfirmed: false },
    });

    return {
      totalRecords,
      totalImages,
      matched: statusMap['MATCHED'] ?? 0,
      partialMatch: statusMap['PARTIAL_MATCH'] ?? 0,
      unmatched: statusMap['UNMATCHED'] ?? 0,
      needsReview: statusMap['NEEDS_REVIEW'] ?? 0,
      confirmed: statusMap['CONFIRMED'] ?? 0,
      rejected: statusMap['REJECTED'] ?? 0,
      needsOcrConfirm: needsConfirm,
    };
  }

  /** Eşleşmeyi kullanıcı teyit eder */
  async resolveResult(
    resultId: string,
    tenantId: string,
    userId: string,
    action: 'CONFIRMED' | 'REJECTED',
    notes?: string,
  ) {
    const result = await this.prisma.reconciliationResult.findFirst({
      where: { id: resultId, session: { tenantId } },
    });
    if (!result) throw new NotFoundException('Sonuç bulunamadı');

    return this.prisma.reconciliationResult.update({
      where: { id: resultId },
      data: { status: action, resolvedBy: userId, resolvedAt: new Date(), notes },
    });
  }

  // ============================================================
  // OTOMATİK ÇEKİM AKIŞI (Luca + Mihsap)
  // ============================================================

  /**
   * Luca'dan muavin/işletme defteri verisini otomatik çekmek için
   * bir Luca fetch job oluşturur. Runner (moren-agent.js) bu job'u
   * Luca sayfasında çalıştırır — Excel indirip buraya yollar.
   *
   * Döndürülen `jobId` ile frontend durumu polll edebilir.
   */
  async queueLucaImport(sessionId: string, tenantId: string, userId: string) {
    const session = await this.findSession(sessionId, tenantId);
    if (!session.taxpayerId) {
      throw new BadRequestException(
        'Bu oturuma Luca\'dan otomatik çekim için önce mükellef atanmalı',
      );
    }

    // Mevcut KDV kayıtlarını temizle (yeniden çekim)
    await this.prisma.kdvRecord.deleteMany({ where: { sessionId } });

    // Mükellef bilgisini çek (Luca'da arama için)
    const taxpayer = await this.prisma.taxpayer.findUnique({
      where: { id: session.taxpayerId },
    });
    const mukellefAdi =
      taxpayer?.companyName ||
      [taxpayer?.firstName, taxpayer?.lastName].filter(Boolean).join(' ') ||
      taxpayer?.taxNumber ||
      '';

    const donem = this.toDashDonem(session.periodLabel);

    // 1. ÖNCELİK: Portala kaydedilmiş Luca hesabı varsa → direkt Playwright scrape
    const credStatus = await this.lucaAutoScraper.getCredentialStatus(tenantId);
    if (credStatus.connected && credStatus.isActive) {
      // Async çalıştır — kullanıcıyı bekletmeyelim
      this.runAutoScrapeBackground(sessionId, tenantId, {
        tip: session.type,
        donem,
        mukellefAdi,
        createdBy: userId,
      }).catch((e) => this.logger.error(`Auto scrape arka plan hata: ${e?.message}`));

      await this.prisma.kdvControlSession.update({
        where: { id: sessionId },
        data: { status: 'PROCESSING' },
      });
      return { status: 'auto-scraping', method: 'playwright' };
    }

    // 2. FALLBACK: Bookmarklet akışı (Luca sekmesi + moren-agent.js)
    const lucaSession = await this.luca.getSession(tenantId);
    if (!lucaSession) {
      throw new BadRequestException(
        'Luca hesabı kayıtlı değil. Ayarlar → Luca Hesabı\'ndan kullanıcı adı/şifre girin, ya da Luca sayfasını açıp Moren Agent bookmarklet\'ini çalıştırın.',
      );
    }

    const job = await this.luca.createFetchJob({
      tenantId,
      sessionId,
      mukellefId: session.taxpayerId,
      donem,
      tip: session.type,
      createdBy: userId,
    });

    await this.prisma.kdvControlSession.update({
      where: { id: sessionId },
      data: { status: 'PROCESSING' },
    });

    return { jobId: job.id, status: 'queued', method: 'bookmarklet' };
  }

  /**
   * Arka planda Playwright ile Luca'ya login olup Excel'i indirir ve
   * parse eder. `queueLucaImport`'tan fire-and-forget olarak çağrılır.
   */
  private async runAutoScrapeBackground(
    sessionId: string,
    tenantId: string,
    params: { tip: string; donem: string; mukellefAdi: string; createdBy?: string },
  ): Promise<void> {
    const job = await this.luca.createFetchJob({
      tenantId,
      sessionId,
      mukellefId: '',
      donem: params.donem,
      tip: params.tip,
      createdBy: params.createdBy,
    });
    await this.luca.markJobRunning(job.id);

    try {
      const buffer = await this.lucaAutoScraper.fetchMuavinExcel({
        tenantId,
        tip: params.tip,
        donem: params.donem,
        mukellefAdi: params.mukellefAdi,
      });
      const result = await this.uploadExcel(sessionId, tenantId, buffer);
      await this.luca.markJobDone(job.id, result.parsed);
      this.logger.log(`Luca auto-scrape tamamlandı: ${result.parsed} satır`);
    } catch (e: any) {
      const msg = e?.message || 'bilinmeyen hata';
      this.logger.error(`Luca auto-scrape hata: ${msg}`);
      await this.luca.markJobFailed(job.id, msg);
    }
  }

  /**
   * Runner Luca'dan Excel'i indirdikten sonra bu endpoint ile yükler.
   * `uploadExcel` ile aynı ama ayrı bir `jobId` ile job durumunu
   * "done" olarak işaretler.
   */
  async uploadExcelFromRunner(
    sessionId: string,
    tenantId: string,
    jobId: string,
    buffer: Buffer,
  ) {
    try {
      const result = await this.uploadExcel(sessionId, tenantId, buffer);
      await this.luca.markJobDone(jobId, result.parsed);
      return result;
    } catch (e: any) {
      await this.luca.markJobFailed(jobId, e?.message || 'Excel parse hatası');
      throw e;
    }
  }

  /**
   * Mevcut Mihsap fatura kayıtlarını bu KDV Kontrol oturumuna
   * görsel (`receiptImage`) olarak bağlar. Hiçbir dosya yüklenmez —
   * zaten Mihsap CDN'de duran görseller `mihsapFileLink` üstünden
   * OCR'a verilir.
   *
   * `session.taxpayerId` + `session.periodLabel` ile `mihsapInvoice`
   * tablosu filtrelenir. `KDV_191 / ISLETME_GIDER` → ALIS faturaları,
   * `KDV_391 / ISLETME_GELIR` → SATIS faturaları.
   */
  async linkMihsapInvoices(sessionId: string, tenantId: string) {
    const session = await this.findSession(sessionId, tenantId);
    if (!session.taxpayerId) {
      throw new BadRequestException(
        'Fatura bağlama için önce mükellef atanmalı',
      );
    }

    const donem = this.toDashDonem(session.periodLabel); // YYYY-MM
    const faturaTuru =
      session.type === 'KDV_391' || session.type === 'ISLETME_GELIR'
        ? 'SATIS'
        : 'ALIS';

    const invoices = await (this.prisma as any).mihsapInvoice.findMany({
      where: {
        tenantId,
        mukellefId: session.taxpayerId,
        donem,
        faturaTuru,
      },
      orderBy: { faturaTarihi: 'asc' },
    });

    if (invoices.length === 0) {
      throw new BadRequestException(
        `Bu mükellefin ${donem} döneminde (${faturaTuru}) Mihsap'tan çekilmiş faturası yok. Önce Mihsap'tan faturaları çekin.`,
      );
    }

    // Daha önce bu oturuma aynı fatura bağlanmışsa atla (mihsap s3Key bazlı)
    const existingKeys = new Set(
      (
        await this.prisma.receiptImage.findMany({
          where: { sessionId },
          select: { s3Key: true },
        })
      ).map((r) => r.s3Key),
    );

    let linked = 0;
    for (const inv of invoices) {
      const s3Key = `mihsap://${inv.id}`; // sanal key — storage'a fiziksel yüklemiyoruz
      if (existingKeys.has(s3Key)) continue;

      await this.prisma.receiptImage.create({
        data: {
          sessionId,
          s3Key,
          originalName: `${inv.faturaNo || inv.id}.${(inv.orjDosyaTuru || 'jpg').toLowerCase()}`,
          mimeType:
            inv.orjDosyaTuru?.toLowerCase().includes('pdf')
              ? 'application/pdf'
              : 'image/jpeg',
          sizeBytes: 0,
          ocrStatus: 'PENDING',
        },
      });
      linked++;
    }

    await this.prisma.kdvControlSession.update({
      where: { id: sessionId },
      data: { status: 'PROCESSING' },
    });

    return { linked, total: invoices.length, alreadyLinked: invoices.length - linked };
  }

  /**
   * Session'a bağlanmış (genelde Mihsap kaynaklı) PENDING durumdaki tüm
   * görsellerin OCR'ını toplu başlatır. Tek tek asenkron tetiklenir;
   * çağıran beklemez. Frontend polling ile durumu izler.
   */
  async startOcrForSession(sessionId: string, tenantId: string) {
    await this.findSession(sessionId, tenantId);

    const pending = await this.prisma.receiptImage.findMany({
      where: { sessionId, ocrStatus: 'PENDING' },
    });

    if (pending.length === 0) {
      return { queued: 0, message: 'Bekleyen görsel yok' };
    }

    let queued = 0;
    for (const img of pending) {
      // Mihsap bağlı görsellerde s3Key `mihsap://<invoiceId>` deseni
      if (img.s3Key?.startsWith('mihsap://')) {
        const invoiceId = img.s3Key.slice('mihsap://'.length);
        this.runOcrForMihsapInvoice(img.id, invoiceId, tenantId).catch((e) =>
          this.logger.error(`OCR mihsap hata [${img.id}]: ${e?.message}`),
        );
      } else {
        this.runOcrForImage(img.id, img.s3Key).catch((e) =>
          this.logger.error(`OCR hata [${img.id}]: ${e?.message}`),
        );
      }
      queued++;
    }

    return { queued, total: pending.length };
  }

  /**
   * Mihsap kaynaklı fatura için OCR çalıştır:
   * 1) Mihsap CDN'den görseli indir
   * 2) OcrService'e ver
   * 3) receiptImage kaydını güncelle
   */
  private async runOcrForMihsapInvoice(
    imageId: string,
    mihsapInvoiceId: string,
    tenantId: string,
  ) {
    try {
      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: { ocrStatus: 'PROCESSING' },
      });

      const inv = await (this.prisma as any).mihsapInvoice.findUnique({
        where: { id: mihsapInvoiceId },
      });
      if (!inv || inv.tenantId !== tenantId) {
        throw new Error('Mihsap invoice kaydı bulunamadı');
      }

      const url = inv.mihsapFileLink;
      if (!url) throw new Error('mihsapFileLink boş — görsel çekilmemiş');

      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0',
          Accept: 'image/*',
          Referer: 'https://app.mihsap.com/',
        },
      });
      if (!res.ok) throw new Error(`Mihsap CDN ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());

      // PRENSİP: Mihsap'ın ham verisine (faturaNo, faturaTarihi vb.) güvenme.
      // Tek doğru kaynak FATURA GÖRÜNTÜSÜ. Tüm alanlar görselden OCR ile okunur.
      const ocrResult = await this.ocrService.extractFromImage(buffer);
      const isLow = this.ocrService.isLowConfidence(ocrResult);

      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: {
          ocrStatus: isLow ? 'LOW_CONFIDENCE' : 'SUCCESS',
          ocrBelgeNo: ocrResult.belgeNo,
          ocrDate: ocrResult.date,
          ocrKdvTutari: ocrResult.kdvTutari,
          ocrRawText: ocrResult.rawText?.substring(0, 2000),
          ocrConfidence: ocrResult.confidence,
          // confirmed* alanlarını DOLDURMUYORUZ — Mihsap verisine güvenilmez.
          // Kullanıcı düşük güvenli sonuçları elle teyit edebilir.
        },
      });
    } catch (err: any) {
      this.logger.error(`runOcrForMihsapInvoice [${imageId}]: ${err?.message}`);
      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: { ocrStatus: 'FAILED' },
      });
    }
  }

  /** "2026/03" → "2026-03" */
  private toDashDonem(periodLabel: string): string {
    if (/^\d{4}-\d{2}$/.test(periodLabel)) return periodLabel;
    const m = periodLabel.match(/^(\d{4})[\/\-](\d{1,2})$/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
    return periodLabel;
  }

  /** Oturumu tamamlandı olarak işaretle */
  async completeSession(sessionId: string, tenantId: string) {
    const session = await this.findSession(sessionId, tenantId);
    const updated = await this.prisma.kdvControlSession.update({
      where: { id: sessionId },
      data: { status: 'COMPLETED' },
    });

    // Mükellef seçilmişse aylık KDV kontrol durumunu güncelle
    if (session.taxpayerId && session.periodLabel) {
      const [yearStr, monthStr] = session.periodLabel.split('/');
      const year = parseInt(yearStr);
      const month = parseInt(monthStr);
      if (year && month) {
        await this.prisma.taxpayerMonthlyStatus.upsert({
          where: { taxpayerId_year_month: { taxpayerId: session.taxpayerId, year, month } },
          create: { taxpayerId: session.taxpayerId, tenantId, year, month, kdvKontrolEdildi: true },
          update: { kdvKontrolEdildi: true },
        });
      }
    }

    return updated;
  }
}
