import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Optional, Logger } from '@nestjs/common';
import { sayfaBoyutuNormalize, sayfaNoNormalize } from '../beyan-kayitlari/beyan-sayfa';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ConfirmNewVersionDto, InitiateNewVersionDto, InitiateUploadDto, UpdateDocumentDto } from '@mali-musavir/shared';
import { AutomationEventBus } from '../automations/automation-event-bus.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notification-types';

/**
 * Şemadaki `DocumentCategory` değerleri. Ekran süzgeci bunları gönderir; tanınmayan
 * değer sessizce yok sayılır (uydurma kategori süzgeci boş liste üretmesin).
 */
export const DOSYA_KATEGORILERI = ['SOZLESME', 'FATURA', 'BEYANNAME', 'EVRAK', 'DIGER'] as const;

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private notifications: NotificationsService,
    @Optional() private readonly eventBus?: AutomationEventBus,
  ) {}

  private uploadMaxBytes() {
    const raw = Number(process.env.DOCUMENT_UPLOAD_MAX_BYTES || 100 * 1024 * 1024);
    return Number.isFinite(raw) && raw > 0 ? raw : 100 * 1024 * 1024;
  }

  private assertUploadKey(tenantId: string, taxpayerId: string, s3Key: string) {
    const expectedPrefix = `${tenantId}/${taxpayerId}/`;
    if (!s3Key.startsWith(expectedPrefix) || s3Key.includes('..') || s3Key.includes('\\') || s3Key.startsWith('/')) {
      throw new ForbiddenException('Upload anahtari bu mukellefe ait degil');
    }
  }

  private assertUploadedObject(meta: { sizeBytes: number } | null): asserts meta is { sizeBytes: number } {
    if (!meta) throw new BadRequestException('Dosya S3\'e henuz yuklenmemis');
    if (!Number.isFinite(meta.sizeBytes) || meta.sizeBytes <= 0) {
      throw new BadRequestException('Bos dosya yuklenemez');
    }
    if (meta.sizeBytes > this.uploadMaxBytes()) {
      throw new BadRequestException('Dosya boyutu izin verilen limiti asiyor');
    }
  }

  /**
   * Adım 1: Upload başlatma — presigned URL döner
   */
  async initiateUpload(
    tenantId: string,
    userId: string,
    dto: InitiateUploadDto,
  ) {
    // Mükellef bu tenant'a mı ait?
    const taxpayer = await this.prisma.taxpayer.findFirst({
      where: { id: dto.taxpayerId, tenantId },
    });
    if (!taxpayer) throw new NotFoundException('Mükellef bulunamadı');

    const { uploadUrl, s3Key } = await this.storage.getPresignedUploadUrl(
      tenantId,
      dto.taxpayerId,
      dto.originalName,
      dto.mimeType,
    );

    return { uploadUrl, s3Key, expiresInSeconds: 900 };
  }

  /**
   * Adım 2: Upload onaylama — S3'e yüklendikten sonra DB'ye kaydet
   */
  async confirmUpload(
    tenantId: string,
    userId: string,
    dto: InitiateUploadDto & { s3Key: string },
  ) {
    this.assertUploadKey(tenantId, dto.taxpayerId, dto.s3Key);
    // S3 nesne boyutunu al (yüklendiğini doğrula)
    const meta = await this.storage.getObjectMeta(dto.s3Key);
    this.assertUploadedObject(meta);

    const taxpayer = await this.prisma.taxpayer.findFirst({
      where: { id: dto.taxpayerId, tenantId },
    });
    if (!taxpayer) throw new NotFoundException('Mükellef bulunamadı');

    const document = await this.prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          taxpayerId: dto.taxpayerId,
          title: dto.title,
          category: dto.category,
          mimeType: dto.mimeType,
          sizeBytes: meta.sizeBytes,
          s3Key: dto.s3Key,
          tags: dto.tags
            ? { create: dto.tags.map((tag: string) => ({ tag })) }
            : undefined,
        },
        include: { tags: true },
      });

      // İlk versiyonu oluştur
      const version = await tx.documentVersion.create({
        data: {
          documentId: doc.id,
          versionNo: 1,
          s3Key: dto.s3Key,
          sizeBytes: meta.sizeBytes,
          uploadedBy: userId,
          notes: 'İlk yükleme',
          // 2026-09-25 (bulgu 36b): tür ve özgün ad artık SÜRÜMDE de saklanıyor
          mimeType: dto.mimeType || null,
          originalName: dto.originalName || null,
        },
      });

      // Güncel versiyon ID'sini güncelle
      return tx.document.update({
        where: { id: doc.id },
        data: { currentVersionId: version.id },
        include: { tags: true, versions: true },
      });
    });

    // Otomasyon event'i: belge portala yüklendi
    if (this.eventBus) {
      this.eventBus.emit('Document.Uploaded', {
        tenantId,
        documentId: document.id,
        taxpayerId: dto.taxpayerId,
        title: dto.title,
        category: dto.category,
        mimeType: dto.mimeType,
        sizeBytes: meta.sizeBytes,
        uploadedBy: userId,
      });
    }

    // === IN-APP BILDIRIM: Yeni evrak yuklendi ===
    // Sadece tenant'in mukellef'i adina (yukleyen kullanici 3. parti veya mukellefin kendisi olabilir)
    // Yukleyenden farkli kullanicilara bildirim.
    try {
      const mukellefAdi = taxpayer.companyName ||
        [taxpayer.firstName, taxpayer.lastName].filter(Boolean).join(' ') ||
        'Mükellef';
      const sizeKb = Math.round((meta.sizeBytes || 0) / 1024);
      await this.notifications.createForTenant({
        tenantId,
        type: NOTIFICATION_TYPES.DOCUMENT_UPLOADED,
        title: `📤 Yeni evrak: ${mukellefAdi} - ${dto.title}`,
        body: `${dto.category || 'Belge'} kategorisinde, ${sizeKb} KB. Evrak detayını incelemek için tıklayın.`,
        metadata: {
          documentId: document.id,
          taxpayerId: dto.taxpayerId,
          taxpayerName: mukellefAdi,
          category: dto.category,
          mimeType: dto.mimeType,
          sizeBytes: meta.sizeBytes,
          uploadedBy: userId,
          link: `/panel/evraklar/${document.id}`,
        },
      });
    } catch (e) {
      this.logger.warn(`DOCUMENT_UPLOADED notif failed: ${(e as Error).message}`);
    }

    return document;
  }

  async uploadDirect(
    tenantId: string,
    userId: string,
    dto: InitiateUploadDto,
    file: { buffer: Buffer; mimetype?: string; originalname?: string },
  ) {
    const taxpayer = await this.prisma.taxpayer.findFirst({
      where: { id: dto.taxpayerId, tenantId },
    });
    if (!taxpayer) throw new NotFoundException('Mükellef bulunamadı');

    const sizeBytes = file.buffer?.length || 0;
    this.assertUploadedObject({ sizeBytes });

    const { s3Key } = await this.storage.getPresignedUploadUrl(
      tenantId,
      dto.taxpayerId,
      dto.originalName || file.originalname || dto.title,
      dto.mimeType || file.mimetype || 'application/octet-stream',
    );

    await this.storage.putBuffer(
      s3Key,
      file.buffer,
      dto.mimeType || file.mimetype || 'application/octet-stream',
      {
        'original-name': encodeURIComponent(dto.originalName || file.originalname || dto.title),
        'tenant-id': tenantId,
        'taxpayer-id': dto.taxpayerId,
      },
    );

    return this.confirmUpload(tenantId, userId, { ...dto, s3Key });
  }

  /**
   * Mükellef bazında belgeleri listele
   */
  async findByTaxpayer(
    tenantId: string,
    taxpayerId: string,
    category?: string,
    search?: string,
  ) {
    const taxpayer = await this.prisma.taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
    });
    if (!taxpayer) throw new NotFoundException('Mükellef bulunamadı');

    return this.prisma.document.findMany({
      where: {
        taxpayerId,
        isDeleted: false,
        ...(category ? { category: category as any } : {}),
        ...(search
          ? { title: { contains: search, mode: 'insensitive' } }
          : {}),
      },
      include: {
        tags: true,
        _count: { select: { versions: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Tüm tenant'ın belgelerini listele (genel evrak arşivi)
   */
  /**
   * Liste süzgeci — 2026-09-25 (portal denetimi bulgu 35b).
   *
   * Eskiden yalnız `category` + başlıkta arama vardı ve liste 100'e kırpılıyordu.
   * CANLI ÖLÇÜM (25 Eylül): silinmemiş belge sayısı **90.215**, ekran 100 gösteriyordu.
   * Ekran süzmeyi ve SAYAÇLARI o 100 satır üzerinde yaptığı için "Toplam Evrak: 100"
   * yazıyordu — 900 kat yanlış. Süzme artık veritabanında, sayaçlar `ozet()`ten.
   *
   * Arama başlıkta VE mükellef ünvanında çalışır (ekran ikisini de arıyor gibi
   * davranıyordu ama `d.name`/`d.fileName` alanları şemada YOK, yani başlık hiç
   * aranmıyordu).
   */
  private listeWhere(tenantId: string, opts: {
    category?: string; search?: string; taxpayerId?: string;
  }) {
    const arama = String(opts.search || '').trim();
    return {
      isDeleted: false,
      taxpayer: { tenantId },
      ...(opts.taxpayerId ? { taxpayerId: opts.taxpayerId } : {}),
      // `category` virgülle çoklu olabilir (ekranda tür kutucukları çoklu seçim).
      ...(() => {
        const secilen = String(opts.category || '')
          .split(',')
          .map((x) => x.trim().toUpperCase())
          .filter((x) => (DOSYA_KATEGORILERI as readonly string[]).includes(x));
        if (!secilen.length) return {};
        return secilen.length === 1
          ? { category: secilen[0] as any }
          : { category: { in: secilen as any[] } };
      })(),
      ...(arama
        ? {
            OR: [
              { title: { contains: arama, mode: 'insensitive' as any } },
              { taxpayer: { tenantId, companyName: { contains: arama, mode: 'insensitive' as any } } },
              { taxpayer: { tenantId, firstName: { contains: arama, mode: 'insensitive' as any } } },
              { taxpayer: { tenantId, lastName: { contains: arama, mode: 'insensitive' as any } } },
            ],
          }
        : {}),
    };
  }

  /**
   * Belge listesi. `page` verilirse `{ rows, total, page, pageSize }`, verilmezse
   * ESKİ dizi yanıtı aynen döner (repo sözleşmesi: docs/sayfalama-sozlesme-2026-09-14.md §4).
   * Böylece bu ucu kullanan eski ekranlar kırılmaz.
   */
  async findAll(
    tenantId: string,
    category?: string,
    search?: string,
    opts: { page?: unknown; pageSize?: unknown; taxpayerId?: string } = {},
  ) {
    const where = this.listeWhere(tenantId, { category, search, taxpayerId: opts.taxpayerId });
    const include = {
      tags: true,
      taxpayer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
      _count: { select: { versions: true } },
    };

    // Sayfa istenmediyse eski davranış (ilk 100) — sözleşme gereği yanıt biçimi DEĞİŞMEZ.
    if (opts.page === undefined || opts.page === null || opts.page === '') {
      return this.prisma.document.findMany({
        where,
        include,
        orderBy: { updatedAt: 'desc' },
        take: 100,
      });
    }

    const page = sayfaNoNormalize(opts.page);
    const pageSize = sayfaBoyutuNormalize(opts.pageSize);
    const [total, rows] = await Promise.all([
      this.prisma.document.count({ where }),
      this.prisma.document.findMany({
        where,
        include,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { rows, total, page, pageSize };
  }

  /**
   * GERÇEK SAYAÇLAR — 2026-09-25 (bulgu 35b).
   * Ekran sayaçları elindeki 100 satırdan üretiyordu. Artık tamamı veritabanından:
   * toplam, bu ay, kullanılan alan ve kategori dağılımı. Süzgeç verilirse sayaçlar
   * da süzülmüş kümeye göre hesaplanır (liste ile ayrışmaz).
   */
  async ozet(
    tenantId: string,
    opts: { category?: string; search?: string; taxpayerId?: string } = {},
  ) {
    const where = this.listeWhere(tenantId, opts);
    const simdi = new Date();
    const ayBasi = new Date(simdi.getFullYear(), simdi.getMonth(), 1);

    const [toplam, buAy, boyut, kategoriler] = await Promise.all([
      this.prisma.document.count({ where }),
      this.prisma.document.count({ where: { ...where, createdAt: { gte: ayBasi } } }),
      this.prisma.document.aggregate({ where, _sum: { sizeBytes: true } }),
      this.prisma.document.groupBy({ by: ['category'], where, _count: { _all: true } }),
    ]);

    const kategoriDagilimi: Record<string, number> = {};
    for (const k of kategoriler as any[]) {
      kategoriDagilimi[String(k.category)] = k._count?._all ?? 0;
    }

    return {
      toplam,
      buAy,
      toplamBoyut: boyut._sum.sizeBytes ?? 0,
      kategoriDagilimi,
    };
  }

  /**
   * Belge detayı
   */
  async findOne(id: string, tenantId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, isDeleted: false, taxpayer: { tenantId } },
      include: {
        tags: true,
        versions: { orderBy: { versionNo: 'desc' } },
        taxpayer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
      },
    });
    if (!doc) throw new NotFoundException('Belge bulunamadı');
    return doc;
  }

  private documentFilename(doc: { title: string; mimeType?: string | null; s3Key?: string | null }) {
    const cleanTitle = String(doc.title || 'evrak').replace(/[\\/:*?"<>|]/g, '_').trim() || 'evrak';
    const existingExt = cleanTitle.match(/\.([a-z0-9]{1,8})$/i)?.[1];
    if (existingExt) return cleanTitle;
    const keyExt = String(doc.s3Key || '').split('?')[0].match(/\.([a-z0-9]{1,8})$/i)?.[1];
    const mime = String(doc.mimeType || '').toLowerCase();
    const ext = keyExt || (mime.includes('/') ? mime.split('/')[1] : '') || 'bin';
    return `${cleanTitle}.${ext.replace(/[^a-z0-9.+-]/gi, '') || 'bin'}`;
  }

  /**
   * Eski sürümün dosya türü — 2026-09-25 (portal denetimi bulgu 36).
   *
   * `DocumentVersion` şemasında `mimeType` ve özgün dosya adı YOK; indirmede hep GÜNCEL
   * belgenin türü kullanılıyordu. Sonuç: v1 JPG iken v2 PDF olarak değiştirilmişse, v1
   * `application/pdf` Content-Type'ıyla iniyor/önizleniyor ve tarayıcı bozuk gösteriyordu.
   * Şema değişmeden yapılabilecek en doğru şey: sürümün KENDİ nesne anahtarındaki
   * uzantıdan türü çıkarmak. Uzantı yoksa güncel belgenin türüne düşülür (eski davranış).
   */
  /**
   * Sürümün gerçek tür + dosya adı — 2026-09-25 bulgu 36b.
   *
   * Artık `DocumentVersion`ta `mimeType` ve `originalName` var. KAYITLI DEĞER ÖNCE
   * gelir; yalnız o boşsa (geri dolum yapılmadı, eski satırlar null) uzantı tabanlı
   * `surumMimeTuru` yedeği devreye girer.
   */
  private surumBilgisi(
    version: { s3Key: string; mimeType?: string | null; originalName?: string | null },
    belgeVarsayilan?: string | null,
  ): { mimeType: string; originalName: string | null } {
    const kayitli = String(version.mimeType || '').trim();
    return {
      mimeType: kayitli || this.surumMimeTuru(version.s3Key, belgeVarsayilan),
      originalName: String(version.originalName || '').trim() || null,
    };
  }

  private surumMimeTuru(s3Key: string, varsayilan?: string | null): string {
    const uzanti = String(s3Key || '').split('?')[0].match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase();
    const tablo: Record<string, string> = {
      pdf: 'application/pdf',
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
      webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
      xml: 'application/xml', txt: 'text/plain', csv: 'text/csv', html: 'text/html',
      zip: 'application/zip',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    return (uzanti && tablo[uzanti]) || varsayilan || 'application/octet-stream';
  }

  /**
   * İndirme presigned URL'i
   */
  async getDownloadUrl(id: string, tenantId: string, versionNo?: number) {
    const doc = await this.findOne(id, tenantId);

    let s3Key = doc.s3Key;
    let mimeType = doc.mimeType || 'application/octet-stream';
    let surumAdi: string | null = null;
    if (versionNo) {
      const version = doc.versions.find((v) => v.versionNo === versionNo);
      if (!version) throw new NotFoundException('Versiyon bulunamadı');
      s3Key = version.s3Key;
      const bilgi = this.surumBilgisi(version as any, doc.mimeType);
      mimeType = bilgi.mimeType;
      surumAdi = bilgi.originalName;
    }

    const filename = surumAdi || this.documentFilename({ ...doc, s3Key, mimeType });
    const url = await this.storage.getPresignedDownloadUrl(s3Key, filename);
    return { url, filename, mimeType, expiresInSeconds: 3600 };
  }

  /**
   * Aynı dosya için tarayıcı içinde gösterilecek inline URL.
   */
  async getPreviewUrl(id: string, tenantId: string, versionNo?: number) {
    const doc = await this.findOne(id, tenantId);

    let s3Key = doc.s3Key;
    let mimeType = doc.mimeType || 'application/octet-stream';
    let surumAdi: string | null = null;
    if (versionNo) {
      const version = doc.versions.find((v) => v.versionNo === versionNo);
      if (!version) throw new NotFoundException('Versiyon bulunamadı');
      s3Key = version.s3Key;
      // Bulgu 36: önizlemede Content-Type yanlışsa tarayıcı belgeyi bozuk gösterir.
      const bilgi = this.surumBilgisi(version as any, doc.mimeType);
      mimeType = bilgi.mimeType;
      surumAdi = bilgi.originalName;
    }

    const filename = surumAdi || this.documentFilename({ ...doc, s3Key, mimeType });
    const url = await this.storage.getPresignedInlineUrl(s3Key, filename, mimeType);
    return { url, filename, mimeType, expiresInSeconds: 3600 };
  }

  /**
   * Yeni versiyon yükleme — presigned URL döner
   */
  async initiateNewVersion(
    id: string,
    tenantId: string,
    dto: InitiateNewVersionDto,
  ) {
    const doc = await this.findOne(id, tenantId);
    const { uploadUrl, s3Key } = await this.storage.getPresignedUploadUrl(
      tenantId,
      doc.taxpayerId,
      dto.originalName,
      dto.mimeType,
    );
    return { uploadUrl, s3Key, expiresInSeconds: 900, documentId: id };
  }

  /**
   * Yeni versiyon onayla
   */
  async confirmNewVersion(
    id: string,
    tenantId: string,
    userId: string,
    dto: ConfirmNewVersionDto,
  ) {
    const doc = await this.findOne(id, tenantId);
    this.assertUploadKey(tenantId, doc.taxpayerId, dto.s3Key);
    const meta = await this.storage.getObjectMeta(dto.s3Key);
    this.assertUploadedObject(meta);

    const lastVersion = doc.versions[0];
    const newVersionNo = (lastVersion?.versionNo ?? 0) + 1;

    return this.prisma.$transaction(async (tx) => {
      const version = await tx.documentVersion.create({
        data: {
          documentId: id,
          versionNo: newVersionNo,
          s3Key: dto.s3Key,
          sizeBytes: meta.sizeBytes,
          uploadedBy: userId,
          notes: dto.notes,
          mimeType: dto.mimeType || null,
          originalName: (dto as any).originalName || null,
        },
      });

      return tx.document.update({
        where: { id },
        data: {
          s3Key: dto.s3Key,
          mimeType: dto.mimeType,
          sizeBytes: meta.sizeBytes,
          currentVersionId: version.id,
        },
        include: { tags: true, versions: { orderBy: { versionNo: 'desc' } } },
      });
    });
  }

  /**
   * Belge meta güncelleme (başlık, kategori, etiketler, geçerlilik tarihi)
   */
  async update(id: string, tenantId: string, dto: UpdateDocumentDto) {
    await this.findOne(id, tenantId); // varlık kontrolü

    return this.prisma.$transaction(async (tx) => {
      if (dto.tags !== undefined) {
        await tx.documentTag.deleteMany({ where: { documentId: id } });
        if (dto.tags.length > 0) {
          await tx.documentTag.createMany({
            data: dto.tags.map((tag: string) => ({ documentId: id, tag })),
          });
        }
      }

      const data: any = {};
      if (dto.title) data.title = dto.title;
      if (dto.category) data.category = dto.category;
      if ((dto as any).expiresAt !== undefined) {
        const v = (dto as any).expiresAt;
        data.expiresAt = v === null ? null : new Date(v);
      }
      if ((dto as any).reminderDays !== undefined) data.reminderDays = (dto as any).reminderDays;
      if ((dto as any).notes !== undefined) data.notes = (dto as any).notes;

      return tx.document.update({
        where: { id },
        data,
        include: { tags: true },
      });
    });
  }

  /**
   * Geçerliliği biten / yakında bitecek belgeleri listele.
   * - daysAhead: kaç gün sonrasına kadar baksın (default 30)
   * - includeExpired: süresi geçmiş belgeleri de döndür (default true)
   * Sonuç: her belge için status ("EXPIRED" | "EXPIRING_SOON") + daysLeft
   */
  async getExpiring(
    tenantId: string,
    opts: { daysAhead?: number; includeExpired?: boolean; taxpayerId?: string } = {},
  ) {
    const daysAhead = opts.daysAhead ?? 30;
    const includeExpired = opts.includeExpired !== false;

    const now = new Date();
    const horizon = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);

    const where: any = {
      isDeleted: false,
      expiresAt: includeExpired
        ? { not: null, lte: horizon }
        : { gte: now, lte: horizon },
      taxpayer: { tenantId },
    };
    if (opts.taxpayerId) where.taxpayerId = opts.taxpayerId;

    const docs = await (this.prisma as any).document.findMany({
      where,
      include: {
        taxpayer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            companyName: true,
            taxNumber: true,
          },
        },
      },
      orderBy: { expiresAt: 'asc' },
      take: 200,
    });

    return docs.map((d: any) => {
      const expiresAt = d.expiresAt as Date | null;
      let status: 'EXPIRED' | 'EXPIRING_SOON' = 'EXPIRING_SOON';
      let daysLeft = 0;
      if (expiresAt) {
        const diff = Math.floor(
          (expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
        );
        daysLeft = diff;
        status = diff < 0 ? 'EXPIRED' : 'EXPIRING_SOON';
      }
      return { ...d, daysLeft, status };
    });
  }

  /**
   * Soft delete
   */
  async softDelete(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.document.update({
      where: { id },
      data: { isDeleted: true },
    });
  }
}
