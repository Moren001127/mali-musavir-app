import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { encrypt, tryDecrypt } from '../common/crypto';
import { BeyanKayitlariService } from '../beyan-kayitlari/beyan-kayitlari.service';

export const PORTAL_PROVIDERS = ['GIB_EBEYANNAME', 'GIB_IVD', 'SGK_EBILDIRGE'] as const;
export type PortalProvider = (typeof PORTAL_PROVIDERS)[number];

export const PORTAL_JOB_TYPES = [
  'EBEYANNAME_DAILY_DOWNLOAD',
  'E_TEBLIGAT_CHECK',
  'SGK_HIZMET_LISTESI',
  'SGK_TAHAKKUK',
  'SGK_ISE_GIRIS_CIKIS',
  'SGK_ISGOREMEZLIK',
] as const;
export type PortalJobType = (typeof PORTAL_JOB_TYPES)[number];

const SGK_JOB_TYPES: PortalJobType[] = [
  'SGK_HIZMET_LISTESI',
  'SGK_TAHAKKUK',
  'SGK_ISE_GIRIS_CIKIS',
  'SGK_ISGOREMEZLIK',
];

const JOB_META: Record<PortalJobType, { provider: PortalProvider; ownerType: 'TENANT' | 'TAXPAYER'; label: string }> = {
  EBEYANNAME_DAILY_DOWNLOAD: {
    provider: 'GIB_EBEYANNAME',
    ownerType: 'TENANT',
    label: 'e-Beyanname onceki gun indirme',
  },
  E_TEBLIGAT_CHECK: {
    provider: 'GIB_IVD',
    ownerType: 'TAXPAYER',
    label: 'GIB e-Tebligat kontrol',
  },
  SGK_HIZMET_LISTESI: {
    provider: 'SGK_EBILDIRGE',
    ownerType: 'TAXPAYER',
    label: 'SGK hizmet listesi',
  },
  SGK_TAHAKKUK: {
    provider: 'SGK_EBILDIRGE',
    ownerType: 'TAXPAYER',
    label: 'SGK tahakkuk',
  },
  SGK_ISE_GIRIS_CIKIS: {
    provider: 'SGK_EBILDIRGE',
    ownerType: 'TAXPAYER',
    label: 'Ise giris / isten cikis bildirgeleri',
  },
  SGK_ISGOREMEZLIK: {
    provider: 'SGK_EBILDIRGE',
    ownerType: 'TAXPAYER',
    label: 'Isgoremezlik raporu sorgu',
  },
};

type ManualRunInput = {
  scope?: 'all' | 'beyanname' | 'tebligat' | 'sgk';
  jobTypes?: string[];
  taxpayerIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  donem?: string;
  force?: boolean;
};

type AgentDeclarationInput = {
  taxpayerId: string;
  beyanTipi: string;
  donem: string;
  status?: string | null;
  beyanTarihi?: string | null;
  tahakkukTutari?: number | null;
  odemeTutari?: number | null;
  onayNo?: string | null;
  beyannameBase64?: string | null;
  tahakkukBase64?: string | null;
  xmlBase64?: string | null;
  beyannameFileName?: string | null;
  tahakkukFileName?: string | null;
  raw?: any;
};

type AgentDocumentInput = {
  taxpayerId?: string | null;
  belgeTuru: string;
  title: string;
  referenceNo?: string | null;
  period?: string | null;
  issuedAt?: string | null;
  receivedAt?: string | null;
  mimeType?: string | null;
  originalName?: string | null;
  base64?: string | null;
  raw?: any;
};

function isPortalProvider(v: string): v is PortalProvider {
  return (PORTAL_PROVIDERS as readonly string[]).includes(v);
}

function isPortalJobType(v: string): v is PortalJobType {
  return (PORTAL_JOB_TYPES as readonly string[]).includes(v);
}

function adFormat(tp: any): string {
  if (!tp) return '';
  return tp.companyName || [tp.firstName, tp.lastName].filter(Boolean).join(' ') || tp.taxNumber || '';
}

function parseDateOrNull(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeAgentDeclarationStatus(input: AgentDeclarationInput): 'onaylandi' | 'beklemede' | 'hatali' {
  const rawStatus = [
    input.status,
    input.raw?.status,
    input.raw?.durum,
    input.raw?.phase,
    input.raw?.state,
  ].filter(Boolean).join(' ').toLowerCase();

  if (/onay\s*bek|beklemede|pending|approval|awaiting/.test(rawStatus)) return 'beklemede';
  if (/hata|hatali|failed|fail|error/.test(rawStatus)) return 'hatali';
  return 'onaylandi';
}

function agentDeclarationStatusNote(input: AgentDeclarationInput, status: 'beklemede' | 'hatali') {
  const prefix = status === 'beklemede'
    ? 'GIB agent onay bekliyor'
    : 'GIB agent hata';
  const raw = input.raw ? JSON.stringify({ source: 'portal-automation', raw: input.raw }) : '';
  return raw ? `${prefix} | ${raw}`.slice(0, 1000) : prefix;
}

function parseIstanbulDateBoundary(value: string | undefined, boundary: 'start' | 'end'): Date | null {
  if (!value) return null;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return new Date(`${text}T${boundary === 'start' ? '00:00:00.000' : '23:59:59.999'}+03:00`);
  }
  return parseDateOrNull(text);
}

function cleanBase64(input?: string | null): string | null {
  if (!input) return null;
  return input.replace(/^data:[^;]+;base64,/, '').trim();
}

function startOfIstanbulDay(d: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00+03:00`);
}

function previousIstanbulDayRange(now = new Date()) {
  const todayStart = startOfIstanbulDay(now);
  const end = new Date(todayStart.getTime() - 1);
  const start = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  return { start, end };
}

@Injectable()
export class PortalAutomationService {
  private readonly logger = new Logger(PortalAutomationService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private beyanKayitlari: BeyanKayitlariService,
  ) {}

  @Cron('0 15 2 * * *', { timeZone: 'Europe/Istanbul' })
  async nightlyTick() {
    try {
      const tenants = await (this.prisma as any).tenant.findMany({ select: { id: true, name: true } });
      for (const tenant of tenants) {
        const res = await this.createNightlyJobsForTenant(tenant.id);
        if (res.created.length || res.skipped.length) {
          this.logger.log(`[PortalNightly] ${tenant.name || tenant.id}: created=${res.created.length}, skipped=${res.skipped.length}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`[PortalNightly] hata: ${err?.message || err}`);
    }
  }

  async summary(tenantId: string) {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const { start, end } = previousIstanbulDayRange(now);

    const [
      credentialRows,
      activeJobs,
      failed24h,
      done24h,
      docs7d,
      tebligat7d,
      latestJobs,
      latestDocuments,
    ] = await Promise.all([
      (this.prisma as any).portalCredential.findMany({
        where: { tenantId },
        include: { taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true } } },
      }),
      (this.prisma as any).portalAutomationJob.count({ where: { tenantId, status: { in: ['pending', 'running'] } } }),
      (this.prisma as any).portalAutomationJob.count({ where: { tenantId, status: 'failed', createdAt: { gte: dayAgo } } }),
      (this.prisma as any).portalAutomationJob.count({ where: { tenantId, status: 'done', createdAt: { gte: dayAgo } } }),
      (this.prisma as any).portalDocument.count({ where: { tenantId, createdAt: { gte: sevenDaysAgo } } }),
      (this.prisma as any).portalDocument.count({ where: { tenantId, belgeTuru: 'E_TEBLIGAT', createdAt: { gte: sevenDaysAgo } } }),
      this.listJobs(tenantId, { limit: 8 }),
      this.listDocuments(tenantId, { limit: 8 }),
    ]);

    const credentials = this.summarizeCredentials(credentialRows);
    return {
      nightly: {
        active: true,
        time: '02:15',
        timezone: 'Europe/Istanbul',
        declarationRange: { start, end },
      },
      runner: {
        enabled: this.runnerEnabled(),
        includeNightly: this.runnerIncludeNightly(),
        deviceId: process.env.PORTAL_AUTOMATION_RAILWAY_DEVICE_ID || 'railway-portal-runner',
        jobTypes: this.runnerJobTypes(),
      },
      stats: { activeJobs, failed24h, done24h, docs7d, tebligat7d },
      credentials,
      latestJobs,
      latestDocuments,
      jobTypes: PORTAL_JOB_TYPES.map((type) => ({ type, ...JOB_META[type] })),
    };
  }

  async credentialStatus(tenantId: string) {
    const rows = await (this.prisma as any).portalCredential.findMany({
      where: { tenantId },
      include: { taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true } } },
      orderBy: [{ provider: 'asc' }, { updatedAt: 'desc' }],
    });
    return {
      summary: this.summarizeCredentials(rows),
      rows: rows.map((c: any) => this.publicCredential(c)),
    };
  }

  async saveCredential(tenantId: string, userId: string | null, input: any) {
    const provider = String(input?.provider || '').trim().toUpperCase();
    if (!isPortalProvider(provider)) throw new BadRequestException('Gecersiz provider');

    const ownerType = provider === 'GIB_EBEYANNAME' ? 'TENANT' : 'TAXPAYER';
    const taxpayerId = ownerType === 'TAXPAYER' ? String(input?.taxpayerId || '').trim() : null;
    if (ownerType === 'TAXPAYER' && !taxpayerId) throw new BadRequestException('Mukellef secimi gerekli');

    if (taxpayerId) {
      const tp = await (this.prisma as any).taxpayer.findFirst({ where: { id: taxpayerId, tenantId }, select: { id: true } });
      if (!tp) throw new NotFoundException('Mukellef bulunamadi');
    }

    const ownerId = ownerType === 'TENANT' ? tenantId : taxpayerId!;
    const existing = await (this.prisma as any).portalCredential.findUnique({
      where: { tenantId_provider_ownerType_ownerId: { tenantId, provider, ownerType, ownerId } },
    });

    if (!existing && !input?.password) {
      throw new BadRequestException('Yeni sifre kaydi icin sifre zorunlu');
    }

    const data: any = {
      username: input?.username ? String(input.username).trim() : null,
      userCode: input?.userCode ? String(input.userCode).trim() : null,
      officeCode: input?.officeCode ? String(input.officeCode).trim() : null,
      workplaceCode: input?.workplaceCode ? String(input.workplaceCode).trim() : null,
      isActive: input?.isActive !== false,
      notes: input?.notes ? String(input.notes).slice(0, 1000) : null,
      updatedBy: userId,
      lastError: input?.password ? null : existing?.lastError || null,
    };
    if (input?.password) data.encryptedPassword = encrypt(String(input.password));
    if (input?.secondaryPassword) data.encryptedSecondaryPassword = encrypt(String(input.secondaryPassword));

    const row = await (this.prisma as any).portalCredential.upsert({
      where: { tenantId_provider_ownerType_ownerId: { tenantId, provider, ownerType, ownerId } },
      create: {
        tenantId,
        provider,
        ownerType,
        ownerId,
        taxpayerId,
        ...data,
      },
      update: data,
      include: { taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true } } },
    });
    return this.publicCredential(row);
  }

  async listJobs(tenantId: string, opts: { limit?: number; status?: string; jobType?: string } = {}) {
    const limit = Math.min(Math.max(Number(opts.limit || 30), 1), 200);
    const where: any = { tenantId };
    if (opts.status) where.status = { in: String(opts.status).split(',').map((s) => s.trim()).filter(Boolean) };
    if (opts.jobType) where.jobType = { in: String(opts.jobType).split(',').map((s) => s.trim()).filter(Boolean) };
    return (this.prisma as any).portalAutomationJob.findMany({
      where,
      include: { taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true } } },
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
    });
  }

  async listDocuments(tenantId: string, opts: { limit?: number; taxpayerId?: string; belgeTuru?: string } = {}) {
    const limit = Math.min(Math.max(Number(opts.limit || 50), 1), 200);
    const where: any = { tenantId };
    if (opts.taxpayerId) where.taxpayerId = opts.taxpayerId;
    if (opts.belgeTuru) where.belgeTuru = opts.belgeTuru;
    return (this.prisma as any).portalDocument.findMany({
      where,
      include: { taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true } } },
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
    });
  }

  async manualRun(tenantId: string, userId: string | null, input: ManualRunInput) {
    const jobTypes = this.resolveRequestedJobTypes(input);
    const period = this.resolvePeriod(input);
    const res = await this.createJobs(tenantId, {
      jobTypes,
      source: 'manual',
      userId,
      taxpayerIds: input.taxpayerIds || [],
      period,
      donem: input.donem,
      force: input.force === true,
    });
    return {
      ...res,
      message: `${res.created.length} is kuyruga alindi, ${res.skipped.length} atlandi`,
    };
  }

  async createNightlyJobsForTenant(tenantId: string) {
    const { start, end } = previousIstanbulDayRange();
    const todayStart = startOfIstanbulDay(new Date());
    return this.createJobs(tenantId, {
      jobTypes: ['EBEYANNAME_DAILY_DOWNLOAD', 'E_TEBLIGAT_CHECK', ...SGK_JOB_TYPES],
      source: 'nightly',
      userId: 'scheduler',
      taxpayerIds: [],
      period: { start, end },
      force: false,
      dedupeAfter: todayStart,
    });
  }

  async pendingJobsForAgent(tenantId: string, opts: { deviceId?: string; limit?: number } = {}) {
    const limit = Math.min(Math.max(Number(opts.limit || 10), 1), 50);
    const where: any = { tenantId, status: 'pending' };
    if (opts.deviceId) {
      where.OR = [{ targetDeviceId: null }, { targetDeviceId: opts.deviceId }];
    }
    const jobs = await (this.prisma as any).portalAutomationJob.findMany({
      where,
      include: { taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true, taxOffice: true } } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: limit,
    });
    return jobs.map((job: any) => ({
      ...job,
      jobLabel: JOB_META[job.jobType as PortalJobType]?.label || job.jobType,
      provider: JOB_META[job.jobType as PortalJobType]?.provider || null,
    }));
  }

  async getCredentialForJob(tenantId: string, jobId: string) {
    const job = await (this.prisma as any).portalAutomationJob.findFirst({
      where: { id: jobId, tenantId },
      include: { taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true, taxOffice: true } } },
    });
    if (!job) throw new NotFoundException('Job bulunamadi');
    const meta = JOB_META[job.jobType as PortalJobType];
    if (!meta) throw new BadRequestException('Job tipi bilinmiyor');
    const ownerId = meta.ownerType === 'TENANT' ? tenantId : job.taxpayerId;
    if (!ownerId) throw new BadRequestException('Job icin mukellef gerekli');

    const credential = await (this.prisma as any).portalCredential.findUnique({
      where: {
        tenantId_provider_ownerType_ownerId: {
          tenantId,
          provider: meta.provider,
          ownerType: meta.ownerType,
          ownerId,
        },
      },
    });
    if (!credential || credential.isActive === false) throw new NotFoundException('Aktif portal sifresi bulunamadi');
    await (this.prisma as any).portalCredential.update({
      where: { id: credential.id },
      data: { lastCheckedAt: new Date() },
    }).catch(() => {});

    return {
      job: {
        id: job.id,
        jobType: job.jobType,
        periodStart: job.periodStart,
        periodEnd: job.periodEnd,
        donem: job.donem,
        payload: job.payload,
      },
      taxpayer: job.taxpayer,
      credential: {
        provider: credential.provider,
        username: credential.username,
        userCode: credential.userCode,
        officeCode: credential.officeCode,
        workplaceCode: credential.workplaceCode,
        password: tryDecrypt(credential.encryptedPassword),
        secondaryPassword: tryDecrypt(credential.encryptedSecondaryPassword),
      },
    };
  }

  async markRunning(tenantId: string, jobId: string, deviceId?: string) {
    const updated = await (this.prisma as any).portalAutomationJob.updateMany({
      where: { id: jobId, tenantId, status: 'pending' },
      data: {
        status: 'running',
        startedAt: new Date(),
        attempts: { increment: 1 },
        ...(deviceId ? { targetDeviceId: deviceId } : {}),
      },
    });
    if (!updated.count) throw new NotFoundException('Baslatilacak job bulunamadi');
    return (this.prisma as any).portalAutomationJob.findUnique({ where: { id: jobId } });
  }

  async markFailed(tenantId: string, jobId: string, errorMessage: string) {
    const job = await (this.prisma as any).portalAutomationJob.findFirst({ where: { id: jobId, tenantId } });
    if (!job) throw new NotFoundException('Job bulunamadi');
    await this.markCredentialError(job, errorMessage).catch(() => {});
    return (this.prisma as any).portalAutomationJob.update({
      where: { id: jobId },
      data: { status: 'failed', errorMessage: errorMessage.slice(0, 2000), finishedAt: new Date() },
    });
  }

  async completeJob(
    tenantId: string,
    jobId: string,
    input: { declarations?: AgentDeclarationInput[]; documents?: AgentDocumentInput[]; result?: any; recordCount?: number },
  ) {
    const job = await (this.prisma as any).portalAutomationJob.findFirst({ where: { id: jobId, tenantId } });
    if (!job) throw new NotFoundException('Job bulunamadi');

    let recordCount = 0;
    const declarations = Array.isArray(input?.declarations) ? input.declarations : [];
    const documents = Array.isArray(input?.documents) ? input.documents : [];

    for (const decl of declarations) {
      await this.storeDeclarationFromAgent(tenantId, jobId, decl);
      recordCount++;
    }
    for (const doc of documents) {
      await this.storePortalDocumentFromAgent(tenantId, jobId, doc, job.jobType);
      recordCount++;
    }

    const finalCount = Number.isFinite(Number(input?.recordCount)) ? Number(input.recordCount) : recordCount;
    await this.markCredentialSuccess(job).catch(() => {});
    const updated = await (this.prisma as any).portalAutomationJob.update({
      where: { id: jobId },
      data: {
        status: 'done',
        result: input?.result || { declarations: declarations.length, documents: documents.length },
        recordCount: finalCount,
        finishedAt: new Date(),
      },
    });

    if (documents.some((d) => d.belgeTuru === 'E_TEBLIGAT')) {
      await (this.prisma as any).notification.create({
        data: {
          tenantId,
          title: 'Yeni e-Tebligat indirildi',
          body: `${documents.filter((d) => d.belgeTuru === 'E_TEBLIGAT').length} yeni e-Tebligat portala kaydedildi.`,
          type: 'E_TEBLIGAT',
          metadata: { jobId },
        },
      }).catch(() => {});
    }

    return updated;
  }

  resolveTenantFromAgentToken(token?: string): Promise<string> {
    return this.resolveTenantFromToken(token);
  }

  private async createJobs(
    tenantId: string,
    opts: {
      jobTypes: PortalJobType[];
      source: 'manual' | 'nightly';
      userId: string | null;
      taxpayerIds: string[];
      period: { start: Date; end: Date };
      donem?: string;
      force?: boolean;
      dedupeAfter?: Date;
    },
  ) {
    const created: any[] = [];
    const skipped: Array<{ jobType: string; taxpayerId?: string | null; reason: string }> = [];

    for (const jobType of opts.jobTypes) {
      const meta = JOB_META[jobType];
      if (meta.ownerType === 'TENANT') {
        const credential = await this.findCredential(tenantId, meta.provider, 'TENANT', tenantId);
        if (!credential) {
          skipped.push({ jobType, taxpayerId: null, reason: 'Mali musavir e-Beyanname sifresi kayitli degil' });
          continue;
        }
        const duplicate = opts.force ? null : await this.findDuplicateJob(tenantId, jobType, null, opts.source, opts.dedupeAfter);
        if (duplicate) {
          skipped.push({ jobType, taxpayerId: null, reason: 'Bu gece icin zaten kuyrukta' });
          continue;
        }
        created.push(await this.createJobRow(tenantId, null, jobType, opts));
        continue;
      }

      const taxpayerIds = await this.resolveTaxpayerTargets(tenantId, meta.provider, opts.taxpayerIds);
      if (!taxpayerIds.length) {
        skipped.push({ jobType, reason: `${meta.provider} sifresi olan aktif mukellef bulunamadi` });
        continue;
      }

      for (const taxpayerId of taxpayerIds) {
        const credential = await this.findCredential(tenantId, meta.provider, 'TAXPAYER', taxpayerId);
        if (!credential) {
          skipped.push({ jobType, taxpayerId, reason: 'Mukellef portal sifresi yok' });
          continue;
        }
        const duplicate = opts.force ? null : await this.findDuplicateJob(tenantId, jobType, taxpayerId, opts.source, opts.dedupeAfter);
        if (duplicate) {
          skipped.push({ jobType, taxpayerId, reason: 'Bu gece icin zaten kuyrukta' });
          continue;
        }
        created.push(await this.createJobRow(tenantId, taxpayerId, jobType, opts));
      }
    }

    return { created, skipped };
  }

  private async createJobRow(
    tenantId: string,
    taxpayerId: string | null,
    jobType: PortalJobType,
    opts: {
      source: 'manual' | 'nightly';
      userId: string | null;
      period: { start: Date; end: Date };
      donem?: string;
    },
  ) {
    const meta = JOB_META[jobType];
    return (this.prisma as any).portalAutomationJob.create({
      data: {
        tenantId,
        taxpayerId,
        jobType,
        source: opts.source,
        status: 'pending',
        periodStart: opts.period.start,
        periodEnd: opts.period.end,
        donem: opts.donem || this.inferDonem(opts.period.end),
        scheduledAt: new Date(),
        createdBy: opts.userId,
        priority: opts.source === 'manual' ? 50 : 0,
        payload: {
          label: meta.label,
          provider: meta.provider,
          ownerType: meta.ownerType,
          dateFrom: opts.period.start.toISOString(),
          dateTo: opts.period.end.toISOString(),
          instruction: this.instructionForJob(jobType),
        },
      },
      include: { taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true } } },
    });
  }

  private async findDuplicateJob(
    tenantId: string,
    jobType: PortalJobType,
    taxpayerId: string | null,
    source: string,
    dedupeAfter?: Date,
  ) {
    if (!dedupeAfter) return null;
    return (this.prisma as any).portalAutomationJob.findFirst({
      where: {
        tenantId,
        jobType,
        taxpayerId,
        source,
        createdAt: { gte: dedupeAfter },
        status: { in: ['pending', 'running', 'done'] },
      },
      select: { id: true },
    });
  }

  private async resolveTaxpayerTargets(tenantId: string, provider: PortalProvider, selectedIds: string[]) {
    if (selectedIds?.length) {
      const rows = await (this.prisma as any).taxpayer.findMany({
        where: { tenantId, id: { in: selectedIds }, isActive: true },
        select: { id: true },
      });
      return rows.map((r: any) => r.id);
    }
    const credentials = await (this.prisma as any).portalCredential.findMany({
      where: {
        tenantId,
        provider,
        ownerType: 'TAXPAYER',
        isActive: true,
        taxpayer: { isActive: true },
      },
      select: { ownerId: true },
      take: 2000,
    });
    return credentials.map((c: any) => c.ownerId);
  }

  private async findCredential(tenantId: string, provider: PortalProvider, ownerType: 'TENANT' | 'TAXPAYER', ownerId: string) {
    return (this.prisma as any).portalCredential.findUnique({
      where: { tenantId_provider_ownerType_ownerId: { tenantId, provider, ownerType, ownerId } },
    });
  }

  private resolveRequestedJobTypes(input: ManualRunInput): PortalJobType[] {
    if (Array.isArray(input.jobTypes) && input.jobTypes.length) {
      return Array.from(new Set(input.jobTypes.map((j) => String(j).trim().toUpperCase()).filter(isPortalJobType)));
    }
    switch (input.scope) {
      case 'beyanname': return ['EBEYANNAME_DAILY_DOWNLOAD'];
      case 'tebligat': return ['E_TEBLIGAT_CHECK'];
      case 'sgk': return SGK_JOB_TYPES;
      default: return ['EBEYANNAME_DAILY_DOWNLOAD', 'E_TEBLIGAT_CHECK', ...SGK_JOB_TYPES];
    }
  }

  private resolvePeriod(input: ManualRunInput) {
    const from = parseIstanbulDateBoundary(input.dateFrom, 'start');
    const to = parseIstanbulDateBoundary(input.dateTo, 'end');
    if (from && to) return { start: from, end: to };
    return previousIstanbulDayRange();
  }

  private inferDonem(date: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(date);
    const year = parts.find((p) => p.type === 'year')?.value || String(date.getFullYear());
    const month = parts.find((p) => p.type === 'month')?.value || String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  private summarizeCredentials(rows: any[]) {
    const byProvider = {
      GIB_EBEYANNAME: { total: 0, active: 0 },
      GIB_IVD: { total: 0, active: 0 },
      SGK_EBILDIRGE: { total: 0, active: 0 },
    } as Record<PortalProvider, { total: number; active: number }>;
    for (const row of rows) {
      const provider = String(row.provider);
      if (!isPortalProvider(provider)) continue;
      byProvider[provider].total++;
      if (row.isActive !== false) byProvider[provider].active++;
    }
    return {
      eBeyannameReady: byProvider.GIB_EBEYANNAME.active > 0,
      eTebligatTaxpayerCount: byProvider.GIB_IVD.active,
      sgkTaxpayerCount: byProvider.SGK_EBILDIRGE.active,
      byProvider,
    };
  }

  private publicCredential(c: any) {
    return {
      id: c.id,
      provider: c.provider,
      ownerType: c.ownerType,
      ownerId: c.ownerId,
      taxpayerId: c.taxpayerId,
      taxpayer: c.taxpayer
        ? { ...c.taxpayer, name: adFormat(c.taxpayer) }
        : null,
      username: c.username,
      userCode: c.userCode,
      officeCode: c.officeCode,
      workplaceCode: c.workplaceCode,
      hasPassword: !!c.encryptedPassword,
      hasSecondaryPassword: !!c.encryptedSecondaryPassword,
      isActive: c.isActive,
      lastCheckedAt: c.lastCheckedAt,
      lastSuccessAt: c.lastSuccessAt,
      lastError: c.lastError,
      updatedAt: c.updatedAt,
      notes: c.notes,
    };
  }

  private async storeDeclarationFromAgent(tenantId: string, jobId: string, input: AgentDeclarationInput) {
    if (!input?.taxpayerId || !input?.beyanTipi || !input?.donem) {
      throw new BadRequestException('Beyanname icin taxpayerId, beyanTipi ve donem zorunlu');
    }
    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: input.taxpayerId, tenantId },
      select: { id: true, taxNumber: true },
    });
    if (!taxpayer) throw new NotFoundException('Beyanname mukellefi bulunamadi');

    const declarationStatus = normalizeAgentDeclarationStatus(input);
    if (declarationStatus !== 'onaylandi') {
      return (this.prisma as any).beyanDurumu.upsert({
        where: {
          tenantId_taxpayerId_beyanTipi_donem: {
            tenantId,
            taxpayerId: taxpayer.id,
            beyanTipi: input.beyanTipi,
            donem: input.donem,
          },
        },
        create: {
          tenantId,
          taxpayerId: taxpayer.id,
          beyanTipi: input.beyanTipi,
          donem: input.donem,
          durum: declarationStatus,
          onayTarihi: null,
          tahakkukTutari: input.tahakkukTutari ?? null,
          notlar: agentDeclarationStatusNote(input, declarationStatus),
        },
        update: {
          durum: declarationStatus,
          onayTarihi: null,
          tahakkukTutari: input.tahakkukTutari ?? null,
          notlar: agentDeclarationStatusNote(input, declarationStatus),
        },
      });
    }

    const base = `${tenantId}/${taxpayer.id}/gib-beyan/${input.beyanTipi}_${input.donem}`;
    const beyannameUrl = await this.storeBase64IfPresent(
      `${base}_Beyanname_${randomUUID()}.pdf`,
      input.beyannameBase64,
      'application/pdf',
      input.beyannameFileName || 'beyanname.pdf',
    );
    const pdfUrl = await this.storeBase64IfPresent(
      `${base}_Tahakkuk_${randomUUID()}.pdf`,
      input.tahakkukBase64,
      'application/pdf',
      input.tahakkukFileName || 'tahakkuk.pdf',
    );
    const xmlUrl = await this.storeBase64IfPresent(
      `${base}_${randomUUID()}.xml`,
      input.xmlBase64,
      'application/xml',
      'beyanname.xml',
    );

    const data: any = {
      beyanTarihi: parseDateOrNull(input.beyanTarihi),
      tahakkukTutari: input.tahakkukTutari ?? null,
      odemeTutari: input.odemeTutari ?? null,
      onayNo: input.onayNo || null,
      kaynak: 'gib_agent',
      importBatchId: jobId,
      notlar: input.raw ? JSON.stringify({ source: 'portal-automation', raw: input.raw }).slice(0, 1000) : null,
    };
    if (beyannameUrl) data.beyannameUrl = beyannameUrl;
    if (pdfUrl) data.pdfUrl = pdfUrl;
    if (xmlUrl) data.xmlUrl = xmlUrl;

    const kayit = await (this.prisma as any).beyanKaydi.upsert({
      where: {
        tenantId_taxpayerId_beyanTipi_donem: {
          tenantId,
          taxpayerId: taxpayer.id,
          beyanTipi: input.beyanTipi,
          donem: input.donem,
        },
      },
      create: {
        tenantId,
        taxpayerId: taxpayer.id,
        beyanTipi: input.beyanTipi,
        donem: input.donem,
        ...data,
      },
      update: data,
    });

    await (this.prisma as any).beyanDurumu.upsert({
      where: {
        tenantId_taxpayerId_beyanTipi_donem: {
          tenantId,
          taxpayerId: taxpayer.id,
          beyanTipi: input.beyanTipi,
          donem: input.donem,
        },
      },
      create: {
        tenantId,
        taxpayerId: taxpayer.id,
        beyanTipi: input.beyanTipi,
        donem: input.donem,
        durum: 'onaylandi',
        onayTarihi: parseDateOrNull(input.beyanTarihi) || new Date(),
        tahakkukTutari: input.tahakkukTutari ?? null,
        notlar: 'GIB agent tarafindan indirildi',
      },
      update: {
        durum: 'onaylandi',
        onayTarihi: parseDateOrNull(input.beyanTarihi) || new Date(),
        tahakkukTutari: input.tahakkukTutari ?? null,
      },
    }).catch(() => {});

    return kayit;
  }

  private async storePortalDocumentFromAgent(
    tenantId: string,
    jobId: string,
    input: AgentDocumentInput,
    jobType: string,
  ) {
    let taxpayerId = input.taxpayerId || null;
    if (taxpayerId) {
      const tp = await (this.prisma as any).taxpayer.findFirst({ where: { id: taxpayerId, tenantId }, select: { id: true } });
      if (!tp) throw new NotFoundException('Belge mukellefi bulunamadi');
    }
    const mimeType = input.mimeType || 'application/pdf';
    const sourceProvider = JOB_META[jobType as PortalJobType]?.provider || 'GIB_IVD';
    let storageKey: string | null = null;
    let sizeBytes: number | null = null;
    const base64 = cleanBase64(input.base64);
    if (base64) {
      const buffer = Buffer.from(base64, 'base64');
      sizeBytes = buffer.length;
      const ext = this.extensionFromMime(mimeType, input.originalName);
      storageKey = `${tenantId}/${taxpayerId || 'tenant'}/portal-documents/${input.belgeTuru}_${randomUUID()}.${ext}`;
      await this.storage.putBuffer(storageKey, buffer, mimeType, {
        source: 'portal-automation',
        belgeTuru: input.belgeTuru,
      });
    }

    const linkedBeyan = await this.linkEBeyannameDocumentToBeyanKaydi(tenantId, jobId, input, jobType, storageKey).catch((err) => {
      this.logger.warn(`e-Beyanname PDF kayda baglanamadi: ${err?.message || err}`);
      return null;
    });
    if (!taxpayerId && linkedBeyan?.taxpayerId) taxpayerId = linkedBeyan.taxpayerId;

    let documentId: string | null = null;
    if (taxpayerId && storageKey && sizeBytes != null) {
      const doc = await (this.prisma as any).document.create({
        data: {
          taxpayerId,
          title: input.title,
          category: 'EVRAK',
          mimeType,
          sizeBytes,
          s3Key: storageKey,
          notes: `${input.belgeTuru} portaldan otomatik indirildi.`,
          tags: { create: [{ tag: input.belgeTuru }, { tag: sourceProvider }, { tag: 'otomatik' }] },
        },
      });
      const version = await (this.prisma as any).documentVersion.create({
        data: {
          documentId: doc.id,
          versionNo: 1,
          s3Key: storageKey,
          sizeBytes,
          uploadedBy: 'portal-automation',
          notes: 'Portal otomasyonu ilk indirme',
        },
      });
      await (this.prisma as any).document.update({
        where: { id: doc.id },
        data: { currentVersionId: version.id },
      });
      documentId = doc.id;
    }

    return (this.prisma as any).portalDocument.create({
      data: {
        tenantId,
        taxpayerId,
        jobId,
        belgeTuru: input.belgeTuru || 'DIGER',
        sourceProvider,
        title: input.title || input.originalName || 'Portal belgesi',
        referenceNo: input.referenceNo || null,
        period: input.period || null,
        issuedAt: parseDateOrNull(input.issuedAt),
        receivedAt: parseDateOrNull(input.receivedAt) || new Date(),
        mimeType,
        sizeBytes,
        storageKey,
        documentId,
        raw: input.raw || null,
      },
    });
  }

  private async linkEBeyannameDocumentToBeyanKaydi(
    tenantId: string,
    jobId: string,
    input: AgentDocumentInput,
    jobType: string,
    storageKey: string | null,
  ): Promise<{ taxpayerId: string; beyanKaydiId: string } | null> {
    if (jobType !== 'EBEYANNAME_DAILY_DOWNLOAD') return null;
    if (!storageKey) return null;
    if (input.belgeTuru === 'GIB_XML') return null;

    const name = input.originalName || input.title || '';
    const mimeType = input.mimeType || '';
    if (!/pdf/i.test(mimeType) && !/\.pdf$/i.test(name)) return null;

    const base64 = cleanBase64(input.base64);
    if (!base64) return null;

    const parsed = await this.beyanKayitlari.parseBeyannamePdf(base64);
    const taxpayer = parsed.vkn
      ? await (this.prisma as any).taxpayer.findFirst({
          where: { tenantId, taxNumber: parsed.vkn },
          select: { id: true },
        })
      : null;

    if (!taxpayer?.id || !parsed.beyanTipi || !parsed.donem) return null;

    const isTahakkuk = input.belgeTuru === 'GIB_TAHAKKUK' || /tahakkuk|fis|fiş/i.test(name);
    const parsedDate = parsed.beyanTarihi ? parseDateOrNull(parsed.beyanTarihi) : null;
    const rawNote = JSON.stringify({
      source: 'portal-automation-pdf-parse',
      fileName: name,
      parsed,
      raw: input.raw || null,
    }).slice(0, 1000);

    const data: any = {
      kaynak: 'gib_agent',
      importBatchId: jobId,
      notlar: rawNote,
    };
    if (parsedDate) data.beyanTarihi = parsedDate;
    if (parsed.tahakkukTutari != null) data.tahakkukTutari = parsed.tahakkukTutari;
    if (parsed.onayNo) data.onayNo = parsed.onayNo;
    if (isTahakkuk) data.pdfUrl = storageKey;
    else data.beyannameUrl = storageKey;

    const kayit = await (this.prisma as any).beyanKaydi.upsert({
      where: {
        tenantId_taxpayerId_beyanTipi_donem: {
          tenantId,
          taxpayerId: taxpayer.id,
          beyanTipi: parsed.beyanTipi,
          donem: parsed.donem,
        },
      },
      create: {
        tenantId,
        taxpayerId: taxpayer.id,
        beyanTipi: parsed.beyanTipi,
        donem: parsed.donem,
        beyanTarihi: parsedDate,
        tahakkukTutari: parsed.tahakkukTutari,
        onayNo: parsed.onayNo,
        kaynak: 'gib_agent',
        importBatchId: jobId,
        notlar: rawNote,
        ...(isTahakkuk ? { pdfUrl: storageKey } : { beyannameUrl: storageKey }),
      },
      update: data,
    });

    await (this.prisma as any).beyanDurumu.upsert({
      where: {
        tenantId_taxpayerId_beyanTipi_donem: {
          tenantId,
          taxpayerId: taxpayer.id,
          beyanTipi: parsed.beyanTipi,
          donem: parsed.donem,
        },
      },
      create: {
        tenantId,
        taxpayerId: taxpayer.id,
        beyanTipi: parsed.beyanTipi,
        donem: parsed.donem,
        durum: 'onaylandi',
        onayTarihi: parsedDate || new Date(),
        tahakkukTutari: parsed.tahakkukTutari,
        notlar: 'GIB agent PDF parse ile indirildi',
      },
      update: {
        durum: 'onaylandi',
        onayTarihi: parsedDate || new Date(),
        tahakkukTutari: parsed.tahakkukTutari,
      },
    }).catch(() => {});

    return { taxpayerId: taxpayer.id, beyanKaydiId: kayit.id };
  }

  private async storeBase64IfPresent(s3Key: string, base64Input: string | null | undefined, mimeType: string, originalName: string) {
    const base64 = cleanBase64(base64Input);
    if (!base64) return null;
    const buffer = Buffer.from(base64, 'base64');
    await this.storage.putBuffer(s3Key, buffer, mimeType, {
      originalName: encodeURIComponent(originalName),
      source: 'portal-automation',
    });
    return s3Key;
  }

  private extensionFromMime(mimeType: string, originalName?: string | null) {
    const byName = originalName?.split('.').pop();
    if (byName && byName.length <= 8) return byName.toLowerCase();
    if (mimeType.includes('pdf')) return 'pdf';
    if (mimeType.includes('xml')) return 'xml';
    if (mimeType.includes('zip')) return 'zip';
    if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return 'xlsx';
    return 'bin';
  }

  private instructionForJob(jobType: PortalJobType) {
    switch (jobType) {
      case 'EBEYANNAME_DAILY_DOWNLOAD':
        return 'Mali musavir e-Beyanname kullanici kodu, parola ve sifresi ile onceki gun verilen beyannameleri, tahakkuklari ve varsa XML dosyalarini indir; BeyanKaydi olarak teslim et.';
      case 'E_TEBLIGAT_CHECK':
        return 'Mukellefin vergi dairesi kullanici kodu, parola ve sifresi ile e-Tebligat kutusunu kontrol et; yeni tebligat varsa PDF ve metadata olarak teslim et.';
      case 'SGK_HIZMET_LISTESI':
        return 'Mukellefin SGK kullanici adi/e-kod, sistem sifresi ve isyeri sifresi ile hizmet listesini indir ve portal belgesi olarak teslim et.';
      case 'SGK_TAHAKKUK':
        return 'Mukellefin SGK kullanici adi/e-kod, sistem sifresi ve isyeri sifresi ile cari donem tahakkuklarini indir ve portal belgesi olarak teslim et.';
      case 'SGK_ISE_GIRIS_CIKIS':
        return 'Mukellefin SGK kullanici adi/e-kod, sistem sifresi ve isyeri sifresi ile ise giris ve isten cikis bildirgelerini indir ve portal belgesi olarak teslim et.';
      case 'SGK_ISGOREMEZLIK':
        return 'Mukellefin SGK kullanici adi/e-kod, sistem sifresi ve isyeri sifresi ile isgoremezlik raporlarini sorgula; rapor varsa portal belgesi olarak teslim et.';
    }
  }

  private async markCredentialError(job: any, errorMessage: string) {
    const meta = JOB_META[job.jobType as PortalJobType];
    if (!meta) return;
    const ownerId = meta.ownerType === 'TENANT' ? job.tenantId : job.taxpayerId;
    if (!ownerId) return;
    await (this.prisma as any).portalCredential.updateMany({
      where: { tenantId: job.tenantId, provider: meta.provider, ownerType: meta.ownerType, ownerId },
      data: { lastCheckedAt: new Date(), lastError: errorMessage.slice(0, 1000) },
    });
  }

  private async markCredentialSuccess(job: any) {
    const meta = JOB_META[job.jobType as PortalJobType];
    if (!meta) return;
    const ownerId = meta.ownerType === 'TENANT' ? job.tenantId : job.taxpayerId;
    if (!ownerId) return;
    await (this.prisma as any).portalCredential.updateMany({
      where: { tenantId: job.tenantId, provider: meta.provider, ownerType: meta.ownerType, ownerId },
      data: { lastCheckedAt: new Date(), lastSuccessAt: new Date(), lastError: null },
    });
  }

  private async resolveTenantFromToken(token?: string): Promise<string> {
    if (!token) throw new UnauthorizedException('Missing X-Agent-Token');
    const raw = process.env.AGENT_INGEST_TOKENS || '';
    if (raw) {
      const map: Record<string, string> = {};
      for (const pair of raw.split(',')) {
        const [tid, tok] = pair.split(':');
        if (tid && tok) map[tok.trim()] = tid.trim();
      }
      const fromEnv = map[token.trim()];
      if (fromEnv) return fromEnv;
    }
    const t = token.trim();
    const tenant = await (this.prisma as any).tenant.findFirst({
      where: { OR: [{ slug: t }, { id: t }] },
      select: { id: true },
    });
    if (!tenant) throw new UnauthorizedException('Invalid agent token');
    return tenant.id;
  }

  private envFlag(value?: string | null) {
    return ['1', 'true', 'yes', 'on', 'evet'].includes(String(value || '').trim().toLowerCase());
  }

  private runnerEnabled() {
    const raw = process.env.PORTAL_AUTOMATION_RAILWAY_RUNNER_ENABLED;
    if (raw != null) return this.envFlag(raw);
    return process.env.NODE_ENV !== 'test';
  }

  private runnerIncludeNightly() {
    const raw = process.env.PORTAL_AUTOMATION_RAILWAY_RUNNER_INCLUDE_NIGHTLY;
    if (raw != null) return this.envFlag(raw);
    return this.runnerEnabled();
  }

  private runnerJobTypes() {
    const raw = process.env.PORTAL_AUTOMATION_RAILWAY_RUNNER_JOB_TYPES;
    if (!raw) return PORTAL_JOB_TYPES;
    const parsed = raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(isPortalJobType);
    return parsed.length ? parsed : PORTAL_JOB_TYPES;
  }
}
