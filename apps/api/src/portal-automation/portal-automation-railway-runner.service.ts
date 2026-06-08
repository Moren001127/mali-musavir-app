import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { chromium as pwChromium } from 'playwright-core';
import { PDFParse } from 'pdf-parse';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PortalAutomationService, PortalJobType } from './portal-automation.service';
import { tryDecrypt } from '../common/crypto';

type RunnerCredential = {
  provider: string;
  username?: string | null;
  userCode?: string | null;
  officeCode?: string | null;
  workplaceCode?: string | null;
  password?: string | null;
  secondaryPassword?: string | null;
};

type RunnerJobBundle = {
  job: any;
  taxpayer?: any;
  credential: RunnerCredential;
};

type TaxpayerMatch = {
  id: string;
  taxNumber: string | null;
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
};

type EBeyannameStatus = 'hatali' | 'beklemede' | 'onaylandi';

type EBeyannameResultRow = {
  rowIndex: number;
  cells: string[];
  rowText: string;
  beyanTipiRaw: string | null;
  mahiyetText: string | null;
  isCorrection: boolean;
  taxNumber: string | null;
  taxpayerName: string | null;
  taxOffice: string | null;
  taxPeriod: string | null;
  uploadTime: string | null;
  statusText: string | null;
};

type EBeyannameFilePayload = {
  base64: string;
  fileName: string;
  mimeType: string;
};

type EBeyannameFileDownloadResult = {
  file: EBeyannameFilePayload | null;
  ownerMismatch: boolean;
};

type EBeyannameCapturedResponse = {
  url: string;
  headers: Record<string, string>;
  buffer: Buffer;
  mimeType: string;
};

type EBeyannameRowIdentity = {
  taxpayerId: string;
  beyanTipi: string;
  donem: string;
  isCorrection: boolean;
};

// Hattat yontemi (liste-API): ARSIVBEYANNAMELISTESI yanitindan cikarilan, indirilebilir
// (beyannameOid iceren) tek satir. row = mevcut esleme/kayit altyapisini beslemek icin.
type EBeyannameListEntry = {
  row: EBeyannameResultRow;
  beyannameOid: string;
  tahakkukOid: string | null;
};

// GIB 2026'da e-Beyanname'yi Dijital Vergi Dairesi portali altinda topladi.
// Eski URL (ebeyanname.gib.gov.tr/giris.html) artik ana sayfaya redirect ediyor.
const DEFAULT_EBEYANNAME_LOGIN_URL = 'https://dijital.gib.gov.tr/portal/login';
const DEFAULT_GIB_IVD_LOGIN_URL = 'https://dijital.gib.gov.tr/portal/login';
const DEFAULT_SGK_LOGIN_URL = 'https://uyg.sgk.gov.tr/IsverenSistemi';

const JOB_TYPES_DEFAULT: PortalJobType[] = [
  'EBEYANNAME_DAILY_DOWNLOAD',
  'E_TEBLIGAT_CHECK',
  'SGK_HIZMET_LISTESI',
  'SGK_TAHAKKUK',
  'SGK_ISE_GIRIS_CIKIS',
  'SGK_ISGOREMEZLIK',
];

const TEXT = {
  captcha: /captcha|dogrulama|doğrulama|guvenlik kodu|güvenlik kodu|security code/i,
  loginError: /hatali|hatalı|yanlis|yanlış|gecersiz|geçersiz|blok|kilit|basarisiz|başarısız/i,
  download: /indir|beyanname|tahakkuk|xml|pdf|onay|f[iı]s/i,
};

@Injectable()
export class PortalAutomationRailwayRunnerService implements OnModuleInit {
  private readonly logger = new Logger(PortalAutomationRailwayRunnerService.name);
  private readonly deviceId = process.env.PORTAL_AUTOMATION_RAILWAY_DEVICE_ID || 'railway-portal-runner';
  private busy = false;
  private ebeyannameJsDebugLogged = false;
  private ebeyannameListApiProbeLogged = false;
  // GIB sayfasinin kendi yaptigi (calisan) ARSIVBEYANNAMELISTESI istegi — sayfalama icin temel alinir.
  private ebeyannameCapturedListReq: { url: string; method: string; postData: string | null } | null = null;
  // GIB iki PDF goruntuleme arasinda EN AZ ~1 sn ister. Tum IMAJ/PDF cekimleri arasinda global gecit;
  // cok hizli gidersen GIB 354 "1 sn bekleyin" HTML'i ya da 500 doner ve belge inmez.
  private ebeyannameLastImajAt = 0;

  constructor(
    private prisma: PrismaService,
    private portalAutomation: PortalAutomationService,
  ) {}

  onModuleInit() {
    if (!this.isEnabled()) return;
    this.logger.log(
      `[PortalRailwayRunner] aktif: kind=${this.runnerKind()}, device=${this.deviceId}, jobs=${this.enabledJobTypes().join(',')}, nightly=${this.includeNightly()}`,
    );
    this.cancelInterruptedEBeyannameJobsOnBoot().catch((err) => {
      this.logger.warn(`boot e-Beyanname iptal temizligi hata: ${err?.message || err}`);
    });
    this.requeueInterruptedEBeyannameJobsOnBoot().catch((err) => {
      this.logger.warn(`boot e-Beyanname requeue temizligi hata: ${err?.message || err}`);
    });
    setTimeout(() => this.tick().catch((err) => this.logger.warn(`ilk tick hata: ${err?.message || err}`)), 10_000).unref();
  }

  @Cron(CronExpression.EVERY_MINUTE, { timeZone: 'Europe/Istanbul' })
  async tick() {
    if (!this.isEnabled()) return;
    if (this.busy) return;
    this.busy = true;
    try {
      await this.failStaleRunnerJobs();
      const jobs = await this.pickPendingJobs();
      for (const job of jobs) {
        await this.runOne(job).catch((err) => {
          this.logger.warn(`[PortalRailwayRunner] job ${job.id} beklenmeyen hata: ${err?.message || err}`);
        });
      }
    } finally {
      this.busy = false;
    }
  }

  private isEnabled() {
    const raw = process.env.PORTAL_AUTOMATION_RAILWAY_RUNNER_ENABLED;
    if (raw != null) return this.envFlag(raw);
    return process.env.NODE_ENV !== 'test';
  }

  private includeNightly() {
    const raw = process.env.PORTAL_AUTOMATION_RAILWAY_RUNNER_INCLUDE_NIGHTLY;
    if (raw != null) return this.envFlag(raw);
    return this.isEnabled();
  }

  private envFlag(value?: string | null) {
    return ['1', 'true', 'yes', 'on', 'evet'].includes(String(value || '').trim().toLowerCase());
  }

  private enabledJobTypes(): PortalJobType[] {
    const raw = process.env.PORTAL_AUTOMATION_RAILWAY_RUNNER_JOB_TYPES;
    if (!raw) return JOB_TYPES_DEFAULT;
    const allowed = new Set<PortalJobType>([
      'EBEYANNAME_DAILY_DOWNLOAD',
      'E_TEBLIGAT_CHECK',
      'SGK_HIZMET_LISTESI',
      'SGK_TAHAKKUK',
      'SGK_ISE_GIRIS_CIKIS',
      'SGK_ISGOREMEZLIK',
    ]);
    const parsed = raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s): s is PortalJobType => allowed.has(s as PortalJobType));
    return parsed.length ? parsed : JOB_TYPES_DEFAULT;
  }

  private browserHeadless() {
    const raw = process.env.PORTAL_AUTOMATION_BROWSER_HEADLESS;
    if (raw != null) return this.envFlag(raw);
    return true;
  }

  private ebeyannameBrowserUserDataDir() {
    const raw = process.env.PORTAL_AUTOMATION_EBEYANNAME_BROWSER_USER_DATA_DIR
      || process.env.PORTAL_AUTOMATION_BROWSER_USER_DATA_DIR;
    const dir = String(raw || '').trim();
    return dir || null;
  }

  private browserLaunchArgs() {
    return [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ];
  }

  private async applyBrowserStealth(context: any) {
    await context.addInitScript(() => {
      try {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      } catch {
        // Best-effort only.
      }
    }).catch(() => {});
  }

  private maxJobsPerTick() {
    return Math.max(1, Math.min(5, Number(process.env.PORTAL_AUTOMATION_RAILWAY_RUNNER_BATCH || 1)));
  }

  wake(reason = 'manual') {
    if (!this.isEnabled()) return false;
    setTimeout(() => {
      this.tick().catch((err) => this.logger.warn(`wake(${reason}) hata: ${err?.message || err}`));
    }, 250).unref();
    return true;
  }

  private async pickPendingJobs() {
    const where: any = {
      status: 'pending',
      jobType: { in: this.enabledJobTypes() },
    };
    if (!this.includeNightly()) where.source = 'manual';
    const jobs = await (this.prisma as any).portalAutomationJob.findMany({
      where,
      include: { taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true } } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: this.maxJobsPerTick() * 5,
    });
    return jobs.filter((job: any) => this.shouldRailwayHandleJob(job)).slice(0, this.maxJobsPerTick());
  }

  private async cancelInterruptedEBeyannameJobsOnBoot() {
    if (!this.localFirstEBeyannameEnabled()) return;
    if (this.isLocalRunner()) return;
    const result = await (this.prisma as any).portalAutomationJob.updateMany({
      where: {
        jobType: 'EBEYANNAME_DAILY_DOWNLOAD',
        status: 'running',
        OR: [
          { targetDeviceId: this.deviceId },
          { targetDeviceId: { startsWith: 'railway' } },
          { targetDeviceId: null },
        ],
      },
      data: {
        status: 'cancelled',
        errorMessage: 'Sunucu e-Beyanname isi yerel ajana gecis icin iptal edildi',
        finishedAt: new Date(),
      },
    });
    if (result?.count) {
      this.logger.warn(`[PortalRailwayRunner] ${result.count} aktif e-Beyanname isi yerel ajana gecis icin iptal edildi.`);
    }
  }

  private async requeueInterruptedEBeyannameJobsOnBoot() {
    if (this.localFirstEBeyannameEnabled()) return;
    if (this.isLocalRunner()) return;
    const raw = process.env.PORTAL_AUTOMATION_EBEYANNAME_REQUEUE_INTERRUPTED_ON_BOOT;
    if (raw != null && !this.envFlag(raw)) return;
    const cutoffMs = Math.max(60_000, Math.min(15 * 60_000, Number(process.env.PORTAL_AUTOMATION_EBEYANNAME_REQUEUE_BOOT_AFTER_MS || 120_000)));
    const cutoff = new Date(Date.now() - cutoffMs);
    const result = await (this.prisma as any).portalAutomationJob.updateMany({
      where: {
        jobType: 'EBEYANNAME_DAILY_DOWNLOAD',
        status: 'running',
        updatedAt: { lt: cutoff },
        OR: [
          { targetDeviceId: this.deviceId },
          { targetDeviceId: { startsWith: 'railway' } },
          { targetDeviceId: null },
        ],
      },
      data: {
        status: 'pending',
        targetDeviceId: null,
        errorMessage: 'Sunucu yeniden basladi; e-Beyanname isi tekrar kuyruga alindi',
      },
    });
    if (result?.count) {
      this.logger.warn(`[PortalRailwayRunner] ${result.count} kesilmis e-Beyanname isi tekrar kuyruga alindi.`);
    }
  }

  private localFirstEBeyannameEnabled() {
    const raw = String(process.env.PORTAL_AUTOMATION_EBEYANNAME_RUNNER_MODE || '').trim().toLowerCase();
    return ['local', 'local_only', 'local-only', 'local_first_with_server_fallback', 'server_fallback', 'fallback'].includes(raw);
  }

  private runnerKind() {
    const raw = String(process.env.PORTAL_AUTOMATION_RUNNER_KIND || '').trim().toLowerCase();
    if (['local', 'office', 'office_pc', 'office-pc'].includes(raw)) return 'local';
    return 'server';
  }

  private isLocalRunner() {
    return this.runnerKind() === 'local';
  }

  private shouldRailwayHandleJob(job: any) {
    if (job?.jobType !== 'EBEYANNAME_DAILY_DOWNLOAD') return true;
    const mode = String(job?.payload?.runnerMode || '').toLowerCase();
    if (this.isLocalRunner()) {
      if (mode === 'local_first' || mode === 'local_first_with_server_fallback') return true;
      return this.envFlag(process.env.PORTAL_AUTOMATION_LOCAL_RUNNER_ACCEPT_SERVER_JOBS || '');
    }
    if (!mode || mode === 'server') return true;
    if (mode === 'local_first') return false;
    if (mode === 'local_first_with_server_fallback') {
      if (!this.eBeyannameServerFallbackEnabled()) return false;
      const minutes = Math.max(10, Number(process.env.PORTAL_AUTOMATION_EBEYANNAME_SERVER_FALLBACK_AFTER_MIN || 120));
      const createdAt = new Date(job.createdAt || Date.now()).getTime();
      return Date.now() - createdAt >= minutes * 60 * 1000;
    }
    return false;
  }

  private eBeyannameServerFallbackEnabled() {
    return this.envFlag(process.env.PORTAL_AUTOMATION_EBEYANNAME_SERVER_FALLBACK_ENABLED || '');
  }

  private async failStaleRunnerJobs() {
    const minutes = Math.max(10, Number(process.env.PORTAL_AUTOMATION_RAILWAY_RUNNER_TIMEOUT_MIN || 45));
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    await (this.prisma as any).portalAutomationJob.updateMany({
      where: {
        status: 'running',
        targetDeviceId: this.deviceId,
        updatedAt: { lt: cutoff },
      },
      data: {
        status: 'failed',
        errorMessage: `Railway runner hareketsizlik zaman asimi (${minutes} dk)`,
        finishedAt: new Date(),
      },
    });
  }

  private async runOne(job: any) {
    this.logger.log(`[PortalRailwayRunner] job aliniyor: ${job.id} ${job.jobType}`);
    await this.portalAutomation.markRunning(job.tenantId, job.id, this.deviceId);
    try {
      const bundle = await this.portalAutomation.getCredentialForJob(job.tenantId, job.id) as RunnerJobBundle;
      if (job.jobType === 'EBEYANNAME_DAILY_DOWNLOAD') {
        const result = await this.runEBeyanname(job.tenantId, bundle);
        await this.portalAutomation.completeJob(job.tenantId, job.id, result);
        this.logger.log(`[PortalRailwayRunner] job tamam: ${job.id} count=${result.recordCount || 0}`);
        return;
      }
      if (job.jobType === 'E_TEBLIGAT_CHECK' || job.jobType.startsWith('SGK_')) {
        const result = await this.runPortalDocumentJob(job.tenantId, bundle);
        await this.portalAutomation.completeJob(job.tenantId, job.id, result);
        this.logger.log(`[PortalRailwayRunner] job tamam: ${job.id} count=${result.recordCount || 0}`);
        return;
      }
      throw new Error(`${job.jobType} icin Railway runner tanimli degil`);
    } catch (err: any) {
      const message = this.publicError(err);
      await this.portalAutomation.markFailed(job.tenantId, job.id, message).catch(() => {});
      this.logger.warn(`[PortalRailwayRunner] job fail: ${job.id} ${message}`);
    }
  }

  private async jobProgress(tenantId: string, job: any, step: string, message: string, extra: Record<string, any> = {}) {
    this.logger.log(`[PortalRailwayRunner] ${job?.id || '-'} ${step}: ${message}`);
    await this.portalAutomation.updateJobProgress(tenantId, job.id, { step, message, ...extra }).catch(() => {});
  }

  private async runEBeyanname(tenantId: string, bundle: RunnerJobBundle) {
    const credential = bundle.credential;
    await this.jobProgress(tenantId, bundle.job, 'credential', 'e-Beyanname sifresi kontrol ediliyor.');
    // YENI GIB UI'sinda (2026 Dijital Vergi Dairesi) eski "Parola" alani kaldirildi.
    // GIB'in "Sifre" alani portaldaki "Sifre" (=secondaryPassword) degeriyle doldurulur.
    // Eski portal "Parola" (=password) alani artik kullanilmiyor.
    const ebeyannameSifre = credential.secondaryPassword || credential.password;
    if (!credential.userCode || !ebeyannameSifre) {
      throw new Error('Mali musavir e-Beyanname kullanici kodu ve sifre eksik');
    }

    const loginUrl = process.env.PORTAL_AUTOMATION_EBEYANNAME_LOGIN_URL || DEFAULT_EBEYANNAME_LOGIN_URL;
    const downloadsPath = join(tmpdir(), `moren-ebeyanname-${randomUUID()}`);
    await mkdir(downloadsPath, { recursive: true });
    await this.jobProgress(tenantId, bundle.job, 'browser', 'Sunucu tarayicisi baslatiliyor.');

    let browser: any = null;
    let context: any = null;
    try {
      const contextOptions = {
        acceptDownloads: true,
        viewport: { width: 1440, height: 950 },
        locale: 'tr-TR',
        timezoneId: 'Europe/Istanbul',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      };
      const persistentDir = this.ebeyannameBrowserUserDataDir();
      if (persistentDir) {
        await mkdir(persistentDir, { recursive: true });
        context = await pwChromium.launchPersistentContext(persistentDir, {
          ...contextOptions,
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROMIUM_PATH,
          headless: this.browserHeadless(),
          downloadsPath,
          args: this.browserLaunchArgs(),
        });
      } else {
        browser = await pwChromium.launch({
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROMIUM_PATH,
          headless: this.browserHeadless(),
          downloadsPath,
          args: this.browserLaunchArgs(),
        });
        context = await browser.newContext(contextOptions);
      }
      await this.applyBrowserStealth(context);
      const page = context.pages?.()[0] || await context.newPage();
      page.setDefaultTimeout(15_000);

      // 2captcha bazen GIB CAPTCHA'sini yanlis cozer (~%5-10 oran).
      // 3 deneme + her denemede temiz login sayfasi ile stale/error page riskini dusuruyoruz.
      const MAX_LOGIN_ATTEMPTS = Math.max(
        3,
        Math.min(8, Number(process.env.PORTAL_AUTOMATION_EBEYANNAME_LOGIN_ATTEMPTS || 5)),
      );
      for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS; attempt++) {
        try {
          await this.jobProgress(tenantId, bundle.job, 'login', `GIB login denemesi ${attempt}/${MAX_LOGIN_ATTEMPTS}: sayfa aciliyor.`, {
            current: attempt,
            total: MAX_LOGIN_ATTEMPTS,
          });
          this.logger.log('[eBeyanname] Login denemesi #' + attempt + ': GIB login sayfasi aciliyor');
          await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
          await this.waitForEBeyannameLoginForm(page);
          await this.jobProgress(tenantId, bundle.job, 'login', `GIB login denemesi ${attempt}/${MAX_LOGIN_ATTEMPTS}: bilgiler ve CAPTCHA dolduruluyor.`, {
            current: attempt,
            total: MAX_LOGIN_ATTEMPTS,
          });
          await this.fillEBeyannameLogin(page, credential.userCode, ebeyannameSifre);
          await this.fillEBeyannameCaptcha(page);
          await this.submitLogin(page);
          await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});
          await page.waitForTimeout(2000);
          await this.assertLoggedIn(page);
          await this.jobProgress(tenantId, bundle.job, 'login', 'Dijital Vergi Dairesi girisi basarili.');
          if (attempt > 1) {
            this.logger.log('[eBeyanname] Login denemesi #' + attempt + ' BASARILI');
          }
          break;
        } catch (loginErr: any) {
          const msg = String(loginErr?.message || loginErr).slice(0, 200);
          await this.jobProgress(tenantId, bundle.job, 'login_retry', `Login denemesi basarisiz, tekrar denenecek: ${msg}`, {
            current: attempt,
            total: MAX_LOGIN_ATTEMPTS,
          });
          this.logger.warn('[eBeyanname] Login denemesi #' + attempt + '/' + MAX_LOGIN_ATTEMPTS + ' basarisiz: ' + msg);
          if (attempt === MAX_LOGIN_ATTEMPTS) {
            throw new Error('e-Beyanname login ' + MAX_LOGIN_ATTEMPTS + ' denemede basarisiz. Son hata: ' + msg);
          }
        }
      }

      await this.jobProgress(tenantId, bundle.job, 'open_app', 'e-Beyanname uygulamasi aciliyor.');
      const eBeyannamePage = await this.openEBeyannameApplication(context, page);
      await this.jobProgress(tenantId, bundle.job, 'search_form', 'Beyanname Ara ekrani hazirlaniyor.');
      const collection = await this.collectEBeyannameDownloads(tenantId, eBeyannamePage, bundle.job, downloadsPath);
      await this.jobProgress(tenantId, bundle.job, 'logout', 'GIB sekmeleri kapatiliyor ve guvenli cikis yapiliyor.');
      await this.safeLogoutFromDigitalTaxOffice(context, page, eBeyannamePage, collection.notes).catch((err) => {
        collection.notes.push(`GIB guvenli cikis tamamlanamadi: ${this.compact(err?.message || err)}`);
      });
      await context.close().catch(() => {});
      context = null;

      return {
        declarations: collection.declarations,
        documents: collection.documents,
        recordCount: collection.persistedCount + collection.declarations.length + collection.documents.length,
        result: {
          runner: 'railway',
          phase: collection.phase,
          url: this.safeUrl(eBeyannamePage.url()),
          persistedCount: collection.persistedCount,
          declarations: collection.declarations.length,
          documents: collection.documents.length,
          notes: collection.notes,
        },
      };
    } finally {
      await context?.close?.().catch(() => {});
      await browser?.close?.().catch(() => {});
      await rm(downloadsPath, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async runPortalDocumentJob(tenantId: string, bundle: RunnerJobBundle) {
    const jobType = bundle.job.jobType as PortalJobType;
    const credential = bundle.credential;
    const isSgk = jobType.startsWith('SGK_');

    if (isSgk) {
      if (!(credential.username || credential.userCode) || !credential.workplaceCode || !credential.password || !credential.secondaryPassword) {
        throw new Error('SGK kullanici adi, e-kod, sistem sifresi ve isyeri sifresi eksik');
      }
    } else if (!credential.userCode || !credential.password || !credential.secondaryPassword) {
      throw new Error('Vergi dairesi kullanici kodu, parola ve sifre eksik');
    }

    const loginUrl = this.loginUrlForJob(jobType);
    const downloadsPath = join(tmpdir(), `moren-portal-doc-${randomUUID()}`);
    await mkdir(downloadsPath, { recursive: true });

    const browser = await pwChromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROMIUM_PATH,
      headless: this.browserHeadless(),
      downloadsPath,
      args: this.browserLaunchArgs(),
    });

    try {
      const context = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1440, height: 950 },
        locale: 'tr-TR',
        timezoneId: 'Europe/Istanbul',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });
      await this.applyBrowserStealth(context);
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);

      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await this.fillGenericPortalLogin(page, this.loginValuesForJob(jobType, credential));
      await this.submitLogin(page);
      await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await this.assertLoggedIn(page);

      const notes: string[] = [`${jobType} girisi basarili`];
      const targetUrl = this.targetUrlForJob(jobType);
      if (targetUrl) {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page.waitForTimeout(1000);
        notes.push('Hedef URL env ile acildi');
      } else {
        const navigated = await this.tryNavigateByTexts(page, this.navigationTextsForJob(jobType));
        notes.push(navigated ? 'Hedef ekran metinle acildi' : 'Hedef ekran otomatik bulunamadi; mevcut ekranda indirilebilir belge arandi');
      }

      await this.fillDateRangeIfPossible(page, bundle.job.periodStart, bundle.job.periodEnd)
        .catch((err) => notes.push(`Tarih doldurma atlandi: ${err?.message || err}`));
      await this.clickSearchIfPossible(page)
        .catch((err) => notes.push(`Sorgu butonu atlandi: ${err?.message || err}`));

      const collection = await this.clickAndCollectPortalDocuments(page, downloadsPath, bundle.job, jobType);
      notes.push(...collection.notes);
      await context.close().catch(() => {});

      return {
        documents: collection.documents,
        recordCount: collection.documents.length,
        result: {
          runner: 'railway',
          phase: 'document_collection',
          jobType,
          url: this.safeUrl(page.url()),
          documents: collection.documents.length,
          notes,
        },
      };
    } finally {
      await browser.close().catch(() => {});
      await rm(downloadsPath, { recursive: true, force: true }).catch(() => {});
    }
  }

  private loginUrlForJob(jobType: PortalJobType) {
    if (jobType === 'E_TEBLIGAT_CHECK') {
      return process.env.PORTAL_AUTOMATION_GIB_IVD_LOGIN_URL || DEFAULT_GIB_IVD_LOGIN_URL;
    }
    if (jobType.startsWith('SGK_')) {
      return process.env.PORTAL_AUTOMATION_SGK_LOGIN_URL || DEFAULT_SGK_LOGIN_URL;
    }
    return process.env.PORTAL_AUTOMATION_EBEYANNAME_LOGIN_URL || DEFAULT_EBEYANNAME_LOGIN_URL;
  }

  private targetUrlForJob(jobType: PortalJobType) {
    const envKey = ({
      E_TEBLIGAT_CHECK: 'PORTAL_AUTOMATION_ETEBLIGAT_LIST_URL',
      SGK_HIZMET_LISTESI: 'PORTAL_AUTOMATION_SGK_HIZMET_LISTESI_URL',
      SGK_TAHAKKUK: 'PORTAL_AUTOMATION_SGK_TAHAKKUK_URL',
      SGK_ISE_GIRIS_CIKIS: 'PORTAL_AUTOMATION_SGK_ISE_GIRIS_CIKIS_URL',
      SGK_ISGOREMEZLIK: 'PORTAL_AUTOMATION_SGK_ISGOREMEZLIK_URL',
    } as Partial<Record<PortalJobType, string>>)[jobType];
    return envKey ? process.env[envKey] || '' : '';
  }

  private loginValuesForJob(jobType: PortalJobType, credential: RunnerCredential) {
    if (jobType.startsWith('SGK_')) {
      return [
        credential.username || credential.userCode || '',
        credential.workplaceCode || '',
        credential.password || '',
        credential.secondaryPassword || '',
        credential.officeCode || '',
      ].filter(Boolean);
    }
    return [
      credential.userCode || credential.username || '',
      credential.password || '',
      credential.secondaryPassword || '',
    ].filter(Boolean);
  }

  private async fillGenericPortalLogin(page: any, values: string[]) {
    const inputs = page.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]), textarea');
    const fields: any[] = [];
    const count = await inputs.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const loc = inputs.nth(i);
      if (await loc.isVisible().catch(() => false)) fields.push(loc);
    }
    if (fields.length < Math.min(values.length, 3)) {
      throw new Error('Portal giris alanlari bulunamadi');
    }
    for (let i = 0; i < Math.min(fields.length, values.length); i++) {
      await fields[i].fill(values[i]);
    }
  }

  private navigationTextsForJob(jobType: PortalJobType) {
    switch (jobType) {
      case 'E_TEBLIGAT_CHECK':
        return ['e-Tebligat', 'Elektronik Tebligat', 'Tebligatlarim', 'Tebligatlarım', 'Gelen Tebligatlar'];
      case 'SGK_HIZMET_LISTESI':
        return ['Hizmet Listesi', 'Aylik Prim', 'Aylık Prim', 'Sigortali Hizmet', 'Sigortalı Hizmet'];
      case 'SGK_TAHAKKUK':
        return ['Tahakkuk', 'Bildirge Tahakkuk', 'Prim Tahakkuk', 'Hizmet ve Tahakkuk'];
      case 'SGK_ISE_GIRIS_CIKIS':
        return ['Ise Giris', 'İşe Giriş', 'Isten Cikis', 'İşten Çıkış', 'Sigortali Ise Giris'];
      case 'SGK_ISGOREMEZLIK':
        return ['Isgoremezlik', 'İşgöremezlik', 'Calismadigina Dair', 'Çalışmadığına Dair', 'Rapor'];
      default:
        return [];
    }
  }

  private async tryNavigateByTexts(page: any, candidates: string[]) {
    for (const text of candidates) {
      const loc = page.getByText(text, { exact: false }).first();
      if (!(await loc.isVisible().catch(() => false))) continue;
      await Promise.all([
        page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {}),
        loc.click({ timeout: 5000 }),
      ]).catch(() => {});
      await page.waitForTimeout(1000);
      const body = await this.bodyText(page);
      if (new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(body)) return true;
    }
    return false;
  }

  private async clickAndCollectPortalDocuments(
    page: any,
    downloadsPath: string,
    job: any,
    jobType: PortalJobType,
  ) {
    const documents: any[] = [];
    const notes: string[] = [];
    const max = Math.max(1, Math.min(50, Number(process.env.PORTAL_AUTOMATION_DOCUMENT_MAX_DOWNLOADS || 20)));
    const selector = process.env.PORTAL_AUTOMATION_DOCUMENT_DOWNLOAD_SELECTOR || 'a, button, input[type="button"], input[type="submit"]';
    const candidates = page.locator(selector);
    const count = Math.min(await candidates.count().catch(() => 0), 300);
    const downloadText = this.downloadRegexForJob(jobType);
    let clicked = 0;

    for (let i = 0; i < count && clicked < max; i++) {
      const loc = candidates.nth(i);
      if (!(await loc.isVisible().catch(() => false))) continue;
      const meta = await loc.evaluate((el: any) => {
        const row = el.closest('tr') || el.closest('[role="row"]') || el.parentElement;
        return {
          text: `${el.innerText || el.value || el.getAttribute('title') || ''}`.trim(),
          href: el.getAttribute('href') || '',
          download: el.getAttribute('download') || '',
          rowText: `${row?.innerText || ''}`.trim(),
        };
      }).catch(() => null);
      const haystack = `${meta?.text || ''} ${meta?.href || ''} ${meta?.download || ''} ${meta?.rowText || ''}`;
      if (!downloadText.test(haystack)) continue;

      const download = await Promise.all([
        page.waitForEvent('download', { timeout: 12_000 }).catch(() => null),
        loc.click({ timeout: 8000 }).catch(() => null),
      ]).then(([d]) => d).catch(() => null);

      if (!download) {
        notes.push(`Tiklandi ama download gelmedi: ${this.compact(meta?.text || meta?.href || 'isimsiz')}`);
        continue;
      }

      clicked++;
      const suggested = await download.suggestedFilename().catch(() => `${jobType}-${clicked}.pdf`);
      const filePath = join(downloadsPath, `${clicked}-${this.safeFileName(suggested)}`);
      await download.saveAs(filePath);
      const buffer = await readFile(filePath);
      documents.push({
        taxpayerId: job.taxpayerId || null,
        belgeTuru: this.documentTypeForJob(jobType),
        title: suggested || this.documentTitleForJob(jobType),
        referenceNo: this.guessReferenceNo(`${suggested} ${haystack}`),
        period: job.donem || this.inferDonem(job.periodEnd),
        issuedAt: job.periodEnd || null,
        receivedAt: new Date().toISOString(),
        mimeType: this.mimeFromName(suggested),
        originalName: suggested,
        base64: buffer.toString('base64'),
        raw: { runner: 'railway', jobType, rowText: this.compact(meta?.rowText || ''), fileName: suggested },
      });
    }

    notes.push(`${clicked} belge indirildi`);
    return { documents, notes };
  }

  private downloadRegexForJob(jobType: PortalJobType) {
    if (jobType === 'E_TEBLIGAT_CHECK') return /indir|pdf|tebligat|g[oö]r[uü]nt[uü]le|download/i;
    if (jobType === 'SGK_TAHAKKUK') return /indir|pdf|tahakkuk|makbuz|download/i;
    if (jobType === 'SGK_HIZMET_LISTESI') return /indir|pdf|hizmet|liste|ayl[iı]k prim|download/i;
    if (jobType === 'SGK_ISE_GIRIS_CIKIS') return /indir|pdf|giri[sş]|[cç][iı]k[iı][sş]|bildirge|download/i;
    if (jobType === 'SGK_ISGOREMEZLIK') return /indir|pdf|rapor|i[sş]g[oö]remezlik|download/i;
    return /indir|pdf|xml|download/i;
  }

  private documentTypeForJob(jobType: PortalJobType) {
    switch (jobType) {
      case 'E_TEBLIGAT_CHECK': return 'E_TEBLIGAT';
      case 'SGK_HIZMET_LISTESI': return 'SGK_HIZMET_LISTESI';
      case 'SGK_TAHAKKUK': return 'SGK_TAHAKKUK';
      case 'SGK_ISE_GIRIS_CIKIS': return 'SGK_ISE_GIRIS_CIKIS';
      case 'SGK_ISGOREMEZLIK': return 'SGK_ISGOREMEZLIK';
      default: return 'DIGER';
    }
  }

  private documentTitleForJob(jobType: PortalJobType) {
    switch (jobType) {
      case 'E_TEBLIGAT_CHECK': return 'e-Tebligat';
      case 'SGK_HIZMET_LISTESI': return 'SGK Hizmet Listesi';
      case 'SGK_TAHAKKUK': return 'SGK Tahakkuk';
      case 'SGK_ISE_GIRIS_CIKIS': return 'SGK Ise Giris/Cikis';
      case 'SGK_ISGOREMEZLIK': return 'SGK Isgoremezlik Raporu';
      default: return 'Portal Belgesi';
    }
  }

  private guessReferenceNo(text: string) {
    const normalized = String(text || '').replace(/\s+/g, ' ');
    const m = normalized.match(/\b[A-Z0-9]{6,}[-/]?[A-Z0-9]{2,}\b/i) || normalized.match(/\b\d{8,}\b/);
    return m ? m[0].slice(0, 80) : null;
  }

  /**
   * Yeni GIB Dijital Vergi Dairesi (2026) login form'u: userid + sifre.
   * CAPTCHA ayri fonksiyonda doldurulur (fillEBeyannameCaptcha).
   */
  private async fillEBeyannameLogin(page: any, userCode: string, password: string) {
    const userSelectors = [
      'input[name="userid"]',
      'input[id="userid"]',
      'input[name*="user" i]',
      'input[id*="user" i]',
      'input[autocomplete="username"]',
      'input[type="text"]',
    ];
    const passwordSelectors = [
      'input[name="sifre"]',
      'input[id="sifre"]',
      'input[name*="sifre" i]',
      'input[id*="sifre" i]',
      'input[autocomplete="current-password"]',
      'input[type="password"]',
    ];

    const userInput = await this.firstVisibleLocator(page, userSelectors, 15_000);
    if (!userInput) throw new Error(await this.loginFieldError(page, 'Kullanici kodu alani bulunamadi (userid)'));
    await userInput.fill(userCode);

    const passwordInput = await this.firstVisibleLocator(page, passwordSelectors, 5_000);
    if (!passwordInput) throw new Error(await this.loginFieldError(page, 'Sifre alani bulunamadi (sifre)'));
    await passwordInput.fill(password);
  }

  /**
   * Login form'undaki CAPTCHA (img alt="captchaImg") yakalanip 2captcha ile cozuluyor,
   * sonra "dk" input'una yaziliyor. Submit'i CALLER yapacak.
   */
  private async fillEBeyannameCaptcha(page: any): Promise<void> {
    const apiKey = process.env.TWOCAPTCHA_API_KEY || process.env.TWO_CAPTCHA_API_KEY;
    if (!apiKey) {
      throw new Error('TWOCAPTCHA_API_KEY env yok; e-Beyanname CAPTCHA cozulemez');
    }

    // CAPTCHA goruntusunu yakala — yeni UI'da img alt="captchaImg"
    const captchaImg = await this.firstVisibleElementHandle(page, [
      'img[alt="captchaImg"]',
      'img[alt*="captcha" i]',
      'img[src*="captcha" i]',
      'img[id*="captcha" i]',
      'canvas',
    ], 10_000);
    if (!captchaImg) {
      throw new Error('CAPTCHA gorsel bulunamadi (img[alt="captchaImg"])');
    }
    const base64 = await this.captchaImageBase64(captchaImg);

    const captchaText = await this.solveCaptchaWith2Captcha(base64, apiKey);
    this.logger.log(`[eBeyanname] CAPTCHA cozuldu: "${captchaText}" (${captchaText.length} karakter)`);

    // "dk" (Dogrulama Kodu) input'una yaz
    const dkInput = await this.firstVisibleLocator(page, [
      'input[name="dk"]',
      'input[id="dk"]',
      'input[name*="dogrulama" i]',
      'input[id*="dogrulama" i]',
      'input[placeholder*="dogrulama" i]',
      'input[placeholder*="guvenlik" i]',
      'input[placeholder*="kod" i]',
      'input[maxlength="6"]',
    ], 5_000);
    if (!dkInput) {
      throw new Error('Dogrulama kodu (dk) alani bulunamadi');
    }
    await dkInput.fill(captchaText);
  }

  private async captchaImageBase64(captchaImg: any): Promise<string> {
    const src = await captchaImg.evaluate((el: any) => el.getAttribute('src') || '').catch(() => '');
    const dataMatch = String(src || '').match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
    if (dataMatch?.[1]) return dataMatch[1].trim();

    try {
      const buffer = await captchaImg.screenshot({ type: 'png' });
      return buffer.toString('base64');
    } catch (err: any) {
      throw new Error(`CAPTCHA screenshot hata: ${err?.message || err}`);
    }
  }

  private async waitForEBeyannameLoginForm(page: any) {
    await page.waitForLoadState('domcontentloaded', { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const ready = await this.firstVisibleLocator(page, [
      'input[name="userid"]',
      'input[id="userid"]',
      'input[name*="user" i]',
      'input[id*="user" i]',
      'input[autocomplete="username"]',
    ], 20_000);
    if (!ready) throw new Error(await this.loginFieldError(page, 'Kullanici kodu alani bulunamadi (userid)'));
  }

  private async firstVisibleLocator(page: any, selectors: string[], timeoutMs = 0) {
    const deadline = Date.now() + timeoutMs;
    do {
      for (const selector of selectors) {
        const loc = page.locator(selector).first();
        if (await loc.isVisible().catch(() => false)) return loc;
      }
      if (!timeoutMs || Date.now() >= deadline) break;
      await page.waitForTimeout(250);
    } while (Date.now() < deadline);
    return null;
  }

  private async firstVisibleElementHandle(page: any, selectors: string[], timeoutMs = 0) {
    const deadline = Date.now() + timeoutMs;
    do {
      for (const selector of selectors) {
        const loc = page.locator(selector).first();
        if (await loc.isVisible().catch(() => false)) {
          const handle = await loc.elementHandle().catch(() => null);
          if (handle) return handle;
        }
      }
      if (!timeoutMs || Date.now() >= deadline) break;
      await page.waitForTimeout(250);
    } while (Date.now() < deadline);
    return null;
  }

  private async loginFieldError(page: any, fallback: string) {
    const url = this.safeUrl(page.url());
    const alertText = await this.visibleAlertText(page);
    const title = await page.title().catch(() => '');
    return `${fallback}; url=${url}; title=${this.compact(title)}${alertText ? `; mesaj=${this.compact(alertText)}` : ''}`;
  }

  private async isEBeyannameLoginFormVisible(page: any) {
    const user = await this.firstVisibleLocator(page, [
      'input[name="userid"]',
      'input[id="userid"]',
      'input[name*="user" i]',
      'input[id*="user" i]',
      'input[autocomplete="username"]',
    ]);
    const pass = await this.firstVisibleLocator(page, [
      'input[name="sifre"]',
      'input[id="sifre"]',
      'input[name*="sifre" i]',
      'input[id*="sifre" i]',
      'input[type="password"]',
    ]);
    return !!(user && pass);
  }

  private async visibleAlertText(page: any) {
    const selectors = [
      '[role="alert"]',
      '.alert',
      '.error',
      '.text-danger',
      '.invalid-feedback',
      '.notification',
      '.toast',
      '.message',
    ];
    const pieces: string[] = [];
    for (const selector of selectors) {
      const loc = page.locator(selector);
      const count = Math.min(await loc.count().catch(() => 0), 5);
      for (let i = 0; i < count; i++) {
        const item = loc.nth(i);
        if (!(await item.isVisible().catch(() => false))) continue;
        const text = await item.innerText().catch(() => '');
        if (text && !pieces.includes(text.trim())) pieces.push(text.trim());
      }
    }
    return pieces.join(' | ').slice(0, 500);
  }

  private async fillFirst(page: any, selectors: string[], value: string) {
    for (const selector of selectors) {
      const loc = page.locator(selector).first();
      if (await loc.isVisible().catch(() => false)) {
        await loc.fill(value);
        return;
      }
    }
    throw new Error(`Alan bulunamadi: ${selectors[0]}`);
  }

  private async submitLogin(page: any) {
    const selectors = [
      'button:has-text("Giriş Yap")',  // yeni GIB Dijital Vergi Dairesi UI
      'button:has-text("Giris Yap")',
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Giriş")',
      'button:has-text("Giris")',
      'input[value*="Giriş" i]',
      'input[value*="Giris" i]',
      'a:has-text("Giriş")',
      'a:has-text("Giris")',
    ];
    for (const selector of selectors) {
      const loc = page.locator(selector).first();
      if (await loc.isVisible().catch(() => false)) {
        await Promise.all([
          page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {}),
          loc.click(),
        ]);
        return;
      }
    }
    await page.keyboard.press('Enter');
  }

  /**
   * GIB e-Beyanname submit sonrasi sayfada CAPTCHA varsa, 2captcha API'sine gonderip
   * cozumu input'a yazip submit eder. Basariliysa true, basarisizsa false.
   * Env: TWOCAPTCHA_API_KEY (Luca icin zaten kullanilan key, ayni kullanilabilir).
   */
  private async tryAutoSolveCaptcha(page: any): Promise<boolean> {
    const apiKey = process.env.TWOCAPTCHA_API_KEY || process.env.TWO_CAPTCHA_API_KEY;
    if (!apiKey) {
      this.logger.warn('[eBeyanname] TWOCAPTCHA_API_KEY env yok, otomatik CAPTCHA cozumu atlandi');
      return false;
    }

    // CAPTCHA gorseli yakala (cesitli selector denenir)
    const captchaSelectors = [
      'img[src*="captcha" i]',
      'img[src*="Captcha"]',
      'img[id*="captcha" i]',
      'img[alt*="captcha" i]',
      'img[alt*="güvenlik" i]',
      'img[alt*="dogrulama" i]',
      '.captcha img',
      '#captcha img',
    ];
    let captchaImg: any = null;
    for (const sel of captchaSelectors) {
      captchaImg = await page.$(sel).catch(() => null);
      if (captchaImg) break;
    }
    if (!captchaImg) {
      this.logger.warn('[eBeyanname] CAPTCHA gorsel selector\'leri eslesmiyor');
      return false;
    }

    let base64: string;
    try {
      const buffer = await captchaImg.screenshot({ type: 'png' });
      base64 = buffer.toString('base64');
    } catch (err: any) {
      this.logger.warn(`[eBeyanname] CAPTCHA screenshot hata: ${err?.message || err}`);
      return false;
    }

    let captchaText: string;
    try {
      captchaText = await this.solveCaptchaWith2Captcha(base64, apiKey);
    } catch (err: any) {
      this.logger.warn(`[eBeyanname] 2captcha cozum hata: ${err?.message || err}`);
      return false;
    }

    // Cozum sonucunu input'a yaz
    const inputSelectors = [
      'input[name*="captcha" i]',
      'input[id*="captcha" i]',
      'input[placeholder*="captcha" i]',
      'input[placeholder*="güvenlik" i]',
      'input[placeholder*="dogrulama" i]',
      'input[placeholder*="kod" i]',
    ];
    let filled = false;
    for (const sel of inputSelectors) {
      const inp = await page.$(sel).catch(() => null);
      if (inp) {
        await inp.fill(captchaText).catch(() => null);
        filled = true;
        break;
      }
    }
    if (!filled) {
      this.logger.warn('[eBeyanname] CAPTCHA input bulunamadi');
      return false;
    }

    // Submit dene
    await this.submitLogin(page).catch(() => null);
    await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // Hala CAPTCHA varsa basarisiz say
    const body = await this.bodyText(page);
    if (TEXT.captcha.test(body)) {
      this.logger.warn('[eBeyanname] CAPTCHA gozuktugu icin 2captcha cozumu yetersiz kaldi');
      return false;
    }
    this.logger.log('[eBeyanname] CAPTCHA 2captcha ile otomatik cozuldu');
    return true;
  }

  /** 2captcha API: base64 captcha → text. Luca'daki ile ayni protokol. */
  private async solveCaptchaWith2Captcha(base64: string, apiKey: string): Promise<string> {
    const inForm = new URLSearchParams();
    inForm.append('key', apiKey);
    inForm.append('method', 'base64');
    inForm.append('body', base64);
    inForm.append('json', '0');
    // GIB CAPTCHA case-sensitive (genelde BUYUK HARF) — 2captcha varsayilan
    // kucuk harf donduyor, bu yuzden regsense=1 zorunlu.
    inForm.append('regsense', '1');
    inForm.append('min_len', '4');
    inForm.append('max_len', '6');

    const inRes = await fetch('https://2captcha.com/in.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: inForm.toString(),
    });
    const inText = (await inRes.text()).trim();
    if (!inText.startsWith('OK|')) throw new Error(`2captcha in.php: ${inText}`);
    const captchaId = inText.slice(3);

    const maxAttempts = Number(process.env.PORTAL_2CAPTCHA_MAX_POLL || 30);
    const pollInterval = Number(process.env.PORTAL_2CAPTCHA_POLL_INTERVAL_MS || 5000);
    await new Promise((r) => setTimeout(r, pollInterval));

    for (let i = 0; i < maxAttempts; i++) {
      const resUrl = `https://2captcha.com/res.php?key=${encodeURIComponent(apiKey)}&action=get&id=${encodeURIComponent(captchaId)}&json=0`;
      const r = await fetch(resUrl);
      const t = (await r.text()).trim();
      if (t === 'CAPCHA_NOT_READY') {
        await new Promise((r) => setTimeout(r, pollInterval));
        continue;
      }
      if (t.startsWith('OK|')) {
        return String(t.slice(3)).replace(/[^0-9A-Za-z]/g, '');
      }
      throw new Error(`2captcha res.php: ${t}`);
    }
    throw new Error(`2captcha zaman asimi (${maxAttempts} deneme)`);
  }

  private async assertLoggedIn(page: any) {
    const body = await this.bodyText(page);
    const loginFormVisible = await this.isEBeyannameLoginFormVisible(page);
    if (!loginFormVisible) return;

    const alertText = await this.visibleAlertText(page);
    const reason = alertText || (TEXT.loginError.test(body) ? 'GIB giris hata mesaji algilandi' : 'login formu hala gorunuyor');
    if (TEXT.captcha.test(body) || TEXT.loginError.test(body) || loginFormVisible) {
      throw new Error(`CAPTCHA veya sifre reddedildi: ${this.compact(reason)}`);
    }
  }

  private async collectEBeyannameDownloads(tenantId: string, page: any, job: any, downloadsPath: string) {
    const notes: string[] = [];
    const declarations: any[] = [];
    const documents: any[] = [];
    let persistedCount = 0;
    const taxpayers = await this.loadTaxpayers(tenantId);

    // GIB sayfasinin yaptigi (calisan) liste istegini yakala — liste-API sayfalamasi bunu temel alir.
    // GIB ekrani listeyi POST ile yukleyebildigi icin URL'i VE postData'yi tara; ayrica hangi /dispatch
    // komutlarinin cagrildigini [EBLISTREQ] ile logla (gercek liste komutunu kesin ogrenmek icin).
    this.ebeyannameCapturedListReq = null;
    const ctx = page.context?.();
    const seenDispatchCmds = new Set<string>();
    const listReqHandler = (req: any) => {
      try {
        const u = String(req.url?.() || '');
        if (!/\/dispatch\b/i.test(u)) return;
        const method = String(req.method?.() || 'GET');
        const post = method !== 'GET' ? String(req.postData?.() || '') : '';
        const hay = `${u} ${post}`;
        const cmd = (hay.match(/[?&\b]cmd=([A-Za-z0-9_]+)/i)?.[1] || '?');
        const key = `${method}:${cmd}`;
        if (!seenDispatchCmds.has(key)) {
          seenDispatchCmds.add(key);
          this.logger.warn(`[EBLISTREQ] ${method} cmd=${cmd} url=${this.safeUrl(u)}${post ? ` post=${this.safeDebugText(post).slice(0, 220)}` : ''}`);
        }
        // Sonuc tablosunu ureten liste/sorgu istegini yakala (URL veya POST govdesinde).
        if (/(ARSIVBEYANNAMELISTESI|BEYANNAMELISTESI|BEYANNAMEARA|BEYANNAME_ARA|TAXRETURNSEARCH|SORGULA|LISTELE)/i.test(hay)) {
          this.ebeyannameCapturedListReq = { url: u, method, postData: req.postData?.() ?? null };
        }
      } catch { /* yoksay */ }
    };
    ctx?.on?.('request', listReqHandler);
    try {

    await this.jobProgress(tenantId, job, 'search_open', 'Beyanname Ara menusu aciliyor.');
    await this.openEBeyannameSearch(page, notes);
    await this.jobProgress(tenantId, job, 'criteria', 'Tarih araligi ve sorgu kriterleri dolduruluyor.');
    await this.fillEBeyannameSearchCriteria(page, job, notes);

    const statusPlan: Array<{ status: EBeyannameStatus; label: string; download: boolean }> = [
      { status: 'hatali', label: 'Hatali', download: false },
      { status: 'beklemede', label: 'Onay bekliyor', download: false },
      { status: 'onaylandi', label: 'Onaylandi', download: true },
    ];

    for (const item of statusPlan) {
      await this.jobProgress(tenantId, job, `status_${item.status}`, `${item.label} beyannameler sorgulaniyor.`);
      await this.selectEBeyannameStatus(page, item.status);
      const beforeCount = declarations.length + documents.length;
      const collected = await this.queryEBeyannameStatus(tenantId, page, item.status, item.download, downloadsPath, taxpayers, job, notes);
      persistedCount += collected.persistedCount || 0;
      declarations.push(...collected.declarations);
      documents.push(...collected.documents);
      const added = (collected.persistedCount || 0) + declarations.length + documents.length - beforeCount;
      await this.jobProgress(tenantId, job, `status_${item.status}_done`, `${item.label} sorgusu tamamlandi: ${added} kayit eklendi.`, {
        records: persistedCount + declarations.length + documents.length,
      });

      if (item.status !== 'onaylandi') {
        await this.closeEBeyannameResultList(page).catch((err) => {
          notes.push(`${item.label} listesi kapatilamadi: ${this.compact(err?.message || err)}`);
        });
      }
    }

    if (!persistedCount && !declarations.length && !documents.length) {
      notes.push(`Indirilecek beyanname/tahakkuk bulunamadi. URL=${this.safeUrl(page.url())}`);
    }

    return {
      phase: persistedCount || declarations.length || documents.length ? 'download_collected' : 'no_records',
      persistedCount,
      declarations,
      documents,
      notes,
    };
    } finally {
      ctx?.off?.('request', listReqHandler);
    }
  }

  private async openEBeyannameApplication(context: any, page: any) {
    const alreadyOpen = this.findOpenPageByHost(context, 'ebeyanname.gib.gov.tr');
    if (alreadyOpen) return alreadyOpen;
    if (/ebeyanname\.gib\.gov\.tr/i.test(page.url())) return page;

    const popupAfterTile = context.waitForEvent('page', { timeout: 8_000 }).catch(() => null);
    const tileClicked = await this.clickVisibleText(page, ['e-Beyanname']);
    if (!tileClicked) {
      throw new Error(`Dijital Vergi Dairesi ana ekranda e-Beyanname uygulamasi bulunamadi. Gorunen kontroller: ${await this.visibleActionSnapshot(page)}`);
    }

    const directPopup = await Promise.race([
      popupAfterTile,
      page.waitForTimeout(900).then(() => null),
    ]);
    if (directPopup) {
      await directPopup.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});
      return directPopup;
    }

    const confirmVisible = await this.isAnyTextVisible(page, ['ONAYLA', 'Onayla', 'Devam etmek istiyor musunuz']);
    if (confirmVisible) {
      const popupAfterConfirm = context.waitForEvent('page', { timeout: 25_000 }).catch(() => null);
      const confirmed = await this.clickVisibleText(page, ['ONAYLA', 'Onayla']);
      if (!confirmed) {
        throw new Error(`e-Beyanname yonlendirme onayi acildi ama ONAYLA butonu tiklanamadi. Gorunen kontroller: ${await this.visibleActionSnapshot(page)}`);
      }

      const popup = await popupAfterConfirm;
      if (popup) {
        await popup.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});
        await popup.bringToFront().catch(() => {});
        return popup;
      }
    }

    for (let i = 0; i < 15; i++) {
      const opened = this.findOpenPageByHost(context, 'ebeyanname.gib.gov.tr');
      if (opened) {
        await opened.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});
        return opened;
      }
      if (/ebeyanname\.gib\.gov\.tr/i.test(page.url())) return page;
      await page.waitForTimeout(1000);
    }

    throw new Error(`e-Beyanname sekmesi acilmadi. Mevcut URL=${this.safeUrl(page.url())}. Gorunen kontroller: ${await this.visibleActionSnapshot(page)}`);
  }

  private async safeLogoutFromDigitalTaxOffice(context: any, mainPage: any, eBeyannamePage: any, notes: string[]) {
    if (eBeyannamePage && eBeyannamePage !== mainPage && !eBeyannamePage.isClosed?.()) {
      await eBeyannamePage.close({ runBeforeUnload: false }).catch(() => {});
      notes.push('e-Beyanname sekmesi kapatildi');
    }

    const candidates = (context.pages?.() || []).filter((candidate: any) => !candidate.isClosed?.());
    let portalPage = candidates.find((candidate: any) => /dijital\.gib\.gov\.tr/i.test(String(candidate.url?.() || ''))) || mainPage;
    if (!portalPage || portalPage.isClosed?.()) {
      portalPage = await context.newPage();
      await portalPage.goto(DEFAULT_GIB_IVD_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
    }

    await portalPage.bringToFront().catch(() => {});
    await portalPage.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});

    const menuOpened = await this.openDigitalTaxUserMenu(portalPage);
    if (!menuOpened) {
      notes.push(`Dijital Vergi Dairesi kullanici menusu acilamadi; sekmeler kapatilacak. URL=${this.safeUrl(portalPage.url())}`);
      return;
    }

    const logoutClicked = await this.clickVisibleText(portalPage, ['Çıkış Yap', 'Cikis Yap', 'Güvenli Çıkış', 'Guvenli Cikis']);
    if (!logoutClicked) {
      notes.push(`Cikis Yap butonu bulunamadi. Gorunen kontroller: ${await this.visibleActionSnapshot(portalPage)}`);
      return;
    }

    await portalPage.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
    await portalPage.waitForTimeout(1000);
    notes.push('Dijital Vergi Dairesi guvenli cikis yapildi');
  }

  private async openDigitalTaxUserMenu(page: any) {
    for (const text of ['MUZAFFER ÖREN', 'MUZAFFER OREN']) {
      const loc = page.getByText(text, { exact: false }).first();
      if (await loc.isVisible().catch(() => false)) {
        await loc.click({ timeout: 8_000 }).catch(() => {});
        await page.waitForTimeout(500);
        if (await this.isAnyTextVisible(page, ['Çıkış Yap', 'Cikis Yap', 'Profil'])) return true;
      }
    }

    const clicked = await page.evaluate(() => {
      const norm = (value: string) => String(value || '')
        .toLocaleUpperCase('tr-TR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const isVisible = (el: Element) => {
        const anyEl = el as HTMLElement;
        return !!(anyEl.offsetWidth || anyEl.offsetHeight || anyEl.getClientRects().length);
      };
      const controls = Array.from(document.querySelectorAll<HTMLElement>('button, a, div, span'));
      const target = controls
        .filter(isVisible)
        .find((el) => {
          const text = norm(el.textContent || '');
          return text.includes('MUZAFFER') || text.includes('PROFIL') || text.includes('KULLANICI');
        });
      if (!target) return false;
      target.click();
      return true;
    }).catch(() => false);
    if (!clicked) return false;
    await page.waitForTimeout(500);
    return await this.isAnyTextVisible(page, ['Çıkış Yap', 'Cikis Yap', 'Profil']);
  }

  private findOpenPageByHost(context: any, host: string) {
    const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'i');
    return (context.pages?.() || []).find((p: any) => re.test(String(p.url?.() || ''))) || null;
  }

  private ebeyannameDomTargets(page: any) {
    const targets: any[] = [page];
    const mainFrame = page.mainFrame?.();
    for (const frame of page.frames?.() || []) {
      if (!frame || frame === mainFrame || frame.isDetached?.()) continue;
      targets.push(frame);
    }
    return targets;
  }

  private async findEBeyannameSearchTarget(page: any) {
    for (const target of this.ebeyannameDomTargets(page)) {
      if (await this.hasEBeyannameSearchFormIn(target) || await this.hasEBeyannameSearchControlsIn(target)) return target;
    }
    return null;
  }

  private async findEBeyannameResultTarget(page: any) {
    for (const target of this.ebeyannameDomTargets(page)) {
      if (await this.hasEBeyannameResultListIn(target)) return target;
    }
    return null;
  }

  private async openEBeyannameSearch(page: any, notes: string[]) {
    const listUrl = process.env.PORTAL_AUTOMATION_EBEYANNAME_LIST_URL;
    if (listUrl) {
      await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(1000);
      notes.push('Beyanname Ara URL env ile acildi');
      return;
    }

    await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});
    if (await this.hasEBeyannameSearchForm(page)) {
      notes.push('Beyanname Ara formu zaten acik');
      return;
    }
    if (await this.hasEBeyannameResultList(page)) {
      await this.closeEBeyannameResultList(page).catch(() => {});
      if (await this.hasEBeyannameSearchForm(page)) {
        notes.push('Beyanname Ara listesi acikti; liste kapatildi ve forma donuldu');
        return;
      }
    }

    const clicked = await this.clickEBeyannameSearchMenu(page);
    if (!clicked) {
      if (await this.hasEBeyannameSearchControls(page)) {
        notes.push('Beyanname Ara menusu gorunmedi ama sorgu formu aktif; mevcut form kullaniliyor');
        return;
      }
      throw new Error(`e-Beyanname sekmesinde Beyanname Ara menusu bulunamadi. Gorunen kontroller: ${await this.visibleActionSnapshot(page)}`);
    }

    for (let i = 0; i < 20; i++) {
      if (await this.hasEBeyannameSearchForm(page) || await this.hasEBeyannameSearchControls(page)) {
        notes.push('Beyanname Ara formu acildi');
        return;
      }
      await page.waitForTimeout(500);
    }

    throw new Error(`Beyanname Ara formu acilmadi. Gorunen kontroller: ${await this.visibleActionSnapshot(page)}`);
  }

  private async hasEBeyannameSearchForm(page: any) {
    for (const target of this.ebeyannameDomTargets(page)) {
      if (await this.hasEBeyannameSearchFormIn(target)) return true;
    }
    return false;
  }

  private async hasEBeyannameSearchFormIn(target: any) {
    return target.evaluate(() => {
      const hasRealSearchFields = () => {
        const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"], input[name="durum"]'));
        const hasStatusRadios = ['0', '1', '2'].every((value) =>
          radios.some((radio) => radio.name === 'durum' && radio.value === value),
        );
        const dateIds = [
          'baslangicTarihiGun',
          'baslangicTarihiAy',
          'baslangicTarihiYil',
          'bitisTarihiGun',
          'bitisTarihiAy',
          'bitisTarihiYil',
        ];
        const hasDateIds = dateIds.every((id) => document.getElementById(id));
        return hasStatusRadios && hasDateIds && !!document.querySelector('#sorgulaButon, input[name="sorgulaButon"]');
      };
      const form = document.querySelector('form#taxReturnSearchForm');
      if (form && hasRealSearchFields()) return true;
      const norm = (value: string) => String(value || '')
        .toLocaleUpperCase('tr-TR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');
      const text = norm(document.body?.innerText || '');
      return hasRealSearchFields() && text.includes('BEYANNAME ARA') && (text.includes('YUKLEME TARIH') || text.includes('DURUM') || text.includes('SORGULA'));
    }).catch(() => false);
  }

  private async clickEBeyannameSearchMenu(page: any) {
    for (const target of this.ebeyannameDomTargets(page)) {
      const clicked = await target.evaluate(() => {
        const norm = (value: string) => String(value || '')
          .toLocaleUpperCase('tr-TR')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        const isVisible = (el: Element) => {
          const anyEl = el as HTMLElement;
          return !!(anyEl.offsetWidth || anyEl.offsetHeight || anyEl.getClientRects().length);
        };
        const controls = Array.from(document.querySelectorAll<HTMLElement>('span[onclick], a[onclick], button, input[type="button"], input[type="submit"]'))
          .filter(isVisible);

        const exact = controls.find((el) => /beyannameAraFormu\s*\(/i.test(el.getAttribute('onclick') || ''));
        if (exact) {
          exact.click();
          return true;
        }

        const fallback = controls.find((el: any) => {
          const onclick = el.getAttribute('onclick') || '';
          if (/ARSIVBEYANNAMESORGU|Arşiv Beyanname Ara|Arsiv Beyanname Ara/i.test(onclick)) return false;
          const text = norm(`${el.textContent || ''} ${el.value || ''} ${el.title || ''}`);
          return text === 'BEYANNAME ARA';
        });
        if (!fallback) return false;
        fallback.click();
        return true;
      }).catch(() => false);
      if (clicked) {
        await page.waitForTimeout(800);
        return true;
      }
    }
    return false;
  }

  private async hasEBeyannameSearchControls(page: any) {
    for (const target of this.ebeyannameDomTargets(page)) {
      if (await this.hasEBeyannameSearchControlsIn(target)) return true;
    }
    return false;
  }

  private async hasEBeyannameSearchControlsIn(target: any) {
    return target.evaluate(() => {
      const norm = (value: string) => String(value || '')
        .toLocaleUpperCase('tr-TR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const isVisible = (el: Element) => {
        const anyEl = el as HTMLElement;
        return !!(anyEl.offsetWidth || anyEl.offsetHeight || anyEl.getClientRects().length);
      };
      const visibleText = [
        document.body?.innerText || '',
        ...Array.from(document.querySelectorAll<HTMLElement>('button, input, select, option, label, a, td, th'))
          .filter(isVisible)
          .map((el: any) => `${el.innerText || ''} ${el.value || ''} ${el.title || ''} ${el.name || ''} ${el.id || ''}`),
      ].join(' ');
      const text = norm(visibleText);
      const actionControls = Array.from(document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input[type="submit"], input[type="button"], button'));
      const hasSearch = text.includes('SORGULA') || actionControls
        .some((el: any) => isVisible(el) && norm(`${el.value || ''} ${el.innerText || ''} ${el.name || ''} ${el.id || ''}`).includes('SORGULA'));
      const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter(isVisible);
      const hasStatus = text.includes('HATALI') || text.includes('ONAY BEKLIYOR') || text.includes('ONAYLANDI') || radios.length >= 3;
      const dateInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input')).filter((input: any) => {
        const type = (input.getAttribute('type') || 'text').toLowerCase();
        if (!isVisible(input) || ['checkbox', 'radio', 'submit', 'button', 'hidden', 'image'].includes(type)) return false;
        const haystack = norm(`${input.name || ''} ${input.id || ''} ${input.placeholder || ''} ${input.title || ''}`);
        return /TARIH|DATE|BASLANGIC|BITIS|GUN|AY|YIL|DAY|MONTH|YEAR|DP/.test(haystack) || /^\d{1,4}$/.test(String(input.value || ''));
      });
      const hasDate = text.includes('YUKLEME TARIH') || text.includes('BASLANGIC TARIHI') || text.includes('BITIS TARIHI') || dateInputs.length >= 6;
      return !!(hasSearch && hasStatus && hasDate);
    }).catch(() => false);
  }

  private async fillEBeyannameSearchCriteria(page: any, job: any, notes: string[]) {
    const start = this.istanbulDateParts(job.periodStart);
    const end = this.istanbulDateParts(job.periodEnd);
    if (!start || !end) {
      notes.push('Yukleme tarih araligi doldurulamadi: job tarihleri gecersiz');
      return;
    }

    const target = await this.findEBeyannameSearchTarget(page) || page;
    const result = await target.evaluate(({ start, end }: {
      start: { day: string; month: string; year: string; display: string };
      end: { day: string; month: string; year: string; display: string };
    }) => {
      const norm = (value: string) => String(value || '')
        .toLocaleUpperCase('tr-TR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const isVisible = (el: Element) => {
        const anyEl = el as HTMLElement;
        return !!(anyEl.offsetWidth || anyEl.offsetHeight || anyEl.getClientRects().length);
      };
      const fire = (el: HTMLInputElement) => {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      };
      const setInput = (el: HTMLInputElement, value: string) => {
        el.removeAttribute('disabled');
        el.readOnly = false;
        el.value = value;
        fire(el);
      };

      const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
      for (const checkbox of checkboxes) {
        const scope = checkbox.closest('tr') || checkbox.parentElement;
        const scopeText = norm(scope?.textContent || '');
        if (scopeText.includes('YUKLEME TARIH') && !checkbox.checked) {
          checkbox.click();
          checkbox.checked = true;
          fire(checkbox);
        }
      }

      const directValues: Record<string, string> = {
        baslangicTarihiGun: start.day,
        baslangicTarihiAy: start.month,
        baslangicTarihiYil: start.year,
        baslangicTarihi: `${start.year}${start.month}${start.day}`,
        bitisTarihiGun: end.day,
        bitisTarihiAy: end.month,
        bitisTarihiYil: end.year,
        bitisTarihi: `${end.year}${end.month}${end.day}`,
      };
      let directSet = 0;
      for (const [id, value] of Object.entries(directValues)) {
        const input = document.getElementById(id) as HTMLInputElement | null;
        if (!input) continue;
        setInput(input, value);
        directSet++;
      }
      if (directSet >= 6) {
        return { ok: true, inputCount: directSet, direct: true };
      }

      const scopes = Array.from(document.querySelectorAll<HTMLElement>('tr, tbody, table, div'))
        .filter((el) => isVisible(el) && norm(el.textContent || '').includes('YUKLEME TARIH'))
        .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);

      let selectedInputs: HTMLInputElement[] = [];
      for (const scope of scopes) {
        const inputs = Array.from(scope.querySelectorAll<HTMLInputElement>('input')).filter((input) => {
          const type = (input.getAttribute('type') || 'text').toLowerCase();
          return isVisible(input) && !['checkbox', 'radio', 'submit', 'button', 'hidden', 'image'].includes(type);
        });
        if (inputs.length >= 6) {
          selectedInputs = inputs.slice(-6);
          break;
        }
      }

      if (selectedInputs.length < 6) {
        const allInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input')).filter((input) => {
          const type = (input.getAttribute('type') || 'text').toLowerCase();
          return isVisible(input) && !['checkbox', 'radio', 'submit', 'button', 'hidden', 'image'].includes(type);
        });
        selectedInputs = allInputs.slice(-6);
      }

      if (selectedInputs.length < 6) {
        return { ok: false, inputCount: selectedInputs.length };
      }

      const values = [start.day, start.month, start.year, end.day, end.month, end.year];
      selectedInputs.slice(0, 6).forEach((input, index) => setInput(input, values[index]));
      return { ok: true, inputCount: selectedInputs.length };
    }, { start, end }).catch((err: any) => ({ ok: false, error: String(err?.message || err) }));

    if (!result?.ok) {
      throw new Error(`e-Beyanname Yukleme Tarih Araligi doldurulamadi: ${this.compact(result?.error || `inputCount=${result?.inputCount || 0}`)}`);
    }
    notes.push(`Yukleme Tarih Araligi ${start.display} - ${end.display} olarak dolduruldu`);
  }

  private async selectEBeyannameStatus(page: any, status: EBeyannameStatus) {
    if (await this.hasEBeyannameResultList(page)) {
      await this.closeEBeyannameResultList(page).catch(() => {});
    }
    if (!(await this.hasEBeyannameSearchForm(page))) {
      await this.openEBeyannameSearch(page, []).catch(() => {});
    }
    const target = await this.findEBeyannameSearchTarget(page) || page;
    const result = await target.evaluate((status: EBeyannameStatus) => {
      const wanted = status === 'hatali'
        ? 'HATALI'
        : status === 'beklemede'
          ? 'ONAY BEKLIYOR'
          : 'ONAYLANDI';
      const order = status === 'hatali' ? 0 : status === 'beklemede' ? 1 : 2;
      const value = status === 'hatali' ? '0' : status === 'beklemede' ? '1' : '2';
      const norm = (value: string) => String(value || '')
        .toLocaleUpperCase('tr-TR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const isVisible = (el: Element) => {
        const anyEl = el as HTMLElement;
        return !!(anyEl.offsetWidth || anyEl.offsetHeight || anyEl.getClientRects().length);
      };
      const fire = (el: HTMLInputElement) => {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      };
      const inspect = () => ({
        url: window.location.href,
        form: !!document.querySelector('form#taxReturnSearchForm'),
        statusCheckbox: !!document.querySelector('#sorguTipiD'),
        radios: Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"], input[name="durum"]'))
          .map((radio) => ({
            id: radio.id,
            name: radio.name,
            value: radio.value,
            checked: radio.checked,
            visible: isVisible(radio),
            text: norm((radio.closest('tr') || radio.parentElement)?.textContent || '').slice(0, 120),
          })),
      });

      const directStatusCheckbox = document.querySelector<HTMLInputElement>('#sorguTipiD');
      if (directStatusCheckbox && !directStatusCheckbox.checked) {
        directStatusCheckbox.checked = true;
        fire(directStatusCheckbox);
      }
      const directRadio = document.querySelector<HTMLInputElement>(`input[name="durum"][value="${value}"]`);
      if (directRadio) {
        directRadio.removeAttribute('disabled');
        directRadio.checked = true;
        fire(directRadio);
        return directRadio.checked ? { ok: true, inspect: inspect() } : { ok: false, inspect: inspect() };
      }

      const statusScopes = Array.from(document.querySelectorAll<HTMLElement>('tr, tbody, table, div'))
        .filter((el) => {
          const text = norm(el.textContent || '');
          return isVisible(el) && text.includes('DURUM') && text.includes('HATALI') && text.includes('ONAY');
        })
        .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
      const scope = statusScopes[0] || document.body;

      const statusCheckbox = Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
        .find((checkbox) => {
          const text = norm((checkbox.closest('tr') || checkbox.parentElement)?.textContent || '');
          return text.includes('DURUM') && !text.includes('YUKLEME');
        });
      if (statusCheckbox && !statusCheckbox.checked) {
        statusCheckbox.checked = true;
        fire(statusCheckbox);
      }

      const radios = Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter(isVisible);
      const textForRadio = (radio: HTMLInputElement) => {
        const pieces: string[] = [];
        if (radio.id) {
          const label = document.querySelector(`label[for="${CSS.escape(radio.id)}"]`);
          if (label?.textContent) pieces.push(label.textContent);
        }
        let sibling: ChildNode | null = radio.nextSibling;
        while (sibling && pieces.join(' ').length < 80) {
          const text = sibling.textContent || '';
          if (text.trim()) pieces.push(text);
          if (sibling.nodeType === Node.ELEMENT_NODE && (sibling as Element).matches('input')) break;
          sibling = sibling.nextSibling;
        }
        if (!pieces.length) pieces.push(radio.parentElement?.textContent || '');
        return norm(pieces.join(' '));
      };

      let radio = radios.find((candidate) => textForRadio(candidate).includes(wanted));
      if (!radio && radios[order]) radio = radios[order];
      if (!radio) return { ok: false, inspect: inspect() };
      radio.removeAttribute('disabled');
      radio.checked = true;
      fire(radio);
      return radio.checked ? { ok: true, inspect: inspect() } : { ok: false, inspect: inspect() };
    }, status).catch((err: any) => ({ ok: false, error: String(err?.message || err) }));

    if (!result?.ok) {
      const detail = this.compact(JSON.stringify(result?.inspect || result?.error || {}));
      throw new Error(`e-Beyanname Durum secenegi tiklanamadi: ${status}. Detay: ${detail}. Gorunen kontroller: ${await this.visibleActionSnapshot(page)}`);
    }
  }

  private async queryEBeyannameStatus(
    tenantId: string,
    page: any,
    status: EBeyannameStatus,
    downloadApproved: boolean,
    downloadsPath: string,
    taxpayers: TaxpayerMatch[],
    job: any,
    notes: string[],
  ) {
    const declarations: any[] = [];
    const documents: any[] = [];
    const dialogMessages: string[] = [];
    const dialogHandler = async (dialog: any) => {
      dialogMessages.push(dialog.message());
      await dialog.accept().catch(() => {});
    };

    page.on('dialog', dialogHandler);
    try {
      await this.jobProgress(tenantId, job, `status_${status}_search`, `${this.ebeyanStatusLabel(status)} icin Sorgula tiklaniyor.`);
      await this.clickEBeyannameSearchButton(page);
      for (let i = 0; i < 30; i++) {
        if (dialogMessages.length) break;
        if (await this.hasEBeyannameResultList(page)) break;
        await page.waitForTimeout(500);
      }
    } finally {
      page.off('dialog', dialogHandler);
    }

    if (dialogMessages.length) {
      notes.push(`${status}: GIB uyarisi: ${this.compact(dialogMessages.join(' | '))}`);
      await this.jobProgress(tenantId, job, `status_${status}_empty`, `${this.ebeyanStatusLabel(status)} icin GIB kayit bulamadi.`);
      return { declarations, documents, persistedCount: 0 };
    }

    if (!(await this.hasEBeyannameResultList(page))) {
      notes.push(`${status}: liste acilmadi, sonuc yok kabul edildi. URL=${this.safeUrl(page.url())}`);
      await this.jobProgress(tenantId, job, `status_${status}_empty`, `${this.ebeyanStatusLabel(status)} listesi acilmadi, kayit yok kabul edildi.`);
      return { declarations, documents, persistedCount: 0 };
    }

    if (downloadApproved) {
      // HATTAT YONTEMI (birincil): GIB liste-API'sinden (ARSIVBEYANNAMELISTESI) Oid'leri al,
      // dogrudan /dispatch IMAJ ile indir (tiklama/popup YOK). Erisilemez/bicim taninamazsa
      // null doner ve asagidaki eski tablo-kazima yoluna OTOMATIK dusulur.
      let approved: { declarations: any[]; documents: any[]; persistedCount: number } | null = null;
      if (this.ebeyannameListApiEnabled()) {
        approved = await this.collectApprovedEBeyannameViaListApi(tenantId, page, downloadsPath, taxpayers, job, notes)
          .catch((err) => {
            notes.push(`liste-API yolu hata verdi, eski yola dusuluyor: ${this.compact(err?.message || err)}`);
            return null;
          });
      }
      if (!approved) {
        approved = await this.collectApprovedEBeyannamePages(tenantId, page, downloadsPath, taxpayers, job, notes);
      }
      declarations.push(...approved.declarations);
      documents.push(...approved.documents);
      return { declarations, documents, persistedCount: approved.persistedCount || 0 };
    }

    const rows = await this.collectStatusOnlyEBeyannamePages(page, status, notes);
    for (const row of rows) {
      const declaration = this.declarationFromEBeyannameRow(row, status, taxpayers, job);
      if (declaration) declarations.push(declaration);
    }
    notes.push(`${status}: ${rows.length} satir okundu, ${declarations.length} takip kaydi eslendi`);
    return { declarations, documents, persistedCount: 0 };
  }

  private ebeyanStatusLabel(status: EBeyannameStatus) {
    if (status === 'hatali') return 'Hatali';
    if (status === 'beklemede') return 'Onay bekliyor';
    return 'Onaylandi';
  }

  private async clickEBeyannameSearchButton(page: any) {
    const target = await this.findEBeyannameSearchTarget(page) || page;
    const clicked = await target.evaluate(() => {
      const norm = (value: string) => String(value || '')
        .toLocaleUpperCase('tr-TR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const isVisible = (el: Element) => {
        const anyEl = el as HTMLElement;
        return !!(anyEl.offsetWidth || anyEl.offsetHeight || anyEl.getClientRects().length);
      };
      const direct = document.querySelector<HTMLElement>('#sorgulaButon, input[name="sorgulaButon"], input[onclick*="taxReturnSearchFormPost"]');
      if (direct && isVisible(direct)) {
        direct.click();
        return true;
      }
      const controls = Array.from(document.querySelectorAll<HTMLElement>('button, input[type="button"], input[type="submit"], a'));
      const target = controls.find((el) => {
        const text = norm(`${el.textContent || ''} ${(el as HTMLInputElement).value || ''} ${el.getAttribute('title') || ''}`);
        return isVisible(el) && text.includes('SORGULA');
      });
      if (!target) return false;
      target.click();
      return true;
    }).catch(() => false);
    if (!clicked) {
      await this.clickSearchIfPossible(page);
    }
  }

  private async hasEBeyannameResultList(page: any) {
    for (const target of this.ebeyannameDomTargets(page)) {
      if (await this.hasEBeyannameResultListIn(target)) return true;
    }
    return false;
  }

  private async hasEBeyannameResultListIn(target: any) {
    return target.evaluate(() => {
      const norm = (value: string) => String(value || '')
        .toLocaleUpperCase('tr-TR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');
      const text = norm(document.body?.innerText || '');
      if (!text.includes('BEYANNAME LISTESI')) return false;
      return Array.from(document.querySelectorAll('table')).some((table) => {
        const tableText = norm(table.textContent || '');
        const hasTaxRows = /\d{10,11}/.test(tableText);
        return (tableText.includes('BEYANNAME TURU') && tableText.includes('VERGI TAHAKKUKU'))
          || (hasTaxRows && (tableText.includes('VERGI TAHAKKUKU') || tableText.includes('ONAY') || tableText.includes('HATALI')));
      });
    }).catch(() => false);
  }

  private async parseEBeyannameResultRows(page: any): Promise<EBeyannameResultRow[]> {
    const target = await this.findEBeyannameResultTarget(page) || page;
    const rawRows = await target.evaluate(() => {
      const norm = (value: string) => String(value || '')
        .toLocaleUpperCase('tr-TR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');
      const tables = Array.from(document.querySelectorAll('table'));
      const table = tables.find((candidate) => {
        const text = norm(candidate.textContent || '');
        const hasTaxRows = /\d{10,11}/.test(text);
        return (text.includes('BEYANNAME TURU') && text.includes('VERGI TAHAKKUKU'))
          || (hasTaxRows && (text.includes('VERGI TAHAKKUKU') || text.includes('ONAY') || text.includes('HATALI')));
      });
      if (!table) return [];
      const directCellText = (cell: Element) => {
        const clone = cell.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('table').forEach((nested) => nested.remove());
        return (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
      };
      return Array.from(table.querySelectorAll('tr'))
        .map((tr) => {
          const cells = Array.from(tr.children)
            .filter((child) => child.matches('td, th'))
            .map(directCellText)
            .filter(Boolean);
          return {
            cells,
            rowText: cells.join(' ').replace(/\s+/g, ' ').trim(),
          };
        })
        .filter((row) => /\b\d{10,11}\b/.test(row.rowText) && !norm(row.rowText).includes('VERGI KIMLIK NUMARASI'));
    }).catch(() => []);

    return rawRows.map((row: any, rowIndex: number) => this.normalizeEBeyannameResultRow(row, rowIndex));
  }

  private normalizeEBeyannameResultRow(raw: { cells: string[]; rowText: string }, rowIndex: number): EBeyannameResultRow {
    const cells = (raw.cells || []).map((cell) => String(cell || '').trim()).filter(Boolean);
    const taxIndex = cells.findIndex((cell) => /\b\d{10,11}\b/.test(cell));
    const taxNumber = taxIndex >= 0 ? (cells[taxIndex].match(/\b\d{10,11}\b/) || [null])[0] : null;
    const beyanTipiRaw = taxIndex > 0 ? cells[taxIndex - 1] : cells.find((cell) => /KDV|MUH|DAMGA|GECICI|GE[CÇ]ICI|KURUMLAR|GELIR|OTV|OIV|POSET/i.test(cell)) || null;
    const mahiyetText = cells.find((cell) => {
      const key = this.normalizeTextKey(cell);
      return /ASIL|DUZELTME|IHTIRAZ|EK/.test(key);
    }) || null;
    const taxpayerName = taxIndex >= 0 ? cells[taxIndex + 1] || null : null;
    const taxOffice = taxIndex >= 0 ? cells[taxIndex + 2] || null : null;
    const taxPeriod = cells.find((cell) => /\b\d{2}\/\d{4}\s*-\s*\d{2}\/\d{4}\b/.test(cell)) || null;
    const uploadTime = cells.find((cell) => /\b\d{2}\.\d{2}\.\d{4}\b/.test(cell)) || null;
    const statusText = cells.find((cell) => /onay|hata|bekl|iptal/i.test(this.normalizeTextKey(cell))) || null;
    const isCorrection = this.isEBeyannameCorrectionText(`${raw.rowText} ${mahiyetText || ''}`);

    return {
      rowIndex,
      cells,
      rowText: raw.rowText,
      beyanTipiRaw,
      mahiyetText,
      isCorrection,
      taxNumber,
      taxpayerName,
      taxOffice,
      taxPeriod,
      uploadTime,
      statusText,
    };
  }

  private declarationFromEBeyannameRow(
    row: EBeyannameResultRow,
    status: EBeyannameStatus,
    taxpayers: TaxpayerMatch[],
    job: any,
    files?: { beyanname?: EBeyannameFilePayload | null; tahakkuk?: EBeyannameFilePayload | null },
  ) {
    const contextText = [
      row.rowText,
      row.beyanTipiRaw,
      row.taxNumber,
      row.taxpayerName,
      row.taxPeriod,
      row.uploadTime,
    ].filter(Boolean).join(' ');
    const taxpayerId = this.matchTaxpayerId(contextText, taxpayers);
    if (!taxpayerId) return null;

    const taxpayer = taxpayers.find((item) => item.id === taxpayerId) || null;
    const beyanTipi = this.guessBeyanTipi(row.beyanTipiRaw || row.rowText, taxpayer);
    const donem = this.ebeyannameDonemFromRow(row, beyanTipi, job);
    const beyanTarihi = this.parseEBeyannameUploadTime(row.uploadTime) || job.periodEnd || new Date().toISOString();

    return {
      taxpayerId,
      beyanTipi,
      donem,
      status,
      beyanTarihi,
      tahakkukTutari: null,
      onayNo: null,
      beyannameBase64: files?.beyanname?.base64 || null,
      tahakkukBase64: files?.tahakkuk?.base64 || null,
      xmlBase64: null,
      beyannameFileName: files?.beyanname?.fileName || null,
      tahakkukFileName: files?.tahakkuk?.fileName || null,
      raw: {
        runner: 'railway',
        source: 'ebeyanname-beyanname-ara',
        status,
        rowText: this.compact(row.rowText),
        forceRefresh: this.shouldRefreshExistingEBeyanname(job),
        cells: row.cells,
        beyanTipiRaw: row.beyanTipiRaw,
        mahiyet: row.mahiyetText,
        isCorrection: row.isCorrection,
        taxNumber: row.taxNumber,
        taxpayerName: row.taxpayerName,
        taxOffice: row.taxOffice,
        taxPeriod: row.taxPeriod,
        uploadTime: row.uploadTime,
      },
    };
  }

  private ebeyannameIdentityFromRow(
    row: EBeyannameResultRow,
    taxpayers: TaxpayerMatch[],
    job: any,
  ): EBeyannameRowIdentity | null {
    const contextText = [
      row.rowText,
      row.beyanTipiRaw,
      row.taxNumber,
      row.taxpayerName,
      row.taxPeriod,
      row.uploadTime,
    ].filter(Boolean).join(' ');
    const taxpayerId = this.matchTaxpayerId(contextText, taxpayers);
    if (!taxpayerId) return null;

    const taxpayer = taxpayers.find((item) => item.id === taxpayerId) || null;
    const beyanTipi = this.guessBeyanTipi(row.beyanTipiRaw || row.rowText, taxpayer);
    const donem = this.ebeyannameDonemFromRow(row, beyanTipi, job);
    return { taxpayerId, beyanTipi, donem, isCorrection: row.isCorrection };
  }

  private async existingBeyanKaydiFiles(tenantId: string, identity: EBeyannameRowIdentity | null) {
    if (!identity) return null;
    return (this.prisma as any).beyanKaydi.findUnique({
      where: {
        tenantId_taxpayerId_beyanTipi_donem: {
          tenantId,
          taxpayerId: identity.taxpayerId,
          beyanTipi: identity.beyanTipi,
          donem: identity.donem,
        },
      },
      select: { id: true, beyannameUrl: true, pdfUrl: true, onayNo: true },
    });
  }

  private async collectApprovedEBeyannamePages(
    tenantId: string,
    page: any,
    downloadsPath: string,
    taxpayers: TaxpayerMatch[],
    job: any,
    notes: string[],
  ) {
    const declarations: any[] = [];
    const documents: any[] = [];
    let persistedCount = 0;
    const maxRows = Math.max(1, Math.min(3000, Number(process.env.PORTAL_AUTOMATION_EBEYANNAME_MAX_APPROVED_ROWS || 1000)));
    let processedRows = 0;
    let pageNo = 0;

    while (processedRows < maxRows && pageNo < 120) {
      pageNo++;
      const pagePagination = await this.readEBeyannamePagination(page);
      const totalRows = Math.min(maxRows, pagePagination?.total || maxRows);
      const rows = await this.parseEBeyannameResultRows(page);
      await this.maybeLogEBeyannameJsDebug(await this.findEBeyannameResultTarget(page) || page);
      notes.push(`onaylandi sayfa ${pageNo}: ${rows.length} satir`);
      await this.jobProgress(tenantId, job, 'approved_page', `Onaylandi listesi sayfa ${pageNo}: ${rows.length} satir okunuyor.`, {
        current: Math.min(processedRows, totalRows),
        total: totalRows,
        records: processedRows,
      });

      // 1) PLAN: kimlik + DB kontrolu + satir locator (seri — DOM/DB okumalari)
      const rowPlans: Array<{
        row: any;
        identity: any;
        skipBeyanname: boolean;
        skipTahakkuk: boolean;
        rowLocator: any;
        seq: number;
      }> = [];
      for (const row of rows) {
        if (processedRows >= maxRows) break;
        processedRows++;
        if (processedRows === 1 || processedRows % 10 === 0) {
          await this.jobProgress(tenantId, job, 'approved_scan', `Onaylandi liste taraniyor: ${processedRows}. satir.`, {
            current: Math.min(processedRows, totalRows),
            total: totalRows,
            records: processedRows,
          });
        }

        const planned = await this.withTimeout((async () => {
          const identity = this.ebeyannameIdentityFromRow(row, taxpayers, job);
          const existing = await this.existingBeyanKaydiFiles(tenantId, identity);
          const skipExisting = !!existing && !identity?.isCorrection && !this.shouldRefreshExistingEBeyanname(job);
          const skipBeyanname = skipExisting && !!existing.beyannameUrl;
          const skipTahakkuk = skipExisting && !!existing.pdfUrl;
          if (skipBeyanname && skipTahakkuk) {
            notes.push(`onaylandi: ${identity?.beyanTipi || '-'} ${identity?.donem || '-'} ${row.taxNumber || row.taxpayerName || ''} zaten var, tekrar indirilmedi`);
            return null;
          }

          const rowLocator = await this.findEBeyannameResultRowLocator(await this.findEBeyannameResultTarget(page) || page, row);
          return { row, identity, skipBeyanname, skipTahakkuk, rowLocator, seq: processedRows };
        })(), this.ebeyannameRowPlanTimeoutMs(), () => null).catch((err) => {
          notes.push(`onaylandi: ${processedRows}. satir planlanamadi: ${this.compact(err?.message || err)}`);
          return null;
        });
        if (planned) rowPlans.push(planned);
      }

      // 2) PARALEL ON-GETIRME — IKI ASAMA:
      //    (2a) SERI: DOM'dan dosya URL'lerini topla. Tek bir Playwright page'ine ESZAMANLI DOM erisimi
      //         kararsizliga/donmaya yol actigi icin enumerate/locator islemleri seri yapilir.
      //    (2b) PARALEL: sadece HTTP indirme (page.context().request.get) — sayfadan bagimsiz, guvenle paralel.
      const directCache = new Map<string, EBeyannameFileDownloadResult>();
      if (this.ebeyannameParallelEnabled() && this.ebeyannameFastDirectFetch() && rowPlans.length) {
        await this.jobProgress(tenantId, job, 'approved_resolve', 'Belge linkleri taraniyor.');
        // TOKEN oturum boyunca sabittir; bir kez cikar, tum satirlarda kullan.
        const resultTarget = await this.findEBeyannameResultTarget(page) || page;
        const sessionToken = await this.ebeyannameSessionToken(resultTarget).catch(() => null);
        const urlTasks: Array<{ row: any; kind: 'beyanname' | 'tahakkuk'; url: string; seq: number; via: string }> = [];
        for (const plan of rowPlans) {
          const kinds: Array<'beyanname' | 'tahakkuk'> = [];
          if (!plan.skipBeyanname) kinds.push('beyanname');
          if (!plan.skipTahakkuk) kinds.push('tahakkuk');
          if (!kinds.length) continue;
          const enumerated = await this.enumerateRowFileMetas(page, plan.row, plan.rowLocator);
          if (!enumerated) continue;
          const oids = this.extractEBeyannameOids(enumerated.metas);
          for (const kind of kinds) {
            // 1) HATTAT YONTEMI: satirdaki Oid + oturum TOKEN ile dogrudan /dispatch adresini kur
            //    (tiklamasiz, en guvenilir; beyanname/tahakkuk ayri subcmd oldugu icin SWAP olmaz).
            let url = this.buildEBeyannameDispatchUrl(resultTarget, kind, oids, sessionToken);
            let via = 'dispatch';
            // 2) Yedek: Oid/TOKEN cikmazsa onclick kodunu tiklamadan calistirip window.open URL'ini yakala.
            if (!url) {
              const picked = this.pickEBeyannameFileCandidate(enumerated.metas, kind);
              if (picked != null) {
                const meta = enumerated.metas.find((m: any) => m.index === picked);
                url = (await this.withTimeout(
                  this.captureEBeyannameUrlViaOnclick(page, enumerated.candidates.nth(picked)).catch(() => null),
                  this.ebeyannameUrlResolveTimeoutMs(),
                  () => null,
                ))
                  || (meta?.href ? this.directEBeyannameUrlFromMeta(page, { href: meta.href }) : null);
                via = url ? 'onclick' : via;
              }
            }
            if (url) urlTasks.push({ row: plan.row, kind, url, seq: plan.seq, via });
          }
        }
        if (urlTasks.length) {
          await this.jobProgress(tenantId, job, 'approved_prefetch', `Belgeler sirayla indiriliyor (${urlTasks.length} dosya).`, {
            total: urlTasks.length,
          });
          // GIB iki goruntuleme arasinda en az ~1 sn ister: PARALEL DEGIL, sirali + araliklı indir.
          // Hizli/paralel gidersen GIB PDF yerine "1 sn bekleyin" uyarisi dondurur ve belge inmez.
          const gap = this.ebeyannameMinFetchGapMs();
          let lastFetchAt = 0;
          let done = 0;
          let saved = 0;
          let dispatchHit = 0;
          for (const task of urlTasks) {
            const fallbackName = `ebeyanname-${task.seq}-${task.kind}`;
            const gate = gap - (Date.now() - lastFetchAt);
            if (gate > 0) await this.wait(gate);
            let file = await this.savePdfFromRequestUrl(page, task.url, downloadsPath, fallbackName).catch(() => null);
            lastFetchAt = Date.now();
            // PDF yerine hiz-limiti uyarisi gelmis olabilir: bir kez daha (araliga uyarak) dene.
            if (!file) {
              await this.wait(gap);
              file = await this.savePdfFromRequestUrl(page, task.url, downloadsPath, fallbackName).catch(() => null);
              lastFetchAt = Date.now();
            }
            if (file) {
              saved++;
              if (task.via === 'dispatch') dispatchHit++;
              const ownerOk = await this.validateEBeyannameFileOwner(task.row, file, task.kind, notes);
              directCache.set(`${task.row.rowIndex}:${task.kind}`, { file, ownerMismatch: !ownerOk });
            }
            done++;
            if (done % 5 === 0 || done === urlTasks.length) {
              await this.jobProgress(tenantId, job, 'approved_prefetch', `Sirali indirme: ${saved}/${urlTasks.length} PDF kaydedildi.`, {
                current: done,
                total: urlTasks.length,
              });
            }
          }
          notes.push(`onaylandi sayfa ${pageNo}: ${saved}/${urlTasks.length} PDF dogrudan indirildi (dispatch=${dispatchHit}).`);
          this.logger.warn(`[EBSTAT] sayfa ${pageNo}: indirilen ${saved}/${urlTasks.length} PDF (dispatch=${dispatchHit}, onclick=${saved - dispatchHit}).`);
        }
      }

      // 3) BIRLESTIRME: on-getirilen dosyayi kullan, eksikse DOM fallback (seri).
      for (const plan of rowPlans) {
        const { row, identity, skipBeyanname, skipTahakkuk, rowLocator, seq } = plan;
        const beyannameKey = `${row.rowIndex}:beyanname`;
        const tahakkukKey = `${row.rowIndex}:tahakkuk`;
        const prefetchedBeyanname = directCache.get(beyannameKey) || null;
        const prefetchedTahakkuk = directCache.get(tahakkukKey) || null;
        if (seq === 1 || seq % 10 === 0) {
          await this.jobProgress(tenantId, job, 'approved_assemble', `Belgeler isleniyor/kaydediliyor: ${seq}. satir.`, {
            current: Math.min(seq, totalRows),
            total: totalRows,
            records: persistedCount + declarations.length + documents.length,
          });
        }
        const beyannameResult = skipBeyanname
          ? { file: null, ownerMismatch: false }
          : await this.downloadEBeyannameRowFile(page, row, 'beyanname', downloadsPath, seq, notes, rowLocator, {
              prefetched: prefetchedBeyanname,
              directOnly: false,
              skipDirect: false,
            })
            .catch((err) => {
              notes.push(`beyanname: ${seq}. satir hata nedeniyle atlandi: ${this.compact(err?.message || err)}`);
              return { file: null, ownerMismatch: false };
            });
        const tahakkukResult = skipTahakkuk
          ? { file: null, ownerMismatch: false }
          : await this.downloadEBeyannameRowFile(page, row, 'tahakkuk', downloadsPath, seq, notes, rowLocator, {
              prefetched: prefetchedTahakkuk,
              directOnly: false,
              skipDirect: false,
            })
            .catch((err) => {
              notes.push(`tahakkuk: ${seq}. satir hata nedeniyle atlandi: ${this.compact(err?.message || err)}`);
              return { file: null, ownerMismatch: false };
            });
        if (identity && beyannameResult.ownerMismatch) {
          await this.clearExistingEBeyannameFile(tenantId, identity, 'beyanname').catch((err) => {
            notes.push(`beyanname: eski hatali bag temizlenemedi: ${this.compact(err?.message || err)}`);
          });
        }
        if (identity && tahakkukResult.ownerMismatch) {
          await this.clearExistingEBeyannameFile(tenantId, identity, 'tahakkuk').catch((err) => {
            notes.push(`tahakkuk: eski hatali bag temizlenemedi: ${this.compact(err?.message || err)}`);
          });
        }
        let beyanname = beyannameResult.ownerMismatch ? null : beyannameResult.file;
        let tahakkuk = tahakkukResult.ownerMismatch ? null : tahakkukResult.file;
        // SWAP DUZELTME: GIB'de beyanname/tahakkuk PDF pencereleri capture sirasinda karisabiliyor.
        // Indirilen PDF'in icerigine bakip NET ters yerlesim varsa beyanname<->tahakkuk yer degistir.
        if (this.ebeyannameSwapDetectEnabled()) {
          try {
            const fixed = await this.fixEBeyannameTahakkukSwap(beyanname, tahakkuk, notes, seq);
            beyanname = fixed.beyanname;
            tahakkuk = fixed.tahakkuk;
          } catch { /* icerik okunamazsa oldugu gibi birak */ }
        }
        if (!beyanname && !tahakkuk && (!skipBeyanname || !skipTahakkuk)) {
          notes.push(`onaylandi: ${seq}. satir PDF alinamadigi icin bos beyan kaydi yazilmadi`);
          continue;
        }
        const declaration = this.declarationFromEBeyannameRow(row, 'onaylandi', taxpayers, job, { beyanname, tahakkuk });
        if (!declaration && (beyanname || tahakkuk)) {
          this.logger.warn(`[EBSTAT] ESLESMEDI: satir ${seq} vkn=${row.taxNumber || '-'} ad="${this.compact(row.taxpayerName || '').slice(0, 40)}" tip="${this.compact(row.beyanTipiRaw || '').slice(0, 24)}" -> eslesmeyen belgeye dustu`);
          await this.diagnoseEBeyannameUnmatch(tenantId, row);
        }

        const unmatchedFiles = [
          { file: beyannameResult.file, kind: 'beyanname', ownerMismatch: beyannameResult.ownerMismatch },
          { file: tahakkukResult.file, kind: 'tahakkuk', ownerMismatch: tahakkukResult.ownerMismatch },
        ].filter((item) => item.file && (!declaration || item.ownerMismatch)) as Array<{ file: EBeyannameFilePayload; kind: 'beyanname' | 'tahakkuk'; ownerMismatch: boolean }>;
        for (const item of unmatchedFiles) {
          documents.push({
            taxpayerId: null,
            belgeTuru: item.kind === 'tahakkuk' ? 'GIB_TAHAKKUK' : 'GIB_BEYANNAME',
            title: item.file.fileName,
            period: this.ebeyannameDonemFromRow(row, this.guessBeyanTipi(row.beyanTipiRaw || row.rowText), job),
            issuedAt: this.parseEBeyannameUploadTime(row.uploadTime) || job.periodEnd || null,
            receivedAt: new Date().toISOString(),
            mimeType: item.file.mimeType,
            originalName: item.file.fileName,
            base64: item.file.base64,
            raw: {
              runner: 'railway',
              source: 'ebeyanname-beyanname-ara',
              matchedTaxpayer: false,
              ownerMismatch: item.ownerMismatch,
              rowText: this.compact(row.rowText),
              taxNumber: row.taxNumber,
              taxpayerName: row.taxpayerName,
              beyanTipi: this.guessBeyanTipi(row.beyanTipiRaw || row.rowText),
            },
          });
        }
        if (declaration) declarations.push(declaration);

        if (declarations.length + documents.length >= this.ebeyannamePartialFlushSize()) {
          persistedCount += await this.flushPartialEBeyannameResults(tenantId, job, declarations, documents, notes);
        }
      }

      const pagination = await this.readEBeyannamePagination(page);
      if (!pagination || pagination.end >= pagination.total) break;
      const moved = await this.clickEBeyannameNextPage(page, pagination);
      if (!moved) {
        notes.push(`onaylandi: sonraki sayfaya gecilemedi (${pagination.start}-${pagination.end}/${pagination.total})`);
        break;
      }
    }

    notes.push(`onaylandi: ${processedRows} satir islendi, ${persistedCount + declarations.length} takip kaydi eslendi, ${documents.length} eslesmeyen belge`);
    this.logger.warn(`[EBSTAT] onaylandi ozet: ${processedRows} satir islendi, ${persistedCount + declarations.length} firmaya eslendi, ${documents.length} eslesmeyen belge.`);
    return { declarations, documents, persistedCount };
  }

  private ebeyannamePartialFlushSize() {
    return Math.max(1, Math.min(50, Number(process.env.PORTAL_AUTOMATION_EBEYANNAME_PARTIAL_FLUSH_ROWS || 10)));
  }

  private async flushPartialEBeyannameResults(
    tenantId: string,
    job: any,
    declarations: any[],
    documents: any[],
    notes: string[],
  ) {
    if (!declarations.length && !documents.length) return 0;
    const decls = declarations.splice(0, declarations.length);
    const docs = documents.splice(0, documents.length);
    try {
      const saved = await this.portalAutomation.savePartialJobResults(tenantId, job.id, { declarations: decls, documents: docs });
      if (saved > 0) notes.push(`ara kayit: ${saved} belge/beyanname DB'ye yazildi`);
      return saved;
    } catch (err: any) {
      declarations.unshift(...decls);
      documents.unshift(...docs);
      notes.push(`ara kayit yazilamadi: ${this.compact(err?.message || err)}`);
      return 0;
    }
  }

  private async collectStatusOnlyEBeyannamePages(page: any, status: EBeyannameStatus, notes: string[]) {
    const rows: EBeyannameResultRow[] = [];
    const maxRows = Math.max(1, Math.min(3000, Number(process.env.PORTAL_AUTOMATION_EBEYANNAME_MAX_STATUS_ROWS || 1000)));
    let pageNo = 0;

    while (rows.length < maxRows && pageNo < 120) {
      pageNo++;
      const pageRows = await this.parseEBeyannameResultRows(page);
      rows.push(...pageRows.slice(0, Math.max(0, maxRows - rows.length)));

      const pagination = await this.readEBeyannamePagination(page);
      if (!pagination || pagination.end >= pagination.total) break;
      const moved = await this.clickEBeyannameNextPage(page, pagination);
      if (!moved) {
        notes.push(`${status}: sonraki sayfaya gecilemedi (${pagination.start}-${pagination.end}/${pagination.total})`);
        break;
      }
    }

    return rows;
  }

  private async downloadEBeyannameRowFile(
    page: any,
    resultRow: EBeyannameResultRow,
    kind: 'beyanname' | 'tahakkuk',
    downloadsPath: string,
    sequence: number,
    notes: string[],
    rowLocator?: any,
    opts?: { directOnly?: boolean; prefetched?: EBeyannameFileDownloadResult | null; skipDirect?: boolean },
  ): Promise<EBeyannameFileDownloadResult> {
    // Paralel on-getirme fazinda bu satir+tur zaten indirildiyse tekrar indirme.
    if (opts?.prefetched && opts.prefetched.file) return opts.prefetched;

    const enumerated = await this.enumerateRowFileMetas(page, resultRow, rowLocator);
    if (!enumerated) {
      if (!opts?.directOnly) notes.push(`${kind}: satir ${resultRow.rowIndex + 1} gorunur degil`);
      return { file: null, ownerMismatch: false };
    }
    const { candidates, metas } = enumerated;

    const picked = this.pickEBeyannameFileCandidate(metas, kind);
    if (picked == null) {
      if (!opts?.directOnly) notes.push(`${kind}: satir ${resultRow.rowIndex + 1} icin PDF ikonu bulunamadi`);
      return { file: null, ownerMismatch: false };
    }

    const loc = candidates.nth(picked);
    const fallbackName = `ebeyanname-${sequence}-${kind}`;
    // [EBDBG] Teshis: ilk satirlarda butonlarin gercek yapisini + hangi adayin secildigini logla.
    if (this.ebeyannameDebugEnabled() && sequence <= 8) {
      const summary = metas
        .map((m: any) => `[${m.index}${m.index === picked ? '*' : ''}]${m.tag}|t="${this.compact(m.text).slice(0, 28)}"|h="${this.compact(m.href).slice(0, 70)}"|oc="${this.compact(m.onclick).slice(0, 70)}"`)
        .join('  ||  ');
      this.logger.warn(`[EBDBG] satir ${resultRow.rowIndex + 1} kind=${kind} picked=${picked} vkn=${resultRow.taxNumber} :: ${summary}`);
    }
    const meta = metas.find((item: any) => item.index === picked);

    // 1) EN GUVENILIR YOL: onclick icindeki beyannameGoruntule/tahakkukGoruntule zincirini
    //    gercek tiklama yapmadan calistir, window.open URL'ini yakala ve HTTP ile indir.
    let viaResolvedUrl: EBeyannameFilePayload | null = null;
    if (!opts?.skipDirect && this.ebeyannameFastDirectFetch()) {
      const resolvedUrl = (await this.withTimeout(
        this.captureEBeyannameUrlViaOnclick(page, loc).catch(() => null),
        this.ebeyannameUrlResolveTimeoutMs(),
        () => null,
      ))
        || (meta?.href ? this.directEBeyannameUrlFromMeta(page, { href: meta.href }) : null);
      if (resolvedUrl) {
        if (this.ebeyannameDebugEnabled() && sequence <= 8) {
          this.logger.warn(`[EBDBG] ${fallbackName} resolved=${this.safeUrl(resolvedUrl)}`);
        }
        viaResolvedUrl = await this.savePdfFromRequestUrl(page, resolvedUrl, downloadsPath, fallbackName).catch(() => null);
      }
    }

    // 2) Fallback: bazi eski/degisik ekranlarda onclick dogrudan calismayabilir; o zaman
    //    gercek tiklamadan once window.open'u intercept et.
    let viaClick: EBeyannameFilePayload | null = null;
    if (!viaResolvedUrl && !opts?.directOnly && !opts?.skipDirect && this.ebeyannameFastDirectFetch()) {
      const clickUrl = await this.withTimeout(
        this.captureEBeyannameUrlViaClick(page, loc).catch(() => null),
        this.ebeyannameUrlResolveTimeoutMs(),
        () => null,
      );
      if (clickUrl) {
        if (this.ebeyannameDebugEnabled() && sequence <= 8) {
          this.logger.warn(`[EBDBG] ${fallbackName} clickUrl=${this.safeUrl(clickUrl)}`);
        }
        viaClick = await this.savePdfFromRequestUrl(page, clickUrl, downloadsPath, fallbackName).catch(() => null);
      }
    }
    const direct = viaResolvedUrl || viaClick || (opts?.skipDirect || !this.ebeyannameFastDirectFetch()
      ? null
      : await this.tryDownloadEBeyannameDirect(page, meta, downloadsPath, fallbackName).catch((err) => {
          if (!opts?.directOnly) notes.push(`${kind}: satir ${resultRow.rowIndex + 1} dogrudan PDF denemesi basarisiz: ${this.compact(err?.message || err)}`);
          return null;
        }));
    // directOnly modunda (paralel on-getirme) tarayici tiklamasi yapilmaz; DOM fallback seri birlestirme fazinda calisir.
    const clicked = direct || (opts?.directOnly
      ? null
      : await this.captureEBeyannameDownload(page, loc, downloadsPath, fallbackName).catch((err) => {
          notes.push(`${kind}: satir ${resultRow.rowIndex + 1} PDF indirme hatasi: ${this.compact(err?.message || err)}`);
          return null;
        }));
    if (this.ebeyannameDebugEnabled() && sequence <= 8) {
      const bytes = clicked?.base64 ? Buffer.from(clicked.base64, 'base64').length : 0;
      this.logger.warn(`[EBDBG] satir ${resultRow.rowIndex + 1} kind=${kind} sonuc: direct=${!!direct} clicked=${!!clicked} bytes=${bytes} file="${clicked?.fileName || '-'}"`);
    }
    if (!clicked) {
      if (!opts?.directOnly) notes.push(`${kind}: satir ${resultRow.rowIndex + 1} tiklandi ama PDF alinamadi`);
      return { file: null, ownerMismatch: false };
    }
    const ownerOk = await this.validateEBeyannameFileOwner(resultRow, clicked, kind, notes);
    return { file: clicked, ownerMismatch: !ownerOk };
  }

  /**
   * Onclick kodunu gercek mouse tiklamasi yapmadan calistirir ve GIB'in uretecegi PDF URL'ini yakalar.
   * Boylece popup/download event yarisi olmadan URL'ler toplanip HTTP ile paralel indirilebilir.
   */
  private async captureEBeyannameUrlViaOnclick(page: any, loc: any): Promise<string | null> {
    const captured = await loc.evaluate(async (el: any) => {
      const target = (el.getAttribute?.('onclick') ? el : el.closest?.('[onclick]')) || el;
      const onclick = String(target.getAttribute?.('onclick') || '').trim();
      if (!onclick) return null;

      const w = window as any;
      const originalOpen = w.open;
      const originalCallMenuUrlPopUp = w.callMenuUrlPopUp;
      let capturedUrl: string | null = null;
      const remember = (url: any) => {
        const text = String(url || '').trim();
        if (text) capturedUrl = text;
      };
      const noop = function () { return stub; };
      const stub: any = new Proxy({}, {
        get: (_obj, prop) => (prop === 'closed' ? false : noop),
        set: () => true,
      });

      try {
        w.open = function (url: any) {
          remember(url);
          return stub;
        };
        if (typeof originalCallMenuUrlPopUp === 'function') {
          w.callMenuUrlPopUp = function (...args: any[]) {
            try {
              return originalCallMenuUrlPopUp.apply(this, args);
            } catch {
              remember(args[0]);
              return stub;
            }
          };
        }

        const event = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
        const code = onclick.replace(/^javascript:/i, '');
        const fn = new Function('event', code);
        fn.call(target, event);
        await new Promise((resolve) => setTimeout(resolve, 50));
        return capturedUrl ? { url: capturedUrl, base: window.location.href } : null;
      } catch {
        return capturedUrl ? { url: capturedUrl, base: window.location.href } : null;
      } finally {
        w.open = originalOpen;
        if (typeof originalCallMenuUrlPopUp === 'function') {
          w.callMenuUrlPopUp = originalCallMenuUrlPopUp;
        } else {
          try { delete w.callMenuUrlPopUp; } catch { w.callMenuUrlPopUp = originalCallMenuUrlPopUp; }
        }
      }
    }).catch(() => null);
    const raw = captured?.url || null;
    if (!raw) return null;
    try {
      const abs = new URL(String(raw), String(captured?.base || page.url?.() || '')).toString();
      return /^https?:/i.test(abs) ? abs : null;
    } catch {
      return null;
    }
  }

  /**
   * Ikona tiklayinca uygulamanin window.open ile uretecegi gercek PDF URL'ini yakalar (popup acmadan).
   * GIB e-Beyanname'de PDF linkleri href degil, onclick -> callMenuUrlPopUp -> window.open(url) seklinde.
   */
  private async captureEBeyannameUrlViaClick(page: any, loc: any): Promise<string | null> {
    await page.evaluate(() => {
      const w = window as any;
      if (!w.__morenOrigOpen) w.__morenOrigOpen = w.open;
      w.__morenCapturedUrl = null;
      w.open = function (url: any) {
        try { if (url) w.__morenCapturedUrl = String(url); } catch (e) { /* yoksay */ }
        const noop = function () { return stub; };
        const stub: any = new Proxy({}, { get: () => noop, set: () => true });
        return stub;
      };
    }).catch(() => {});
    await loc.click({ timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(200).catch(() => {});
    const raw = await page.evaluate(() => {
      const w = window as any;
      const u = w.__morenCapturedUrl || null;
      if (w.__morenOrigOpen) w.open = w.__morenOrigOpen;
      w.__morenCapturedUrl = null;
      return u;
    }).catch(() => null);
    if (!raw) return null;
    try {
      const abs = new URL(String(raw), String(page.url?.() || '')).toString();
      return /^https?:/i.test(abs) ? abs : null;
    } catch {
      return null;
    }
  }

  /** PDF metnine bakarak dosyanin tahakkuk mi beyanname mi oldugunu tahmin eder. */
  private async detectEBeyannameDocType(file: EBeyannameFilePayload | null): Promise<'tahakkuk' | 'beyanname' | 'bilinmiyor'> {
    if (!file?.base64 || !/pdf/i.test(file.mimeType || file.fileName || '')) return 'bilinmiyor';
    const text = await this.pdfTextFromBase64(file.base64).catch(() => '');
    const key = this.normalizeTextKey(text);
    if (!key) return 'bilinmiyor';
    if (/TAHAKKUKFISI|TAHAKKUKFIS|VERGININTAHAKKUK|TAHAKKUKNO|ODENECEKTUTAR|TAHAKKUKEDENVERGI/.test(key)) return 'tahakkuk';
    if (/BEYANNAME|MATRAH|BEYANEDILEN|VERGIBILDIRIMI/.test(key)) return 'beyanname';
    return 'bilinmiyor';
  }

  /** Beyanname/tahakkuk PDF'leri ters yerlesmisse (NET tespit edilirse) yerlerini degistirir. */
  private async fixEBeyannameTahakkukSwap(
    beyanname: EBeyannameFilePayload | null,
    tahakkuk: EBeyannameFilePayload | null,
    notes: string[],
    seq: number,
  ): Promise<{ beyanname: EBeyannameFilePayload | null; tahakkuk: EBeyannameFilePayload | null }> {
    if (!beyanname && !tahakkuk) return { beyanname, tahakkuk };
    const [bType, tType] = await Promise.all([
      this.detectEBeyannameDocType(beyanname),
      this.detectEBeyannameDocType(tahakkuk),
    ]);
    // Sadece NET ters yerlesim varsa swap et; belirsizse dokunma (yanlis duzeltme yapma).
    if (bType === 'tahakkuk' && tType === 'beyanname') {
      notes.push(`swap duzeltildi: ${seq}. satir beyanname<->tahakkuk yer degistirildi`);
      return { beyanname: tahakkuk, tahakkuk: beyanname };
    }
    return { beyanname, tahakkuk };
  }

  /**
   * Bir sonuc satirindaki indirilebilir ogelerin meta verilerini TEK evaluate cagrisiyla toplar.
   * Onceki kod her oge icin ayri evaluate yapip satir basina 6-8 round-trip uretiyordu; bu tek atista yapar.
   */
  private async enumerateRowFileMetas(
    page: any,
    resultRow: EBeyannameResultRow,
    rowLocator?: any,
  ): Promise<{
    candidates: any;
    metas: Array<{ index: number; tag: string; text: string; href: string; src: string; onclick: string; haystack: string }>;
  } | null> {
    const row = rowLocator || await this.findEBeyannameResultRowLocator(await this.findEBeyannameResultTarget(page) || page, resultRow);
    if (!(await row.isVisible().catch(() => false))) return null;
    const candidates = row.locator('a, button, input[type="button"], input[type="image"], img');
    const metas = await candidates.evaluateAll((els: any[]) =>
      els.map((el: any, index: number) => {
        const tag = String(el.tagName || '').toUpperCase();
        const text = `${el.innerText || el.value || el.alt || el.title || el.getAttribute?.('aria-label') || ''}`.trim();
        const href = el.getAttribute?.('href') || '';
        const src = el.getAttribute?.('src') || '';
        const onclick = el.getAttribute?.('onclick') || '';
        const haystack = [
          text,
          href,
          src,
          onclick,
          el.getAttribute?.('title') || '',
          el.getAttribute?.('alt') || '',
          el.outerHTML || '',
        ].join(' ');
        return { index, tag, text, href, src, onclick, haystack: haystack.slice(0, 1200) };
      }),
    ).catch(() => [] as any[]);
    return { candidates, metas };
  }

  private ebeyannameParallelEnabled() {
    const raw = String(process.env.PORTAL_AUTOMATION_EBEYANNAME_PARALLEL ?? '1').trim().toLowerCase();
    return raw !== '0' && raw !== 'false' && raw !== 'no' && raw !== 'off';
  }

  private ebeyannameConcurrency() {
    return Math.max(1, Math.min(10, Number(process.env.PORTAL_AUTOMATION_EBEYANNAME_CONCURRENCY || 4)));
  }

  private ebeyannameRowPlanTimeoutMs() {
    return Math.max(2_000, Math.min(30_000, Number(process.env.PORTAL_AUTOMATION_EBEYANNAME_ROW_PLAN_TIMEOUT_MS || 6_000)));
  }

  private ebeyannameUrlResolveTimeoutMs() {
    return Math.max(500, Math.min(10_000, Number(process.env.PORTAL_AUTOMATION_EBEYANNAME_URL_RESOLVE_TIMEOUT_MS || 2_500)));
  }

  private ebeyannameLocatorTimeoutMs() {
    return Math.max(500, Math.min(10_000, Number(process.env.PORTAL_AUTOMATION_EBEYANNAME_LOCATOR_TIMEOUT_MS || 1_500)));
  }

  /** Sinirli eseszamanlilikla items uzerinde worker calistirir (havuz modeli). */
  private async mapWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<void>,
  ): Promise<void> {
    if (!items.length) return;
    const max = Math.max(1, Math.min(limit, items.length));
    let cursor = 0;
    const runners = Array.from({ length: max }, async () => {
      while (true) {
        const current = cursor++;
        if (current >= items.length) return;
        await worker(items[current], current).catch(() => {});
      }
    });
    await Promise.all(runners);
  }

  private ebeyannameFileTimeoutMs() {
    return Math.max(5_000, Math.min(180_000, Number(process.env.PORTAL_AUTOMATION_EBEYANNAME_FILE_TIMEOUT_MS || 10_000)));
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => Promise<T> | T): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    const timeout = new Promise<T>((resolve) => {
      timer = setTimeout(async () => resolve(await onTimeout()), timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private shouldRefreshExistingEBeyanname(job: any) {
    const raw = process.env.PORTAL_AUTOMATION_EBEYANNAME_FORCE_REFRESH;
    if (raw != null) return this.envFlag(raw);
    return job?.source === 'manual' && job?.payload?.force === true;
  }

  private async clearExistingEBeyannameFile(
    tenantId: string,
    identity: EBeyannameRowIdentity,
    kind: 'beyanname' | 'tahakkuk',
  ) {
    await (this.prisma as any).beyanKaydi.updateMany({
      where: {
        tenantId,
        taxpayerId: identity.taxpayerId,
        beyanTipi: identity.beyanTipi,
        donem: identity.donem,
      },
      data: kind === 'beyanname' ? { beyannameUrl: null } : { pdfUrl: null },
    });
  }

  private async findEBeyannameResultRowLocator(target: any, row: EBeyannameResultRow) {
    const rows = target.locator('tr');
    const count = Math.min(await rows.count().catch(() => 0), 1000);
    let best: any = null;
    let bestScore = -1;
    let taxRowOrdinal = 0;
    for (let i = 0; i < count; i++) {
      const candidate = rows.nth(i);
      const text = await this.locatorDirectRowText(candidate);
      if (!/\b\d{10,11}\b/.test(text)) continue;
      if (this.normalizeTextKey(text).includes('VERGI KIMLIK NUMARASI')) continue;
      let score = this.ebeyannameRowMatchScore(text, row);
      if (taxRowOrdinal === row.rowIndex) score += 20;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
      taxRowOrdinal++;
      if (score >= 100) break;
    }
    if (best) return best;
    return rows.nth(Math.max(0, row.rowIndex));
  }

  private async locatorText(locator: any) {
    return locator.evaluate(
      (el: any) => String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim(),
      undefined,
      { timeout: this.ebeyannameLocatorTimeoutMs() },
    ).catch(() => '');
  }

  private async locatorDirectRowText(locator: any) {
    return locator.evaluate(
      (el: any) => {
        const cells = Array.from(el?.children || [])
          .filter((child: any) => child?.matches?.('td, th'))
          .map((cell: any) => {
            const clone = cell.cloneNode(true);
            clone.querySelectorAll?.('table')?.forEach((nested: any) => nested.remove());
            return String(clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
          })
          .filter(Boolean);
        return cells.join(' ').replace(/\s+/g, ' ').trim();
      },
      undefined,
      { timeout: this.ebeyannameLocatorTimeoutMs() },
    ).catch(() => '');
  }

  private ebeyannameRowMatchScore(text: string, row: EBeyannameResultRow) {
    const digits = String(text || '').replace(/\D/g, '');
    const key = this.normalizeTextKey(text);
    let score = 0;
    if (row.taxNumber && digits.includes(row.taxNumber.replace(/\D/g, ''))) score += 60;
    if (row.beyanTipiRaw && key.includes(this.normalizeTextKey(row.beyanTipiRaw))) score += 15;
    if (row.taxPeriod && key.includes(this.normalizeTextKey(row.taxPeriod))) score += 15;
    if (row.uploadTime && key.includes(this.normalizeTextKey(row.uploadTime))) score += 10;
    if (row.mahiyetText && key.includes(this.normalizeTextKey(row.mahiyetText))) score += 5;
    return score;
  }

  private async validateEBeyannameFileOwner(
    row: EBeyannameResultRow,
    file: EBeyannameFilePayload,
    kind: 'beyanname' | 'tahakkuk',
    notes: string[],
  ) {
    if (!this.shouldValidateEBeyannameOwnerInRunner()) return true;
    const expectedTaxNumber = (row.taxNumber || '').replace(/\D/g, '');
    if (!expectedTaxNumber || !/pdf/i.test(file.mimeType || file.fileName || '')) return true;

    const text = await this.pdfTextFromBase64(file.base64).catch((err) => {
      notes.push(`${kind}: satir ${row.rowIndex + 1} PDF VKN kontrolu yapilamadi: ${this.compact(err?.message || err)}`);
      return '';
    });
    const compactDigits = text.replace(/\D/g, '');
    if (compactDigits.includes(expectedTaxNumber)) return true;

    const seenTaxNumbers = Array.from(new Set(Array.from(text.matchAll(/\b\d{10,11}\b/g)).map((m) => m[0])));
    if (seenTaxNumbers.length) {
      notes.push(`${kind}: satir ${row.rowIndex + 1} PDF VKN uyusmadi; beklenen ${expectedTaxNumber}, PDF ${seenTaxNumbers.slice(0, 3).join(', ')}. Kayda baglanmadi.`);
      return false;
    }
    notes.push(`${kind}: satir ${row.rowIndex + 1} PDF icinde VKN/TCKN okunamadi; net farkli VKN bulunmadigi icin kayda baglandi (${expectedTaxNumber}).`);
    return true;
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
    if (text.length >= 20 || !this.ebeyannamePdfOcrFallbackEnabled()) return text;
    const ocrText = await this.azureReadPdfText(buffer).catch((err) => {
      this.logger.warn(`e-Beyanname PDF OCR fallback hata: ${err?.message || err}`);
      return '';
    });
    return String(ocrText || '').replace(/\s+/g, ' ').trim() || text;
  }

  private ebeyannamePdfOcrFallbackEnabled() {
    const raw = process.env.PORTAL_AUTOMATION_EBEYANNAME_PDF_OCR_FALLBACK;
    if (raw != null) return this.envFlag(raw);
    return !!(process.env.AZURE_VISION_KEY && process.env.AZURE_VISION_ENDPOINT);
  }

  private ebeyannameSwapDetectEnabled() {
    const raw = process.env.PORTAL_AUTOMATION_EBEYANNAME_SWAP_DETECT;
    if (raw != null) return this.envFlag(raw);
    return !this.ebeyannameFastDirectFetch();
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
      await this.wait(500);
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

  private shouldValidateEBeyannameOwnerInRunner() {
    const raw = String(process.env.PORTAL_AUTOMATION_EBEYANNAME_RUNNER_VALIDATE_PDF_OWNER || '').trim().toLowerCase();
    return !['0', 'false', 'no', 'off'].includes(raw);
  }

  private ebeyannameDebugEnabled() {
    const raw = String(process.env.PORTAL_AUTOMATION_EBEYANNAME_DEBUG || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'on', 'evet'].includes(raw);
  }

  private ebeyannameJsDebugEnabled() {
    const raw = String(process.env.PORTAL_AUTOMATION_EBEYANNAME_JS_DEBUG || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'on', 'evet'].includes(raw);
  }

  private async maybeLogEBeyannameJsDebug(target: any) {
    if (!this.ebeyannameJsDebugEnabled() || this.ebeyannameJsDebugLogged) return;
    this.ebeyannameJsDebugLogged = true;
    const debug = await target.evaluate(() => {
      const w = window as any;
      const names = [
        'beyannameGoruntule',
        'tahakkukGoruntule',
        'callMenuUrlPopUp',
        'getTOKEN',
        'getParameterForArsiv',
      ];
      const functions = names.map((name) => {
        const value = w[name];
        return {
          name,
          type: typeof value,
          source: typeof value === 'function' ? String(value).slice(0, 4_000) : '',
        };
      });
      const onclicks = Array.from(document.querySelectorAll<HTMLElement>('[onclick]'))
        .map((el) => String(el.getAttribute('onclick') || '').trim())
        .filter((text) => /Goruntule|Arsiv|IMAJ|TAHAKKUK|BEYANNAME/i.test(text))
        .slice(0, 12);
      const scripts = Array.from(document.scripts)
        .map((script) => script.src || `inline:${String(script.textContent || '').slice(0, 180)}`)
        .filter(Boolean)
        .slice(0, 40);
      const forms = Array.from(document.forms)
        .map((form) => ({
          name: form.getAttribute('name') || '',
          id: form.id || '',
          method: form.method || '',
          action: form.action || '',
          target: form.target || '',
          inputs: Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea'))
            .map((input) => input.name || input.id || input.getAttribute('type') || '')
            .filter(Boolean)
            .slice(0, 30),
        }))
        .slice(0, 20);
      const isVisible = (el: Element) => {
        const anyEl = el as HTMLElement;
        return !!(anyEl.offsetWidth || anyEl.offsetHeight || anyEl.getClientRects().length);
      };
      const controls = Array.from(document.querySelectorAll<HTMLElement>('a,button,input,select,span[onclick],div[onclick]'))
        .filter(isVisible)
        .map((el: any) => ({
          tag: el.tagName || '',
          type: el.getAttribute?.('type') || '',
          name: el.name || '',
          id: el.id || '',
          text: String(el.innerText || el.value || el.title || el.alt || el.placeholder || '').replace(/\s+/g, ' ').trim(),
          onclick: String(el.getAttribute?.('onclick') || '').trim(),
        }))
        .filter((item) => item.text || item.name || item.id || item.onclick)
        .slice(0, 120);
      return { url: window.location.href, functions, onclicks, scripts, forms, controls };
    }).catch((err: any) => ({ error: String(err?.message || err) }));

    this.logger.warn(`[EBDBGJS] url=${this.safeUrl(String(debug?.url || ''))} error=${this.safeDebugText(String(debug?.error || ''))}`);
    for (const fn of debug?.functions || []) {
      this.logger.warn(`[EBDBGJS] function ${fn.name} type=${fn.type} source="${this.safeDebugText(fn.source || '').slice(0, 1_500)}"`);
    }
    for (const onclick of debug?.onclicks || []) {
      this.logger.warn(`[EBDBGJS] onclick "${this.safeDebugText(onclick).slice(0, 800)}"`);
    }
    for (const form of debug?.forms || []) {
      this.logger.warn(`[EBDBGJS] form ${JSON.stringify(form).slice(0, 1_000)}`);
    }
    for (const control of debug?.controls || []) {
      this.logger.warn(`[EBDBGJS] control ${JSON.stringify(control).slice(0, 1_000)}`);
    }
    for (const script of debug?.scripts || []) {
      this.logger.warn(`[EBDBGJS] script "${this.safeUrl(String(script)).slice(0, 1_000)}"`);
    }
  }

  private pickEBeyannameFileCandidate(
    metas: Array<{ index: number; tag: string; text: string; haystack: string }>,
    kind: 'beyanname' | 'tahakkuk',
  ) {
    if (!metas.length) return null;
    const normalized = metas.map((meta) => ({
      ...meta,
      key: this.normalizeTextKey(`${meta.text} ${meta.haystack}`),
    }));
    const directIcon = normalized.find((meta) => {
      if (kind === 'beyanname') return /PDF\s*B|BEYANNAMEGORUNTULE/.test(meta.key);
      return /PDF\s*T|TAHAKKUKGORUNTULE/.test(meta.key);
    });
    if (directIcon) return directIcon.index;

    const direct = normalized.find((meta) => {
      if (kind === 'beyanname') return /BEYANNAME|BEYAN|\bB\b/.test(meta.key);
      return /TAHAKKUK|TAH|FIS|\bT\b/.test(meta.key);
    });
    if (direct) return direct.index;

    const fileActions = normalized.filter((meta) => {
      const key = meta.key;
      if (/MAIL|MESAJ|ZARF|ENVELOPE/.test(key)) return false;
      return meta.tag === 'A' || meta.tag === 'BUTTON' || meta.tag === 'INPUT' || /PDF|ADOBE|INDIR|GORUNTULE|GOSTER|DOWNLOAD/.test(key);
    });
    if (!fileActions.length) return null;
    if (kind === 'beyanname') return fileActions.length >= 2 ? fileActions[fileActions.length - 2].index : fileActions[0].index;
    return fileActions[fileActions.length - 1].index;
  }

  private async tryDownloadEBeyannameDirect(
    page: any,
    meta: { href?: string; onclick?: string } | undefined,
    downloadsPath: string,
    fallbackName: string,
  ): Promise<EBeyannameFilePayload | null> {
    if (!meta || !this.ebeyannameFastDirectFetch()) return null;
    const url = this.directEBeyannameUrlFromMeta(page, meta);
    if (!url) return null;
    return this.savePdfFromRequestUrl(page, url, downloadsPath, fallbackName);
  }

  private ebeyannameFastDirectFetch() {
    const raw = String(process.env.PORTAL_AUTOMATION_EBEYANNAME_DIRECT_FETCH ?? '1').trim().toLowerCase();
    return raw !== '0' && raw !== 'false' && raw !== 'no';
  }

  private directEBeyannameUrlFromMeta(page: any, meta: { href?: string; onclick?: string }) {
    const candidates = [
      meta.href || '',
      ...this.extractUrlCandidates(meta.onclick || ''),
    ];
    for (const candidate of candidates) {
      const cleaned = String(candidate || '').trim().replace(/&amp;/g, '&');
      if (!cleaned || /^(javascript:|#|mailto:|tel:|data:|blob:)/i.test(cleaned)) continue;
      if (!/^(https?:)?\/\//i.test(cleaned) && !cleaned.startsWith('/')) continue;
      let url = '';
      try {
        url = new URL(cleaned, String(page.url?.() || '')).toString();
      } catch {
        continue;
      }
      if (/pdf|beyan|tahakkuk|download|indir|goruntule|goster/i.test(url)) return url;
    }
    return null;
  }

  private extractUrlCandidates(value: string) {
    const text = String(value || '');
    const matches = [
      ...Array.from(text.matchAll(/https?:\/\/[^'"<>\s)]+/gi)).map((m) => m[0]),
      ...Array.from(text.matchAll(/['"]([^'"]+)['"]/g)).map((m) => m[1]),
    ];
    return matches.filter((item) => /^https?:\/\//i.test(item) || item.startsWith('/'));
  }

  /** GIB iki goruntuleme arasinda ~1 sn ister. Iki indirme arasi minimum bekleme. */
  private ebeyannameMinFetchGapMs() {
    return Math.max(0, Math.min(5_000, Number(process.env.PORTAL_AUTOMATION_EBEYANNAME_MIN_FETCH_GAP_MS || 1_200)));
  }

  /** Tek bir PDF icin kac kez denenecek (GIB 500/hiz-limiti gecici; artan bekleme ile tekrar dene). */
  private ebeyannameFetchAttempts() {
    const raw = Number(process.env.PORTAL_AUTOMATION_EBEYANNAME_FETCH_ATTEMPTS);
    if (Number.isFinite(raw) && raw >= 1) return Math.min(8, Math.floor(raw));
    return 4;
  }

  /** Hattat yontemi acik mi? Oid+TOKEN ile dogrudan /dispatch adresi kur (varsayilan acik). */
  private ebeyannameDispatchDirectEnabled() {
    const raw = String(process.env.PORTAL_AUTOMATION_EBEYANNAME_DISPATCH_DIRECT ?? '1').trim().toLowerCase();
    return raw !== '0' && raw !== 'false' && raw !== 'no' && raw !== 'off';
  }

  private matchEBeyannameToken(text: string): string | null {
    const m = String(text || '').match(/TOKEN=([A-Za-z0-9]+)/);
    return m ? m[1] : null;
  }

  /** Oturum TOKEN'ini (tum /dispatch cagrilarinda ayni, oturum boyunca sabit) sayfadan cikarir. */
  private async ebeyannameSessionToken(target: any): Promise<string | null> {
    const fromUrl = this.matchEBeyannameToken(String(target?.url?.() || ''));
    if (fromUrl) return fromUrl;
    const tok = await target.evaluate(() => {
      try {
        const w = window as any;
        if (typeof w.getTOKEN === 'function') {
          const t = String(w.getTOKEN() || '').trim();
          if (/^[A-Za-z0-9]+$/.test(t)) return t;
        }
      } catch { /* yoksay */ }
      const hay = String(document.documentElement?.outerHTML || '');
      const m = hay.match(/TOKEN=([A-Za-z0-9]+)/);
      return m ? m[1] : null;
    }).catch(() => null);
    return tok || null;
  }

  /** Satirdaki ikon onclick/href/outerHTML icinden beyanname/tahakkuk Oid'lerini cikarir. */
  private extractEBeyannameOids(
    metas: Array<{ haystack?: string; onclick?: string; href?: string }>,
  ): { beyannameOid: string | null; tahakkukOid: string | null } {
    let beyannameOid: string | null = null;
    let tahakkukOid: string | null = null;
    for (const meta of metas || []) {
      const hay = `${meta.onclick || ''} ${meta.href || ''} ${meta.haystack || ''}`;
      if (!beyannameOid) {
        const b = hay.match(/beyannameGoruntule\(\s*'([^']+)'/i) || hay.match(/beyannameOid=([A-Za-z0-9]+)/i);
        if (b) beyannameOid = b[1];
      }
      if (!tahakkukOid) {
        const t = hay.match(/tahakkukGoruntule\(\s*'[^']*'\s*,\s*'([^']+)'/i) || hay.match(/tahakkukOid=([A-Za-z0-9]+)/i);
        if (t) tahakkukOid = t[1];
      }
    }
    return { beyannameOid, tahakkukOid };
  }

  /** Hattat yontemi: tiklamadan, dogrudan /dispatch IMAJ adresi kurar (beyanname/tahakkuk ayrik). */
  private buildEBeyannameDispatchUrl(
    target: any,
    kind: 'beyanname' | 'tahakkuk',
    oids: { beyannameOid: string | null; tahakkukOid: string | null },
    token: string | null,
  ): string | null {
    if (!token || !this.ebeyannameDispatchDirectEnabled()) return null;
    let origin = '';
    try {
      origin = new URL(String(target?.url?.() || '')).origin;
    } catch {
      return null;
    }
    if (!/gib\.gov\.tr/i.test(origin)) return null;
    if (kind === 'beyanname') {
      if (!oids.beyannameOid) return null;
      return `${origin}/dispatch?cmd=IMAJ&subcmd=BEYANNAMEGORUNTULE&TOKEN=${encodeURIComponent(token)}`
        + `&beyannameOid=${encodeURIComponent(oids.beyannameOid)}&inline=true`;
    }
    if (!oids.beyannameOid || !oids.tahakkukOid) return null;
    // ONEMLI (canli log ile dogrulandi): tahakkuk PDF'i SADECE ARSIV=T ile (inline'siz) iniyor.
    // inline=true istersek GIB 354 baytlik "Uyari" HTML'i donduruyordu -> kod 5 bos deneme harciyordu.
    return `${origin}/dispatch?cmd=IMAJ&subcmd=TAHAKKUKGORUNTULE&TOKEN=${encodeURIComponent(token)}`
      + `&beyannameOid=${encodeURIComponent(oids.beyannameOid)}&tahakkukOid=${encodeURIComponent(oids.tahakkukOid)}&ARSIV=T`;
  }

  // ===================== HATTAT YONTEMI: liste-API ile toplu indirme =====================

  /** ARSIV listesini once dene? (varsayilan ACIK; 0 satir verirse yakalanan canli istege dusulur) */
  private ebeyannameArsivFirstEnabled() {
    const raw = String(process.env.PORTAL_AUTOMATION_EBEYANNAME_ARSIV_FIRST ?? '1').trim().toLowerCase();
    return raw !== '0' && raw !== 'false' && raw !== 'no' && raw !== 'off';
  }

  /** Liste-API yolu acik mi? (varsayilan ACIK; basarisizsa eski yola otomatik dusulur) */
  private ebeyannameListApiEnabled() {
    const raw = String(process.env.PORTAL_AUTOMATION_EBEYANNAME_LIST_API ?? '1').trim().toLowerCase();
    return raw !== '0' && raw !== 'false' && raw !== 'no' && raw !== 'off';
  }

  /** Tek seferlik canli dogrulama probu acik mi? (ilk run icin acik; teyit sonrasi 0 yap) */
  private ebeyannameListApiProbeEnabled() {
    const raw = String(process.env.PORTAL_AUTOMATION_EBEYANNAME_LIST_API_PROBE ?? '1').trim().toLowerCase();
    return ['1', 'true', 'yes', 'on', 'evet'].includes(raw);
  }

  /** Hangi beyanname turleri tek tek sorgulanacak? Bos => tek sorgu (tum turler birlikte). */
  private ebeyannameListApiTypes(): string[] {
    const raw = String(process.env.PORTAL_AUTOMATION_EBEYANNAME_LIST_API_TYPES ?? '').trim();
    if (!raw) return [''];
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }

  /** ARSIVBEYANNAMELISTESI sorgu adresini kurar (skill: gib_beyanname_indir.md). */
  private buildEBeyannameListApiUrl(
    origin: string,
    token: string,
    p: { grupSayi: number; beyannameTanim: string; baslangic: string; bitis: string },
  ): string {
    const durum = String(process.env.PORTAL_AUTOMATION_EBEYANNAME_LIST_API_DURUM ?? '0');
    const q = new URLSearchParams();
    q.set('cmd', 'ARSIVBEYANNAMELISTESI');
    q.set('TOKEN', token);
    q.set('grupSayi', String(p.grupSayi));
    q.set('beyannameTanim', p.beyannameTanim || '');
    q.set('donemBasAy', ''); q.set('donemBasYil', '');
    q.set('donemBitAy', ''); q.set('donemBitYil', '');
    // GIB: "Vergi Kimlik Numarasi ve TC Kimlik Numarasini BIRLIKTE girerek sorgulamayiniz" -> toplu
    // sorguda ikisini de GONDERME (bos bile olsa birlikte gonderince reddediyor). Sadece vdKodu kalsin.
    q.set('vdKodu', '');
    q.set('sorguTipiN', '1'); q.set('sorguTipiT', '1'); q.set('sorguTipiB', '1');
    q.set('sorguTipiP', '1'); q.set('sorguTipiV', '1'); q.set('sorguTipiZ', '1');
    if (p.baslangic) q.set('baslangicTarihi', p.baslangic);
    if (p.bitis) q.set('bitisTarihi', p.bitis);
    q.set('durum', durum);
    return `${origin}/dispatch?${q.toString()}`;
  }

  /** Liste-API sayfasini cek (once baglam request, olmadi sayfa-ici fetch). Ham metni dondurur. */
  private async fetchEBeyannameListPage(page: any, url: string): Promise<string | null> {
    const response = await page.context().request.get(url, {
      timeout: this.ebeyannameDirectFetchTimeoutMs(),
      headers: { referer: String(page.url?.() || ''), accept: 'text/html,application/json,*/*' },
    }).catch(() => null);
    if (response?.ok()) {
      const raw = await response.text().catch(() => '');
      if (raw) return raw;
    }
    const viaFetch = await this.withTimeout<string>(
      page.evaluate(async (targetUrl: string) => {
        try {
          const r = await fetch(targetUrl, {
            credentials: 'include',
            cache: 'no-store',
            headers: { accept: 'text/html,application/json,*/*' },
          });
          return await r.text();
        } catch {
          return '';
        }
      }, url) as Promise<string>,
      this.ebeyannameDirectFetchTimeoutMs() + 1_000,
      () => '',
    ).catch(() => '');
    return viaFetch ? String(viaFetch) : null;
  }

  /** POST liste istegini (yakalanan, grupSayi degistirilmis) cek. urlencoded govde varsayilir. */
  private async fetchEBeyannameListPost(page: any, url: string, body: string): Promise<string | null> {
    const response = await page.context().request.post(url, {
      timeout: this.ebeyannameDirectFetchTimeoutMs(),
      headers: {
        referer: String(page.url?.() || ''),
        accept: 'text/html,application/json,*/*',
        'content-type': 'application/x-www-form-urlencoded',
      },
      data: body || '',
    }).catch(() => null);
    if (response?.ok()) {
      const raw = await response.text().catch(() => '');
      if (raw) return raw;
    }
    const viaFetch = await this.withTimeout<string>(
      page.evaluate(async ({ targetUrl, postBody }: { targetUrl: string; postBody: string }) => {
        try {
          const r = await fetch(targetUrl, {
            method: 'POST',
            credentials: 'include',
            cache: 'no-store',
            headers: { accept: 'text/html,application/json,*/*', 'content-type': 'application/x-www-form-urlencoded' },
            body: postBody,
          });
          return await r.text();
        } catch {
          return '';
        }
      }, { targetUrl: url, postBody: body || '' }) as Promise<string>,
      this.ebeyannameDirectFetchTimeoutMs() + 1_000,
      () => '',
    ).catch(() => '');
    return viaFetch ? String(viaFetch) : null;
  }

  /** Yakalanan POST govdesinde grupSayi (+ TOKEN) gunceller + TUM beyanname gruplarini acar. */
  private setGrupSayiInPost(postData: string | null, grupSayi: number, token: string): string {
    try {
      const p = new URLSearchParams(postData || '');
      p.set('grupSayi', String(grupSayi));
      if (token && p.has('TOKEN')) p.set('TOKEN', token);
      // GIB'in yakaladigimiz istegi bazen TEK grupla geliyor (orn. sadece sorguTipiZ=1) ve
      // KDV/MUHSGK gibi diger gruplar listeye HIC girmiyordu. Tum sorguTipi gruplarini ac.
      for (const f of ['sorguTipiN', 'sorguTipiT', 'sorguTipiB', 'sorguTipiP', 'sorguTipiV', 'sorguTipiZ']) {
        p.set(f, '1');
      }
      return p.toString();
    } catch {
      return postData || '';
    }
  }

  private stripHtml(html: string): string {
    return String(html || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCharCode(Number(n)); } catch { return ' '; } })
      .replace(/\s+/g, ' ')
      .trim();
  }

  private firstStr(obj: any, keys: string[]): string {
    if (!obj || typeof obj !== 'object') return '';
    const lowered: Record<string, any> = {};
    for (const k of Object.keys(obj)) lowered[k.toLowerCase()] = obj[k];
    for (const key of keys) {
      const v = lowered[key.toLowerCase()];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return '';
  }

  /** ARSIVBEYANNAMELISTESI yanitini (GIB XML zarfi / JSON / HTML) ayristirir. */
  private parseEBeyannameListResponse(raw: string): {
    rows: EBeyannameListEntry[];
    total: number | null;
    recognized: boolean;
    serverError: string | null;
  } {
    const text = String(raw || '');
    const trimmed = text.trim();

    // 1) GIB XML zarfi: <SERVICERESULT><TOKEN/><SERVERERROR/><HTMLCONTENT>...tablo...</HTMLCONTENT></SERVICERESULT>
    if (/<SERVICERESULT|<HTMLCONTENT/i.test(text)) {
      const serverError = this.stripHtml(text.match(/<SERVERERROR>([\s\S]*?)<\/SERVERERROR>/i)?.[1] || '') || null;
      const htmlContent = text.match(/<HTMLCONTENT>([\s\S]*?)<\/HTMLCONTENT>/i)?.[1] || text;
      const rows = this.parseEBeyannameListHtmlRows(htmlContent);
      const total = this.extractEBeyannameListTotal(htmlContent) ?? this.extractEBeyannameListTotal(text);
      return { rows, total, recognized: true, serverError };
    }

    // 2) JSON
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const json = JSON.parse(trimmed);
        const arr: any[] = Array.isArray(json)
          ? json
          : (json.rows || json.data || json.liste || json.beyannameler || json.aaData || json.sonuc || []);
        if (Array.isArray(arr)) {
          const rows: EBeyannameListEntry[] = [];
          arr.forEach((o, i) => {
            const e = this.jsonRowToEntry(o, i);
            if (e) rows.push(e);
          });
          const totalRaw = Number(json.total ?? json.toplam ?? json.recordsTotal ?? json.kayitSayisi ?? arr.length);
          return { rows, total: Number.isFinite(totalRaw) ? totalRaw : (rows.length || null), recognized: true, serverError: null };
        }
      } catch {
        // JSON degil; HTML olarak devam.
      }
    }

    // 3) Duz HTML / metin
    const total = this.extractEBeyannameListTotal(text);
    const rows = this.parseEBeyannameListHtmlRows(text);
    const recognized = rows.length > 0
      || /beyannameOid=/i.test(text)
      || /BEYANNAME\s+L[İI]STES[İI]/i.test(text)
      || /ARSIVBEYANNAME/i.test(text);
    return { rows, total, recognized, serverError: null };
  }

  private extractEBeyannameListTotal(text: string): number | null {
    const m = String(text || '').match(/(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)/);
    if (m) return Number(m[3]) || null;
    return null;
  }

  private jsonRowToEntry(o: any, idx: number): EBeyannameListEntry | null {
    const beyannameOid = this.firstStr(o, ['beyannameOid', 'beyanOid', 'oid']);
    if (!beyannameOid) return null;
    const tahakkukOid = this.firstStr(o, ['tahakkukOid']) || null;
    const taxNumber = (this.firstStr(o, ['vergiNo', 'vkn', 'vergiKimlikNo'])
      || this.firstStr(o, ['tcKimlikNo', 'tckn', 'kimlikNo'])).replace(/\D/g, '') || null;
    const taxpayerName = this.firstStr(o, ['adSoyad', 'unvan', 'adUnvan', 'ad', 'isim', 'mukellefAdi', 'mukellef']) || null;
    const beyanTipiRaw = this.firstStr(o, ['beyannameTuru', 'beyannameTanim', 'beyanTuru', 'tur', 'tip']) || null;
    const taxPeriod = this.firstStr(o, ['donem', 'donemAralik', 'vergilendirmeDonemi']) || null;
    const uploadTime = this.firstStr(o, ['yuklemeTarihi', 'tarih', 'onayTarihi', 'gonderimTarihi']) || null;
    const statusText = this.firstStr(o, ['durum', 'durumu', 'onayDurumu']) || null;
    const cells = [beyanTipiRaw, taxNumber, taxpayerName, taxPeriod, uploadTime, statusText]
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    const row: EBeyannameResultRow = {
      rowIndex: idx,
      cells,
      rowText: cells.join(' '),
      beyanTipiRaw,
      mahiyetText: null,
      isCorrection: this.isEBeyannameCorrectionText(cells.join(' ')),
      taxNumber,
      taxpayerName,
      taxOffice: null,
      taxPeriod,
      uploadTime,
      statusText,
    };
    return { row, beyannameOid, tahakkukOid };
  }

  private parseEBeyannameListHtmlRows(html: string): EBeyannameListEntry[] {
    const entries: EBeyannameListEntry[] = [];
    let idx = 0;
    const trMatches = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const tr of trMatches) {
      if (!/beyannameGoruntule\(|beyannameOid=/i.test(tr)) continue;
      const e = this.htmlRowToEntry(tr, idx);
      if (e) { entries.push(e); idx++; }
    }
    if (entries.length) return entries;

    // Tablo yapisi yoksa: her beyanname PDF ikonu (onclick) etrafindaki pencereden satir cikar.
    const re = /beyannameGoruntule\(\s*'[^']+'|beyannameOid=[A-Za-z0-9]+/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const center = m.index;
      const window = html.slice(Math.max(0, center - 900), Math.min(html.length, center + 400));
      const e = this.htmlRowToEntry(window, idx);
      if (e) { entries.push(e); idx++; }
    }
    // Pencere parcalari ayni Oid'i tekrar uretebilir; tekillestir.
    const seen = new Set<string>();
    return entries.filter((e) => (seen.has(e.beyannameOid) ? false : (seen.add(e.beyannameOid), true)));
  }

  private htmlRowToEntry(chunk: string, idx: number): EBeyannameListEntry | null {
    // GIB onayli satirlarinda PDF oid'leri query-param degil onclick FONKSIYON argumanidir:
    //   onclick="beyannameGoruntule('<beyannameOid>',false,false)"
    //   onclick="tahakkukGoruntule('<beyannameOid>','<tahakkukOid>',false,false)"
    // Hatali/red satirlarda bu ikon (ve fonksiyon) hic yok -> beyannameOid bulunamaz -> satir atlanir
    // (yani dogal olarak SADECE indirilebilir onayli satirlar secilir).
    const beyannameOid = chunk.match(/beyannameGoruntule\(\s*'([^']+)'/i)?.[1]
      || chunk.match(/beyannameOid=([A-Za-z0-9]+)/i)?.[1];
    if (!beyannameOid) return null;
    const tahakkukOid = chunk.match(/tahakkukGoruntule\(\s*'[^']*'\s*,\s*'([^']+)'/i)?.[1]
      || chunk.match(/tahakkukOid=([A-Za-z0-9]+)/i)?.[1] || null;
    let cells = (chunk.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [])
      .map((td) => this.stripHtml(td))
      .filter(Boolean);
    if (!cells.length) {
      const plain = this.stripHtml(chunk);
      if (plain) cells = [plain];
    }
    const row = this.normalizeEBeyannameResultRow({ cells, rowText: cells.join(' ') }, idx);
    return { row, beyannameOid, tahakkukOid };
  }

  /** Yakalanan GIB liste istegini temel alarak verilen sayfa (grupSayi) icin URL kurar. */
  private eBeyannameListUrlFromCapture(capturedUrl: string, token: string, grupSayi: number): string {
    try {
      const u = new URL(capturedUrl);
      u.searchParams.set('grupSayi', String(grupSayi));
      if (token) u.searchParams.set('TOKEN', token);
      return u.toString();
    } catch {
      return capturedUrl;
    }
  }

  /** Tum sayfalar gezilerek indirilebilir (Oid'li) satirlar toplanir. */
  private async collectEBeyannameListRows(
    page: any,
    origin: string,
    token: string,
    job: any,
    notes: string[],
  ): Promise<{ rows: EBeyannameListEntry[]; recognized: boolean }> {
    const maxRows = Math.max(1, Math.min(5000, Number(process.env.PORTAL_AUTOMATION_EBEYANNAME_MAX_APPROVED_ROWS || 1000)));
    const byOid = new Map<string, EBeyannameListEntry>();
    let recognized = false;

    // Kullanicinin elle yaptigi gibi: acik olan ONAYLANDI listesini DOM'da sayfa sayfa gez (>> Sonraki
    // Sayfa). Her satirin B/T ikonu onclick'inde oid var (beyannameGoruntule('oid') / tahakkukGoruntule(
    // 'beyOid','tahOid')). Hatali/iptal satirlarda ikon olmadigi icin dogal olarak atlanir.
    // (Eskiden tek sayfa / yanlis durum / arsiv denenip cogu sayfa kaciriliyordu.)
    const target = (await this.findEBeyannameResultTarget(page)) || page;
    let pageNo = 0;
    let lastEnd = 0;
    while (byOid.size < maxRows && pageNo < 200) {
      pageNo++;
      const html = String(await target.evaluate(() => document.documentElement.outerHTML).catch(() => ''));
      const entries = html ? this.parseEBeyannameListHtmlRows(html) : [];
      if (entries.length) recognized = true;
      let added = 0;
      for (const e of entries) {
        if (byOid.size >= maxRows) break;
        if (!byOid.has(e.beyannameOid)) { byOid.set(e.beyannameOid, e); added++; }
      }
      const pag = await this.readEBeyannamePagination(page);
      notes.push(`liste DOM sayfa ${pageNo}: ${entries.length} onayli satir (+${added}, toplam ${pag?.total ?? '?'})`);
      if (!pag || pag.end >= pag.total) break;
      if (pag.end <= lastEnd) { notes.push(`liste: sayfa ilerlemedi (${pag.start}-${pag.end}), durduruldu`); break; }
      lastEnd = pag.end;
      const moved = await this.clickEBeyannameNextPage(page, pag);
      if (!moved) { notes.push(`liste: Sonraki Sayfa tiklanamadi (${pag.start}-${pag.end}/${pag.total})`); break; }
      // Sayfanin AJAX ile yuklenmesini bekle (pagination ilerleyene kadar, ~max 5 sn).
      for (let w = 0; w < 12; w++) { await this.wait(420); const np = await this.readEBeyannamePagination(page); if (np && np.start > pag.start) break; }
    }

    this.logger.warn(`[EBLIST] DOM gezildi: ${byOid.size} indirilebilir onayli satir (${pageNo} sayfa).`);
    return { rows: Array.from(byOid.values()), recognized };
  }

  /**
   * HATTAT yontemi ana akisi: liste-API'den Oid'leri al, /dispatch IMAJ ile dogrudan ve sirali indir.
   * - SWAP imkansiz (beyanname/tahakkuk ayri subcmd).
   * - Tiklama/popup/URL-resolve YOK (yavaslik kaynagi).
   * - Oid otoriter oldugu icin PDF-ici VKN dogrulamasi (ve OCR) bu yolda calismaz.
   * Erisilemez / bicim taninamaz / hic Oid'li satir yoksa => null (eski yola dusulur).
   */
  private async collectApprovedEBeyannameViaListApi(
    tenantId: string,
    page: any,
    downloadsPath: string,
    taxpayers: TaxpayerMatch[],
    job: any,
    notes: string[],
  ): Promise<{ declarations: any[]; documents: any[]; persistedCount: number } | null> {
    const resultTarget = await this.findEBeyannameResultTarget(page) || page;
    let origin = '';
    try {
      origin = new URL(String(resultTarget?.url?.() || page.url?.() || '')).origin;
    } catch {
      return null;
    }
    if (!/gib\.gov\.tr/i.test(origin)) return null;

    const token = await this.ebeyannameSessionToken(resultTarget).catch(() => null);
    if (!token) {
      notes.push('liste-API: oturum TOKEN bulunamadi, eski yola dusuluyor');
      return null;
    }

    if (this.ebeyannameListApiProbeEnabled() && !this.ebeyannameListApiProbeLogged) {
      this.ebeyannameListApiProbeLogged = true;
      await this.logEBeyannameListApiProbe(page, origin, token, job, downloadsPath).catch(() => {});
    }

    const listResult = await this.collectEBeyannameListRows(page, origin, token, job, notes);
    const entries = listResult.rows;
    // GUVENLIK: liste-API hic indirilebilir satir uretemezse (parametre reddi / capture yok / gercekten bos)
    // HER ZAMAN eski yola dus. Asla "0 indirdim" deyip cikma. Eski yol da 0 bulursa hizlica biter;
    // satir bulursa indirir. Boylece liste-API yolu eski yoldan ASLA daha kotu olamaz.
    if (!entries.length) {
      notes.push('liste-API: indirilebilir satir uretilemedi, eski yola dusuluyor');
      this.logger.warn('[EBSTAT] liste-API: 0 satir -> eski yola dusuluyor.');
      return null;
    }

    const declarations: any[] = [];
    const documents: any[] = [];
    let persistedCount = 0;
    const gap = this.ebeyannameMinFetchGapMs();
    let lastFetchAt = 0;
    let processed = 0;
    let saved = 0;
    let attempted = 0;

    await this.jobProgress(tenantId, job, 'approved_listapi_start', `Liste-API: ${entries.length} beyanname satiri indirilecek.`, {
      total: entries.length,
    });

    for (const entry of entries) {
      processed++;
      const { row, beyannameOid, tahakkukOid } = entry;
      const identity = this.ebeyannameIdentityFromRow(row, taxpayers, job);
      const existing = await this.existingBeyanKaydiFiles(tenantId, identity).catch(() => null);
      const skipExisting = !!existing && !identity?.isCorrection && !this.shouldRefreshExistingEBeyanname(job);
      const skipBeyanname = skipExisting && !!existing!.beyannameUrl;
      const skipTahakkuk = skipExisting && !!existing!.pdfUrl;
      if (skipBeyanname && skipTahakkuk) {
        notes.push(`liste-API: ${identity?.beyanTipi || '-'} ${identity?.donem || '-'} ${row.taxNumber || row.taxpayerName || ''} zaten var, atlandi`);
        continue;
      }

      const tasks: Array<{ kind: 'beyanname' | 'tahakkuk'; url: string }> = [];
      if (!skipBeyanname) {
        const u = this.buildEBeyannameDispatchUrl(resultTarget, 'beyanname', { beyannameOid, tahakkukOid }, token);
        if (u) tasks.push({ kind: 'beyanname', url: u });
      }
      if (!skipTahakkuk && tahakkukOid) {
        const u = this.buildEBeyannameDispatchUrl(resultTarget, 'tahakkuk', { beyannameOid, tahakkukOid }, token);
        if (u) tasks.push({ kind: 'tahakkuk', url: u });
      }

      let beyanname: EBeyannameFilePayload | null = null;
      let tahakkuk: EBeyannameFilePayload | null = null;
      const maxAttempts = this.ebeyannameFetchAttempts();
      for (const task of tasks) {
        const fallbackName = `ebeyanname-${processed}-${task.kind}`;
        let file: EBeyannameFilePayload | null = null;
        for (let attempt = 1; attempt <= maxAttempts && !file; attempt++) {
          const gate = gap - (Date.now() - lastFetchAt);
          if (gate > 0) await this.wait(gate);
          // Onceki deneme basarisizsa artan bekleme: GIB 500/hiz-limiti uyarisi gecsin.
          if (attempt > 1) await this.wait(gap * (attempt - 1));
          file = await this.savePdfFromRequestUrl(page, task.url, downloadsPath, fallbackName).catch(() => null);
          lastFetchAt = Date.now();
        }
        attempted++;
        if (file) {
          saved++;
          if (task.kind === 'beyanname') beyanname = file; else tahakkuk = file;
        } else {
          notes.push(`liste-API: ${processed}. satir ${task.kind} ${maxAttempts} denemede inmedi (oid=${beyannameOid})`);
        }
      }

      if (!beyanname && !tahakkuk) {
        notes.push(`liste-API: ${processed}. satir PDF alinamadi (oid=${beyannameOid})`);
      } else {
        const declaration = this.declarationFromEBeyannameRow(row, 'onaylandi', taxpayers, job, { beyanname, tahakkuk });
        if (declaration) {
          declarations.push(declaration);
        } else {
          // Mukellefe eslenemedi: eslesmeyen belge olarak sakla + teshis.
          for (const item of [{ file: beyanname, kind: 'beyanname' as const }, { file: tahakkuk, kind: 'tahakkuk' as const }]) {
            if (!item.file) continue;
            documents.push(this.unmatchedEBeyannameDocument(row, item.file, item.kind, job));
          }
          this.logger.warn(`[EBSTAT] ESLESMEDI (liste-API): satir ${processed} vkn=${row.taxNumber || '-'} ad="${this.compact(row.taxpayerName || '').slice(0, 40)}" tip="${this.compact(row.beyanTipiRaw || '').slice(0, 24)}"`);
          await this.diagnoseEBeyannameUnmatch(tenantId, row).catch(() => {});
        }
      }

      if (declarations.length + documents.length >= this.ebeyannamePartialFlushSize()) {
        persistedCount += await this.flushPartialEBeyannameResults(tenantId, job, declarations, documents, notes);
      }
      if (processed === 1 || processed % 10 === 0 || processed === entries.length) {
        await this.jobProgress(tenantId, job, 'approved_listapi', `Liste-API indirme: ${saved} PDF / ${processed} satir.`, {
          current: processed,
          total: entries.length,
          records: persistedCount + declarations.length + documents.length,
        });
      }
    }

    notes.push(`liste-API: ${processed} satir, ${saved}/${attempted} PDF indirildi, ${persistedCount + declarations.length} firmaya eslendi, ${documents.length} eslesmeyen belge.`);
    this.logger.warn(`[EBSTAT] liste-API ozet: ${processed} satir, ${saved}/${attempted} PDF, ${persistedCount + declarations.length} firmaya eslendi, ${documents.length} eslesmeyen.`);
    return { declarations, documents, persistedCount };
  }

  private unmatchedEBeyannameDocument(
    row: EBeyannameResultRow,
    file: EBeyannameFilePayload,
    kind: 'beyanname' | 'tahakkuk',
    job: any,
  ) {
    return {
      taxpayerId: null,
      belgeTuru: kind === 'tahakkuk' ? 'GIB_TAHAKKUK' : 'GIB_BEYANNAME',
      title: file.fileName,
      period: this.ebeyannameDonemFromRow(row, this.guessBeyanTipi(row.beyanTipiRaw || row.rowText), job),
      issuedAt: this.parseEBeyannameUploadTime(row.uploadTime) || job.periodEnd || null,
      receivedAt: new Date().toISOString(),
      mimeType: file.mimeType,
      originalName: file.fileName,
      base64: file.base64,
      raw: {
        runner: 'railway',
        source: 'ebeyanname-liste-api',
        matchedTaxpayer: false,
        rowText: this.compact(row.rowText),
        taxNumber: row.taxNumber,
        taxpayerName: row.taxpayerName,
        beyanTipi: this.guessBeyanTipi(row.beyanTipiRaw || row.rowText),
      },
    };
  }

  /** Tek seferlik (process basina) canli dogrulama probu — sadece log, davranis degistirmez. */
  private async logEBeyannameListApiProbe(page: any, origin: string, token: string, job: any, downloadsPath: string) {
    try {
      const start = this.istanbulDateParts(job.periodStart);
      const end = this.istanbulDateParts(job.periodEnd);
      const baslangic = start ? `${start.year}${start.month}${start.day}` : '';
      const bitis = end ? `${end.year}${end.month}${end.day}` : '';
      const captured = this.ebeyannameCapturedListReq;
      this.logger.warn(`[EBPROBE] yakalanan GIB liste istegi: ${captured ? `${captured.method} ${this.safeUrl(captured.url)}` : 'YOK'}`);
      // Once GIB'in kendi (calisan) istegini, yoksa sabit parametreli URL'i dene.
      const url = (captured && /GET/i.test(captured.method))
        ? this.eBeyannameListUrlFromCapture(captured.url, token, 0)
        : this.buildEBeyannameListApiUrl(origin, token, { grupSayi: 0, beyannameTanim: '', baslangic, bitis });
      this.logger.warn(`[EBPROBE] liste-API URL=${this.safeUrl(url)} token=...${String(token).slice(-4)} tarih=${baslangic}-${bitis}`);
      const raw = await this.fetchEBeyannameListPage(page, url);
      if (raw == null) { this.logger.warn('[EBPROBE] liste-API yaniti ALINAMADI'); return; }
      this.logger.warn(`[EBPROBE] yanit uzunluk=${raw.length} ilk2KB="${this.safeDebugText(raw).slice(0, 2000)}"`);
      const parsed = this.parseEBeyannameListResponse(raw);
      this.logger.warn(`[EBPROBE] recognized=${parsed.recognized} serverError="${this.compact(parsed.serverError || '-')}" total=${parsed.total} satir=${parsed.rows.length}`);
      const first = parsed.rows[0];
      if (first) {
        this.logger.warn(`[EBPROBE] ilk satir bOid=${first.beyannameOid} tOid=${first.tahakkukOid} vkn=${first.row.taxNumber} ad="${this.compact(first.row.taxpayerName || '').slice(0, 40)}" tip="${this.compact(first.row.beyanTipiRaw || '')}" donem="${first.row.taxPeriod || ''}"`);
        const bUrl = this.buildEBeyannameDispatchUrl({ url: () => `${origin}/` }, 'beyanname', { beyannameOid: first.beyannameOid, tahakkukOid: first.tahakkukOid }, token);
        if (bUrl) {
          const f = await this.savePdfFromRequestUrl(page, bUrl, downloadsPath, 'ebprobe-beyanname').catch(() => null);
          const bytes = f?.base64 ? Buffer.from(f.base64, 'base64').length : 0;
          this.logger.warn(`[EBPROBE] ornek beyanname indirme: ${f ? `OK bytes=${bytes} file=${f.fileName}` : 'BASARISIZ'}`);
        }
      }
    } catch (e: any) {
      this.logger.warn(`[EBPROBE] hata: ${this.compact(e?.message || e)}`);
    }
  }

  /** GIB hiz-limiti: iki IMAJ/PDF cekimi arasinda EN AZ ebeyannameMinFetchGapMs (~1.2sn) bekle. */
  private async ebeyannameImajGate() {
    const gap = this.ebeyannameMinFetchGapMs();
    if (gap <= 0) return;
    const wait = gap - (Date.now() - this.ebeyannameLastImajAt);
    if (wait > 0) await this.wait(wait);
    this.ebeyannameLastImajAt = Date.now();
  }

  private async savePdfFromRequestUrl(
    page: any,
    url: string,
    downloadsPath: string,
    fallbackName: string,
  ): Promise<EBeyannameFilePayload | null> {
    const variants = this.ebeyannamePdfRequestUrlVariants(url);
    for (const requestUrl of variants) {
      await this.ebeyannameImajGate();
      const response = await page.context().request.get(requestUrl, {
        timeout: this.ebeyannameDirectFetchTimeoutMs(),
        headers: { referer: String(page.url?.() || '') },
      }).catch(() => null);
      if (response?.ok()) {
        const headers = response.headers();
        const mimeType = headers['content-type'] || 'application/pdf';
        const buffer = Buffer.from(await response.body());
        const pdfish = /^%PDF/.test(buffer.subarray(0, 5).toString('latin1'))
          || /pdf|octet-stream/i.test(mimeType)
          || /\.pdf(?:$|[?#])/i.test(requestUrl);
        if (this.ebeyannameDebugEnabled()) {
          this.logger.warn(`[EBDBG] request ${fallbackName} status=${response.status()} mime=${mimeType} bytes=${buffer.length} pdfish=${pdfish} url=${this.safeUrl(requestUrl)}`);
        }
        if (pdfish && buffer.length >= 200) {
          return this.persistPdfBuffer(requestUrl, headers, buffer, downloadsPath, fallbackName, mimeType);
        }
      } else if (this.ebeyannameDebugEnabled()) {
        const body = response ? await response.text().catch(() => '') : '';
        this.logger.warn(`[EBDBG] request ${fallbackName} status=${response?.status?.() || 'null'} body="${this.safeDebugText(body).slice(0, 220)}" url=${this.safeUrl(requestUrl)}`);
      }
    }

    for (const requestUrl of variants) {
      await this.ebeyannameImajGate();
      const viaBrowserFetch = await this.savePdfFromBrowserFetch(page, requestUrl, downloadsPath, fallbackName).catch(() => null);
      if (viaBrowserFetch) return viaBrowserFetch;
    }

    for (const requestUrl of variants) {
      await this.ebeyannameImajGate();
      const viaNavigation = await this.savePdfFromBrowserNavigationUrl(page, requestUrl, downloadsPath, fallbackName).catch(() => null);
      if (viaNavigation) return viaNavigation;
    }

    return null;
  }

  private ebeyannamePdfRequestUrlVariants(url: string) {
    const variants: string[] = [];
    const add = (value: string) => {
      const trimmed = String(value || '').trim();
      if (trimmed && !variants.includes(trimmed)) variants.push(trimmed);
    };
    // TAHAKKUK (canli log ile dogrulandi): SADECE ARSIV=T + inline'siz iniyor. Onclick'ten gelen
    // inline=true adresinde bu varyanti ONCE dene -> 4 bos deneme/HTML-uyarisi ve hiz-limiti riski biter.
    try {
      const t = new URL(url);
      if (/TAHAKKUKGORUNTULE/i.test(t.searchParams.get('subcmd') || t.search)) {
        const arsivNoInline = new URL(t.toString());
        arsivNoInline.searchParams.delete('inline');
        arsivNoInline.searchParams.set('ARSIV', 'T');
        add(arsivNoInline.toString());
      }
    } catch {
      // Asagidaki sira denenir.
    }
    // Orijinal adresi (GIB'in kendi urettigi, /dispatch icin inline=true) sonra dene.
    add(url);
    try {
      const parsed = new URL(url);
      if (parsed.searchParams.has('inline')) {
        const noInline = new URL(parsed.toString());
        noInline.searchParams.delete('inline');
        add(noInline.toString());
        const inlineFalse = new URL(parsed.toString());
        inlineFalse.searchParams.set('inline', 'false');
        add(inlineFalse.toString());
      }
      if (!parsed.searchParams.has('ARSIV')) {
        const arsiv = new URL(parsed.toString());
        arsiv.searchParams.set('ARSIV', 'T');
        add(arsiv.toString());
        if (arsiv.searchParams.has('inline')) {
          const arsivNoInline = new URL(arsiv.toString());
          arsivNoInline.searchParams.delete('inline');
          add(arsivNoInline.toString());
        }
      }
    } catch {
      // Original URL is still tried below.
    }
    add(url);
    return variants;
  }

  private async savePdfFromBrowserNavigationUrl(
    page: any,
    url: string,
    downloadsPath: string,
    fallbackName: string,
  ): Promise<EBeyannameFilePayload | null> {
    const popup = await page.context().newPage();
    try {
      const timeout = Math.max(this.ebeyannameDirectFetchTimeoutMs(), 8_000);
      const downloadPromise = popup.waitForEvent('download', { timeout })
        .then((download: any) => download)
        .catch(() => null);
      const gotoPromise = popup.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout,
        referer: String(page.url?.() || ''),
      }).catch(() => null);

      const response = await Promise.race([
        gotoPromise,
        downloadPromise.then(() => null),
      ]);
      const download = await Promise.race([
        downloadPromise,
        this.wait(250).then(() => null),
      ]);
      if (download) return this.savePlaywrightDownload(download, downloadsPath, fallbackName);

      if (response?.ok()) {
        const headers = response.headers();
        const mimeType = headers['content-type'] || 'application/pdf';
        const buffer = Buffer.from(await response.body());
        const pdfish = /^%PDF/.test(buffer.subarray(0, 5).toString('latin1'))
          || /pdf|octet-stream/i.test(mimeType)
          || /\.pdf(?:$|[?#])/i.test(url);
        if (pdfish && buffer.length >= 200) {
          return this.persistPdfBuffer(url, headers, buffer, downloadsPath, fallbackName, mimeType);
        }
      }

      const lateDownload = await Promise.race([
        downloadPromise,
        this.wait(750).then(() => null),
      ]);
      if (lateDownload) return this.savePlaywrightDownload(lateDownload, downloadsPath, fallbackName);

      return this.savePdfFromLoadedPage(popup, downloadsPath, fallbackName).catch(() => null);
    } finally {
      await popup.close?.().catch(() => {});
    }
  }

  private async savePdfFromBrowserFetch(
    page: any,
    url: string,
    downloadsPath: string,
    fallbackName: string,
  ): Promise<EBeyannameFilePayload | null> {
    const timeoutMs = this.ebeyannameDirectFetchTimeoutMs();
    type BrowserFetchResult = { ok: boolean; status: number; mimeType: string; disposition: string; base64: string } | null;
    const fetched: BrowserFetchResult = await this.withTimeout<BrowserFetchResult>(
      page.evaluate(async ({ targetUrl, timeoutMs }: { targetUrl: string; timeoutMs: number }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(targetUrl, {
            credentials: 'include',
            cache: 'no-store',
            headers: { accept: 'application/pdf,*/*' },
            signal: controller.signal,
          });
          const contentType = response.headers.get('content-type') || 'application/pdf';
          const disposition = response.headers.get('content-disposition') || '';
          const buffer = await response.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = '';
          const chunkSize = 0x8000;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
          }
          return {
            ok: response.ok,
            status: response.status,
            mimeType: contentType,
            disposition,
            base64: btoa(binary),
          };
        } finally {
          clearTimeout(timer);
        }
      }, { targetUrl: url, timeoutMs }) as Promise<BrowserFetchResult>,
      timeoutMs + 1_000,
      () => null,
    ).catch(() => null);
    if (!fetched?.ok || !fetched.base64) return null;
    const buffer = Buffer.from(fetched.base64, 'base64');
    const pdfish = /^%PDF/.test(buffer.subarray(0, 5).toString('latin1'))
      || /pdf|octet-stream/i.test(fetched.mimeType)
      || /\.pdf(?:$|[?#])/i.test(url);
    if (!pdfish || buffer.length < 200) return null;
    return this.persistPdfBuffer(
      url,
      { 'content-type': fetched.mimeType, 'content-disposition': fetched.disposition },
      buffer,
      downloadsPath,
      fallbackName,
      fetched.mimeType,
    );
  }

  private async persistPdfBuffer(
    url: string,
    headers: Record<string, string>,
    buffer: Buffer,
    downloadsPath: string,
    fallbackName: string,
    mimeType?: string,
  ): Promise<EBeyannameFilePayload> {
    const fileName = this.safeFileName(this.fileNameFromResponse(url, headers, fallbackName));
    const filePath = join(downloadsPath, `${randomUUID()}-${fileName}`);
    await writeFile(filePath, buffer).catch(() => {});
    return { base64: buffer.toString('base64'), fileName, mimeType: mimeType || headers['content-type'] || 'application/pdf' };
  }

  private ebeyannameDirectFetchTimeoutMs() {
    return Math.max(3_000, Math.min(30_000, Number(process.env.PORTAL_AUTOMATION_EBEYANNAME_DIRECT_FETCH_TIMEOUT_MS || 5_000)));
  }

  private fileNameFromResponse(url: string, headers: Record<string, string>, fallbackName: string) {
    const disposition = headers['content-disposition'] || '';
    const encoded = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
    if (encoded) {
      try {
        return decodeURIComponent(encoded).replace(/"/g, '');
      } catch {
        return encoded.replace(/"/g, '');
      }
    }
    const plain = disposition.match(/filename\s*=\s*"?([^";]+)"?/i)?.[1];
    if (plain) return plain;
    try {
      const last = new URL(url).pathname.split('/').filter(Boolean).pop();
      if (last) return /\.pdf$/i.test(last) ? last : `${last}.pdf`;
    } catch {
      // Fallback below.
    }
    return `${fallbackName}.pdf`;
  }

  private async captureEBeyannameDownload(
    page: any,
    loc: any,
    downloadsPath: string,
    fallbackName: string,
  ): Promise<EBeyannameFilePayload | null> {
    const beforeUrl = String(page.url?.() || '');
    await loc.evaluate((el: any) => {
      const anchor = el.closest?.('a');
      if (anchor) anchor.setAttribute('target', '_blank');
    }).catch(() => {});

    const eventTimeoutMs = this.ebeyannameDownloadEventTimeoutMs();
    const pdfResponsePromise = this.waitForEBeyannamePdfResponse(page.context(), eventTimeoutMs, fallbackName)
      .catch(() => null);
    const downloadPromise = page.waitForEvent('download', { timeout: eventTimeoutMs })
      .then((download: any) => ({ type: 'download', value: download }))
      .catch(() => null);
    const popupPromise = page.context().waitForEvent('page', { timeout: eventTimeoutMs })
      .then((popup: any) => ({ type: 'popup', value: popup }))
      .catch(() => null);

    await loc.click({ timeout: Math.min(8_000, eventTimeoutMs) }).catch(() => null);
    const event: any = await Promise.race([
      downloadPromise,
      pdfResponsePromise.then((value) => value ? ({ type: 'response', value }) : null),
      popupPromise,
      this.wait(eventTimeoutMs).then(() => null),
    ]);

    if (event?.type === 'download') {
      return this.savePlaywrightDownload(event.value, downloadsPath, fallbackName);
    }

    if (event?.type === 'response') {
      return this.persistCapturedPdfResponse(event.value, downloadsPath, fallbackName);
    }

    if (event?.type === 'popup') {
      const responseFile = await Promise.race([
        pdfResponsePromise,
        this.wait(2_000).then(() => null),
      ]);
      if (responseFile) return this.persistCapturedPdfResponse(responseFile, downloadsPath, fallbackName);
      return this.savePdfFromPopup(event.value, downloadsPath, fallbackName);
    }

    const afterUrl = String(page.url?.() || '');
    if (afterUrl && afterUrl !== beforeUrl) {
      const saved = await this.savePdfFromPageUrl(page, downloadsPath, fallbackName).catch(() => null);
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});
      return saved;
    }

    const lateResponse = await Promise.race([
      pdfResponsePromise,
      this.wait(500).then(() => null),
    ]);
    if (lateResponse) return this.persistCapturedPdfResponse(lateResponse, downloadsPath, fallbackName);

    return null;
  }

  private waitForEBeyannamePdfResponse(
    context: any,
    timeoutMs: number,
    fallbackName: string,
  ): Promise<EBeyannameCapturedResponse | null> {
    return new Promise((resolve) => {
      let finished = false;
      let timer: NodeJS.Timeout | null = null;
      const finish = (value: EBeyannameCapturedResponse | null) => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        context.off?.('response', handler);
        resolve(value);
      };
      const handler = (response: any) => {
        const url = String(response?.url?.() || '');
        const headers = (response?.headers?.() || {}) as Record<string, string>;
        const mimeType = headers['content-type'] || '';
        if (!this.isEBeyannamePdfResponseCandidate(url, mimeType)) return;
        void (async () => {
          const status = Number(response?.status?.() || 0);
          let buffer = Buffer.alloc(0);
          try {
            buffer = Buffer.from(await response.body());
          } catch {
            buffer = Buffer.alloc(0);
          }
          const pdfish = /^%PDF/.test(buffer.subarray(0, 5).toString('latin1'))
            || /pdf|octet-stream/i.test(mimeType)
            || /\.pdf(?:$|[?#])/i.test(url);
          if (this.ebeyannameDebugEnabled()) {
            const bodyPreview = !pdfish && buffer.length && /json|text|html|javascript/i.test(mimeType)
              ? ` body="${this.safeDebugText(buffer.toString('utf8').slice(0, 1_000))}"`
              : '';
            this.logger.warn(`[EBDBG] netresp ${fallbackName} status=${status} mime=${mimeType || '-'} bytes=${buffer.length} pdfish=${pdfish}${bodyPreview} url=${this.safeUrl(url)}`);
          }
          if (status >= 200 && status < 300 && pdfish && buffer.length >= 200) {
            finish({ url, headers, buffer, mimeType: mimeType || 'application/pdf' });
          }
        })();
      };
      timer = setTimeout(() => finish(null), timeoutMs);
      context.on?.('response', handler);
    });
  }

  private isEBeyannamePdfResponseCandidate(url: string, mimeType: string) {
    const text = `${url || ''} ${mimeType || ''}`;
    return /cmd=IMAJ|subcmd=[^&]*(?:BEYANNAME|TAHAKKUK)GORUNTULE|application\/pdf|octet-stream|\.pdf(?:$|[?#])/i.test(text);
  }

  private async persistCapturedPdfResponse(
    response: EBeyannameCapturedResponse,
    downloadsPath: string,
    fallbackName: string,
  ): Promise<EBeyannameFilePayload> {
    return this.persistPdfBuffer(
      response.url,
      response.headers,
      response.buffer,
      downloadsPath,
      fallbackName,
      response.mimeType || response.headers['content-type'] || 'application/pdf',
    );
  }

  private async savePlaywrightDownload(download: any, downloadsPath: string, fallbackName: string): Promise<EBeyannameFilePayload | null> {
    const suggested = await download.suggestedFilename().catch(() => `${fallbackName}.pdf`);
    const fileName = this.safeFileName(suggested || `${fallbackName}.pdf`);
    const filePath = join(downloadsPath, `${randomUUID()}-${fileName}`);
    const saved = await this.withTimeout(
      download.saveAs(filePath).then(() => true),
      this.ebeyannameFileTimeoutMs(),
      async () => {
        await download.cancel?.().catch(() => {});
        return false;
      },
    );
    if (!saved) return null;
    const buffer = await readFile(filePath);
    return { base64: buffer.toString('base64'), fileName, mimeType: this.mimeFromName(fileName) };
  }

  private ebeyannameDownloadEventTimeoutMs() {
    return Math.max(3_000, Math.min(60_000, Number(process.env.PORTAL_AUTOMATION_EBEYANNAME_DOWNLOAD_EVENT_TIMEOUT_MS || 6_000)));
  }

  private async savePdfFromPopup(popup: any, downloadsPath: string, fallbackName: string): Promise<EBeyannameFilePayload | null> {
    try {
      const popupUrl = await this.waitForPopupTargetUrl(popup, Math.max(8_000, this.ebeyannameDownloadEventTimeoutMs())).catch(() => null);
      if (this.ebeyannameDebugEnabled()) {
        this.logger.warn(`[EBDBG] popup ${fallbackName} url=${this.safeUrl(String(popupUrl || popup.url?.() || ''))}`);
      }
      await popup.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
      const popupDownload = await popup.waitForEvent('download', { timeout: 3_000 }).catch(() => null);
      if (popupDownload) return await this.savePlaywrightDownload(popupDownload, downloadsPath, fallbackName);
      return await this.savePdfFromLoadedPage(popup, downloadsPath, fallbackName).catch(() => null)
        || await this.savePdfFromPageUrl(popup, downloadsPath, fallbackName);
    } finally {
      await popup.close?.().catch(() => {});
    }
  }

  private async waitForPopupTargetUrl(popup: any, timeoutMs: number) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const url = String(popup.url?.() || '');
      if (url && !/^about:blank$/i.test(url)) return url;
      await popup.waitForTimeout?.(250).catch(() => this.wait(250));
    }
    return String(popup.url?.() || '');
  }

  private async savePdfFromPageUrl(page: any, downloadsPath: string, fallbackName: string): Promise<EBeyannameFilePayload | null> {
    const url = String(page.url?.() || '');
    let buffer: Buffer | null = null;
    let mimeType = 'application/pdf';
    if (/^blob:/i.test(url)) {
      const base64 = await page.evaluate(async () => {
        const response = await fetch(window.location.href);
        const arrayBuffer = await response.arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(arrayBuffer);
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
      }).catch(() => null);
      if (base64) buffer = Buffer.from(base64, 'base64');
    } else if (/^https?:/i.test(url)) {
      const response = await page.context().request.get(url, { timeout: 15_000 }).catch(() => null);
      if (response?.ok()) {
        const headers = response.headers();
        mimeType = headers['content-type'] || mimeType;
        buffer = Buffer.from(await response.body());
      }
    }

    if (this.ebeyannameDebugEnabled()) {
      this.logger.warn(`[EBDBG] pageurl ${fallbackName} mime=${mimeType} bytes=${buffer?.length || 0} url=${this.safeUrl(url)}`);
    }
    if (!buffer || buffer.length < 200) return null;
    const fileName = this.safeFileName(`${fallbackName}.pdf`);
    const filePath = join(downloadsPath, `${randomUUID()}-${fileName}`);
    await writeFile(filePath, buffer).catch(() => {});
    return { base64: buffer.toString('base64'), fileName, mimeType };
  }

  private async savePdfFromLoadedPage(page: any, downloadsPath: string, fallbackName: string): Promise<EBeyannameFilePayload | null> {
    const timeoutMs = this.ebeyannameDirectFetchTimeoutMs();
    type LoadedPageResult = { ok: boolean; mimeType: string; base64: string } | null;
    const base64: LoadedPageResult = await this.withTimeout<LoadedPageResult>(
      page.evaluate(async (timeoutMs: number) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(window.location.href, {
            credentials: 'include',
            cache: 'no-store',
            signal: controller.signal,
          });
          const arrayBuffer = await response.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let binary = '';
          const chunkSize = 0x8000;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
          }
          return {
            ok: response.ok,
            mimeType: response.headers.get('content-type') || 'application/pdf',
            base64: btoa(binary),
          };
        } finally {
          clearTimeout(timer);
        }
      }, timeoutMs) as Promise<LoadedPageResult>,
      timeoutMs + 1_000,
      () => null,
    ).catch(() => null);
    if (!base64?.ok || !base64.base64) return null;
    const buffer = Buffer.from(base64.base64, 'base64');
    const mimeType = base64.mimeType || 'application/pdf';
    const pdfish = /^%PDF/.test(buffer.subarray(0, 5).toString('latin1')) || /pdf|octet-stream/i.test(mimeType);
    if (this.ebeyannameDebugEnabled()) {
      this.logger.warn(`[EBDBG] loaded ${fallbackName} ok=${base64.ok} mime=${mimeType} bytes=${buffer.length} pdfish=${pdfish} url=${this.safeUrl(String(page.url?.() || ''))}`);
    }
    if (!pdfish || buffer.length < 200) return null;
    const fileName = this.safeFileName(`${fallbackName}.pdf`);
    const filePath = join(downloadsPath, `${randomUUID()}-${fileName}`);
    await writeFile(filePath, buffer).catch(() => {});
    return { base64: buffer.toString('base64'), fileName, mimeType };
  }

  private async readEBeyannamePagination(page: any): Promise<{ start: number; end: number; total: number } | null> {
    const target = await this.findEBeyannameResultTarget(page) || page;
    return target.evaluate(() => {
      const text = document.body?.innerText || '';
      const match = text.match(/\b(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)\b/);
      if (!match) return null;
      return { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
    }).catch(() => null);
  }

  private async clickEBeyannameNextPage(page: any, before: { start: number; end: number; total: number }) {
    const target = await this.findEBeyannameResultTarget(page) || page;
    const clicked = await target.evaluate(() => {
      const norm = (value: string) => String(value || '')
        .toLocaleUpperCase('tr-TR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const isDisabled = (el: any) => !!el.disabled || /\bdisabled\b/i.test(String(el.className || '')) || el.getAttribute?.('aria-disabled') === 'true';
      const isVisible = (el: Element) => {
        const anyEl = el as HTMLElement;
        return !!(anyEl.offsetWidth || anyEl.offsetHeight || anyEl.getClientRects().length);
      };
      const controls = Array.from(document.querySelectorAll<HTMLElement>('button, input[type="button"], input[type="submit"], a'));
      const candidates = controls
        .filter((el: any) => isVisible(el) && !isDisabled(el))
        .map((el: any) => {
          const compact = `${el.textContent || ''} ${el.value || ''} ${el.getAttribute?.('title') || ''} ${el.getAttribute?.('aria-label') || ''} ${el.alt || ''}`.replace(/\s+/g, '').trim();
          const key = norm(`${el.textContent || ''} ${el.value || ''} ${el.getAttribute?.('title') || ''} ${el.getAttribute?.('aria-label') || ''} ${el.alt || ''}`);
          let score = 0;
          if (compact === '>' || compact === '›') score = 100;
          else if (/SONRAKI|ILERI|NEXT/.test(key)) score = 90;
          else if (compact === '>>' || compact === '»') score = 50;
          return { el, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);
      if (!candidates.length) return false;
      candidates[0].el.click();
      return true;
    }).catch(() => false);
    if (!clicked) return false;

    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(500);
      const current = await this.readEBeyannamePagination(page);
      if (current && (current.start !== before.start || current.end !== before.end)) return true;
    }
    return false;
  }

  private async closeEBeyannameResultList(page: any) {
    const target = await this.findEBeyannameResultTarget(page) || page;
    const closed = await target.evaluate(() => {
      const norm = (value: string) => String(value || '')
        .toLocaleUpperCase('tr-TR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const isVisible = (el: Element) => {
        const anyEl = el as HTMLElement;
        return !!(anyEl.offsetWidth || anyEl.offsetHeight || anyEl.getClientRects().length);
      };
      const directClose = document.querySelector<HTMLElement>('div[id^="bynList"][id$="_close"], .alphacube_close');
      if (directClose && isVisible(directClose)) {
        directClose.click();
        return true;
      }
      const controls = Array.from(document.querySelectorAll<HTMLElement>('button, input[type="button"], a, img, div'));
      const belongsToList = (el: HTMLElement) => {
        let node: HTMLElement | null = el;
        for (let i = 0; node && i < 8; i++) {
          if (norm(node.textContent || '').includes('BEYANNAME LISTESI')) return true;
          node = node.parentElement;
        }
        return false;
      };
      const closeControls = controls
        .filter((el: any) => {
          if (!isVisible(el)) return false;
          if (!belongsToList(el)) return false;
          const text = norm(`${el.textContent || ''} ${el.value || ''} ${el.alt || ''} ${el.title || ''} ${el.getAttribute?.('aria-label') || ''} ${el.className || ''}`);
          return text === 'X' || text.includes('CLOSE') || text.includes('KAPAT');
        })
        .sort((a, b) => {
          const ar = a.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          return ar.top - br.top || br.left - ar.left;
        });
      const target = closeControls[0];
      if (!target) return false;
      target.click();
      return true;
    }).catch(() => false);

    if (!closed) {
      await page.keyboard.press('Escape').catch(() => {});
    }
    await page.waitForTimeout(500);
  }

  private ebeyannameDonemFromRow(row: EBeyannameResultRow, beyanTipi: string, job: any) {
    const fallback = job.donem || this.inferDonem(job.periodEnd);
    const text = `${row.taxPeriod || ''} ${row.rowText || ''}`;
    const match = text.match(/\b(?:(0?[1-9]|1[0-2])\/(20\d{2})|(20\d{2})\/(0?[1-9]|1[0-2]))\s*-\s*(?:(0?[1-9]|1[0-2])\/(20\d{2})|(20\d{2})\/(0?[1-9]|1[0-2]))\b/);
    if (!match) return /GECICI/.test(beyanTipi) ? this.canonicalTemporaryDonem(fallback) : fallback;
    const startMonth = Number(match[1] || match[4]);
    const startYear = Number(match[2] || match[3]);
    const endMonth = Number(match[5] || match[8]);
    const endYear = Number(match[6] || match[7]);
    if (!startYear || !endYear) return fallback;
    if (startYear !== endYear) return `${endYear}-YIL`;
    if (beyanTipi === 'KURUMLAR' || beyanTipi === 'GELIR') return `${startYear}-YIL`;
    if (endMonth - startMonth >= 2 || /GECICI/.test(beyanTipi)) {
      return `${endYear}-Q${Math.ceil(endMonth / 3)}`;
    }
    return `${endYear}-${String(endMonth).padStart(2, '0')}`;
  }

  private canonicalTemporaryDonem(donem: string) {
    const monthly = String(donem || '').match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
    if (!monthly) return donem;
    return `${monthly[1]}-Q${Math.ceil(Number(monthly[2]) / 3)}`;
  }

  private parseEBeyannameUploadTime(value?: string | null) {
    const text = String(value || '');
    const match = text.match(/\b(\d{2})\.(\d{2})\.(20\d{2})(?:\s*-\s*(\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!match) return null;
    const [, day, month, year, hour = '12', minute = '00', second = '00'] = match;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}+03:00`;
  }

  private async clickVisibleText(page: any, texts: string[]) {
    for (const target of this.ebeyannameDomTargets(page)) {
      for (const text of texts) {
        const loc = target.getByText(text, { exact: false }).first();
        if (await loc.isVisible().catch(() => false)) {
          await loc.click({ timeout: 8_000 });
          return true;
        }
      }
    }
    return false;
  }

  private async clickNormalizedText(page: any, normalizedTexts: string[]) {
    for (const target of this.ebeyannameDomTargets(page)) {
      const clicked = await target.evaluate((normalizedTexts: string[]) => {
        const norm = (value: string) => String(value || '')
          .toLocaleUpperCase('tr-TR')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        const isVisible = (el: Element) => {
          const anyEl = el as HTMLElement;
          return !!(anyEl.offsetWidth || anyEl.offsetHeight || anyEl.getClientRects().length);
        };
        const controls = Array.from(document.querySelectorAll<HTMLElement>('a, button, input[type="button"], input[type="submit"], td, span, div'));
        const picked = controls.find((el: any) => {
          if (!isVisible(el)) return false;
          const text = norm(`${el.innerText || ''} ${el.value || ''} ${el.title || ''} ${el.name || ''} ${el.id || ''}`);
          return normalizedTexts.some((wanted) => text.includes(wanted));
        });
        if (!picked) return false;
        picked.click();
        return true;
      }, normalizedTexts).catch(() => false);
      if (clicked) return true;
    }
    return false;
  }

  private async isAnyTextVisible(page: any, texts: string[]) {
    for (const target of this.ebeyannameDomTargets(page)) {
      for (const text of texts) {
        if (await target.getByText(text, { exact: false }).first().isVisible().catch(() => false)) return true;
      }
    }
    return false;
  }

  private async visibleActionSnapshot(page: any) {
    const pieces: string[] = [];
    for (const target of this.ebeyannameDomTargets(page)) {
      const snapshot = await target.evaluate(() => {
        const isVisible = (el: Element) => {
          const anyEl = el as HTMLElement;
          return !!(anyEl.offsetWidth || anyEl.offsetHeight || anyEl.getClientRects().length);
        };
        return Array.from(document.querySelectorAll<HTMLElement>('a, button, input, select, span[onclick], div[onclick], form'))
          .filter(isVisible)
          .slice(0, 60)
          .map((el: any) => {
            const label = (el.innerText || el.value || el.placeholder || el.title || el.name || el.id || '').replace(/\s+/g, ' ').trim();
            const marker = [el.id, el.name, el.getAttribute?.('onclick')]
              .filter(Boolean)
              .join(' ');
            return `${el.tagName}:${label}${marker ? ` [${marker}]` : ''}`;
          })
          .filter(Boolean)
          .join(' | ')
          .slice(0, 1000);
      }).catch(() => '');
      if (snapshot) {
        const url = String(target.url?.() || '').replace(/([?&](?:password|sifre|parola|token|kod)=)[^&]+/gi, '$1***');
        pieces.push(`${url || 'page'} => ${snapshot}`);
      }
    }
    return pieces.join(' || ').slice(0, 1200);
  }

  private istanbulDateParts(value?: string | Date | null) {
    const display = this.formatDateInput(value);
    if (!display) return null;
    const parts = display.split('.');
    if (parts.length !== 3) return null;
    return { day: parts[0], month: parts[1], year: parts[2], display };
  }

  private async tryNavigateToDeclarationList(page: any) {
    const candidates = [
      'Verilen Beyannameler',
      'Gonderilen Beyannameler',
      'Gönderilen Beyannameler',
      'Beyanname Sorgulama',
      'Paket Sorgulama',
      'Paket Listesi',
      'Onaylanan Beyannameler',
      'Tahakkuk',
      'Beyannamelerim',
    ];
    for (const text of candidates) {
      const loc = page.getByText(text, { exact: false }).first();
      if (!(await loc.isVisible().catch(() => false))) continue;
      await Promise.all([
        page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {}),
        loc.click({ timeout: 5000 }),
      ]).catch(() => {});
      await page.waitForTimeout(1000);
      const body = await this.bodyText(page);
      if (/beyanname|tahakkuk|paket|liste|sorgu/i.test(body)) return true;
    }
    return false;
  }

  private async fillDateRangeIfPossible(page: any, start?: string | Date | null, end?: string | Date | null) {
    const startText = this.formatDateInput(start);
    const endText = this.formatDateInput(end);
    if (!startText || !endText) return;

    const visible = page.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"])');
    const count = await visible.count().catch(() => 0);
    const dateInputs: any[] = [];
    for (let i = 0; i < count; i++) {
      const loc = visible.nth(i);
      if (!(await loc.isVisible().catch(() => false))) continue;
      const attrs = await loc.evaluate((el: any) => ({
        name: el.getAttribute('name') || '',
        id: el.getAttribute('id') || '',
        placeholder: el.getAttribute('placeholder') || '',
        type: el.getAttribute('type') || '',
        value: el.value || '',
      })).catch(() => null);
      const haystack = `${attrs?.name || ''} ${attrs?.id || ''} ${attrs?.placeholder || ''} ${attrs?.type || ''}`;
      if (/tarih|date|baslangic|başlangıç|bitis|bitiş|ilk|son/i.test(haystack)) dateInputs.push(loc);
    }
    if (dateInputs.length >= 2) {
      await dateInputs[0].fill(startText);
      await dateInputs[1].fill(endText);
    }
  }

  private async clickSearchIfPossible(page: any) {
    const selectors = [
      'button:has-text("Sorgula")',
      'button:has-text("Listele")',
      'button:has-text("Ara")',
      'input[value*="Sorgula" i]',
      'input[value*="Listele" i]',
      'input[value*="Ara" i]',
      'a:has-text("Sorgula")',
      'a:has-text("Listele")',
    ];
    for (const target of this.ebeyannameDomTargets(page)) {
      for (const selector of selectors) {
        const loc = target.locator(selector).first();
        if (await loc.isVisible().catch(() => false)) {
          await Promise.all([
            page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {}),
            loc.click({ timeout: 5000 }),
          ]);
          await page.waitForTimeout(1500);
          return;
        }
      }
    }
  }

  private async clickAndCollectDownloadLinks(
    page: any,
    downloadsPath: string,
    taxpayers: TaxpayerMatch[],
    job: any,
  ) {
    const declarations: any[] = [];
    const documents: any[] = [];
    const notes: string[] = [];
    const max = Math.max(1, Math.min(200, Number(process.env.PORTAL_AUTOMATION_EBEYANNAME_MAX_DOWNLOADS || 80)));
    const selector = process.env.PORTAL_AUTOMATION_EBEYANNAME_DOWNLOAD_SELECTOR || 'a, button, input[type="button"], input[type="submit"]';
    const candidates = page.locator(selector);
    const count = Math.min(await candidates.count().catch(() => 0), 1000);
    let clicked = 0;

    for (let i = 0; i < count && clicked < max; i++) {
      const loc = candidates.nth(i);
      if (!(await loc.isVisible().catch(() => false))) continue;
      const meta = await loc.evaluate((el: any) => {
        const row = el.closest('tr') || el.closest('[role="row"]') || el.parentElement;
        return {
          text: `${el.innerText || el.value || el.getAttribute('title') || ''}`.trim(),
          href: el.getAttribute('href') || '',
          download: el.getAttribute('download') || '',
          rowText: `${row?.innerText || ''}`.trim(),
        };
      }).catch(() => null);
      const haystack = `${meta?.text || ''} ${meta?.href || ''} ${meta?.download || ''} ${meta?.rowText || ''}`;
      if (!TEXT.download.test(haystack)) continue;

      const download = await Promise.all([
        page.waitForEvent('download', { timeout: 12_000 }).catch(() => null),
        loc.click({ timeout: 8000 }).catch(() => null),
      ]).then(([d]) => d).catch(() => null);

      if (!download) {
        notes.push(`Tiklandi ama download gelmedi: ${this.compact(meta?.text || meta?.href || 'isimsiz')}`);
        continue;
      }

      clicked++;
      const suggested = await download.suggestedFilename().catch(() => `ebeyanname-${clicked}.pdf`);
      const filePath = join(downloadsPath, `${clicked}-${this.safeFileName(suggested)}`);
      await download.saveAs(filePath);
      const buffer = await readFile(filePath);
      const base64 = buffer.toString('base64');
      const contextText = `${suggested} ${haystack}`;
      const taxpayerId = this.matchTaxpayerId(contextText, taxpayers);
      const kind = this.guessDownloadKind(contextText);
      const fallbackDonem = job.donem || this.inferDonem(job.periodEnd);
      const donem = this.guessDonem(contextText, fallbackDonem);
      const beyanTipi = this.guessBeyanTipi(contextText);
      const onayNo = this.guessApprovalNo(contextText);
      const tahakkukTutari = this.guessMoneyAmount(contextText);

      if (taxpayerId) {
        declarations.push({
          taxpayerId,
          beyanTipi,
          donem,
          beyanTarihi: job.periodEnd || new Date().toISOString(),
          tahakkukTutari: kind === 'tahakkuk' ? tahakkukTutari : null,
          onayNo,
          beyannameBase64: kind === 'beyanname' ? base64 : null,
          tahakkukBase64: kind === 'tahakkuk' ? base64 : null,
          xmlBase64: kind === 'xml' ? base64 : null,
          beyannameFileName: kind === 'beyanname' ? suggested : null,
          tahakkukFileName: kind === 'tahakkuk' ? suggested : null,
          raw: { runner: 'railway', rowText: this.compact(meta?.rowText || ''), fileName: suggested, beyanTipi, donem, onayNo },
        });
      } else {
        documents.push({
          taxpayerId: null,
          belgeTuru: kind === 'tahakkuk' ? 'GIB_TAHAKKUK' : kind === 'xml' ? 'GIB_XML' : 'GIB_BEYANNAME',
          title: suggested || 'e-Beyanname belgesi',
          period: donem,
          issuedAt: job.periodEnd || null,
          receivedAt: new Date().toISOString(),
          mimeType: this.mimeFromName(suggested),
          originalName: suggested,
          base64,
          raw: { runner: 'railway', rowText: this.compact(meta?.rowText || ''), matchedTaxpayer: false, beyanTipi, donem, onayNo },
        });
      }
    }

    notes.push(`${clicked} download yakalandi`);
    return { declarations, documents, notes };
  }

  private async loadTaxpayers(tenantId: string): Promise<TaxpayerMatch[]> {
    return (this.prisma as any).taxpayer.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, taxNumber: true, companyName: true, firstName: true, lastName: true },
      take: 5000,
    });
  }

  private matchTaxpayerId(text: string, taxpayers: TaxpayerMatch[]) {
    const normalized = text.replace(/\D/g, '');
    for (const taxpayer of taxpayers) {
      const taxNumber = String(tryDecrypt(taxpayer.taxNumber) || taxpayer.taxNumber || '').replace(/\D/g, '');
      if (taxNumber && normalized.includes(taxNumber)) return taxpayer.id;
    }
    const textKey = this.normalizeTextKey(text);
    const names = taxpayers
      .map((taxpayer) => {
        const name = taxpayer.companyName || [taxpayer.firstName, taxpayer.lastName].filter(Boolean).join(' ');
        return { taxpayer, key: this.normalizeTextKey(name) };
      })
      .filter((item) => item.key.length >= 8)
      .sort((a, b) => b.key.length - a.key.length);

    for (const item of names) {
      if (textKey.includes(item.key)) return item.taxpayer.id;
    }

    // GIB sonuc listesinde ad/unvani KISALTABILIYOR ("KEREM MEVLUT DA..."), bu yuzden
    // tam ad metinde gecmeyebilir. Ayrica gercek kisilerde GIB 11-hane TCKN gosterirken
    // portalda 10-hane VKN tutulabildigi icin VKN eslesmesi de tutmaz. Mukellef adinin
    // yeterince uzun bir ON-EKI metinde geciyorsa VE bu on-ek BASKA mukellefle karismiyorsa
    // (benzersizse) guvenle esle. Benzersizlik sarti yanlis firmaya baglamayi onler.
    const MIN_PREFIX = 11;
    const candidates = names.filter(
      (item) => item.key.length >= MIN_PREFIX && textKey.includes(item.key.slice(0, MIN_PREFIX)),
    );
    for (const item of candidates) {
      let len = item.key.length;
      while (len > MIN_PREFIX && !textKey.includes(item.key.slice(0, len))) len--;
      const prefix = item.key.slice(0, len);
      if (!textKey.includes(prefix)) continue;
      const clash = names.some(
        (other) => other.taxpayer.id !== item.taxpayer.id && other.key.startsWith(prefix),
      );
      if (!clash) return item.taxpayer.id;
    }
    return null;
  }

  /**
   * Eslesmeyen bir satir icin: ayni VKN'li veya benzer isimli mukellefi DB'den (aktif/pasif farketmeksizin)
   * arar ve neden eslesmedigini loglar. Sebep: VKN bos/farkli mi, sifreli/uzun mu, mukellef pasif mi, isim mi.
   */
  private async diagnoseEBeyannameUnmatch(tenantId: string, row: EBeyannameResultRow) {
    const rowVkn = String(row.taxNumber || '').replace(/\D/g, '');
    if (!rowVkn) return;
    try {
      const byVkn = await (this.prisma as any).taxpayer.findMany({
        where: { tenantId, taxNumber: { contains: rowVkn } },
        select: { id: true, taxNumber: true, isActive: true, companyName: true, firstName: true, lastName: true },
        take: 3,
      });
      const nameQ = this.compact(row.taxpayerName || '').split(' ').filter((w) => w.length >= 3)[0] || '';
      const byName = nameQ
        ? await (this.prisma as any).taxpayer.findMany({
            where: {
              tenantId,
              OR: [
                { companyName: { contains: nameQ, mode: 'insensitive' } },
                { firstName: { contains: nameQ, mode: 'insensitive' } },
                { lastName: { contains: nameQ, mode: 'insensitive' } },
              ],
            },
            select: { id: true, taxNumber: true, isActive: true, companyName: true, firstName: true, lastName: true },
            take: 3,
          })
        : [];
      const fmt = (t: any) => {
        const tax = String(t.taxNumber || '');
        const ad = this.compact(t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ')).slice(0, 30);
        return `{aktif=${t.isActive} vknUzunluk=${tax.length} vkn="${tax.slice(0, 4)}..${tax.slice(-2)}" ad="${ad}"}`;
      };
      this.logger.warn(
        `[EBMATCH] rowVkn=${rowVkn} rowAd="${this.compact(row.taxpayerName || '')}" :: `
        + `vknIle=${byVkn.length ? byVkn.map(fmt).join(' ') : 'YOK'} | `
        + `isimIle=${byName.length ? byName.map(fmt).join(' ') : 'YOK'}`,
      );
    } catch (e: any) {
      this.logger.warn(`[EBMATCH] teshis hata: ${this.compact(e?.message || e)}`);
    }
  }

  private guessDownloadKind(text: string) {
    const key = this.normalizeTextKey(text);
    if (/\bXML\b/.test(key)) return 'xml';
    if (/TAHAKKUK|FIS/.test(key)) return 'tahakkuk';
    if (/xml/i.test(text)) return 'xml';
    if (/tahakkuk|fis|fiş/i.test(text)) return 'tahakkuk';
    return 'beyanname';
  }

  private taxpayerLooksCorporate(taxpayer?: TaxpayerMatch | null) {
    const taxNumber = String(taxpayer?.taxNumber || '').replace(/\D/g, '');
    const nameKey = this.normalizeTextKey([
      taxpayer?.companyName,
      taxpayer?.firstName,
      taxpayer?.lastName,
    ].filter(Boolean).join(' '));
    if (/\b(LIMITED|LTD|ANONIM|A S|AS|SIRKET|SIRKETI|STI|KOOPERATIF)\b/.test(nameKey)) return true;
    return taxNumber.length === 10;
  }

  private taxpayerLooksPersonal(taxpayer?: TaxpayerMatch | null) {
    const taxNumber = String(taxpayer?.taxNumber || '').replace(/\D/g, '');
    return taxNumber.length === 11 && !this.taxpayerLooksCorporate(taxpayer);
  }

  private guessBeyanTipi(text: string, taxpayer?: TaxpayerMatch | null) {
    const key = this.normalizeTextKey(text);
    if (/\bKDV\s*1\b|KDV1|KDVBEYANNAMESI/.test(key)) return 'KDV1';
    if (/\bKDV\s*2\b|KDV2|TEVKIFAT/.test(key)) return 'KDV2';
    if (/MUHSGK|MUHTASAR|MUHTASARPRIM|PRIMHIZMET/.test(key)) return 'MUHSGK';
    if (/DAMGA/.test(key)) return 'DAMGA';
    if (/POSET|GEKAP/.test(key)) return 'POSET';
    if (/GECICI/.test(key)) {
      if (this.taxpayerLooksCorporate(taxpayer)) return 'KGECICI';
      if (this.taxpayerLooksPersonal(taxpayer)) return 'GGECICI';
      if (/KGECICI|KURUM|KURUMLAR/.test(key)) return 'KGECICI';
      if (/GGECICI|GELIR|GELIRVERGISI/.test(key)) return 'GGECICI';
      return 'GECICI_VERGI';
    }
    if (/KURUMLAR/.test(key)) return 'KURUMLAR';
    if (/GELIR/.test(key)) return 'GELIR';
    if (/EDEFTER|E DEFTER|BERAT/.test(key)) return 'EDEFTER';
    const upper = text.toLocaleUpperCase('tr-TR');
    const known = ['KDV1', 'KDV2', 'KDV2B', 'KDV4', 'MUHSGK', 'MUHTASAR', 'KURUMLAR', 'GECICI', 'GEÇICI', 'DAMGA', 'BA_BS'];
    return known.find((k) => upper.includes(k)) || 'DIGER';
  }

  private guessDonem(text: string, fallback: string) {
    const normalized = String(text || '').replace(/\s+/g, ' ');
    const iso = normalized.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])\b/);
    if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, '0')}`;
    const monthYear = normalized.match(/\b(0?[1-9]|1[0-2])[-/.](20\d{2})\b/);
    if (monthYear) return `${monthYear[2]}-${String(Number(monthYear[1])).padStart(2, '0')}`;

    const key = this.normalizeTextKey(normalized);
    const quarter = key.match(/\b(20\d{2})\s*([1-4])\s*(DONEM|GECICI)\b/);
    if (quarter) return `${quarter[1]}-${String(Number(quarter[2]) * 3).padStart(2, '0')}`;
    const yearly = key.match(/\b(20\d{2})\b/);
    if (yearly && /(YILLIK|KURUMLAR|GELIR)/.test(key)) return `${yearly[1]}-YIL`;
    return fallback;
  }

  private guessApprovalNo(text: string) {
    const normalized = String(text || '').replace(/\s+/g, ' ');
    const labelled = normalized.match(/(?:onay|tahakkuk|fis|fiş)\s*(?:no|numarasi|numarası)?\s*[:#-]?\s*([A-Z0-9-]{6,40})/i);
    if (labelled) return labelled[1].slice(0, 80);
    const plain = normalized.match(/\b\d{7,18}\b/);
    return plain ? plain[0] : null;
  }

  private guessMoneyAmount(text: string) {
    const matches = Array.from(String(text || '').matchAll(/(?:^|[^\d])(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})(?:\s*(?:TL|TRY|\u20BA))?/gi));
    if (!matches.length) return null;
    const values = matches
      .map((m) => Number(m[1].replace(/\./g, '').replace(',', '.')))
      .filter((n) => Number.isFinite(n) && n >= 0);
    if (!values.length) return null;
    return Math.max(...values);
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

  private isEBeyannameCorrectionText(value?: string | null) {
    return /\bDUZELTME\b/.test(this.normalizeTextKey(value));
  }

  private mimeFromName(name: string) {
    const lower = String(name || '').toLowerCase();
    if (lower.endsWith('.xml')) return 'application/xml';
    if (lower.endsWith('.zip')) return 'application/zip';
    if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
    if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return 'application/pdf';
  }

  private formatDateInput(value?: string | Date | null) {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    const fmt = new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    return fmt.format(d);
  }

  private inferDonem(value?: string | Date | null) {
    const d = value ? new Date(value) : new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(d);
    const year = parts.find((p) => p.type === 'year')?.value || String(d.getFullYear());
    const month = parts.find((p) => p.type === 'month')?.value || String(d.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  private async bodyText(page: any) {
    return ((await page.textContent('body').catch(() => '')) || '').slice(0, 20_000);
  }

  private publicError(err: any) {
    return String(err?.message || err || 'Railway runner hatasi').replace(/\s+/g, ' ').slice(0, 1000);
  }

  private compact(value: string) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  private wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private safeUrl(url: string) {
    return String(url || '').replace(/([?&](?:password|sifre|parola|token|kod)=)[^&]+/gi, '$1***');
  }

  private safeDebugText(value: string) {
    return this.compact(value)
      .replace(/((?:TOKEN|token|password|sifre|parola|kod)\s*["':=]\s*)[^"',\s}&]+/gi, '$1***')
      .replace(/([?&](?:password|sifre|parola|token|kod)=)[^&\s"']+/gi, '$1***');
  }

  private safeFileName(value: string) {
    return String(value || 'download.bin').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  }
}
