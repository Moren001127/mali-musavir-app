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

const JOB_TYPES_DEFAULT: PortalJobType[] = ['EBEYANNAME_DAILY_DOWNLOAD'];

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
    return !!process.env.RAILWAY_ENVIRONMENT;
  }

  private includeNightly() {
    return this.envFlag(process.env.PORTAL_AUTOMATION_RAILWAY_RUNNER_INCLUDE_NIGHTLY);
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
      throw new Error(`${job.jobType} icin Railway runner henuz etkin degil`);
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

  private async assertLoggedIn(page: any) {
    const body = await this.bodyText(page);
    if (TEXT.captcha.test(body)) {
      throw new Error('GIB ek dogrulama/CAPTCHA istedi; Railway headless runner tek basina gecemedi');
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
      throw new Error(
        `Railway e-Beyanname girisi basarili; ancak onceki gun beyanname/tahakkuk indirme linkleri bulunamadi. URL=${this.safeUrl(page.url())}`,
      );
    }

    return {
      phase: 'download_collected',
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
    const max = Math.max(1, Math.min(20, Number(process.env.PORTAL_AUTOMATION_EBEYANNAME_MAX_DOWNLOADS || 8)));
    const selector = process.env.PORTAL_AUTOMATION_EBEYANNAME_DOWNLOAD_SELECTOR || 'a, button, input[type="button"], input[type="submit"]';
    const candidates = page.locator(selector);
    const count = Math.min(await candidates.count().catch(() => 0), 200);
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

      if (taxpayerId) {
        declarations.push({
          taxpayerId,
          beyanTipi: this.guessBeyanTipi(contextText),
          donem: job.donem || this.inferDonem(job.periodEnd),
          beyanTarihi: job.periodEnd || new Date().toISOString(),
          beyannameBase64: kind === 'beyanname' ? base64 : null,
          tahakkukBase64: kind === 'tahakkuk' ? base64 : null,
          xmlBase64: kind === 'xml' ? base64 : null,
          beyannameFileName: kind === 'beyanname' ? suggested : null,
          tahakkukFileName: kind === 'tahakkuk' ? suggested : null,
          raw: { runner: 'railway', rowText: this.compact(meta?.rowText || ''), fileName: suggested },
        });
      } else {
        documents.push({
          taxpayerId: null,
          belgeTuru: kind === 'tahakkuk' ? 'GIB_TAHAKKUK' : kind === 'xml' ? 'GIB_XML' : 'GIB_BEYANNAME',
          title: suggested || 'e-Beyanname belgesi',
          period: job.donem || this.inferDonem(job.periodEnd),
          issuedAt: job.periodEnd || null,
          receivedAt: new Date().toISOString(),
          mimeType: this.mimeFromName(suggested),
          originalName: suggested,
          base64,
          raw: { runner: 'railway', rowText: this.compact(meta?.rowText || ''), matchedTaxpayer: false },
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
    return null;
  }

  private guessDownloadKind(text: string) {
    if (/xml/i.test(text)) return 'xml';
    if (/tahakkuk|fis|fiş/i.test(text)) return 'tahakkuk';
    return 'beyanname';
  }

  private guessBeyanTipi(text: string) {
    const upper = text.toLocaleUpperCase('tr-TR');
    const known = ['KDV1', 'KDV2', 'KDV2B', 'KDV4', 'MUHSGK', 'MUHTASAR', 'KURUMLAR', 'GECICI', 'GEÇICI', 'DAMGA', 'BA_BS'];
    return known.find((k) => upper.includes(k)) || 'EBEYANNAME';
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
