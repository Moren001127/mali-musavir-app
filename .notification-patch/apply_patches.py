#!/usr/bin/env python3
"""
Notification patcher — apply surgical edits to existing service files.
Idempotent: skips files that already have the patch applied.
Run from repo root: python apply_patches.py
"""
import sys
import os
from pathlib import Path

REPO = Path.cwd()
SRC = REPO / "apps/api/src"

PATCHES = []

def patch(file_rel, description, transforms):
    """transforms: list of (find, replace) tuples. Each find must be unique."""
    PATCHES.append((file_rel, description, transforms))

# === schema.prisma ===
patch("apps/api/prisma/schema.prisma",
    "Add NotificationPreference model + User relation",
    [
        # 1) Add NotificationPreference relation to User model
        (
            "  // Moren AI Otomasyon Motoru\n  createdAutomations Automation[]       @relation(\"AutomationCreator\")\n\n  @@unique([tenantId, email])\n  @@map(\"users\")",
            "  // Moren AI Otomasyon Motoru\n  createdAutomations Automation[]       @relation(\"AutomationCreator\")\n\n  // Bildirim tercihleri (hangi tip notification'lari almak istemiyor)\n  notificationPreference NotificationPreference?\n\n  @@unique([tenantId, email])\n  @@map(\"users\")",
        ),
        # 2) Add NotificationPreference model after Notification model
        (
            "  @@index([tenantId, isRead])\n  @@map(\"notifications\")\n}",
            """  @@index([tenantId, isRead])
  @@map("notifications")
}

// === BILDIRIM TERCIHI ===
// Kullanici bazli, hangi notification tiplerini almak istemiyor.
// Liste 'AUTH_NEW_DEVICE', 'TASK_DUE' gibi notification-types.ts'deki sabitler.
// Liste'de olmayan tipler default olarak GONDERILIR.
model NotificationPreference {
  id          String   @id @default(cuid())
  tenantId    String
  userId      String   @unique
  mutedTypes  String[] @default([])
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@map("notification_preferences")
}""",
        ),
    ])

# (task-reminder.cron.ts patch removed - already applied)

# === portal-automation.service.ts (PORTAL_CREDENTIAL_FAIL) ===
patch("apps/api/src/portal-automation/portal-automation.service.ts",
    "PORTAL_CREDENTIAL_FAIL: credential hatasinda bildirim",
    [
        (
            "import { BeyanKayitlariService } from '../beyan-kayitlari/beyan-kayitlari.service';",
            "import { BeyanKayitlariService } from '../beyan-kayitlari/beyan-kayitlari.service';\nimport { NotificationsService } from '../notifications/notifications.service';\nimport { NOTIFICATION_TYPES } from '../notifications/notification-types';",
        ),
        (
            "  constructor(\n    private prisma: PrismaService,\n    private storage: StorageService,\n    private beyanKayitlari: BeyanKayitlariService,\n  ) {}",
            "  constructor(\n    private prisma: PrismaService,\n    private storage: StorageService,\n    private beyanKayitlari: BeyanKayitlariService,\n    private notifications: NotificationsService,\n  ) {}",
        ),
        (
            "  private async markCredentialError(job: any, errorMessage: string) {\n    const meta = JOB_META[job.jobType as PortalJobType];\n    if (!meta) return;\n    const ownerId = meta.ownerType === 'TENANT' ? job.tenantId : job.taxpayerId;\n    if (!ownerId) return;\n    await (this.prisma as any).portalCredential.updateMany({\n      where: { tenantId: job.tenantId, provider: meta.provider, ownerType: meta.ownerType, ownerId },\n      data: { lastCheckedAt: new Date(), lastError: errorMessage.slice(0, 1000) },\n    });\n  }",
            """  private async markCredentialError(job: any, errorMessage: string) {
    const meta = JOB_META[job.jobType as PortalJobType];
    if (!meta) return;
    const ownerId = meta.ownerType === 'TENANT' ? job.tenantId : job.taxpayerId;
    if (!ownerId) return;
    await (this.prisma as any).portalCredential.updateMany({
      where: { tenantId: job.tenantId, provider: meta.provider, ownerType: meta.ownerType, ownerId },
      data: { lastCheckedAt: new Date(), lastError: errorMessage.slice(0, 1000) },
    });

    // === IN-APP BILDIRIM: PORTAL_CREDENTIAL_FAIL ===
    const m = (errorMessage || '').toLowerCase();
    const isCred = ['sifre','sifre','parola','password','login fail','invalid credential','unauthorized','authentication','gecersiz','gecersiz','kimlik','401','forbidden','403','oturum'].some((t) => m.includes(t));
    if (!isCred) return;
    let scopeLabel = meta.provider.replace(/_/g, ' ');
    if (meta.ownerType === 'TAXPAYER' && job.taxpayerId) {
      const tp = await (this.prisma as any).taxpayer.findFirst({
        where: { id: job.taxpayerId, tenantId: job.tenantId },
        select: { companyName: true, firstName: true, lastName: true },
      }).catch(() => null);
      if (tp) {
        const name = tp.companyName || [tp.firstName, tp.lastName].filter(Boolean).join(' ');
        if (name) scopeLabel = `${scopeLabel} - ${name}`;
      }
    }
    await this.notifications.createForTenant({
      tenantId: job.tenantId,
      type: NOTIFICATION_TYPES.PORTAL_CREDENTIAL_FAIL,
      title: `Portal sifre hatasi: ${scopeLabel}`,
      body: `${meta.label} islemi sirasinda giris yapilamadi. Lutfen ayarlardan parolayi guncelleyin. (${errorMessage.slice(0, 200)})`,
      metadata: {
        provider: meta.provider,
        ownerType: meta.ownerType,
        ownerId,
        jobId: job.id,
        jobType: job.jobType,
        link: '/panel/ayarlar/entegrasyonlar',
      },
      dedupeKey: `portal-cred-fail:${meta.provider}:${ownerId}`,
      dedupeWindowMin: 60 * 12,
    }).catch((e) => {
      this.logger.warn(`PORTAL_CREDENTIAL_FAIL notif failed: ${(e as Error).message}`);
    });
  }""",
        ),
    ])

# === luca.service.ts (LUCA_SYNC_ERROR) ===
patch("apps/api/src/luca/luca.service.ts",
    "LUCA_SYNC_ERROR: job fail edince bildirim",
    [
        (
            "import { PrismaService } from '../prisma/prisma.service';",
            "import { PrismaService } from '../prisma/prisma.service';\nimport { NotificationsService } from '../notifications/notifications.service';\nimport { NOTIFICATION_TYPES } from '../notifications/notification-types';",
        ),
        (
            "  constructor(private readonly prisma: PrismaService) {}",
            "  constructor(\n    private readonly prisma: PrismaService,\n    private readonly notifications: NotificationsService,\n  ) {}",
        ),
        (
            "    await this.appendJobLog(jobId, `X ${errorMsg}`);\n    await (this.prisma as any).lucaFetchJob.updateMany({\n      where: { id: jobId, status: { notIn: ['cancelled'] } },\n      data: { status: 'failed', finishedAt: new Date() },\n    });",
            """    await this.appendJobLog(jobId, `X ${errorMsg}`);
    await (this.prisma as any).lucaFetchJob.updateMany({
      where: { id: jobId, status: { notIn: ['cancelled'] } },
      data: { status: 'failed', finishedAt: new Date() },
    });

    // === IN-APP BILDIRIM: LUCA_SYNC_ERROR ===
    if (job?.tenantId) {
      let mukellefLabel = '';
      if (job.mukellefId) {
        const tp = await (this.prisma as any).taxpayer.findFirst({
          where: { id: job.mukellefId, tenantId: job.tenantId },
          select: { companyName: true, firstName: true, lastName: true },
        }).catch(() => null);
        if (tp) mukellefLabel = tp.companyName || [tp.firstName, tp.lastName].filter(Boolean).join(' ') || '';
      }
      const titleSuffix = mukellefLabel ? ` (${mukellefLabel})` : '';
      await this.notifications.createForTenant({
        tenantId: job.tenantId,
        type: NOTIFICATION_TYPES.LUCA_SYNC_ERROR,
        title: `Luca aktarim hatasi: ${job.tip || 'job'}${titleSuffix}`,
        body: errorMsg.slice(0, 400),
        metadata: {
          jobId, jobTip: job.tip,
          mukellefId: job.mukellefId || null,
          mukellefLabel: mukellefLabel || null,
          sessionId: job.sessionId || null,
          donem: job.donem || null,
          link: '/panel/luca',
        },
        dedupeKey: `luca-fail:${job.tip}:${job.mukellefId || 'all'}:${job.donem || 'na'}`,
        dedupeWindowMin: 60 * 4,
      }).catch((e) => {
        this.logger.warn(`LUCA_SYNC_ERROR notif failed: ${(e as Error).message}`);
      });
    }""",
        ),
    ])

# === documents.service.ts (DOCUMENT_UPLOADED) ===
patch("apps/api/src/documents/documents.service.ts",
    "DOCUMENT_UPLOADED: belge upload sonrasi bildirim",
    [
        (
            "import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Optional } from '@nestjs/common';\nimport { PrismaService } from '../prisma/prisma.service';\nimport { StorageService } from '../storage/storage.service';\nimport { InitiateUploadDto, UpdateDocumentDto } from '@mali-musavir/shared';\nimport { AutomationEventBus } from '../automations/automation-event-bus.service';\n\n@Injectable()\nexport class DocumentsService {\n  constructor(\n    private prisma: PrismaService,\n    private storage: StorageService,\n    @Optional() private readonly eventBus?: AutomationEventBus,\n  ) {}",
            """import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Optional, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { InitiateUploadDto, UpdateDocumentDto } from '@mali-musavir/shared';
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
  ) {}""",
        ),
        (
            "    // Otomasyon event'i: belge portala yüklendi\n    if (this.eventBus) {\n      this.eventBus.emit('Document.Uploaded', {\n        tenantId,\n        documentId: document.id,\n        taxpayerId: dto.taxpayerId,\n        title: dto.title,\n        category: dto.category,\n        mimeType: dto.mimeType,\n        sizeBytes: meta.sizeBytes,\n        uploadedBy: userId,\n      });\n    }\n\n    return document;\n  }",
            """    // Otomasyon event'i: belge portala yüklendi
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

    // === IN-APP BILDIRIM: DOCUMENT_UPLOADED ===
    try {
      const mukellefAdi = taxpayer.companyName ||
        [taxpayer.firstName, taxpayer.lastName].filter(Boolean).join(' ') || 'Mukellef';
      const sizeKb = Math.round((meta.sizeBytes || 0) / 1024);
      await this.notifications.createForTenant({
        tenantId,
        type: NOTIFICATION_TYPES.DOCUMENT_UPLOADED,
        title: `Yeni evrak: ${mukellefAdi} - ${dto.title}`,
        body: `${dto.category || 'Belge'} kategorisinde, ${sizeKb} KB.`,
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
  }""",
        ),
    ])

# === pending-decisions.service.ts (PENDING_DECISION) ===
patch("apps/api/src/pending-decisions/pending-decisions.service.ts",
    "PENDING_DECISION: AI sapma onayi icin bildirim",
    [
        (
            "import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';\nimport { PrismaService } from '../prisma/prisma.service';\nimport { VendorMemoryService } from '../vendor-memory/vendor-memory.service';",
            "import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';\nimport { PrismaService } from '../prisma/prisma.service';\nimport { VendorMemoryService } from '../vendor-memory/vendor-memory.service';\nimport { NotificationsService } from '../notifications/notifications.service';\nimport { NOTIFICATION_TYPES } from '../notifications/notification-types';",
        ),
        (
            "@Injectable()\nexport class PendingDecisionsService {\n  constructor(\n    private prisma: PrismaService,\n    private vendorMemory: VendorMemoryService,\n  ) {}",
            "@Injectable()\nexport class PendingDecisionsService {\n  private readonly logger = new Logger(PendingDecisionsService.name);\n\n  constructor(\n    private prisma: PrismaService,\n    private vendorMemory: VendorMemoryService,\n    private notifications: NotificationsService,\n  ) {}",
        ),
        (
            "    if (existing) return existing;\n\n    return (this.prisma as any).pendingDecision.create({",
            "    if (existing) return existing;\n\n    const created = await (this.prisma as any).pendingDecision.create({",
        ),
        (
            """      select: {
        id: true,
        durum: true,
        sapmaSebep: true,
      },
    });
  }

  /** Bekleyenler listesi (ve onaylanmislar/reddedilenler dahil — durum filter) */""",
            """      select: {
        id: true,
        durum: true,
        sapmaSebep: true,
      },
    });

    // === IN-APP BILDIRIM: PENDING_DECISION ===
    try {
      const firmaLabel = firmaUnvan || firmaKimlikNo || 'firma';
      const mukellefLabel = mukellef || 'mukellef';
      const tutarLabel = tutar != null ? ` (${tutar.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL)` : '';
      await this.notifications.createForTenant({
        tenantId,
        type: NOTIFICATION_TYPES.PENDING_DECISION,
        title: `Onay bekliyor: ${mukellefLabel} - ${firmaLabel}${tutarLabel}`,
        body: `${kararTipi === 'fatura' ? 'Fatura' : 'Isletme'} karari - ${(sapmaSebep || '').slice(0, 200)}`,
        metadata: {
          pendingDecisionId: created.id,
          taxpayerId: taxpayerId || null,
          firmaKimlikNo: firmaKimlikNo || null,
          firmaUnvan: firmaUnvan || null,
          belgeNo: belgeNo || null,
          kararTipi,
          link: `/panel/onay-bekleyen?id=${created.id}`,
        },
        dedupeKey: `pending-decision:${created.id}`,
        dedupeWindowMin: 60 * 24,
      });
    } catch (e) {
      this.logger.warn(`PENDING_DECISION notif failed: ${(e as Error).message}`);
    }

    return created;
  }

  /** Bekleyenler listesi (ve onaylanmislar/reddedilenler dahil — durum filter) */""",
        ),
    ])

# === banka-takip.service.ts (BANK_TRANSACTION_ALERT) ===
patch("apps/api/src/banka-takip/banka-takip.service.ts",
    "BANK_TRANSACTION_ALERT: ekstre geldi false->true gecisi",
    [
        (
            "import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';\nimport { PrismaService } from '../prisma/prisma.service';",
            "import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';\nimport { PrismaService } from '../prisma/prisma.service';\nimport { NotificationsService } from '../notifications/notifications.service';\nimport { NOTIFICATION_TYPES } from '../notifications/notification-types';",
        ),
        (
            "@Injectable()\nexport class BankaTakipService {\n  constructor(private readonly prisma: PrismaService) {}",
            "@Injectable()\nexport class BankaTakipService {\n  private readonly logger = new Logger(BankaTakipService.name);\n\n  constructor(\n    private readonly prisma: PrismaService,\n    private readonly notifications: NotificationsService,\n  ) {}",
        ),
        (
            "    if (existing) {\n      return (this.prisma as any).bankaEkstreKaydi.update({\n        where: { id: existing.id },\n        data: updateData,\n      });\n    }\n    return (this.prisma as any).bankaEkstreKaydi.create({\n      data: {\n        tenantId,\n        taxpayerId: data.taxpayerId,\n        bankaHesapId: data.bankaHesapId || null,\n        donem: data.donem,\n        ekstreGeldi: data.ekstreGeldi ?? false,\n        geldiTarihi: data.ekstreGeldi ? now : null,\n        ekstreIslendi: data.ekstreIslendi ?? false,\n        islenmeTarihi: data.ekstreIslendi ? now : null,\n        islenmeNotu: data.islenmeNotu || null,\n        notlar: data.notlar || null,\n      },\n    });\n  }",
            """    let result;
    if (existing) {
      result = await (this.prisma as any).bankaEkstreKaydi.update({
        where: { id: existing.id },
        data: updateData,
      });
    } else {
      result = await (this.prisma as any).bankaEkstreKaydi.create({
        data: {
          tenantId,
          taxpayerId: data.taxpayerId,
          bankaHesapId: data.bankaHesapId || null,
          donem: data.donem,
          ekstreGeldi: data.ekstreGeldi ?? false,
          geldiTarihi: data.ekstreGeldi ? now : null,
          ekstreIslendi: data.ekstreIslendi ?? false,
          islenmeTarihi: data.ekstreIslendi ? now : null,
          islenmeNotu: data.islenmeNotu || null,
          notlar: data.notlar || null,
        },
      });
    }

    // === IN-APP BILDIRIM: BANK_TRANSACTION_ALERT (ekstre geldi gecisi) ===
    const transitionedToGeldi = data.ekstreGeldi === true && (!existing || existing.ekstreGeldi !== true);
    if (transitionedToGeldi) {
      try {
        const tp = await (this.prisma as any).taxpayer.findFirst({
          where: { id: data.taxpayerId, tenantId },
          select: { companyName: true, firstName: true, lastName: true },
        });
        const mukellefAdi = tp?.companyName || [tp?.firstName, tp?.lastName].filter(Boolean).join(' ') || 'mukellef';
        let bankaLabel = '';
        if (data.bankaHesapId) {
          const bh = await (this.prisma as any).bankaHesap.findFirst({
            where: { id: data.bankaHesapId, tenantId },
            select: { bankaAdi: true, hesapNo: true },
          });
          if (bh) bankaLabel = `${bh.bankaAdi}${bh.hesapNo ? ` ${bh.hesapNo}` : ''}`;
        }
        await this.notifications.createForTenant({
          tenantId,
          type: NOTIFICATION_TYPES.BANK_TRANSACTION_ALERT,
          title: `Ekstre geldi: ${mukellefAdi} (${data.donem})`,
          body: bankaLabel ? `${bankaLabel} ekstresi alindi.` : `${data.donem} donemi banka ekstresi alindi.`,
          metadata: {
            ekstreKaydiId: result.id,
            taxpayerId: data.taxpayerId,
            bankaHesapId: data.bankaHesapId || null,
            donem: data.donem,
            link: `/panel/banka-takip?donem=${encodeURIComponent(data.donem)}`,
          },
          dedupeKey: `bank-ekstre:${result.id}`,
          dedupeWindowMin: 60 * 24,
        });
      } catch (e) {
        this.logger.warn(`BANK_TRANSACTION_ALERT notif failed: ${(e as Error).message}`);
      }
    }

    return result;
  }""",
        ),
    ])

# === auth.service.ts (AUTH_NEW_DEVICE) ===
patch("apps/api/src/auth/auth.service.ts",
    "AUTH_NEW_DEVICE: yeni IP'den login uyarisi",
    [
        (
            "import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';",
            "import { Injectable, UnauthorizedException, ConflictException, Logger, Optional } from '@nestjs/common';",
        ),
        (
            "import { UsersService } from '../users/users.service';\nimport { RegisterDto } from '@mali-musavir/shared';",
            "import { UsersService } from '../users/users.service';\nimport { NotificationsService } from '../notifications/notifications.service';\nimport { NOTIFICATION_TYPES } from '../notifications/notification-types';\nimport { RegisterDto } from '@mali-musavir/shared';",
        ),
        (
            "@Injectable()\nexport class AuthService {\n  constructor(\n    private prisma: PrismaService,\n    private usersService: UsersService,\n    private jwtService: JwtService,\n    private config: ConfigService,\n  ) {}",
            "@Injectable()\nexport class AuthService {\n  private readonly logger = new Logger(AuthService.name);\n\n  constructor(\n    private prisma: PrismaService,\n    private usersService: UsersService,\n    private jwtService: JwtService,\n    private config: ConfigService,\n    @Optional() private notifications?: NotificationsService,\n  ) {}",
        ),
        (
            "  async login(user: any, ipAddress?: string) {\n    const payload = {\n      sub: user.id,\n      email: user.email,\n      tenantId: user.tenantId,\n      roles: user.userRoles?.map((ur: any) => ur.role.name) || [],\n    };\n\n    const accessToken = this.jwtService.sign(payload);",
            """  async login(user: any, ipAddress?: string) {
    const payload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      roles: user.userRoles?.map((ur: any) => ur.role.name) || [],
    };

    // === AUTH_NEW_DEVICE ===
    if (ipAddress && this.notifications) {
      try {
        const knownIp = await this.prisma.refreshToken.findFirst({
          where: { userId: user.id, ipAddress },
          select: { id: true },
        }).catch(() => null);
        if (!knownIp) {
          await this.notifications.create({
            tenantId: user.tenantId,
            userId: user.id,
            type: NOTIFICATION_TYPES.AUTH_NEW_DEVICE,
            title: 'Yeni cihazdan giris',
            body: `Hesabiniza yeni bir IP adresinden (${ipAddress}) giris yapildi. Bu siz degilseniz sifrenizi degistirin.`,
            metadata: { ipAddress, loginAt: new Date().toISOString(), link: '/panel/ayarlar' },
            dedupeKey: `auth-new-device:${user.id}:${ipAddress}`,
            dedupeWindowMin: 60 * 24 * 7,
          });
        }
      } catch (e) {
        this.logger.warn(`AUTH_NEW_DEVICE check failed: ${(e as Error).message}`);
      }
    }

    const accessToken = this.jwtService.sign(payload);""",
        ),
    ])

# === mihsap.service.ts (MIHSAP_RESULT) ===
patch("apps/api/src/mihsap/mihsap.service.ts",
    "MIHSAP_RESULT: toplu indirme bittiginde bildirim",
    [
        (
            "import { Injectable, Logger, BadRequestException, UnauthorizedException } from '@nestjs/common';\nimport { PrismaService } from '../prisma/prisma.service';\nimport { StorageService } from '../storage/storage.service';",
            "import { Injectable, Logger, BadRequestException, UnauthorizedException, Optional } from '@nestjs/common';\nimport { PrismaService } from '../prisma/prisma.service';\nimport { StorageService } from '../storage/storage.service';\nimport { NotificationsService } from '../notifications/notifications.service';\nimport { NOTIFICATION_TYPES } from '../notifications/notification-types';",
        ),
        (
            "  constructor(\n    private readonly prisma: PrismaService,\n    private readonly storage: StorageService,\n  ) {}",
            "  constructor(\n    private readonly prisma: PrismaService,\n    private readonly storage: StorageService,\n    @Optional() private readonly notifications?: NotificationsService,\n  ) {}",
        ),
        (
            "    await (this.prisma as any).mihsapFetchJob.update({\n      where: { id: job.id },\n      data: {\n        status: errorMsg ? 'failed' : 'done',\n        totalCount: total,\n        fetchedCount: fetched,\n        errorMsg,\n        finishedAt: new Date(),\n      },\n    });\n\n    if (errorMsg) {\n      throw new BadRequestException(errorMsg);\n    }\n\n    return { jobId: job.id, total, fetched, errorMsg };\n  }",
            """    await (this.prisma as any).mihsapFetchJob.update({
      where: { id: job.id },
      data: {
        status: errorMsg ? 'failed' : 'done',
        totalCount: total,
        fetchedCount: fetched,
        errorMsg,
        finishedAt: new Date(),
      },
    });

    // === IN-APP BILDIRIM: MIHSAP_RESULT ===
    if (this.notifications) {
      try {
        let mukellefLabel = '';
        if (params.mukellefId) {
          const tp = await (this.prisma as any).taxpayer.findFirst({
            where: { id: params.mukellefId, tenantId: params.tenantId },
            select: { companyName: true, firstName: true, lastName: true },
          }).catch(() => null);
          if (tp) mukellefLabel = tp.companyName || [tp.firstName, tp.lastName].filter(Boolean).join(' ') || '';
        }
        const title = errorMsg
          ? `Mihsap aktarim hatasi${mukellefLabel ? ` - ${mukellefLabel}` : ''}`
          : `Mihsap aktarim tamam${mukellefLabel ? ` - ${mukellefLabel}` : ''} (${fetched}/${total})`;
        const body = errorMsg
          ? `${params.donem} donemi: ${String(errorMsg).slice(0, 300)}`
          : `${params.donem} donemi: ${fetched} fatura indirildi/guncellendi.`;
        await this.notifications.createForTenant({
          tenantId: params.tenantId,
          type: NOTIFICATION_TYPES.MIHSAP_RESULT,
          title, body,
          metadata: {
            jobId: job.id,
            mukellefId: params.mukellefId || null,
            donem: params.donem,
            total, fetched,
            errorMsg: errorMsg || null,
            link: '/panel/ajanlar/mihsap',
          },
          dedupeKey: `mihsap-result:${job.id}`,
          dedupeWindowMin: 60,
        });
      } catch (e) {
        this.logger.warn(`MIHSAP_RESULT notif failed: ${(e as Error).message}`);
      }
    }

    if (errorMsg) {
      throw new BadRequestException(errorMsg);
    }

    return { jobId: job.id, total, fetched, errorMsg };
  }""",
        ),
    ])

# === system-health.service.ts (SYSTEM) ===
patch("apps/api/src/system-health/system-health.service.ts",
    "SYSTEM: CRITICAL health check'lere bildirim",
    [
        (
            "import { Injectable, Logger } from '@nestjs/common';\nimport { Cron, CronExpression } from '@nestjs/schedule';\nimport { PrismaService } from '../prisma/prisma.service';",
            "import { Injectable, Logger, Optional } from '@nestjs/common';\nimport { Cron, CronExpression } from '@nestjs/schedule';\nimport { PrismaService } from '../prisma/prisma.service';\nimport { NotificationsService } from '../notifications/notifications.service';\nimport { NOTIFICATION_TYPES } from '../notifications/notification-types';",
        ),
        (
            "  constructor(private readonly prisma: PrismaService) {}",
            "  constructor(\n    private readonly prisma: PrismaService,\n    @Optional() private readonly notifications?: NotificationsService,\n  ) {}",
        ),
        (
            "    } else {\n      await (this.prisma as any).systemHealthCheck.create({\n        data: {\n          tenantId: args.tenantId || null,\n          type: args.type,\n          severity: args.severity,\n          status: args.status,\n          message: args.message,\n          detail: args.detail || null,\n          acilTavsiye: args.acilTavsiye || null,\n          resolved: false,\n        },\n      });\n    }\n  }\n\n  private async resolveCheck(type: string) {",
            """    } else {
      await (this.prisma as any).systemHealthCheck.create({
        data: {
          tenantId: args.tenantId || null,
          type: args.type,
          severity: args.severity,
          status: args.status,
          message: args.message,
          detail: args.detail || null,
          acilTavsiye: args.acilTavsiye || null,
          resolved: false,
        },
      });

      // === IN-APP BILDIRIM: SYSTEM (yeni CRITICAL) ===
      if (args.severity === 'CRITICAL' && this.notifications) {
        if (args.tenantId) {
          await this.notifications.createForTenant({
            tenantId: args.tenantId,
            type: NOTIFICATION_TYPES.SYSTEM,
            title: `Sistem uyarisi: ${args.type}`,
            body: `${args.message}${args.acilTavsiye ? `\\n\\nOneri: ${args.acilTavsiye}` : ''}`,
            metadata: { healthCheckType: args.type, status: args.status, detail: args.detail, link: '/panel/ayarlar' },
            dedupeKey: `sys-health:${args.type}`,
            dedupeWindowMin: 60 * 6,
          }).catch((e) => this.logger.warn(`SYSTEM notif failed: ${(e as Error).message}`));
        } else {
          const tenants = await (this.prisma as any).tenant.findMany({ select: { id: true } }).catch(() => []);
          for (const t of tenants) {
            await this.notifications.createForTenant({
              tenantId: t.id,
              type: NOTIFICATION_TYPES.SYSTEM,
              title: `Sistem uyarisi: ${args.type}`,
              body: `${args.message}${args.acilTavsiye ? `\\n\\nOneri: ${args.acilTavsiye}` : ''}`,
              metadata: { healthCheckType: args.type, status: args.status, link: '/panel/ayarlar' },
              dedupeKey: `sys-health:${args.type}`,
              dedupeWindowMin: 60 * 6,
            }).catch(() => null);
          }
        }
      }
    }
  }

  private async resolveCheck(type: string) {""",
        ),
    ])

# === moren-ofis/patrol.service.ts (AGENT) ===
patch("apps/api/src/moren-ofis/patrol.service.ts",
    "AGENT: manualPatrol sonrasi bildirim",
    [
        (
            "  async manualPatrol(tenantId: string) {\n    await this.lightPatrol(); // light cleanup\n    const analysis = await this.runDeepAnalysisForTenant(tenantId);\n    return analysis;\n  }",
            """  async manualPatrol(tenantId: string) {
    await this.lightPatrol(); // light cleanup
    const analysis = await this.runDeepAnalysisForTenant(tenantId);

    // === IN-APP BILDIRIM: AGENT ===
    try {
      const proposalCount = Array.isArray((analysis as any)?.proposals) ? (analysis as any).proposals.length : 0;
      const summary = String((analysis as any)?.summary || 'Tarama tamamlandi').slice(0, 400);
      await (this.prisma as any).notification.create({
        data: {
          tenantId,
          userId: null,
          title: `DENIZ tarama tamamlandi (${proposalCount} oneri)`,
          body: summary,
          type: 'AGENT',
          metadata: { agent: 'DENIZ', source: 'manual_patrol', proposalCount, link: '/panel/ajanlar' },
        },
      }).catch(() => {});
    } catch (e) {
      this.logger.warn(`AGENT notif failed: ${(e as Error).message}`);
    }

    return analysis;
  }""",
        ),
    ])

# === kdv-control.service.ts (KDV_RESULT) ===
patch("apps/api/src/kdv-control/kdv-control.service.ts",
    "KDV_RESULT: reconciliation sonucu bildirimi",
    [
        (
            "import { computeCostUsd, logAiUsage } from '../common/ai-usage-logger';\nimport { randomUUID } from 'crypto';",
            "import { computeCostUsd, logAiUsage } from '../common/ai-usage-logger';\nimport { NotificationsService } from '../notifications/notifications.service';\nimport { NOTIFICATION_TYPES } from '../notifications/notification-types';\nimport { randomUUID } from 'crypto';",
        ),
        (
            "    private agentEvents: AgentEventsService,\n    @Optional() private readonly automationEventBus?: AutomationEventBus,\n  ) {}",
            "    private agentEvents: AgentEventsService,\n    private notifications: NotificationsService,\n    @Optional() private readonly automationEventBus?: AutomationEventBus,\n  ) {}",
        ),
        (
            "      if (issueCount > 0) {\n        await this.pushMorenAiAlert(tenantId, {",
            """      // === IN-APP BILDIRIM: KDV_RESULT ===
      try {
        const matchedCount = Number(result.matched || 0);
        const summary = issueCount === 0
          ? `Tum ${matchedCount} kayit sorunsuz eslesti.`
          : `${matchedCount} tam - ${reviewCount} inceleme - ${unmatchedCount} hatali.`;
        await this.notifications.createForTenant({
          tenantId,
          type: NOTIFICATION_TYPES.KDV_RESULT,
          title: `KDV kontrol: ${mukellefAdi || 'mukellef'} (${session.periodLabel})`,
          body: summary,
          metadata: {
            sessionId,
            taxpayerId: session.taxpayerId,
            taxpayerName: mukellefAdi,
            period: session.periodLabel,
            type: session.type,
            matched: matchedCount,
            partial: result.partial,
            needsReview: result.needsReview,
            unmatched: result.unmatched,
            link: `/panel/kdv-kontrol/${sessionId}`,
          },
          dedupeKey: `kdv-result:${sessionId}`,
          dedupeWindowMin: 30,
        });
      } catch (e) {
        this.logger.warn(`KDV_RESULT notif failed: ${(e as Error).message}`);
      }

      if (issueCount > 0) {
        await this.pushMorenAiAlert(tenantId, {""",
        ),
    ])

# === APPLY ===
def apply_all():
    summary = []
    for file_rel, desc, transforms in PATCHES:
        path = REPO / file_rel
        if not path.exists():
            summary.append((file_rel, 'MISSING', desc))
            continue
        content = path.read_text(encoding='utf-8')
        original_len = len(content)
        applied = 0
        skipped = 0
        for find, replace in transforms:
            if find in content:
                content = content.replace(find, replace, 1)
                applied += 1
            elif replace.split('\n')[0].strip() in content:
                # marker text already in file -> idempotent skip
                skipped += 1
            else:
                summary.append((file_rel, f'TRANSFORM NOT FOUND: {find[:60]!r}', desc))
                break
        else:
            if applied > 0:
                path.write_text(content, encoding='utf-8')
                summary.append((file_rel, f'APPLIED ({applied} edits, +{len(content)-original_len} chars)', desc))
            elif skipped > 0:
                summary.append((file_rel, f'ALREADY APPLIED (skipped {skipped})', desc))
            else:
                summary.append((file_rel, 'NO-OP', desc))

    print()
    print('=' * 80)
    print('PATCH SUMMARY')
    print('=' * 80)
    ok = 0; warn = 0; err = 0
    for file_rel, status, desc in summary:
        if 'APPLIED' in status or 'ALREADY' in status:
            print(f'[OK]    {file_rel}')
            print(f'        {status} - {desc}')
            ok += 1
        elif 'NOT FOUND' in status or 'MISSING' in status:
            print(f'[ERROR] {file_rel}')
            print(f'        {status}')
            err += 1
        else:
            print(f'[WARN]  {file_rel}: {status}')
            warn += 1
    print()
    print(f'Total: OK={ok}, WARN={warn}, ERROR={err}')
    if err > 0:
        sys.exit(1)

if __name__ == '__main__':
    apply_all()
