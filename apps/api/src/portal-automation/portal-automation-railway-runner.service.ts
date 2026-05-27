import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { chromium as pwChromium } from 'playwright-core';
import { mkdir, readFile, rm } from 'fs/promises';
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

  private async runEBeyanname(tenantId: string, bundle: RunnerJobBundle) {
    const credential = bundle.credential;
    // YENI GIB UI'sinda 2. parola tamamen kaldirildi (2026 Dijital Vergi Dairesi gecisi).
    // Sadece kullanici kodu + sifre yeterli. secondaryPassword artik kullanilmiyor.
    if (!credential.userCode || !credential.password) {
      throw new Error('Mali musavir e-Beyanname kullanici kodu ve sifre eksik');
    }

    const loginUrl = process.env.PORTAL_AUTOMATION_EBEYANNAME_LOGIN_URL || DEFAULT_EBEYANNAME_LOGIN_URL;
    const downloadsPath = join(tmpdir(), `moren-ebeyanname-${randomUUID()}`);
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
      await page.waitForTimeout(2000); // Vue/React app yuklensin
      // Yeni GIB UI'sinda CAPTCHA login form'unun ICINDE → submit'ten ONCE doldur
      await this.fillEBeyannameLogin(page, credential.userCode, credential.password);
      await this.fillEBeyannameCaptcha(page);
      await this.submitLogin(page);
      await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(2000);
      await this.assertLoggedIn(page);

      const collection = await this.collectEBeyannameDownloads(tenantId, page, bundle.job, downloadsPath);
      await context.close().catch(() => {});

      return {
        declarations: collection.declarations,
        documents: collection.documents,
        recordCount: collection.declarations.length + collection.documents.length,
        result: {
          runner: 'railway',
          phase: collection.phase,
          url: this.safeUrl(page.url()),
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
    // Kesin selector'lar — yeni UI'da name/id ayni: userid, sifre, dk
    const userInput = page.locator('input[name="userid"], input[id="userid"]').first();
    await userInput.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => null);
    if (!(await userInput.isVisible().catch(() => false))) {
      throw new Error('Kullanici kodu alani bulunamadi (userid)');
    }
    await userInput.fill(userCode);

    const passwordInput = page.locator('input[name="sifre"], input[id="sifre"], input[type="password"]').first();
    if (!(await passwordInput.isVisible().catch(() => false))) {
      throw new Error('Sifre alani bulunamadi (sifre)');
    }
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
    const captchaImg = await page.$('img[alt="captchaImg"], img[alt*="captcha" i]').catch(() => null);
    if (!captchaImg) {
      throw new Error('CAPTCHA gorsel bulunamadi (img[alt="captchaImg"])');
    }
    let base64: string;
    try {
      const buffer = await captchaImg.screenshot({ type: 'png' });
      base64 = buffer.toString('base64');
    } catch (err: any) {
      throw new Error(`CAPTCHA screenshot hata: ${err?.message || err}`);
    }

    const captchaText = await this.solveCaptchaWith2Captcha(base64, apiKey);
    this.logger.log(`[eBeyanname] CAPTCHA cozuldu: "${captchaText}" (${captchaText.length} karakter)`);

    // "dk" (Dogrulama Kodu) input'una yaz
    const dkInput = page.locator('input[name="dk"], input[id="dk"]').first();
    if (!(await dkInput.isVisible().catch(() => false))) {
      throw new Error('Dogrulama kodu (dk) alani bulunamadi');
    }
    await dkInput.fill(captchaText);
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
    if (TEXT.captcha.test(body)) {
      // CAPTCHA tespit → 2captcha ile otomatik cozum dene
      const solved = await this.tryAutoSolveCaptcha(page);
      if (!solved) {
        throw new Error('GIB CAPTCHA istedi, 2captcha cozumu basarisiz (TWOCAPTCHA_API_KEY var mi/kredi yeterli mi?)');
      }
      // Cozulduyse devam et — recursive bir kez daha kontrol
      const body2 = await this.bodyText(page);
      if (TEXT.captcha.test(body2)) {
        throw new Error('CAPTCHA cozuldu ama hala CAPTCHA gorunuyor; site UI degismis olabilir');
      }
    }
    if (TEXT.loginError.test(body)) {
      throw new Error('e-Beyanname girisi basarisiz gorunuyor; kullanici kodu/parola/sifre veya ek dogrulama kontrol edilmeli');
    }
    const visibleFields = await page
      .locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"])')
      .evaluateAll((els: any[]) => els.filter((el) => {
        const r = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      }).length)
      .catch(() => 0);
    if (visibleFields >= 3 && /kullanici|kullanıcı|parola|sifre|şifre/i.test(body)) {
      throw new Error('e-Beyanname giris ekrani gecilemedi');
    }
  }

  private async collectEBeyannameDownloads(tenantId: string, page: any, job: any, downloadsPath: string) {
    const notes: string[] = [];
    const declarations: any[] = [];
    const documents: any[] = [];
    const taxpayers = await this.loadTaxpayers(tenantId);

    const listUrl = process.env.PORTAL_AUTOMATION_EBEYANNAME_LIST_URL;
    if (listUrl) {
      await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(1000);
      notes.push('Liste URL env ile acildi');
    } else {
      const navigated = await this.tryNavigateToDeclarationList(page);
      notes.push(navigated ? 'Beyanname liste ekrani metinle acildi' : 'Beyanname liste ekrani otomatik bulunamadi');
    }

    await this.fillDateRangeIfPossible(page, job.periodStart, job.periodEnd).catch((err) => notes.push(`Tarih doldurma atlandi: ${err?.message || err}`));
    await this.clickSearchIfPossible(page).catch((err) => notes.push(`Sorgu butonu atlandi: ${err?.message || err}`));

    const downloaded = await this.clickAndCollectDownloadLinks(page, downloadsPath, taxpayers, job);
    declarations.push(...downloaded.declarations);
    documents.push(...downloaded.documents);
    notes.push(...downloaded.notes);

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
    for (const selector of selectors) {
      const loc = page.locator(selector).first();
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

  private safeUrl(url: string) {
    return String(url || '').replace(/([?&](?:password|sifre|parola|token|kod)=)[^&]+/gi, '$1***');
  }

  private safeFileName(value: string) {
    return String(value || 'download.bin').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  }
}
