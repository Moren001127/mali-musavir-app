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
// Static import — webpack-node-externals bunu externalize edip runtime'da native require ile yükler
// Dynamic import'ta webpack 5'in externals bug'ı vardı, static import stabil çalışır
import { chromium as pwChromium } from 'playwright-core';

// Dinamik import — Playwright kurulu değilse servis başlatılabilsin
type PwBrowser = any;
type PwContext = any;
type PwPage = any;

// Luca gerçek URL'leri — env var ile override edilebilir.
// Ana giriş: SSO sayfası. Muavin/Mizan login sonrası Luca web paneli içinden
// keşfedilecek (muhtemelen `https://luca.com.tr/...` altında dinamik path).
const LUCA_URLS = {
  login:
    process.env.LUCA_LOGIN_URL ||
    'https://agiris.luca.com.tr/LUCASSO/giris.erp',
  muavin:
    process.env.LUCA_MUAVIN_URL ||
    'https://agiris.luca.com.tr/LUCASSO/giris.erp', // placeholder — login sonrası gerçek URL kullanılır
  mizan:
    process.env.LUCA_MIZAN_URL ||
    'https://agiris.luca.com.tr/LUCASSO/giris.erp',
};

// Luca DOM selector'ları — keşifle kesinleştirilecek
const SELECTORS = {
  // Luca login üçlü alan: Üye No + Kullanıcı Adı + Şifre
  loginUyeNo: 'input[name="uyeNo"], input[name="musteriNo"], input#uyeNo, input[placeholder*="\u00dcye" i]',
  loginUsername: 'input[name="kullaniciAdi"], input[name="username"], input#username, input[placeholder*="Kullan" i]',
  loginPassword: 'input[name="sifre"], input[name="password"], input#password, input[type="password"]',
  loginSubmit: 'button[type="submit"], input[type="submit"], button:has-text("Giri\u015f")',
  // CAPTCHA ekranı
  captchaImage: 'img[src*="captcha" i], img[src*="Captcha"], .captcha img, #captcha img, img[alt*="captcha" i], img[alt*="g\u00fcvenlik" i]',
  captchaInput: 'input[name*="captcha" i], input[placeholder*="captcha" i], input[type="text"]:not([name="uyeNo"]):not([name="kullaniciAdi"]):not([name="username"])',
  captchaSubmit: 'button:has-text("Tamam"), button[type="submit"]:visible',
  captchaRefresh: 'button[title*="Yenile" i], a[title*="Yenile" i], .captcha-refresh',
  // Login sonrası doğrulama: URL değişmesi veya login formunun kaybolması
  mukellefSelect: 'select[name="mukellef"], #mukellefSelect, select:has-text("Mükellef")',
  donemSelect: 'select[name="donem"], #donemSelect',
  hesapInput: 'input[name="hesap"], input[placeholder*="hesap" i]',
  raporListele: 'button:has-text("Listele"), button:has-text("Rapor")',
  excelButton: 'button:has-text("Excel"), a[href*=".xlsx"], a:has-text("Excel"), .excel-icon, button[title*="Excel" i]',
};

/** In-memory CAPTCHA relay state — browser/context/page CAPTCHA çözülene kadar saklanır */
interface PendingLogin {
  browser: any;
  context: any;
  page: any;
  captchaImageBase64: string;
  createdAt: number;
  expiresAt: number; // ms epoch
}

@Injectable()
export class LucaAutoScraperService {
  private readonly logger = new Logger(LucaAutoScraperService.name);

  /** tenantId → bekleyen CAPTCHA login oturumu (kullanıcı CAPTCHA çözene kadar) */
  private pendingLogins = new Map<string, PendingLogin>();
  private readonly PENDING_TTL_MS = 3 * 60 * 1000; // 3 dakika

  constructor(private prisma: PrismaService) {
    // Periyodik temizlik: süresi dolmuş pending login'leri kapat
    setInterval(() => this.cleanupExpiredPending(), 30_000).unref();
  }

  // ==================== CREDENTIAL YÖNETİMİ ====================

  async saveCredential(
    tenantId: string,
    uyeNo: string,
    username: string,
    password: string,
    updatedBy?: string,
  ) {
    if (!uyeNo || !username || !password) {
      throw new BadRequestException('Üye No, kullanıcı adı ve şifre zorunlu');
    }
    const encryptedPassword = encrypt(password);
    return (this.prisma as any).lucaCredential.upsert({
      where: { tenantId },
      update: {
        uyeNo,
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
        uyeNo,
        username,
        encryptedPassword,
        updatedBy: updatedBy || null,
      },
      select: {
        id: true,
        uyeNo: true,
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
        uyeNo: true,
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
      uyeNo: c.uyeNo,
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
   *
   * Luca CAPTCHA zorunlu kıldığı için iki olası cevap var:
   *   - ok: true → login başarılı, cookie cache'lendi
   *   - ok: false, needsCaptcha: true, captchaImage: "data:image/..." → kullanıcı çözmeli
   *   - ok: false, error: "..." → başka bir sorun (selector, network, credential)
   */
  async testLogin(tenantId: string): Promise<{
    ok: boolean;
    needsCaptcha?: boolean;
    captchaImage?: string;
    expiresInSec?: number;
    error?: string;
  }> {
    return this.startLogin(tenantId);
  }

  /**
   * Yeni login akışı başlat.
   * Varsa bekleyen eski oturumu kapat, yeni browser/context aç, login formunu doldur,
   * submit → CAPTCHA sayfasına düş → CAPTCHA resmini yakala → base64 olarak dön.
   */
  async startLogin(tenantId: string): Promise<{
    ok: boolean;
    needsCaptcha?: boolean;
    captchaImage?: string;
    expiresInSec?: number;
    error?: string;
  }> {
    // Varsa eski pending'i kapat
    await this.cancelPending(tenantId).catch(() => {});

    const cred = await (this.prisma as any).lucaCredential.findUnique({ where: { tenantId } });
    if (!cred) {
      return { ok: false, error: 'Luca hesabı kaydedilmemiş' };
    }
    if (!cred.isActive) {
      return { ok: false, error: 'Luca hesabı devre dışı' };
    }

    let browser: any;
    let context: any;
    let page: any;
    try {
      browser = await pwChromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROMIUM_PATH,
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
      context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1400, height: 900 },
      });
      page = await context.newPage();

      this.logger.log('[LUCA] Login akışı başlatıldı');
      // `domcontentloaded` — Luca sayfası sürekli network aktivitesi yaptığı
      // için `networkidle` hiç tetiklenmeyebilir. DOM hazır olunca devam et,
      // input selector'lar görününce form doldur.
      await page.goto(LUCA_URLS.login, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForSelector(SELECTORS.loginPassword, { timeout: 15_000 }).catch(() => {});
      this.logger.log(`[LUCA] Login sayfası yüklendi · url=${page.url()}`);

      // Credential doldur
      const password = decrypt(cred.encryptedPassword);
      await page.fill(SELECTORS.loginUyeNo, cred.uyeNo).catch(() => {});
      await page.fill(SELECTORS.loginUsername, cred.username);
      await page.fill(SELECTORS.loginPassword, password);
      await page.click(SELECTORS.loginSubmit).catch(() => {});

      // Submit sonrası ekran değişimi bekle — CAPTCHA veya ana panele geçiş
      await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});
      // CAPTCHA veya logout linki görünmesini bekle (hangisi önce çıkarsa)
      await Promise.race([
        page.waitForSelector(SELECTORS.captchaImage, { timeout: 10_000 }).catch(() => null),
        page.waitForSelector('a[href*="cikis" i], a:has-text("Çıkış"), nav', { timeout: 10_000 }).catch(() => null),
      ]);

      // CAPTCHA görseli var mı?
      const captchaImg = await page.$(SELECTORS.captchaImage).catch(() => null);
      if (captchaImg) {
        // CAPTCHA'yı base64 olarak yakala
        const buffer = await captchaImg.screenshot({ type: 'png' });
        const base64 = `data:image/png;base64,${buffer.toString('base64')}`;
        const now = Date.now();
        this.pendingLogins.set(tenantId, {
          browser,
          context,
          page,
          captchaImageBase64: base64,
          createdAt: now,
          expiresAt: now + this.PENDING_TTL_MS,
        });
        this.logger.log('[LUCA] CAPTCHA ekranı yakalandı, kullanıcı çözümü bekleniyor');
        return {
          ok: false,
          needsCaptcha: true,
          captchaImage: base64,
          expiresInSec: Math.round(this.PENDING_TTL_MS / 1000),
        };
      }

      // CAPTCHA yoksa login başarılı olmuş olabilir → URL kontrol et
      const currentUrl = page.url();
      if (currentUrl.includes('/login') || currentUrl === LUCA_URLS.login) {
        const errText = (await page.textContent('body').catch(() => '')) || '';
        const msg = /yanl\u0131\u015f|hatal\u0131|ge\u00e7ersiz/i.test(errText)
          ? 'Kullanıcı adı/şifre yanlış'
          : 'Login başarısız (CAPTCHA veya sayfa değişimi algılanamadı)';
        await this.cleanup(browser, context, page);
        await this.markError(tenantId, msg);
        return { ok: false, error: msg };
      }

      // Login başarılı — cookies kaydet, cleanup
      await this.persistCookies(tenantId, context);
      await (this.prisma as any).lucaCredential.update({
        where: { tenantId },
        data: { lastLoginAt: new Date(), lastError: null },
      });
      await this.cleanup(browser, context, page);
      this.logger.log('[LUCA] Login başarılı (CAPTCHA istenmedi)');
      return { ok: true };
    } catch (e: any) {
      this.logger.error(`[LUCA] startLogin hatası: ${e?.message}`);
      await this.cleanup(browser, context, page);
      const msg = e?.message || 'Login başarısız';
      await this.markError(tenantId, msg);
      return { ok: false, error: msg };
    }
  }

  /**
   * Kullanıcı CAPTCHA'yı çözüp gönderdiğinde çağrılır.
   * Pending browser bulunmuyorsa hata. Doğruysa cookie'ler kaydedilir.
   * Yanlışsa yeni CAPTCHA resmi döner (aynı browser üzerinden).
   */
  async submitCaptcha(tenantId: string, captchaText: string): Promise<{
    ok: boolean;
    needsCaptcha?: boolean;
    captchaImage?: string;
    error?: string;
  }> {
    const pending = this.pendingLogins.get(tenantId);
    if (!pending) {
      return { ok: false, error: 'Bekleyen login bulunamadı — lütfen baştan başlayın' };
    }
    if (Date.now() > pending.expiresAt) {
      await this.cancelPending(tenantId).catch(() => {});
      return { ok: false, error: 'Oturum zaman aşımına uğradı — baştan başlayın' };
    }
    if (!captchaText || captchaText.trim().length < 3) {
      return { ok: false, error: 'CAPTCHA kodu geçersiz' };
    }

    const { page, context, browser } = pending;
    try {
      await page.fill(SELECTORS.captchaInput, captchaText.trim());
      await page.click(SELECTORS.captchaSubmit).catch(() => {});
      await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});
      // Sonraki ekranın (ana panel veya yeni CAPTCHA) yüklenmesi için kısa bekleme
      await Promise.race([
        page.waitForSelector(SELECTORS.captchaImage, { timeout: 8_000 }).catch(() => null),
        page.waitForSelector('a[href*="cikis" i], a:has-text("Çıkış"), nav', { timeout: 8_000 }).catch(() => null),
      ]);

      // Hâlâ CAPTCHA ekranındaysak yanlış çözmüş demektir → yeni CAPTCHA resmi gönder
      const stillCaptcha = await page.$(SELECTORS.captchaImage).catch(() => null);
      if (stillCaptcha) {
        const buffer = await stillCaptcha.screenshot({ type: 'png' });
        const base64 = `data:image/png;base64,${buffer.toString('base64')}`;
        pending.captchaImageBase64 = base64;
        pending.expiresAt = Date.now() + this.PENDING_TTL_MS; // uzat
        this.logger.log('[LUCA] CAPTCHA yanlış — yeni CAPTCHA kullanıcıya gönderildi');
        return {
          ok: false,
          needsCaptcha: true,
          captchaImage: base64,
          error: 'CAPTCHA yanlış — tekrar deneyin',
        };
      }

      // URL login sayfasında değilse başarılı
      const currentUrl = page.url();
      if (currentUrl.includes('/login') || currentUrl === LUCA_URLS.login) {
        await this.cancelPending(tenantId).catch(() => {});
        const msg = 'CAPTCHA doğru ama login başarısız (credential hatalı olabilir)';
        await this.markError(tenantId, msg);
        return { ok: false, error: msg };
      }

      // Başarılı — cookies persist, pending temizle
      await this.persistCookies(tenantId, context);
      await (this.prisma as any).lucaCredential.update({
        where: { tenantId },
        data: { lastLoginAt: new Date(), lastError: null },
      });
      this.pendingLogins.delete(tenantId);
      await this.cleanup(browser, context, page);
      this.logger.log('[LUCA] CAPTCHA çözüldü, login başarılı');
      return { ok: true };
    } catch (e: any) {
      this.logger.error(`[LUCA] submitCaptcha hatası: ${e?.message}`);
      await this.cancelPending(tenantId).catch(() => {});
      const msg = e?.message || 'CAPTCHA gönderilirken hata';
      await this.markError(tenantId, msg);
      return { ok: false, error: msg };
    }
  }

  /** Bekleyen login oturumunu iptal et (kullanıcı vazgeçti veya zaman aşımı). */
  async cancelLogin(tenantId: string): Promise<{ ok: boolean }> {
    await this.cancelPending(tenantId).catch(() => {});
    return { ok: true };
  }

  private async cancelPending(tenantId: string): Promise<void> {
    const pending = this.pendingLogins.get(tenantId);
    if (!pending) return;
    this.pendingLogins.delete(tenantId);
    await this.cleanup(pending.browser, pending.context, pending.page);
  }

  private async cleanup(browser?: any, context?: any, page?: any): Promise<void> {
    try { if (page) await page.close().catch(() => {}); } catch { /* noop */ }
    try { if (context) await context.close().catch(() => {}); } catch { /* noop */ }
    try { if (browser) await browser.close().catch(() => {}); } catch { /* noop */ }
  }

  private cleanupExpiredPending(): void {
    const now = Date.now();
    for (const [tenantId, p] of this.pendingLogins.entries()) {
      if (now > p.expiresAt) {
        this.logger.warn(`[LUCA] Pending login timeout tenant=${tenantId}`);
        this.pendingLogins.delete(tenantId);
        this.cleanup(p.browser, p.context, p.page).catch(() => {});
      }
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

  /**
   * Luca mizan ekranından Excel indirir.
   * @param donem "2026-03" (aylık) | "2026-Q1" (geçici) | "2026-YILLIK"
   */
  async fetchMizanExcel(params: {
    tenantId: string;
    donem: string;
    donemTipi?: string;
    mukellefAdi: string;
  }): Promise<Buffer> {
    const { browser, context } = await this.ensureSession(params.tenantId);
    const page = await context.newPage();
    try {
      this.logger.log(`Luca mizan çekiliyor: ${params.mukellefAdi} · ${params.donem}`);
      await page.goto(LUCA_URLS.mizan, { waitUntil: 'networkidle', timeout: 30_000 });

      // Mükellef seçimi
      await page.fill(SELECTORS.mukellefSelect, params.mukellefAdi).catch(() => {});

      // Dönem: aylık için ay.yil, çeyrek için tarih aralığı
      if (/^\d{4}-\d{2}$/.test(params.donem)) {
        const [year, month] = params.donem.split('-');
        await page
          .selectOption(SELECTORS.donemSelect, { label: `${month}.${year}` })
          .catch(() => {});
      } else if (/^\d{4}-Q(\d)$/.test(params.donem)) {
        // Çeyrek ay aralığı: Q1=01-03, Q2=04-06, Q3=07-09, Q4=10-12
        const m = params.donem.match(/^(\d{4})-Q(\d)$/)!;
        const year = m[1];
        const q = Number(m[2]);
        const startMonth = String((q - 1) * 3 + 1).padStart(2, '0');
        const endMonth = String(q * 3).padStart(2, '0');
        await page.fill('input[name="baslangic"], input#baslangic', `01.${startMonth}.${year}`).catch(() => {});
        await page.fill('input[name="bitis"], input#bitis', `${new Date(Number(year), q * 3, 0).getDate()}.${endMonth}.${year}`).catch(() => {});
      }

      await page.click(SELECTORS.raporListele).catch(() => {});
      await page.waitForLoadState('networkidle');

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30_000 }),
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
   * Credential'ı oku → cached cookies varsa yeni browser aç ve cookie'leri yükle → döndür.
   * Cache yoksa/expired ise `LucaNeedLoginError` fırlatır — caller kullanıcıyı
   * CAPTCHA login akışına yönlendirmeli (startLogin + submitCaptcha).
   *
   * Not: Bu metod artık Luca'da CAPTCHA zorunluluğu yüzünden otomatik login
   * yapamaz. CAPTCHA çözümü kullanıcı müdahalesi gerektirir, bu yüzden scraping
   * sadece geçerli bir session cache'iyle çalışır.
   */
  private async ensureSession(tenantId: string): Promise<{ browser: PwBrowser; context: PwContext }> {
    const cred = await (this.prisma as any).lucaCredential.findUnique({ where: { tenantId } });
    if (!cred) throw new BadRequestException('Luca hesabı kaydedilmemiş');
    if (!cred.isActive) throw new BadRequestException('Luca hesabı devre dışı');

    // Cache zorunlu — CAPTCHA nedeniyle otomatik login yapamıyoruz
    if (
      !cred.encryptedCookies ||
      !cred.cookiesExpiresAt ||
      new Date(cred.cookiesExpiresAt) <= new Date()
    ) {
      throw new BadRequestException(
        'Luca oturumu yok veya süresi dolmuş — Ayarlar > Luca Hesabı > Bağlantıyı Test Et ile CAPTCHA çözüp oturum açın',
      );
    }

    const browser: PwBrowser = await pwChromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROMIUM_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const context: PwContext = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      viewport: { width: 1400, height: 900 },
    });

    try {
      const cookieJson = tryDecrypt(cred.encryptedCookies);
      if (!cookieJson) throw new Error('Cookie decrypt edilemedi');
      const cookies = JSON.parse(cookieJson);
      await context.addCookies(cookies);
      this.logger.log('[LUCA] cached session kullanılıyor');
      return { browser, context };
    } catch (e: any) {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      throw new BadRequestException(
        'Luca oturumu bozuk — tekrar login olun (Ayarlar > Luca Hesabı)',
      );
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
