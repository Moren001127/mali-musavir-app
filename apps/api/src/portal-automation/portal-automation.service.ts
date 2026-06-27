import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { PDFParse } from 'pdf-parse';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { encrypt, tryDecrypt } from '../common/crypto';
import { resolveTenantFromAgentToken as resolveAgentTenant } from '../common/agent-token';
import { BeyanKayitlariService } from '../beyan-kayitlari/beyan-kayitlari.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notification-types';

export const PORTAL_PROVIDERS = ['GIB_EBEYANNAME', 'GIB_IVD', 'SGK_EBILDIRGE'] as const;
export type PortalProvider = (typeof PORTAL_PROVIDERS)[number];

export const PORTAL_JOB_TYPES = [
  'EBEYANNAME_DAILY_DOWNLOAD',
  'E_TEBLIGAT_CHECK',
  'SGK_HIZMET_LISTESI',
  'SGK_TAHAKKUK',
  'SGK_ISE_GIRIS_CIKIS',
  'SGK_ISGOREMEZLIK',
  'EARSIV_PORTAL_FETCH',
  // Galeri HGS: Dijital Vergi Dairesi'nden araç plakalarını çek + KGM ihlal sorgusu.
  // ownerType TAXPAYER (galeri mükellefinin GIB_IVD girişi). Gece cron'una DAHIL DEĞİL —
  // yalnızca galeri ekranındaki butondan / HGS cron'undan tetiklenir.
  'GALERI_HGS',
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
  EARSIV_PORTAL_FETCH: {
    provider: 'GIB_IVD',
    ownerType: 'TAXPAYER',
    label: 'GIB e-Arsiv fatura cekimi',
  },
  GALERI_HGS: {
    provider: 'GIB_IVD',
    ownerType: 'TAXPAYER',
    label: 'Galeri HGS ihlal sorgu',
  },
};

type ManualRunInput = {
  scope?: 'all' | 'beyanname' | 'tebligat' | 'sgk';
  jobTypes?: string[];
  taxpayerIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  donem?: string;
  targetPeriod?: string;
  force?: boolean;
  validationOnly?: boolean;
  discover?: boolean;
  earsivMode?: 'query' | 'download';
  selectedRefs?: string[];
};

type JobProgressUpdate = {
  step?: string;
  message?: string;
  detail?: string;
  current?: number;
  total?: number;
  records?: number;
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
  const text = String(value).trim();
  const tr = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (tr) {
    const [, dd, mm, yyyy, hh = '0', min = '0', ss = '0'] = tr;
    const d = new Date(
      Date.UTC(
        Number(yyyy),
        Number(mm) - 1,
        Number(dd),
        Number(hh),
        Number(min),
        Number(ss),
      ),
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

function monthRange(period?: string | null) {
  const match = String(period || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!year || month < 1 || month > 12) return null;
  return {
    start: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
  };
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

function normalizeTextKey(value?: string | null) {
  return String(value || '')
    .toLocaleUpperCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function lastThreeDaysRange(now = new Date()) {
  const todayStart = startOfIstanbulDay(now);
  const end = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
  const start = new Date(todayStart.getTime() - 3 * 24 * 60 * 60 * 1000);
  return { start, end };
}

@Injectable()
export class PortalAutomationService {
  private readonly logger = new Logger(PortalAutomationService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private beyanKayitlari: BeyanKayitlariService,
    private notifications: NotificationsService,
  ) {}

  private isTemporaryTaxType(type?: string | null) {
    return /^(GECICI_VERGI|GGECICI|KGECICI)$/i.test(String(type || ''));
  }

  private normalizeTextKey(value?: string | null) {
    return String(value || '')
      .toLocaleUpperCase('tr-TR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private taxpayerLooksCorporate(taxpayer?: { taxNumber?: string | null; companyName?: string | null; firstName?: string | null; lastName?: string | null } | null) {
    const taxNumber = String(taxpayer?.taxNumber || '').replace(/\D/g, '');
    const nameKey = this.normalizeTextKey([
      taxpayer?.companyName,
      taxpayer?.firstName,
      taxpayer?.lastName,
    ].filter(Boolean).join(' '));
    if (/\b(LIMITED|LTD|ANONIM|A S|AS|SIRKET|SIRKETI|STI|KOOPERATIF)\b/.test(nameKey)) return true;
    return taxNumber.length === 10;
  }

  private taxpayerLooksPersonal(taxpayer?: { taxNumber?: string | null; companyName?: string | null; firstName?: string | null; lastName?: string | null } | null) {
    const taxNumber = String(taxpayer?.taxNumber || '').replace(/\D/g, '');
    return taxNumber.length === 11 && !this.taxpayerLooksCorporate(taxpayer);
  }

  private canonicalDeclarationIdentity(
    input: AgentDeclarationInput,
    taxpayer?: { taxNumber?: string | null; companyName?: string | null; firstName?: string | null; lastName?: string | null } | null,
  ) {
    let beyanTipi = String(input.beyanTipi || '').toUpperCase();
    let donem = String(input.donem || '');
    if (this.isTemporaryTaxType(beyanTipi) && this.taxpayerLooksCorporate(taxpayer)) {
      beyanTipi = 'KGECICI';
    } else if (this.isTemporaryTaxType(beyanTipi) && this.taxpayerLooksPersonal(taxpayer)) {
      beyanTipi = 'GGECICI';
    } else if (beyanTipi === 'GECICI_VERGI') {
      const rawKey = this.normalizeTextKey(JSON.stringify(input.raw || {})).replace(/\s+/g, '');
      if (/GGECICI|GELIRGECICI|GELIRVERGISIGECICI/.test(rawKey)) beyanTipi = 'GGECICI';
      else if (/KGECICI|KURUMGECICI|KURUMLARGECICI|KURUMLARVERGISIGECICI/.test(rawKey)) beyanTipi = 'KGECICI';
    }
    if (this.isTemporaryTaxType(beyanTipi)) {
      const monthly = donem.match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
      if (monthly) donem = `${monthly[1]}-Q${Math.ceil(Number(monthly[2]) / 3)}`;
    }
    return { beyanTipi, donem };
  }

  @Cron('0 15 2 * * *', { timeZone: 'Europe/Istanbul' })
  async nightlyTick() {
    if (this.envFlag(process.env.PORTAL_AUTOMATION_DISABLE_NIGHTLY || '')) return;
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
      tebligatTotal,
      tebligatErrorRows,
      sgkTotal,
      sgkErrorRows,
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
      // "Bu hafta yeni" = tebligatın GERÇEK gönderim tarihi son 7 günde (kayıt tarihi DEĞİL;
      // bugün toplu çekilen eski tebligatları yeni saymasın).
      (this.prisma as any).portalDocument.count({ where: { tenantId, belgeTuru: 'E_TEBLIGAT', issuedAt: { gte: sevenDaysAgo } } }),
      // Gerçek TOPLAM e-Tebligat (frontend liste limitinden bağımsız).
      (this.prisma as any).portalDocument.count({ where: { tenantId, belgeTuru: 'E_TEBLIGAT' } }),
      // Gece sorgusunda HATA alan mükellefler (son 24s E_TEBLIGAT_CHECK failed, mükellef bazında,
      // en güncel hata mesajı + mükellef adı ile — KPI'a tıklayınca liste gösterilir).
      (this.prisma as any).portalAutomationJob.findMany({
        where: { tenantId, jobType: 'E_TEBLIGAT_CHECK', status: 'failed', createdAt: { gte: dayAgo } },
        distinct: ['taxpayerId'],
        orderBy: { createdAt: 'desc' },
        select: {
          taxpayerId: true,
          errorMessage: true,
          createdAt: true,
          taxpayer: { select: { companyName: true, firstName: true, lastName: true, taxNumber: true } },
        },
      }),
      // Toplam SGK belgesi (tahakkuk + hizmet listesi).
      (this.prisma as any).portalDocument.count({ where: { tenantId, belgeTuru: { in: ['SGK_TAHAKKUK', 'SGK_HIZMET_LISTESI'] } } }),
      // Son 24s SGK sorgusunda HATA alan mükellefler (mükellef bazında, ad+sebep ile).
      (this.prisma as any).portalAutomationJob.findMany({
        where: { tenantId, jobType: { in: ['SGK_HIZMET_LISTESI', 'SGK_TAHAKKUK'] }, status: 'failed', createdAt: { gte: dayAgo } },
        distinct: ['taxpayerId'],
        orderBy: { createdAt: 'desc' },
        select: {
          taxpayerId: true,
          errorMessage: true,
          taxpayer: { select: { companyName: true, firstName: true, lastName: true, taxNumber: true } },
        },
      }),
      this.listJobs(tenantId, { limit: 8 }),
      this.listDocuments(tenantId, { limit: 8 }),
    ]);

    const tebligatErrors = (Array.isArray(tebligatErrorRows) ? tebligatErrorRows : [])
      .filter((r: any) => r?.taxpayerId)
      .map((r: any) => ({
        taxpayerId: r.taxpayerId,
        name: r.taxpayer?.companyName
          || [r.taxpayer?.firstName, r.taxpayer?.lastName].filter(Boolean).join(' ').trim()
          || r.taxpayer?.taxNumber
          || 'Mükellef',
        taxNumber: r.taxpayer?.taxNumber || null,
        reason: r.errorMessage || null,
      }));
    const tebligatErrorCount = tebligatErrors.length;
    const sgkErrors = (Array.isArray(sgkErrorRows) ? sgkErrorRows : [])
      .filter((r: any) => r?.taxpayerId)
      .map((r: any) => ({
        taxpayerId: r.taxpayerId,
        name: r.taxpayer?.companyName
          || [r.taxpayer?.firstName, r.taxpayer?.lastName].filter(Boolean).join(' ').trim()
          || r.taxpayer?.taxNumber
          || 'Mükellef',
        taxNumber: r.taxpayer?.taxNumber || null,
        reason: r.errorMessage || null,
      }));
    const sgkErrorCount = sgkErrors.length;
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
      stats: { activeJobs, failed24h, done24h, docs7d, tebligat7d, tebligatTotal, tebligatErrorCount, tebligatErrors, sgkTotal, sgkErrorCount, sgkErrors },
      credentials,
      latestJobs,
      latestDocuments,
      jobTypes: PORTAL_JOB_TYPES.map((type) => ({ type, ...JOB_META[type] })),
    };
  }

  async credentialStatus(tenantId: string) {
    const rows: any[] = await (this.prisma as any).portalCredential.findMany({
      where: { tenantId },
      include: { taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true } } },
      orderBy: [{ provider: 'asc' }, { updatedAt: 'desc' }],
    });
    return {
      summary: this.summarizeCredentials(rows),
      rows: rows.map((c: any) => this.publicCredential(c)),
    };
  }

  async credentialInsights(tenantId: string) {
    const rows: any[] = await (this.prisma as any).portalCredential.findMany({
      where: {
        tenantId,
        ownerType: 'TAXPAYER',
        provider: { in: ['GIB_IVD', 'SGK_EBILDIRGE'] },
        isActive: true,
      },
      include: {
        taxpayer: {
          select: {
            id: true,
            companyName: true,
            firstName: true,
            lastName: true,
            taxNumber: true,
            taxOffice: true,
            isActive: true,
          },
        },
      },
    });

    const collator = new Intl.Collator('tr', { sensitivity: 'base' });
    const itemFor = (row: any, reason?: string) => ({
      id: row.taxpayer?.id || row.taxpayerId || row.ownerId,
      name: adFormat(row.taxpayer),
      taxNumber: row.taxpayer?.taxNumber || null,
      taxOffice: row.taxpayer?.taxOffice || null,
      reason: reason || row.lastError || null,
    });
    const sortItems = (items: any[]) => items.sort((a, b) => collator.compare(a.name || '', b.name || ''));
    const credentialKey = (...parts: Array<string | null | undefined>) => {
      const exactParts = parts.map((part) => String(part || '').trim());
      return exactParts.every(Boolean) ? exactParts.join('\u0001') : '';
    };
    const isWrongCredentialError = (error?: string | null) => {
      const normalized = normalizeTextKey(String(error || ''));
      if (!normalized) return false;
      if (normalized.includes('PORTAL GIRIS ALANLARI BULUNAMADI')) return false;
      if (normalized.includes('PORTAL LOGIN FORMU YUKLENMEDI')) return false;
      if (normalized.includes('ALANI BULUNAMADI')) return false;
      return true;
    };
    const groupByCredential = (provider: PortalProvider, keyOf: (row: any) => string) => {
      const groups = new Map<string, any[]>();
      for (const row of rows) {
        if (row.provider !== provider || row.taxpayer?.isActive === false) continue;
        const key = keyOf(row);
        if (!key) continue;
        const group = groups.get(key) || [];
        group.push(row);
        groups.set(key, group);
      }
      const affected = Array.from(groups.values())
        .filter((group) => group.length > 1)
        .flatMap((group) => group.map((row) => itemFor(row, 'Aynı portal giriş bilgisi kullanılıyor')));
      return sortItems(affected);
    };

    const gibSame = groupByCredential('GIB_IVD', (row) => {
      return credentialKey(
        row.userCode || row.username,
        tryDecrypt(row.encryptedSecondaryPassword) || tryDecrypt(row.encryptedPassword),
      );
    });
    const sgkSame = groupByCredential('SGK_EBILDIRGE', (row) => {
      return credentialKey(
        row.username || row.userCode,
        row.workplaceCode,
        tryDecrypt(row.encryptedPassword),
        tryDecrypt(row.encryptedSecondaryPassword),
      );
    });

    const wrongFor = (provider: PortalProvider) => sortItems(rows
      .filter((row) => row.provider === provider && row.taxpayer?.isActive !== false && isWrongCredentialError(row.lastError))
      .map((row) => itemFor(row)));

    const workplaceIz = sortItems(rows
      .filter((row) => row.provider === 'SGK_EBILDIRGE' && row.taxpayer?.isActive !== false)
      .filter((row) => {
        const workplace = this.plainCredentialPart(row.workplaceCode);
        const secondary = this.plainCredentialPart(tryDecrypt(row.encryptedSecondaryPassword));
        return workplace === 'IZ' || secondary === 'IZ';
      })
      .map((row) => itemFor(row, 'İş yeri bilgisi "iz" olarak kayıtlı')));

    const cards = [
      { key: 'sgk_same', label: 'Bildirge şifresi aynı olanlar', tone: 'blue', count: sgkSame.length, taxpayers: sgkSame },
      { key: 'gib_same', label: 'VD şifresi aynı olanlar', tone: 'blue', count: gibSame.length, taxpayers: gibSame },
      { key: 'gib_wrong', label: 'VD şifresi yanlış olanlar', tone: 'amber', count: wrongFor('GIB_IVD').length, taxpayers: wrongFor('GIB_IVD') },
      { key: 'sgk_wrong', label: 'Bildirge şifresi yanlış olanlar', tone: 'amber', count: wrongFor('SGK_EBILDIRGE').length, taxpayers: wrongFor('SGK_EBILDIRGE') },
      { key: 'workplace_iz', label: 'İş yeri "iz" olanlar', tone: 'amber', count: workplaceIz.length, taxpayers: workplaceIz },
    ];

    return { cards };
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

    if (!existing && !input?.password && !input?.secondaryPassword) {
      throw new BadRequestException('Yeni sifre kaydi icin sifre zorunlu');
    }

    const credentialPasswordChanged = Boolean(input?.password || input?.secondaryPassword);
    const data: any = {
      username: input?.username ? String(input.username).trim() : null,
      userCode: input?.userCode ? String(input.userCode).trim() : null,
      officeCode: input?.officeCode ? String(input.officeCode).trim() : null,
      workplaceCode: input?.workplaceCode ? String(input.workplaceCode).trim() : null,
      isActive: input?.isActive !== false,
      notes: input?.notes ? String(input.notes).slice(0, 1000) : null,
      updatedBy: userId,
      lastError: credentialPasswordChanged ? null : existing?.lastError || null,
    };
    if (['GIB_EBEYANNAME', 'GIB_IVD'].includes(provider) && input?.secondaryPassword) {
      data.encryptedPassword = null;
    }
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
    if (provider === 'SGK_EBILDIRGE' && taxpayerId && this.isReadySgkCredential(row)) {
      await this.ensureSgkBildirgeConfig(taxpayerId);
    }
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

  async listDocuments(tenantId: string, opts: { limit?: number; taxpayerId?: string; belgeTuru?: string; period?: string } = {}) {
    const where: any = { tenantId };
    if (opts.taxpayerId) where.taxpayerId = opts.taxpayerId;
    const range = monthRange(opts.period);
    if (range) {
      where.OR = [
        { period: opts.period },
        { issuedAt: { gte: range.start, lt: range.end } },
      ];
    } else if (opts.period) {
      where.period = opts.period;
    }
    if (opts.belgeTuru) {
      // virgülle çoklu belgeTürü (örn. SGK_TAHAKKUK,SGK_HIZMET_LISTESI)
      const ts = String(opts.belgeTuru).split(',').map((s) => s.trim()).filter(Boolean);
      where.belgeTuru = ts.length > 1 ? { in: ts } : ts[0];
    }
    // limit === 0 -> SINIRSIZ (hepsi); aksi halde varsayılan 50, üst sınır 50000.
    const raw = Number(opts.limit);
    const take = raw === 0 ? undefined : Math.min(Math.max(Number.isFinite(raw) && raw > 0 ? raw : 50, 1), 50000);
    return (this.prisma as any).portalDocument.findMany({
      where,
      include: { taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true } } },
      // GÖNDERIM tarihine göre (yeni→eski); tarihsizler en sona; eşitlikte kayıt zamanı.
      orderBy: [{ issuedAt: { sort: 'desc', nulls: 'last' } }, { receivedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      ...(take !== undefined ? { take } : {}),
    });
  }

  async getDocumentViewUrl(tenantId: string, docId: string) {
    const doc = await (this.prisma as any).portalDocument.findFirst({
      where: { id: docId, tenantId },
      select: { id: true, storageKey: true, mimeType: true, title: true, referenceNo: true, viewedAt: true },
    });
    if (!doc) throw new NotFoundException('Belge bulunamadi');
    if (!doc.storageKey) throw new BadRequestException('Bu tebligatin PDF dosyasi henuz indirilmedi (bir sonraki sorguda gelir).');
    // İlk görüntülemede damgala → buton kalıcı yeşile döner.
    let viewedAt = doc.viewedAt;
    if (!viewedAt) {
      viewedAt = new Date();
      await (this.prisma as any).portalDocument.update({ where: { id: doc.id }, data: { viewedAt } }).catch(() => {});
    }
    const filename = `${doc.referenceNo || doc.title || 'tebligat'}.pdf`;
    const url = await this.storage.getPresignedInlineUrl(doc.storageKey, filename, doc.mimeType || 'application/pdf');
    return { url, viewedAt };
  }

  async listEarsivPortalInvoices(
    tenantId: string,
    opts: { taxpayerId?: string; period?: string; limit?: number } = {},
  ) {
    const docs = await this.listDocuments(tenantId, {
      taxpayerId: opts.taxpayerId,
      period: opts.period,
      belgeTuru: 'EARSIV_FATURA',
      limit: Math.min(Math.max(Number(opts.limit || 300), 1), 1000),
    });
    const refs = new Set<string>();
    const rows = docs.map((doc: any) => {
      const raw = doc.raw && typeof doc.raw === 'object' ? doc.raw : {};
      const portalRow = raw.row && typeof raw.row === 'object' ? raw.row : {};
      const ettn = String(raw.ettn || portalRow.ettn || portalRow.uuid || '').trim();
      const belgeNo = String(raw.belgeNumarasi || doc.referenceNo || portalRow.belgeNumarasi || portalRow.faturaNo || '').trim();
      const sourceRefId = ettn || belgeNo || String(doc.referenceNo || '').trim();
      if (sourceRefId) refs.add(sourceRefId);
      const onayDurumu = String(raw.onayDurumu || portalRow.onayDurumu || portalRow.durum || '').trim() || 'Onaylandi';
      const iptalDurumu = String(portalRow.iptalItirazDurumu || portalRow.iptalDurumu || portalRow.itirazDurumu || raw.iptalDurumu || '').trim();
      const issuedAt = doc.issuedAt || parseDateOrNull(String(
        portalRow.belgeTarihi ||
        portalRow.faturaTarihi ||
        portalRow.duzenlemeTarihi ||
        portalRow.tarih ||
        '',
      ));
      const blocked = /iptal|itiraz|red|reddedil|cancel/i.test(`${onayDurumu} ${iptalDurumu}`);
      return {
        id: doc.id,
        portalDocumentId: doc.id,
        taxpayerId: doc.taxpayerId,
        referenceNo: doc.referenceNo,
        belgeNo,
        ettn,
        buyerName: String(portalRow.aliciUnvanAdSoyad || portalRow.aliciUnvan || portalRow.unvan || '').trim(),
        buyerVkn: String(portalRow.vknTckn || portalRow.aliciVknTckn || portalRow.aliciVkn || portalRow.aliciTckn || portalRow.aliciVergiNo || portalRow.kimlikNo || '').replace(/\D/g, ''),
        issuedAt,
        period: doc.period,
        title: doc.title,
        onayDurumu,
        iptalDurumu: iptalDurumu || 'Yok',
        aktarimDurumu: doc.storageKey ? 'indirildi' : 'sorgulandi',
        isProcessable: !blocked,
        blockedReason: blocked ? 'Iptal/itiraz/reddedilen fatura islenmez' : null,
        sourceRefId,
      };
    });
    const accountingRows = refs.size
      ? await (this.prisma as any).invoiceAccountingDocument.findMany({
          where: {
            tenantId,
            ...(opts.taxpayerId ? { taxpayerId: opts.taxpayerId } : {}),
            source: 'gib-earsiv-api',
            sourceRefId: { in: [...refs] },
          },
          select: { id: true, sourceRefId: true, status: true, lucaStatus: true },
        }).catch(() => [])
      : [];
    const accByRef = new Map<string, any>(accountingRows.map((r: any) => [String(r.sourceRefId), r]));
    return rows.map((row: any) => {
      const acc = accByRef.get(row.sourceRefId);
      return {
        ...row,
        muhasebeBelgeId: acc?.id || null,
        muhasebeDurumu: acc?.status || null,
        lucaDurumu: acc?.lucaStatus || null,
        aktarildi: !!acc,
      };
    });
  }

  // "Tümünü Görüntüle": verilen belgeleri (ya da filtreye uyan E_TEBLIGAT'ları) görüntülendi
  // işaretle -> butonlar kalıcı yeşile döner. ids verilirse onlar; verilmezse belgeTuru/taxpayerId
  // kapsamındaki, PDF'i olan (storageKey) ve henüz görüntülenmemiş tüm belgeler.
  async markDocumentsViewed(
    tenantId: string,
    input: { ids?: string[]; belgeTuru?: string; taxpayerId?: string } = {},
  ) {
    const now = new Date();
    const where: any = { tenantId, viewedAt: null, storageKey: { not: null } };
    if (Array.isArray(input.ids) && input.ids.length) {
      where.id = { in: input.ids.slice(0, 2000) };
    } else {
      if (input.belgeTuru) where.belgeTuru = input.belgeTuru;
      if (input.taxpayerId) where.taxpayerId = input.taxpayerId;
    }
    const res = await (this.prisma as any).portalDocument.updateMany({ where, data: { viewedAt: now } });
    return { updated: res?.count ?? 0, viewedAt: now };
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
      targetPeriod: input.targetPeriod,
      force: input.force === true,
      validationOnly: input.validationOnly === true,
      discover: input.discover === true,
      earsivMode: input.earsivMode,
      selectedRefs: input.selectedRefs,
    });
    return {
      ...res,
      message: `${res.created.length} is kuyruga alindi, ${res.skipped.length} atlandi`,
    };
  }

  async createNightlyJobsForTenant(tenantId: string) {
    const { start, end } = lastThreeDaysRange();
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

  async recentJobsForAgent(
    tenantId: string,
    opts: { limit?: number; jobType?: string; taxpayerId?: string } = {},
  ) {
    const limit = Math.min(Math.max(Number(opts.limit || 20), 1), 100);
    const where: any = { tenantId };
    if (opts.jobType) where.jobType = { in: String(opts.jobType).split(',').map((s) => s.trim()).filter(Boolean) };
    if (opts.taxpayerId) where.taxpayerId = opts.taxpayerId;
    const jobs = await (this.prisma as any).portalAutomationJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        taxpayerId: true,
        jobType: true,
        status: true,
        source: true,
        donem: true,
        periodStart: true,
        periodEnd: true,
        recordCount: true,
        attempts: true,
        targetDeviceId: true,
        result: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
        startedAt: true,
        finishedAt: true,
        taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true } },
      },
    });
    return jobs.map((job: any) => ({
      ...job,
      jobLabel: JOB_META[job.jobType as PortalJobType]?.label || job.jobType,
      provider: JOB_META[job.jobType as PortalJobType]?.provider || null,
    }));
  }

  async getJobStatusForAgent(tenantId: string, jobId: string) {
    const job = await (this.prisma as any).portalAutomationJob.findFirst({
      where: { id: jobId, tenantId },
      select: {
        id: true,
        tenantId: true,
        taxpayerId: true,
        jobType: true,
        status: true,
        source: true,
        periodStart: true,
        periodEnd: true,
        donem: true,
        payload: true,
        result: true,
        errorMessage: true,
        recordCount: true,
        attempts: true,
        targetDeviceId: true,
        createdAt: true,
        updatedAt: true,
        startedAt: true,
        finishedAt: true,
        taxpayer: {
          select: {
            id: true,
            companyName: true,
            firstName: true,
            lastName: true,
            taxNumber: true,
            taxOffice: true,
          },
        },
      },
    });
    if (!job) throw new NotFoundException('Job bulunamadi');
    const documents = await (this.prisma as any).portalDocument.findMany({
      where: { tenantId, jobId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        taxpayerId: true,
        belgeTuru: true,
        sourceProvider: true,
        title: true,
        referenceNo: true,
        period: true,
        issuedAt: true,
        receivedAt: true,
        mimeType: true,
        sizeBytes: true,
        storageKey: true,
        documentId: true,
        createdAt: true,
      },
    });
    const meta = JOB_META[job.jobType as PortalJobType];
    return {
      ...job,
      jobLabel: meta?.label || job.jobType,
      provider: meta?.provider || null,
      documentCount: documents.length,
      documents,
    };
  }

  async syncEarsivPortalDocumentsToAccounting(
    tenantId: string,
    opts: { taxpayerId?: string; period?: string; limit?: number } = {},
  ) {
    const limit = Math.min(Math.max(Number(opts.limit || 500), 1), 1000);
    const where: any = { tenantId, belgeTuru: 'EARSIV_FATURA', storageKey: { not: null } };
    if (opts.taxpayerId) where.taxpayerId = opts.taxpayerId;
    const range = monthRange(opts.period);
    if (opts.period && !range) where.period = opts.period;
    if (range) {
      where.OR = [
        { period: opts.period },
        { issuedAt: { gte: range.start, lt: range.end } },
      ];
    }
    const docs = await (this.prisma as any).portalDocument.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        taxpayerId: true,
        jobId: true,
        title: true,
        referenceNo: true,
        period: true,
        issuedAt: true,
        receivedAt: true,
        mimeType: true,
        sizeBytes: true,
        storageKey: true,
        raw: true,
      },
    });
    let processed = 0;
    let imported = 0;
    let skipped = 0;
    for (const doc of docs) {
      if (!doc.taxpayerId || !doc.storageKey) {
        skipped++;
        continue;
      }
      processed++;
      const before = await (this.prisma as any).invoiceAccountingDocument.count({
        where: { tenantId, taxpayerId: doc.taxpayerId, source: 'gib-earsiv-api' },
      }).catch(() => 0);
      await this.importEarsivPortalDocumentToAccounting(
        tenantId,
        doc.jobId || '',
        {
          taxpayerId: doc.taxpayerId,
          belgeTuru: 'EARSIV_FATURA',
          title: doc.title || 'GIB e-Arsiv Fatura',
          referenceNo: doc.referenceNo,
          period: doc.period,
          issuedAt: doc.issuedAt ? doc.issuedAt.toISOString() : null,
          receivedAt: doc.receivedAt ? doc.receivedAt.toISOString() : null,
          mimeType: doc.mimeType,
          originalName: doc.title || doc.referenceNo || 'earsiv-fatura.json',
          raw: doc.raw || {},
        },
        'EARSIV_PORTAL_FETCH',
        doc.storageKey,
        doc.sizeBytes,
        doc.mimeType || 'application/json',
      );
      const after = await (this.prisma as any).invoiceAccountingDocument.count({
        where: { tenantId, taxpayerId: doc.taxpayerId, source: 'gib-earsiv-api' },
      }).catch(() => before);
      if (after > before) imported++;
    }
    return { processed, imported, skipped, totalPortalDocuments: docs.length };
  }

  async cancelJob(tenantId: string, jobId: string, reason = 'Kullanici iptal etti') {
    const job = await (this.prisma as any).portalAutomationJob.findFirst({
      where: { id: jobId, tenantId },
      select: { id: true, status: true, payload: true },
    });
    if (!job) throw new NotFoundException('Job bulunamadi');
    if (['done', 'failed', 'cancelled'].includes(job.status)) return job;
    return (this.prisma as any).portalAutomationJob.update({
      where: { id: jobId },
      data: {
        status: 'cancelled',
        errorMessage: reason.slice(0, 2000),
        finishedAt: new Date(),
        payload: this.withJobProgress(job.payload, {
          step: 'cancelled',
          message: 'Is iptal edildi.',
          detail: reason.slice(0, 500),
        }),
      },
    });
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
        source: job.source,
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
    const job = await (this.prisma as any).portalAutomationJob.findFirst({
      where: { id: jobId, tenantId, status: 'pending' },
      select: { id: true, payload: true },
    });
    if (!job) throw new NotFoundException('Baslatilacak job bulunamadi');
    const mode = String(job.payload?.runnerMode || '');
    const message = mode.startsWith('local')
      ? 'Yerel ajan isi aldi, giris hazirligi yapiliyor.'
      : 'Runner isi aldi, giris hazirligi yapiliyor.';
    return (this.prisma as any).portalAutomationJob.update({
      where: { id: jobId },
      data: {
        status: 'running',
        startedAt: new Date(),
        errorMessage: null,
        attempts: { increment: 1 },
        ...(deviceId ? { targetDeviceId: deviceId } : {}),
        payload: this.withJobProgress(job.payload, {
          step: 'runner',
          message,
        }),
      },
    });
  }

  async updateJobProgress(tenantId: string, jobId: string, progress: JobProgressUpdate) {
    const job = await (this.prisma as any).portalAutomationJob.findFirst({
      where: { id: jobId, tenantId },
      select: { id: true, status: true, payload: true },
    });
    if (!job) throw new NotFoundException('Job bulunamadi');
    if (job.status === 'cancelled') throw new BadRequestException('Job iptal edildi');
    return (this.prisma as any).portalAutomationJob.update({
      where: { id: jobId },
      data: { payload: this.withJobProgress(job.payload, progress) },
    });
  }

  async markFailed(tenantId: string, jobId: string, errorMessage: string) {
    const job = await (this.prisma as any).portalAutomationJob.findFirst({ where: { id: jobId, tenantId } });
    if (!job) throw new NotFoundException('Job bulunamadi');
    if (job.status === 'cancelled') return job;
    await this.markCredentialError(job, errorMessage).catch(() => {});
    return (this.prisma as any).portalAutomationJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        errorMessage: errorMessage.slice(0, 2000),
        finishedAt: new Date(),
        payload: this.withJobProgress(job.payload, {
          step: 'failed',
          message: 'Is hata ile durdu.',
          detail: errorMessage.slice(0, 500),
        }),
      },
    });
  }

  async completeJob(
    tenantId: string,
    jobId: string,
    input: { declarations?: AgentDeclarationInput[]; documents?: AgentDocumentInput[]; result?: any; recordCount?: number },
  ) {
    const job = await (this.prisma as any).portalAutomationJob.findFirst({ where: { id: jobId, tenantId } });
    if (!job) throw new NotFoundException('Job bulunamadi');
    if (job.status === 'cancelled') return job;

    let recordCount = 0;
    const declarations = Array.isArray(input?.declarations) ? input.declarations : [];
    const documents = Array.isArray(input?.documents) ? input.documents : [];

    // E_TEBLIGAT: PDF'i BU sorguda ILK KEZ inen tebligatlari belirlemek icin, saklamadan
    // ONCE mevcut (storageKey'li) belge no'lari snapshot al. Boylece her re-query'de owner'a
    // tekrar bildirim/PDF gitmez.
    const etbDocs = documents.filter((d) => d.belgeTuru === 'E_TEBLIGAT' && d.referenceNo);
    let etbAlreadyBacked = new Set<string>();
    if (etbDocs.length) {
      const refs = etbDocs.map((d) => String(d.referenceNo));
      const prevBacked = await (this.prisma as any).portalDocument.findMany({
        where: { tenantId, belgeTuru: 'E_TEBLIGAT', referenceNo: { in: refs }, storageKey: { not: null } },
        select: { referenceNo: true },
      });
      etbAlreadyBacked = new Set(prevBacked.map((p: any) => String(p.referenceNo)));
    }

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
    const doneMessage = input?.result?.validationOnly
      ? 'Portal girisi dogrulandi.'
      : finalCount > 0
      ? `${finalCount} kayit portala yazildi.`
      : 'GIB sorgusu tamamlandi, indirilecek kayit bulunamadi.';
    const updated = await (this.prisma as any).portalAutomationJob.update({
      where: { id: jobId },
      data: {
        status: 'done',
        result: input?.result || { declarations: declarations.length, documents: documents.length },
        recordCount: finalCount,
        finishedAt: new Date(),
        payload: this.withJobProgress(job.payload, {
          step: 'done',
          message: doneMessage,
          records: finalCount,
        }),
      },
    });

    // Sadece PDF'i BU sorguda ilk kez inen tebligatlar icin bildirim uret (re-query'de
    // tekrarlanmasin). metadata.newDocIds -> owner-notifier firma ismiyle + PDF dosyasini
    // WhatsApp'tan gonderir.
    const newEtbRefs = etbDocs
      .filter((d) => d.base64 && !etbAlreadyBacked.has(String(d.referenceNo)))
      .map((d) => String(d.referenceNo));
    if (newEtbRefs.length) {
      const newRows = await (this.prisma as any).portalDocument.findMany({
        where: { tenantId, belgeTuru: 'E_TEBLIGAT', referenceNo: { in: newEtbRefs }, storageKey: { not: null } },
        select: { id: true },
      });
      const newDocIds = newRows.map((r: any) => r.id);
      if (newDocIds.length) {
        await (this.prisma as any).notification.create({
          data: {
            tenantId,
            title: 'Yeni e-Tebligat',
            body: `${newDocIds.length} yeni e-Tebligat geldi.`,
            type: 'E_TEBLIGAT',
            metadata: { jobId, newDocIds },
          },
        }).catch(() => {});
      }
    }

    return updated;
  }

  async savePartialJobResults(
    tenantId: string,
    jobId: string,
    input: { declarations?: AgentDeclarationInput[]; documents?: AgentDocumentInput[] },
  ) {
    const job = await (this.prisma as any).portalAutomationJob.findFirst({ where: { id: jobId, tenantId } });
    if (!job) throw new NotFoundException('Job bulunamadi');
    if (job.status === 'cancelled') return job;
    if (job.status !== 'running') throw new BadRequestException(`Job ara kayit icin running degil: ${job.status}`);

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

    if (recordCount > 0) {
      const previousResult = job.result && typeof job.result === 'object' && !Array.isArray(job.result) ? job.result : {};
      await (this.prisma as any).portalAutomationJob.update({
        where: { id: jobId },
        data: {
          recordCount: { increment: recordCount },
          result: {
            ...previousResult,
            partialSaved: Number((previousResult as any).partialSaved || 0) + recordCount,
            partialSavedAt: new Date().toISOString(),
          },
        },
      });
    }

    return recordCount;
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
      targetPeriod?: string;
      force?: boolean;
      validationOnly?: boolean;
      discover?: boolean;
      dedupeAfter?: Date;
      earsivMode?: 'query' | 'download';
      selectedRefs?: string[];
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
      targetPeriod?: string;
      force?: boolean;
      validationOnly?: boolean;
      discover?: boolean;
      earsivMode?: 'query' | 'download';
      selectedRefs?: string[];
    },
  ) {
    const meta = JOB_META[jobType];
    const validationOnly = opts.validationOnly === true;
    const runnerMode = this.runnerModeForJob(jobType, opts.source);
    const pendingMessage = validationOnly
      ? 'Kuyrukta, sadece portal girisi dogrulanacak.'
      : runnerMode === 'local_first' || runnerMode === 'local_first_with_server_fallback'
      ? 'Kuyrukta, yerel Moren ajan bekleniyor.'
      : 'Kuyrukta, runner bekleniyor.';
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
          label: validationOnly ? `${meta.provider} sifre dogrulama` : meta.label,
          provider: meta.provider,
          ownerType: meta.ownerType,
          runnerMode,
          force: opts.force === true,
          validationOnly,
          discover: opts.discover === true,
          earsivMode: opts.earsivMode || undefined,
          selectedRefs: Array.isArray(opts.selectedRefs) ? opts.selectedRefs.slice(0, 500) : undefined,
          targetPeriod: opts.targetPeriod || undefined,
          dateFrom: opts.period.start.toISOString(),
          dateTo: opts.period.end.toISOString(),
          instruction: validationOnly
            ? 'Kayitli portal bilgileriyle sadece giris sayfasinda login dene; belge, tebligat veya liste taramasi yapma.'
            : this.instructionForJob(jobType),
          progress: {
            at: new Date().toISOString(),
            step: 'pending',
            message: pendingMessage,
          },
          progressLog: [
            {
              at: new Date().toISOString(),
              step: 'pending',
              message: pendingMessage,
            },
          ],
        },
      },
      include: { taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true } } },
    });
  }

  private runnerModeForJob(jobType: PortalJobType, source: 'manual' | 'nightly') {
    if (jobType !== 'EBEYANNAME_DAILY_DOWNLOAD') return 'server';
    const raw = String(process.env.PORTAL_AUTOMATION_EBEYANNAME_RUNNER_MODE || '').trim().toLowerCase();
    if (['server', 'railway', 'cloud'].includes(raw)) return 'server';
    if (['local', 'local_only', 'local-only'].includes(raw)) return 'local_first';
    if (['local_first_with_server_fallback', 'server_fallback', 'fallback'].includes(raw)) return 'local_first_with_server_fallback';
    return 'server';
  }

  private withJobProgress(payload: any, progress: JobProgressUpdate) {
    const base = payload && typeof payload === 'object' && !Array.isArray(payload) ? { ...payload } : {};
    const previous = base.progress && typeof base.progress === 'object' && !Array.isArray(base.progress) ? base.progress : {};
    const entry: Record<string, any> = {
      at: new Date().toISOString(),
      step: String(progress.step || previous.step || 'progress').slice(0, 80),
      message: String(progress.message || previous.message || 'Islem suruyor.').slice(0, 300),
    };
    if (progress.detail) entry.detail = String(progress.detail).slice(0, 500);
    if (Number.isFinite(Number(progress.current))) entry.current = Number(progress.current);
    if (Number.isFinite(Number(progress.total))) entry.total = Number(progress.total);
    if (Number.isFinite(Number(progress.records))) entry.records = Number(progress.records);

    const existingLog = Array.isArray(base.progressLog) ? base.progressLog : [];
    return {
      ...base,
      progress: entry,
      progressLog: [...existingLog.slice(-11), entry],
    };
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
        ...(provider === 'SGK_EBILDIRGE'
          ? {
              AND: [
                { OR: [{ username: { not: null } }, { userCode: { not: null } }] },
                { workplaceCode: { not: null } },
                { encryptedPassword: { not: null } },
                { encryptedSecondaryPassword: { not: null } },
              ],
            }
          : {}),
        ...(provider === 'GIB_IVD'
          ? {
              AND: [
                { userCode: { not: null } },
                { OR: [{ encryptedSecondaryPassword: { not: null } }, { encryptedPassword: { not: null } }] },
              ],
            }
          : {}),
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
    return lastThreeDaysRange();
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
    const readyCredential = (row: any) => {
      if (row?.isActive === false) return false;
      if (row.provider === 'GIB_EBEYANNAME') {
        return Boolean(row.userCode && (row.encryptedPassword || row.encryptedSecondaryPassword));
      }
      if (row.provider === 'GIB_IVD') {
        return Boolean(row.userCode && (row.encryptedSecondaryPassword || row.encryptedPassword));
      }
      if (row.provider === 'SGK_EBILDIRGE') {
        return Boolean((row.username || row.userCode) && row.workplaceCode && row.encryptedPassword && row.encryptedSecondaryPassword);
      }
      return false;
    };
    const byProvider = {
      GIB_EBEYANNAME: { total: 0, active: 0 },
      GIB_IVD: { total: 0, active: 0 },
      SGK_EBILDIRGE: { total: 0, active: 0 },
    } as Record<PortalProvider, { total: number; active: number }>;
    for (const row of rows) {
      const provider = String(row.provider);
      if (!isPortalProvider(provider)) continue;
      byProvider[provider].total++;
      if (readyCredential(row)) byProvider[provider].active++;
    }
    return {
      eBeyannameReady: byProvider.GIB_EBEYANNAME.active > 0,
      eTebligatTaxpayerCount: byProvider.GIB_IVD.active,
      sgkTaxpayerCount: byProvider.SGK_EBILDIRGE.active,
      byProvider,
    };
  }

  private isReadySgkCredential(row: any): boolean {
    return Boolean(
      row?.provider === 'SGK_EBILDIRGE' &&
      row?.isActive !== false &&
      (row?.username || row?.userCode) &&
      row?.workplaceCode &&
      row?.encryptedPassword &&
      row?.encryptedSecondaryPassword,
    );
  }

  private plainCredentialPart(value?: string | null) {
    return normalizeTextKey(String(value || '').trim());
  }

  private async ensureSgkBildirgeConfig(taxpayerId: string) {
    await (this.prisma as any).taxpayerBeyanConfig.upsert({
      where: { taxpayerId },
      create: { taxpayerId, sgkBildirgeEnabled: true },
      update: { sgkBildirgeEnabled: true },
    });
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
      password: tryDecrypt(c.encryptedPassword),
      secondaryPassword: tryDecrypt(c.encryptedSecondaryPassword),
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
      select: { id: true, taxNumber: true, companyName: true, firstName: true, lastName: true },
    });
    if (!taxpayer) throw new NotFoundException('Beyanname mukellefi bulunamadi');

    const identity = this.canonicalDeclarationIdentity(input, taxpayer);
    const beyanTipi = identity.beyanTipi;
    const donem = identity.donem;
    const declarationStatus = normalizeAgentDeclarationStatus(input);
    if (declarationStatus !== 'onaylandi') {
      // ÖNCELİK + ÖZ-ONARIM: GİB bu beyannameyi "onay bekliyor" / "hatalı" raporluyor.
      const existingKayit = await (this.prisma as any).beyanKaydi.findUnique({
        where: {
          tenantId_taxpayerId_beyanTipi_donem: { tenantId, taxpayerId: taxpayer.id, beyanTipi, donem },
        },
        select: { id: true, tahakkukTutari: true, pdfUrl: true },
      });
      // (1) ÖNCELİK: bu beyanname GERÇEKTEN onaylı/indirilmiş (tahakkuku veya tahakkuk PDF'i var).
      //     Onaylanmış beyanname iptal edilemez (yalnız düzeltme verilir); GİB'in hâlâ gösterdiği
      //     eski hatalı denemesi onu DÜŞÜRMESİN → durumu değiştirme, onaylı kalsın.
      if (existingKayit && (existingKayit.tahakkukTutari != null || existingKayit.pdfUrl)) {
        return existingKayit;
      }
      // (2) ÖZ-ONARIM: gerçek onaylı yok; pending "onaylı sızıntısı"ndan kalan TAHAKKUKSUZ sahte
      //     BeyanKaydı ("Tutar okunamadı" satırı) varsa temizle — liste ve panel doğru yansısın.
      //     Yalnız gib_agent + tahakkukTutari yok + tahakkuk PDF yok kayıtlara dokunur.
      if (existingKayit) {
        await (this.prisma as any).beyanKaydi.deleteMany({
          where: { tenantId, taxpayerId: taxpayer.id, beyanTipi, donem, kaynak: 'gib_agent', tahakkukTutari: null, pdfUrl: null },
        }).catch(() => {});
      }
      return (this.prisma as any).beyanDurumu.upsert({
        where: {
          tenantId_taxpayerId_beyanTipi_donem: {
            tenantId,
            taxpayerId: taxpayer.id,
            beyanTipi,
            donem,
          },
        },
        create: {
          tenantId,
          taxpayerId: taxpayer.id,
          beyanTipi,
          donem,
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

    const existingKayit = await (this.prisma as any).beyanKaydi.findUnique({
      where: {
        tenantId_taxpayerId_beyanTipi_donem: {
          tenantId,
          taxpayerId: taxpayer.id,
          beyanTipi,
          donem,
        },
      },
      select: { id: true, beyannameUrl: true, pdfUrl: true, xmlUrl: true },
    });
    const isCorrection = this.isCorrectionDeclarationInput(input);
    const forceRefresh = input.raw?.forceRefresh === true;
    const skipBeyannameStorage = !!existingKayit?.beyannameUrl && !isCorrection && !forceRefresh;
    const skipTahakkukStorage = !!existingKayit?.pdfUrl && !isCorrection && !forceRefresh;
    const skipXmlStorage = !!existingKayit?.xmlUrl && !isCorrection && !forceRefresh;
    const beyannameCheck = await this.prepareIncomingDeclarationPdf(tenantId, jobId, input, taxpayer, 'beyanname', skipBeyannameStorage);
    const tahakkukCheck = await this.prepareIncomingDeclarationPdf(tenantId, jobId, input, taxpayer, 'tahakkuk', skipTahakkukStorage);
    const hasIncomingFile = !!(cleanBase64(beyannameCheck.base64) || cleanBase64(tahakkukCheck.base64) || cleanBase64(input.xmlBase64));
    const hasMissingIncomingFile =
      (!!cleanBase64(beyannameCheck.base64) && !skipBeyannameStorage)
      || (!!cleanBase64(tahakkukCheck.base64) && !skipTahakkukStorage)
      || (!!cleanBase64(input.xmlBase64) && !skipXmlStorage);
    if (existingKayit && !isCorrection && hasIncomingFile && !hasMissingIncomingFile && input.tahakkukTutari == null && !input.onayNo) {
      return existingKayit;
    }

    const base = `${tenantId}/${taxpayer.id}/gib-beyan/${beyanTipi}_${donem}`;
    const beyannameUrl = await this.storeBase64IfPresent(
      `${base}_Beyanname_${randomUUID()}.pdf`,
      skipBeyannameStorage ? null : beyannameCheck.base64,
      'application/pdf',
      input.beyannameFileName || 'beyanname.pdf',
    );
    const pdfUrl = await this.storeBase64IfPresent(
      `${base}_Tahakkuk_${randomUUID()}.pdf`,
      skipTahakkukStorage ? null : tahakkukCheck.base64,
      'application/pdf',
      input.tahakkukFileName || 'tahakkuk.pdf',
    );
    const xmlUrl = await this.storeBase64IfPresent(
      `${base}_${randomUUID()}.xml`,
      skipXmlStorage ? null : input.xmlBase64,
      'application/xml',
      'beyanname.xml',
    );
    const pdfMeta: { tahakkukTutari?: number | null; onayNo?: string | null } = tahakkukCheck.text
      ? {
          tahakkukTutari: this.extractTahakkukAmount(tahakkukCheck.text),
          onayNo: this.extractTahakkukOnayNo(tahakkukCheck.text),
        }
      : await this.extractTahakkukMetaFromBase64(tahakkukCheck.base64).catch((err) => {
          this.logger.warn(`Tahakkuk PDF meta okunamadi: ${err?.message || err}`);
          return {};
        });
    const tahakkukTutari = input.tahakkukTutari ?? pdfMeta.tahakkukTutari ?? null;
    const onayNo = input.onayNo || pdfMeta.onayNo || null;

    const data: any = {
      beyanTarihi: parseDateOrNull(input.beyanTarihi),
      kaynak: 'gib_agent',
      importBatchId: jobId,
      notlar: input.raw ? JSON.stringify({ source: 'portal-automation', raw: input.raw }).slice(0, 1000) : null,
    };
    if (tahakkukTutari != null) data.tahakkukTutari = tahakkukTutari;
    if (input.odemeTutari != null) data.odemeTutari = input.odemeTutari;
    if (onayNo) data.onayNo = onayNo;
    if (beyannameUrl) data.beyannameUrl = beyannameUrl;
    else if (beyannameCheck.clearCurrent) data.beyannameUrl = null;
    if (pdfUrl) data.pdfUrl = pdfUrl;
    else if (tahakkukCheck.clearCurrent) data.pdfUrl = null;
    if (xmlUrl) data.xmlUrl = xmlUrl;

    const kayit = await (this.prisma as any).beyanKaydi.upsert({
      where: {
        tenantId_taxpayerId_beyanTipi_donem: {
          tenantId,
          taxpayerId: taxpayer.id,
          beyanTipi,
          donem,
        },
      },
      create: {
        tenantId,
        taxpayerId: taxpayer.id,
        beyanTipi,
        donem,
        tahakkukTutari: tahakkukTutari ?? null,
        odemeTutari: input.odemeTutari ?? null,
        onayNo,
        ...data,
      },
      update: data,
    });

    const durumUpdate: any = {
      durum: 'onaylandi',
      onayTarihi: parseDateOrNull(input.beyanTarihi) || new Date(),
    };
    if (tahakkukTutari != null) durumUpdate.tahakkukTutari = tahakkukTutari;

    await (this.prisma as any).beyanDurumu.upsert({
      where: {
        tenantId_taxpayerId_beyanTipi_donem: {
          tenantId,
          taxpayerId: taxpayer.id,
          beyanTipi,
          donem,
        },
      },
      create: {
        tenantId,
        taxpayerId: taxpayer.id,
          beyanTipi,
          donem,
          durum: 'onaylandi',
          onayTarihi: parseDateOrNull(input.beyanTarihi) || new Date(),
          tahakkukTutari,
          notlar: 'GIB agent tarafindan indirildi',
        },
        update: durumUpdate,
      }).catch(() => {});

    return kayit;
  }

  private async prepareIncomingDeclarationPdf(
    tenantId: string,
    jobId: string,
    input: AgentDeclarationInput,
    taxpayer: { id: string; taxNumber?: string | null },
    kind: 'beyanname' | 'tahakkuk',
    skipStorage: boolean,
  ): Promise<{ base64: string | null; clearCurrent: boolean; text?: string | null }> {
    if (skipStorage) return { base64: null, clearCurrent: false, text: null };

    const base64 = cleanBase64(kind === 'beyanname' ? input.beyannameBase64 : input.tahakkukBase64);
    if (!base64) return { base64: null, clearCurrent: false, text: null };

    const expectedTaxNo = this.normalizeTaxNoValue(taxpayer.taxNumber);
    if (!expectedTaxNo) return { base64, clearCurrent: false, text: null };

    const text = await this.pdfTextFromBase64(base64).catch((err) => {
      this.logger.warn(`${kind} PDF VKN kontrolu yapilamadi: ${err?.message || err}`);
      return '';
    });
    const compactDigits = text.replace(/\D/g, '');
    if (compactDigits.includes(expectedTaxNo)) return { base64, clearCurrent: false, text };

    // Beklenen VKN metinde gorunmedi. Eski tiklama/popup yolu zaman zaman BASKA mukellefin PDF'ini
    // yakaliyor (cross-taxpayer swap). Bu yuzden PDF icinde NET ve FARKLI bir VKN bulunursa belgeyi
    // yanlis kayda baglamak yerine, dogru sahibe tasi + bu kaydin URL'sini temizle (clearCurrent).
    // (Liste-API/Oid yolu duzeldiginde PDF'ler dogru iner, beklenen VKN metinde olur ve bu blok hic
    // tetiklenmez; bu nedenle koruma zararsiz ama swap'a karsi gerekli.)
    const seenTaxNos = this.extractTaxNumbers(text);
    let ownerTaxNo = seenTaxNos.find((taxNo) => taxNo !== expectedTaxNo) || null;
    let parsed: any = null;
    if (!ownerTaxNo) {
      parsed = await this.beyanKayitlari.parseBeyannamePdf(base64).catch((err) => {
        this.logger.warn(`${kind} PDF AI VKN kontrolu yapilamadi: ${err?.message || err}`);
        return null;
      });
      const parsedTaxNo = this.normalizeTaxNoValue(parsed?.vkn);
      if (parsedTaxNo === expectedTaxNo) return { base64, clearCurrent: false, text };
      ownerTaxNo = parsedTaxNo || null;
    }

    if (!ownerTaxNo) {
      this.logger.warn(`${kind} PDF icinde VKN/TCKN okunamadi; net farkli VKN bulunmadigi icin kayda baglanacak. Beklenen: ${expectedTaxNo}.`);
      return { base64, clearCurrent: false, text };
    }

    await this.storePortalDocumentFromAgent(tenantId, jobId, {
      taxpayerId: null,
      belgeTuru: kind === 'tahakkuk' ? 'GIB_TAHAKKUK' : 'GIB_BEYANNAME',
      title: kind === 'tahakkuk'
        ? input.tahakkukFileName || 'tahakkuk.pdf'
        : input.beyannameFileName || 'beyanname.pdf',
      period: input.donem,
      issuedAt: input.beyanTarihi || null,
      receivedAt: new Date().toISOString(),
      mimeType: 'application/pdf',
      originalName: kind === 'tahakkuk'
        ? input.tahakkukFileName || 'tahakkuk.pdf'
        : input.beyannameFileName || 'beyanname.pdf',
      base64,
      raw: {
        runner: 'portal-automation',
        source: 'declaration-owner-repair',
        ownerMismatch: true,
        expectedTaxNo,
        ownerTaxNo,
        originalTaxpayerId: taxpayer.id,
        originalRaw: input.raw || null,
      },
    }, 'EBEYANNAME_DAILY_DOWNLOAD').catch((err) => {
      this.logger.warn(`${kind} PDF dogru mukellefe tasinamadi: ${err?.message || err}`);
    });

    return { base64: null, clearCurrent: true, text };
  }

  private async storePortalDocumentFromAgent(
    tenantId: string,
    jobId: string,
    input: AgentDocumentInput,
    jobType: string,
  ) {
    let taxpayerId = input.taxpayerId || null;
    // Belgeye mukellef gelmemisse isin mukellefini kullan (e-Tebligat kayitlari job'a baglidir).
    if (!taxpayerId && jobId) {
      const ownerJob = await (this.prisma as any).portalAutomationJob.findFirst({ where: { id: jobId, tenantId }, select: { taxpayerId: true } });
      if (ownerJob?.taxpayerId) taxpayerId = ownerJob.taxpayerId;
    }
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

    const belgeTuruKey = String(input.belgeTuru || '').toLocaleUpperCase('tr-TR');
    const isBeyannameBelgesi =
      belgeTuruKey.includes('GIB_BEYANNAME') ||
      belgeTuruKey.includes('GİB_BEYANNAME') ||
      belgeTuruKey.includes('GIB_TAHAKKUK') ||
      belgeTuruKey.includes('GİB_TAHAKKUK');

    let documentId: string | null = null;
    if (taxpayerId && storageKey && sizeBytes != null) {
      const doc = await (this.prisma as any).document.create({
        data: {
          taxpayerId,
          title: input.title,
          category: isBeyannameBelgesi ? 'BEYANNAME' : 'EVRAK',
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

    // E-Tebligat + SGK (tahakkuk/hizmet) mukerrer engelle (belge no + belgeTuru benzersiz).
    // Varsa: eksik mukellefi / PDF'i geri doldur, kopya olusturma.
    const DEDUP_BELGE_TURU = ['E_TEBLIGAT', 'EARSIV_FATURA', 'SGK_TAHAKKUK', 'SGK_HIZMET_LISTESI'];
    if (DEDUP_BELGE_TURU.includes(String(input.belgeTuru)) && input.referenceNo) {
      const existing = await (this.prisma as any).portalDocument.findFirst({
        where: { tenantId, belgeTuru: String(input.belgeTuru), referenceNo: String(input.referenceNo) },
        select: { id: true, taxpayerId: true, storageKey: true, raw: true },
      });
      if (existing) {
        const patch: any = {};
        if (!existing.taxpayerId && taxpayerId) patch.taxpayerId = taxpayerId;
        if (!existing.storageKey && storageKey) {
          patch.storageKey = storageKey;
          patch.sizeBytes = sizeBytes;
          patch.mimeType = mimeType;
          if (documentId) patch.documentId = documentId;
        }
        // SGK meta backfill: PDF'ten meta işlendiyse mevcut raw'ı güncelle (eksik alanları/tutarı doldurur).
        const newRaw: any = input.raw || {};
        if (newRaw.metaVersion || newRaw.metaParsed || newRaw.kanunNo || newRaw.belgeMahiyeti || newRaw.tutar) {
          patch.raw = input.raw;
        }
        if (Object.keys(patch).length) {
          const updated = await (this.prisma as any).portalDocument.update({ where: { id: existing.id }, data: patch });
          await this.importEarsivPortalDocumentToAccounting(tenantId, jobId, input, jobType, storageKey, sizeBytes, mimeType)
            .catch((err) => this.logger.warn(`e-Arsiv Fatura Merkezi aktarimi yapilamadi: ${err?.message || err}`));
          return updated;
        }
        await this.importEarsivPortalDocumentToAccounting(tenantId, jobId, input, jobType, storageKey, sizeBytes, mimeType)
          .catch((err) => this.logger.warn(`e-Arsiv Fatura Merkezi aktarimi yapilamadi: ${err?.message || err}`));
        return existing;
      }
    }

    const created = await (this.prisma as any).portalDocument.create({
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
    await this.importEarsivPortalDocumentToAccounting(tenantId, jobId, input, jobType, storageKey, sizeBytes, mimeType)
      .catch((err) => this.logger.warn(`e-Arsiv Fatura Merkezi aktarimi yapilamadi: ${err?.message || err}`));
    return created;
  }

  private async importEarsivPortalDocumentToAccounting(
    tenantId: string,
    jobId: string,
    input: AgentDocumentInput,
    jobType: string,
    storageKey: string | null,
    sizeBytes: number | null,
    mimeType: string,
  ) {
    if (jobType !== 'EARSIV_PORTAL_FETCH') return null;
    if (String(input.belgeTuru || '') !== 'EARSIV_FATURA') return null;
    const taxpayerId = input.taxpayerId || (await (this.prisma as any).portalAutomationJob.findFirst({
      where: { id: jobId, tenantId },
      select: { taxpayerId: true },
    }).catch(() => null))?.taxpayerId;
    if (!taxpayerId || !storageKey) return null;

    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      select: { id: true, taxNumber: true, companyName: true, firstName: true, lastName: true },
    });
    if (!taxpayer) return null;

    const parsed = this.parseEarsivPortalAccounting(input);
    const sourceRefId = parsed.ettn || parsed.belgeNo || input.referenceNo;
    if (!sourceRefId) return null;
    const existing = await (this.prisma as any).invoiceAccountingDocument.findFirst({
      where: { tenantId, taxpayerId, source: 'gib-earsiv-api', sourceRefId },
      select: { id: true },
    });
    if (existing) return existing;

    const taxpayerName = String(taxpayer.companyName || [taxpayer.firstName, taxpayer.lastName].filter(Boolean).join(' ')).trim();
    const taxpayerVkn = String(tryDecrypt(taxpayer.taxNumber) || taxpayer.taxNumber || '').replace(/\D/g, '');
    const matrah = parsed.matrah ?? (parsed.total != null && parsed.kdvTutari != null ? this.roundMoney(parsed.total - parsed.kdvTutari) : null);
    const kdv = parsed.kdvTutari ?? (parsed.total != null && matrah != null ? this.roundMoney(parsed.total - matrah) : null);
    const total = parsed.total ?? (matrah != null && kdv != null ? this.roundMoney(matrah + kdv) : null);
    const status = total != null && matrah != null ? 'READY' : 'NEEDS_REVIEW';
    const lines = this.earsivAccountingLines({ matrah, kdv, total, rate: parsed.kdvOrani, customerName: parsed.customerName });

    return (this.prisma as any).invoiceAccountingDocument.create({
      data: {
        tenantId,
        taxpayerId,
        source: 'gib-earsiv-api',
        sourceRefId,
        documentType: 'E_ARSIV',
        invoiceKind: 'SATIS',
        status,
        originalName: input.originalName || `${parsed.belgeNo || sourceRefId}.json`,
        mimeType,
        sizeBytes: sizeBytes || 0,
        s3Key: storageKey,
        currency: parsed.currency || 'TL',
        belgeNo: parsed.belgeNo || input.referenceNo || null,
        faturaTarihi: parseDateOrNull(parsed.faturaTarihi || input.issuedAt) || null,
        sellerVkn: taxpayerVkn || null,
        buyerVkn: parsed.buyerVkn || null,
        vendorName: taxpayerName || null,
        customerName: parsed.customerName || null,
        totalAmount: total,
        ocrStatus: 'SUCCESS',
        ocrEngine: 'gib-earsiv-api',
        ocrConfidence: 1,
        ocrData: {
          provider: 'GIB_PORTAL',
          source: 'gib-earsiv-api',
          direction: 'SATIS',
          matrah,
          kdvTutari: kdv,
          kdvOrani: parsed.kdvOrani,
          ettn: parsed.ettn,
          portalReferenceNo: input.referenceNo || null,
        },
        createdBy: null,
        ...(lines.length ? { lines: { create: lines } } : {}),
      },
      include: { lines: { orderBy: { orderNo: 'asc' } } },
    });
  }

  private parseEarsivPortalAccounting(input: AgentDocumentInput) {
    const raw: any = input.raw && typeof input.raw === 'object' ? input.raw : {};
    const row: any = raw.row && typeof raw.row === 'object' ? raw.row : {};
    const json = this.tryParseJsonBase64(input.base64);
    const root = (json?.data && typeof json.data === 'object') ? json.data : (json && typeof json === 'object' ? json : {});
    const read = (keys: RegExp[]) => this.findEarsivValue(root, keys) || this.findEarsivValue(row, keys);
    const belgeNo = String(raw.belgeNumarasi || input.referenceNo || read([/^(belgeNumarasi|faturaNumarasi|faturaNo|belgeNo)$/i]) || '').trim();
    const ettn = String(raw.ettn || read([/^(ettn|uuid|faturaUuid|belgeUuid)$/i]) || '').trim();
    const buyerVkn = String(read([/^(vknTckn|aliciVkn|aliciVknTckn|aliciTckn|aliciVergiNo)$/i]) || '').replace(/\D/g, '');
    const customerName = String(read([/^(aliciUnvanAdSoyad|aliciUnvan|aliciAdiSoyadi|aliciAdSoyad|musteriUnvan|unvan)$/i]) || '').trim();
    const faturaTarihi = String(read([/^(belgeTarihi|faturaTarihi|duzenlemeTarihi|tarih)$/i]) || '').trim();
    const currency = String(read([/^(paraBirimi|dovizCinsi|currency)$/i]) || 'TL').trim() || 'TL';
    const total = this.parseEarsivMoney(read([/^(odenecekTutar|vergilerDahilToplamTutar|genelToplam|toplamTutar)$/i]));
    const matrah = this.parseEarsivMoney(read([/^(malHizmetToplamTutari|malHizmetToplamTutar|kdvMatrahi|matrah)$/i]));
    const kdvTutari = this.parseEarsivMoney(read([/^(hesaplananKdv|hesaplananKDV|kdvTutari|toplamKdv|vergiTutari)$/i]));
    const kdvOrani = String(read([/^(kdvOrani|kdvOran)$/i]) || '').replace(/[^\d.,]/g, '').replace(',', '.');
    return {
      belgeNo,
      ettn,
      buyerVkn: buyerVkn.length >= 10 ? buyerVkn : null,
      customerName: customerName || null,
      faturaTarihi: faturaTarihi || null,
      currency,
      total,
      matrah,
      kdvTutari,
      kdvOrani: kdvOrani || null,
    };
  }

  private tryParseJsonBase64(base64?: string | null) {
    const clean = cleanBase64(base64);
    if (!clean) return null;
    const text = Buffer.from(clean, 'base64').toString('utf8').trim();
    if (!text || !/^[\[{]/.test(text)) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private findEarsivValue(obj: any, keyPatterns: RegExp[], depth = 0): any {
    if (!obj || depth > 7) return null;
    if (typeof obj !== 'object') return null;
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = this.findEarsivValue(item, keyPatterns, depth + 1);
        if (found !== null && found !== undefined && String(found).trim() !== '') return found;
      }
      return null;
    }
    for (const [key, value] of Object.entries(obj)) {
      if (keyPatterns.some((re) => re.test(key)) && value !== null && value !== undefined && String(value).trim() !== '') {
        return value;
      }
    }
    for (const value of Object.values(obj)) {
      const found = this.findEarsivValue(value, keyPatterns, depth + 1);
      if (found !== null && found !== undefined && String(found).trim() !== '') return found;
    }
    return null;
  }

  private parseEarsivMoney(value: any): number | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return this.roundMoney(value);
    const raw = String(value).replace(/\s/g, '').replace(/[^\d,.-]/g, '');
    if (!raw) return null;
    const normalized = raw.includes(',')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw;
    const num = Number(normalized);
    return Number.isFinite(num) ? this.roundMoney(num) : null;
  }

  private roundMoney(value: number) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  private earsivAccountingLines(input: { matrah: number | null; kdv: number | null; total: number | null; rate?: string | null; customerName?: string | null }) {
    const lines: any[] = [];
    if (input.matrah != null) {
      lines.push({ group: 'matrah', description: 'Matrah (Gelir)', rate: input.rate || null, debit: 0, credit: input.matrah, orderNo: 1 });
    }
    if (input.kdv != null && Math.abs(input.kdv) > 0.004) {
      lines.push({ group: 'vergi', description: 'Hesaplanan KDV', rate: input.rate || null, debit: 0, credit: input.kdv, orderNo: 2 });
    }
    if (input.total != null) {
      lines.push({ group: 'cari', description: input.customerName || 'Cari Hesap', rate: null, debit: input.total, credit: 0, orderNo: 3 });
    }
    return lines;
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

    // PDF metni cogu GIB beyannamesinde okunamiyor (OCR kapali). O zaman runner'in GIB listesinden
    // KAZIDIGI VKN + tur + donem'e DUS (input.raw/period) -> beyan kaydi yine de olusur, gorunur olur.
    const parsed: any = await this.beyanKayitlari.parseBeyannamePdf(base64).catch(() => ({}));
    const rawMeta: any = (input.raw && typeof input.raw === 'object') ? input.raw : {};
    // ONEMLI: VKN/tip/donem'de HER ZAMAN GIB listesinden gelen SATIR verisini (rawMeta/period) oncele,
    // PDF parse'i DEGIL. Cunku beyanname PDF'i metin-okunabilir olunca parseBeyannamePdf cogu zaman
    // YANLIS bir numara (mali musavir VKN'si / fis no vb.) okuyup beyannameyi BASKA kayda yaziyordu;
    // tahakkuk PDF'i okunamayinca dogru satir-VKN'sine dusup gorunen kayda baglaniyordu. Bu yuzden
    // ayni mukellefte "tahakkuk var, beyanname yok" oluyordu. Satir verisi = kaydin eslestigi veri.
    const rowVkn = String(rawMeta.taxNumber || rawMeta.vkn || '').replace(/\D/g, '');
    const vkn = (rowVkn || String(parsed?.vkn || '').replace(/\D/g, '')) || null;
    const beyanTipi = rawMeta.beyanTipi || parsed?.beyanTipi || null;
    const donem = input.period || parsed?.donem || rawMeta.donem || null;
    const taxpayer = vkn ? await this.findTaxpayerByTaxNo(tenantId, vkn) : null;

    if (!taxpayer?.id || !beyanTipi || !donem) {
      this.logger.warn(`[EBLINK] beyan kaydi olusmadi: vkn=${vkn ? '...' + vkn.slice(-3) : 'YOK'} tip=${beyanTipi || '-'} donem=${donem || '-'} mukellef=${taxpayer?.id ? 'bulundu' : 'YOK'} (pdf=${parsed?.vkn ? 'okundu' : 'okunamadi'})`);
      return null;
    }

    const isTahakkuk = input.belgeTuru === 'GIB_TAHAKKUK' || /tahakkuk|fis|fiş/i.test(name);
    const tahakkukMeta: { tahakkukTutari?: number | null; onayNo?: string | null } = isTahakkuk
      ? await this.extractTahakkukMetaFromBase64(base64).catch((err) => {
          this.logger.warn(`Tahakkuk PDF meta okunamadi: ${err?.message || err}`);
          return {};
        })
      : {};
    const tahakkukTutari = isTahakkuk ? tahakkukMeta.tahakkukTutari ?? parsed.tahakkukTutari ?? null : null;
    const onayNo = tahakkukMeta.onayNo || parsed.onayNo || null;
    const parsedDate = parsed.beyanTarihi ? parseDateOrNull(parsed.beyanTarihi) : null;
    const rawNote = JSON.stringify({
      source: 'portal-automation-pdf-parse',
      fileName: name,
      parsed,
      tahakkukMeta,
      raw: input.raw || null,
    }).slice(0, 1000);

    const data: any = {
      kaynak: 'gib_agent',
      importBatchId: jobId,
      notlar: rawNote,
    };
    if (parsedDate) data.beyanTarihi = parsedDate;
    if (isTahakkuk && tahakkukTutari != null) data.tahakkukTutari = tahakkukTutari;
    if (onayNo) data.onayNo = onayNo;
    if (isTahakkuk) data.pdfUrl = storageKey;
    else data.beyannameUrl = storageKey;

    const kayit = await (this.prisma as any).beyanKaydi.upsert({
      where: {
        tenantId_taxpayerId_beyanTipi_donem: {
          tenantId,
          taxpayerId: taxpayer.id,
          beyanTipi,
          donem,
        },
      },
      create: {
        tenantId,
        taxpayerId: taxpayer.id,
        beyanTipi,
        donem,
        beyanTarihi: parsedDate,
        tahakkukTutari,
        onayNo,
        kaynak: 'gib_agent',
        importBatchId: jobId,
        notlar: rawNote,
        ...(isTahakkuk ? { pdfUrl: storageKey } : { beyannameUrl: storageKey }),
      },
      update: data,
    });

    const durumUpdate: any = {
      durum: 'onaylandi',
      onayTarihi: parsedDate || new Date(),
    };
    if (isTahakkuk && tahakkukTutari != null) durumUpdate.tahakkukTutari = tahakkukTutari;

    await (this.prisma as any).beyanDurumu.upsert({
      where: {
        tenantId_taxpayerId_beyanTipi_donem: {
          tenantId,
          taxpayerId: taxpayer.id,
          beyanTipi,
          donem,
        },
      },
      create: {
        tenantId,
        taxpayerId: taxpayer.id,
        beyanTipi,
        donem,
        durum: 'onaylandi',
        onayTarihi: parsedDate || new Date(),
        tahakkukTutari,
        notlar: 'GIB agent PDF parse ile indirildi',
      },
      update: {
        ...durumUpdate,
      },
    }).catch(() => {});

    return { taxpayerId: taxpayer.id, beyanKaydiId: kayit.id };
  }

  private normalizeTaxNoValue(value?: string | null): string {
    return String(tryDecrypt(value) || value || '').replace(/\D/g, '');
  }

  private extractTaxNumbers(text: string): string[] {
    return Array.from(new Set(
      Array.from(String(text || '').matchAll(/\b\d{10,11}\b/g))
        .map((m) => m[0])
        .filter((value) => value.length === 10 || value.length === 11),
    ));
  }

  private async findTaxpayerByTaxNo(tenantId: string, taxNo: string): Promise<{ id: string } | null> {
    const normalized = this.normalizeTaxNoValue(taxNo);
    if (!normalized) return null;
    const direct = await (this.prisma as any).taxpayer.findFirst({
      where: { tenantId, taxNumber: normalized },
      select: { id: true },
    });
    if (direct?.id) return direct;

    const taxpayers = await (this.prisma as any).taxpayer.findMany({
      where: { tenantId },
      select: { id: true, taxNumber: true },
      take: 5000,
    });
    return taxpayers.find((taxpayer: any) => this.normalizeTaxNoValue(taxpayer.taxNumber) === normalized) || null;
  }

  private async pdfTextFromBase64(base64: string) {
    const buffer = Buffer.from(base64, 'base64');
    const parser = new PDFParse({ data: buffer });
    let text = '';
    try {
      const result = await parser.getText();
      text = String(result?.text || '').replace(/\s+/g, ' ').trim();
    } finally {
      const destroy = (parser as any).destroy;
      if (typeof destroy === 'function') await destroy.call(parser).catch(() => {});
    }
    if (text.length >= 20 || !this.portalPdfOcrFallbackEnabled()) return text;
    const ocrText = await this.azureReadPdfText(buffer).catch((err) => {
      this.logger.warn(`Portal PDF OCR fallback hata: ${err?.message || err}`);
      return '';
    });
    return String(ocrText || '').replace(/\s+/g, ' ').trim() || text;
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

  private async extractTahakkukMetaFromBase64(base64Input: string | null | undefined): Promise<{ tahakkukTutari?: number | null; onayNo?: string | null }> {
    const base64 = cleanBase64(base64Input);
    if (!base64) return {};
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length < 200) return {};

    const text = await this.pdfTextFromBase64(base64);
    return {
      tahakkukTutari: this.extractTahakkukAmount(text),
      onayNo: this.extractTahakkukOnayNo(text),
    };
  }

  private extractTahakkukAmount(text: string): number | null {
    const compact = String(text || '').replace(/\s+/g, ' ');
    const preferredLabels = [
      /terkin\s+sonrasi\s+kalan\s+vergi\s+tutari/i,
      /tahakkuk\s+eden\s+(?:vergi\s+)?tutar/i,
      /tahakkuk\s+tutar[ıi]/i,
      /tahakkuk\s+fi[şs]i\s+tutar[ıi]/i,
      /odenecek\s+(?:vergi\s+)?tutar/i,
      /ödenecek\s+(?:vergi\s+)?tutar/i,
      /odenmesi\s+gereken\s+(?:vergi\s+)?tutar/i,
      /ödenmesi\s+gereken\s+(?:vergi\s+)?tutar/i,
      /toplam\s+tahakkuk/i,
      /toplam\s+vergi/i,
    ];
    for (const label of preferredLabels) {
      const match = compact.match(new RegExp(`${label.source}.{0,180}`, 'i'));
      const amount = match ? this.lastTurkishMoney(match[0]) : null;
      if (amount != null) return amount;
    }

    const lines = String(text || '').split(/\r?\n| {2,}/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (!/tahakkuk|odenecek|ödenecek|terkin|kalan vergi|toplam/i.test(line)) continue;
      const amount = this.lastTurkishMoney(line);
      if (amount != null) return amount;
    }
    return null;
  }

  private portalPdfOcrFallbackEnabled() {
    const raw = process.env.PORTAL_AUTOMATION_EBEYANNAME_PDF_OCR_FALLBACK;
    if (raw != null) return this.envFlag(raw);
    return !!(process.env.AZURE_VISION_KEY && process.env.AZURE_VISION_ENDPOINT);
  }

  private async azureReadPdfText(buffer: Buffer): Promise<string> {
    const key = process.env.AZURE_VISION_KEY;
    const endpoint = String(process.env.AZURE_VISION_ENDPOINT || '').replace(/\/+$/, '');
    if (!key || !endpoint) return '';

    const analyze = await fetch(`${endpoint}/vision/v3.2/read/analyze`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/pdf',
      },
      body: buffer as any,
    });
    if (!analyze.ok) throw new Error(`Azure Read ${analyze.status}: ${(await analyze.text()).slice(0, 120)}`);
    const operationLocation = analyze.headers.get('operation-location');
    if (!operationLocation) throw new Error('Azure operation-location yok');

    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const poll = await fetch(operationLocation, {
        headers: { 'Ocp-Apim-Subscription-Key': key },
      });
      if (!poll.ok) throw new Error(`Azure poll ${poll.status}`);
      const json: any = await poll.json();
      const status = String(json?.status || '').toLowerCase();
      if (status === 'succeeded') {
        const lines: string[] = [];
        for (const pageResult of json?.analyzeResult?.readResults || []) {
          for (const line of pageResult?.lines || []) {
            if (line?.text) lines.push(String(line.text));
          }
        }
        return lines.join('\n');
      }
      if (status === 'failed') throw new Error('Azure Read failed');
    }
    throw new Error('Azure Read timeout');
  }

  private extractTahakkukOnayNo(text: string): string | null {
    const compact = String(text || '').replace(/\s+/g, ' ');
    const match = compact.match(/(?:onay|tahakkuk|fis|fiş)\s*(?:no|numarasi|numarası)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9./-]{5,})/i);
    return match?.[1]?.slice(0, 80) || null;
  }

  private lastTurkishMoney(text: string): number | null {
    const matches = Array.from(String(text || '').matchAll(/\b\d{1,3}(?:\.\d{3})*,\d{2}\b|\b\d{4,},\d{2}\b|\b\d{1,3},\d{2}\b/g)).map((m) => m[0]);
    for (const raw of matches.reverse()) {
      const normalized = raw.replace(/\./g, '').replace(',', '.');
      const value = Number(normalized);
      if (Number.isFinite(value)) return Math.round(value * 100) / 100;
    }
    return null;
  }

  private isCorrectionDeclarationInput(input: AgentDeclarationInput) {
    const text = [
      input.raw?.isCorrection ? 'DUZELTME' : '',
      input.raw?.mahiyet,
      input.raw?.rowText,
      Array.isArray(input.raw?.cells) ? input.raw.cells.join(' ') : '',
    ].filter(Boolean).join(' ');
    return /\bDUZELTME\b/.test(normalizeTextKey(text));
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
        return 'Mali musavir e-Beyanname kullanici kodu ve sifresi ile onceki gun verilen beyannameleri, tahakkuklari ve varsa XML dosyalarini indir; BeyanKaydi olarak teslim et.';
      case 'E_TEBLIGAT_CHECK':
        return 'Mukellefin vergi dairesi kullanici kodu ve sifresi ile e-Tebligat kutusunu kontrol et; yeni tebligat varsa PDF ve metadata olarak teslim et.';
      case 'EARSIV_PORTAL_FETCH':
        return 'Mukellefin vergi dairesi kullanici kodu ve sifresi ile GIB e-Arsiv portalina gir; secili donemde kestigi e-Arsiv satis faturalarini indir ve Fatura Merkezi is akisi icin teslim et.';
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

    // === IN-APP BILDIRIM: Portal sifresi hatasi ===
    // Sadece kimlik-bilgisi hatasi gibi gorunenler icin (timeout/network degil)
    const looksLikeCredentialIssue = this.classifyCredentialError(errorMessage);
    if (!looksLikeCredentialIssue) return;

    // Taxpayer-owned credential icin mukellef adini cek
    let scopeLabel = meta.provider.replace(/_/g, ' ');
    if (meta.ownerType === 'TAXPAYER' && job.taxpayerId) {
      const tp = await (this.prisma as any).taxpayer.findFirst({
        where: { id: job.taxpayerId, tenantId: job.tenantId },
        select: { companyName: true, firstName: true, lastName: true },
      }).catch(() => null);
      if (tp) {
        const name = tp.companyName || [tp.firstName, tp.lastName].filter(Boolean).join(' ');
        if (name) scopeLabel = `${scopeLabel} — ${name}`;
      }
    }

    await this.notifications.createForTenant({
      tenantId: job.tenantId,
      type: NOTIFICATION_TYPES.PORTAL_CREDENTIAL_FAIL,
      title: `🔑 Portal şifre hatası: ${scopeLabel}`,
      body: `${meta.label} işlemi sırasında giriş yapılamadı. Lütfen ayarlardan parolayı güncelleyin. (${errorMessage.slice(0, 200)})`,
      metadata: {
        provider: meta.provider,
        ownerType: meta.ownerType,
        ownerId,
        jobId: job.id,
        jobType: job.jobType,
        link: '/panel/ayarlar/entegrasyonlar',
      },
      dedupeKey: `portal-cred-fail:${meta.provider}:${ownerId}`,
      dedupeWindowMin: 60 * 12, // 12 saat — ayni gun icinde tekrar etmesin
    }).catch((e) => {
      this.logger.warn(`PORTAL_CREDENTIAL_FAIL notif failed: ${(e as Error).message}`);
    });
  }

  /** Hata mesaji credential/parola/login hatasi gibi mi? */
  private classifyCredentialError(message: string): boolean {
    if (!message) return false;
    const m = message.toLowerCase();
    const triggers = [
      'sifre', 'şifre', 'parola', 'password', 'login fail', 'kullan', 'invalid credential',
      'unauthorized', 'authentication', 'auth failed', 'gecersiz', 'geçersiz', 'kimlik',
      '401', 'forbidden', '403', 'oturum',
    ];
    return triggers.some((t) => m.includes(t));
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
    return resolveAgentTenant(token, this.prisma as any);
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
