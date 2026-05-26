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

const DEFAULT_EBEYANNAME_LOGIN_URL = 'https://ebeyanname.gib.gov.tr/giris.html';
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
    if (!credential.userCode || !credential.password || !credential.secondaryPassword) {
      throw new Error('Mali musavir e-Beyanname kullanici kodu, parola ve sifre eksik');
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
      await this.fillEBeyannameLogin(page, credential.userCode, credential.password, credential.secondaryPassword);
      await this.submitLogin(page);
      await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(1500);
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

  /**
   * e-Beyanname özel indirme akışı.
   *
   * Giriş yapıldıktan sonra "Beyannamelerim" / "Onaylanan" / "Tahakkuk" gibi
   * menülere tıklayıp PDF/XML linklerini toplar. clickAndCollectPortalDocuments
   * generic indirme mantığını kullanır — link metni "indir/pdf/xml/tahakkuk/beyanname"
   * regex'i ile yakalanır.
   *
   * NOT: GİB e-Beyanname sayfası periyodik değişebilir; bu generic yaklaşım
   * her zaman çalışmayabilir. PORTAL_AUTOMATION_DOCUMENT_DOWNLOAD_SELECTOR ve
   * PORTAL_AUTOMATION_DOCUMENT_MAX_DOWNLOADS env ile tune edilebilir.
   */
  private async collectEBeyannameDownloads(
    _tenantId: string,
    page: any,
    job: any,
    downloadsPath: string,
  ): Promise<{
    declarations: any[];
    documents: any[];
    phase: string;
    notes: string[];
  }> {
    const notes: string[] = ['e-Beyanname girisi basarili'];

    // 1) Beyannameler menüsüne / onaylanan listesine gitmeyi dene
    const navTexts = [
      'Onaylanan Beyannameler',
      'Onaylanan',
      'Beyannamelerim',
      'Beyannameler',
      'Tahakkuklarim',
      'Tahakkuklarım',
      'Tahakkuk',
    ];
    const navigated = await this.tryNavigateByTexts(page, navTexts);
    notes.push(navigated ? 'Beyannameler/Tahakkuklar listesi acildi' : 'Liste menusu otomatik bulunamadi, mevcut ekranda indirilebilir aranacak');

    // 2) Tarih aralığını doldurmayı dene (varsa)
    if (job.periodStart || job.periodEnd) {
      await this.fillDateRangeIfPossible(page, job.periodStart, job.periodEnd)
        .catch((err) => notes.push(`Tarih doldurma atlandi: ${err?.message || err}`));
      await this.clickSearchIfPossible(page)
        .catch((err) => notes.push(`Sorgu butonu atlandi: ${err?.message || err}`));
    }

    // 3) Generic collector ile PDF/XML linklerini topla
    const collection = await this.clickAndCollectPortalDocuments(
      page,
      downloadsPath,
      job,
      'EBEYANNAME_DAILY_DOWNLOAD' as any,
    );
    notes.push(...collection.notes);

    // 4) Result formatına çevir — declarations + documents ayrımı
    // Şimdilik tümünü documents'a koyuyoruz; ileride PDF/XML icine bakip
    // declaration metadata'sini parse edebiliriz.
    return {
      declarations: [],
      documents: collection.documents,
      phase: 'ebeyanname_collection',
      notes,
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

  private async fillEBeyannameLogin(page: any, userCode: string, password: string, secondaryPassword: string) {
    const fields: any[] = [];
    const inputs = page.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]), textarea');
    const count = await inputs.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const loc = inputs.nth(i);
      if (await loc.isVisible().catch(() => false)) fields.push(loc);
    }

    if (fields.length >= 3) {
      await fields[0].fill(userCode);
      await fields[1].fill(password);
      await fields[2].fill(secondaryPassword);
      return;
    }

    await this.fillFirst(page, [
      'input[name*="kullanici" i]',
      'input[id*="kullanici" i]',
      'input[name*="user" i]',
      'input[id*="user" i]',
      'input[name*="kod" i]',
      'input[id*="kod" i]',
    ], userCode);

    const passwordFields = page.locator('input[type="password"]');
    const passwordCount = await passwordFields.count().catch(() => 0);
    if (passwordCount >= 2) {
      await passwordFields.nth(0).fill(password);
      await passwordFields.nth(1).fill(secondaryPassword);
      return;
    }
    if (passwordCount === 1) {
      await passwordFields.nth(0).fill(password);
      await this.fillFirst(page, [
        'input[name*="sifre" i]:not([type="password"])',
        'input[id*="sifre" i]:not([type="password"])',
        'input[name*="şifre" i]:not([type="password"])',
        'input[id*="şifre" i]:not([type="password"])',
      ], secondaryPassword);
      return;
    }

    throw new Error('e-Beyanname giris alanlari bulunamadi');
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
      const loc = page.locator(selector).f