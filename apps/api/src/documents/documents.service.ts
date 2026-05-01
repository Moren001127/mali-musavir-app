import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { InitiateUploadDto, UpdateDocumentDto } from '@mali-musavir/shared';

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

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
    // S3 nesne boyutunu al (yüklendiğini doğrula)
    const meta = await this.storage.getObjectMeta(dto.s3Key);
    if (!meta) throw new BadRequestException('Dosya S3\'e henüz yüklenmemiş');

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
            ? { create: dto.tags.map((tag) => ({ tag })) }
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

    return document;
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

    const filename = `${doc.title}.${doc.mimeType.split('/')[1] || 'bin'}`;
    const url = await this.storage.getPresignedDownloadUrl(s3Key, filename);
    return { url, filename, expiresInSeconds: 3600 };
  }

  /**
   * Yeni versiyon yükleme — presigned URL döner
   */
  async initiateNewVersion(
    id: string,
    tenantId: string,
    dto: { mimeType: string; originalName: string },
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
    dto: { s3Key: string; mimeType: string; notes?: string },
  ) {
    const doc = await this.findOne(id, tenantId);
    const meta = await this.storage.getObjectMeta(dto.s3Key);
    if (!meta) throw new BadRequestException('Dosya S3\'e henüz yüklenmemiş');

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
            data: dto.tags.map((tag) => ({ documentId: id, tag })),
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
