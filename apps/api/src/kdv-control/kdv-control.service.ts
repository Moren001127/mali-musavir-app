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
import { isAggregateLucaRecord } from './luca-row-filter';
import { LucaService } from '../luca/luca.service';
import { LucaAutoScraperService } from '../luca/luca-auto-scraper.service';
import { AgentEventsService } from '../agent-events/agent-events.service';
import { logAiUsage } from '../common/ai-usage-logger';
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

  /** Oturum listesi — her session için OCR maliyeti toplamı dahil */
  async findSessions(tenantId: string) {
    const sessions = await this.prisma.kdvControlSession.findMany({
      where: { tenantId },
      include: {
        _count: { select: { kdvRecords: true, images: true, results: true } },
        taxpayer: { select: { id: true, firstName: true, lastName: true, companyName: true, taxNumber: true } },
        images: {
          // ReceiptImage modelinde createdAt yok, uploadedAt var (schema.prisma:705)
          select: { uploadedAt: true },
          orderBy: { uploadedAt: 'asc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (sessions.length === 0) return [];

    // OCR maliyetlerini session bazında topla; tekrar OCR/seri tarama aynı oturuma eklenir.
    const sessionKeys = sessions.map((s) => `session:${s.id}`);

    const costRows = await (this.prisma as any).aiUsageLog.findMany({
      where: {
        tenantId,
        source: 'kdv-ocr',
        sebep: { in: sessionKeys.length > 0 ? sessionKeys : ['__none__'] },
      },
      select: { sebep: true, costUsd: true },
    });
    const costBySession = new Map<string, number>();
    for (const row of costRows) {
      if (!row.sebep) continue;
      costBySession.set(row.sebep, (costBySession.get(row.sebep) || 0) + Number(row.costUsd || 0));
    }

    return sessions.map((s) => {
      const maliyetUsd = costBySession.get(`session:${s.id}`) || 0;

      return { ...s, maliyetUsd };
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
      const rowText = Object.values(row)
        .map((v) => String(v ?? ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .toLocaleUpperCase('tr-TR')
        .trim();
      const isLucaSummaryRow =
        /NAKL[İI]\s*YEK[ÜU]N|NAKLI\s*YEKUN|^TOPLAM[:\s]| TOPLAM[:\s]|GENEL\s+TOPLAM/.test(rowText) ||
        (!belgeDate && (!belgeNo || !/[A-Z0-9]{4,}/i.test(belgeNo)));
      if (isLucaSummaryRow) {
        skipped++;
        continue;
      }

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
    let rows = this.ISLETME_TYPES.includes(session!.type)
      ? this.excelParser.parseIsletmeExcel(buffer, session!.type as 'ISLETME_GELIR' | 'ISLETME_GIDER')
      : this.excelParser.parseKdvExcel(buffer, session!.type === 'KDV_191' ? '191' : '391');

    // ── İŞLETME: dönem (ay) tarih filtresi ──
    // Luca formunda tarih kutusu tutmadığı için Excel tüm dönemi getirebiliyor.
    // session.periodLabel "2026/03" → 2026-03-01..2026-03-31 aralığı.
    if (this.ISLETME_TYPES.includes(session!.type) && session!.periodLabel) {
      const dash = this.toDashDonem(session!.periodLabel); // "2026-03"
      const m = dash.match(/^(\d{4})-(\d{2})$/);
      if (m) {
        const year = +m[1];
        const month = +m[2]; // 1-12
        const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
        const end = new Date(Date.UTC(year, month, 0, 23, 59, 59)); // ay sonu
        const before = rows.length;
        const monthFiltered = rows.filter((r) => {
          if (!r.belgeDate) return false;
          const t = r.belgeDate.getTime();
          return t >= start.getTime() && t <= end.getTime();
        });

        // Ay bazında 0 satır çıkarsa YIL bazında dene (tüm yılı al, kullanıcı manuel filtreler)
        if (monthFiltered.length === 0 && before > 0) {
          const yearStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
          const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
          const yearFiltered = rows.filter((r) => {
            if (!r.belgeDate) return false;
            const t = r.belgeDate.getTime();
            return t >= yearStart.getTime() && t <= yearEnd.getTime();
          });
          if (yearFiltered.length > 0) {
            this.logger.warn(
              `İşletme dönem filtresi (${dash}): ay bazında 0 satır → YIL bazında genişletildi (${year}): ${before} → ${yearFiltered.length}`,
            );
            rows = yearFiltered;
          } else {
            // Yıl bazında da 0 → tüm satırları geçir, kullanıcı manuel kontrol etsin
            this.logger.warn(
              `İşletme dönem filtresi: yıl bazında bile 0 satır, FİLTRE KAPATILDI (${before} satır geçirildi)`,
            );
          }
        } else {
          rows = monthFiltered;
          this.logger.log(
            `İşletme dönem filtresi (${dash}): ${before} → ${rows.length} satır (dönem dışı ${before - rows.length} elendi)`,
          );
        }
      }
    }

    if (rows.length === 0) {
      // İŞLETME tiplerinde 0 satır = "o dönemde işlem yok" demek olabilir, hata fırlatma
      if (this.ISLETME_TYPES.includes(session!.type)) {
        this.logger.warn(
          `İşletme ${session!.type} 0 satır — session boş bırakılıyor (dönem ${session!.periodLabel}). ` +
            `Sebepleri: (1) o dönemde işlem yok, (2) Excel'de yanlış bölüm, (3) tarih dışı.`,
        );
        // Session'ı PROCESSING durumda bırakacak — Mihsap eşleştirme aşamasına geçilebilsin
        await this.prisma.kdvControlSession.update({
          where: { id: sessionId },
          data: { status: 'PROCESSING' },
        });
        return { parsed: 0 };
      }
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
    return records
      .filter((r) => !isAggregateLucaRecord(r))
      .map((r) => ({
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

  /**
   * OCR maliyetini ai_usage_logs'a yaz — Tüm Ajanlar sayacına düşsün.
   * Image'in session'ı üzerinden tenantId + mukellef bilgisini çeker.
   */
  private async logOcrUsage(imageId: string, ocrResult: any, durationMs?: number) {
    try {
      const img = await this.prisma.receiptImage.findUnique({
        where: { id: imageId },
        select: {
          sessionId: true,
          session: {
            select: {
              tenantId: true,
              taxpayerId: true,
              taxpayer: {
                select: { firstName: true, lastName: true, companyName: true },
              },
            },
          },
        },
      });
      if (!img?.session?.tenantId) return;
      const tp = img.session.taxpayer;
      const mukellef = tp
        ? tp.companyName ||
          [tp.firstName, tp.lastName].filter(Boolean).join(' ').trim() ||
          null
        : null;

      await logAiUsage(this.prisma, {
        tenantId: img.session.tenantId,
        source: 'kdv-ocr',
        model: ocrResult.engine || 'claude-haiku-4-5-20251001',
        taxpayerId: img.session.taxpayerId || null,
        mukellef,
        belgeNo: ocrResult.belgeNo || null,
        karar: ocrResult.belgeNo && ocrResult.kdvTutari ? 'ok' : 'emin_degil',
        sebep: `session:${img.sessionId}`,
        durationMs,
        cacheHit: /\bcache\b/i.test(ocrResult.engine || ''),
        usage: {
          input_tokens: ocrResult.usage?.inputTokens || 0,
          output_tokens: ocrResult.usage?.outputTokens || 0,
          cache_read_input_tokens: ocrResult.usage?.cacheReadTokens || 0,
          cache_creation_input_tokens: ocrResult.usage?.cacheCreationTokens || 0,
        },
      });
    } catch {
      // log hatası ana akışı bozmasın
    }
  }

  private async saveOcrResult(imageId: string, ocrResult: any, imageHash?: string) {
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
        ocrKdvTevkifat: ocrResult.kdvTevkifat ?? null,
        ocrSatici: ocrResult.satici ?? null,
        ocrSaticiVkn: ocrResult.saticiVkn ?? null,
        ocrRawText: ocrResult.rawText?.substring(0, 2000),
        ocrConfidence: ocrResult.confidence,
        ocrBelgeNoConfidence: ocrResult.fieldConfidence?.belgeNo ?? null,
        ocrDateConfidence: ocrResult.fieldConfidence?.date ?? null,
        ocrKdvConfidence: ocrResult.fieldConfidence?.kdvTutari ?? null,
        ocrEngine: ocrResult.engine,
        ocrBelgeTipi: ocrResult.belgeTipi ?? null,
        ocrKdvBreakdown: (ocrResult.kdvBreakdown as any) ?? null,
        ocrValidationScore: ocrResult.validationScore ?? null,
        ocrKategori: ocrResult.kategori ?? null,
        ...(imageHash ? { imageHash } : {}),
      },
    });

    return status;
  }

  private async tryApplyHashCache(imageId: string, imageHash: string, durationMs?: number) {
    const current = await this.prisma.receiptImage.findUnique({
      where: { id: imageId },
      select: {
        sessionId: true,
        originalName: true,
        session: {
          select: {
            tenantId: true,
            taxpayerId: true,
            taxpayer: { select: { firstName: true, lastName: true, companyName: true } },
          },
        },
      },
    });
    const tenantId = current?.session?.tenantId;
    if (!tenantId) return false;

    const cached = await this.prisma.receiptImage.findFirst({
      where: {
        imageHash,
        id: { not: imageId },
        session: { tenantId },
        ocrStatus: { in: ['SUCCESS', 'NEEDS_REVIEW'] as any },
        OR: [
          { ocrBelgeNo: { not: null } },
          { ocrDate: { not: null } },
          { ocrKdvTutari: { not: null } },
        ],
      },
      orderBy: { uploadedAt: 'desc' },
    });
    if (!cached) return false;

    await this.prisma.receiptImage.update({
      where: { id: imageId },
      data: {
        ocrStatus: cached.ocrStatus,
        ocrBelgeNo: cached.ocrBelgeNo,
        ocrDate: cached.ocrDate,
        ocrKdvTutari: cached.ocrKdvTutari,
        ocrKdvTevkifat: cached.ocrKdvTevkifat,
        ocrSatici: cached.ocrSatici,
        ocrSaticiVkn: cached.ocrSaticiVkn,
        ocrRawText: cached.ocrRawText,
        ocrConfidence: cached.ocrConfidence,
        ocrBelgeNoConfidence: cached.ocrBelgeNoConfidence,
        ocrDateConfidence: cached.ocrDateConfidence,
        ocrKdvConfidence: cached.ocrKdvConfidence,
        ocrEngine: `${cached.ocrEngine || 'unknown'} (cache)`,
        ocrBelgeTipi: cached.ocrBelgeTipi,
        ocrKdvBreakdown: cached.ocrKdvBreakdown as any,
        ocrValidationScore: cached.ocrValidationScore,
        ocrKategori: cached.ocrKategori,
        imageHash,
      } as any,
    });

    const tp = current.session?.taxpayer;
    const mukellef = tp
      ? tp.companyName || [tp.firstName, tp.lastName].filter(Boolean).join(' ').trim() || null
      : null;
    await logAiUsage(this.prisma, {
      tenantId,
      source: 'kdv-ocr',
      model: cached.ocrEngine || 'cache',
      taxpayerId: current.session?.taxpayerId || null,
      mukellef,
      belgeNo: cached.ocrBelgeNo || null,
      karar: 'cache_hit',
      sebep: `session:${current.sessionId || ''}`,
      durationMs,
      cacheHit: true,
      usage: { input_tokens: 0, output_tokens: 0 },
    }).catch(() => {});
    this.logger.log(`OCR hash cache HIT: ${current.originalName || imageId} · sağlayıcı çağrısı atlandı`);
    return true;
  }

  /** OCR işlemi — buffer doğrudan (S3'e gerek yok) */
  private async runOcrForBuffer(imageId: string, buffer: Buffer, originalName?: string) {
    const t0 = Date.now();
    try {
      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: { ocrStatus: 'PROCESSING' },
      });

      const imageHash = this.ocrService.computeImageHash(buffer);
      if (await this.tryApplyHashCache(imageId, imageHash, Date.now() - t0)) return;

      const ocrResult = await this.ocrService.extractFromImage(buffer, originalName);
      await this.saveOcrResult(imageId, ocrResult, imageHash);

      // AI maliyet log'u — Tüm Ajanlar sayacına düşsün
      await this.logOcrUsage(imageId, ocrResult, Date.now() - t0);
    } catch (err) {
      this.logger.error(`runOcrForBuffer [${imageId}]: ${err?.message}`);
      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: { ocrStatus: 'FAILED' },
      });
    }
  }

  /** OCR işlemi — S3'ten indirerek (presigned upload sonrası kullanılır) */
  private async runOcrForImage(imageId: string, s3Key: string, opts: { forceClaude?: boolean } = {}) {
    const t0 = Date.now();
    try {
      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: { ocrStatus: 'PROCESSING' },
      });

      // Original name'i DB'den çek ki filename fallback çalışsın
      const imgRec = await this.prisma.receiptImage.findUnique({
        where: { id: imageId },
        select: {
          originalName: true,
          sessionId: true,
          session: {
            select: {
              tenantId: true,
              taxpayerId: true,
              taxpayer: { select: { firstName: true, lastName: true, companyName: true } },
            },
          },
        },
      });

      // S3'ten görseli indir
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const s3 = (this.storage as any).s3;
      const bucket = this.storage.getBucket();
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
      const chunks: Buffer[] = [];
      for await (const chunk of res.Body as any) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      // Hash cache: manuel/S3 yüklenen aynı görsel daha önce işlendiyse
      // Claude'a tekrar gitme. Mihsap dışı upload'larda asıl maliyet düşüren
      // katman burasıdır.
      const imageHash = this.ocrService.computeImageHash(buffer);
      if (await this.tryApplyHashCache(imageId, imageHash, Date.now() - t0)) return;
      const cached = await this.prisma.receiptImage.findFirst({
        where: {
          imageHash,
          id: { not: imageId },
          session: { tenantId: imgRec?.session?.tenantId },
          ocrStatus: { in: ['SUCCESS', 'NEEDS_REVIEW'] as any },
          OR: [
            { ocrBelgeNo: { not: null } },
            { ocrDate: { not: null } },
            { ocrKdvTutari: { not: null } },
          ],
        },
        orderBy: { uploadedAt: 'desc' },
      });

      if (cached) {
        await this.prisma.receiptImage.update({
          where: { id: imageId },
          data: {
            ocrStatus: cached.ocrStatus,
            ocrBelgeNo: cached.ocrBelgeNo,
            ocrDate: cached.ocrDate,
            ocrKdvTutari: cached.ocrKdvTutari,
            ocrKdvTevkifat: cached.ocrKdvTevkifat,
            ocrSatici: cached.ocrSatici,
            ocrSaticiVkn: cached.ocrSaticiVkn,
            ocrRawText: cached.ocrRawText,
            ocrConfidence: cached.ocrConfidence,
            ocrBelgeNoConfidence: cached.ocrBelgeNoConfidence,
            ocrDateConfidence: cached.ocrDateConfidence,
            ocrKdvConfidence: cached.ocrKdvConfidence,
            ocrEngine: `${cached.ocrEngine || 'unknown'} (cache)`,
            ocrBelgeTipi: cached.ocrBelgeTipi,
            ocrKdvBreakdown: cached.ocrKdvBreakdown as any,
            ocrValidationScore: cached.ocrValidationScore,
            ocrKategori: cached.ocrKategori,
            imageHash,
          } as any,
        });

        const tp = imgRec?.session?.taxpayer;
        const mukellef = tp
          ? tp.companyName || [tp.firstName, tp.lastName].filter(Boolean).join(' ').trim() || null
          : null;
        try {
          await logAiUsage(this.prisma, {
            tenantId: imgRec?.session?.tenantId || 'unknown',
            source: 'kdv-ocr',
            model: cached.ocrEngine || 'cache',
            taxpayerId: imgRec?.session?.taxpayerId || null,
            mukellef,
            belgeNo: cached.ocrBelgeNo || null,
            karar: 'cache_hit',
            sebep: `session:${imgRec?.sessionId || ''}`,
            durationMs: Date.now() - t0,
            cacheHit: true,
            usage: { input_tokens: 0, output_tokens: 0 },
          });
        } catch {}
        this.logger.log(`OCR hash cache HIT: ${imgRec?.originalName || imageId} · Claude çağrısı atlandı`);
        return;
      }

      const ocrResult = await this.ocrService.extractFromImage(buffer, imgRec?.originalName, {
        forceClaude: opts.forceClaude === true,
      });
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
          ocrKdvTevkifat: ocrResult.kdvTevkifat ?? null,
          ocrSatici: ocrResult.satici ?? null,
          ocrRawText: ocrResult.rawText?.substring(0, 2000),
          ocrConfidence: ocrResult.confidence,
          ocrBelgeNoConfidence: ocrResult.fieldConfidence.belgeNo,
          ocrDateConfidence: ocrResult.fieldConfidence.date,
          ocrKdvConfidence: ocrResult.fieldConfidence.kdvTutari,
          ocrEngine: ocrResult.engine,
          ocrBelgeTipi: ocrResult.belgeTipi ?? null,
          ocrKdvBreakdown: (ocrResult.kdvBreakdown as any) ?? null,
          ocrValidationScore: ocrResult.validationScore ?? null,
          imageHash,
        },
      });

      // AI maliyet log'u — Tüm Ajanlar sayacına düşsün
      await this.logOcrUsage(imageId, ocrResult, Date.now() - t0);
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
      kdvTevkifat?: string | null;
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
        // Tevkifat: dto'da yoksa OCR'dakini koru, "" geldiyse temizle
        confirmedKdvTevkifat:
          dto.kdvTevkifat !== undefined
            ? dto.kdvTevkifat || null
            : image.ocrKdvTevkifat,
        ...(breakdownToSave !== undefined ? { confirmedKdvBreakdown: breakdownToSave } : {}),
        isManuallyConfirmed: true,
        ocrStatus: 'SUCCESS',
      },
    });
  }

  /**
   * Tek bir fatura görselinin OCR'ını sıfırlayıp yeniden çalıştırır.
   * Frontend'deki "her fatura satırının yanında ⟳ OCR Yap" butonu için.
   *
   * Cache atlanır (force-fresh) — kullanıcı bu butona zaten "yeniden oku"
   * niyetiyle basıyor, eski sonucu kopyalamak işe yaramaz. Manuel teyit
   * (isManuallyConfirmed) sıfırlanır ki yeni OCR sonucu yazılabilsin.
   */
  async reocrSingleImage(imageId: string, tenantId: string, opts: { forceClaude?: boolean } = {}) {
    const image = await this.prisma.receiptImage.findFirst({
      where: { id: imageId, session: { tenantId } },
    });
    if (!image) throw new NotFoundException('Görsel bulunamadı');
    if (!image.s3Key) {
      throw new BadRequestException('Görselin kaynağı (s3Key) yok — OCR yapılamaz');
    }

    // OCR sonuçlarını sıfırla — yeni sonuç temiz yazılsın.
    // confirmedKdvBreakdown (Json?) Prisma'da plain null kabul etmiyor;
    // isManuallyConfirmed=false olduğu için zaten okunmayacak — bu yüzden
    // dokunmuyoruz, sadece flag'i sıfırlıyoruz. Yeni OCR ocrKdvBreakdown'a yazar.
    await this.prisma.receiptImage.update({
      where: { id: imageId },
      data: {
        ocrStatus: 'PROCESSING',
        isManuallyConfirmed: false,
        confirmedBelgeNo: null,
        confirmedDate: null,
        confirmedKdvTutari: null,
        confirmedKdvTevkifat: null,
      },
    });

    // Arkaplanda çalıştır — HTTP isteğini bloke etmiyoruz, frontend polling'le takip eder.
    (async () => {
      try {
        if (image.s3Key.startsWith('mihsap://')) {
          const invoiceId = image.s3Key.slice('mihsap://'.length);
          await this.runOcrForMihsapInvoice(image.id, invoiceId, tenantId, opts);
        } else {
          await this.runOcrForImage(image.id, image.s3Key, opts);
        }
      } catch (err: any) {
        this.logger.error(`reocrSingleImage [${imageId}]: ${err?.message}`);
      }
    })();

    return {
      queued: true,
      imageId,
      message: 'OCR yeniden başlatıldı — birkaç saniye içinde sonuç gelir',
    };
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
    const results = await this.prisma.reconciliationResult.findMany({
      where: { sessionId },
      include: {
        kdvRecord: true,
        image: true,
      },
      orderBy: [{ status: 'asc' }, { matchScore: 'desc' }],
    });
    return results.filter((r) => !r.kdvRecord || !isAggregateLucaRecord(r.kdvRecord));
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
    
    const rawResults = await this.prisma.reconciliationResult.findMany({
      where: { sessionId },
      include: { kdvRecord: true, image: true },
      orderBy: [
        { status: 'asc' },
        // Aynı status içinde Luca tarihine göre sırala — muhasebeci aynı sırayı her açışta görsün
        { kdvRecord: { belgeDate: 'asc' } },
        { matchScore: 'desc' },
      ],
    });
    const results = rawResults.filter((r) => !r.kdvRecord || !isAggregateLucaRecord(r.kdvRecord));

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
    const seriUyarilari = await this.checkBelgeSeriContinuity(session, sessionId, tenantId);

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
      const n = parseFloat(cleaned.replace(/[^\d.\-]/g, ''));
      // Math.abs KALDIRILDI — iptal/iade faturaları negatif olabilir, işaret korunsun
      return Number.isFinite(n) ? n : 0;
    };

    // Fan-out durumunda detay satırı gerçek OCR KDV'sini gösterir; özet toplamlar
    // aynı imageId'yi tek kez sayarak çift sayımı önler.
    /** Bir result satırında kullanıcıya gösterilecek gerçek OCR/onaylı fatura KDV'si */
    const getFaturaKdvValue = (r: any): number => {
      if (!r.image || !r.imageId) return 0;
      const ocrTotal = parseKdv(r.image.confirmedKdvTutari || r.image.ocrKdvTutari);
      if (ocrTotal <= 0) return 0;
      const luca = r.kdvRecord?.kdvTutari ? Number(r.kdvRecord.kdvTutari) : 0;
      if (luca <= 0) return ocrTotal;

      const isSatis = session.type === 'KDV_391' || session.type === 'ISLETME_GELIR';
      const tevkifat = parseKdv(r.image.confirmedKdvTevkifat || r.image.ocrKdvTevkifat);
      const rate = r.kdvRecord?.kdvOrani ? Number(r.kdvRecord.kdvOrani) : 0;
      const candidates = [
        ocrTotal,
        ...(isSatis && tevkifat > 0 && ocrTotal > tevkifat ? [ocrTotal - tevkifat] : []),
        ...(rate > 0 ? [(ocrTotal * rate) / 100] : []),
      ].filter((n) => Number.isFinite(n) && n > 0);

      const best = candidates.sort((a, b) => Math.abs(a - luca) - Math.abs(b - luca))[0] ?? ocrTotal;
      const bestDiff = Math.abs(best - luca) / (luca || 1);
      return bestDiff < 0.01 ? best : ocrTotal;
    };
    /** Özetlerde aynı imageId birden fazla Luca satırına fan-out olduysa tek say. */
    const sumUniqueImageKdv = (rows: any[]): number => {
      const seen = new Set<string>();
      return rows.reduce((s, r: any) => {
        if (!r.image || !r.imageId) return s;
        if (seen.has(r.imageId)) return s;
        seen.add(r.imageId);
        return s + getFaturaKdvValue(r);
      }, 0);
    };

    // Özet için 3 ayrı grup — kullanıcının "fark" kafa karışıklığını çözer
    const sumLucaAll = results.reduce((s, r: any) => s + (r.kdvRecord?.kdvTutari ? Number(r.kdvRecord.kdvTutari) : 0), 0);
    // sumOcrAll: orijinal OCR toplamı (her image bir kez sayılır — fan-out çift saymaz)
    const sumOcrAll = sumUniqueImageKdv(results as any[]);
    // Sadece eşleşen tutarlar: MATCHED + CONFIRMED (kullanıcının onayladıkları)
    const sumLucaMatched = results
      .filter((r: any) => isMatchedStatus(r.status))
      .reduce((s, r: any) => s + (r.kdvRecord?.kdvTutari ? Number(r.kdvRecord.kdvTutari) : 0), 0);
    // sumOcrMatched: orijinal OCR toplamı üzerinden — fan-out çift saymaz
    const matchedRows = results.filter((r: any) => isMatchedStatus(r.status)) as any[];
    const sumOcrMatched = sumUniqueImageKdv(matchedRows);
    const fmtTl = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';

    // ═══════════════ ExcelJS ile oluştur ═══════════════
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Moren Mali Müşavirlik';
    wb.created = now;
    const ws = wb.addWorksheet('KDV Kontrol', {
      pageSetup: { paperSize: 9, orientation: 'landscape' },
      views: [{ state: 'frozen', ySplit: 1 }],
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
      { width: 6 },
      { width: 16 },
      { width: 26 },
      { width: 16, style: { numFmt: '#,##0.00 "₺"' } },
      { width: 16 },
      { width: 26 },
      { width: 16, style: { numFmt: '#,##0.00 "₺"' } },
      { width: 16 },
      { width: 72 },
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
        c4.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
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
      // Kullanıcıya gerçek OCR/onaylı KDV değerini göster. Özet toplamları
      // aynı görseli tek saydığı için burada sentetik paylaştırma yapmıyoruz.
      const faturaKdvNum = getFaturaKdvValue(r);
      const faturaKdv = faturaKdvNum > 0 ? faturaKdvNum : null;

      let durum = '';
      if (r.status === 'MATCHED') durum = '✓ EŞLEŞTİ';
      else if (r.status === 'CONFIRMED') durum = '✓ ONAYLANDI';
      else if (r.status === 'PARTIAL_MATCH') durum = '⚠ KISMİ';
      else if (r.status === 'NEEDS_REVIEW') durum = '⚠ İNCELE';
      else if (r.status === 'UNMATCHED') durum = '✗ EŞLEŞMEDİ';
      else if (r.status === 'REJECTED') durum = '✗ REDDEDİLDİ';
      else durum = r.status;

      // Açıklama: orphan durumda referans no ekle ki muhasebeci hangi tarafı
      // arayacağını bilsin. ONAYLANDI durumda notes da raporda görünsün.
      const noteSuffix = r.notes ? ` · Not: ${r.notes}` : '';
      const formattedReasons = this.formatKdvExportReasons(r.mismatchReasons || []);
      const aciklama = !r.image && r.kdvRecord
        ? (lucaEvrak === '—'
            ? `Luca satırında belge no/tarih yok; görselle eşleşemedi (${fmtTl(Number(r.kdvRecord.kdvTutari || 0))})`
            : `Fatura görseli yok: ${lucaEvrak} (${fmtTl(Number(r.kdvRecord.kdvTutari || 0))})`)
        : !r.kdvRecord && r.image
          ? `Luca kaydı yok: ${faturaBelgeNo}`
          : (formattedReasons || (isMatchedStatus(r.status) ? 'Tam eşleşme' : 'İncele')) + noteSuffix;

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
          wrapText: colNum === 9,
        };
        cell.border = {
          top:    { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left:   { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right:  { style: 'thin', color: { argb: 'FFE5E7EB' } },
        };
      });
    });

    if (seriUyarilari.length > 0) {
      const startRow = 17 + results.length;
      ws.mergeCells(`A${startRow}:I${startRow}`);
      const title = ws.getCell(`A${startRow}`);
      title.value = 'SATIŞ FATURA SERİ KONTROLÜ';
      title.font = { bold: true, size: 12, color: { argb: YELLOW_TEXT } };
      title.alignment = { horizontal: 'center', vertical: 'middle' };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW_BG } };
      title.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      };

      seriUyarilari.forEach((u, idx) => {
        const rowNum = startRow + idx + 1;
        ws.mergeCells(`A${rowNum}:B${rowNum}`);
        ws.mergeCells(`C${rowNum}:I${rowNum}`);
        const tip = ws.getCell(`A${rowNum}`);
        const mesaj = ws.getCell(`C${rowNum}`);
        tip.value = u.tip === 'cross_break' ? 'Önceki dönem kopukluğu' : 'Oturum içi eksik seri';
        mesaj.value = u.mesaj;
        ws.getRow(rowNum).height = 30;
        [tip, mesaj].forEach((cell, cellIdx) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFFFF8E1' : 'FFFFFBEB' } };
          cell.font = { size: 10, color: { argb: cellIdx === 0 ? YELLOW_TEXT : 'FF1A1916' }, bold: cellIdx === 0 };
          cell.alignment = { horizontal: cellIdx === 0 ? 'center' : 'left', vertical: 'middle', wrapText: true };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          };
        });
      });
    }

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    // Arşive kaydet (fiş yazdırmadaki gibi — geriye dönük erişim)
    if (opts.autoArchive !== false) {
      try {
        const session = await this.prisma.kdvControlSession.findUnique({
          where: { id: sessionId },
          include: { taxpayer: true },
        });
        // Excel özet ile aynı kategori mantığı kullan — istatistikler tutarlı olsun
        const matchedCount = results.filter((r) => r.status === 'MATCHED' || r.status === 'CONFIRMED').length;
        const partialCount = results.filter((r) => r.status === 'PARTIAL_MATCH' || r.status === 'NEEDS_REVIEW').length;
        const unmatchedCount = results.filter((r) => r.status === 'UNMATCHED' || r.status === 'REJECTED').length;
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
            totalRecords: results.filter((r: any) => r.kdvRecord && !isAggregateLucaRecord(r.kdvRecord)).length,
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

  private formatKdvExportReasons(reasons: string[]): string {
    const cleaned = (reasons || [])
      .filter(Boolean)
      .filter((r) => !/^VKN\/TCKN tam eşleşti/i.test(r))
      .filter((r) => !/^Satıcı uyumsuz/i.test(r))
      .map((r) => {
        if (/KDV tutar uyumsuz/i.test(r)) return r.replace(/^KDV tutar uyumsuz:\s*/i, 'KDV farklı: ');
        if (/Görselden KDV tutarı okunamadı/i.test(r)) return 'Faturadan KDV okunamadı';
        if (/Belge no/i.test(r) && /uyumsuz/i.test(r)) return 'Belge no farklı';
        if (/Tarih/i.test(r) && /uyumsuz/i.test(r)) return 'Tarih farklı';
        if (/Alış tevkifat (eşleşmesi|bileşen eşleşmesi)/i.test(r)) return 'Tevkifatlı alış eşleşti';
        return r;
      });

    return Array.from(new Set(cleaned)).slice(0, 2).join(' · ');
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
    const session = await this.findSession(sessionId, tenantId);

    const [records, totalImages, results, images] = await Promise.all([
      this.prisma.kdvRecord.findMany({ where: { sessionId } }),
      this.prisma.receiptImage.count({ where: { sessionId } }),
      this.prisma.reconciliationResult.findMany({
        where: { sessionId },
        include: { kdvRecord: true },
      }),
      this.prisma.receiptImage.findMany({
        where: { sessionId },
        select: { ocrEngine: true, ocrStatus: true, imageHash: true, originalName: true },
      }),
    ]);
    const totalRecords = records.filter((r) => !isAggregateLucaRecord(r)).length;
    const visibleResults = results.filter((r) => !r.kdvRecord || !isAggregateLucaRecord(r.kdvRecord));

    const statusMap: Record<string, number> = {};
    visibleResults.forEach((r) => (statusMap[r.status] = (statusMap[r.status] ?? 0) + 1));

    const needsConfirm = await this.prisma.receiptImage.count({
      where: {
        sessionId,
        ocrStatus: { in: ['LOW_CONFIDENCE', 'NEEDS_REVIEW', 'FAILED'] },
        isManuallyConfirmed: false,
      },
    });

    // v1.36.67: SERİ TAKİBİ — sadece SATIŞ tipi (KDV_391, ISLETME_GELIR) için
    // Aynı oturumdaki belge no'larını numerik sırala, eksik aralık tespit et
    // + bir önceki dönemin son belge no'su ile cross-month süreklilik kontrolü
    const seriUyarilari = await this.checkBelgeSeriContinuity(session, sessionId, tenantId);

    const usageRows = await (this.prisma as any).aiUsageLog.findMany({
      where: {
        tenantId,
        source: 'kdv-ocr',
        sebep: `session:${sessionId}`,
      },
      select: {
        costUsd: true,
        cacheHit: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
        model: true,
      },
    });
    const actualCostUsd = usageRows.reduce((s: number, r: any) => s + Number(r.costUsd || 0), 0);
    const actualCacheHits = usageRows.filter((r: any) => r.cacheHit).length;
    const actualPaidCalls = usageRows.filter((r: any) => !r.cacheHit && Number(r.costUsd || 0) > 0).length;
    const actualInputTokens = usageRows.reduce((s: number, r: any) => s + Number(r.inputTokens || 0), 0);
    const actualOutputTokens = usageRows.reduce((s: number, r: any) => s + Number(r.outputTokens || 0), 0);
    const actualCacheReadTokens = usageRows.reduce((s: number, r: any) => s + Number(r.cacheReadTokens || 0), 0);
    const actualCacheWriteTokens = usageRows.reduce((s: number, r: any) => s + Number(r.cacheWriteTokens || 0), 0);

    const engineStats = images.reduce(
      (acc, img) => {
        const engine = img.ocrEngine || '';
        if (/cache/i.test(engine)) acc.cacheHits++;
        else if (/ubl-xml|xml-direct/i.test(engine) || /\.xml$/i.test(img.originalName || '')) acc.xmlParsed++;
        else if (/claude/i.test(engine)) {
          acc.claudeReads++;
          if (/escalation/i.test(engine)) acc.claudeEscalations++;
        }
        else if (/azure/i.test(engine)) acc.azureReads++;
        else if (img.ocrStatus === 'SUCCESS' || img.ocrStatus === 'NEEDS_REVIEW') acc.otherReads++;
        return acc;
      },
      { claudeReads: 0, claudeEscalations: 0, azureReads: 0, cacheHits: 0, xmlParsed: 0, otherReads: 0 },
    );
    const estimatedCostUsd = engineStats.claudeReads * 0.0025;
    const estimatedSavedUsd = (engineStats.cacheHits + engineStats.xmlParsed) * 0.0025;

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
      seriUyarilari, // ← yeni alan: array of {tip: 'eksik'|'cross_break', mesaj: string}
      ocrCost: {
        actualCostUsd,
        estimatedCostUsd,
        estimatedSavedUsd,
        paidCalls: actualPaidCalls || engineStats.claudeReads,
        cacheHits: Math.max(actualCacheHits, engineStats.cacheHits),
        xmlParsed: engineStats.xmlParsed,
        azureReads: engineStats.azureReads,
        claudeEscalations: engineStats.claudeEscalations,
        freeSkips: Math.max(actualCacheHits, engineStats.cacheHits) + engineStats.xmlParsed,
        inputTokens: actualInputTokens,
        outputTokens: actualOutputTokens,
        cacheReadTokens: actualCacheReadTokens,
        cacheWriteTokens: actualCacheWriteTokens,
        logCount: usageRows.length,
      },
    };
  }

  /**
   * v1.36.67: Belge seri takibi.
   * - Sadece SATIŞ oturumlarında çalışır (KDV_391 / ISLETME_GELIR)
   * - Belge no'larını prefix + numerik kısma ayırır
   * - Bu oturum içi gap'leri tespit eder
   * - Bir önceki dönemin son belge no'su ile cross-month süreklilik kontrolü
   * Sonuç: array of warning messages — kullanıcıya gösterilecek.
   */
  private async checkBelgeSeriContinuity(
    session: any,
    sessionId: string,
    tenantId: string,
  ): Promise<Array<{ tip: string; mesaj: string }>> {
    const isSatis = session.type === 'KDV_391' || session.type === 'ISLETME_GELIR';
    if (!isSatis) return [];
    const records = await this.prisma.kdvRecord.findMany({
      where: { sessionId, belgeNo: { not: null } },
      select: { belgeNo: true, belgeDate: true },
    });
    if (records.length === 0) return [];

    // Belge no'yu prefix + numeric kısma ayır
    const parse = (no: string): { prefix: string; num: number } | null => {
      const cleaned = no.trim().toUpperCase();
      // Trailing rakam grubunu yakala
      const m = cleaned.match(/^(.*?)(\d+)$/);
      if (!m) return null;
      return { prefix: m[1], num: parseInt(m[2], 10) };
    };

    const grouped: Record<string, number[]> = {};
    for (const r of records) {
      if (!r.belgeNo) continue;
      const p = parse(String(r.belgeNo));
      if (!p) continue;
      if (!grouped[p.prefix]) grouped[p.prefix] = [];
      grouped[p.prefix].push(p.num);
    }

    const uyarilar: Array<{ tip: string; mesaj: string }> = [];

    // Bu oturum içi gap kontrolü
    for (const [prefix, nums] of Object.entries(grouped)) {
      const sorted = [...new Set(nums)].sort((a, b) => a - b);
      if (sorted.length < 2) continue;
      const eksikler: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        for (let n = sorted[i - 1] + 1; n < sorted[i]; n++) {
          eksikler.push(n);
        }
      }
      if (eksikler.length > 0) {
        const padLen = String(sorted[sorted.length - 1]).length;
        const eksikStr = eksikler.slice(0, 10).map((n) => prefix + String(n).padStart(padLen, '0')).join(', ');
        const fazla = eksikler.length > 10 ? ` (+${eksikler.length - 10} tane daha)` : '';
        uyarilar.push({
          tip: 'gap',
          mesaj: `${eksikler.length} numaralı fatura seri takibi kontrolünde eksik tespit edildi: ${eksikStr}${fazla}`,
        });
      }
    }

    // Cross-month: önceki dönem son belge no
    if (session.taxpayerId && session.periodLabel) {
      const [yilStr, ayStr] = session.periodLabel.split(/[/-]/);
      const yil = parseInt(yilStr, 10);
      const ay = parseInt(ayStr, 10);
      if (Number.isFinite(yil) && Number.isFinite(ay)) {
        // Önceki ayı hesapla
        let oncekiAy = ay - 1;
        let oncekiYil = yil;
        if (oncekiAy < 1) { oncekiAy = 12; oncekiYil = yil - 1; }
        const oncekiPeriod1 = `${oncekiYil}/${String(oncekiAy).padStart(2, '0')}`;
        const oncekiPeriod2 = `${oncekiYil}-${String(oncekiAy).padStart(2, '0')}`;

        const oncekiSession = await this.prisma.kdvControlSession.findFirst({
          where: {
            tenantId,
            taxpayerId: session.taxpayerId,
            type: session.type,
            periodLabel: { in: [oncekiPeriod1, oncekiPeriod2] },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (oncekiSession) {
          const oncekiRecords = await this.prisma.kdvRecord.findMany({
            where: { sessionId: oncekiSession.id, belgeNo: { not: null } },
            select: { belgeNo: true },
          });
          // Önceki ayın son belge no'su (her prefix için)
          const oncekiByPrefix: Record<string, number> = {};
          for (const r of oncekiRecords) {
            if (!r.belgeNo) continue;
            const p = parse(String(r.belgeNo));
            if (!p) continue;
            oncekiByPrefix[p.prefix] = Math.max(oncekiByPrefix[p.prefix] || 0, p.num);
          }

          // Bu ayın ilk belge no'su her prefix için
          for (const [prefix, nums] of Object.entries(grouped)) {
            const sorted = [...new Set(nums)].sort((a, b) => a - b);
            const buAyIlk = sorted[0];
            const oncekiSon = oncekiByPrefix[prefix];
            if (oncekiSon != null && buAyIlk > oncekiSon + 1) {
              const padLen = String(buAyIlk).length;
              const eksikSayi = buAyIlk - oncekiSon - 1;
              uyarilar.push({
                tip: 'cross_break',
                mesaj: `Önceki dönem (${oncekiSession.periodLabel}) son belge ${prefix}${String(oncekiSon).padStart(padLen, '0')} → bu dönem ilk belge ${prefix}${String(buAyIlk).padStart(padLen, '0')}. Aralarda ${eksikSayi} belge no atlanmış.`,
              });
            }
          }
        }
      }
    }

    return uyarilar;
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
  /**
   * Luca fetch job durumu sorgu — frontend polling için.
   * Mizan'daki getJob ile aynı, sadece tenant'a filtrelenmiş.
   */
  async getLucaJob(jobId: string, tenantId: string) {
    const job = await (this.prisma as any).lucaFetchJob.findFirst({
      where: { id: jobId, tenantId },
    });
    if (!job) {
      throw new NotFoundException('Luca job bulunamadı');
    }
    return job;
  }

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
      // Session type'a göre — KDV_191/391 için MAPPING'li parse et (manuel ile aynı)
      // Çünkü auto-detect parser bazı Excel'lerde fail ediyor.
      const session = await this.prisma.kdvControlSession.findUnique({ where: { id: sessionId } });
      const isKdv = session?.type === 'KDV_191' || session?.type === 'KDV_391';
      let result: { parsed?: number; imported?: number };
      if (isKdv) {
        // Luca Defteri Kebir Excel default sütun isimleri
        const mapping = {
          tarihCol: 'EVRAK TARİHİ',
          belgeNoCol: 'EVRAK NO',
          kdvCol: session?.type === 'KDV_191' ? 'BORÇ' : 'ALACAK',
        };
        const mapResult = await this.importExcelWithMapping(sessionId, tenantId, buffer, mapping);
        result = { parsed: mapResult.imported };
      } else {
        result = await this.uploadExcel(sessionId, tenantId, buffer);
      }
      await this.luca.markJobDone(jobId, result.parsed || 0);
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
        // Faturalar sayfası .includes() ile filtreliyor çünkü MIHSAP bazı kayıtları
        // "SATIS_FATURA" / "ALIS_EARSIV" gibi bileşik değerle döndürüyor.
        // Tam eşleşme ("SATIS") bu kayıtları kaçırıyordu — substring match yapıyoruz.
        faturaTuru: { contains: faturaTuru },
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
    opts: { forceFresh?: boolean; forceClaude?: boolean } = {},
  ) {
    await this.findSession(sessionId, tenantId);
    const forceFresh = opts.forceFresh === true;
    const forceClaude = opts.forceClaude === true;

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
            ocrKdvTevkifat: cached.ocrKdvTevkifat,
            ocrSatici: cached.ocrSatici,
            ocrSaticiVkn: cached.ocrSaticiVkn,
            ocrRawText: cached.ocrRawText,
            ocrConfidence: cached.ocrConfidence,
            ocrBelgeNoConfidence: cached.ocrBelgeNoConfidence,
            ocrDateConfidence: cached.ocrDateConfidence,
            ocrKdvConfidence: cached.ocrKdvConfidence,
            ocrEngine: (cached.ocrEngine || 'claude-haiku-4-5') + ' (cached)',
            ocrBelgeTipi: cached.ocrBelgeTipi,
            ocrKdvBreakdown: cached.ocrKdvBreakdown as any,
            ocrValidationScore: cached.ocrValidationScore,
            ocrKategori: cached.ocrKategori,
            imageHash: cached.imageHash,
          },
        });
        const session = await this.findSession(sessionId, tenantId);
        const tp = session.taxpayer;
        const mukellef = tp
          ? tp.companyName || [tp.firstName, tp.lastName].filter(Boolean).join(' ').trim() || null
          : null;
        await logAiUsage(this.prisma, {
          tenantId,
          source: 'kdv-ocr',
          model: cached.ocrEngine || 'cache',
          taxpayerId: session.taxpayerId || null,
          mukellef,
          belgeNo: cached.ocrBelgeNo || null,
          karar: 'cache_hit',
          sebep: `session:${sessionId}`,
          cacheHit: true,
          usage: { input_tokens: 0, output_tokens: 0 },
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
      return {
        queued: 0,
        cacheHits,
        estimatedSavedUsd: cacheHits * 0.0025,
        message: 'Tüm faturalar önceden OCR edilmişti',
      };
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
            await this.runOcrForMihsapInvoice(img.id, invoiceId, tenantId, { forceClaude });
          } else {
            await this.runOcrForImage(img.id, img.s3Key, { forceClaude });
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
      estimatedSavedUsd: cacheHits * 0.0025,
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
    opts: { forceClaude?: boolean } = {},
  ) {
    const t0 = Date.now();
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

      // ─── HASH CACHE KONTROLÜ ───
      // Aynı görüntü daha önce başarılı işlendiyse Claude'a hiç gitme — DB'den dön.
      const imageHash = this.ocrService.computeImageHash(buffer);
      if (await this.tryApplyHashCache(imageId, imageHash, Date.now() - t0)) return;
      const cached = await (this.prisma as any).receiptImage.findFirst({
        where: { imageHash, ocrStatus: 'SUCCESS' },
        orderBy: { uploadedAt: 'desc' },
        select: {
          ocrBelgeNo: true, ocrDate: true, ocrKdvTutari: true, ocrKdvTevkifat: true,
          ocrSatici: true, ocrRawText: true, ocrConfidence: true,
          ocrBelgeNoConfidence: true, ocrDateConfidence: true, ocrKdvConfidence: true,
          ocrEngine: true, ocrBelgeTipi: true, ocrKdvBreakdown: true,
          ocrValidationScore: true, ocrKategori: true,
        },
      });

      if (cached) {
        this.logger.log(`Hash cache HIT [${imageId}]: ${imageHash.slice(0, 8)}... · Claude'a gidilmedi (~$0.007 saved)`);
        await this.prisma.receiptImage.update({
          where: { id: imageId },
          data: {
            ocrStatus: 'SUCCESS',
            ocrBelgeNo: cached.ocrBelgeNo,
            ocrDate: cached.ocrDate,
            ocrKdvTutari: cached.ocrKdvTutari,
            ocrKdvTevkifat: cached.ocrKdvTevkifat,
            ocrSatici: cached.ocrSatici,
            ocrRawText: cached.ocrRawText,
            ocrConfidence: cached.ocrConfidence,
            ocrBelgeNoConfidence: cached.ocrBelgeNoConfidence,
            ocrDateConfidence: cached.ocrDateConfidence,
            ocrKdvConfidence: cached.ocrKdvConfidence,
            ocrEngine: `${cached.ocrEngine || 'unknown'} (cache)`,
            ocrBelgeTipi: cached.ocrBelgeTipi,
            ocrKdvBreakdown: cached.ocrKdvBreakdown,
            ocrValidationScore: cached.ocrValidationScore,
            ocrKategori: cached.ocrKategori,
            imageHash,
          } as any,
        });
        // Cache hit istatistiği için AiUsageLog'a 0-cost kayıt
        try {
          await (this.prisma as any).aiUsageLog.create({
            data: {
              tenantId,
              taxpayerId: inv.mukellefId || null,
              source: 'mihsap-fatura-cache',
              mukellef: inv.firmaUnvan || null,
              model: cached.ocrEngine || 'cache',
              inputTokens: 0,
              outputTokens: 0,
              costUsd: 0,
              karar: 'cache_hit',
              belgeNo: cached.ocrBelgeNo,
              cacheHit: true,
            },
          });
        } catch {}
        return;
      }

      // ─── CACHE MISS → Claude'a git ───
      const ocrResult = await this.ocrService.extractFromImage(buffer, filenameHint, {
        forceClaude: opts.forceClaude === true,
      });
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
          ocrKdvTevkifat: ocrResult.kdvTevkifat ?? null,
          ocrSatici: (ocrResult as any).satici || null,
          ocrSaticiVkn: (ocrResult as any).saticiVkn || null,
          ocrRawText: ocrResult.rawText?.substring(0, 2000),
          ocrConfidence: ocrResult.confidence,
          ocrBelgeNoConfidence: ocrResult.fieldConfidence.belgeNo,
          ocrDateConfidence: ocrResult.fieldConfidence.date,
          ocrKdvConfidence: ocrResult.fieldConfidence.kdvTutari,
          ocrEngine: ocrResult.engine,
          ocrBelgeTipi: (ocrResult as any).belgeTipi || null,
          ocrKdvBreakdown: (ocrResult as any).kdvBreakdown || null,
          ocrValidationScore: (ocrResult as any).validationScore ?? null,
          ocrKategori: (ocrResult as any).kategori || null,
          imageHash,
          // confirmed* alanlarını DOLDURMUYORUZ — Mihsap verisine güvenilmez.
        } as any,
      });

      await this.logOcrUsage(imageId, ocrResult, Date.now() - t0);

      // ─── VENDOR MEMORY UPSERT ───
      // OCR'dan VKN okuduysak VendorMemory'de "bu firmayı gördük" kaydı tut.
      // Sonraki KDV mutabakatlarında bu firma için öğrenilen kategori auto-suggest edilebilir.
      const vkn = (ocrResult as any).saticiVkn;
      const satici = (ocrResult as any).satici;
      if (vkn && (vkn.length === 10 || vkn.length === 11)) {
        try {
          await (this.prisma as any).vendorMemory.upsert({
            where: { tenantId_firmaKimlikNo: { tenantId, firmaKimlikNo: vkn } },
            create: {
              tenantId,
              firmaKimlikNo: vkn,
              firmaUnvan: satici || null,
              sonKullanim: new Date(),
            },
            update: {
              // Yeni unvan görüldüyse güncelle (son gördüğümüz isim)
              firmaUnvan: satici || undefined,
              sonKullanim: new Date(),
            },
          });
        } catch (e: any) {
          this.logger.warn(`VendorMemory upsert hatası (${vkn}): ${e?.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`runOcrForMihsapInvoice [${imageId}]: ${err?.message}`);
      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: { ocrStatus: 'FAILED' },
      });
    }
  }

  /**
   * Manuel Review Queue — tüm tenant'taki düşük güvenli OCR sonuçları.
   * NEEDS_REVIEW + LOW_CONFIDENCE statüsündeki ReceiptImage'ları döner,
   * kullanıcının teyit etmesi için.
   */
  async getReviewQueue(
    tenantId: string,
    opts: { taxpayerId?: string; donem?: string; limit?: number; offset?: number } = {},
  ) {
    const { taxpayerId, donem, limit = 100, offset = 0 } = opts;

    // Önce ilgili sessionları bul (tenant + opsiyonel taxpayer/donem)
    const sessionWhere: any = { tenantId };
    if (taxpayerId) sessionWhere.taxpayerId = taxpayerId;
    if (donem) sessionWhere.periodLabel = { in: [donem, donem.replace('-', '/')] };

    const sessions = await (this.prisma as any).kdvControlSession.findMany({
      where: sessionWhere,
      select: {
        id: true,
        taxpayerId: true,
        periodLabel: true,
        kayitTuru: true,
        taxpayer: {
          select: { firstName: true, lastName: true, companyName: true, taxNumber: true },
        },
      },
    });
    const sessionIds = sessions.map((s: any) => s.id);
    if (sessionIds.length === 0) {
      return { items: [], total: 0, limit, offset };
    }
    const sessionMap = new Map(sessions.map((s: any) => [s.id, s]));

    // ReviewQueue kriterleri: NEEDS_REVIEW veya LOW_CONFIDENCE; manuel teyit edilmemiş
    const where: any = {
      sessionId: { in: sessionIds },
      ocrStatus: { in: ['NEEDS_REVIEW', 'LOW_CONFIDENCE'] },
      isManuallyConfirmed: false,
    };

    const [items, total] = await Promise.all([
      (this.prisma as any).receiptImage.findMany({
        where,
        orderBy: [{ ocrConfidence: 'asc' }, { uploadedAt: 'desc' }], // en düşük confidence önce
        skip: offset,
        take: limit,
        select: {
          id: true,
          sessionId: true,
          originalName: true,
          ocrStatus: true,
          ocrBelgeNo: true,
          ocrDate: true,
          ocrKdvTutari: true,
          ocrKdvTevkifat: true,
          ocrSatici: true,
          ocrSaticiVkn: true,
          ocrBelgeTipi: true,
          ocrKategori: true,
          ocrConfidence: true,
          ocrBelgeNoConfidence: true,
          ocrDateConfidence: true,
          ocrKdvConfidence: true,
          ocrEngine: true,
          ocrValidationScore: true,
          uploadedAt: true,
        },
      }),
      (this.prisma as any).receiptImage.count({ where }),
    ]);

    // Her image'a session info ekle
    const enriched = items.map((img: any) => {
      const sess: any = sessionMap.get(img.sessionId);
      const tp = sess?.taxpayer;
      const mukellefAdi = tp?.companyName || [tp?.firstName, tp?.lastName].filter(Boolean).join(' ') || '—';
      return {
        ...img,
        session: sess
          ? {
              id: sess.id,
              taxpayerId: sess.taxpayerId,
              donem: sess.periodLabel,
              kayitTuru: sess.kayitTuru,
            }
          : null,
        mukellefAdi,
        mukellefVkn: tp?.taxNumber || null,
      };
    });

    return { items: enriched, total, limit, offset };
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
