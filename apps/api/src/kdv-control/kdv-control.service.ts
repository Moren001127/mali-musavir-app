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
   * Excel'i preview eder — sütun başlıkları + örnek satırlar döner.
   * Kullanıcı mapping modalında hangi sütun hangi alan olduğunu seçecek.
   */
  async previewExcel(
    sessionId: string,
    tenantId: string,
    buffer: Buffer,
  ): Promise<{
    sheetName: string;
    sheetNames: string[];
    columns: string[];
    rowCount: number;
    sampleRows: Record<string, any>[];
    suggestedMapping: { tarihCol?: string; belgeNoCol?: string; kdvCol?: string };
  }> {
    await this.findSession(sessionId, tenantId);
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      throw new BadRequestException('Excel dosyası okunamadı — boş veya bozuk');
    }
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, {
      raw: false,
      defval: null,
    });
    if (rows.length === 0) {
      throw new BadRequestException('Excel\'de veri satırı yok');
    }
    // Sütun başlıklarını ilk satırdan al + normalize et
    const firstRow = rows[0];
    const columns = Object.keys(firstRow).map((k) =>
      k.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim(),
    );
    // Türkçe karakterleri normalize et — "İ" / "ı" / "Ş" / "ğ" vs. toLowerCase()
    // combining karakterler üretiyor, direkt string karşılaştırması başarısız oluyor.
    const normalizeTr = (s: string) =>
      s
        .replace(/İ/g, 'I').replace(/ı/g, 'i')
        .replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
        .replace(/Ş/g, 'S').replace(/ş/g, 's')
        .replace(/Ç/g, 'C').replace(/ç/g, 'c')
        .replace(/Ö/g, 'O').replace(/ö/g, 'o')
        .replace(/Ü/g, 'U').replace(/ü/g, 'u')
        .toLowerCase()
        .trim();

    // Keyword tabanlı otomatik önermesi
    const normalizedCols = columns.map(normalizeTr);
    const findBy = (patterns: string[]): string | undefined => {
      const normPatterns = patterns.map(normalizeTr);
      // Önce tam eşleşme
      for (const p of normPatterns) {
        const idx = normalizedCols.findIndex((c) => c === p);
        if (idx >= 0) return columns[idx];
      }
      // Sonra içerir
      for (const p of normPatterns) {
        const idx = normalizedCols.findIndex((c) => c.includes(p));
        if (idx >= 0) return columns[idx];
      }
      return undefined;
    };
    const suggestedMapping = {
      tarihCol: findBy(['evrak tarihi', 'belge tarihi', 'fiş tarihi', 'tarih']),
      belgeNoCol: findBy(['evrak no', 'belge no', 'fatura no', 'fiş no', 'belge numarası', 'evrak']),
      kdvCol: findBy(['kdv tutarı', 'hesaplanan kdv', 'indirilecek kdv', 'kdv', 'borç', 'alacak']),
    };
    // İlk 10 satırı örnek olarak döndür
    const sampleRows = rows.slice(0, 10).map((row) => {
      const clean: Record<string, any> = {};
      for (const [k, v] of Object.entries(row)) {
        const ck = k.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        clean[ck] = v;
      }
      return clean;
    });
    return {
      sheetName,
      sheetNames: workbook.SheetNames,
      columns,
      rowCount: rows.length,
      sampleRows,
      suggestedMapping,
    };
  }

  /**
   * Kullanıcının belirttiği sütun mapping'i ile Excel import eder.
   * tarihCol / belgeNoCol / kdvCol — her birisi Excel'deki sütun başlığı adı.
   */
  async importExcelWithMapping(
    sessionId: string,
    tenantId: string,
    buffer: Buffer,
    mapping: {
      tarihCol: string;
      belgeNoCol: string;
      kdvCol: string;
      sheetName?: string;
    },
  ): Promise<{ imported: number; skipped: number }> {
    await this.findSession(sessionId, tenantId);
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = mapping.sheetName || workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      throw new BadRequestException(`Sheet bulunamadı: ${sheetName}`);
    }
    const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, {
      raw: false,
      defval: null,
    });

    // Sütun başlıklarını normalize edip orijinal key'le eşle.
    // Türkçe karakterleri de ASCII'ye indirgeyerek karşılaştır — aksi halde
    // "İ" / "ı" / "Ş" vs toLowerCase'de combining karakter üretip eşleşmiyor.
    const normalize = (s: string) =>
      s
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/İ/g, 'I').replace(/ı/g, 'i')
        .replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
        .replace(/Ş/g, 'S').replace(/ş/g, 's')
        .replace(/Ç/g, 'C').replace(/ç/g, 'c')
        .replace(/Ö/g, 'O').replace(/ö/g, 'o')
        .replace(/Ü/g, 'U').replace(/ü/g, 'u')
        .toLowerCase();
    const findKeyInRow = (row: Record<string, any>, target: string): string | null => {
      const t = normalize(target);
      for (const k of Object.keys(row)) {
        if (normalize(k) === t) return k;
      }
      return null;
    };

    // Mevcut kayıtları temizle
    await this.prisma.kdvRecord.deleteMany({ where: { sessionId } });

    const parsed: Array<{
      rowIndex: number;
      belgeNo: string | null;
      belgeDate: Date | null;
      kdvTutari: number;
      rawData: any;
    }> = [];
    let skipped = 0;

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const tarihKey = findKeyInRow(row, mapping.tarihCol);
      const belgeKey = findKeyInRow(row, mapping.belgeNoCol);
      const kdvKey = findKeyInRow(row, mapping.kdvCol);

      const rawKdv = kdvKey ? row[kdvKey] : null;
      const kdvTutari = this.excelParser.toDecimal(rawKdv);
      if (kdvTutari === null || kdvTutari === 0) {
        skipped++;
        continue;
      }

      const rawBelgeNo = belgeKey ? row[belgeKey] : null;
      const belgeNo = rawBelgeNo ? String(rawBelgeNo).trim() : null;

      const rawDate = tarihKey ? row[tarihKey] : null;
      const belgeDate = this.excelParser.parseDate(rawDate);

      parsed.push({
        rowIndex: i + 2, // +2: header + 1-based
        belgeNo,
        belgeDate,
        kdvTutari,
        rawData: row,
      });
    }

    if (parsed.length === 0) {
      throw new BadRequestException(
        'Seçilen sütunlardan hiç geçerli KDV satırı okunamadı. Sütun seçimlerini kontrol edin.',
      );
    }

    await this.prisma.kdvRecord.createMany({
      data: parsed.map((r) => ({
        sessionId,
        rowIndex: r.rowIndex,
        belgeNo: r.belgeNo,
        belgeDate: r.belgeDate,
        karsiTaraf: null,
        kdvMatrahi: null,
        kdvTutari: r.kdvTutari,
        kdvOrani: null,
        aciklama: null,
        rawData: r.rawData,
      })),
    });

    await this.prisma.kdvControlSession.update({
      where: { id: sessionId },
      data: { status: 'PROCESSING' },
    });

    return { imported: parsed.length, skipped };
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
      const review = this.ocrService.needsReview(ocrResult);
      const status = review.needs
        ? review.reason === 'empty'
          ? 'LOW_CONFIDENCE'
          : 'NEEDS_REVIEW'
        : 'SUCCESS';

      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: {
          ocrStatus: status,
          ocrBelgeNo: ocrResult.belgeNo,
          ocrDate: ocrResult.date,
          ocrKdvTutari: ocrResult.kdvTutari,
          ocrRawText: ocrResult.rawText?.substring(0, 2000),
          ocrConfidence: ocrResult.confidence,
          ocrBelgeNoConfidence: ocrResult.fieldConfidence.belgeNo,
          ocrDateConfidence: ocrResult.fieldConfidence.date,
          ocrKdvConfidence: ocrResult.fieldConfidence.kdvTutari,
          ocrEngine: ocrResult.engine,
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

      // Original name'i DB'den çek ki filename fallback çalışsın
      const imgRec = await this.prisma.receiptImage.findUnique({
        where: { id: imageId },
        select: { originalName: true },
      });

      // S3'ten görseli indir
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const s3 = (this.storage as any).s3;
      const bucket = this.storage.getBucket();
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
      const chunks: Buffer[] = [];
      for await (const chunk of res.Body as any) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      const ocrResult = await this.ocrService.extractFromImage(buffer, imgRec?.originalName);
      const review = this.ocrService.needsReview(ocrResult);
      const status = review.needs
        ? review.reason === 'empty'
          ? 'LOW_CONFIDENCE'
          : 'NEEDS_REVIEW'
        : 'SUCCESS';

      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: {
          ocrStatus: status,
          ocrBelgeNo: ocrResult.belgeNo,
          ocrDate: ocrResult.date,
          ocrKdvTutari: ocrResult.kdvTutari,
          ocrRawText: ocrResult.rawText?.substring(0, 2000),
          ocrConfidence: ocrResult.confidence,
          ocrBelgeNoConfidence: ocrResult.fieldConfidence.belgeNo,
          ocrDateConfidence: ocrResult.fieldConfidence.date,
          ocrKdvConfidence: ocrResult.fieldConfidence.kdvTutari,
          ocrEngine: ocrResult.engine,
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

  /** Görsel indirme URL'i
   *  — `mihsap://<invoiceId>` deseninde s3Key ise, Faturalar sayfasındaki
   *  "Aç" butonunun kullandığı Mihsap CDN link'i döndürülür (auth'suz açılır).
   *  — Değilse klasik S3 presigned URL.
   */
  async getImageDownloadUrl(imageId: string, tenantId: string) {
    const image = await this.prisma.receiptImage.findFirst({
      where: { id: imageId, session: { tenantId } },
    });
    if (!image) throw new NotFoundException('Görsel bulunamadı');

    // Mihsap kaynaklı görsel → CDN link
    if (image.s3Key?.startsWith('mihsap://')) {
      const invoiceId = image.s3Key.slice('mihsap://'.length);
      const inv = await (this.prisma as any).mihsapInvoice.findUnique({
        where: { id: invoiceId },
      });
      if (!inv || inv.tenantId !== tenantId) {
        throw new NotFoundException('Mihsap faturası bulunamadı');
      }
      if (!inv.mihsapFileLink) {
        throw new BadRequestException('Mihsap CDN link boş — fatura henüz çekilmemiş');
      }
      return { url: inv.mihsapFileLink as string };
    }

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
      where: {
        sessionId,
        ocrStatus: { in: ['LOW_CONFIDENCE', 'NEEDS_REVIEW', 'FAILED'] },
        isManuallyConfirmed: false,
      },
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

    // Luca Moren Agent (bookmarklet) akışı — Railway cloud IP'leri Luca tarafından
    // bloklandığı için backend Playwright yolu kullanılamıyor. Bunun yerine
    // kullanıcının tarayıcısındaki Luca sekmesinde çalışan bookmarklet iş
    // yapacak: job queue'lanır, sonraki polling turunda agent alıp indirir.
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

    return {
      jobId: job.id,
      status: 'queued',
      method: 'bookmarklet',
      message: 'Luca sekmesini açıp Moren Agent bookmarklet\'ine tıkla — agent job\'u alıp Excel\'i indirecek',
    };
  }

  /**
   * DEPRECATED: Arka planda Playwright ile Luca'ya login olup Excel'i indirir.
   * Railway IP'leri Luca tarafından bloklandığı için artık kullanılmıyor.
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

    // PENDING + önceki denemelerde başarısız olanlar (LOW_CONFIDENCE, FAILED).
    // NEEDS_REVIEW olanlara dokunmayız — kullanıcı teyit sırasında; değerler
    // zaten doldurulmuş durumda.
    const pending = await this.prisma.receiptImage.findMany({
      where: {
        sessionId,
        ocrStatus: { in: ['PENDING', 'LOW_CONFIDENCE', 'FAILED'] },
        isManuallyConfirmed: false,
      },
    });

    if (pending.length === 0) {
      return { queued: 0, message: 'Bekleyen görsel yok' };
    }

    // Failed/LOW_CONFIDENCE olanları PENDING'e çek (tekrar denenecek)
    const toReset = pending
      .filter((p) => p.ocrStatus !== 'PENDING')
      .map((p) => p.id);
    if (toReset.length > 0) {
      await this.prisma.receiptImage.updateMany({
        where: { id: { in: toReset } },
        data: { ocrStatus: 'PENDING' },
      });
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
          Accept: 'image/*,application/pdf,application/xml,*/*',
          Referer: 'https://app.mihsap.com/',
        },
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`Mihsap CDN ${res.status}`);
      const contentType = res.headers.get('content-type') || '';
      const buffer = Buffer.from(await res.arrayBuffer());
      this.logger.log(
        `Mihsap OCR [${imageId}] CDN: ${res.status} · ${contentType} · ${buffer.byteLength}B · ${inv.faturaNo || inv.id}`,
      );

      // PRENSİP: Mihsap'ın ham verisine (faturaNo, faturaTarihi vb.) güvenme.
      // Tek doğru kaynak FATURA GÖRÜNTÜSÜ. Tüm alanlar görselden OCR ile okunur.
      const filenameHint = `${inv.faturaNo || inv.id}.${(inv.orjDosyaTuru || 'jpg').toLowerCase()}`;
      const ocrResult = await this.ocrService.extractFromImage(buffer, filenameHint);
      const review = this.ocrService.needsReview(ocrResult);
      const status = review.needs
        ? review.reason === 'empty'
          ? 'LOW_CONFIDENCE'
          : 'NEEDS_REVIEW'
        : 'SUCCESS';

      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: {
          ocrStatus: status,
          ocrBelgeNo: ocrResult.belgeNo,
          ocrDate: ocrResult.date,
          ocrKdvTutari: ocrResult.kdvTutari,
          ocrRawText: ocrResult.rawText?.substring(0, 2000),
          ocrConfidence: ocrResult.confidence,
          ocrBelgeNoConfidence: ocrResult.fieldConfidence.belgeNo,
          ocrDateConfidence: ocrResult.fieldConfidence.date,
          ocrKdvConfidence: ocrResult.fieldConfidence.kdvTutari,
          ocrEngine: ocrResult.engine,
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
