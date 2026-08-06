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
// Onaylı hizmet listesi + tahakkuk e-Bildirge V2'de (İşveren Sistemi'nde DEĞİL).
const DEFAULT_SGK_EBILDIRGE_LOGIN_URL = 'https://ebildirge.sgk.gov.tr/EBildirgeV2';

const JOB_TYPES_DEFAULT: PortalJobType[] = [
  'EBEYANNAME_DAILY_DOWNLOAD',
  'EBEYAN_NEW_DOWNLOAD',
  'E_TEBLIGAT_CHECK',
  'SGK_HIZMET_LISTESI',
  'SGK_TAHAKKUK',
  'SGK_ISE_GIRIS_CIKIS',
  'SGK_ISGOREMEZLIK',
  'EARSIV_PORTAL_FETCH',
  'GALERI_HGS',
];

// KGM ihlal sorgulama sayfasi (HGS). GIB girisi gerektirmez; matematik captcha'li.
const KGM_HGS_URL = 'https://webihlaltakip.kgm.gov.tr/WebIhlalSorgulama/Sayfalar/Sorgulama.aspx?lang=tr';
// Galeri araç plakalarinin okundugu Dijital Vergi Dairesi ekrani.
const GIB_ARAC_BILGILERIM_URL = 'https://dijital.gib.gov.tr/portal/arac-bilgilerim';
// HGS borç özeti WhatsApp hedef numaralari (kullanici karari: sabit iki numara).
const GALERI_HGS_WHATSAPP_PHONES = ['05348610965', '05350587475'];

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
  // GIB e-Arsiv Turkiye cikis proxy'si (TURMOB ile ayni tinyproxy). undici ProxyAgent tek sefer kurulur;
  //   TURMOB_PROXY_URL yoksa direkt cikis (davranis degismez). turmobFetch ile ayni desen.
  private _earsivDispatcher: any = undefined;
  private _earsivRelayDispatcher: any = undefined;

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
      const parallelJobs = jobs.filter((job: any) => this.canRunParallel(job));
      const sequentialJobs = jobs.filter((job: any) => !this.canRunParallel(job));
      if (parallelJobs.length > 1) {
        this.logger.log(`[PortalRailwayRunner] paralel dogrulama havuzu: ${parallelJobs.length} is, limit=${this.parallelJobConcurrency()}`);
      }
      await this.runParallelJobs(parallelJobs);
      for (const job of sequentialJobs) {
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
      'EBEYAN_NEW_DOWNLOAD',
      'E_TEBLIGAT_CHECK',
      'SGK_HIZMET_LISTESI',
      'SGK_TAHAKKUK',
      'SGK_ISE_GIRIS_CIKIS',
      'SGK_ISGOREMEZLIK',
      'EARSIV_PORTAL_FETCH',
      'GALERI_HGS',
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
    const concurrency = this.parallelJobConcurrency();
    const batch = this.numberInRange(process.env.PORTAL_AUTOMATION_RAILWAY_RUNNER_BATCH, concurrency, 1, 10);
    return Math.max(concurrency, batch);
  }

  private parallelJobConcurrency() {
    const raw = process.env.PORTAL_AUTOMATION_RAILWAY_RUNNER_CONCURRENCY
      || process.env.PORTAL_AUTOMATION_RAILWAY_RUNNER_PARALLEL;
    return this.numberInRange(raw, 5, 1, 8);
  }

  private numberInRange(raw: string | number | undefined, fallback: number, min: number, max: number) {
    const parsed = Number(raw);
    const value = Number.isFinite(parsed) ? parsed : fallback;
    return Math.max(min, Math.min(max, value));
  }

  private canRunParallel(job: any) {
    return job?.jobType === 'E_TEBLIGAT_CHECK' || job?.jobType === 'SGK_HIZMET_LISTESI';
  }

  private async runParallelJobs(jobs: any[]) {
    await this.mapWithConcurrency(jobs, this.parallelJobConcurrency(), async (job: any) => {
      await this.runOne(job).catch((err) => {
        this.logger.warn(`[PortalRailwayRunner] job ${job.id} beklenmeyen hata: ${err?.message || err}`);
      });
    });
  }

  wake(reason = 'manual') {
    if (!this.isEnabled()) return false;
    setTimeout(() => {
      this.tick().catch((err) => this.logger.warn(`wake(${reason}) hata: ${err?.message || err}`));
    }, 250).unref();
    return true;
  }

  async validateCredentialNow(tenantId: string, credential: RunnerCredential & { ownerType?: string; ownerId?: string; taxpayerId?: string | null }) {
    const provider = String(credential?.provider || '').toUpperCase();
    const ownerType = String(credential?.ownerType || 'TAXPAYER');
    const ownerId = String(credential?.ownerId || credential?.taxpayerId || '');
    const checkedAt = new Date();

    if (!ownerId || !['GIB_IVD', 'SGK_EBILDIRGE'].includes(provider)) {
      return { checked: false, ok: false, error: 'Dogrulama kapsami disinda' };
    }

    try {
      await this.validatePortalLogin(provider as 'GIB_IVD' | 'SGK_EBILDIRGE', credential);
      await this.updateCredentialValidation(tenantId, provider, ownerType, ownerId, true, null, checkedAt);
      return { checked: true, ok: true, checkedAt: checkedAt.toISOString() };
    } catch (err: any) {
      const error = this.compact(String(err?.message || err || 'Portal girisi dogrulanamadi')).slice(0, 1000);
      await this.updateCredentialValidation(tenantId, provider, ownerType, ownerId, false, error, checkedAt).catch(() => {});
      return { checked: true, ok: false, checkedAt: checkedAt.toISOString(), error };
    }
  }

  private async updateCredentialValidation(
    tenantId: string,
    provider: string,
    ownerType: string,
    ownerId: string,
    ok: boolean,
    error: string | null,
    checkedAt: Date,
  ) {
    await (this.prisma as any).portalCredential.updateMany({
      where: { tenantId, provider, ownerType, ownerId },
      data: ok
        ? { lastCheckedAt: checkedAt, lastSuccessAt: checkedAt, lastError: null }
        : { lastCheckedAt: checkedAt, lastError: error },
    });
  }

  private async validatePortalLogin(provider: 'GIB_IVD' | 'SGK_EBILDIRGE', credential: RunnerCredential) {
    const jobType: PortalJobType = provider === 'SGK_EBILDIRGE' ? 'SGK_HIZMET_LISTESI' : 'E_TEBLIGAT_CHECK';
    const isSgk = provider === 'SGK_EBILDIRGE';

    if (isSgk) {
      if (!(credential.username || credential.userCode) || !credential.workplaceCode || !credential.password || !credential.secondaryPassword) {
        throw new Error('SGK kullanici adi, e-kod, sistem sifresi ve isyeri sifresi eksik');
      }
    } else if (!credential.userCode || !(credential.secondaryPassword || credential.password)) {
      throw new Error('Vergi dairesi kullanici kodu ve sifre eksik');
    }

    const browser = await pwChromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROMIUM_PATH,
      headless: this.browserHeadless(),
      args: this.browserLaunchArgs(),
    });

    try {
      const context = await browser.newContext({
        acceptDownloads: false,
        viewport: { width: 1280, height: 900 },
        locale: 'tr-TR',
        timezoneId: 'Europe/Istanbul',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });
      await this.applyBrowserStealth(context);
      const page = await context.newPage();
      page.setDefaultTimeout(12_000);

      const loginUrl = this.loginUrlForJob(jobType);
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      if (provider === 'GIB_IVD') {
        await this.loginGibDigitalWithCaptcha(page, credential, loginUrl, 'credential-validation');
      } else if (provider === 'SGK_EBILDIRGE') {
        await this.loginSgkWithCaptcha(page, credential, loginUrl, 'credential-validation');
      } else {
        await this.fillPortalLoginForProvider(page, provider, jobType, credential);
        await this.finishLoginAfterFill(page);
      }
      await context.close().catch(() => {});
    } finally {
      await browser.close().catch(() => {});
    }
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
      // GALERI_HGS: kgm_test modunda GIB girisi/kimlik gerekmez (sadece KGM sorgusu).
      // Tam modda GIB_IVD kimligi getCredentialForJob ile cozulur.
      if (job.jobType === 'GALERI_HGS') {
        const result = await this.runGaleriHgs(job);
        await this.portalAutomation.completeJob(job.tenantId, job.id, result);
        this.logger.log(`[PortalRailwayRunner] job tamam: ${job.id} GALERI_HGS count=${result.recordCount || 0}`);
        return;
      }
      const bundle = await this.portalAutomation.getCredentialForJob(job.tenantId, job.id) as RunnerJobBundle;
      if (job.jobType === 'EBEYANNAME_DAILY_DOWNLOAD') {
        const result = await this.runEBeyanname(job.tenantId, bundle);
        await this.portalAutomation.completeJob(job.tenantId, job.id, result);
        this.logger.log(`[PortalRailwayRunner] job tamam: ${job.id} count=${result.recordCount || 0}`);
        return;
      }
      if (job.jobType === 'EBEYAN_NEW_DOWNLOAD') {
        const result = await this.runEBeyanNew(job.tenantId, bundle);
        await this.portalAutomation.completeJob(job.tenantId, job.id, result);
        this.logger.log(`[PortalRailwayRunner] job tamam: ${job.id} EBEYAN_NEW count=${result.recordCount || 0}`);
        return;
      }
      if (job.jobType === 'E_TEBLIGAT_CHECK' || job.jobType === 'EARSIV_PORTAL_FETCH' || job.jobType.startsWith('SGK_')) {
        const result = await this.runPortalDocumentJob(job.tenantId, bundle);
        await this.portalAutomation.completeJob(job.tenantId, job.id, result);
        this.logger.log(`[PortalRailwayRunner] job tamam: ${job.id} count=${result.recordCount || 0}`);
        return;
      }
      throw new Error(`${job.jobType} icin Railway runner tanimli degil`);
    } catch (err: any) {
      const message = this.publicError(err);
      // KISMİ SONUÇ KORUMASI (kullanıcı bulgusu — "bazen takılıyor, belge getirmiyor"): bir sorgu
      //   (örn. GİB e-Arşiv) yarıda kesilirse (token süresi dolması, ağ kopması vb.) o ana kadar
      //   toplanan belgeler eskiden TAMAMEN kayboluyordu — hiçbir yere kaydedilmeden job FAILED
      //   oluyordu. collectEarsivPortalViaApi artık böyle bir hatada documents'ı hata objesine
      //   ekliyor (err.partialDocuments); burada job HALA 'running' iken (markFailed'den ÖNCE)
      //   kaydedilir. Dedup zaten referenceNo bazlı (storePortalDocumentFromAgent) — tekrar
      //   denendiğinde aynı belgeler ikinci kez oluşturulmaz, sadece eksikler tamamlanır.
      const partialDocuments = Array.isArray((err as any)?.partialDocuments) ? (err as any).partialDocuments : [];
      if (partialDocuments.length) {
        await this.portalAutomation.savePartialJobResults(job.tenantId, job.id, { documents: partialDocuments }).catch((saveErr: any) => {
          this.logger.warn(`[PortalRailwayRunner] kismi sonuc kaydedilemedi: ${job.id} ${saveErr?.message || saveErr}`);
        });
        this.logger.log(`[PortalRailwayRunner] job yarida kesildi ama ${partialDocuments.length} belge kaydedildi: ${job.id}`);
      }
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

  /**
   * YENİ e-Beyan sistemi (ebeyan.gib.gov.tr) — AYRI iş. Taze Dijital Vergi Dairesi
   * girişi → "e-Beyan" uygulaması → /beyannameler filtrele + PDF/tahakkuk indir.
   * Eski sistemden BAĞIMSIZ (fresh login → tile temiz açılır, "sekmesi açılmadı" çözülür).
   */
  private async runEBeyanNew(tenantId: string, bundle: RunnerJobBundle) {
    const credential = bundle.credential;
    await this.jobProgress(tenantId, bundle.job, 'credential', 'e-Beyanname sifresi kontrol ediliyor.');
    const ebeyannameSifre = credential.secondaryPassword || credential.password;
    if (!credential.userCode || !ebeyannameSifre) {
      throw new Error('Mali musavir e-Beyanname kullanici kodu ve sifre eksik');
    }
    const loginUrl = process.env.PORTAL_AUTOMATION_EBEYANNAME_LOGIN_URL || DEFAULT_EBEYANNAME_LOGIN_URL;
    const downloadsPath = join(tmpdir(), `moren-ebeyan-new-${randomUUID()}`);
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

      const MAX_LOGIN_ATTEMPTS = Math.max(3, Math.min(8, Number(process.env.PORTAL_AUTOMATION_EBEYANNAME_LOGIN_ATTEMPTS || 5)));
      for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS; attempt++) {
        try {
          await this.jobProgress(tenantId, bundle.job, 'login', `GIB login denemesi ${attempt}/${MAX_LOGIN_ATTEMPTS}: sayfa aciliyor.`, { current: attempt, total: MAX_LOGIN_ATTEMPTS });
          await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
          await this.waitForEBeyannameLoginForm(page);
          await this.jobProgress(tenantId, bundle.job, 'login', `GIB login denemesi ${attempt}/${MAX_LOGIN_ATTEMPTS}: bilgiler ve CAPTCHA dolduruluyor.`, { current: attempt, total: MAX_LOGIN_ATTEMPTS });
          await this.fillEBeyannameLogin(page, credential.userCode, ebeyannameSifre);
          await this.fillEBeyannameCaptcha(page);
          await this.submitLogin(page);
          await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});
          await page.waitForTimeout(2000);
          await this.assertLoggedIn(page);
          await this.jobProgress(tenantId, bundle.job, 'login', 'Dijital Vergi Dairesi girisi basarili.');
          break;
        } catch (loginErr: any) {
          const msg = String(loginErr?.message || loginErr).slice(0, 200);
          await this.jobProgress(tenantId, bundle.job, 'login_retry', `Login denemesi basarisiz, tekrar denenecek: ${msg}`, { current: attempt, total: MAX_LOGIN_ATTEMPTS });
          if (attempt === MAX_LOGIN_ATTEMPTS) throw new Error('Yeni e-Beyan login ' + MAX_LOGIN_ATTEMPTS + ' denemede basarisiz. Son hata: ' + msg);
        }
      }

      await this.jobProgress(tenantId, bundle.job, 'open_app', 'Yeni e-Beyan uygulamasi aciliyor.');
      const ebeyanPage = await this.openEBeyanNewApplication(context, page);
      const taxpayers = await this.loadTaxpayers(tenantId);
      const notes: string[] = [];
      await this.jobProgress(tenantId, bundle.job, 'ebeyan_new_list', 'Beyanname listesi cekiliyor.');
      const coll = await this.collectEBeyanNewDownloads(tenantId, ebeyanPage, bundle.job, taxpayers, notes);

      await this.jobProgress(tenantId, bundle.job, 'logout', 'GIB sekmeleri kapatiliyor ve guvenli cikis yapiliyor.');
      await this.safeLogoutFromDigitalTaxOffice(context, page, ebeyanPage, notes).catch((err) => {
        notes.push(`GIB guvenli cikis tamamlanamadi: ${this.compact(err?.message || err)}`);
      });
      await context.close().catch(() => {});
      context = null;

      return {
        declarations: coll.declarations,
        documents: coll.documents,
        recordCount: coll.declarations.length + coll.documents.length,
        result: {
          runner: 'railway',
          phase: 'ebeyan_new',
          system: 'yeni-e-beyan',
          declarations: coll.declarations.length,
          documents: coll.documents.length,
          notes,
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

    // GIB e-Arsiv: TARAYICISIZ yol (TURMOB gibi). assos-login token verir; liste/indirme zaten
    //   token'li dispatch/download API'si — headless chromium sadece token'i tasimak icin aciliyordu,
    //   bosa yuktu. Kaldirildi; tum istekler Turkiye proxy'sinden (earsivFetch) cikar.
    if (jobType === 'EARSIV_PORTAL_FETCH') {
      return this.runEarsivPortalJobHttp(tenantId, bundle);
    }

    if (isSgk) {
      if (!(credential.username || credential.userCode) || !credential.workplaceCode || !credential.password || !credential.secondaryPassword) {
        throw new Error('SGK kullanici adi, e-kod, sistem sifresi ve isyeri sifresi eksik');
      }
    } else if (!credential.userCode || !(credential.secondaryPassword || credential.password)) {
      throw new Error('Vergi dairesi kullanici kodu ve sifre eksik');
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

      if (jobType === 'E_TEBLIGAT_CHECK') {
        await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await this.loginGibDigitalWithCaptcha(page, credential, loginUrl, 'e-tebligat');
      } else if (isSgk) {
        await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await this.loginSgkWithCaptcha(page, credential, loginUrl, jobType);
      } else {
        await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await this.fillGenericPortalLogin(page, this.loginValuesForJob(jobType, credential));
        await this.finishLoginAfterFill(page);
      }

      if (jobType === 'E_TEBLIGAT_CHECK' && bundle.job?.payload?.discover === true) {
        await this.jobProgress(tenantId, bundle.job, 'discover', 'e-Tebligat ekrani kesfediliyor (sadece okuma).');
        const discovery = await this.discoverETebligatScreen(page, context).catch((err: any) => ({
          error: this.compact(err?.message || err),
        }));
        await this.jobProgress(tenantId, bundle.job, 'discover_done', 'e-Tebligat ekran kesfi tamamlandi.');
        await context.close().catch(() => {});
        return {
          documents: [],
          recordCount: 0,
          result: { runner: 'railway', phase: 'etebligat_discover', jobType, url: this.safeUrl(page.url()), discovery },
        };
      }

      // GERCEK e-Tebligat: explicit "sadece dogrula" degilse HER ZAMAN gercek API taramasi.
      // (manual+force heuristigi E_TEBLIGAT'i validation-only yapmasin; tebligat cekmek isin amaci.)
      if (jobType === 'E_TEBLIGAT_CHECK' && bundle.job?.payload?.validationOnly !== true) {
        const etb = await this.collectETebligatViaApi(page, context, bundle.job, loginUrl);
        await this.jobProgress(tenantId, bundle.job, 'etebligat_done', `e-Tebligat sorgusu tamamlandi: ${etb.recordCount} kayit.`);
        await context.close().catch(() => {});
        return etb;
      }

      // SGK onaylı hizmet listesi + tahakkuk = e-Bildirge V2 (Struts saf form-POST, tıklamasız PDF).
      // (manual+force validation-only heuristigi engellemesin; amaç belge çekmek.)
      if ((jobType === 'SGK_HIZMET_LISTESI' || jobType === 'SGK_TAHAKKUK') && bundle.job?.payload?.validationOnly !== true) {
        const sgk = await this.collectSgkOnayliBildirgeler(page, bundle.job);
        await this.jobProgress(tenantId, bundle.job, 'sgk_done', `SGK onaylı belge sorgusu: ${sgk.recordCount} belge indirildi.`);
        await context.close().catch(() => {});
        return sgk;
      }

      if (this.isCredentialValidationOnlyJob(bundle.job, jobType)) {
        const providerLabel = isSgk ? 'SGK' : 'Vergi dairesi';
        const url = this.safeUrl(page.url());
        await this.jobProgress(tenantId, bundle.job, 'validated', `${providerLabel} girisi dogrulandi.`);
        await context.close().catch(() => {});
        return {
          documents: [],
          recordCount: 0,
          result: {
            runner: 'railway',
            phase: 'credential_validation',
            validationOnly: true,
            jobType,
            url,
            notes: [`${providerLabel} girisi basarili; belge taramasi yapilmadi`],
          },
        };
      }

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

  private isCredentialValidationOnlyJob(job: any, jobType: PortalJobType) {
    if (job?.payload?.validationOnly === true) return true;
    return job?.source === 'manual'
      && (jobType === 'E_TEBLIGAT_CHECK' || jobType === 'SGK_HIZMET_LISTESI')
      && job?.payload?.force === true;
  }

  private loginUrlForJob(jobType: PortalJobType) {
    if (jobType === 'E_TEBLIGAT_CHECK') {
      return process.env.PORTAL_AUTOMATION_GIB_IVD_LOGIN_URL || DEFAULT_GIB_IVD_LOGIN_URL;
    }
    if (jobType === 'EARSIV_PORTAL_FETCH') {
      return process.env.PORTAL_AUTOMATION_EARSIV_LOGIN_URL || 'https://earsivportal.efatura.gov.tr/intragiris.html';
    }
    // Onaylı hizmet listesi + tahakkuk -> e-Bildirge V2 (ayrı sistem). Diğer SGK işleri
    // (işe giriş-çıkış, işgöremezlik) İşveren Sistemi'nde kalır (Faz 2).
    if (jobType === 'SGK_HIZMET_LISTESI' || jobType === 'SGK_TAHAKKUK') {
      return process.env.PORTAL_AUTOMATION_SGK_EBILDIRGE_LOGIN_URL || DEFAULT_SGK_EBILDIRGE_LOGIN_URL;
    }
    if (jobType.startsWith('SGK_')) {
      return process.env.PORTAL_AUTOMATION_SGK_LOGIN_URL || DEFAULT_SGK_LOGIN_URL;
    }
    return process.env.PORTAL_AUTOMATION_EBEYANNAME_LOGIN_URL || DEFAULT_EBEYANNAME_LOGIN_URL;
  }

  private targetUrlForJob(jobType: PortalJobType) {
    const envKey = ({
      E_TEBLIGAT_CHECK: 'PORTAL_AUTOMATION_ETEBLIGAT_LIST_URL',
      EARSIV_PORTAL_FETCH: 'PORTAL_AUTOMATION_EARSIV_LIST_URL',
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
      credential.secondaryPassword || credential.password || '',
    ].filter(Boolean);
  }

  private async fillPortalLoginForProvider(
    page: any,
    provider: 'GIB_IVD' | 'SGK_EBILDIRGE',
    jobType: PortalJobType,
    credential: RunnerCredential,
  ) {
    if (provider === 'GIB_IVD') {
      await this.fillVisibleField(page, [
        '#userid',
        'input[name="userid"]',
        'input[placeholder*="Kullanıcı Kodu"]',
        'input[placeholder*="Kimlik"]',
      ], credential.userCode || credential.username || '', 'Vergi dairesi kullanici kodu');
      await this.fillVisibleField(page, [
        '#sifre',
        'input[name="sifre"]',
        'input[type="password"]',
        'input[placeholder*="Şifre"]',
        'input[placeholder*="sifre"]',
      ], credential.secondaryPassword || credential.password || '', 'Vergi dairesi sifresi');
      return;
    }
    await this.fillGenericPortalLogin(page, this.loginValuesForJob(jobType, credential));
  }

  private async fillVisibleField(page: any, selectors: string[], value: string, label: string) {
    if (!value) throw new Error(`${label} eksik`);
    await page.waitForSelector('input, textarea', { state: 'visible', timeout: 30_000 }).catch(() => null);
    for (const selector of selectors) {
      const loc = page.locator(selector).first();
      if (!(await loc.isVisible().catch(() => false))) continue;
      await loc.fill(value);
      return;
    }
    throw new Error(`${label} alani bulunamadi`);
  }

  private async fillGenericPortalLogin(page: any, values: string[]) {
    await page.waitForSelector('input, textarea', { state: 'visible', timeout: 30_000 }).catch(() => null);
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
      case 'EARSIV_PORTAL_FETCH':
        return ['Belge Islemleri', 'Fatura Islemleri', 'Fatura Sorgula', 'Duzenlenen Belgeler', 'e-Arsiv', 'e-Arsiv Portal'];
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

  // GECICI TANI: e-Tebligat ekraninin gercek DOM ve ic API yapisini kesfeder.
  // Tebligat ACMAZ / indirmez; sadece okur. payload.discover===true olan manuel iste calisir.
  private async discoverETebligatScreen(page: any, context: any) {
    const apiCalls: any[] = [];
    const seen = new Set<string>();
    const onResponse = async (resp: any) => {
      try {
        const url = String(resp.url() || '');
        if (/\.(png|jpe?g|gif|svg|css|woff2?|ico|map)(\?|$)/i.test(url)) return;
        if (!/dispatch|json|api|tebligat|rest|service|query|list|getir|sorgu|ajax/i.test(url)) return;
        const method = resp.request().method();
        const key = `${method} ${url.slice(0, 220)}`;
        if (seen.has(key)) return;
        seen.add(key);
        const ct = String((resp.headers() || {})['content-type'] || '');
        let body = '';
        if (/json|text|xml|html/i.test(ct)) body = (await resp.text().catch(() => '')).slice(0, 2500);
        apiCalls.push({ method, url: this.safeUrl(url), status: resp.status(), ct: ct.slice(0, 70), body });
      } catch {
        // yut
      }
    };
    context.on('response', onResponse);

    // INDIRME ADRESI KESFI: apigateway/etebligat istek(post-data) ve indirme cagrilarini yakala.
    const apiRequests: any[] = [];
    const onRequest = (req: any) => {
      try {
        const url = String(req.url() || '');
        if (!/apigateway|etebligat|goruntule|indir|belge|dosya|download|pdf/i.test(url)) return;
        let postData = '';
        try { postData = (req.postData() || '').slice(0, 1500); } catch { /* yut */ }
        apiRequests.push({ method: req.method(), url: this.safeUrl(url), postData });
      } catch { /* yut */ }
    };
    context.on('request', onRequest);

    const steps: any[] = [];
    const snap = async (label: string) => {
      const dom = await page.evaluate(() => {
        const tables = Array.from(document.querySelectorAll('table')).slice(0, 3).map((t: any) => t.outerHTML).join('\n---\n');
        const grids = Array.from(document.querySelectorAll('[class*=grid],[class*=Grid],[class*=list],[class*=List],[role=grid]'))
          .slice(0, 2).map((g: any) => (g.outerHTML || '').slice(0, 2500)).join('\n---\n');
        const navText = Array.from(document.querySelectorAll('nav,[class*=menu],[class*=Menu],[class*=nav],[class*=sidebar],ul'))
          .slice(0, 5).map((n: any) => (n.innerText || '').trim()).filter(Boolean).join(' || ').slice(0, 1800);
        return {
          title: document.title || '',
          navText,
          tables: tables.slice(0, 7000),
          grids: grids.slice(0, 5000),
          bodyText: (document.body?.innerText || '').slice(0, 1800),
        };
      }).catch(() => null);
      steps.push({ label, url: this.safeUrl(page.url()), dom });
    };

    await page.waitForTimeout(1500);
    await snap('login_sonrasi_anasayfa');

    const navigated = await this.tryNavigateByTexts(page, this.navigationTextsForJob('E_TEBLIGAT_CHECK')).catch(() => false);
    await page.waitForTimeout(2500);
    await snap(navigated ? 'etebligat_ekrani' : 'etebligat_navigasyon_basarisiz');

    // PDF indirme/goruntuleme ucnoktasini kesfet: OKUNMUS bir tebligatin islem butonuna tikla.
    // (Okunmus tebligatta yeni "okundu" damgasi olusmaz; hukuki sonuc yok.)
    // Dogru akis: Islem Yap -> Zarf Icerigi Gor (detay) -> Belge Goruntule (indirme).
    // Okunmus tebligatta yapildigi icin yeni "okundu" damgasi/hukuki sonuc olusmaz.
    const actionTrace: string[] = [];
    let downloadInfo: any = null;
    try {
      for (const lbl of ['İŞLEM YAP', 'ISLEM YAP', 'İşlem Yap', 'Islem Yap']) {
        const loc = page.getByText(lbl, { exact: false }).first();
        if (await loc.isVisible().catch(() => false)) {
          await loc.click({ timeout: 3000 }).catch(() => null);
          actionTrace.push(`tikla:${lbl}`);
          await page.waitForTimeout(1200);
          break;
        }
      }
      for (const sub of ['Zarf İçeriği Gör', 'Zarf Icerigi Gor', 'Zarf İçeriği', 'Zarf Icerigi']) {
        const s = page.getByText(sub, { exact: false }).first();
        if (await s.isVisible().catch(() => false)) {
          await s.click({ timeout: 3000 }).catch(() => null);
          actionTrace.push(`tikla:${sub}`);
          await page.waitForTimeout(2500);
          break;
        }
      }
      await snap('zarf_detay');
      for (const bg of ['BELGE GÖRÜNTÜLE', 'Belge Görüntüle', 'BELGE GORUNTULE', 'Belge Goruntule', 'Görüntüle', 'Goruntule', 'İndir', 'Indir']) {
        const b = page.getByText(bg, { exact: false }).first();
        if (await b.isVisible().catch(() => false)) {
          const [dl] = await Promise.all([
            page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
            b.click({ timeout: 3000 }).catch(() => null),
          ]);
          actionTrace.push(`tikla:${bg}`);
          if (dl) {
            const dlUrl = await Promise.resolve(dl.url?.()).catch(() => '');
            const dlName = await Promise.resolve(dl.suggestedFilename?.()).catch(() => '');
            downloadInfo = { url: this.safeUrl(String(dlUrl || '')), filename: String(dlName || '') };
          }
          await page.waitForTimeout(2500);
          break;
        }
      }
      await snap('belge_goruntule_sonrasi');
    } catch (err: any) {
      actionTrace.push(`hata:${this.compact(err?.message || err)}`);
    }

    try { context.off('response', onResponse); } catch { /* yut */ }
    try { context.off('request', onRequest); } catch { /* yut */ }
    return { navigated, actionTrace, downloadInfo, steps, apiCalls: apiCalls.slice(0, 50), apiRequests: apiRequests.slice(0, 60) };
  }

  // GERCEK e-Tebligat akisi: giris sonrasi /portal/e-tebligat'a git (SPA token'i
  // sessionStorage'a yazar), sonra HER SEY SAF API (tiklama yok):
  //  - Liste: tebligat-listele (pageSize buyuk) dogrudan fetch -> tum tebligatlar.
  //  - PDF: belge-ek-listele -> belge-getir -> report/download; gelen PKCS#7 imzali
  //    zarftan icteki gercek PDF cikarilir (downloadETebligatPdfs).
  private async collectETebligatViaApi(page: any, context: any, job: any, loginUrl: string) {
    let listele: any = null;
    let sayilari: any = null;
    const apiCalls: any[] = [];
    const apiRequests: any[] = [];
    const onResponse = async (resp: any) => {
      try {
        const url = String(resp.url() || '');
        if (!/apigateway\/etebligat|tebligat-listele|tebligat-sayilari|get-belge-tur|gercek-tuzel-aktivasyon/i.test(url)) return;
        const ct = String((resp.headers() || {})['content-type'] || '');
        const body = /json|text/i.test(ct) ? await resp.text().catch(() => '') : '';
        let parsed: any = null;
        try { parsed = body ? JSON.parse(body) : null; } catch { /* yut */ }
        if (/tebligat-listele/i.test(url) && parsed?.data) listele = parsed;
        else if (/tebligat-sayilari/i.test(url)) sayilari = parsed;
        // zarf-detay/report yanitlarini TAM yakala (PDF indirme uuid'sini bulmak icin).
        const bodyMax = /zarf-detay|report|goruntule|belge-getir|indir/i.test(url) ? 2800 : 400;
        apiCalls.push({ method: resp.request().method(), url: this.safeUrl(url), status: resp.status(), ct: ct.slice(0, 60), body: body.slice(0, bodyMax) });
      } catch { /* yut */ }
    };
    const onRequest = (req: any) => {
      try {
        const url = String(req.url() || '');
        if (!/apigateway\/etebligat|goruntule|indir|belge|dosya|download|pdf|rapor|report/i.test(url)) return;
        let postData = '';
        try { postData = (req.postData() || '').slice(0, 1500); } catch { /* yut */ }
        const h = (req.headers && req.headers()) || {};
        const auth = String(h['authorization'] || h['Authorization'] || '');
        apiRequests.push({ method: req.method(), url: this.safeUrl(url), postData, authScheme: auth ? auth.split(' ')[0] : null, authLen: auth.length });
      } catch { /* yut */ }
    };
    context.on('response', onResponse);
    context.on('request', onRequest);

    const base = String(loginUrl).replace(/\/login.*$/i, '');
    const etebligatUrl = `${base}/e-tebligat`;
    await page.goto(etebligatUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => null);
    for (let i = 0; i < 24 && !listele; i++) await page.waitForTimeout(500);
    await page.waitForTimeout(1500);

    // RECON: "Islem Yap" buton/menu yapisini gor (headless tikla calismadi).
    const domRecon = await page.evaluate(() => {
      const norm = (s: any) => String(s || '').replace(/\s+/g, ' ').trim();
      const islem = Array.from(document.querySelectorAll('button, a, [role="button"], [class*="btn"], [class*="Button"], [class*="dropdown"], [class*="menu"]'))
        .filter((el: any) => /işlem yap|islem yap/i.test(norm(el.innerText)) || /işlem|islem/i.test(norm(el.getAttribute && el.getAttribute('aria-label'))))
        .slice(0, 3)
        .map((el: any) => norm(el.outerHTML).slice(0, 700));
      const firstRow: any = document.querySelector('table tbody tr') || document.querySelector('[role="row"]') || document.querySelector('table tr');
      const rowHtml = firstRow ? norm(firstRow.outerHTML).slice(0, 1500) : null;
      const allBtns = Array.from(document.querySelectorAll('button, a[role], [role="button"]')).slice(0, 25).map((b: any) => norm(b.innerText) || norm(b.getAttribute && b.getAttribute('aria-label')) || norm(b.className).slice(0, 40)).filter(Boolean);
      return { islem, rowHtml, allBtns };
    }).catch(() => null);

    // Liste icin DOGRUDAN API (SPA render'ina / pagination'a bagimli degil): TUM tebligatlar
    // tek cagrida (pageSize buyuk). Basarisizsa SPA'nin pasif yakaladigi listeye dus.
    const directList = await page.evaluate(async () => {
      try {
        const token = sessionStorage.getItem('token');
        if (!token) return null;
        const base = location.origin + '/apigateway/etebligat';
        const headers: any = { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*', Authorization: 'Bearer ' + token };
        const body = JSON.stringify({ meta: { pagination: { pageNo: 1, pageSize: 500 }, sortFieldName: 'id', sortType: 'ASC', filters: [{ fieldName: 'arsivDurum', values: ['0'] }] } });
        const r = await fetch(base + '/etebligat/tebligat-listele', { method: 'POST', headers, body });
        if (!r.ok) return null;
        const j = await r.json();
        return (j && j.data) || null;
      } catch { return null; }
    }).catch(() => null);
    if (directList && Array.isArray(directList.tebligatDtoList)) listele = { data: directList };

    const list: any[] = Array.isArray(listele?.data?.tebligatDtoList) ? listele.data.tebligatDtoList : [];
    const taxpayerId = job?.taxpayerId || null;
    const donem = job?.donem || null;

    // PDF'leri SAF API ile (tiklama yok) cek: belge-ek-listele -> belge-getir -> report/download,
    // gelen PKCS#7 imzali zarftan icteki gercek PDF cikarilir. Anahtar: tebligId.
    const pdfMap = await this.downloadETebligatPdfs(page, list, { tenantId: job?.tenantId, taxpayerId }).catch(() => ({} as Record<string, string>));

    try { context.off('response', onResponse); } catch { /* yut */ }
    try { context.off('request', onRequest); } catch { /* yut */ }

    const documents = list.map((t: any) => {
      const belgeNo = t?.belgeNo ? String(t.belgeNo) : null;
      return {
      taxpayerId,
      belgeTuru: 'E_TEBLIGAT',
      title: String(t?.belgeTuruAciklama || t?.belgeTuru || 'e-Tebligat'),
      referenceNo: belgeNo,
      period: donem,
      issuedAt: this.etebligatDateToIso(t?.gonderimZamani),
      receivedAt: this.etebligatDateToIso(t?.tebligZamani),
      mimeType: 'application/pdf',
      originalName: belgeNo ? `${belgeNo}.pdf` : null,
      base64: (t?.tebligId && pdfMap[String(t.tebligId)]) || null,
      raw: {
        kurumKodu: t?.kurumKodu ?? null,
        kurumAciklama: t?.kurumAciklama ?? null,
        altKurum: t?.altKurum ?? null,
        belgeTuruKodu: t?.belgeTuru ?? null,
        belgeTuruAciklama: t?.belgeTuruAciklama ?? null,
        belgeNo: t?.belgeNo ?? null,
        kayitZamani: t?.kayitZamani ?? null,
        gonderimZamani: t?.gonderimZamani ?? null,
        tebligZamani: t?.tebligZamani ?? null,
        mukellefOkumaZamani: t?.mukellefOkumaZamani ?? null,
        tebligId: t?.tebligId ?? null,
        tebligSecureId: t?.tebligSecureId ?? null,
        tarafId: t?.tarafId ?? null,
        tarafSecureId: t?.tarafSecureId ?? null,
        dizin: t?.dizin ?? null,
      },
      };
    });

    const pdfSayisi = documents.filter((d: any) => d.base64).length;

    return {
      documents,
      recordCount: documents.length,
      result: {
        runner: 'railway',
        phase: 'etebligat_api',
        jobType: 'E_TEBLIGAT_CHECK',
        url: this.safeUrl(page.url()),
        count: documents.length,
        pdfCount: pdfSayisi,
        sayilari: sayilari || null,
        domRecon,
        apiRequests: apiRequests.slice(0, 24),
        apiCalls: apiCalls.slice(0, 24),
        notes: [
          `e-Tebligat API listesi: ${documents.length} kayit, ${pdfSayisi} PDF indirildi`,
          listele ? 'tebligat-listele yakalandi' : 'tebligat-listele YAKALANAMADI',
        ],
      },
    };
  }

  // Her tebligatin PDF'ini SAF API ile ceker (TIKLAMA YOK). Akis tarayicidan birebir
  // dogrulandi: belge-ek-listele -> belge-getir (reportLink) -> report/download.
  // report/download'in dondurdugu dosya PKCS#7 (CMS SignedData) IMZALI ZARFTIR;
  // icindeki gercek PDF (eContent OCTET STRING) cikarilir. Anahtar: tebligId.
  // Kimlik: SPA'nin sessionStorage.token'i (Authorization: Bearer ...).
  private async downloadETebligatPdfs(
    page: any,
    list: any[],
    opts: { tenantId?: string | null; taxpayerId?: string | null } = {},
  ): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    // ZATEN PDF'i (storageKey) olan tebligatlari ATLA -> artimli: her gece/re-query'de yalniz
    // EKSIK olanlari indir; cok tebligatli mukellef birkac turda tamamlanir, gece ucuz kalir.
    // Tur basi sinir (is timeout 45dk; 300 PDF ~5dk, rahat sigar).
    const perRunMax = Math.max(1, Math.min(1000, Number(process.env.ETEBLIGAT_PDF_MAX_PER_RUN || 300)));
    let alreadyHave = new Set<string>();
    if (opts.tenantId) {
      const refs = list.map((t) => t?.belgeNo).filter(Boolean).map((x) => String(x));
      if (refs.length) {
        const where: any = { tenantId: opts.tenantId, belgeTuru: 'E_TEBLIGAT', storageKey: { not: null }, referenceNo: { in: refs } };
        if (opts.taxpayerId) where.taxpayerId = opts.taxpayerId;
        const have = await (this.prisma as any).portalDocument.findMany({ where, select: { referenceNo: true } }).catch(() => []);
        alreadyHave = new Set((have || []).map((h: any) => String(h.referenceNo)));
      }
    }
    let done = 0;
    for (let i = 0; i < list.length && done < perRunMax; i++) {
      const t = list[i] || {};
      const tebligId = t?.tebligId ? String(t.tebligId) : '';
      const belgeNo = t?.belgeNo ? String(t.belgeNo) : '';
      if (!tebligId || !t?.tebligSecureId || !t?.tarafId || !t?.tarafSecureId) continue;
      if (belgeNo && alreadyHave.has(belgeNo)) continue; // zaten indirilmis, atla
      try {
        const b64: string | null = await page.evaluate(async (a: any) => {
          try {
            const token = sessionStorage.getItem('token');
            if (!token) return null;
            const auth: any = { Authorization: 'Bearer ' + token };
            const jh: any = Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*' }, auth);
            const base = location.origin + '/apigateway/etebligat';
            // 1) zarftaki belgenin kimligi (id/secureId/belgeTip/uzanti/ad)
            const ekR = await fetch(base + '/etebligat/belge-ek-listele', { method: 'POST', headers: jh, body: JSON.stringify({ tebligId: a.tebligId, tebligSecureId: a.tebligSecureId }) });
            if (!ekR.ok) return null;
            const ek = await ekR.json();
            const b = ek && ek.tebligBelge;
            if (!b || !b.id) return null;
            // 2) indirme linkini (uuid) uret
            const bgR = await fetch(base + '/etebligat/belge-getir', { method: 'POST', headers: jh, body: JSON.stringify({ data: { id: b.id, secureId: b.secureId, belgeTip: b.belgeTip, tarafId: a.tarafId, tarafSecureId: a.tarafSecureId, uzanti: b.uzanti || 'pdf', belgeAdi: b.adi } }) });
            if (!bgR.ok) return null;
            const bg = await bgR.json();
            const link = bg && bg.reportLink;
            if (!link || typeof link !== 'string') return null;
            // 3) imzali zarfi indir
            const dlR = await fetch(link, { method: 'GET', headers: auth });
            if (!dlR.ok) return null;
            const buf = new Uint8Array(await dlR.arrayBuffer());
            // --- PKCS#7 SignedData icinden gercek PDF'i (eContent OCTET STRING) cikar ---
            const readLen = (arr: any, p: number) => { const b0 = arr[p]; if (b0 < 0x80) return { len: b0, next: p + 1 }; const nn = b0 & 0x7f; let len = 0; for (let k = 0; k < nn; k++) len = len * 256 + arr[p + 1 + k]; return { len, next: p + 1 + nn }; };
            const idxOf = (arr: any, seq: any, from: number) => { outer: for (let i = from || 0; i <= arr.length - seq.length; i++) { for (let j = 0; j < seq.length; j++) { if (arr[i + j] !== seq[j]) continue outer; } return i; } return -1; };
            let pdf: any = null;
            const dataOID = [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01]; // pkcs7-data
            const oidAt = idxOf(buf, dataOID, 0);
            if (oidAt >= 0) {
              let p = oidAt + dataOID.length;
              if (buf[p] === 0xa0) { const l1 = readLen(buf, p + 1); p = l1.next; } // [0] EXPLICIT
              if (buf[p] === 0x04) { const l2 = readLen(buf, p + 1); pdf = buf.slice(l2.next, l2.next + l2.len); } // OCTET STRING
            }
            const isPdf = (x: any) => x && x[0] === 0x25 && x[1] === 0x50 && x[2] === 0x44 && x[3] === 0x46; // %PDF
            if (!isPdf(pdf)) {
              // imzasiz/farkli yapi: ham %PDF .. son %%EOF dilimle (geri dusus)
              let s = -1; for (let i = 0; i < buf.length - 3; i++) { if (buf[i] === 0x25 && buf[i + 1] === 0x50 && buf[i + 2] === 0x44 && buf[i + 3] === 0x46) { s = i; break; } }
              let e = -1; for (let i = buf.length - 5; i >= 0; i--) { if (buf[i] === 0x25 && buf[i + 1] === 0x25 && buf[i + 2] === 0x45 && buf[i + 3] === 0x4f && buf[i + 4] === 0x46) { e = i + 5; break; } }
              if (s >= 0 && e > s) pdf = buf.slice(s, e);
              else if (s >= 0) pdf = buf.slice(s);
              else pdf = buf;
            }
            // base64'e cevir (chunk'li, buyuk dosyada stack tasmasin)
            let bin = ''; const CH = 0x8000;
            for (let i = 0; i < pdf.length; i += CH) bin += String.fromCharCode.apply(null, pdf.subarray(i, i + CH));
            return btoa(bin);
          } catch { return null; }
        }, { tebligId, tebligSecureId: t.tebligSecureId, tarafId: t.tarafId, tarafSecureId: t.tarafSecureId });
        if (b64 && b64.length > 200) { out[tebligId] = b64; done++; }
      } catch { /* yut */ }
      await page.waitForTimeout(120);
    }
    return out;
  }

  // "20/05/2026 09:25:51" -> ISO (+03:00); zaten ISO ise oldugu gibi birakir.
  private etebligatDateToIso(v: any): string | null {
    if (v === null || v === undefined || v === '') return null;
    const s = String(v).trim();
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] || '00'}+03:00`;
    return s;
  }

  // SGK onaylı hizmet listesi + tahakkuk = e-Bildirge V2 (Struts) SAF FORM-POST (tıklamasız PDF).
  // Akış (tarayıcıdan birebir dogrulandi): login -> "Onaylanmış Belgeler" -> dönem seç
  // (DonemSecildi.action) -> liste -> her bildirge için pdfGosterim.action (tip + bildirgeRefNo +
  // dönem + struts token) -> PDF. Tip: Tahakkuk Fişi + Hizmet Listesi. Artımlı: zaten kayıtlı
  // (storageKey'li) belge no'ları atla (gece ucuz kalsın).
  private async collectSgkOnayliBildirgeler(page: any, job: any) {
    const taxpayerId = job?.taxpayerId || null;
    const tenantId = job?.tenantId || null;
    const base = (process.env.PORTAL_AUTOMATION_SGK_EBILDIRGE_LOGIN_URL || DEFAULT_SGK_EBILDIRGE_LOGIN_URL).replace(/\/+$/, '');
    const notes: string[] = [];

    // 1) "Onaylanmış Belgeler" menüsüne git
    let reached = false;
    for (const t of ['Onaylanmış Belgeler', 'Onaylanmis Belgeler', 'Onaylı Belgeler', 'Onayli Belgeler', 'Onaylı Bildirge']) {
      const link = page.getByText(t, { exact: false }).first();
      if (await link.isVisible().catch(() => false)) {
        await Promise.all([
          page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {}),
          link.click({ timeout: 6_000 }).catch(() => null),
        ]);
        reached = true;
        break;
      }
    }
    await page.waitForTimeout(1500);

    // 2) Dönem dropdown'ı (hizmet_yil_ay_index) seçeneklerini oku
    const periods: Array<{ v: string; t: string }> = await page.evaluate(() => {
      const sel: any = document.querySelector('[name="hizmet_yil_ay_index"]');
      if (!sel) return [];
      return Array.from(sel.options)
        .map((o: any) => ({ v: String(o.value), t: String(o.text || '').trim() }))
        .filter((o: any) => o.v && o.v !== '-1' && o.v !== '');
    }).catch(() => []);

    if (!periods.length) {
      notes.push(`SGK dönem listesi bulunamadı (Onaylanmış Belgeler ekranına ulaşılamadı, reached=${reached}).`);
      return { documents: [], recordCount: 0, result: { runner: 'railway', phase: 'sgk_ebildirge', jobType: 'SGK', reached, notes } };
    }

    // Artımlı: zaten kayıtlı belgeleri (refNo bazında) atla (gece ucuz kalsın).
    let alreadyHave = new Set<string>();
    if (tenantId) {
      const where: any = { tenantId, belgeTuru: { in: ['SGK_TAHAKKUK', 'SGK_HIZMET_LISTESI'] }, storageKey: { not: null } };
      if (taxpayerId) where.taxpayerId = taxpayerId;
      const have = await (this.prisma as any).portalDocument.findMany({ where, select: { referenceNo: true, belgeTuru: true, raw: true } }).catch(() => []);
      // metaVersion>=5 ile işlenmiş kayıtları atla.
      // v1-v4 (yanlış tutar: net prim/toplam prim alıyordu) yeniden çekilip düzeltilir.
      alreadyHave = new Set((have || [])
        .filter((h: any) => { const r: any = h.raw || {}; return (r.metaVersion ?? 0) >= 6; })
        .map((h: any) => `${h.belgeTuru}|${h.referenceNo}`));
    }

    const TIPS = [
      { tip: 'tahakkukonayliFisTahakkukPdf', belgeTuru: 'SGK_TAHAKKUK', title: 'SGK Tahakkuk Fişi' },
      { tip: 'tahakkukonayliFisHizmetPdf', belgeTuru: 'SGK_HIZMET_LISTESI', title: 'SGK Hizmet Listesi' },
    ];
    const documents: any[] = [];
    let formsFound = 0;

    // Dönem text'ini value'dan çözmek için harita (satırın hizmet_yil_ay_index'i -> "Ay Yıl").
    const periodTextByValue: Record<string, string> = {};
    for (const p of periods) periodTextByValue[String(p.v)] = p.t;

    // TEK RANGE (kullanıcı talimatı 2026-06-15): her ayı ayrı sorgulamak yerine
    // başlangıç = en eski dönem, bitiş = en yeni dönem seçip TEK submit ile tüm dönemleri
    // çok satırlı getir; satırları sırayla indir (alreadyHave inmiş olanı atlar).
    // Dönem index value'su: küçük = en yeni, büyük = en eski (memory: 1=en yeni, artan=eskiye).
    const maxPeriods = Math.max(1, Math.min(36, Number(process.env.SGK_PERIOD_MAX || 24)));
    // Struts dönem aralığını ARTAN index ister: başlangıç (hizmet_yil_ay_index) <= bitiş (_bitis).
    // Index: en küçük (1) = en yeni, büyüdükçe eskiye gider. En yeniden maxPeriods kadar eskiye aralık.
    const numericVals = periods.map((p) => Number(p.v)).filter((n) => Number.isFinite(n));
    let startVal: string; let endVal: string;
    if (numericVals.length === periods.length && numericVals.length) {
      const sorted = [...numericVals].sort((a, b) => a - b); // 1,2,3... (yeni -> eski)
      startVal = String(sorted[0]);                                      // başlangıç = en küçük index (en yeni)
      endVal = String(sorted[Math.min(sorted.length, maxPeriods) - 1]);  // bitiş = en büyük index (en eski, maxPeriods içinde)
    } else {
      // value sayısal değilse dropdown sırasına güven: [0] = en yeni, son = en eski.
      startVal = String(periods[0].v);
      endVal = String(periods[Math.min(periods.length, maxPeriods) - 1].v);
    }

    // Manuel dönem sorgusu: payload.targetPeriod ('YYYY/MM' veya 'YYYY-MM') varsa sadece o dönem.
    const targetPeriod = job?.payload?.targetPeriod as string | undefined;
    if (targetPeriod) {
      const pm = String(targetPeriod).match(/(\d{4})[\/-](\d{1,2})/);
      if (pm) {
        const TR_MONTHS = ['', 'OCAK', 'SUBAT', 'MART', 'NISAN', 'MAYIS', 'HAZIRAN', 'TEMMUZ', 'AGUSTOS', 'EYLUL', 'EKIM', 'KASIM', 'ARALIK'];
        const yr = pm[1]; const mn = TR_MONTHS[Number(pm[2])] || '';
        const matched = mn ? periods.find((p) => { const n = this.normalizeTextKey(p.t); return n.includes(yr) && n.includes(mn); }) : null;
        if (matched) {
          startVal = matched.v; endVal = matched.v;
          notes.push(`Manuel dönem sorgusu: ${matched.t} (index ${matched.v})`);
        } else {
          notes.push(`Hedef dönem '${targetPeriod}' dropdown'da bulunamadı; tüm aralık sorgulanacak.`);
        }
      }
    }

    try {
      // Dönem aralığını "Bilgileri Getir" butonuyla DEĞİL, doğrudan SAF FETCH ile gönder.
      // (Dönem-seç submit butonunun adı BOŞ -> btn.click() Struts'a işlem parametresi
      //  taşımıyor, sayfa dönem-seç ekranında kalıyordu. e-Tebligat'taki gibi action'a
      //  direkt POST + dönen liste HTML'ini parse et; sonra her bildirge için pdfGosterim.)
      const out: any = await page.evaluate(async (cfg: any) => {
        const norm = (s: any) => String(s || '').replace(/\s+/g, ' ').trim();
        // Dönem-seç sayfasındaki taze struts token
        const tokEl: any = document.querySelector('form[action*="DonemSecildi"] [name="token"]') || document.querySelector('[name="token"]');
        const token0 = tokEl ? String(tokEl.value) : '';
        // 1) Dönem aralığını POST et -> "Onaylı Bildirge Listesi" HTML
        let listHtml = '';
        try {
          const body = new URLSearchParams();
          body.append('struts.token.name', 'token'); body.append('token', token0);
          body.append('hizmet_yil_ay_index', cfg.start);
          body.append('hizmet_yil_ay_index_bitis', cfg.end);
          const r = await fetch(cfg.base + '/tahakkuk/tahakkukonaylanmisTahakkukDonemSecildi.action', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
          listHtml = await r.text();
        } catch (e) { return { rows: [], listLen: 0, formCount: 0, err: 'donemsec:' + String(e) }; }
        // 2) Liste parse. SGK listesi = TEK pdfGosterim formu; her satırdaki link JS ile
        //    #bildirgeRefNoId / #tipId / #downloadId doldurup formu submit ediyor. Gerçek refNo'lar
        //    satır JS çağrılarında (input değil) -> regex ile çıkar (format: 80957-2026-4).
        //    token + dönem index'leri pdfGosterim formunun hidden alanlarından.
        const doc = new DOMParser().parseFromString(listHtml, 'text/html');
        const pdfForm: any = doc.querySelector('form[action*="pdfGosterim"]');
        const ff = (n: string) => { const e = pdfForm ? pdfForm.querySelector('[name="' + n + '"]') : null; return e ? String((e as any).value) : null; };
        const token = ff('token') || token0;
        const yilAy = ff('hizmet_yil_ay_index') || cfg.start;
        const yilAyBitis = ff('hizmet_yil_ay_index_bitis') || cfg.end;
        const refSet = new Set<string>();
        const rx = /\d{3,}-20\d{2}-\d{1,2}/g; let rmm: any;
        while ((rmm = rx.exec(listHtml))) refSet.add(rmm[0]);
        const refList = Array.from(refSet);
        const rows: any[] = [];
        for (const refNo of refList) {
          // 3) Her tip (tahakkuk + hizmet) için PDF'i SAF FETCH ile indir
          const pdfs: any = {};
          for (const tip of cfg.tips) {
            const p = new URLSearchParams();
            p.append('struts.token.name', 'token'); p.append('token', token);
            p.append('tip', tip); p.append('download', 'true');
            p.append('hizmet_yil_ay_index', yilAy || ''); p.append('hizmet_yil_ay_index_bitis', yilAyBitis || '');
            p.append('bildirgeRefNo', refNo);
            try {
              const rr = await fetch(cfg.base + '/tahakkuk/pdfGosterim.action', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p.toString() });
              if (!rr.ok) continue;
              const buf = new Uint8Array(await rr.arrayBuffer());
              if (!(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) || buf.length < 200) continue;
              let bin = ''; const CH = 0x8000;
              for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH) as any);
              pdfs[tip] = btoa(bin);
            } catch { /* yut */ }
          }
          const pm = refNo.match(/-(\d{4})-(\d{1,2})$/);
          const period = pm ? (pm[1] + '/' + String(pm[2]).padStart(2, '0')) : '';
          rows.push({ refNo, period, cells: [], rowText: refNo, pdfs });
        }
        return { rows, listLen: listHtml.length, refNoCount: refList.length };
      }, { base, start: startVal, end: endVal, tips: TIPS.map((t) => t.tip) }).catch((e: any) => ({ rows: [], listLen: 0, formCount: 0, err: String(e) }));

      const rows: any[] = (out && out.rows) || [];
      formsFound = rows.length;
      if (formsFound === 0) {
        notes.push(`Bu dönem aralığında onaylı bildirge bulunamadı (range ${startVal}→${endVal}).${out?.err ? ' Hata: ' + this.compact(out.err) : ''}`);
      }
      for (const row of rows) {
        const periodText = row.period || '';
        // Bu bildirgenin meta'sını PDF'lerden çıkar (mahiyet/kanun/çalışan/tutar) — bir kez,
        // hem tahakkuk hem hizmet belgesine aynısı yazılır.
        const tahB64 = row.pdfs?.['tahakkukonayliFisTahakkukPdf'];
        const hizB64 = row.pdfs?.['tahakkukonayliFisHizmetPdf'];
        const meta = (tahB64 || hizB64)
          ? await this.extractSgkMetaFromPdfs(tahB64, hizB64)
          : { belgeMahiyeti: '', kanunNo: '', calisan: '', tutar: '' };
        for (const t of TIPS) {
          const key = `${t.belgeTuru}|${row.refNo}`;
          if (alreadyHave.has(key)) continue;
          const b64 = row.pdfs?.[t.tip];
          if (!b64 || b64.length < 200) continue;
          documents.push({
            taxpayerId,
            belgeTuru: t.belgeTuru,
            title: t.title,
            referenceNo: String(row.refNo),
            period: periodText,
            mimeType: 'application/pdf',
            originalName: `${t.belgeTuru}_${row.refNo}.pdf`,
            base64: b64,
            raw: { donem: periodText, bildirgeRefNo: row.refNo, belgeMahiyeti: meta.belgeMahiyeti, kanunNo: meta.kanunNo, calisan: meta.calisan, tutar: meta.tutar, metaVersion: 6 },
          });
          alreadyHave.add(key);
        }
      }
    } catch (e: any) {
      notes.push(`SGK range çekimi hata: ${this.compact(e?.message || e)}`);
    }

    notes.push(`${periods.length} dönem (${startVal}→${endVal}) tarandı, ${formsFound} bildirge, ${documents.length} yeni belge indirildi.`);
    return {
      documents,
      recordCount: documents.length,
      result: { runner: 'railway', phase: 'sgk_ebildirge', jobType: 'SGK', periodCount: periods.length, rangeStart: startVal, rangeEnd: endVal, formsFound, newDocs: documents.length, notes },
    };
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

  private async collectEarsivPortalViaApi(token: string, job: any, tenantId: string) {
    if (!token) throw new Error('GIB e-Arsiv token alinamadi');

    const startDate = this.earsivDateInput(job.periodStart);
    const endDate = this.earsivDateInput(job.periodEnd);
    if (!startDate || !endDate) throw new Error('GIB e-Arsiv tarih araligi hazirlanamadi');

    const list = await this.earsivDispatch(token, 'EARSIV_PORTAL_TASLAKLARI_GETIR', 'RG_TASLAKLAR', {
      baslangic: startDate,
      bitis: endDate,
      hangiTip: '5000/30000',
      // onayDurumu (kullanıcı bulgusu — "hepsinde boş"): portalın kendi grid'i bu alanı gönderiyor;
      //   eksikken GİB listeyi daraltıp onaylı/imzalı faturaları elemiş olabilir → "Hepsi" ile tümü gelir.
      onayDurumu: 'Hepsi',
    });
    const rows = Array.isArray(list?.data) ? list.data : [];
    // TEŞHİS (kullanıcı bulgusu — "boş = arıza mı, 0 kayıt mı belli değil"): GİB 200 + boş data dönünce
    //   eskiden hiçbir iz kalmıyordu. Ham yanıtın özetini (satır sayısı + GİB mesajı + data tipi) log'a
    //   ve notes'a yaz → neden boş olduğu ekrandan görünür.
    const gibMsg = Array.isArray((list as any)?.messages)
      ? (list as any).messages.map((m: any) => String(m?.text || '').trim()).filter(Boolean).join(' | ')
      : '';
    const dataTip = Array.isArray(list?.data) ? `dizi(${(list as any).data.length})` : ((list as any)?.data == null ? 'null' : typeof (list as any).data);
    this.logger.log(`[EARSIV-SORGU] GIB yanit: rows=${rows.length} data=${dataTip} error=${JSON.stringify((list as any)?.error ?? null)} mesaj="${gibMsg}" (${startDate}-${endDate})`);
    // SINIR (kullanıcı bulgusu — "bazı faturalar gelmiyor"): varsayılan 80'den GİB'in tek seferde
    //   döndürdüğü listeyi büyük ölçüde karşılayan 200'e çıkarıldı (kod zaten üst tavan olarak 200'ü
    //   uyguluyordu — env ile bile aşılamıyordu). Sınır yine de aşılırsa (200'den fazla satır) artık
    //   notes'a GÖRÜNÜR bir uyarı düşülüyor — eskiden kalan satırlar hiçbir iz bırakmadan atlanıyordu.
    const max = Math.max(1, Math.min(200, Number(process.env.PORTAL_AUTOMATION_EARSIV_MAX_DOWNLOADS || 200)));
    const documents: any[] = [];
    const mode = job?.payload?.earsivMode === 'query' ? 'query' : 'download';
    const selectedRefs = new Set((Array.isArray(job?.payload?.selectedRefs) ? job.payload.selectedRefs : [])
      .map((v: any) => String(v || '').trim())
      .filter(Boolean));
    const notes: string[] = [`GIB e-Arsiv liste: ${rows.length} satir (${startDate}-${endDate})${gibMsg ? ` — GIB mesaji: ${gibMsg}` : ''}`];
    if (rows.length === 0) {
      notes.push(`GIB bu donem icin 0 e-Arsiv faturasi dondu. Mukellef bu donemde GIB portali uzerinden e-Arsiv kesmediyse (entegrator/e-Fatura ise) bu normaldir; kesmisse tarih araligini/onay durumunu kontrol edin.${gibMsg ? ` GIB mesaji: ${gibMsg}` : ''}`);
    }
    if (rows.length > max) {
      notes.push(`⚠ GIB listesi ${rows.length} satir dondu, sistem siniri ${max} oldugu icin sadece ilk ${max} belge islendi. Kalan ${rows.length - max} belge icin tarih araligini daraltip tekrar sorgulayin.`);
    }

    // KISMİ SONUÇ KORUMASI (kullanıcı bulgusu — "sonradan bir şeyler oluyor, belge getirmiyor"):
    //   eskiden döngü ortasında beklenmeyen bir hata (örn. token süresi dolması) olursa o ana kadar
    //   toplanan TÜM belgeler kaybolurdu (fonksiyon hiç return etmeden throw ediyordu). Artık döngü
    //   try/catch ile sarılı — hata olursa o ana kadar toplanan documents, hata objesine eklenip
    //   (err.partialDocuments) çağıran tarafa (runOne) taşınır, oradan kaydedilir.
    try {
      for (let i = 0; i < rows.length && documents.length < max; i++) {
        // KALP ATIŞI (denetim bulgusu): uzun indirme döngüsünde job'ın updatedAt'i hiç tazelenmiyordu;
        //   45dk'lık stale-watchdog (failStaleRunnerJobs) işi 'failed' yapıp kısmi kayıt korumasını
        //   boşa çıkarıyordu. Her 10 satırda bir ilerleme yazılır → updatedAt tazelenir.
        //   jobProgress hataları içeride yutar, döngüyü durdurmaz.
        if (i > 0 && i % 10 === 0) {
          await this.jobProgress(tenantId, job, 'earsiv_progress', `GIB e-Arsiv: ${i}/${rows.length} satir islendi, ${documents.length} belge toplandi.`);
        }
        const row = rows[i] || {};
        const uuid = this.earsivRead(row, ['ettn', 'uuid', 'faturaUuid', 'belgeUuid']);
        const invoiceNo = this.earsivRead(row, ['belgeNumarasi', 'faturaNo', 'faturaNumarasi', 'belgeNo']);
        const signed = this.earsivRead(row, ['onayDurumu', 'durum']) || 'Onaylandı';
        const referenceNo = invoiceNo || uuid || null;
        if (selectedRefs.size && !selectedRefs.has(String(referenceNo || '')) && !selectedRefs.has(String(uuid || ''))) {
          continue;
        }
        if (!uuid) {
          notes.push(`${i + 1}. satir atlandi: ETTN yok (${this.compact(JSON.stringify(row)).slice(0, 180)})`);
          continue;
        }
        const blocked = /iptal|itiraz|red|reddedil|cancel/i.test(JSON.stringify({
          onayDurumu: signed,
          iptalItirazDurumu: this.earsivRead(row, ['iptalItirazDurumu', 'iptalDurumu', 'itirazDurumu']),
        }));
        if (blocked && mode !== 'query') {
          notes.push(`${referenceNo || uuid}: iptal/itiraz/reddedilmis oldugu icin aktarilmadi`);
          continue;
        }

        if (mode === 'query') {
          // TUTAR + GÖRSEL (kullanıcı bulgusu — "tutar okunamadı", tutar sütunları boş): downloadEarsivBelge
          //   PDF döndürüyor, PDF'ten tutar güvenilir parse EDİLEMİYOR (matrah/kdv/toplam boş → aktarımda
          //   'tutar okunamadı'). fetchEarsivHtml ise HTML döndürür — tutar (matrah/KDV/toplam) yapısal olarak
          //   içinde (parseEarsivPortalHtmlTotals okur) ve görsel HTML olarak render edilir. Query (önizleme)
          //   modunda HTML'i ÖNCE dene; PDF yalnız HTML alınamazsa yedek.
          const payload = await this.fetchEarsivHtml(token, uuid, signed, referenceNo || `earsiv-${i + 1}`)
            .catch(() => this.downloadEarsivBelge(token, uuid, signed, referenceNo || `earsiv-${i + 1}`))
            .catch((err: any) => {
              notes.push(`${referenceNo || uuid}: on indirme yapilamadi, yalniz satir listelendi (${this.compact(err?.message || err)})`);
              return null;
            });
          documents.push({
            taxpayerId: job.taxpayerId || null,
            belgeTuru: 'EARSIV_FATURA',
            title: `GIB e-Arsiv Fatura ${referenceNo || uuid}`,
            referenceNo: referenceNo || uuid,
            period: (/^\d{4}-\d{2}$/.test(String(job.donem || '')) ? job.donem : null) || this.inferDonem(job.periodEnd),
            issuedAt: this.earsivIssuedAt(row) || job.periodEnd || null,
            receivedAt: new Date().toISOString(),
            mimeType: payload?.mimeType || 'application/json',
            originalName: payload?.fileName || `${referenceNo || uuid}.json`,
            base64: payload?.base64,
            raw: {
              runner: 'railway',
              jobType: 'EARSIV_PORTAL_FETCH',
              source: 'gib-earsiv-api',
              mode,
              prefetched: !!payload,
              ettn: uuid,
              belgeNumarasi: invoiceNo || null,
              onayDurumu: signed,
              row,
            },
          });
          continue;
        }

        let payload = await this.downloadEarsivBelge(token, uuid, signed, referenceNo || `earsiv-${i + 1}`).catch((err: any) => {
          notes.push(`${referenceNo || uuid}: indirme basarisiz, HTML deneniyor (${this.compact(err?.message || err)})`);
          return null;
        });
        if (!payload) {
          payload = await this.fetchEarsivHtml(token, uuid, signed, referenceNo || `earsiv-${i + 1}`).catch((err: any) => {
            notes.push(`${referenceNo || uuid}: HTML alinamadi (${this.compact(err?.message || err)})`);
            return null;
          });
        }
        // SESSİZ KAYIP FIX (kullanıcı bulgusu): eskiden indirme+HTML ikisi de basarisiz olunca
        //   "continue" ile bu belge TAMAMEN atlanıyordu — hic bir yere kaydedilmiyordu, kullanıcı
        //   sadece "X kayit yazildi" sayisindan eksik oldugunu anlayabilirdi, HANGI belgenin
        //   eksik oldugunu goremezdi. Artik 'query' modundaki gibi REFERANS KAYDI (belgesiz)
        //   yine de eklenir — kullanici en azindan "bu fatura var ama inmedi" gorur, tekrar
        //   sorgulayip indirebilir.
        if (!payload) {
          notes.push(`${referenceNo || uuid}: indirme/HTML basarisiz, sadece referans kaydedildi (kullanici tekrar deneyebilir)`);
        }

        documents.push({
          taxpayerId: job.taxpayerId || null,
          belgeTuru: 'EARSIV_FATURA',
          title: `GIB e-Arsiv Fatura ${referenceNo || uuid}`,
          referenceNo: referenceNo || uuid,
          period: (/^\d{4}-\d{2}$/.test(String(job.donem || '')) ? job.donem : null) || this.inferDonem(job.periodEnd),
          issuedAt: this.earsivIssuedAt(row) || job.periodEnd || null,
          receivedAt: new Date().toISOString(),
          mimeType: payload?.mimeType || 'application/json',
          originalName: payload?.fileName || `${referenceNo || uuid}.json`,
          base64: payload?.base64,
          raw: {
            runner: 'railway',
            jobType: 'EARSIV_PORTAL_FETCH',
            source: 'gib-earsiv-api',
            mode,
            prefetched: !!payload,
            ettn: uuid,
            belgeNumarasi: invoiceNo || null,
            onayDurumu: signed,
            row,
          },
        });
      }
    } catch (err: any) {
      const wrapped = new Error(`GIB e-Arsiv sorgusu yarida kesildi (${documents.length} belge bu ana kadar toplandi): ${err?.message || err}`);
      (wrapped as any).partialDocuments = documents;
      throw wrapped;
    }

    notes.push(mode === 'query' ? `${documents.length} e-Arsiv satiri listelendi` : `${documents.length} e-Arsiv belge indirildi`);
    return {
      documents,
      recordCount: documents.length,
      result: {
        runner: 'railway',
        phase: 'earsiv_api',
        mode,
        jobType: 'EARSIV_PORTAL_FETCH',
        dateFrom: startDate,
        dateTo: endDate,
        rows: rows.length,
        documents: documents.length,
        notes,
      },
    };
  }

  // GIB e-Arsiv istekleri: (1) EARSIV_RELAY_URL+SECRET set ise VPS relay'i uzerinden (Turkiye cikis;
  //   Railway'in dogrudan/proxy-tunel GIB erisimi engelli/takiliyor — canli kanit 2026-07-29), (2) yoksa
  //   TURMOB_PROXY_URL proxy'si, (3) o da yoksa dogrudan. Relay env yoksa davranis DEGISMEZ.
  private earsivFetch(url: string, init: any = {}): Promise<Response> {
    const relayUrl = String(process.env.EARSIV_RELAY_URL || '').trim();
    const relaySecret = String(process.env.EARSIV_RELAY_SECRET || '').trim();
    if (relayUrl && relaySecret) {
      return this.earsivViaRelay(relayUrl, relaySecret, url, init);
    }
    if (this._earsivDispatcher === undefined) {
      const purl = String(process.env.TURMOB_PROXY_URL || process.env.PORTAL_TR_PROXY_URL || '').trim();
      if (purl) {
        try {
          this._earsivDispatcher = new (require('undici').ProxyAgent)(purl);
          this.logger.log('GIB e-Arsiv proxy aktif (Turkiye cikis)');
        } catch (e: any) {
          this.logger.warn(`GIB e-Arsiv proxy kurulamadi: ${e?.message}`);
          this._earsivDispatcher = null;
        }
      } else {
        this._earsivDispatcher = null;
      }
    }
    return fetch(url, this._earsivDispatcher ? { ...init, dispatcher: this._earsivDispatcher } : init) as any;
  }

  // GIB istegini VPS relay'ine (POST /fwd) yollar, relay VPS'ten GIB'e forward eder, yaniti geri kurar.
  //   Relay self-signed TLS -> undici Agent(rejectUnauthorized:false) YALNIZ relay host'una. Relay tarafinda
  //   sadece earsivportal'a izinli (allowlist) + x-relay-secret. Yanit gercek Response'a cevrilir.
  private async earsivViaRelay(relayUrl: string, secret: string, url: string, init: any): Promise<Response> {
    if (this._earsivRelayDispatcher === undefined) {
      try {
        this._earsivRelayDispatcher = new (require('undici').Agent)({ connect: { rejectUnauthorized: false } });
        this.logger.log('GIB e-Arsiv relay aktif (VPS Turkiye cikis)');
      } catch (e: any) {
        this.logger.warn(`GIB e-Arsiv relay dispatcher kurulamadi: ${e?.message}`);
        this._earsivRelayDispatcher = null;
      }
    }
    const bodyStr = init?.body == null ? null : (typeof init.body === 'string' ? init.body : String(init.body));
    const bodyB64 = bodyStr != null ? Buffer.from(bodyStr, 'utf8').toString('base64') : null;
    const relayRes = await fetch(relayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-relay-secret': secret },
      body: JSON.stringify({ method: init?.method || 'GET', url, headers: init?.headers || {}, bodyB64 }),
      ...(this._earsivRelayDispatcher ? { dispatcher: this._earsivRelayDispatcher } : {}),
      signal: init?.signal || AbortSignal.timeout(35_000),
    } as any);
    if (!relayRes.ok) throw new Error(`GIB e-Arsiv relay hata: HTTP ${relayRes.status}`);
    const j: any = await relayRes.json();
    const buf = j?.bodyB64 ? Buffer.from(String(j.bodyB64), 'base64') : Buffer.alloc(0);
    const headers = new Headers();
    for (const [k, v] of Object.entries(j?.headers || {})) {
      if (/^(content-encoding|content-length|transfer-encoding|connection)$/i.test(k)) continue;
      try { headers.set(k, String(v)); } catch { /* gecersiz header atla */ }
    }
    return new Response(buf, { status: Number(j?.status) || 502, headers }) as any;
  }

  private async earsivDispatch(token: string, cmd: string, pageName: string, payload: Record<string, any> = {}) {
    const body = new URLSearchParams();
    body.set('callid', randomUUID());
    body.set('token', token);
    body.set('cmd', cmd);
    body.set('pageName', pageName);
    body.set('jp', JSON.stringify(payload && Object.keys(payload).length ? payload : {}));
    // TIMEOUT (kullanıcı bulgusu — "takılıyor"): native fetch'in varsayılan zaman aşımı yok; GİB
    //   sunucusu bağlantıyı açık tutup yanıt vermezse bu istek eskiden süresiz asılı kalabiliyordu
    //   (en kötü ihtimalle 45dk'lık genel stale-job temizliğine kadar). 30sn sonra AbortError fırlatır,
    //   çağıran yerler bunu zaten try/catch ile yakalıyor.
    const response = await this.earsivFetch('https://earsivportal.efatura.gov.tr/earsiv-services/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`GIB e-Arsiv dispatch JSON donmedi: HTTP ${response.status} ${this.compact(text).slice(0, 180)}`);
    }
    if (!response.ok || parsed?.error || parsed?.data?.hata) {
      const msg = parsed?.messages?.[0]?.text || parsed?.data?.hata || parsed?.message || text;
      throw new Error(`GIB e-Arsiv dispatch hata (${cmd}): ${this.compact(String(msg)).slice(0, 300)}`);
    }
    return parsed;
  }

  private async downloadEarsivBelge(token: string, uuid: string, signed: string, fallbackName: string) {
    const url = `https://earsivportal.efatura.gov.tr/earsiv-services/download?${new URLSearchParams({
      token,
      ettn: uuid,
      onayDurumu: signed,
      belgeTip: 'FATURA',
      cmd: 'EARSIV_PORTAL_BELGE_INDIR',
    }).toString()}`;
    const response = await this.earsivFetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(30_000),
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    const headers = {
      'content-type': response.headers.get('content-type') || '',
      'content-disposition': response.headers.get('content-disposition') || '',
    };
    const preview = buffer.subarray(0, Math.min(buffer.length, 250)).toString('utf8');
    if (!response.ok || buffer.length < 100 || /Oturum ge[cç]ersiz|token yok|hata/i.test(preview)) {
      throw new Error(`download HTTP ${response.status} bytes=${buffer.length} ${this.compact(preview).slice(0, 160)}`);
    }
    const fileName = this.safeFileName(this.fileNameFromResponse(url, headers, fallbackName));
    const mimeType = headers['content-type'] || this.mimeFromName(fileName);
    return { base64: buffer.toString('base64'), fileName, mimeType };
  }

  private async fetchEarsivHtml(token: string, uuid: string, signed: string, fallbackName: string) {
    const html = await this.earsivDispatch(token, 'EARSIV_PORTAL_FATURA_GOSTER', 'RG_TASLAKLAR', {
      ettn: uuid,
      onayDurumu: signed,
    });
    // HTML DOGRULAMA (denetim bulgusu): data string degilse eskiden JSON.stringify edilip ".html" /
    //   text-html diye saklaniyordu — bozuk yedek. Icerik string degilse ya da hic '<' icermiyorsa
    //   (HTML degilse) yedek OLUSTURMA; throw ile belgesiz referans kaydi yoluna dusulur.
    const content = typeof html?.data === 'string' ? html.data : '';
    if (!content || content.length < 100 || !/</.test(content)) throw new Error('HTML icerigi bos ya da HTML degil');
    const fileName = this.safeFileName(`${fallbackName || uuid}.html`);
    return {
      base64: Buffer.from(content, 'utf8').toString('base64'),
      fileName,
      mimeType: 'text/html; charset=utf-8',
    };
  }

  private earsivDateInput(value?: string | Date | null) {
    return this.formatDateInput(value)?.replace(/\./g, '/') || null;
  }

  private earsivRead(row: any, keys: string[]) {
    for (const key of keys) {
      const value = row?.[key];
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
    return '';
  }

  private earsivIssuedAt(row: any) {
    return this.earsivRead(row, ['belgeTarihi', 'faturaTarihi', 'tarih', 'duzenlemeTarihi']);
  }

  private downloadRegexForJob(jobType: PortalJobType) {
    if (jobType === 'E_TEBLIGAT_CHECK') return /indir|pdf|tebligat|g[oö]r[uü]nt[uü]le|download/i;
    if (jobType === 'EARSIV_PORTAL_FETCH') return /indir|xml|pdf|zip|html|fatura|belge|download/i;
    if (jobType === 'SGK_TAHAKKUK') return /indir|pdf|tahakkuk|makbuz|download/i;
    if (jobType === 'SGK_HIZMET_LISTESI') return /indir|pdf|hizmet|liste|ayl[iı]k prim|download/i;
    if (jobType === 'SGK_ISE_GIRIS_CIKIS') return /indir|pdf|giri[sş]|[cç][iı]k[iı][sş]|bildirge|download/i;
    if (jobType === 'SGK_ISGOREMEZLIK') return /indir|pdf|rapor|i[sş]g[oö]remezlik|download/i;
    return /indir|pdf|xml|download/i;
  }

  private documentTypeForJob(jobType: PortalJobType) {
    switch (jobType) {
      case 'E_TEBLIGAT_CHECK': return 'E_TEBLIGAT';
      case 'EARSIV_PORTAL_FETCH': return 'EARSIV_FATURA';
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
      case 'EARSIV_PORTAL_FETCH': return 'GIB e-Arsiv Fatura';
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

  private gibValidationLoginAttempts() {
    const value = Number(process.env.PORTAL_AUTOMATION_GIB_VALIDATION_LOGIN_ATTEMPTS || 3);
    return Math.max(1, Math.min(5, Number.isFinite(value) ? value : 3));
  }

  // ══════════════════════════════════════════════════════════════════════
  // GALERI HGS — Dijital Vergi Dairesi araç plakaları + KGM ihlal sorgusu
  // ══════════════════════════════════════════════════════════════════════

  /**
   * GALERI_HGS isini calistirir.
   *  - mode='kgm_test' : GIB girisi YOK; sadece tek plaka KGM'den sorgulanir (sunucu IP testi).
   *  - mode='full'     : GIB_IVD ile gir -> arac-bilgilerim plakalarini oku -> Arac upsert ->
   *                      her plaka icin KGM sorgu -> liste bitince HATALI kalanlari tekrar sorgula ->
   *                      sonuclari kaydet -> WhatsApp borc ozeti gonder.
   */
  private async runGaleriHgs(job: any): Promise<{ recordCount: number; result: any }> {
    const tenantId = job.tenantId;
    const mode = String(job?.payload?.mode || 'full');
    const phones: string[] = Array.isArray(job?.payload?.whatsappPhones) && job.payload.whatsappPhones.length
      ? job.payload.whatsappPhones
      : GALERI_HGS_WHATSAPP_PHONES;

    // ── RESEND: KGM/GIB'e GIRMEDEN, kayitli son sonuclardan ozeti kur + WhatsApp gonder (hizli) ──
    if (mode === 'resend') {
      const taxpayer = await (this.prisma as any).taxpayer.findFirst({
        where: { id: job.taxpayerId, tenantId },
        select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true },
      });
      const araclar = await (this.prisma as any).arac.findMany({
        where: { tenantId, taxpayerId: job.taxpayerId },
        select: { id: true, plaka: true },
      });
      const sonuclar = new Map<string, any>();
      for (const a of araclar) {
        const son = await (this.prisma as any).hgsIhlalSorguSonucu.findFirst({
          where: { aracId: a.id }, orderBy: { sorguTarihi: 'desc' },
          select: { durum: true, ihlalSayisi: true, toplamTutar: true },
        });
        if (son) sonuclar.set(a.id, { durum: son.durum, ihlalSayisi: son.ihlalSayisi, toplamTutar: Number(son.toplamTutar || 0) });
      }
      const ozet = this.buildGaleriHgsOzet(araclar, sonuclar, taxpayer);
      const onsoz = String(job?.payload?.onsozMesaji || '').trim();
      const finalMesaj = onsoz ? `${onsoz}\n\n— — — — —\n\n${ozet.mesaj}` : ozet.mesaj;
      await this.gonderGaleriHgsOzet(tenantId, finalMesaj, phones);
      await this.jobProgress(tenantId, job, 'resend_done', `Özet ${phones.length} numaraya yeniden gönderildi.`);
      return { recordCount: 0, result: { runner: 'railway', phase: 'galeri_hgs_resend', phones, ...ozet.totals } };
    }

    const apiKey = process.env.TWOCAPTCHA_API_KEY || process.env.TWO_CAPTCHA_API_KEY;
    if (!apiKey) throw new Error('TWOCAPTCHA_API_KEY env yok; KGM captcha cozulemez');

    const browser = await pwChromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROMIUM_PATH,
      headless: this.browserHeadless(),
      // KGM'nin eski sunucusu Chromium HTTP/2 istegine govde akitmiyor (head gelir, body takilir;
      // ham HTTP/1.1 fetch sorunsuz). HTTP/2 + QUIC kapatip HTTP/1.1'e zorla. Bu launch SADECE
      // GALERI_HGS'e ozel — e-Tebligat/GIB/SGK paylasilan browserLaunchArgs'tan etkilenmez.
      args: [...this.browserLaunchArgs(), '--disable-http2', '--disable-quic'],
    });

    try {
      const context = await browser.newContext({
        acceptDownloads: false,
        viewport: { width: 1440, height: 950 },
        locale: 'tr-TR',
        timezoneId: 'Europe/Istanbul',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });
      await this.applyBrowserStealth(context);

      // ── KGM SUNUCU TESTI ──
      if (mode === 'kgm_test') {
        // KGM kaynak-kesme route'u SADECE bu context'e (GIB SPA'sini bozmaz; full modda ayri context).
        await this.applyKgmResourceRoute(context);
        const testPlaka = String(job?.payload?.testPlaka || '').trim();
        if (!testPlaka) throw new Error('kgm_test icin testPlaka gerekli');
        // 1) HAM AGI PROBU (tarayicisiz): KGM sunucu IP'sine TCP/HTTP seviyesinde ulasiyor mu?
        await this.jobProgress(tenantId, job, 'kgm_probe', 'KGM ham ag erisimi test ediliyor (tarayicisiz).');
        const netProbe = await this.probeKgmConnectivity();
        await this.jobProgress(
          tenantId, job, 'kgm_probe_done',
          netProbe.ok ? `Ham fetch OK: HTTP ${netProbe.httpStatus} (${netProbe.ms}ms)` : `Ham fetch BASARISIZ: ${netProbe.error}`,
        );
        // 2) TARAYICI TESHIS: sayfa gercekte ne render ediyor (form geliyor mu)?
        await this.jobProgress(tenantId, job, 'kgm_teshis', 'KGM tarayici sayfasi inceleniyor.');
        const tarayiciTeshis: any = await this.kgmTarayiciTeshis(context);
        await this.jobProgress(
          tenantId, job, 'kgm_teshis_done',
          tarayiciTeshis?.hasTxtPlk
            ? 'Form geldi (#txtPlk var).'
            : `Form YOK — url=${tarayiciTeshis?.url || '-'}, title=${tarayiciTeshis?.title || '-'}`,
        );
        // 3) TARAYICI ile gercek sorgu.
        await this.jobProgress(tenantId, job, 'kgm_test', `KGM tarayici testi: ${testPlaka}`);
        const sonuc = await this.sorgulaKgmPlaka(context, testPlaka, apiKey);
        await context.close().catch(() => {});
        const ulasildi = sonuc.durum !== 'hatali';
        await this.jobProgress(
          tenantId, job, 'kgm_test_done',
          ulasildi
            ? `KGM sunucudan ULASILDI: ${sonuc.ihlalSayisi || 0} ihlal / ${(sonuc.toplamTutar || 0).toFixed(2)} ₺`
            : `KGM tarayici ULASILAMADI: ${sonuc.hataMesaji || 'bilinmeyen hata'}`,
        );
        return {
          recordCount: 0,
          result: {
            runner: 'railway',
            phase: 'kgm_test',
            plaka: testPlaka,
            kgmUlasildi: ulasildi,
            netProbe,
            tarayiciTeshis,
            durum: sonuc.durum,
            ihlalSayisi: sonuc.ihlalSayisi || 0,
            toplamTutar: sonuc.toplamTutar || 0,
            hataMesaji: sonuc.hataMesaji || null,
          },
        };
      }

      // ── TAM AKIS: GIB girisi + arac cekme ──
      const bundle = await this.portalAutomation.getCredentialForJob(tenantId, job.id) as RunnerJobBundle;
      const credential = bundle.credential;
      const taxpayer = bundle.taxpayer;
      if (!credential.userCode || !(credential.secondaryPassword || credential.password)) {
        throw new Error('Vergi dairesi kullanici kodu ve sifre eksik');
      }

      const loginUrl = DEFAULT_GIB_IVD_LOGIN_URL;
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      await this.jobProgress(tenantId, job, 'login', 'Dijital Vergi Dairesi girisi yapiliyor.');
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await this.loginGibDigitalWithCaptcha(page, credential, loginUrl, 'galeri-hgs');

      await this.jobProgress(tenantId, job, 'arac', 'Araç bilgileri okunuyor (Satır sayısı 100).');
      const scrapeRes = await this.scrapeGibAracPlakalari(page);
      const plakalar = scrapeRes.plakalar;
      await page.close().catch(() => {});
      await context.close().catch(() => {}); // GIB context isi bitti (route'suz).

      // ── ARAC CEKME TESHIS modu: sadece scrape sonucu + DOM teshisi (KGM/silme/WhatsApp yok) ──
      if (mode === 'arac_test') {
        await this.jobProgress(tenantId, job, 'arac_test_done', `Araç teşhis: ${plakalar.length}/${scrapeRes.diag?.reportedTotal ?? '?'} plaka (eksiksiz=${scrapeRes.diag?.eksiksiz})`);
        return {
          recordCount: 0,
          result: { runner: 'railway', phase: 'arac_test', codeVersion: 'v16-pageno', plakaSayisi: plakalar.length, plakalar, diag: scrapeRes.diag },
        };
      }

      if (!plakalar.length) {
        await this.jobProgress(tenantId, job, 'arac_bos', 'Araç bilgileri tablosunda plaka bulunamadi.');
        return { recordCount: 0, result: { runner: 'railway', phase: 'galeri_hgs', plakaSayisi: 0, not: 'Plaka bulunamadi' } };
      }

      // Plakalari Arac tablosuna upsert (manuel giris yok).
      const araclar: Array<{ id: string; plaka: string }> = [];
      for (const pl of plakalar) {
        const arac = await this.upsertGaleriArac(tenantId, job.taxpayerId, pl, taxpayer);
        if (arac) araclar.push(arac);
      }

      // SENKRON: GIB'de OLMAYAN ama portalda olan araclari sil — AMA SADECE cekim EKSIKSIZ ise
      // (yoksa gercek araci yanlislikla sileriz). eksiksiz = scraped >= GIB toplam.
      let silinenler: string[] = [];
      const eksiksiz = scrapeRes.diag?.eksiksiz === true;
      if (eksiksiz) {
        silinenler = await this.senkronAracSil(tenantId, job.taxpayerId, plakalar).catch((err: any) => {
          this.logger.warn(`[GALERI_HGS] senkron silme hatasi: ${err?.message || err}`);
          return [] as string[];
        });
      }
      await this.jobProgress(
        tenantId, job, 'arac_done',
        `${araclar.length} plaka kaydedildi${eksiksiz ? `, ${silinenler.length} eski araç silindi` : ' (çekim eksik → silme atlandı)'}. HGS sorgusu basliyor.`,
      );

      // Her plaka icin SIFIRDAN izole sorgu: her plakaya TAZE context (yeni cerez/oturum) +
      // aralarinda bekleme. KGM pes pese sorguda oturum-bazli throttle ettigi icin her sorgu
      // yeni bir ziyaretci gibi olur -> kararliik artar.
      const gecikmeMs = Math.max(0, Number(process.env.GALERI_HGS_PLAKA_GECIKME_MS || 5000));
      const sonuclar = new Map<string, any>();
      for (let i = 0; i < araclar.length; i++) {
        const a = araclar[i];
        const s = await this.sorgulaKgmPlakaIzole(browser, a.plaka, apiKey);
        sonuclar.set(a.id, s);
        await this.jobProgress(
          tenantId, job, 'hgs',
          `${a.plaka}: ${s.durum} — ${s.ihlalSayisi || 0} ihlal (${i + 1}/${araclar.length})`,
          { current: i + 1, total: araclar.length },
        );
        if (i < araclar.length - 1) await new Promise((r) => setTimeout(r, gecikmeMs));
      }

      // LISTE BITINCE: hatali kalan plakalari tekrar sorgula (en cok 2 tur) — yine izole.
      const maxRetryRounds = Math.max(0, Number(process.env.GALERI_HGS_RETRY_ROUNDS || 2));
      for (let round = 1; round <= maxRetryRounds; round++) {
        const failed = araclar.filter((a) => (sonuclar.get(a.id)?.durum) === 'hatali');
        if (!failed.length) break;
        await this.jobProgress(
          tenantId, job, 'hgs_retry',
          `${failed.length} hatali plaka tekrar sorgulaniyor (tur ${round}/${maxRetryRounds}).`,
        );
        for (const a of failed) {
          await new Promise((r) => setTimeout(r, gecikmeMs));
          const s = await this.sorgulaKgmPlakaIzole(browser, a.plaka, apiKey);
          sonuclar.set(a.id, s);
          await this.jobProgress(tenantId, job, 'hgs_retry', `${a.plaka}: ${s.durum} (tekrar)`);
        }
      }

      // Sonuclari kaydet.
      for (const a of araclar) {
        await this.kaydetGaleriHgsSonucu(tenantId, a.id, sonuclar.get(a.id)).catch((err: any) =>
          this.logger.warn(`[GALERI_HGS] sonuc kaydedilemedi (${a.plaka}): ${err?.message || err}`));
      }

      // WhatsApp borc ozeti (+ tek-seferlik onsoz varsa basa ekle).
      const ozet = this.buildGaleriHgsOzet(araclar, sonuclar, taxpayer, silinenler);
      const onsoz = String(job?.payload?.onsozMesaji || '').trim();
      const finalMesaj = onsoz ? `${onsoz}\n\n— — — — —\n\n${ozet.mesaj}` : ozet.mesaj;
      await this.gonderGaleriHgsOzet(tenantId, finalMesaj, phones).catch((err: any) =>
        this.logger.warn(`[GALERI_HGS] WhatsApp ozet hatasi: ${err?.message || err}`));
      await this.jobProgress(
        tenantId, job, 'hgs_done',
        `HGS sorgusu tamam: ${ozet.totals.borcluArac} borçlu, ${ozet.totals.toplamBorc.toFixed(2)} ₺, ${ozet.totals.hataliArac} hatalı, ${silinenler.length} eski araç silindi.`,
      );

      return { recordCount: araclar.length, result: { runner: 'railway', phase: 'galeri_hgs', codeVersion: 'v19-tablovar', plakalar: araclar.map((a) => a.plaka), silinen: silinenler, eksiksiz, ...ozet.totals } };
    } finally {
      await browser.close().catch(() => {});
    }
  }

  /** Dijital Vergi Dairesi "Mevcut Araç Bilgilerim" tablosundaki plakalari okur (+teshis). */
  private async scrapeGibAracPlakalari(page: any): Promise<{ plakalar: string[]; diag: any }> {
    // Sayfanin kendi araç-listesi API istegini yakala (method+header+body) -> birebir tekrar oynat.
    let aracListReq: any = null;
    page.on('request', (req: any) => {
      try {
        const u = String(req.url() || '');
        if (!/aracBilgilerim\/list/i.test(u)) return;
        if (aracListReq) return;
        const h = req.headers() || {};
        const keep: any = {};
        for (const k of Object.keys(h)) {
          if (k.startsWith(':')) continue; // HTTP/2 pseudo-header
          if (/^(authorization|content-type|accept|accept-language)$/i.test(k) || /^x-/i.test(k)) keep[k] = h[k];
        }
        aracListReq = { url: u, method: req.method(), headers: keep, postData: req.postData() || null };
      } catch { /* yoksay */ }
    });
    await page.goto(GIB_ARAC_BILGILERIM_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(4000);

    // ── BIRINCIL: API'yi tekrar oynat (tum sayfalar) — DOM'dan bagimsiz, eksiksiz ──
    if (aracListReq) {
      const reqInfo = { method: aracListReq.method, headerKeys: Object.keys(aracListReq.headers || {}), postData: String(aracListReq.postData || '').slice(0, 400) };
      const apiRes = await this.fetchGibAracViaApi(page, aracListReq).catch((e: any) => ({ plakalar: [], total: 0, pages: [{ error: this.compact(e?.message || e) }] }));
      if (apiRes && apiRes.plakalar.length && apiRes.total && apiRes.plakalar.length >= apiRes.total) {
        return { plakalar: apiRes.plakalar, diag: { source: 'api', reqInfo, reportedTotal: apiRes.total, scraped: apiRes.plakalar.length, eksiksiz: true, pages: apiRes.pages } };
      }
      if (apiRes && apiRes.plakalar.length) {
        return { plakalar: apiRes.plakalar, diag: { source: 'api_kismi', reqInfo, reportedTotal: apiRes.total, scraped: apiRes.plakalar.length, eksiksiz: apiRes.total ? apiRes.plakalar.length >= apiRes.total : null, pages: apiRes.pages } };
      }
      // API hic plaka vermedi — DOM yedegine dus ama reqInfo'yu sakla (teshis).
      (this as any)._lastAracReqInfo = reqInfo;
    }

    // ── YEDEK: DOM scrape (API yakalanamazsa) ──
    // Tabloyu bekle (SPA render).
    await page.waitForFunction(
      () => /Plaka\s*Numaras/i.test(document.body.innerText || ''),
      { timeout: 20_000 },
    ).catch(() => {});

    // "Satır sayısı" sayfa boyutunu 100'e cek (tek listede gorunsun).
    await this.gibAracSayfaBoyutu100(page).catch(() => {});
    await page.waitForTimeout(1500);

    // Sayfalama varsa tum sayfalari dolas, plakalari biriktir + TESHIS topla.
    const seen = new Set<string>();
    const pageSnaps: any[] = [];
    let paginatorText = '';
    let reportedTotal = 0;
    for (let p = 0; p < 40; p++) {
      // MUI tabloyu async dolduruyor — satir sayisi sabitlenene kadar bekle (eksik okumayi onler).
      await this.waitGibRowsStable(page);
      const snap: any = await page.evaluate(() => {
        const isPlate = (s: string) => /^\d{2}[A-Z]{1,4}\d{1,5}$/.test(s);
        const pag = document.querySelector('.mat-mdc-paginator-range-label, .mat-paginator-range-label');
        const pagText = pag ? String(pag.textContent || '').trim() : '';
        const rows = Array.from(document.querySelectorAll('table tbody tr, table tr, [role="row"]'));
        const plates: string[] = [];
        const sampleRows: any[] = [];
        for (const r of rows) {
          const cells = Array.from(r.querySelectorAll('td, [role="cell"], [role="gridcell"]')).map((c) => String(c.textContent || '').trim());
          if (!cells.length) continue;
          let plate = '';
          for (const c of cells) { const n = c.replace(/[\s-]/g, '').toUpperCase(); if (isPlate(n)) { plate = n; break; } }
          if (plate) plates.push(plate);
          if (sampleRows.length < 20) sampleRows.push({ cells: cells.slice(0, 4), plate });
        }
        // "X-Y/Z" aralik metni (toplam Z) — paginator markup'tan bagimsiz, tum DOM'da ara.
        const rangeTexts = Array.from(document.querySelectorAll('*'))
          .filter((e) => e.children.length === 0)
          .map((e) => String(e.textContent || '').trim())
          .filter((t) => /\d+\s*[-–—]\s*\d+\s*\/\s*\d+/.test(t))
          .slice(0, 6);
        const selects = Array.from(document.querySelectorAll('select, mat-select, [role="combobox"], .mat-mdc-select, .mat-select'))
          .map((e: any) => ({ cls: String(e.className || '').slice(0, 60), txt: String(e.textContent || '').trim().slice(0, 30) }))
          .slice(0, 6);
        const nextBtns = Array.from(document.querySelectorAll('button'))
          .filter((b: any) => /onraki|next|sonraki|ileri/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.className || '')))
          .map((b: any) => ({ label: b.getAttribute('aria-label'), cls: String(b.className || '').slice(0, 70), disabled: !!b.disabled, ariaDisabled: b.getAttribute('aria-disabled') }))
          .slice(0, 6);
        const tbodyTr = document.querySelectorAll('table tbody tr').length;
        return { pagText, rowCount: rows.length, plates, sampleRows, rangeTexts, selects, nextBtns, tbodyTr };
      });
      if (snap.pagText) paginatorText = snap.pagText;
      // GIB'in bildirdigi TOPLAM (Z) — "1–10/11" -> 11. Silme guvenligi icin esas alinir.
      if (!reportedTotal && Array.isArray(snap.rangeTexts)) {
        for (const t of snap.rangeTexts) { const m = String(t).match(/\/\s*(\d+)/); if (m) { reportedTotal = parseInt(m[1], 10); break; } }
      }
      let yeni = 0;
      for (const pl of snap.plates) { if (!seen.has(pl)) { seen.add(pl); yeni++; } }
      pageSnaps.push({
        page: p, pagText: snap.pagText, rowCount: snap.rowCount, tbodyTr: snap.tbodyTr, plateCount: snap.plates.length, yeni,
        ...(p === 0 ? { sampleRows: snap.sampleRows, rangeTexts: snap.rangeTexts, selects: snap.selects, nextBtns: snap.nextBtns } : {}),
      });

      // Hepsini topladiysak dur.
      if (reportedTotal && seen.size >= reportedTotal) break;

      // MUI TablePagination "sonraki sayfa" (aria-label "Go to next page") + mat fallback.
      const next = await page.$(
        'button[aria-label="Go to next page"], button[aria-label*="next page"], .mat-mdc-paginator-navigation-next, button[aria-label*="onraki"], button[aria-label*="sonraki"]',
      );
      if (!next) break;
      const disabled = await next.evaluate((el: any) => !!el.disabled || el.getAttribute('aria-disabled') === 'true').catch(() => true);
      if (disabled) break;
      if (p > 0 && yeni === 0) break; // ilerleme yoksa sonsuz donguyu kes.
      await next.click().catch(() => {});
      await page.waitForTimeout(1500);
    }
    return { plakalar: Array.from(seen), diag: { source: 'dom', paginatorText, reportedTotal, scraped: seen.size, eksiksiz: reportedTotal ? seen.size >= reportedTotal : null, pages: pageSnaps } };
  }

  /** Yakalanan araç-listesi istegini sayfa-icinde tekrar oynatir; TUM sayfalardan plaka toplar. */
  private async fetchGibAracViaApi(page: any, req: any): Promise<{ plakalar: string[]; total: number; pages: any[] }> {
    return page.evaluate(async (r: any) => {
      const norm = (s: string) => String(s || '').replace(/[\s-]/g, '').toUpperCase().trim();
      const seen: string[] = [];
      const seenSet: Record<string, boolean> = {};
      const pages: any[] = [];
      let total = 0;
      for (let pageNo = 1; pageNo <= 30; pageNo++) {
        // Body'deki pageNo'yu artir, pageSize'i buyut (varsa). Body yoksa GET query dene.
        let body = r.postData;
        let url = r.url;
        if (body) {
          try {
            const j = JSON.parse(body);
            if (j && j.meta && j.meta.pagination && typeof j.meta.pagination === 'object') { j.meta.pagination.pageNo = pageNo; j.meta.pagination.pageSize = 100; }
            else if (j && j.pageDetail && typeof j.pageDetail === 'object') { j.pageDetail.pageNo = pageNo; j.pageDetail.pageSize = 100; }
            else { j.pageNo = pageNo; j.pageSize = 100; }
            body = JSON.stringify(j);
          } catch { /* body JSON degil; oldugu gibi birak */ }
        } else if (r.method === 'GET') {
          url = url + (url.includes('?') ? '&' : '?') + 'pageNo=' + pageNo + '&pageSize=100';
        }
        let resp: Response;
        try {
          resp = await fetch(url, { method: r.method || 'GET', headers: r.headers || {}, body: (r.method === 'GET' || r.method === 'HEAD') ? undefined : body, credentials: 'include' });
        } catch (e) { pages.push({ pageNo, error: String(e) }); break; }
        let j: any = null;
        try { j = await resp.json(); } catch { pages.push({ pageNo, status: resp.status, error: 'json degil' }); break; }
        const data = (j && j.data) || [];
        const pd = (j && j.pageDetail) || {};
        total = Number(j && (j.totalCount || (pd && pd.total))) || total;
        let yeni = 0;
        for (const d of data) {
          const pl = norm(d && (d.plaka || d.plakaNo || d.plate));
          if (pl && pl.length >= 5 && !seenSet[pl]) { seenSet[pl] = true; seen.push(pl); yeni++; }
        }
        pages.push({ pageNo, status: resp.status, count: data.length, yeni, total });
        const totalPage = Number(pd && pd.totalPage) || 0;
        if (totalPage && pageNo >= totalPage) break;
        if (total && seen.length >= total) break;
        if (!data.length || yeni === 0) break;
      }
      return { plakalar: seen, total, pages };
    }, req);
  }

  /** MUI tablo async dolar — satir sayisi 1.2s sabit kalana kadar bekle (max ~12s). */
  private async waitGibRowsStable(page: any): Promise<void> {
    await page.waitForFunction(
      () => {
        const n = document.querySelectorAll('table tr, [role="row"]').length;
        const w: any = window;
        const stable = w.__gibRowN === n && n > 1;
        w.__gibRowN = n;
        return stable;
      },
      { timeout: 12_000, polling: 1200 },
    ).catch(() => {});
  }

  /** "Satır sayısı" sayfa boyutunu 100 yapar — MUI TablePagination (+ mat fallback). */
  private async gibAracSayfaBoyutu100(page: any): Promise<void> {
    const sel = await page.$(
      '.MuiTablePagination-select, .MuiTablePagination-input, [aria-haspopup="listbox"], .mat-mdc-paginator-page-size-select, .mat-paginator-page-size-select',
    );
    if (!sel) return;
    await sel.click().catch(() => {});
    await page.waitForTimeout(800);
    const opts = await page.$$(
      'li[role="option"], .MuiMenuItem-root, .MuiTablePagination-menuItem, ul[role="listbox"] li, mat-option, .mat-mdc-option, [role="option"]',
    );
    let picked = false;
    for (const o of opts) {
      const t = String((await o.textContent().catch(() => '')) || '').trim();
      if (t === '100') { await o.click().catch(() => {}); picked = true; break; }
    }
    // 100 yoksa en buyuk secenegi sec (genelde son).
    if (!picked && opts.length) await opts[opts.length - 1].click().catch(() => {});
    await page.waitForTimeout(1500);
  }

  /** Plakayi galeri ile ayni sekilde normalize edip Arac tablosuna upsert eder. */
  private async upsertGaleriArac(tenantId: string, taxpayerId: string | null, plaka: string, taxpayer: any) {
    const plakaNormal = String(plaka || '').replace(/[\s-]/g, '').toUpperCase().trim();
    if (plakaNormal.length < 5) return null;
    const sahipAd = taxpayer
      ? (taxpayer.companyName || [taxpayer.firstName, taxpayer.lastName].filter(Boolean).join(' ').trim() || null)
      : null;
    return (this.prisma as any).arac.upsert({
      where: { tenantId_plaka: { tenantId, plaka: plakaNormal } },
      create: {
        tenantId,
        plaka: plakaNormal,
        taxpayerId: taxpayerId || null,
        sahipAd,
        aktif: true,
        notlar: 'Dijital Vergi Dairesi araç bilgilerinden otomatik eklendi',
      },
      update: { aktif: true, ...(taxpayerId ? { taxpayerId } : {}) },
      select: { id: true, plaka: true },
    });
  }

  /**
   * SENKRON: portal araç listesini GIB ile birebir esitler — GIB'de OLMAYAN portal araclarini SILER.
   * Yalnizca cekim EKSIKSIZ oldugunda cagrilir (yanlis silmeyi onler). Bu galeri mukellefinin
   * (taxpayerId) + henuz baglanmamis (null) araclari kapsanir. Silinen plakalari dondurur.
   */
  private async senkronAracSil(tenantId: string, taxpayerId: string | null, gibPlakalar: string[]): Promise<string[]> {
    const norm = (p: string) => String(p || '').replace(/[\s-]/g, '').toUpperCase().trim();
    const gibSet = new Set(gibPlakalar.map(norm));
    const where: any = taxpayerId ? { tenantId, OR: [{ taxpayerId }, { taxpayerId: null }] } : { tenantId };
    const mevcut = await (this.prisma as any).arac.findMany({ where, select: { id: true, plaka: true } });
    const silinecek = mevcut.filter((a: any) => !gibSet.has(norm(a.plaka)));
    if (silinecek.length) {
      await (this.prisma as any).arac.deleteMany({ where: { id: { in: silinecek.map((a: any) => a.id) } } });
    }
    return silinecek.map((a: any) => a.plaka);
  }

  /** Sorgu sonucunu HgsIhlalSorguSonucu olarak kaydeder (kaynak='sunucu'). */
  private async kaydetGaleriHgsSonucu(tenantId: string, aracId: string, sonuc: any) {
    const basarili = sonuc?.durum === 'basarili';
    await (this.prisma as any).hgsIhlalSorguSonucu.create({
      data: {
        tenantId,
        aracId,
        durum: basarili ? 'basarili' : 'hatali',
        ihlalSayisi: sonuc?.ihlalSayisi || 0,
        toplamTutar: basarili ? (sonuc?.toplamTutar ?? null) : null,
        detaylar: sonuc?.detaylar || null,
        hataMesaji: basarili ? null : (sonuc?.hataMesaji || 'KGM sorgusu başarısız'),
        kaynak: 'sunucu',
      },
    });
  }

  /** Borç özeti mesajı + toplamlar. */
  private buildGaleriHgsOzet(
    araclar: Array<{ id: string; plaka: string }>,
    sonuclar: Map<string, any>,
    taxpayer: any,
    silinenler: string[] = [],
  ): { mesaj: string; totals: { plakaSayisi: number; borcluArac: number; borcsuzArac: number; hataliArac: number; toplamBorc: number } } {
    const fmtPlaka = (p: string) => {
      const s = String(p || '').replace(/[\s-]/g, '').toUpperCase();
      const m = s.match(/^(\d{1,3})([A-Z]{1,3})(\d{1,4})$/);
      return m ? `${m[1]} ${m[2]} ${m[3]}` : s;
    };
    const fmtTl = (n: number) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.round(n || 0));

    const borclular: Array<{ plaka: string; ihlal: number; tutar: number }> = [];
    let borcsuz = 0;
    let hatali = 0;
    let toplamBorc = 0;
    for (const a of araclar) {
      const s = sonuclar.get(a.id);
      if (!s || s.durum === 'hatali') { hatali++; continue; }
      const tutar = Number(s.toplamTutar || 0);
      if ((s.ihlalSayisi || 0) > 0 || tutar > 0) {
        borclular.push({ plaka: a.plaka, ihlal: s.ihlalSayisi || 0, tutar });
        toplamBorc += tutar;
      } else {
        borcsuz++;
      }
    }
    borclular.sort((x, y) => y.tutar - x.tutar);

    const firma = taxpayer
      ? (taxpayer.companyName || [taxpayer.firstName, taxpayer.lastName].filter(Boolean).join(' ').trim() || 'Galeri')
      : 'Galeri';
    const tarih = new Date().toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' });

    const lines: string[] = [];
    lines.push(`🚗 ${firma} — HGS İhlal Sorgu`);
    lines.push(tarih);
    lines.push('');
    if (borclular.length) {
      lines.push('Borçlu araçlar:');
      for (const b of borclular) {
        lines.push(`• ${fmtPlaka(b.plaka)} — ${b.ihlal} ihlal — ${fmtTl(b.tutar)} ₺`);
      }
    } else {
      lines.push('✅ Borçlu araç yok.');
    }
    lines.push('');
    lines.push(`Borçsuz: ${borcsuz} araç`);
    if (hatali) lines.push(`⚠️ Sorgulanamayan: ${hatali} araç`);
    if (silinenler && silinenler.length) {
      lines.push(`🗑️ Listeden düşen (GİB'de yok): ${silinenler.map(fmtPlaka).join(', ')}`);
    }
    lines.push('');
    lines.push(`TOPLAM BORÇ: ${fmtTl(toplamBorc)} ₺ (${borclular.length} araç)`);

    return {
      mesaj: lines.join('\n'),
      totals: {
        plakaSayisi: araclar.length,
        borcluArac: borclular.length,
        borcsuzArac: borcsuz,
        hataliArac: hatali,
        toplamBorc,
      },
    };
  }

  /** WhatsApp ozetini bildirim olarak yazar; owner-notifier sabit numaralara iletir. */
  private async gonderGaleriHgsOzet(tenantId: string, mesaj: string, phones: string[]) {
    await (this.prisma as any).notification.create({
      data: {
        tenantId,
        title: 'HGS İhlal Sorgu Sonucu',
        body: mesaj.slice(0, 480),
        type: 'GALERI_HGS_OZET',
        metadata: { message: mesaj, phones },
      },
    });
  }

  // ── KGM (HGS ihlal) sorgu — matematik captcha'li ──

  /** KGM'ye ozel context: kaynak-kesme route'lu (GIB context'inden AYRI). */
  private async createKgmContext(browser: any) {
    const ctx = await browser.newContext({
      acceptDownloads: false,
      viewport: { width: 1440, height: 950 },
      locale: 'tr-TR',
      timezoneId: 'Europe/Istanbul',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    await this.applyBrowserStealth(ctx);
    await this.applyKgmResourceRoute(ctx);
    return ctx;
  }

  /**
   * KGM sayfasinda head'deki UCUNCU-PARTI senkron script (static host ozelyuk.kgm.gov.tr)
   * Railway'den takilip HTML parser'i kilitliyor -> <body> (form #txtPlk) hic insa edilmiyor
   * (ham HTTP/1.1 fetch tum HTML'i aliyor cunku alt-kaynak istemiyor). Cozum: gereksiz/bloke-eden
   * alt-kaynaklari kes — CSS/font/media + ANA-host DISI script'ler. Captcha (#Image1) ANA hostta
   * image tipi -> dokunulmaz. Inline __doPostBack etkilenmez. SADECE KGM context'ine uygulanir.
   */
  private async applyKgmResourceRoute(context: any) {
    const kgmMainHost = 'webihlaltakip.kgm.gov.tr';
    await context.route('**/*', (route: any) => {
      try {
        const req = route.request();
        const type = req.resourceType();
        let host = '';
        try { host = new URL(req.url()).host; } catch { /* yoksay */ }
        if (type === 'stylesheet' || type === 'font' || type === 'media') return route.abort();
        if (type === 'script' && host && host !== kgmMainHost) return route.abort();
        return route.continue();
      } catch {
        return route.continue().catch(() => {});
      }
    }).catch(() => {});
  }

  /** Tarayicisiz ham HTTP probu — KGM sunucu IP'sine ulasiyor mu? (engel/coğrafi teshis) */
  private async probeKgmConnectivity(): Promise<{ ok: boolean; httpStatus?: number; ms?: number; error?: string }> {
    const t0 = Date.now();
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const resp = await fetch(KGM_HGS_URL, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'tr-TR,tr;q=0.9',
        },
      });
      const text = await resp.text().catch(() => '');
      const wafMarkers: string[] = [];
      for (const m of ['incapsula', 'radware', 'distil', 'perimeterx', 'cloudflare', 'akamai', 'captcha', 'robot kontrol', 'unsuccessful', 'access denied', 'forbidden', '__cf', 'challenge']) {
        if (new RegExp(m, 'i').test(text)) wafMarkers.push(m);
      }
      const hasForm = /id=["']?txtPlk/i.test(text);
      return {
        ok: true,
        httpStatus: resp.status,
        ms: Date.now() - t0,
        bodyLen: text.length,
        hasTxtPlkInHtml: hasForm,
        wafMarkers,
        bodySnippet: text.replace(/\s+/g, ' ').slice(0, 400),
      } as any;
    } catch (err: any) {
      return { ok: false, ms: Date.now() - t0, error: this.compact(err?.message || err) };
    } finally {
      clearTimeout(to);
    }
  }

  /** Tarayicida KGM sayfasi GERCEKTE ne render ediyor + HANGI istek takiliyor (pending)? */
  private async kgmTarayiciTeshis(context: any) {
    const page = await context.newPage();
    const requests: Array<{ url: string; type: string }> = [];
    const responded = new Set<string>();
    page.on('request', (r: any) => requests.push({ url: r.url(), type: r.resourceType() }));
    page.on('response', (r: any) => responded.add(r.url()));
    page.on('requestfailed', (r: any) => responded.add(r.url()));
    try {
      await page.goto(KGM_HGS_URL, { waitUntil: 'commit', timeout: 60_000 });
      await page.waitForTimeout(10_000);
      const dom = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        hasTxtPlk: !!document.querySelector('#txtPlk'),
        inputIds: Array.from(document.querySelectorAll('input,textarea,select'))
          .map((e) => e.id || e.getAttribute('name') || '')
          .filter(Boolean)
          .slice(0, 30),
        iframeCount: document.querySelectorAll('iframe').length,
        bodyTextHead: String((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').slice(0, 400),
        htmlLen: document.documentElement.outerHTML.length,
        readyState: document.readyState,
      }));
      // Cevap gelmemis (takili) istekler = body'yi blokeleyen suclu(lar).
      const pending = requests
        .filter((q) => !responded.has(q.url))
        .map((q) => `${q.type} ${q.url}`)
        .slice(0, 25);
      return {
        ...dom,
        codeVersion: 'v7-canvas',
        requestCount: requests.length,
        respondedCount: responded.size,
        pending,
      };
    } catch (err: any) {
      return { error: this.compact(err?.message || err), codeVersion: 'v7-canvas' };
    } finally {
      await page.close().catch(() => {});
    }
  }

  /** Plakayi SIFIRDAN izole sorgular: TAZE context (yeni cerez/oturum) ac, sorgula, kapat. */
  private async sorgulaKgmPlakaIzole(browser: any, plaka: string, apiKey: string) {
    const ctx = await this.createKgmContext(browser);
    try {
      return await this.sorgulaKgmPlaka(ctx, plaka, apiKey);
    } finally {
      await ctx.close().catch(() => {});
    }
  }

  /** Tek plaka KGM sorgusu; captcha yanlissa 4 kez dener. */
  private async sorgulaKgmPlaka(context: any, plaka: string, apiKey: string) {
    const plakaTemiz = String(plaka || '').replace(/\s/g, '').toUpperCase();
    const MAX_DENEME = 4;
    let sonuc: any = null;
    for (let i = 1; i <= MAX_DENEME; i++) {
      sonuc = await this.sorgulaKgmPlakaTekSefer(context, plakaTemiz, apiKey);
      if (sonuc.durum !== 'captcha_yanlis') return sonuc;
      if (sonuc.captchaId) await this.report2captchaBad(apiKey, sonuc.captchaId);
    }
    return { durum: 'hatali', ihlalSayisi: 0, toplamTutar: 0, detaylar: [], hataMesaji: `${MAX_DENEME} deneme captcha yanlış geldi` };
  }

  private async sorgulaKgmPlakaTekSefer(context: any, plaka: string, apiKey: string) {
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    try {
      // KGM (eski ASP.NET) yavas acilabilir: 'commit'te don, sonra plaka input'unu bekle.
      await page.goto(KGM_HGS_URL, { waitUntil: 'commit', timeout: 60_000 });
      await page.waitForSelector('#txtPlk', { timeout: 30_000 });
      await page.waitForTimeout(1000);

      // Bilgilendirme modal + "OKUDUM ANLADIM" checkbox.
      const anladimBtn = await page.$('#btnCloseUyariModal');
      if (anladimBtn && await anladimBtn.isVisible().catch(() => false)) {
        await anladimBtn.click().catch(() => {});
        await page.waitForTimeout(400);
      }
      const chk = await page.$('#chkGuvenlikUyari');
      if (chk && !(await chk.isChecked().catch(() => false))) {
        await chk.check().catch(() => {});
      }

      const plakaInput = await page.$('#txtPlk');
      if (!plakaInput) throw new Error('Plaka input (#txtPlk) bulunamadı');
      await plakaInput.fill('');
      await plakaInput.type(plaka, { delay: 40 });

      const cozum = await this.solveKgmCaptchaOnPage(page, apiKey);
      if (!cozum) throw new Error('Captcha çözülemedi');
      if (cozum.formatBozuk) return { durum: 'captcha_yanlis', captchaId: cozum.captchaId };

      const kodInput = await page.$('#txtimgcode');
      if (!kodInput) throw new Error('Captcha textarea (#txtimgcode) bulunamadı');
      await kodInput.fill('');
      await kodInput.type(cozum.cevap, { delay: 40 });

      const sorgulaBtn = await page.$('#btnSorgula');
      if (!sorgulaBtn) throw new Error('Sorgula butonu (#btnSorgula) bulunamadı');
      await sorgulaBtn.click();

      await Promise.race([
        // Sonuc tablosu render oldu (0 ihlalde bile bos gv tablolari gelir) -> sorgu calisti.
        page.waitForSelector('table[id^="gv"]', { timeout: 20_000 }),
        page.waitForSelector('#gvKgm tbody tr, #gvAvrasya tbody tr, [id^="gv"] tbody tr', { timeout: 20_000 }),
        page.waitForFunction(
          () => /ihlal\s*bulun|kayıt\s*bulun|sorgu\s*sonucunda|ihlalli\s*geçiş\s*yok|geçiş ihlaliniz/i.test(document.body.innerText || ''),
          { timeout: 20_000 },
        ),
      ]).catch(() => {});
      await page.waitForTimeout(1500);

      const icerik = await page.content();
      if (/güvenlik kodu.*hatalı|captcha.*yanlış|kod.*hatalı|matematiksel.*hatalı|tekrar deneyin/i.test(icerik)) {
        return { durum: 'captcha_yanlis', captchaId: cozum.captchaId };
      }

      const sonuc = await this.parseKgmIhlaller(page);
      // SAGLAMLASTIRMA (DOGRU AYRIM): sorgu CALISMADIYSA (gv* sonuc tablosu YOK) ve "ihlal yok"
      // mesaji da YOK ise -> yanlis captcha / sayfa yuklenmedi -> captcha_yanlis (retry).
      // ihlal tablolari VARSA (0 ihlal olsa bile bos tablolar gelir) sonuc GECERLI -> basarili.
      // Boylece gercek borcsuz (0 ihlal) araclar yanlislikla "hatali" sayilmaz.
      if (!sonuc.tabloVar && !sonuc.temiz) {
        return { durum: 'captcha_yanlis', captchaId: cozum.captchaId };
      }
      return {
        durum: 'basarili',
        ihlalSayisi: sonuc.ihlaller.length,
        toplamTutar: sonuc.toplamTutar,
        detaylar: sonuc.ihlaller,
        temiz: sonuc.temiz,
      };
    } catch (err: any) {
      return { durum: 'hatali', ihlalSayisi: 0, toplamTutar: 0, detaylar: [], hataMesaji: this.compact(err?.message || err) };
    } finally {
      await page.close().catch(() => {});
    }
  }

  /** KGM ihlal tablolarini parse eder (gvKgm, gvAvrasya, vb.). */
  private async parseKgmIhlaller(page: any): Promise<{ ihlaller: any[]; toplamTutar: number; temiz: boolean; tabloVar: boolean }> {
    return page.evaluate(() => {
      function paraParse(s: string) {
        if (!s) return 0;
        const cleaned = String(s).replace(/[^\d,.\-₺TL ]/gi, '').replace(/[₺TL\s]/gi, '').trim();
        const normalized = cleaned.replace(/\./g, '').replace(',', '.');
        return parseFloat(normalized) || 0;
      }
      const allTables = Array.from(document.querySelectorAll('table[id^="gv"], table.dataTable'));
      const tables = Array.from(new Set(allTables));
      const ihlaller = [];
      let toplam = 0;
      for (const t of tables) {
        const tableId = t.id || '(no-id)';
        const headers = Array.from(t.querySelectorAll('thead th, thead td')).map((h) => (h.textContent || '').trim());
        const odenecekIdx = headers.findIndex((h) => /Ödenecek\s*Tutar/i.test(h));
        const gecisUcretIdx = headers.findIndex((h) => /Geçiş\s*Ücreti/i.test(h));
        const tarihIdx = headers.findIndex((h) => /Çıkış\s*Tarih|Tarih/i.test(h));
        const girisIdx = headers.findIndex((h) => /Giriş/i.test(h));
        const cikisIdx = headers.findIndex((h) => /Çıkış\s*İstasyon|^Çıkış$/i.test(h));
        const dataRows = Array.from(t.querySelectorAll('tbody tr')).filter((r) => r.querySelectorAll('td').length > 0);
        for (const r of dataRows) {
          const cells = Array.from(r.querySelectorAll('td')).map((c) => (c.textContent || '').trim());
          if (cells.length < 2) continue;
          let tutar = 0;
          if (odenecekIdx >= 0 && cells[odenecekIdx]) tutar = paraParse(cells[odenecekIdx]);
          if (tutar === 0) {
            for (let i = cells.length - 1; i >= 0; i--) {
              if (/₺|TL/i.test(cells[i])) { const v = paraParse(cells[i]); if (v > 0) { tutar = v; break; } }
            }
          }
          ihlaller.push({
            kaynak: tableId,
            tarih: tarihIdx >= 0 ? cells[tarihIdx] : '',
            giris: girisIdx >= 0 ? cells[girisIdx] : '',
            cikis: cikisIdx >= 0 ? cells[cikisIdx] : '',
            gecisUcreti: gecisUcretIdx >= 0 ? paraParse(cells[gecisUcretIdx]) : 0,
            tutar,
          });
          toplam += tutar;
        }
      }
      const bodyText = (document.body.innerText || '').toLowerCase();
      const temiz = /ihlal\s*bulun|kayıt\s*bulun|sorgu\s*sonucunda|ihlalli\s*geçiş\s*yok|geçiş ihlaliniz bulun/i.test(bodyText) && ihlaller.length === 0;
      // Sorgu CALISTI mi? Sonuc sayfasinda gv* tablolari render olur (0 ihlalde bile bos tablolar
      // gelir). Yanlis captcha'da form yeniden yuklenir, gv tablosu OLMAZ. Boylece gercek-0 ile
      // yanlis-captcha ayirt edilir.
      const tabloVar = tables.length > 0;
      return { ihlaller, toplamTutar: toplam, temiz, tabloVar };
    });
  }

  /** Sayfadaki #Image1 captcha'sini 2captcha'ya yollar, matematik sonucunu formatlar. */
  private async solveKgmCaptchaOnPage(page: any, apiKey: string) {
    const captchaEl = await page.$('#Image1');
    if (!captchaEl) return null;
    // elementHandle.screenshot() font/stabilite bekledigi icin (font'lari kestik) takiliyor.
    // Captcha ANA hostta (same-origin) -> yuklenen img'i CANVAS ile pixel olarak oku (bekleme yok).
    await page.waitForFunction(
      () => { const i: any = document.querySelector('#Image1'); return !!(i && i.complete && i.naturalWidth > 0); },
      { timeout: 15_000 },
    ).catch(() => {});
    const base64 = await page.evaluate(() => {
      const img: any = document.querySelector('#Image1');
      if (!img || !img.naturalWidth) return null;
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);
      try { return c.toDataURL('image/png').split(',')[1]; } catch { return null; }
    });
    if (!base64) return null;
    const { raw, captchaId } = await this.solveKgmCaptchaWith2Captcha(base64, apiKey);
    const formatted = this.kgmCaptchaFormat(raw);
    const parts = formatted.split(/\s+/);
    const isValid = parts.length >= 2 && parts.every((p) => /^\d+$/.test(p)) && formatted.length >= 5;
    if (!isValid) {
      await this.report2captchaBad(apiKey, captchaId);
      return { cevap: formatted, captchaId, formatBozuk: true };
    }
    return { cevap: formatted, captchaId };
  }

  /**
   * 2captcha image OCR — KGM "16+8 83236" formatini KORUR (bosluk + islem isareti silinmez).
   * Bu yuzden GIB icin kullanilan solveCaptchaWith2Captcha'dan AYRI (o alfanumerik disini siler).
   */
  private async solveKgmCaptchaWith2Captcha(base64: string, apiKey: string): Promise<{ raw: string; captchaId: string }> {
    const inForm = new URLSearchParams();
    inForm.append('key', apiKey);
    inForm.append('method', 'base64');
    inForm.append('body', base64);
    inForm.append('json', '0');
    inForm.append('numeric', '0');
    inForm.append('min_len', '5');
    inForm.append('max_len', '20');
    inForm.append('language', '0');
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
      if (t === 'CAPCHA_NOT_READY') { await new Promise((r2) => setTimeout(r2, pollInterval)); continue; }
      if (t.startsWith('OK|')) return { raw: t.slice(3).trim(), captchaId };
      throw new Error(`2captcha res.php: ${t}`);
    }
    throw new Error('2captcha zaman asimi (KGM)');
  }

  private async report2captchaBad(apiKey: string, captchaId: string) {
    if (!captchaId) return;
    try {
      await fetch(`https://2captcha.com/res.php?key=${encodeURIComponent(apiKey)}&action=reportbad&id=${encodeURIComponent(captchaId)}`);
    } catch { /* onemsiz */ }
  }

  /** "16+8 83236" -> "24 83236" (matematik kismini hesaplar). */
  private kgmCaptchaFormat(rawText: string): string {
    const cleaned = String(rawText || '').trim().replace(/\s+/g, ' ');
    const parts = cleaned.split(' ');
    if (parts.length < 2) return cleaned;
    const m = parts[0].match(/^(\d+)\s*([+\-*\/xX×])\s*(\d+)$/);
    if (!m) return cleaned;
    const a = parseInt(m[1], 10);
    const b = parseInt(m[3], 10);
    let result: number;
    switch (m[2]) {
      case '+': result = a + b; break;
      case '-': result = a - b; break;
      case '*': case 'x': case 'X': case '×': result = a * b; break;
      case '/': result = Math.floor(a / b); break;
      default: return cleaned;
    }
    return `${result} ${parts.slice(1).join(' ')}`;
  }

  private async loginGibDigitalWithCaptcha(
    page: any,
    credential: RunnerCredential,
    loginUrl: string,
    source: string,
  ) {
    const userCode = String(credential.userCode || credential.username || '').trim();
    const password = String(credential.secondaryPassword || credential.password || '');
    if (!userCode || !password) {
      throw new Error('Vergi dairesi kullanici kodu ve sifre eksik');
    }

    const maxAttempts = this.gibValidationLoginAttempts();
    let lastError = '';
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (attempt > 1) {
          await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        }
        await this.waitForEBeyannameLoginForm(page);
        await this.fillEBeyannameLogin(page, userCode, password);
        await this.fillEBeyannameCaptcha(page);
        await this.submitLogin(page);
        await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(2000);
        await this.assertLoggedIn(page);
        await this.assertGenericPortalLoginResult(page);
        if (attempt > 1) {
          this.logger.log(`[GIB:${source}] Login denemesi #${attempt}/${maxAttempts} basarili`);
        }
        return;
      } catch (err: any) {
        lastError = this.compact(err?.message || err);
        this.logger.warn(`[GIB:${source}] Login denemesi #${attempt}/${maxAttempts} basarisiz: ${lastError}`);

        const retryableCaptchaError = /captcha|dogrulama|doğrulama|login formu|cozulemedi|çözülemedi/i.test(lastError);
        const missingSolver = /TWOCAPTCHA_API_KEY|2captcha in\.php/i.test(lastError);
        if (missingSolver || !retryableCaptchaError || attempt === maxAttempts) {
          throw new Error(`Vergi dairesi girisi dogrulanamadi: ${lastError}`);
        }
      }
    }

    throw new Error(`Vergi dairesi girisi dogrulanamadi: ${lastError || 'bilinmeyen hata'}`);
  }

  private async loginSgkWithCaptcha(
    page: any,
    credential: RunnerCredential,
    loginUrl: string,
    source: string,
  ) {
    const username = String(credential.username || credential.userCode || '').trim();
    const eCode = String(credential.workplaceCode || '').trim();
    const systemPassword = String(credential.password || '');
    const workplacePassword = String(credential.secondaryPassword || '');
    if (!username || !eCode || !systemPassword || !workplacePassword) {
      throw new Error('SGK kullanici adi, e-kod, sistem sifresi ve isyeri sifresi eksik');
    }

    const maxAttempts = this.gibValidationLoginAttempts();
    let lastError = '';
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (attempt > 1) {
          await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        }
        await this.waitForSgkLoginForm(page);
        await this.fillVisibleField(page, [
          '#kullaniciIlkKontrollerGiris_username',
          'input[name="username"]',
        ], username, 'SGK kullanici adi');
        await this.fillVisibleField(page, [
          '#kullaniciIlkKontrollerGiris_isyeri_kod',
          'input[name="isyeri_kod"]',
        ], eCode, 'SGK e-kod');
        await this.fillVisibleField(page, [
          '#kullaniciIlkKontrollerGiris_password',
          'input[name="password"]',
        ], systemPassword, 'SGK sistem sifresi');
        await this.fillVisibleField(page, [
          '#kullaniciIlkKontrollerGiris_isyeri_sifre',
          'input[name="isyeri_sifre"]',
        ], workplacePassword, 'SGK isyeri sifresi');
        await this.fillSgkCaptcha(page);
        await this.submitLogin(page);
        await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(1500);
        await this.assertGenericPortalLoginResult(page);
        if (attempt > 1) {
          this.logger.log(`[SGK:${source}] Login denemesi #${attempt}/${maxAttempts} basarili`);
        }
        return;
      } catch (err: any) {
        lastError = this.compact(err?.message || err);
        this.logger.warn(`[SGK:${source}] Login denemesi #${attempt}/${maxAttempts} basarisiz: ${lastError}`);

        const retryableCaptchaError = /captcha|guvenlik|güvenlik|dogrulama|doğrulama|login formu|cozulemedi|çözülemedi/i.test(lastError);
        const missingSolver = /TWOCAPTCHA_API_KEY|2captcha in\.php/i.test(lastError);
        if (missingSolver || !retryableCaptchaError || attempt === maxAttempts) {
          throw new Error(`SGK girisi dogrulanamadi: ${lastError}`);
        }
      }
    }

    throw new Error(`SGK girisi dogrulanamadi: ${lastError || 'bilinmeyen hata'}`);
  }

  private async waitForSgkLoginForm(page: any) {
    await page.waitForLoadState('domcontentloaded', { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const ready = await this.firstVisibleLocator(page, [
      '#kullaniciIlkKontrollerGiris_username',
      'input[name="username"]',
    ], 20_000);
    if (!ready) throw new Error(await this.loginFieldError(page, 'SGK kullanici adi alani bulunamadi'));
  }

  private async fillSgkCaptcha(page: any) {
    const apiKey = process.env.TWOCAPTCHA_API_KEY || process.env.TWO_CAPTCHA_API_KEY;
    if (!apiKey) {
      throw new Error('TWOCAPTCHA_API_KEY env yok; SGK CAPTCHA cozulemez');
    }

    const captchaImg = await this.firstVisibleElementHandle(page, [
      '#guvenlik_kod',
      'img[src*="/PG"]',
      'img[id*="guvenlik" i]',
      'img[src*="captcha" i]',
      'img[id*="captcha" i]',
    ], 10_000);
    if (!captchaImg) {
      throw new Error('SGK guvenlik anahtari gorseli bulunamadi');
    }

    const base64 = await this.captchaImageBase64(captchaImg);
    const captchaText = await this.solveCaptchaWith2Captcha(base64, apiKey);
    this.logger.log(`[SGK] Guvenlik anahtari cozuldu: "${captchaText}" (${captchaText.length} karakter)`);

    const captchaInput = await this.firstVisibleLocator(page, [
      '#kullaniciIlkKontrollerGiris_isyeri_guvenlik',
      'input[name="isyeri_guvenlik"]',
      'input[id*="guvenlik" i]',
      'input[name*="guvenlik" i]',
    ], 5_000);
    if (!captchaInput) {
      throw new Error('SGK guvenlik anahtari alani bulunamadi');
    }
    await captchaInput.fill(captchaText);
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

  // GIB e-Arsiv girisi — TARAYICISIZ, sadece token doner. assos-login token'i verir; liste/indirme
  //   API'si bu token'i kullanir (tarayici oturum cerezi GEREKMEZ). earsivFetch = Turkiye proxy cikisi.
  private async earsivLoginHttp(credential: RunnerCredential): Promise<string> {
    const userCode = credential.userCode || credential.username || '';
    if (!userCode) throw new Error('GIB e-Arsiv kullanici kodu eksik');
    const passwords = [credential.secondaryPassword, credential.password]
      .map((v) => String(v || '').trim())
      .filter((v, idx, arr) => v && arr.indexOf(v) === idx);
    if (!passwords.length) throw new Error('GIB e-Arsiv sifresi eksik');

    let lastError = '';
    for (const pass of passwords) {
      const body = new URLSearchParams();
      body.set('assoscmd', 'anologin');
      body.set('rtype', 'json');
      body.set('userid', userCode);
      body.set('sifre', pass);
      body.set('sifre2', pass);
      body.set('parola', '1');
      const response = await this.earsivFetch('https://earsivportal.efatura.gov.tr/earsiv-services/assos-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      const text = await response.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        lastError = `GIB e-Arsiv login JSON donmedi: HTTP ${response.status} ${this.compact(text).slice(0, 160)}`;
        continue;
      }
      if (!response.ok || data?.error || !data?.token) {
        lastError = data?.messages?.[0]?.text || data?.message || `HTTP ${response.status}`;
        continue;
      }
      return String(data.token);
    }
    throw new Error(`Portal sifresi reddedildi: ${this.compact(lastError || 'GIB e-Arsiv login basarisiz')}`);
  }

  // GIB e-Arsiv isi — tarayici acmadan (chromium yuku YOK): login token al -> liste/indirme API.
  private async runEarsivPortalJobHttp(tenantId: string, bundle: RunnerJobBundle) {
    const credential = bundle.credential;
    if (!credential.userCode || !(credential.secondaryPassword || credential.password)) {
      throw new Error('GIB e-Arsiv kullanici kodu ve sifre eksik');
    }
    const proxyOn = !!String(process.env.TURMOB_PROXY_URL || process.env.PORTAL_TR_PROXY_URL || '').trim();
    this.logger.log(`[EARSIV-ADIM] assos-login basliyor (proxy=${proxyOn ? 'acik' : 'kapali'})`);
    const tLogin = Date.now();
    const token = await this.earsivLoginHttp(credential);
    this.logger.log(`[EARSIV-ADIM] login OK ${Date.now() - tLogin}ms, token=${token ? token.length : 0}k, liste sorgusu basliyor`);

    if (bundle.job?.payload?.validationOnly === true) {
      await this.jobProgress(tenantId, bundle.job, 'validated', 'GIB e-Arsiv girisi dogrulandi.');
      return {
        documents: [],
        recordCount: 0,
        result: {
          runner: 'railway',
          phase: 'credential_validation',
          validationOnly: true,
          jobType: 'EARSIV_PORTAL_FETCH',
          notes: ['GIB e-Arsiv girisi basarili; belge taramasi yapilmadi'],
        },
      };
    }

    const earsiv = await this.collectEarsivPortalViaApi(token, bundle.job, tenantId);
    const modeLabel = bundle.job?.payload?.earsivMode === 'query' ? 'satir listelendi' : 'belge indirildi';
    await this.jobProgress(tenantId, bundle.job, 'earsiv_done', `GIB e-Arsiv sorgusu: ${earsiv.recordCount} ${modeLabel}.`);
    return earsiv;
  }

  private async finishLoginAfterFill(page: any) {
    const captchaVisible = await this.hasVisibleCaptcha(page);
    const solvedCaptcha = captchaVisible ? await this.tryAutoSolveCaptcha(page).catch(() => false) : false;
    if (captchaVisible && !solvedCaptcha) {
      throw new Error('Giris dogrulanamadi: CAPTCHA otomatik cozulemedi');
    }
    if (!solvedCaptcha) {
      await this.submitLogin(page);
    }
    await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await this.assertLoggedIn(page);
    await this.assertGenericPortalLoginResult(page);
  }

  private async hasVisibleCaptcha(page: any): Promise<boolean> {
    const selectors = [
      '#guvenlik_kod',
      'img[src*="captcha" i]',
      'img[src*="/PG"]',
      'img[id*="captcha" i]',
      'img[alt*="captcha" i]',
      'img[id*="guvenlik" i]',
      'canvas[id*="captcha" i]',
      'input[name="dk"]',
      'input[id="dk"]',
      '#kullaniciIlkKontrollerGiris_isyeri_guvenlik',
      'input[name="isyeri_guvenlik"]',
      'input[name*="captcha" i]',
      'input[id*="captcha" i]',
      'input[name*="guvenlik" i]',
      'input[id*="guvenlik" i]',
      'input[placeholder*="captcha" i]',
      'input[placeholder*="Doğrulama" i]',
      'input[placeholder*="Dogrulama" i]',
      'input[placeholder*="Güvenlik" i]',
      'input[placeholder*="Guvenlik" i]',
      '.captcha',
      '#captcha',
    ];
    for (const selector of selectors) {
      const loc = page.locator(selector).first();
      if (await loc.isVisible().catch(() => false)) return true;
    }
    const body = await this.bodyText(page);
    return TEXT.captcha.test(body) && await this.isEBeyannameLoginFormVisible(page);
  }

  private async findCaptchaVisual(page: any) {
    const selectors = [
      '#guvenlik_kod',
      'img[src*="captcha" i]',
      'img[src*="Captcha"]',
      'img[src*="/PG"]',
      'img[id*="captcha" i]',
      'img[alt*="captcha" i]',
      'img[id*="guvenlik" i]',
      'img[alt*="güvenlik" i]',
      'img[alt*="guvenlik" i]',
      'img[alt*="dogrulama" i]',
      'canvas[id*="captcha" i]',
      '.captcha img',
      '#captcha img',
      '.captcha canvas',
      '#captcha canvas',
    ];
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible().catch(() => false)) {
        const handle = await loc.elementHandle().catch(() => null);
        if (handle) return handle;
      }
    }

    const handle = await page.evaluateHandle(() => {
      const isVisible = (el: Element) => {
        const anyEl = el as HTMLElement;
        const rect = anyEl.getBoundingClientRect();
        return !!(rect.width && rect.height && (anyEl.offsetWidth || anyEl.offsetHeight || anyEl.getClientRects().length));
      };
      const captchaInput = Array.from(document.querySelectorAll<HTMLInputElement>('input'))
        .filter(isVisible)
        .find((el) => {
          const text = [
            el.name,
            el.id,
            el.placeholder,
            el.getAttribute('aria-label'),
            el.closest('label')?.textContent,
            el.parentElement?.textContent,
          ].join(' ').toLocaleLowerCase('tr-TR');
          return /captcha|dogrulama|doğrulama|guvenlik|güvenlik|güvenlik anahtari|guvenlik anahtari/.test(text);
        });
      const anchorRect = captchaInput?.getBoundingClientRect() || null;
      const candidates = Array.from(document.querySelectorAll<HTMLElement>('img, canvas'))
        .filter(isVisible)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const distance = anchorRect
            ? Math.abs(rect.left - anchorRect.left) + Math.abs(rect.top - anchorRect.top)
            : rect.top;
          return { el, rect, distance };
        })
        .filter(({ rect }) => rect.width >= 40 && rect.height >= 20 && rect.width <= 500 && rect.height <= 220)
        .sort((a, b) => a.distance - b.distance);
      return candidates[0]?.el || null;
    }).catch(() => null);
    const element = handle?.asElement?.();
    return element || null;
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

    const captchaImg = await this.findCaptchaVisual(page);
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
      'input[name="dk"]',
      'input[id="dk"]',
      '#kullaniciIlkKontrollerGiris_isyeri_guvenlik',
      'input[name="isyeri_guvenlik"]',
      'input[name*="captcha" i]',
      'input[id*="captcha" i]',
      'input[name*="guvenlik" i]',
      'input[id*="guvenlik" i]',
      'input[placeholder*="captcha" i]',
      'input[placeholder*="güvenlik" i]',
      'input[placeholder*="guvenlik" i]',
      'input[placeholder*="Doğrulama" i]',
      'input[placeholder*="Dogrulama" i]',
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
      const visibleInputs = page.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"])');
      const count = Math.min(await visibleInputs.count().catch(() => 0), 12);
      for (let i = 0; i < count; i++) {
        const inp = visibleInputs.nth(i);
        if (!(await inp.isVisible().catch(() => false))) continue;
        const type = String(await inp.getAttribute('type').catch(() => '') || '').toLowerCase();
        if (type === 'password') continue;
        const value = await inp.inputValue().catch(() => '');
        if (String(value || '').trim()) continue;
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

    // Hala CAPTCHA input/gorsel gorunuyorsa basarisiz say.
    if (await this.hasVisibleCaptcha(page)) {
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
    const captchaVisible = await this.hasVisibleCaptcha(page).catch(() => false);
    if (captchaVisible || TEXT.captcha.test(body)) {
      throw new Error('Giris dogrulanamadi: CAPTCHA cozulemedi veya portal sifreyi reddetti');
    }
    if (TEXT.loginError.test(body)) {
      const reason = alertText || 'GIB giris hata mesaji algilandi';
      throw new Error(`Portal sifresi reddedildi: ${this.compact(reason)}`);
    }
    if (loginFormVisible) {
      throw new Error('Giris dogrulanamadi: login formu hala gorunuyor');
    }
  }

  private async assertGenericPortalLoginResult(page: any) {
    const body = await this.bodyText(page);
    const passwordInputs = page.locator('input[type="password"]');
    let visiblePasswordInputs = 0;
    const count = Math.min(await passwordInputs.count().catch(() => 0), 8);
    for (let i = 0; i < count; i++) {
      if (await passwordInputs.nth(i).isVisible().catch(() => false)) visiblePasswordInputs++;
    }
    if (visiblePasswordInputs === 0) return;

    const alertText = await this.visibleAlertText(page);
    const loginLikeText = /giri[sş]|kullan[ıi]c[ıi]|sifre|şifre|parola|e-bildirge|güvenlik|guvenlik/i.test(body);
    const captchaVisible = await this.hasVisibleCaptcha(page).catch(() => false);
    if (captchaVisible || TEXT.captcha.test(body)) {
      throw new Error('Giris dogrulanamadi: CAPTCHA cozulemedi veya portal sifreyi reddetti');
    }
    if (TEXT.loginError.test(body)) {
      const reason = alertText || 'Portal giris hata mesaji algilandi';
      throw new Error(`Portal sifresi reddedildi: ${this.compact(reason)}`);
    }
    if (loginLikeText) {
      throw new Error('Giris dogrulanamadi: login formu hala gorunuyor');
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

  // ============================================================
  // YENİ e-Beyan SİSTEMİ (ebeyan.gib.gov.tr) — 2026 geçiş
  // Bir kısım beyanname eski sistemde (e-Beyanname/BDP), bir kısmı yeni
  // e-Beyan'da. "Beyannameleri Çek" eski sistemi bitirince BU zincir çalışır:
  // aynı girişli oturumdan (Dijital Vergi Dairesi) "e-Beyan" uygulamasına SSO ile
  // geçilir, /beyannameler filtrele API'sinden liste + pdf/tahakkuk uçlarından
  // PDF indirilir. Endpoint'ler canlı oturumdan yakalandı (2026-07-26).
  // Kimlik = tarayıcı oturum çerezi (token/entegratör/IP GEREKMEZ — bu web app).
  // ============================================================
  private static readonly EBEYAN_NEW_HOST = 'ebeyan.gib.gov.tr';

  /** "0015 - KDV1" → "kdv1" ; API tür segmentini beyanname kodunun kısa adından türetir. */
  private ebeyanNewTurFromKod(kod: string | null | undefined): string | null {
    const s = String(kod || '').trim();
    if (!s) return null;
    // Kısa ad genelde tire sonrası: "0015 - KDV1" → "KDV1"
    const kisa = (s.split('-').pop() || s).trim().toUpperCase();
    const map: Record<string, string> = {
      KDV1: 'kdv1', KDV2: 'kdv2', KDV2B: 'kdv2', KDV4: 'kdv4', KDV9015: 'kdv1',
      DAMGA: 'damga', DAMGAKK: 'damgakk', MUH67: 'muh67', MUHSGK: 'muhsgk',
      KONAKLAMA: 'konaklama', TURIZM: 'turizm', GELIR: 'gelir', KURUMLAR: 'kurumlar',
      BANKA: 'banka', SIGORTA: 'sigorta', YATV: 'yatv',
    };
    if (map[kisa]) return map[kisa];
    // Bilinmeyen: harf-rakam sadeleştir (canlı koşuda log'dan tamamlanır).
    const slug = kisa.toLocaleLowerCase('tr-TR').replace(/[^a-z0-9]/g, '');
    return slug || null;
  }

  /** Yeni e-Beyan "Durumu" metni → mevcut sistemdeki EBeyannameStatus. */
  private ebeyanNewStatusFromDurum(durum: string | null | undefined): EBeyannameStatus {
    const s = String(durum || '')
      .toLocaleLowerCase('tr-TR')
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (s.includes('onayla')) return 'onaylandi';
    if (s.includes('bekl')) return 'beklemede';
    if (s.includes('hatal')) return 'hatali';
    return 'onaylandi';
  }

  /** Dijital Vergi Dairesi'nden "e-Beyan" (yeni sistem) uygulamasına SSO ile geç. */
  private async openEBeyanNewApplication(context: any, page: any) {
    const HOST = PortalAutomationRailwayRunnerService.EBEYAN_NEW_HOST;
    const already = this.findOpenPageByHost(context, HOST);
    if (already) return already;

    // Dijital Vergi Dairesi ana sayfasına dön (e-Beyanname sekmesi kapanmış olabilir).
    let portalPage = (context.pages?.() || []).find((p: any) => /dijital\.gib\.gov\.tr/i.test(String(p.url?.() || ''))) || page;
    if (!portalPage || portalPage.isClosed?.() || !/dijital\.gib\.gov\.tr/i.test(String(portalPage.url?.() || ''))) {
      portalPage = await context.newPage();
      await portalPage.goto(DEFAULT_GIB_IVD_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
    }
    await portalPage.bringToFront().catch(() => {});
    await portalPage.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
    // "Geçiş Yapılabilecek Uygulamalar" kutucukları render olsun (async yükleniyor).
    await portalPage.getByText('Yapılabilecek', { exact: false }).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await portalPage.waitForTimeout(1800);

    // Popup dinleyicisini tıklamadan ÖNCE kur (tile'dan doğrudan ya da ONAYLA'dan sonra gelebilir).
    const popupListener = context.waitForEvent('page', { timeout: 30_000 }).catch(() => null);

    // "e-Beyan" kutucuğu FOLD ALTINDA + carousel KLONLARI var → getByren().first()
    // ekran dışı klona düşüyor, kaydırılamıyor. ÇÖZÜM: "Geçiş Yapılabilecek" bölümünü
    // kaydır, sonra VIEWPORT İÇİNDEKİ görünür "e-Beyan" kutucuğunun MERKEZİNE GERÇEK
    // fare tıklaması (manuel testte çalışan yöntem). Sentetik .click() SSO tetiklemiyor.
    // Carousel KLON kutucukları (aria-hidden / .slick-cloned) işlevsiz — gerçek SSO'yu
    // tetiklemiyor. ÇÖZÜM: KLON OLMAYAN "e-Beyan" kutucuğunun tıklanabilir atasını
    // işaretle → Playwright GERÇEK click (event dizisi düzgün gönderilir).
    let tileClicked = false;
    try {
      const marked = await portalPage.evaluate(() => {
        const sec = Array.from(document.querySelectorAll<HTMLElement>('*'))
          .find((el) => /Ge[cç]i[sş] Yap[iı]labilecek/i.test(el.textContent || '') && el.getClientRects().length);
        if (sec) sec.scrollIntoView({ block: 'center', inline: 'nearest' });
        const isClone = (el: HTMLElement) => {
          let n: HTMLElement | null = el;
          while (n) { const c = String(n.className || ''); if (/clone/i.test(c) || n.getAttribute?.('aria-hidden') === 'true') return true; n = n.parentElement; }
          return false;
        };
        const cands = Array.from(document.querySelectorAll<HTMLElement>('p,span,div,a,button'))
          .filter((el) => (el.textContent || '').trim() === 'e-Beyan' && el.getClientRects().length && !isClone(el));
        const inView = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.top >= 0 && r.bottom <= (window.innerHeight || 0) && r.left >= 0 && r.right <= (window.innerWidth || 0); };
        const el = cands.find(inView) || cands[0];
        if (!el) return { ok: false, count: cands.length };
        let node: HTMLElement | null = el, best: HTMLElement = el;
        for (let i = 0; i < 6 && node; i++) {
          const cls = String(node.className || '');
          let ptr = false; try { ptr = getComputedStyle(node).cursor === 'pointer'; } catch {}
          if (node.tagName === 'A' || node.tagName === 'BUTTON' || node.getAttribute('role') === 'button' || /MuiButtonBase|CardActionArea/i.test(cls) || ptr) { best = node; break; }
          if ((node.textContent || '').trim().length > 60) break;
          node = node.parentElement;
        }
        best.setAttribute('data-ebeyan-open', '1');
        best.scrollIntoView({ block: 'center', inline: 'center' });
        return { ok: true, count: cands.length };
      });
      if (marked && (marked as any).ok) {
        await portalPage.waitForTimeout(500);
        this.logger.warn(`[EBEYANNEW] klon-olmayan e-Beyan kutucugu isaretlendi (aday=${(marked as any).count}), Playwright click`);
        await portalPage.click('[data-ebeyan-open="1"]', { timeout: 8_000 }).catch(async () => {
          await portalPage.click('[data-ebeyan-open="1"]', { timeout: 5_000, force: true }).catch(() => {});
        });
        tileClicked = true;
      } else {
        this.logger.warn(`[EBEYANNEW] klon-olmayan gorunur e-Beyan kutucugu YOK (aday=${(marked as any)?.count ?? 0})`);
      }
    } catch (e: any) {
      this.logger.warn(`[EBEYANNEW] tile isaretleme/click hata: ${this.compact(e?.message || e)}`);
    }
    if (!tileClicked) {
      throw new Error(`Dijital Vergi Dairesi'nde "e-Beyan" kutucugu bulunamadi/tiklanamadi. Gorunen: ${await this.visibleActionSnapshot(portalPage)}`);
    }
    this.logger.warn('[EBEYANNEW] e-Beyan tile tiklandi');

    // "Yönlendirmeyi Onaylıyor Musunuz?" → ONAYLA (modal; ~12sn bekle, gerçek+force tıkla).
    // Kullanıcı bulgusu: tile açılınca onay dialogu çıkıyor ama tıklanamıyor olabilir.
    try {
      const onayla = portalPage.getByText('ONAYLA', { exact: false }).first();
      await onayla.waitFor({ timeout: 12_000 });
      this.logger.warn('[EBEYANNEW] ONAYLA dialogu goruldu, tiklaniyor');
      await onayla.click({ timeout: 5_000 }).catch(async () => {
        this.logger.warn('[EBEYANNEW] ONAYLA normal click basarisiz — force + koordinat deneniyor');
        await onayla.click({ timeout: 4_000, force: true }).catch(async () => {
          const b = await onayla.boundingBox().catch(() => null);
          if (b) await portalPage.mouse.click(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)).catch(() => {});
        });
      });
    } catch {
      this.logger.warn('[EBEYANNEW] ONAYLA dialogu gorunmedi (dogrudan acilmis olabilir)');
    }

    // Popup / host bekle (~25sn).
    const popup = await popupListener;
    if (popup && new RegExp(HOST, 'i').test(String(popup.url?.() || ''))) {
      await popup.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});
      await popup.bringToFront().catch(() => {});
      this.logger.warn(`[EBEYANNEW] e-Beyan popup acildi: ${this.safeUrl(popup.url())}`);
      return popup;
    }
    for (let i = 0; i < 20; i++) {
      const opened = this.findOpenPageByHost(context, HOST);
      if (opened) {
        await opened.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});
        this.logger.warn('[EBEYANNEW] e-Beyan sekmesi host ile bulundu');
        return opened;
      }
      await portalPage.waitForTimeout(1000);
    }
    throw new Error(`Yeni e-Beyan sekmesi acilmadi. portalUrl=${this.safeUrl(portalPage.url())} gorunen=${await this.visibleActionSnapshot(portalPage)}`);
  }

  /**
   * Yeni e-Beyan'dan beyanname + tahakkuk PDF'lerini çek. Mevcut kayıt altyapısını
   * (declarationFromEBeyannameRow + documents) yeniden kullanır; sonuçları çağırana
   * döndürür (persist downstream, eski akışla aynı yoldan).
   * İLK CANLI KOŞU: filtrele yanıt şekli [EBEYANNEW] ile loglanır; alan adları
   * ona göre kesinleşir. Tarih aralığı filtresi + durum sekmeleri sonraki adım.
   */
  private async collectEBeyanNewDownloads(
    tenantId: string,
    page: any,
    job: any,
    taxpayers: TaxpayerMatch[],
    notes: string[],
  ): Promise<{ declarations: any[]; documents: any[] }> {
    const HOST = PortalAutomationRailwayRunnerService.EBEYAN_NEW_HOST;
    const declarations: any[] = [];
    const documents: any[] = [];

    // filtrele yanıtlarını yakala (sayfa /beyannameler yüklenince kendisi çağırıyor).
    const captured: any[] = [];
    const respHandler = async (resp: any) => {
      try {
        const u = String(resp.url?.() || '');
        if (!/\/api\/kullanici\/beyanname\/filtrele/i.test(u)) return;
        const json = await resp.json().catch(() => null);
        if (json) captured.push(json);
      } catch { /* yoksay */ }
    };
    page.on('response', respHandler);
    try {
      // SSO login sayfası (/dijital-login?token=) token'ı işleyip ana sayfaya yönlendirsin
      // — oturum oturmadan /beyannameler'e gidersek login'e döner, filtrele hiç çağrılmaz.
      await page.waitForURL((u: any) => !/\/login|dijital-login/i.test(String(u)), { timeout: 25_000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      this.logger.warn(`[EBEYANNEW] e-Beyan oturum hazir: ${this.safeUrl(page.url())}`);

      // /beyannameler'e git ve filtrele yanıtını AÇIKÇA bekle (on('response') yedek).
      const filtrelePromise = page.waitForResponse(
        (r: any) => /\/api\/kullanici\/beyanname\/filtrele/i.test(String(r.url?.() || '')),
        { timeout: 25_000 },
      ).catch(() => null);
      await page.goto(`https://${HOST}/beyannameler`, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
      const directResp = await filtrelePromise;
      if (directResp) {
        const j = await directResp.json().catch(() => null);
        if (j) { captured.push(j); this.logger.warn('[EBEYANNEW] filtrele yaniti waitForResponse ile yakalandi'); }
      }
      // Geç gelen / ek filtrele çağrıları için biraz daha bekle.
      await page.waitForTimeout(4000);

      // Yanıttan beyanname kalemlerini çıkar (savunmacı — çeşitli olası anahtarlar).
      const items: any[] = [];
      for (const j of captured) {
        const arr = Array.isArray(j?.data?.beyannamePage?.content) ? j.data.beyannamePage.content
          : Array.isArray(j?.beyannamePage?.content) ? j.beyannamePage.content
          : Array.isArray(j?.data?.content) ? j.data.content
          : Array.isArray(j?.content) ? j.content
          : Array.isArray(j) ? j
          : Array.isArray(j?.data) ? j.data
          : Array.isArray(j?.beyannameler) ? j.beyannameler
          : Array.isArray(j?.liste) ? j.liste
          : [];
        items.push(...arr);
      }
      if (items.length) {
        const durumlar = Array.from(new Set(items.map((x) => String(x?.beyannameDurum ?? '')).filter(Boolean))).slice(0, 12);
        const ornekDonem = `${items[0]?.donemTip ?? ''}|${items[0]?.donemBaslangicTarih ?? ''}|${items[0]?.donemBitisTarih ?? ''}`;
        this.logger.warn(`[EBEYANNEW] filtrele ${items.length} kalem; anahtarlar=${Object.keys(items[0] || {}).join(',').slice(0, 300)}; durumlar=[${durumlar.join(' | ')}]; donemOrnek=${ornekDonem}`);
      } else {
        notes.push('Yeni e-Beyan: filtrele yanitindan kalem cikarilamadi (yanit sekli loglandi).');
        this.logger.warn(`[EBEYANNEW] filtrele bos/taninmadi. yakalanan=${captured.length} ornek=${this.safeDebugText(JSON.stringify(captured[0] || {})).slice(0, 400)}`);
      }

      const pick = (o: any, keys: string[]) => {
        for (const k of keys) {
          const v = o?.[k];
          if (v !== undefined && v !== null && String(v).trim() !== '') return v;
        }
        return null;
      };

      let indexed = 0;
      for (const it of items) {
        // beyannameId (65395911) — PDF ucu bunu kullanır; iç "id" (10989401) DEĞİL.
        const beyannameId = pick(it, ['beyannameId', 'beyannameID', 'beyanId', 'id']);
        // Tür kodu iç içe: beyannameTuru.kod ("KDV1") / .kisaAd
        const kod = it?.beyannameTuru?.kod || it?.beyannameTuru?.kisaAd
          || pick(it, ['beyannameKodu', 'beyannameKod', 'kod', 'beyannameKoduKisaAd']);
        const vkn = pick(it, ['mukellefVkn', 'mukellefTckn', 'vergiKimlikNo', 'vkn', 'tcKimlikNo', 'tckn', 'kimlikNo']);
        const unvan = pick(it, ['mukellefUnvan', 'unvan', 'adSoyadUnvan', 'adiSoyadiUnvani', 'adSoyad', 'mukellefAdi']);
        // Dönem alanı ikiye bölünmüş (donemBaslangicTarih / donemBitisTarih) ve tarih
        // formatında (ISO "2026-06-01" vb.) geliyor. İşlem/onay tarihi (islemTarihi)
        // DEĞİL; vergilendirme dönemi budur. ebeyannameDonemFromRow "AY/YIL - AY/YIL"
        // slash formatını beklediği için o forma çeviriyoruz — aksi halde fallback
        // olarak işin dönemi (Temmuz) yazılıyordu.
        const parseYm = (v: any): { y: number; m: number } | null => {
          if (v === undefined || v === null) return null;
          const s = String(v).trim();
          let mm = s.match(/^(\d{4})-(\d{1,2})/); // 2026-06-01 / 2026-6
          if (mm) return { y: Number(mm[1]), m: Number(mm[2]) };
          mm = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/); // 01.06.2026 / 1/6/2026
          if (mm) return { y: Number(mm[3]), m: Number(mm[2]) };
          mm = s.match(/^(\d{4})[.\/](\d{1,2})/); // 2026/06
          if (mm) return { y: Number(mm[1]), m: Number(mm[2]) };
          return null;
        };
        const ymStart = parseYm(it?.donemBaslangicTarih);
        const ymEnd = parseYm(it?.donemBitisTarih) || ymStart;
        let donemStr = pick(it, ['beyannameDonemi', 'vergilendirmeDonemi', 'donem', 'donemAralik', 'donemStr', 'donemBilgisi']);
        if (!donemStr && ymStart && ymEnd) {
          donemStr = `${String(ymStart.m).padStart(2, '0')}/${ymStart.y} - ${String(ymEnd.m).padStart(2, '0')}/${ymEnd.y}`;
        }
        const durum = pick(it, ['beyannameDurum', 'durum', 'durumu', 'beyannameDurumu', 'beyanDurum', 'beyannameDurumAd']);
        if (!beyannameId) continue;

        const tur = this.ebeyanNewTurFromKod(kod);
        const status = this.ebeyanNewStatusFromDurum(durum);

        // Sentetik satır — mevcut builder/eşleştirme altyapısını beslemek için.
        const row: EBeyannameResultRow = {
          rowIndex: indexed++,
          cells: [String(kod || ''), String(vkn || ''), String(unvan || ''), String(donemStr || ''), String(durum || '')],
          rowText: [kod, vkn, unvan, donemStr, durum].filter(Boolean).join(' '),
          beyanTipiRaw: (String(kod || '').split('-').pop() || '').trim() || null,
          mahiyetText: null,
          isCorrection: false,
          taxNumber: vkn ? String(vkn) : null,
          taxpayerName: unvan ? String(unvan) : null,
          taxOffice: null,
          taxPeriod: donemStr ? String(donemStr) : null,
          uploadTime: null,
          statusText: durum ? String(durum) : null,
        };

        // PDF'ler yalnız onaylanmışta anlamlı (tahakkuk onayla oluşur). Diğer
        // durumlarda kayıt sadece takip için (PDF'siz) — mevcut sistemle aynı.
        let beyanname: EBeyannameFilePayload | null = null;
        let tahakkuk: EBeyannameFilePayload | null = null;
        if (status === 'onaylandi' && tur) {
          beyanname = await this.ebeyanNewFetchPdf(page, tur, String(beyannameId), 'pdf', unvan, kod, notes);
          tahakkuk = await this.ebeyanNewFetchPdf(page, tur, String(beyannameId), 'pdf/tahakkuk', unvan, kod, notes);
        }

        const declaration = this.declarationFromEBeyannameRow(row, status, taxpayers, job, { beyanname, tahakkuk });
        if (declaration) {
          (declaration as any).raw = { ...((declaration as any).raw || {}), source: 'ebeyan-new-filtrele', beyannameId, beyannameKodu: kod, tur };
          declarations.push(declaration);
        } else if (beyanname || tahakkuk) {
          for (const item of [{ file: beyanname, kind: 'beyanname' as const }, { file: tahakkuk, kind: 'tahakkuk' as const }]) {
            if (!item.file) continue;
            documents.push({
              taxpayerId: null,
              belgeTuru: item.kind === 'tahakkuk' ? 'GIB_TAHAKKUK' : 'GIB_BEYANNAME',
              title: item.file.fileName,
              period: donemStr || job.periodEnd || null,
              issuedAt: job.periodEnd || null,
              receivedAt: new Date().toISOString(),
              mimeType: item.file.mimeType,
              originalName: item.file.fileName,
              base64: item.file.base64,
              raw: { runner: 'railway', source: 'ebeyan-new-filtrele', matchedTaxpayer: false, beyannameId, beyannameKodu: kod, tur, vkn, unvan },
            });
          }
        }
      }

      notes.push(`Yeni e-Beyan: ${items.length} kalem tarandi, ${declarations.length} takip kaydi, ${documents.length} eslesmeyen belge.`);
    } finally {
      page.off?.('response', respHandler);
    }
    return { declarations, documents };
  }

  /** Yeni e-Beyan PDF ucundan (GET, çerez oturumuyla) tek PDF indir → base64. */
  private async ebeyanNewFetchPdf(
    page: any,
    tur: string,
    beyannameId: string,
    suffix: 'pdf' | 'pdf/tahakkuk',
    unvan: any,
    kod: any,
    notes: string[],
  ): Promise<EBeyannameFilePayload | null> {
    const HOST = PortalAutomationRailwayRunnerService.EBEYAN_NEW_HOST;
    const url = `https://${HOST}/api/${tur}/beyanname/${suffix}?beyannameId=${encodeURIComponent(beyannameId)}`;
    try {
      const resp = await page.request.get(url, { timeout: 60_000 });
      if (!resp.ok()) {
        notes.push(`Yeni e-Beyan PDF alinamadi (${resp.status()}): ${tur}/${suffix} id=${beyannameId}`);
        return null;
      }
      const buf = await resp.body();
      if (!buf || buf.length < 500) return null;
      const kindTr = suffix === 'pdf/tahakkuk' ? 'Tahakkuk' : 'Beyanname';
      const safeUnvan = String(unvan || 'Mukellef').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);
      const fileName = `${safeUnvan}_${String(kod || '').replace(/[^A-Za-z0-9]+/g, '')}_${beyannameId}_${kindTr}.pdf`;
      return { base64: Buffer.from(buf).toString('base64'), fileName, mimeType: 'application/pdf' };
    } catch (e: any) {
      notes.push(`Yeni e-Beyan PDF hata: ${tur}/${suffix} id=${beyannameId}: ${this.compact(e?.message || e)}`);
      return null;
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

    let clicked = await this.clickEBeyannameSearchMenu(page);
    if (!clicked) {
      // 2026-08: GIB giriste bazen TAKVIM penceresi acik kaliyor (dpYear/dpMonth/d0..d30
      // gorunumu) ve menu ya gizleniyor ya da erisilemiyor. Takvimi kapatip tekrar dene;
      // menu DOM'da gizliyse gizli elemani da tikla (onclick yine calisir).
      await this.dismissEBeyannameCalendar(page, notes);
      clicked = await this.clickEBeyannameSearchMenu(page, true);
      if (clicked) notes.push('Takvim kapatildi/gizli menu tiklandi; Beyanname Ara acildi');
    }
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

  /** GİB e-Beyanname'de açık kalan takvim (datepicker) penceresini kapatmayı dener. */
  private async dismissEBeyannameCalendar(page: any, notes: string[]) {
    try {
      await page.keyboard?.press?.('Escape');
    } catch {}
    for (const target of this.ebeyannameDomTargets(page)) {
      const closed = await target.evaluate(() => {
        const isVisible = (el: Element) => {
          const anyEl = el as HTMLElement;
          return !!(anyEl.offsetWidth || anyEl.offsetHeight || anyEl.getClientRects().length);
        };
        // Takvim gerçekten açık mı? (gün hücreleri d0..d30 + setDate)
        const dayCells = Array.from(document.querySelectorAll<HTMLElement>('input[onclick*="setDate"], input[id^="d"][onclick]')).filter(isVisible);
        if (dayCells.length < 5) return false;
        // Tipik kapatma kontrolleri
        const closers = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[onclick*="closeCalendar" i], [onclick*="hideCalendar" i], [onclick*="kapat" i], img[src*="close" i], a[title*="Kapat" i], button[title*="Kapat" i]',
          ),
        ).filter(isVisible);
        if (closers.length) {
          closers[0].click();
          return true;
        }
        // Kapatıcı yoksa takvim kapsayıcısını gizle (popup div genelde gün hücrelerinin atası)
        let node: HTMLElement | null = dayCells[0];
        for (let i = 0; i < 6 && node; i++) {
          const style = window.getComputedStyle(node);
          if (style.position === 'absolute' || style.position === 'fixed' || /calendar|takvim|datepicker/i.test(node.className || '')) {
            node.style.display = 'none';
            return true;
          }
          node = node.parentElement;
        }
        return false;
      }).catch(() => false);
      if (closed) {
        notes.push('Acik takvim penceresi kapatildi');
        await page.waitForTimeout(500);
        return;
      }
    }
  }

  private async clickEBeyannameSearchMenu(page: any, allowHidden = false) {
    for (const target of this.ebeyannameDomTargets(page)) {
      const clicked = await target.evaluate((allowHiddenArg: boolean) => {
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
        const allControls = Array.from(document.querySelectorAll<HTMLElement>('span[onclick], a[onclick], button, input[type="button"], input[type="submit"]'));
        const controls = allControls.filter(isVisible);

        // Tam eşleşme: gizli olsa bile onclick tetiklenebilir (allowHidden modunda)
        const exactPool = allowHiddenArg ? allControls : controls;
        const exact = exactPool.find((el) => /beyannameAraFormu\s*\(/i.test(el.getAttribute('onclick') || ''));
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
      }, allowHidden).catch(() => false);
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

    // BİRİNCİL YOL — GERÇEK Playwright tıklaması. EBREQDBG kanıtı: sentetik event yolu
    // POST'a "sorguTipiZ=1 + durum=BOŞ" gönderiyordu (checkbox toggle'ı geri dönüyor,
    // GİB'in kendi handler'ı tetiklenmiyor) → üç durum sorgusu da AYNI filtresiz listeyi
    // okuyordu (YILMAZ hatalı beyanname "onay bekliyor" görünüyordu). Gerçek tıklama
    // GİB'in kendi kodunu çalıştırır; durum parametresi isteğe gerçekten yazılır.
    const durumValue = status === 'hatali' ? '0' : status === 'beklemede' ? '1' : '2';
    try {
      const cb = target.locator('#sorguTipiD');
      if (await cb.count()) {
        const checked = await cb.isChecked().catch(() => false);
        if (!checked) await cb.click({ timeout: 3000 });
      }
      const radio = target.locator(`input[name="durum"][value="${durumValue}"]`);
      if (await radio.count()) {
        await radio.click({ timeout: 3000, force: true });
        if (await radio.isChecked().catch(() => false)) return;
      }
    } catch { /* sentetik yedek yola düş */ }

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

      // NOT: "checked=true YAP + click DISPATCH ET" kalıbı checkbox'ı GERİ çeviriyordu
      // (sentetik click de toggle uygular) → sorguTipiD POST'a hiç gitmiyordu.
      // Doğrusu: durumu ELLE SETLEME, yalnız click() çağır (toggle + handler birlikte).
      const directStatusCheckbox = document.querySelector<HTMLInputElement>('#sorguTipiD');
      if (directStatusCheckbox && !directStatusCheckbox.checked) {
        directStatusCheckbox.click();
      }
      const directRadio = document.querySelector<HTMLInputElement>(`input[name="durum"][value="${value}"]`);
      if (directRadio) {
        directRadio.removeAttribute('disabled');
        if (!directRadio.checked) directRadio.click();
        if (!directRadio.checked) { directRadio.checked = true; fire(directRadio); }
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
        statusCheckbox.click();
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
      if (!radio.checked) radio.click();
      if (!radio.checked) { radio.checked = true; fire(radio); }
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

    // [EBREQDBG] Teşhis: bu durum sorgusunda GİB'e giden GERÇEK istek — durum parametresi
    // gidiyor mu? (Üç sorgu da aynı listeyi okuyor; radyo seçimi isteğe yansımıyor şüphesi.)
    if (this.ebeyannameCapturedListReq) {
      const req = this.ebeyannameCapturedListReq;
      notes.push(`[EBREQDBG] ${status}: ${req.method} ${this.safeUrl(req.url)} post=${this.safeDebugText(String(req.postData || '')).slice(0, 300)}`);
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
    // [EBROWDBG] Teşhis: durum filtresi gerçekten uygulanıyor mu + satırda DURUM hücresi var mı?
    // (Üç sorgu da 40'ar satır okuyunca aynı listeyi okuduğu şüphesi doğdu — YILMAZ vakası.)
    rows.slice(0, 2).forEach((row, i) => {
      notes.push(`[EBROWDBG] ${status} r${i + 1}: durum="${this.compact(row.statusText || '-')}" vkn=${row.taxNumber || '-'} yuklenme=${this.compact(row.uploadTime || '-')} cells=${this.compact(JSON.stringify(row.cells)).slice(0, 200)}`);
    });
    let duzeltilen = 0;
    let onayliAtlanan = 0;
    for (const row of rows) {
      // GERÇEK DURUM = satırın kendi DURUM hücresi (GİB durum filtresi radyosu her zaman
      // uygulanmıyor; üç sorgu da aynı listeyi okuyabiliyor — YILMAZ: hatalı beyanname
      // "onay bekliyor" sorgu etiketiyle yazılıp panelde yanlış görünüyordu).
      const rowStatus = this.ebeyannameRowStatusFromCell(row);
      if (rowStatus === 'onaylandi') { onayliAtlanan++; continue; } // onaylılar indirme sorgusunda işlenir
      const effective = rowStatus || status;
      if (rowStatus && rowStatus !== status) duzeltilen++;
      const declaration = this.declarationFromEBeyannameRow(row, effective, taxpayers, job);
      if (declaration) declarations.push(declaration);
    }
    notes.push(`${status}: ${rows.length} satir okundu, ${declarations.length} takip kaydi eslendi`
      + (duzeltilen ? `, ${duzeltilen} satir DURUM hucresinden duzeltildi` : '')
      + (onayliAtlanan ? `, ${onayliAtlanan} onayli satir atlandi` : ''));
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

  /**
   * ONAYLANDI indirme kapısı: bir satır GERÇEKTEN onaylı (indirilip BeyanKaydı yazılabilir) mı?
   * Amaç — onay bekleyen / hatalı beyannameler (yanlışlıkla onaylı listesine düşse bile) İNDİRİLMESİN.
   * Onlar yalnızca "onay bekleyen" / "hatalı" sorgusunda BİLGİ olarak takip edilir (indirme yok).
   *   - Durum metni "onay bekliyor" / "hatalı" / "iptal" ise → onaylı değil.
   *   - Onaylı beyanname HER ZAMAN bir tahakkuk fişi üretir; tahakkukOid hiç yoksa (T ikonu yok) ve
   *     durum da açıkça "onaylandı" demiyorsa → bu pending bir beyannamedir ("Tutar okunamadı"nın
   *     kaynağı; sadece beyannamesi iner, tahakkuku inmez) → indirilmez.
   * (DOM yedek yolunda tahakkukOid bilinmez; orada yalnızca durum metni denetlenir.)
   */
  /** Satırın kendi DURUM hücresinden gerçek durumu türet; hücre yok/belirsizse null. */
  private ebeyannameRowStatusFromCell(row: EBeyannameResultRow): EBeyannameStatus | null {
    const key = this.normalizeTextKey(row?.statusText || '');
    if (!key) return null;
    if (/ONAY BEKL|BEKLIYOR|BEKLEMEDE/.test(key)) return 'beklemede';
    if (/HATALI/.test(key)) return 'hatali';
    if (/ONAYLANDI/.test(key)) return 'onaylandi';
    return null;
  }

  private isApprovedDownloadableRow(row: EBeyannameResultRow, tahakkukOid?: string | null): boolean {
    const status = this.normalizeTextKey(row?.statusText || '');
    if (/BEKL/.test(status)) return false;
    if (/HATA/.test(status)) return false;
    if (/IPTAL/.test(status)) return false;
    const explicitlyApproved = /ONAYLAN/.test(status);
    if (!explicitlyApproved && tahakkukOid === null) return false;
    return true;
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
        // ONAYLI KAPISI (DOM yedek yolu): onay bekleyen/hatalı satır indirilmez; sadece bilgi olarak takip edilir.
        if (!this.isApprovedDownloadableRow(row)) {
          notes.push(`onaylandi: ${row.taxNumber || row.taxpayerName || ''} ${this.compact(row.beyanTipiRaw || '')} onaylı değil (durum=${this.compact(row.statusText || '-')}) — atlandı`);
          continue;
        }
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

  // SGK belge meta'sı (mahiyet/kanun no/çalışan/tutar) liste tablosunda YOK, PDF içinde:
  // Mahiyet -> hizmet listesi "Mahiyet : ASIL"; Kanun/Çalışan/Tutar -> tahakkuk fişi.
  // Arama: normalizeTextKey (NFD+ASCII) ile; Türkçe ö/ü/ş PDF encoding'e göre farklı çıkabilir.
  // Tutar: normalize nokta/virgülü siler -> özgün tahText'te ara; pozisyon ipucu normTah'tan.
  private async extractSgkMetaFromPdfs(tahB64?: string | null, hizB64?: string | null): Promise<{ belgeMahiyeti: string; kanunNo: string; calisan: string; tutar: string }> {
    const meta = { belgeMahiyeti: '', kanunNo: '', calisan: '', tutar: '' };
    try {
      const tahText = tahB64 ? await this.pdfTextFromBase64(tahB64).catch(() => '') : '';
      const hizText = hizB64 ? await this.pdfTextFromBase64(hizB64).catch(() => '') : '';
      const normAll = this.normalizeTextKey(`${tahText} ${hizText}`);
      const normTah = this.normalizeTextKey(tahText);
      // Mahiyet (normalized)
      const mm = normAll.match(/MAHIYET\s*:?\s*(ASIL|EK|IPTAL)/)
        || normAll.match(/5510\s*\)\s*(ASIL|EK|IPTAL)/);
      if (mm) meta.belgeMahiyeti = mm[1] === 'IPTAL' ? 'İPTAL' : mm[1];
      // Kanun no: "Belge Türü:01/05510", "05510 SAYILI KANUN", "Kanun: 05510" — başlık "(5510)" sayılmaz.
      const km = normAll.match(/BELGE\s*TURU\s*:?\s*\d+\s*\/\s*(\d{4,5})/)
        || normAll.match(/(\d{5})\s*SAYILI\s*KANUN/)
        || normAll.match(/KANUN\s*:?\s*(\d{4,5})/);
      if (km) meta.kanunNo = km[1];
      // Çalışan (normalized)
      const cm = normTah.match(/KISI\s*SAYISI\s*:?\s*(\d{1,4})/);
      if (cm) meta.calisan = cm[1];
      // Tutar = ÖDENECEK NET TUTAR.
      // GERÇEK YAPI (Railway log kanıtı): pdf-parse etiket-bloğu ile değer-bloğunu AYRI veriyor
      // ve sıraları TERS — etikette "...ÖDENECEK NET TUTAR İŞSİZLİK TUTARI", değerde "...990,90 12.799,13"
      // → pozisyonel/etiket-bitişik eşleştirme İMKANSIZ.
      // ÇÖZÜM: değer bloğu görsel-sıralı (yukarı→aşağı), ÖDENECEK NET TUTAR fişin EN ALT satırı
      // = tahakkuk metnindeki SON para değeri. Doğrulama: son = (sondan-2) + (sondan-3)
      // [NET PRİM TUTARI + İŞSİZLİK TUTARI = ÖDENECEK NET TUTAR — SGK fişi matematiği].
      const toNum = (v: string) => Number(v.replace(/\./g, '').replace(',', '.'));
      const allMoney: string[] = tahText.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g) || [];
      let dogrulandi = false;
      if (allMoney.length) {
        // ÖDENECEK NET TUTAR = NET PRİM TUTARI + İŞSİZLİK TUTARI (SGK fişi matematiği).
        // "SON para değeri" varsayımı GÜVENİLMEZ: pdf-parse değer sırası KANUN KODUNA göre
        // değişiyor — 6111 kanunlu fişte son değer "05510 SAYILI KANUNDAN DOĞAN PRİM İNDİRİMİ
        // %2" (or. 660,60) olup ödenecek net (5.615,10) yerine yazılıyordu. ÇÖZÜM: iki değerin
        // toplamına EŞİT olan EN BÜYÜK değeri (a+b≈c) ödenecek net tutar kabul et. Kanun kodu
        // ne olursa olsun ÖDENECEK NET TUTAR = en alttaki net + işsizlik toplamıdır.
        const nums = allMoney.map(toNum);
        let bestIdx = -1;
        let bestVal = -1;
        for (let k = 0; k < nums.length; k++) {
          for (let i = 0; i < nums.length; i++) {
            if (i === k) continue;
            for (let j = i + 1; j < nums.length; j++) {
              if (j === k) continue;
              if (Math.abs(nums[i] + nums[j] - nums[k]) <= 0.02 && nums[k] > bestVal) {
                bestVal = nums[k];
                bestIdx = k;
              }
            }
          }
        }
        if (bestIdx >= 0) {
          meta.tutar = allMoney[bestIdx];
          dogrulandi = true;
        } else {
          // a+b=c bulunamadı (bozuk/eksik metin) → eski davranış: son para değeri.
          meta.tutar = allMoney[allMoney.length - 1];
        }
      }

      // Geçici teşhis (doğrulama oturunca KALDIR).
      this.logger.log(`[SGKTUT] tutar=${meta.tutar || '-'} dogrulandi=${dogrulandi} son5=[${allMoney.slice(-5).join(', ')}]`);
    } catch { /* yut */ }
    return meta;
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
      // ONAYLI KAPISI: onay bekleyen/hatalı satır (yanlışlıkla listeye düşse de) indirilmez + BeyanKaydı yazılmaz.
      // Pending'de tahakkuk fişi (T ikonu/tahakkukOid) olmadığı için sadece beyannamesi inip "Tutar okunamadı"
      // satırı oluşuyordu; bu satırlar zaten "onay bekleyen" sorgusunda BİLGİ olarak takip ediliyor.
      if (!this.isApprovedDownloadableRow(row, tahakkukOid)) {
        notes.push(`liste-API: ${row.taxNumber || row.taxpayerName || ''} ${this.compact(row.beyanTipiRaw || '')} onaylı değil (durum=${this.compact(row.statusText || '-')}, tahakkuk yok) — indirilmedi, sadece bilgi`);
        continue;
      }
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
        // Menü adayları (a/span/div onclick) İLK sırada — takvim gün hücreleri (31 input)
        // listeyi doldurup asıl menüyü gizlemesin diye inputlar en sona alındı.
        return Array.from(document.querySelectorAll<HTMLElement>('a, span[onclick], div[onclick], button, select, form, input'))
          .filter(isVisible)
          .slice(0, 80)
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
