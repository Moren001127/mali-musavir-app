import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { chromium as pwChromium } from 'playwright-core';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PortalAutomationService, PortalJobType } from './portal-automation.service';

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

// GIB 2026'da e-Beyanname'yi Dijital Vergi Dairesi portali altinda topladi.
// Eski URL (ebeyanname.gib.gov.tr/giris.html) artik ana sayfaya redirect ediyor.
const DEFAULT_EBEYANNAME_LOGIN_URL = 'https://dijital.gib.gov.tr/portal/login';
const DEFAULT_GIB_IVD_LOGIN_URL = 'https://dijital.gib.gov.tr/';
const DEFAULT_SGK_LOGIN_URL = 'https://uyg.sgk.gov.tr/';

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

  constructor(
    private prisma: PrismaService,
    private portalAutomation: PortalAutomationService,
  ) {}

  onModuleInit() {
    if (!this.isEnabled()) return;
    this.logger.log(
      `[PortalRailwayRunner] aktif: device=${this.deviceId}, jobs=${this.enabledJobTypes().join(',')}, nightly=${this.includeNightly()}`,
    );
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
    return (this.prisma as any).portalAutomationJob.findMany({
      where,
      include: { taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true } } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: this.maxJobsPerTick(),
    });
  }

  private async failStaleRunnerJobs() {
    const minutes = Math.max(10, Number(process.env.PORTAL_AUTOMATION_RAILWAY_RUNNER_TIMEOUT_MIN || 45));
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    await (this.prisma as any).portalAutomationJob.updateMany({
      where: {
        status: 'running',
        targetDeviceId: this.deviceId,
        startedAt: { lt: cutoff },
      },
      data: {
        status: 'failed',
        errorMessage: `Railway runner zaman asimi (${minutes} dk)`,
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

    const browser = await pwChromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROMIUM_PATH,
      headless: true,
      downloadsPath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
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
      const page = await context.newPage();
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

      return {
        declarations: collection.declarations,
        documents: collection.documents,
        recordCount: collection.declarations.length + collection.documents.length,
        result: {
          runner: 'railway',
          phase: collection.phase,
          url: this.safeUrl(eBeyannamePage.url()),
          declarations: collection.declarations.length,
          documents: collection.documents.length,
          notes: collection.notes,
        },
      };
    } finally {
      await browser.close().catch(() => {});
      await rm(downloadsPath, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async runPortalDocumentJob(tenantId: string, bundle: RunnerJobBundle) {
    const jobType = bundle.job.jobType as PortalJobType;
    const credential = bundle.credential;
    const isSgk = jobType.startsWith('SGK_');

    if (isSgk) {
      if (!(credential.username || credential.userCode) || !credential.password || !credential.secondaryPassword) {
        throw new Error('SGK kullanici/e-kod, sistem sifresi ve isyeri sifresi eksik');
      }
    } else if (!credential.userCode || !credential.password || !credential.secondaryPassword) {
      throw new Error('Vergi dairesi kullanici kodu, parola ve sifre eksik');
    }

    const loginUrl = this.loginUrlForJob(jobType);
    const downloadsPath = join(tmpdir(), `moren-portal-doc-${randomUUID()}`);
    await mkdir(downloadsPath, { recursive: true });

    const browser = await pwChromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROMIUM_PATH,
      headless: true,
      downloadsPath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
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
        credential.password || '',
        credential.secondaryPassword || '',
        credential.workplaceCode || '',
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
    const taxpayers = await this.loadTaxpayers(tenantId);

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
      declarations.push(...collected.declarations);
      documents.push(...collected.documents);
      const added = declarations.length + documents.length - beforeCount;
      await this.jobProgress(tenantId, job, `status_${item.status}_done`, `${item.label} sorgusu tamamlandi: ${added} kayit eklendi.`, {
        records: declarations.length + documents.length,
      });

      if (item.status !== 'onaylandi') {
        await this.closeEBeyannameResultList(page).catch((err) => {
          notes.push(`${item.label} listesi kapatilamadi: ${this.compact(err?.message || err)}`);
        });
      }
    }

    if (!declarations.length && !documents.length) {
      notes.push(`Indirilecek beyanname/tahakkuk bulunamadi. URL=${this.safeUrl(page.url())}`);
    }

    return {
      phase: declarations.length || documents.length ? 'download_collected' : 'no_records',
      declarations,
      documents,
      notes,
    };
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
      return { declarations, documents };
    }

    if (!(await this.hasEBeyannameResultList(page))) {
      notes.push(`${status}: liste acilmadi, sonuc yok kabul edildi. URL=${this.safeUrl(page.url())}`);
      await this.jobProgress(tenantId, job, `status_${status}_empty`, `${this.ebeyanStatusLabel(status)} listesi acilmadi, kayit yok kabul edildi.`);
      return { declarations, documents };
    }

    if (downloadApproved) {
      const approved = await this.collectApprovedEBeyannamePages(tenantId, page, downloadsPath, taxpayers, job, notes);
      declarations.push(...approved.declarations);
      documents.push(...approved.documents);
      return { declarations, documents };
    }

    const rows = await this.collectStatusOnlyEBeyannamePages(page, status, notes);
    for (const row of rows) {
      const declaration = this.declarationFromEBeyannameRow(row, status, taxpayers, job);
      if (declaration) declarations.push(declaration);
    }
    notes.push(`${status}: ${rows.length} satir okundu, ${declarations.length} takip kaydi eslendi`);
    return { declarations, documents };
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
      return Array.from(table.querySelectorAll('tr'))
        .map((tr) => ({
          cells: Array.from(tr.querySelectorAll('td, th')).map((cell) => (cell as HTMLElement).innerText.replace(/\s+/g, ' ').trim()),
          rowText: (tr as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
        }))
        .filter((row) => /\b\d{10,11}\b/.test(row.rowText) && !norm(row.rowText).includes('VERGI KIMLIK NUMARASI'));
    }).catch(() => []);

    return rawRows.map((row: any, rowIndex: number) => this.normalizeEBeyannameResultRow(row, rowIndex));
  }

  private normalizeEBeyannameResultRow(raw: { cells: string[]; rowText: string }, rowIndex: number): EBeyannameResultRow {
    const cells = (raw.cells || []).map((cell) => String(cell || '').trim()).filter(Boolean);
    const taxIndex = cells.findIndex((cell) => /\b\d{10,11}\b/.test(cell));
    const taxNumber = taxIndex >= 0 ? (cells[taxIndex].match(/\b\d{10,11}\b/) || [null])[0] : null;
    const beyanTipiRaw = taxIndex > 0 ? cells[taxIndex - 1] : cells.find((cell) => /KDV|MUH|DAMGA|GECICI|GE[CÇ]ICI|KURUMLAR|GELIR|OTV|OIV|POSET/i.test(cell)) || null;
    const taxpayerName = taxIndex >= 0 ? cells[taxIndex + 1] || null : null;
    const taxOffice = taxIndex >= 0 ? cells[taxIndex + 2] || null : null;
    const taxPeriod = cells.find((cell) => /\b\d{2}\/\d{4}\s*-\s*\d{2}\/\d{4}\b/.test(cell)) || null;
    const uploadTime = cells.find((cell) => /\b\d{2}\.\d{2}\.\d{4}\b/.test(cell)) || null;
    const statusText = cells.find((cell) => /onay|hata|bekl|iptal/i.test(this.normalizeTextKey(cell))) || null;

    return {
      rowIndex,
      cells,
      rowText: raw.rowText,
      beyanTipiRaw,
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

    const beyanTipi = this.guessBeyanTipi(row.beyanTipiRaw || row.rowText);
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
        cells: row.cells,
        beyanTipiRaw: row.beyanTipiRaw,
        taxNumber: row.taxNumber,
        taxpayerName: row.taxpayerName,
        taxOffice: row.taxOffice,
        taxPeriod: row.taxPeriod,
        uploadTime: row.uploadTime,
      },
    };
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
    const maxRows = Math.max(1, Math.min(3000, Number(process.env.PORTAL_AUTOMATION_EBEYANNAME_MAX_APPROVED_ROWS || 1000)));
    let processedRows = 0;
    let pageNo = 0;

    while (processedRows < maxRows && pageNo < 120) {
      pageNo++;
      const rows = await this.parseEBeyannameResultRows(page);
      notes.push(`onaylandi sayfa ${pageNo}: ${rows.length} satir`);
      await this.jobProgress(tenantId, job, 'approved_page', `Onaylandi listesi sayfa ${pageNo}: ${rows.length} satir okunuyor.`, {
        current: pageNo,
        records: processedRows,
      });

      for (const row of rows) {
        if (processedRows >= maxRows) break;
        processedRows++;
        if (processedRows === 1 || processedRows % 10 === 0) {
          await this.jobProgress(tenantId, job, 'approved_download', `Onaylandi belgeler indiriliyor: ${processedRows}. satir.`, {
            records: processedRows,
          });
        }
        const beyanname = await this.downloadEBeyannameRowFile(page, row.rowIndex, 'beyanname', downloadsPath, processedRows, notes);
        const tahakkuk = await this.downloadEBeyannameRowFile(page, row.rowIndex, 'tahakkuk', downloadsPath, processedRows, notes);
        const declaration = this.declarationFromEBeyannameRow(row, 'onaylandi', taxpayers, job, { beyanname, tahakkuk });

        if (declaration) {
          declarations.push(declaration);
          continue;
        }

        for (const file of [beyanname, tahakkuk].filter(Boolean) as EBeyannameFilePayload[]) {
          documents.push({
            taxpayerId: null,
            belgeTuru: file === tahakkuk ? 'GIB_TAHAKKUK' : 'GIB_BEYANNAME',
            title: file.fileName,
            period: this.ebeyannameDonemFromRow(row, this.guessBeyanTipi(row.beyanTipiRaw || row.rowText), job),
            issuedAt: this.parseEBeyannameUploadTime(row.uploadTime) || job.periodEnd || null,
            receivedAt: new Date().toISOString(),
            mimeType: file.mimeType,
            originalName: file.fileName,
            base64: file.base64,
            raw: {
              runner: 'railway',
              source: 'ebeyanname-beyanname-ara',
              matchedTaxpayer: false,
              rowText: this.compact(row.rowText),
              taxNumber: row.taxNumber,
              taxpayerName: row.taxpayerName,
            },
          });
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

    notes.push(`onaylandi: ${processedRows} satir islendi, ${declarations.length} takip kaydi eslendi, ${documents.length} eslesmeyen belge`);
    return { declarations, documents };
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
    rowIndex: number,
    kind: 'beyanname' | 'tahakkuk',
    downloadsPath: string,
    sequence: number,
    notes: string[],
  ): Promise<EBeyannameFilePayload | null> {
    const target = await this.findEBeyannameResultTarget(page) || page;
    const row = target.locator('tr').filter({ hasText: /\b\d{10,11}\b/ }).nth(rowIndex);
    if (!(await row.isVisible().catch(() => false))) {
      notes.push(`${kind}: satir ${rowIndex + 1} gorunur degil`);
      return null;
    }

    const candidates = row.locator('a, button, input[type="button"], input[type="image"], img');
    const count = await candidates.count().catch(() => 0);
    const metas: Array<{ index: number; tag: string; text: string; haystack: string }> = [];
    for (let i = 0; i < count; i++) {
      const meta = await candidates.nth(i).evaluate((el: any) => {
        const tag = String(el.tagName || '').toUpperCase();
        const text = `${el.innerText || el.value || el.alt || el.title || el.getAttribute?.('aria-label') || ''}`.trim();
        const haystack = [
          text,
          el.getAttribute?.('href') || '',
          el.getAttribute?.('src') || '',
          el.getAttribute?.('onclick') || '',
          el.getAttribute?.('title') || '',
          el.getAttribute?.('alt') || '',
          el.outerHTML || '',
        ].join(' ');
        return { tag, text, haystack: haystack.slice(0, 1200) };
      }).catch(() => null);
      if (meta) metas.push({ index: i, ...meta });
    }

    const picked = this.pickEBeyannameFileCandidate(metas, kind);
    if (picked == null) {
      notes.push(`${kind}: satir ${rowIndex + 1} icin PDF ikonu bulunamadi`);
      return null;
    }

    const loc = candidates.nth(picked);
    const clicked = await this.captureEBeyannameDownload(page, loc, downloadsPath, `ebeyanname-${sequence}-${kind}`);
    if (!clicked) {
      notes.push(`${kind}: satir ${rowIndex + 1} tiklandi ama PDF alinamadi`);
      return null;
    }
    return clicked;
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

    const downloadPromise = page.waitForEvent('download', { timeout: 15_000 })
      .then((download: any) => ({ type: 'download', value: download }))
      .catch(() => null);
    const popupPromise = page.context().waitForEvent('page', { timeout: 10_000 })
      .then((popup: any) => ({ type: 'popup', value: popup }))
      .catch(() => null);

    await loc.click({ timeout: 8_000 }).catch(() => null);
    const event: any = await Promise.race([
      downloadPromise,
      popupPromise,
      this.wait(15_000).then(() => null),
    ]);

    if (event?.type === 'download') {
      return this.savePlaywrightDownload(event.value, downloadsPath, fallbackName);
    }

    if (event?.type === 'popup') {
      return this.savePdfFromPopup(event.value, downloadsPath, fallbackName);
    }

    const afterUrl = String(page.url?.() || '');
    if (afterUrl && afterUrl !== beforeUrl) {
      const saved = await this.savePdfFromPageUrl(page, downloadsPath, fallbackName).catch(() => null);
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});
      return saved;
    }

    return null;
  }

  private async savePlaywrightDownload(download: any, downloadsPath: string, fallbackName: string): Promise<EBeyannameFilePayload> {
    const suggested = await download.suggestedFilename().catch(() => `${fallbackName}.pdf`);
    const fileName = this.safeFileName(suggested || `${fallbackName}.pdf`);
    const filePath = join(downloadsPath, `${randomUUID()}-${fileName}`);
    await download.saveAs(filePath);
    const buffer = await readFile(filePath);
    return { base64: buffer.toString('base64'), fileName, mimeType: this.mimeFromName(fileName) };
  }

  private async savePdfFromPopup(popup: any, downloadsPath: string, fallbackName: string): Promise<EBeyannameFilePayload | null> {
    try {
      await popup.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
      const popupDownload = await popup.waitForEvent('download', { timeout: 3_000 }).catch(() => null);
      if (popupDownload) return await this.savePlaywrightDownload(popupDownload, downloadsPath, fallbackName);
      return await this.savePdfFromPageUrl(popup, downloadsPath, fallbackName);
    } finally {
      await popup.close?.().catch(() => {});
    }
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

    if (!buffer || buffer.length < 200) return null;
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
      const isDisabled = (el: any) => !!el.disabled || /\bdisabled\b/i.test(String(el.className || '')) || el.getAttribute?.('aria-disabled') === 'true';
      const isVisible = (el: Element) => {
        const anyEl = el as HTMLElement;
        return !!(anyEl.offsetWidth || anyEl.offsetHeight || anyEl.getClientRects().length);
      };
      const controls = Array.from(document.querySelectorAll<HTMLElement>('button, input[type="button"], input[type="submit"], a'));
      const target = controls.find((el: any) => {
        const text = `${el.textContent || ''} ${el.value || ''} ${el.getAttribute?.('title') || ''}`.replace(/\s+/g, '').trim();
        return isVisible(el) && !isDisabled(el) && text === '>>';
      });
      if (!target) return false;
      target.click();
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
    const text = String(row.taxPeriod || '');
    const match = text.match(/\b(0?[1-9]|1[0-2])\/(20\d{2})\s*-\s*(0?[1-9]|1[0-2])\/(20\d{2})\b/);
    if (!match) return fallback;
    const startMonth = Number(match[1]);
    const startYear = Number(match[2]);
    const endMonth = Number(match[3]);
    const endYear = Number(match[4]);
    if (!startYear || !endYear) return fallback;
    if (startYear !== endYear) return `${endYear}-YIL`;
    if (beyanTipi === 'KURUMLAR' || beyanTipi === 'GELIR') return `${startYear}-YIL`;
    if (endMonth - startMonth >= 2 || /GECICI/.test(beyanTipi)) {
      return `${endYear}-Q${Math.ceil(endMonth / 3)}`;
    }
    return `${endYear}-${String(endMonth).padStart(2, '0')}`;
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
      const taxNumber = (taxpayer.taxNumber || '').replace(/\D/g, '');
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
    return null;
  }

  private guessDownloadKind(text: string) {
    const key = this.normalizeTextKey(text);
    if (/\bXML\b/.test(key)) return 'xml';
    if (/TAHAKKUK|FIS/.test(key)) return 'tahakkuk';
    if (/xml/i.test(text)) return 'xml';
    if (/tahakkuk|fis|fiş/i.test(text)) return 'tahakkuk';
    return 'beyanname';
  }

  private guessBeyanTipi(text: string) {
    const key = this.normalizeTextKey(text);
    if (/\bKDV\s*1\b|KDV1|KDVBEYANNAMESI/.test(key)) return 'KDV1';
    if (/\bKDV\s*2\b|KDV2|TEVKIFAT/.test(key)) return 'KDV2';
    if (/MUHSGK|MUHTASAR|MUHTASARPRIM|PRIMHIZMET/.test(key)) return 'MUHSGK';
    if (/DAMGA/.test(key)) return 'DAMGA';
    if (/POSET|GEKAP/.test(key)) return 'POSET';
    if (/KURUMLAR/.test(key)) return 'KURUMLAR';
    if (/GELIR/.test(key)) return 'GELIR';
    if (/GECICI/.test(key)) return 'GECICI_VERGI';
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

  private safeFileName(value: string) {
    return String(value || 'download.bin').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  }
}
