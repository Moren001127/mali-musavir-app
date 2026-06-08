import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Optional, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ConfirmNewVersionDto, InitiateNewVersionDto, InitiateUploadDto, UpdateDocumentDto } from '@mali-musavir/shared';
import { AutomationEventBus } from '../automations/automation-event-bus.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notification-types';

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
  async findAll(tenantId: string, category?: string, search?: string) {
    return this.prisma.document.findMany({
      where: {
        isDeleted: false,
        taxpayer: { tenantId },
        ...(category ? { category: category as any } : {}),
        ...(search
          ? { title: { contains: search, mode: 'insensitive' } }
          : {}),
      },
      include: {
        tags: true,
        taxpayer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
        _count: { select: { versions: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
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
   * İndirme presigned URL'i
   */
  async getDownloadUrl(id: string, tenantId: string, versionNo?: number) {
    const doc = await this.findOne(id, tenantId);

    let s3Key = doc.s3Key;
    if (versionNo) {
      const version = doc.versions.find((v) => v.versionNo === versionNo);
      if (!version) throw new NotFoundException('Versiyon bulunamadı');
      s3Key = version.s3Key;
    }

    const filename = this.documentFilename({ ...doc, s3Key });
    const url = await this.storage.getPresignedDownloadUrl(s3Key, filename);
    return { url, filename, mimeType: doc.mimeType || 'application/octet-stream', expiresInSeconds: 3600 };
  }

  /**
   * Aynı dosya için tarayıcı içinde gösterilecek inline URL.
   */
  async getPreviewUrl(id: string, tenantId: string, versionNo?: number) {
    const doc = await this.findOne(id, tenantId);

    let s3Key = doc.s3Key;
    if (versionNo) {
      const version = doc.versions.find((v) => v.versionNo === versionNo);
      if (!version) throw new NotFoundException('Versiyon bulunamadı');
      s3Key = version.s3Key;
    }

    const filename = this.documentFilename({ ...doc, s3Key });
    const mimeType = doc.mimeType || 'application/octet-stream';
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
