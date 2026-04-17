/**
 * Luca Otomatik Scraper — Playwright ile headless Chromium açıp Luca'ya
 * kaydedilmiş kullanıcı adı/şifre ile login olur ve muavin defter Excel'ini
 * indirir.
 *
 * Bu servis `LucaService.fetchMuavinDirect` yerine çalışır. Kullanıcı
 * portal > Ayarlar > Luca Hesabı kısmına username/password girdiğinde
 * aktif olur.
 *
 * NOT: Luca web arayüzü DOM'u zaman zaman değişebilir. Selector'lar
 * sabit olarak `SELECTORS` altında tutuluyor — gerçek Luca ile ilk
 * çalıştırmada hata gelirse keşif yapıp güncellenir.
 */
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encrypt, decrypt, tryDecrypt } from '../common/crypto';

// Dinamik import — Playwright kurulu değilse servis başlatılabilsin
type PwBrowser = any;
type PwContext = any;
type PwPage = any;

const LUCA_URLS = {
  login: 'https://web.luca.net.tr/',
  // Muavin defter ekranı — Luca tarafında keşfedilecek
  muavin: 'https://web.luca.net.tr/Muhasebe/MuavinDefter',
};

// Luca DOM selector'ları — keşifle kesinleştirilecek
const SELECTORS = {
  loginUsername: 'input[name="username"], input#username, input[type="text"]:first-of-type',
  loginPassword: 'input[name="password"], input#password, input[type="password"]',
  loginSubmit: 'button[type="submit"], input[type="submit"], button:has-text("Giriş")',
  mukellefSelect: 'select[name="mukellef"], #mukellefSelect, select:has-text("Mükellef")',
  donemSelect: 'select[name="donem"], #donemSelect',
  hesapInput: 'input[name="hesap"], input[placeholder*="hesap" i]',
  raporListele: 'button:has-text("Listele"), button:has-text("Rapor")',
  excelButton: 'button:has-text("Excel"), a[href*=".xlsx"], a:has-text("Excel"), .excel-icon, button[title*="Excel" i]',
};

@Injectable()
export class LucaAutoScraperService {
  private readonly logger = new Logger(LucaAutoScraperService.name);

  constructor(private prisma: PrismaService) {}

  // ==================== CREDENTIAL YÖNETİMİ ====================

  async saveCredential(tenantId: string, username: string, password: string, updatedBy?: string) {
    if (!username || !password) {
      throw new BadRequestException('Kullanıcı adı ve şifre zorunlu');
    }
    const encryptedPassword = encrypt(password);
    return (this.prisma as any).lucaCredential.upsert({
      where: { tenantId },
      update: {
        username,
        encryptedPassword,
        // Yeni şifre geldiğinde cache'lenmiş cookie'leri sıfırla
        encryptedCookies: null,
        cookiesExpiresAt: null,
        lastError: null,
        updatedBy: updatedBy || null,
      },
      create: {
        tenantId,
        username,
        encryptedPassword,
        updatedBy: updatedBy || null,
      },
      select: {
        id: true,
        username: true,
        isActive: true,
        lastLoginAt: true,
        lastError: true,
        updatedAt: true,
      },
    });
  }

  async getCredentialStatus(tenantId: string) {
    const c = await (this.prisma as any).lucaCredential.findUnique({
      where: { tenantId },
      select: {
        username: true,
        isActive: true,
        lastLoginAt: true,
        lastError: true,
        cookiesExpiresAt: true,
        updatedAt: true,
      },
    });
    if (!c) return { connected: false };
    const hasCachedSession =
      c.cookiesExpiresAt && new Date(c.cookiesExpiresAt) > new Date();
    return {
      connected: true,
      username: c.username,
      isActive: c.isActive,
      lastLoginAt: c.lastLoginAt,
      lastError: c.lastError,
      hasCachedSession,
      updatedAt: c.updatedAt,
    };
  }

  async deleteCredential(tenantId: string) {
    await (this.prisma as any).lucaCredential.deleteMany({ where: { tenantId } });
    return { deleted: true };
  }

  /**
   * Yalnızca login dener, başarılı olursa cookie'leri cache'ler.
   * UI'daki "Bağlantıyı Test Et" butonu bunu çağırır.
   */
  async testLogin(tenantId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.ensureSession(tenantId);
      return { ok: true };
    } catch (e: any) {
      await this.markError(tenantId, e?.message || 'Login başarısız');
      return { ok: false, error: e?.message || 'Login başarısız' };
    }
  }

  // ==================== SCRAPING ====================

  /**
   * Luca muavin defter Excel'ini indirir ve Buffer olarak döndürür.
   * @param tip 'KDV_191' | 'KDV_391' | 'ISLETME_GELIR' | 'ISLETME_GIDER'
   * @param donem "2026-03" formatında
   * @param mukellefAdi - Luca'daki mükellef arama anahtarı (VKN veya ünvan)
   */
  async fetchMuavinExcel(params: {
    tenantId: string;
    tip: string;
    donem: string;
    mukellefAdi: string;
  }): Promise<Buffer> {
    const { browser, context } = await this.ensureSession(params.tenantId);
    const page = await context.newPage();
    try {
      this.logger.log(`Luca muavin çekiliyor: ${params.mukellefAdi} · ${params.donem} · ${params.tip}`);
      await page.goto(LUCA_URLS.muavin, { waitUntil: 'networkidle', timeout: 30_000 });

      // Mükellef seç (Luca UI'sında keşif gerekebilir)
      await page.fill(SELECTORS.mukellefSelect, params.mukellefAdi).catch(() => {});

      // Dönem seç: "2026-03" → ay/yıl formatına çevir
      const [year, month] = params.donem.split('-');
      await page.selectOption(SELECTORS.donemSelect, { label: `${month}.${year}` }).catch(() => {});

      // Hesap kodu
      const hesapKod =
        params.tip === 'KDV_191' ? '191' :
        params.tip === 'KDV_391' ? '391' :
        ''; // İşletme defteri farklı ekran — keşfedilecek
      if (hesapKod) {
        await page.fill(SELECTORS.hesapInput, hesapKod).catch(() => {});
      }

      // Listele / Raporla
      await page.click(SELECTORS.raporListele).catch(() => {});
      await page.waitForLoadState('networkidle');

      // Excel indirme butonunu bekle ve tıkla — download event yakala
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 20_000 }),
        page.click(SELECTORS.excelButton),
      ]);

      const buffer = await download.createReadStream().then((stream: any) => {
        return new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => resolve(Buffer.concat(chunks)));
          stream.on('error', reject);
        });
      });

      // Session cookie'lerini güncelle (uzat)
      await this.persistCookies(params.tenantId, context);

      return buffer;
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }

  // ==================== INTERNAL ====================

  /**
   * Credential'ı oku → browser aç → gerekirse login ol → cached cookie
   * geçerliyse direkt kullan. Döndür: { browser, context }
   */
  private async ensureSession(tenantId: string): Promise<{ browser: PwBrowser; context: PwContext }> {
    const cred = await (this.prisma as any).lucaCredential.findUnique({ where: { tenantId } });
    if (!cred) throw new BadRequestException('Luca hesabı kaydedilmemiş');
    if (!cred.isActive) throw new BadRequestException('Luca hesabı devre dışı');

    // Playwright'ı dinamik import et
    const { chromium } = await import('playwright-core' as any);
    const browser: PwBrowser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROMIUM_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    const context: PwContext = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      viewport: { width: 1400, height: 900 },
    });

    // Cached cookie varsa yükle
    if (
      cred.encryptedCookies &&
      cred.cookiesExpiresAt &&
      new Date(cred.cookiesExpiresAt) > new Date()
    ) {
      try {
        const cookieJson = tryDecrypt(cred.encryptedCookies);
        if (cookieJson) {
          const cookies = JSON.parse(cookieJson);
          await context.addCookies(cookies);
          this.logger.log('Luca: cached session kullanılıyor');
          return { browser, context };
        }
      } catch (e: any) {
        this.logger.warn('Cached cookie yüklenemedi: ' + e.message);
      }
    }

    // Yeni login ol
    const password = decrypt(cred.encryptedPassword);
    const page = await context.newPage();
    try {
      await page.goto(LUCA_URLS.login, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.fill(SELECTORS.loginUsername, cred.username);
      await page.fill(SELECTORS.loginPassword, password);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30_000 }).catch(() => null),
        page.click(SELECTORS.loginSubmit),
      ]);

      // Login başarısını kontrol et: URL login sayfasından değişmiş mi?
      const currentUrl = page.url();
      if (currentUrl.includes('/login') || currentUrl === LUCA_URLS.login) {
        // Hata mesajı ara
        const errText = await page.textContent('body').catch(() => '');
        throw new Error('Login başarısız — kullanıcı adı/şifre yanlış olabilir');
      }

      await this.persistCookies(tenantId, context);
      await (this.prisma as any).lucaCredential.update({
        where: { tenantId },
        data: { lastLoginAt: new Date(), lastError: null },
      });

      this.logger.log('Luca: yeni login başarılı');
      return { browser, context };
    } catch (e) {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      throw e;
    } finally {
      await page.close().catch(() => {});
    }
  }

  private async persistCookies(tenantId: string, context: PwContext): Promise<void> {
    const cookies = await context.cookies();
    const encryptedCookies = encrypt(JSON.stringify(cookies));
    // 30 dk sonra expire
    const cookiesExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await (this.prisma as any).lucaCredential.update({
      where: { tenantId },
      data: { encryptedCookies, cookiesExpiresAt },
    });
  }

  private async markError(tenantId: string, msg: string): Promise<void> {
    await (this.prisma as any).lucaCredential
      .update({
        where: { tenantId },
        data: { lastError: msg.slice(0, 500) },
      })
      .catch(() => {});
  }
}
