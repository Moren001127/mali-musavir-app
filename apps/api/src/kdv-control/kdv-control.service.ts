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
import { AgentEventsService } from '../agent-events/agent-events.service';
import { randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';

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
    private agentEvents: AgentEventsService,
  ) {}

  /**
   * KDV işlemleri gösterge panelindeki "Canlı Sistem Akışı"na düşsün diye
   * her önemli aşamada AgentEvent oluşturur. Hata patlatmaz — log'a yazıp geçer.
   */
  private async pushFeedEvent(
    tenantId: string,
    args: {
      action: string;
      status: 'basarili' | 'hata' | 'bilgi' | 'atlandi';
      message: string;
      mukellef?: string;
      meta?: any;
    },
  ): Promise<void> {
    try {
      await this.agentEvents.createEvent(tenantId, {
        agent: 'kdv-kontrol',
        action: args.action,
        status: args.status,
        message: args.message,
        mukellef: args.mukellef,
        meta: args.meta,
      });
    } catch (err) {
      this.logger.warn(`Agent event push failed: ${(err as Error).message}`);
    }
  }

  private readonly VALID_TYPES = ['KDV_191', 'KDV_391', 'ISLETME_GELIR', 'ISLETME_GIDER'] as const;
  private readonly ISLETME_TYPES = ['ISLETME_GELIR', 'ISLETME_GIDER'];

  /** KDV type → Excel başlığı için okunur isim */
  private kdvTypeLabel(type?: string | null): string {
    switch (type) {
      case 'KDV_191':       return 'Bilanço — Alış (İndirilecek KDV 191)';
      case 'KDV_391':       return 'Bilanço — Satış (Hesaplanan KDV 391)';
      case 'ISLETME_GELIR': return 'İşletme Defteri — Satış / Gelir';
      case 'ISLETME_GIDER': return 'İşletme Defteri — Alış / Gider';
      default:              return type || '—';
    }
  }

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

    const created = await this.prisma.kdvControlSession.create({
      data: {
        tenantId,
        type: dto.type as any,
        periodLabel: dto.periodLabel,
        taxpayerId: dto.taxpayerId || null,
        notes: dto.notes,
        createdBy: userId,
      },
      include: {
        taxpayer: { select: { id: true, firstName: true, lastName: true, companyName: true, taxNumber: true } },
      },
    });

    // Gösterge panelindeki "Canlı Sistem Akışı"na düşer
    await this.pushFeedEvent(tenantId, {
      action: 'session-create',
      status: 'bilgi',
      message: `KDV kontrol oturumu açıldı — ${dto.periodLabel} · ${this.kdvTypeLabel(dto.type)}`,
      mukellef: this.formatMukellefAdi(created),
      meta: { sessionId: created.id, period: dto.periodLabel, type: dto.type },
    });

    return created;
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
      karsiTaraf: string | null;
      hesapKodu: string | null;
      rawData: any;
    }> = [];
    let skipped = 0;

    // AÇIKLAMA / HESAP ADI / KARŞI FİRMA sütununu otomatik tespit et.
    // Kullanıcı mapping'de sadece 3 sütun seçer; açıklama opsiyoneldir.
    const normalizeForFind = (s: string) =>
      s.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
        .replace(/İ/g, 'I').replace(/ı/g, 'i')
        .replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
        .replace(/Ş/g, 'S').replace(/ş/g, 's')
        .replace(/Ç/g, 'C').replace(/ç/g, 'c')
        .replace(/Ö/g, 'O').replace(/ö/g, 'o')
        .replace(/Ü/g, 'U').replace(/ü/g, 'u')
        .toLowerCase();
    const aciklamaKeywords = ['aciklama', 'açıklama', 'hesap adi', 'hesap adı', 'karsi taraf', 'karşı taraf', 'cari adi', 'cari adı', 'firma', 'musteri', 'müşteri'];
    const hesapKoduKeywords = ['hesap kodu'];
    const firstRowKeys = rawRows.length > 0 ? Object.keys(rawRows[0]) : [];
    const findAutoCol = (keywords: string[]): string | null => {
      const norms = keywords.map(normalizeForFind);
      for (const k of firstRowKeys) {
        const n = normalizeForFind(k);
        if (norms.some((kw) => n === kw || n.includes(kw))) return k;
      }
      return null;
    };
    const aciklamaCol = findAutoCol(aciklamaKeywords);
    const hesapKoduCol = findAutoCol(hesapKoduKeywords);
    if (aciklamaCol) {
      this.logger.log(`Luca import: AÇIKLAMA sütunu otomatik tespit: "${aciklamaCol}"`);
    }

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

      // Opsiyonel alanlar
      const aciklamaRaw = aciklamaCol && row[aciklamaCol] ? String(row[aciklamaCol]).trim() : null;
      const hesapKoduRaw = hesapKoduCol && row[hesapKoduCol] ? String(row[hesapKoduCol]).trim() : null;

      parsed.push({
        rowIndex: i + 2, // +2: header + 1-based
        belgeNo,
        belgeDate,
        kdvTutari,
        karsiTaraf: aciklamaRaw,
        hesapKodu: hesapKoduRaw,
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
        karsiTaraf: r.karsiTaraf,
        kdvMatrahi: null,
        kdvTutari: r.kdvTutari,
        kdvOrani: null,
        aciklama: r.hesapKodu,
        rawData: r.rawData,
      })),
    });

    await this.prisma.kdvControlSession.update({
      where: { id: sessionId },
      data: { status: 'PROCESSING' },
    });

    // Gösterge panelindeki "Canlı Sistem Akışı"na düşer
    const session = await this.findSession(sessionId, tenantId);
    await this.pushFeedEvent(tenantId, {
      action: 'luca-import',
      status: 'basarili',
      message: `Luca Excel yüklendi — ${parsed.length} satır${skipped > 0 ? ` (${skipped} atlandı)` : ''}`,
      mukellef: this.formatMukellefAdi(session),
      meta: { sessionId, imported: parsed.length, skipped },
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
    const records = await this.prisma.kdvRecord.findMany({
      where: { sessionId },
      include: { results: true },
      orderBy: { rowIndex: 'asc' },
    });
    // Backward-compat: UI "result" tekil bekliyordu, results[0] map et
    return records.map((r) => ({
      ...r,
      result: r.results[0] ?? null,
    }));
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
          ocrBelgeTipi: ocrResult.belgeTipi ?? null,
          ocrKdvBreakdown: (ocrResult.kdvBreakdown as any) ?? null,
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
          ocrBelgeTipi: ocrResult.belgeTipi ?? null,
          ocrKdvBreakdown: (ocrResult.kdvBreakdown as any) ?? null,
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
    const images = await this.prisma.receiptImage.findMany({
      where: { sessionId },
      include: { results: true },
      orderBy: { uploadedAt: 'asc' },
    });
    // Backward-compat: UI "result" tekil bekliyordu, results[0] map et
    return images.map((i) => ({
      ...i,
      result: i.results[0] ?? null,
    }));
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
      kdvBreakdown?: Array<{ oran: number; tutar: number; matrah?: number | null }> | null;
    },
  ) {
    const image = await this.prisma.receiptImage.findFirst({
      where: { id: imageId, session: { tenantId } },
    });
    if (!image) throw new NotFoundException('Görsel bulunamadı');

    // KDV breakdown verilmişse kaydet; verilmezse OCR'dakini koru (override yok)
    const breakdownToSave =
      dto.kdvBreakdown !== undefined
        ? ((dto.kdvBreakdown as any) ?? null)
        : undefined;

    return this.prisma.receiptImage.update({
      where: { id: imageId },
      data: {
        confirmedBelgeNo: dto.belgeNo ?? image.ocrBelgeNo,
        confirmedDate: dto.date ?? image.ocrDate,
        confirmedKdvTutari: dto.kdvTutari ?? image.ocrKdvTutari,
        ...(breakdownToSave !== undefined ? { confirmedKdvBreakdown: breakdownToSave } : {}),
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
    const session = await this.findSession(sessionId, tenantId);
    const mukellefAdi = this.formatMukellefAdi(session);
    try {
      // ÖNCE: Bozuk OCR belge no'larını dosya adından düzelt (UBL versiyon string'leri gibi)
      // Bu eskiden yüklenen XML'lerde Claude'un yanlış aldığı "TR1.2" gibi değerleri
      // dosya adındaki gerçek belge no ile değiştirir. Yeni reconciliation doğru eşleştirir.
      await this.fixBrokenOcrBelgeNo(sessionId);

      const result = await this.reconciliation.runReconciliation(sessionId);
      await this.pushFeedEvent(tenantId, {
        action: 'reconcile',
        status: 'basarili',
        message: `KDV eşleştirme tamam — ${result.matched} tam · ${result.partial + result.needsReview} incele · ${result.unmatched} hatalı`,
        mukellef: mukellefAdi,
        meta: {
          sessionId,
          period: session.periodLabel,
          type: session.type,
          ...result,
        },
      });
      return result;
    } catch (err) {
      await this.pushFeedEvent(tenantId, {
        action: 'reconcile',
        status: 'hata',
        message: `KDV eşleştirme hatası: ${(err as Error).message}`,
        mukellef: mukellefAdi,
      });
      throw err;
    }
  }

  /** Mükellef adını feed event için formatla (şirket / ad+soyad / VKN sırası) */
  private formatMukellefAdi(session: any): string | undefined {
    const t = session?.taxpayer;
    if (!t) return undefined;
    if (t.companyName) return t.companyName;
    const fullName = [t.firstName, t.lastName].filter(Boolean).join(' ');
    if (fullName) return fullName;
    return t.taxNumber || undefined;
  }

  /**
   * ReceiptImage kayıtlarındaki bozuk belge no'ları tespit edip dosya adından düzeltir.
   * Bozuk = UBL versiyon string'leri (TR1.2, TR1.0, UBL-2.1, TICARIFATURA gibi).
   * Eski Claude OCR bunları belge no olarak kaydetmişti; dosya adından gerçek belge no'yu al.
   * Idempotent — her reconcile çağrısında çalışabilir, zaten düzgün olan kayıtlara dokunmaz.
   */
  private async fixBrokenOcrBelgeNo(sessionId: string): Promise<number> {
    const images = await this.prisma.receiptImage.findMany({
      where: { sessionId },
      select: {
        id: true,
        originalName: true,
        ocrBelgeNo: true,
        confirmedBelgeNo: true,
        isManuallyConfirmed: true,
      },
    });

    // Belge no bozuk sayılan pattern'ler
    const isBrokenBelgeNo = (bn: string | null | undefined): boolean => {
      if (!bn) return false;
      const s = bn.toUpperCase().trim();
      // UBL versiyon: TR1.2, TR1.0, UBL-2.1
      if (/^(TR|UBL)[\d.\-_]+$/.test(s)) return true;
      // Senaryo/profile id'leri
      if (['TICARIFATURA', 'TEMELFATURA', 'TICARI', 'EARSIVFATURA'].includes(s)) return true;
      // 1-2 karakterlik saçma değerler
      if (s.length <= 2) return true;
      return false;
    };

    const extractFromFilename = (fn: string | null | undefined): string | null => {
      if (!fn) return null;
      const base = fn.replace(/\.[^/.]+$/, '').trim();
      // 3 harf + 4 rakam (yıl) + 6-12 rakam (sıra) — e-fatura pattern
      if (/^[A-Z]{3}\d{4}\d{6,12}$/i.test(base)) return base.toUpperCase();
      // Harfli-rakamlı orta uzunluk
      if (/^[A-Z0-9\-_]{8,30}$/i.test(base)) return base.toUpperCase();
      // Sadece rakam (ÖKC fiş, Z raporu)
      if (/^\d{3,8}$/.test(base)) return base;
      return null;
    };

    let fixedCount = 0;
    for (const img of images) {
      // Manuel teyit edilmişse dokunma
      if (img.isManuallyConfirmed && img.confirmedBelgeNo) continue;
      if (!isBrokenBelgeNo(img.ocrBelgeNo)) continue;

      const candidateFromFilename = extractFromFilename(img.originalName);
      if (!candidateFromFilename) continue;

      await this.prisma.receiptImage.update({
        where: { id: img.id },
        data: {
          ocrBelgeNo: candidateFromFilename,
          ocrEngine: 'filename-corrected',
          // Confidence'ı orta-yüksek yap, filename trustable
          ocrBelgeNoConfidence: 0.85,
        },
      });
      fixedCount++;
    }

    if (fixedCount > 0) {
      this.logger.log(`fixBrokenOcrBelgeNo: ${fixedCount} görselin belge no'su dosya adından düzeltildi`);
    }
    return fixedCount;
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

    // ExcelJS + path + fs üstte static import ediliyor — webpack bundling
    // sorunlarını önlemek için dynamic import yerine static kullan.

    // Mükellef + dönem bilgileri
    const mukellefName = session.taxpayer
      ? session.taxpayer.companyName ||
        `${session.taxpayer.firstName ?? ''} ${session.taxpayer.lastName ?? ''}`.trim()
      : 'Mükellef yok';
    const taxNo = session.taxpayer?.taxNumber || '—';
    const typeLabel = this.kdvTypeLabel(session.type);
    const periodLabel = session.periodLabel || '—';
    const now = new Date();
    const tarihStr = now.toLocaleDateString('tr-TR') + ' ' + now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    // ─── Sayaç semantiği ─────────────────────────────────
    // MATCHED       → otomatik tam eşleşme
    // CONFIRMED     → kullanıcı "İncele"den onayladı (tam eşleşme grubunda say)
    // PARTIAL_MATCH → kısmi eşleşme (incele)
    // NEEDS_REVIEW  → düşük güvenli eşleşme (incele)
    // UNMATCHED     → hiç eşleşme yok (orphan, hatalı)
    // REJECTED      → kullanıcı reddetti (hatalı)
    const isMatchedStatus = (s: string) => s === 'MATCHED' || s === 'CONFIRMED';
    const isReviewStatus = (s: string) => s === 'PARTIAL_MATCH' || s === 'NEEDS_REVIEW';
    const isErrorStatus = (s: string) => s === 'UNMATCHED' || s === 'REJECTED';
    const matchedCount = results.filter((r) => isMatchedStatus(r.status)).length;
    const partialCount = results.filter((r) => isReviewStatus(r.status)).length;
    const unmatchedCount = results.filter((r) => isErrorStatus(r.status)).length;

    const parseKdv = (v: any): number => {
      if (v === null || v === undefined || v === '') return 0;
      if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
      const s = String(v).trim();
      const hasDot = s.includes('.');
      const hasComma = s.includes(',');
      let cleaned: string;
      if (hasDot && hasComma) {
        cleaned = s.lastIndexOf(',') > s.lastIndexOf('.')
          ? s.replace(/\./g, '').replace(',', '.')
          : s.replace(/,/g, '');
      } else if (hasComma) {
        cleaned = s.replace(',', '.');
      } else {
        cleaned = s;
      }
      const n = parseFloat(cleaned.replace(/[^\d.-]/g, ''));
      return Number.isFinite(n) ? Math.abs(n) : 0;
    };

    // Özet için 3 ayrı grup — kullanıcının "fark" kafa karışıklığını çözer
    const sumLucaAll = results.reduce((s, r: any) => s + (r.kdvRecord?.kdvTutari ? Number(r.kdvRecord.kdvTutari) : 0), 0);
    const sumOcrAll = results.reduce((s, r: any) => s + parseKdv(r.image?.confirmedKdvTutari || r.image?.ocrKdvTutari), 0);
    // Sadece eşleşen tutarlar: MATCHED + CONFIRMED (kullanıcının onayladıkları)
    const sumLucaMatched = results
      .filter((r: any) => isMatchedStatus(r.status))
      .reduce((s, r: any) => s + (r.kdvRecord?.kdvTutari ? Number(r.kdvRecord.kdvTutari) : 0), 0);
    const sumOcrMatched = results
      .filter((r: any) => isMatchedStatus(r.status))
      .reduce((s, r: any) => s + parseKdv(r.image?.confirmedKdvTutari || r.image?.ocrKdvTutari), 0);
    const fmtTl = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';

    // ═══════════════ ExcelJS ile oluştur ═══════════════
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Moren Mali Müşavirlik';
    wb.created = now;
    const ws = wb.addWorksheet('KDV Kontrol', {
      pageSetup: { paperSize: 9, orientation: 'landscape' },
      views: [{ state: 'frozen', ySplit: 15 }],
    });

    // Moren altın marka rengi
    const GOLD = 'FFB8A06F';
    const DARK = 'FF1A1916';
    const GREEN_BG = 'FFDFF5E3';
    const GREEN_TEXT = 'FF15803D';
    const YELLOW_BG = 'FFFEF3C7';
    const YELLOW_TEXT = 'FFB45309';
    const RED_BG = 'FFFEE2E2';
    const RED_TEXT = 'FFB91C1C';
    const HEADER_BG = 'FF2E2B26';
    const ALT_BG = 'FFF9FAFB';

    // Sütun tanımı (genişlikler + number formatları veri satırları için)
    // 9 sütun: # · Luca Tarihi · Luca Evrak · Luca KDV · Fatura Tarihi · Fatura Belge · Fatura KDV · Durum · Açıklama
    ws.columns = [
      { width: 5 },
      { width: 13 },
      { width: 22 },
      { width: 16, style: { numFmt: '#,##0.00 "₺"' } },
      { width: 13 },
      { width: 22 },
      { width: 16, style: { numFmt: '#,##0.00 "₺"' } },
      { width: 15 },
      { width: 55 },
    ];

    // ─── MOREN LOGOLU BAŞLIK ─────────────────────────────
    try {
      const logoPath = path.join(__dirname, '..', 'assets', 'moren-logo.png');
      if (fs.existsSync(logoPath)) {
        const logoId = wb.addImage({
          filename: logoPath,
          extension: 'png',
        });
        // Sol üste yerleştir (A1–B3 bölgesi, ~180×80 px)
        ws.addImage(logoId, {
          tl: { col: 0.15, row: 0.15 },
          ext: { width: 140, height: 80 },
        });
      }
    } catch (e: any) {
      this.logger.warn(`Moren logo Excel'e eklenemedi: ${e?.message}`);
    }

    ws.mergeCells('A1:I1');
    const r1 = ws.getCell('A1');
    r1.value = 'MOREN MALİ MÜŞAVİRLİK';
    r1.font = { name: 'Calibri', size: 22, bold: true, color: { argb: GOLD } };
    r1.alignment = { horizontal: 'center', vertical: 'middle' };
    r1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
    ws.getRow(1).height = 50;

    ws.mergeCells('A2:I2');
    const r2 = ws.getCell('A2');
    r2.value = 'KDV Kontrol Raporu';
    r2.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    r2.alignment = { horizontal: 'center' };
    r2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
    ws.getRow(2).height = 22;

    // Boş satır
    ws.getRow(3).height = 8;

    // Bilgi bloğu (2 kolonlu) — Label A+B merge (dar A sığmıyor), Value C+D merge
    const infoLabelStyle = { font: { bold: true, color: { argb: 'FF666666' }, size: 10 } };
    const infoValueStyle = { font: { color: { argb: 'FF1A1916' }, size: 11 } };
    const setInfo = (r: number, label1: string, val1: string, label2?: string, val2?: string) => {
      ws.mergeCells(`A${r}:B${r}`);
      const c1 = ws.getCell(`A${r}`);
      c1.value = label1; c1.font = infoLabelStyle.font;
      c1.alignment = { horizontal: 'left', vertical: 'middle' };
      ws.mergeCells(`C${r}:D${r}`);
      const c2 = ws.getCell(`C${r}`);
      c2.value = val1; c2.font = infoValueStyle.font;
      c2.alignment = { horizontal: 'left', vertical: 'middle' };
      if (label2) {
        const c3 = ws.getCell(`E${r}`);
        c3.value = label2; c3.font = infoLabelStyle.font;
        c3.alignment = { horizontal: 'left', vertical: 'middle' };
        ws.mergeCells(`F${r}:I${r}`);
        const c4 = ws.getCell(`F${r}`);
        c4.value = val2; c4.font = infoValueStyle.font;
        c4.alignment = { horizontal: 'left', vertical: 'middle' };
      }
    };
    setInfo(4, 'Mükellef',     mukellefName,  'Dönem',        periodLabel);
    setInfo(5, 'Vergi No',     taxNo,         'Kontrol Türü', typeLabel);
    setInfo(6, 'Rapor Tarihi', tarihStr);

    ws.getRow(7).height = 8;

    // ÖZET başlığı
    ws.mergeCells('A8:I8');
    const rOz = ws.getCell('A8');
    rOz.value = 'ÖZET';
    rOz.font = { bold: true, size: 12, color: { argb: GOLD } };
    rOz.alignment = { horizontal: 'center' };
    rOz.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F0E8' } };
    ws.getRow(8).height = 20;

    const setSummary = (r: number, l1: string, v1: any, l2?: string, v2?: any) => {
      ws.mergeCells(`A${r}:B${r}`);
      const c1 = ws.getCell(`A${r}`);
      c1.value = l1; c1.font = { bold: true, color: { argb: 'FF444444' }, size: 10 };
      c1.alignment = { horizontal: 'left', vertical: 'middle' };
      ws.mergeCells(`C${r}:D${r}`);
      const c2 = ws.getCell(`C${r}`);
      c2.value = v1; c2.font = { size: 11 };
      c2.alignment = { horizontal: 'right', vertical: 'middle' };
      if (l2) {
        const c3 = ws.getCell(`E${r}`);
        c3.value = l2; c3.font = { bold: true, color: { argb: 'FF444444' }, size: 10 };
        c3.alignment = { horizontal: 'left', vertical: 'middle' };
        ws.mergeCells(`F${r}:I${r}`);
        const c4 = ws.getCell(`F${r}`);
        c4.value = v2; c4.font = { size: 11 };
        c4.alignment = { horizontal: 'right', vertical: 'middle' };
      }
    };
    setSummary(9,  'Toplam Satır',                       results.length,                                                    'Luca (tüm satırlar)',       fmtTl(sumLucaAll));
    setSummary(10, '✓ Eşleşen (otomatik + onaylanan)',   matchedCount,                                                       'Fatura OCR (tüm satırlar)', fmtTl(sumOcrAll));
    setSummary(11, '⚠ Kısmi / İnceleme',                 partialCount,                                                       'Luca (sadece eşleşen)',     fmtTl(sumLucaMatched));
    setSummary(12, '✗ Hatalı (orphan + reddedilen)',     unmatchedCount,                                                     'Fatura (sadece eşleşen)',   fmtTl(sumOcrMatched));
    setSummary(13, 'Eşleşme Oranı',                      `%${Math.round((matchedCount / Math.max(results.length, 1)) * 100)}`, 'Eşleşenler farkı',          fmtTl(sumLucaMatched - sumOcrMatched));

    ws.getRow(14).height = 8;

    // Tablo başlığı (15. satır)
    const headerRow = ws.getRow(15);
    headerRow.values = [
      '#', 'LUCA TARİHİ', 'LUCA EVRAK NO', 'LUCA KDV (₺)',
      'FATURA TARİHİ', 'FATURA BELGE NO', 'FATURA KDV (₺)', 'DURUM', 'AÇIKLAMA / UYUMSUZLUK',
    ];
    headerRow.height = 30;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });

    // Veri satırları (16+)
    results.forEach((r: any, idx) => {
      const rowNum = 16 + idx;
      const row = ws.getRow(rowNum);

      const lucaTarih = r.kdvRecord?.belgeDate
        ? new Date(r.kdvRecord.belgeDate).toLocaleDateString('tr-TR')
        : '—';
      const lucaEvrak = r.kdvRecord?.belgeNo || '—';
      const lucaKdv = r.kdvRecord?.kdvTutari ? Number(r.kdvRecord.kdvTutari) : null;

      const faturaTarih = r.image?.confirmedDate || r.image?.ocrDate || '—';
      const faturaBelgeNo = r.image?.confirmedBelgeNo || r.image?.ocrBelgeNo || '—';
      const faturaKdvNum = parseKdv(r.image?.confirmedKdvTutari || r.image?.ocrKdvTutari);
      const faturaKdv = faturaKdvNum > 0 ? faturaKdvNum : null;

      let durum = '';
      if (r.status === 'MATCHED') durum = '✓ EŞLEŞTİ';
      else if (r.status === 'CONFIRMED') durum = '✓ ONAYLANDI';
      else if (r.status === 'PARTIAL_MATCH') durum = '⚠ KISMİ';
      else if (r.status === 'NEEDS_REVIEW') durum = '⚠ İNCELE';
      else if (r.status === 'UNMATCHED') durum = '✗ EŞLEŞMEDİ';
      else if (r.status === 'REJECTED') durum = '✗ REDDEDİLDİ';
      else durum = r.status;

      const aciklama = !r.image
        ? 'Fatura görseli yok'
        : !r.kdvRecord
          ? 'Luca kaydı yok'
          : (r.mismatchReasons || []).join(' · ') || '';

      row.values = [
        idx + 1, lucaTarih, lucaEvrak, lucaKdv,
        faturaTarih, faturaBelgeNo, faturaKdv, durum, aciklama,
      ];

      // Duruma göre renk
      let rowBg = idx % 2 === 0 ? 'FFFFFFFF' : ALT_BG;
      let statusText = 'FF1A1916';
      let statusBold = false;
      if (r.status === 'MATCHED' || r.status === 'CONFIRMED') {
        rowBg = GREEN_BG; statusText = GREEN_TEXT; statusBold = true;
      } else if (r.status === 'PARTIAL_MATCH' || r.status === 'NEEDS_REVIEW') {
        rowBg = YELLOW_BG; statusText = YELLOW_TEXT; statusBold = true;
      } else if (r.status === 'UNMATCHED' || r.status === 'REJECTED') {
        rowBg = RED_BG; statusText = RED_TEXT; statusBold = true;
      }

      row.eachCell((cell, colNum) => {
        const isStatus = colNum === 8;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
        cell.font = {
          size: 10,
          color: { argb: isStatus ? statusText : 'FF1A1916' },
          bold: isStatus && statusBold,
        };
        const rightAlign = colNum === 4 || colNum === 7;
        const centerAlign = colNum === 1 || colNum === 8;
        cell.alignment = {
          horizontal: rightAlign ? 'right' : centerAlign ? 'center' : 'left',
          vertical: 'middle',
        };
        cell.border = {
          top:    { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left:   { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right:  { style: 'thin', color: { argb: 'FFE5E7EB' } },
        };
      });
    });

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

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

    // Kullanıcının onayladığı eşleşmeler (CONFIRMED) otomatik eşleşmeler (MATCHED)
    // ile birlikte tek "Tam Eşleşme" sayacında gösterilir — bu sayede kullanıcı
    // İncele panelinde bir eşleşmeyi Onayladığında sayaç İncele'den düşüp
    // Tam Eşleşme sayacına geçer.
    return {
      totalRecords,
      totalImages,
      matched: (statusMap['MATCHED'] ?? 0) + (statusMap['CONFIRMED'] ?? 0),
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
   *
   * @param opts.forceFresh Frontend'deki "Yenile" butonundan gelen istekler için
   *   true geçilir. Bu durumda:
   *   - NEEDS_REVIEW (teyit bekler) durumundaki fatura görselleri de yeniden
   *     kuyruğa alınır (normal çağrıda bunlara dokunulmaz çünkü değerler zaten
   *     doldurulmuştur — ama kullanıcı kodda/promptta düzeltme yaptıysa eski
   *     sonuçları silip yeniden OCR etmek ister).
   *   - OCR cache (aynı s3Key için önceki başarılı sonucu kopyalama) devre dışı.
   *     Aksi halde "Yenile" aynı buggy sonucu geri yapıştırır, yeni düzeltmeler
   *     hiçbir zaman uygulanmaz.
   */
  async startOcrForSession(
    sessionId: string,
    tenantId: string,
    opts: { forceFresh?: boolean } = {},
  ) {
    await this.findSession(sessionId, tenantId);
    const forceFresh = opts.forceFresh === true;

    // PENDING + önceki denemelerde başarısız olanlar (LOW_CONFIDENCE, FAILED).
    // Normal akışta NEEDS_REVIEW'a dokunmayız — kullanıcı teyit sırasında;
    // değerler zaten doldurulmuş durumda. Ama "Yenile" (forceFresh) butonu
    // NEEDS_REVIEW'ı da kapsar çünkü kullanıcı OCR kodunu/promptunu
    // düzelttiğinde bu kartı kullanarak eski sonuçları silip yeniden OCR'lamak
    // ister.
    const targetStatuses = forceFresh
      ? ['PENDING', 'LOW_CONFIDENCE', 'FAILED', 'NEEDS_REVIEW']
      : ['PENDING', 'LOW_CONFIDENCE', 'FAILED'];
    const pending = await this.prisma.receiptImage.findMany({
      where: {
        sessionId,
        ocrStatus: { in: targetStatuses as any },
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

    // ═══════════════ OCR CACHE (mükerrer OCR'ı önler) ═══════════════
    // Maliyet optimizasyonu: aynı Mihsap faturası daha önce başka bir
    // session'da başarıyla OCR edilmişse, yeni OCR çağrısı YAPMA — önceki
    // sonucu kopyala. Faturalar modülündeki "aynı belgeleri tekrar çekme"
    // mantığının OCR versiyonu. Claude token'ı boşa harcanmaz.
    //
    // forceFresh (Yenile butonu) modunda bu cache TAMAMEN atlanır. Aksi halde
    // kullanıcı "Yenile"ye bastığında eski (buggy) OCR sonucu geri kopyalanır,
    // yeni deploy ettiği düzeltmeler hiçbir zaman uygulanmaz.
    let cacheHits = 0;
    const toQueue: typeof pending = [];
    for (const img of pending) {
      if (forceFresh || !img.s3Key?.startsWith('mihsap://')) {
        toQueue.push(img);
        continue;
      }

      // Aynı Mihsap invoice daha önce OCR edildi mi? (aynı tenant, farklı image kaydı)
      const cached = await this.prisma.receiptImage.findFirst({
        where: {
          s3Key: img.s3Key,
          id: { not: img.id },
          session: { tenantId },
          ocrStatus: { in: ['SUCCESS', 'NEEDS_REVIEW'] },
          OR: [
            { ocrBelgeNo: { not: null } },
            { ocrDate: { not: null } },
            { ocrKdvTutari: { not: null } },
          ],
        },
        orderBy: { uploadedAt: 'desc' }, // en yeni OCR
      });

      if (cached) {
        // Önceki OCR sonucunu direkt kopyala — yeni Claude çağrısı yok
        await this.prisma.receiptImage.update({
          where: { id: img.id },
          data: {
            ocrStatus: cached.ocrStatus,
            ocrBelgeNo: cached.ocrBelgeNo,
            ocrDate: cached.ocrDate,
            ocrKdvTutari: cached.ocrKdvTutari,
            ocrRawText: cached.ocrRawText,
            ocrConfidence: cached.ocrConfidence,
            ocrBelgeNoConfidence: cached.ocrBelgeNoConfidence,
            ocrDateConfidence: cached.ocrDateConfidence,
            ocrKdvConfidence: cached.ocrKdvConfidence,
            ocrEngine: (cached.ocrEngine || 'claude-haiku-4-5') + ' (cached)',
          },
        });
        cacheHits++;
        this.logger.log(`OCR cache HIT: ${img.originalName} ← önceki başarılı OCR kopyalandı`);
      } else {
        toQueue.push(img);
      }
    }

    if (cacheHits > 0) {
      this.logger.log(`OCR cache: ${cacheHits} fatura için Claude çağrısı atlandı (mükerrer OCR önlendi)`);
    }

    if (toQueue.length === 0) {
      return { queued: 0, cacheHits, message: 'Tüm faturalar önceden OCR edilmişti' };
    }

    // Concurrency limit — Claude rate limit'ine takılmamak için aynı anda
    // max CLAUDE_OCR_CONCURRENCY işlem (default 2). Önceden 3'tü ama Anthropic
    // organization rate limit'e takılıyordu. 2 + her request arası 800ms throttle ile
    // 60 req/dakika seviyesinde kalıyoruz (Anthropic Tier 1 = 50 RPM, Tier 2 = 1000 RPM).
    const CONCURRENCY = Math.max(1, Number(process.env.CLAUDE_OCR_CONCURRENCY) || 2);
    const REQUEST_THROTTLE_MS = Math.max(0, Number(process.env.OCR_REQUEST_THROTTLE_MS) || 800);
    this.logger.log(
      `OCR kuyruğu başlatılıyor: ${toQueue.length} fatura (${cacheHits} önceden cached) · concurrency=${CONCURRENCY} · throttle=${REQUEST_THROTTLE_MS}ms`,
    );

    const queue = [...toQueue];
    let queued = 0;
    const workers = Array.from({ length: CONCURRENCY }, async (_, workerIdx) => {
      // Worker'ları stagger et — hepsi aynı anda başlamasın (rate limit jitter)
      if (workerIdx > 0) {
        await new Promise((r) => setTimeout(r, workerIdx * 400));
      }
      while (queue.length > 0) {
        const img = queue.shift();
        if (!img) break;
        const startMs = Date.now();
        try {
          if (img.s3Key?.startsWith('mihsap://')) {
            const invoiceId = img.s3Key.slice('mihsap://'.length);
            await this.runOcrForMihsapInvoice(img.id, invoiceId, tenantId);
          } else {
            await this.runOcrForImage(img.id, img.s3Key);
          }
        } catch (e: any) {
          this.logger.error(`OCR worker ${workerIdx} hata [${img.id}]: ${e?.message}`);
        }
        queued++;
        // İşlem hızlı bittiyse minimum throttle uygula (rate limit nezaket)
        const elapsed = Date.now() - startMs;
        if (elapsed < REQUEST_THROTTLE_MS && queue.length > 0) {
          await new Promise((r) => setTimeout(r, REQUEST_THROTTLE_MS - elapsed));
        }
      }
    });

    // Gösterge panelindeki "Canlı Sistem Akışı"na başlangıç eventi
    const session = await this.findSession(sessionId, tenantId);
    const mukellefAdi = this.formatMukellefAdi(session);
    await this.pushFeedEvent(tenantId, {
      action: 'ocr-start',
      status: 'bilgi',
      message: `Fatura OCR başladı — ${toQueue.length} yeni${cacheHits > 0 ? ` · ${cacheHits} cache'den` : ''}`,
      mukellef: mukellefAdi,
      meta: { sessionId, queued: toQueue.length, cacheHits },
    });

    // Workers'ları arkaplanda çalıştır, HTTP yanıtını hemen döndür
    Promise.all(workers).then(async () => {
      this.logger.log(`OCR kuyruğu bitti: ${queued} fatura işlendi · ${cacheHits} cached`);
      // OCR tamamlandığında da feed'e yaz
      await this.pushFeedEvent(tenantId, {
        action: 'ocr-complete',
        status: 'basarili',
        message: `Fatura OCR tamamlandı — ${queued} işlendi${cacheHits > 0 ? ` · ${cacheHits} cache'den` : ''}`,
        mukellef: mukellefAdi,
        meta: { sessionId, processed: queued, cacheHits },
      });
    });

    return {
      queued: toQueue.length,
      total: pending.length,
      cacheHits,
      message: cacheHits > 0
        ? `${toQueue.length} yeni OCR · ${cacheHits} fatura önceden OCR edilmişti, atlandı`
        : undefined,
    };
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
