import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  Headers,
  Header,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { LucaService } from './luca.service';
import { LucaAutoScraperService } from './luca-auto-scraper.service';
import { MizanService } from '../mizan/mizan.service';
import { KdvBeyannameService } from '../kdv-beyanname/kdv-beyanname.service';
import { PrismaService } from '../prisma/prisma.service';
import { KdvControlService } from '../kdv-control/kdv-control.service';
import { IsletmeHesapOzetiService } from '../isletme-hesap-ozeti/isletme-hesap-ozeti.service';
import { EarsivService, EarsivTip, BelgeKaynak } from '../earsiv/earsiv.service';
import { MizanParserService } from '../mizan/mizan-parser.service';
import { FaturaMuhasebelestirmeService } from '../fatura-muhasebelestirme/fatura-muhasebelestirme.service';
import { buildLucaImportExcel, buildLucaIsletmeHizliFisCsv } from '../fatura-muhasebelestirme/luca-excel.service';
import { resolveTenantFromAgentToken as resolveAgentTenant } from '../common/agent-token';

/**
 * Luca entegrasyon controller'ı.
 *
 * İki yol:
 *  A) /luca/* — portal kullanıcıları için (JWT korumalı, UI'dan gelir)
 *  B) /agent/luca/* — tarayıcı eklentisi/runner için (X-Agent-Token korumalı)
 */
@Controller()
export class LucaController {
  constructor(
    private readonly luca: LucaService,
    private readonly autoScraper: LucaAutoScraperService,
    private readonly mizan: MizanService,
    private readonly prisma: PrismaService,
    private readonly kdvControl: KdvControlService,
    private readonly kdvBeyanname: KdvBeyannameService,
    private readonly isletmeHesapOzeti: IsletmeHesapOzetiService,
    private readonly earsiv: EarsivService,
    private readonly mizanParser: MizanParserService,
    @Inject(forwardRef(() => FaturaMuhasebelestirmeService))
    private readonly faturaMuhasebelestirme: FaturaMuhasebelestirmeService,
  ) {}

  // ÇOKLU BİLGİSAYAR YÖNLENDİRME: worker yoklarken "ownerEmail" gönderir; biz onu
  // ilgili panel kullanıcısının id'sine çevirip (createdBy eşleştirmesi) cache'leriz.
  // E-posta→id sabit olduğu için süresiz cache yeterli.
  private ownerUserIdCache = new Map<string, string | null>();
  private async resolveOwnerUserId(tenantId: string, email?: string): Promise<string | undefined> {
    const e = String(email || '').trim().toLowerCase();
    if (!e) return undefined;
    const key = `${tenantId}:${e}`;
    if (this.ownerUserIdCache.has(key)) return this.ownerUserIdCache.get(key) || undefined;
    let id: string | null = null;
    try {
      const user = await (this.prisma as any).user.findFirst({
        where: { tenantId, email: { equals: e, mode: 'insensitive' } },
        select: { id: true },
      });
      id = user?.id || null;
    } catch {
      id = null;
    }
    this.ownerUserIdCache.set(key, id);
    return id || undefined;
  }

  private normalizeMizanDonemTipi(donem?: string | null, donemTipi?: string | null) {
    const given = String(donemTipi || '').trim().toUpperCase();
    if (/^GECICI_Q[1-4]$/.test(given)) return given;
    if (given === 'AY' || given === 'AYLIK' || given === 'MONTH') return 'AYLIK';
    if (given === 'YILLIK' || given === 'YEAR' || given === 'ANNUAL') return 'YILLIK';

    const s = String(donem || '').trim().toUpperCase();
    const q = s.match(/(?:^|[-_/])Q([1-4])$/);
    if (q) return `GECICI_Q${q[1]}`;
    if (/-YILLIK$/.test(s) || /^\d{4}$/.test(s)) return 'YILLIK';
    if (/^\d{4}[-_/]\d{1,2}$/.test(s)) return 'AYLIK';
    return 'AYLIK';
  }

  private compareAgentVersions(a?: string | null, b?: string | null) {
    const pa = String(a || '').split('.').map((n) => Number(n) || 0);
    const pb = String(b || '').split('.').map((n) => Number(n) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const da = pa[i] || 0;
      const db = pb[i] || 0;
      if (da !== db) return da - db;
    }
    return 0;
  }

  private requiredAgentVersionForJobTip(tip?: string | null) {
    if (tip === 'EKRAN_OKU') return '1.38.1'; // operatör ekran okuma; sadece güncel ajan
    if (tip === 'LUCA_ACTION') return '1.38.2'; // operatör yaz/seç/tıkla; sadece güncel ajan
    const lucaBrowserJobTips = new Set([
      'EARSIV_SATIS',
      'EARSIV_ALIS',
      'EFATURA_SATIS',
      'EFATURA_ALIS',
      'MIZAN',
      'KDV_MIZAN',
      'ACCOUNT_PLAN',
      'IHO_FETCH',
      'EDEFTER_FIS_LISTESI',
      'KDV_191',
      'KDV_391',
      'ISLETME_GELIR',
      'ISLETME_GIDER',
    ]);
    if (tip && lucaBrowserJobTips.has(tip)) return '1.37.90';
    return null;
  }

  // ==================== AGENT RUNTIME (LOADER PATTERN) ====================
  // Extension'daki agent.js sadece küçük bir loader. Asıl kod burada.
  // Cache'lenmemesi için Cache-Control: no-store. Sayfa yüklenince yeni kod gelir.
  @Get('agent/runtime.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Access-Control-Allow-Origin', '*')
  getAgentRuntime() {
    // Birden fazla muhtemel path dene (dev/prod farkları için)
    const candidates = [
      join(process.cwd(), 'apps/api/public/agent-runtime.js'),
      join(process.cwd(), 'public/agent-runtime.js'),
      join(__dirname, '../../public/agent-runtime.js'),
      join(__dirname, '../../../public/agent-runtime.js'),
      join(__dirname, '../../../../public/agent-runtime.js'),
    ];
    for (const p of candidates) {
      try {
        return readFileSync(p, 'utf-8');
      } catch {}
    }
    return '/* agent-runtime.js bulunamadı */ console.error("[Moren] runtime.js bulunamadı");';
  }

  // ==================== AGENT TOKEN (BOOKMARKLET KURULUMU) ====================

  /**
   * Mevcut tenant'ın Moren Agent token'ı — bookmarklet kurulumu için.
   * Basit: tenant.slug (resolveTenantFromAgentToken bunu kabul eder).
   */
  @Get('agent/me/token')
  @UseGuards(AuthGuard('jwt'))
  async getAgentToken(@Req() req: any) {
    const tenant = await (this.prisma as any).tenant.findUnique({
      where: { id: req.user.tenantId },
      select: { slug: true, name: true },
    });
    return {
      token: tenant?.slug || req.user.tenantId,
      tenantName: tenant?.name || null,
    };
  }

  // ==================== LUCA CREDENTIAL (DEPRECATED - PLAYWRIGHT) ====================
  // Aşağıdaki endpoint'ler Railway Playwright yoluyla login denemek için yazıldı;
  // Luca cloud IP'lerini bloklayınca artık kullanılmıyor. Dormant bırakılıyor
  // (ileride proxy ile yeniden aktive edilebilir).

  /** Luca hesap bilgisinin kayıtlı olup olmadığını döndür */
  @Get('luca/credential')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  getCredential(@Req() req: any) {
    return this.autoScraper.getCredentialStatus(req.user.tenantId);
  }

  /** Luca üye no + kullanıcı adı + şifre kaydet (AES-GCM ile şifrelenmiş) */
  @Post('luca/credential')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  async saveCredential(
    @Req() req: any,
    @Body() body: { uyeNo: string; username: string; password: string },
  ) {
    if (!body?.uyeNo || !body?.username || !body?.password) {
      throw new BadRequestException('Üye No, kullanıcı adı ve şifre zorunlu');
    }
    return this.autoScraper.saveCredential(
      req.user.tenantId,
      body.uyeNo.trim(),
      body.username.trim(),
      body.password,
      req.user.sub,
    );
  }

  /** Kayıtlı Luca hesabını sil */
  @Delete('luca/credential')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCredential(@Req() req: any) {
    await this.autoScraper.deleteCredential(req.user.tenantId);
  }

  /**
   * Luca'ya login başlat — UI'daki "Bağlantıyı Test Et" butonu.
   *
   * Cevap:
   *  { ok: true }                                               → hemen başarılı (CAPTCHA istenmedi)
   *  { ok: false, needsCaptcha: true, captchaImage, expiresInSec } → CAPTCHA ekranı var, çöz ve /captcha endpoint'ine gönder
   *  { ok: false, error }                                        → başka bir hata
   */
  @Post('luca/credential/test')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  async testCredential(@Req() req: any) {
    return this.autoScraper.testLogin(req.user.tenantId);
  }

  /**
   * CAPTCHA çözümü gönder — bekleyen login oturumunun CAPTCHA alanını doldurur,
   * submit eder. Sonuç: { ok } veya { ok: false, needsCaptcha, captchaImage } (yanlış çözümde yeni CAPTCHA)
   */
  @Post('luca/credential/captcha')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  async submitLucaCaptcha(
    @Req() req: any,
    @Body() body: { captchaText: string },
  ) {
    if (!body?.captchaText) {
      throw new BadRequestException('CAPTCHA kodu boş olamaz');
    }
    return this.autoScraper.submitCaptcha(req.user.tenantId, body.captchaText);
  }

  /** Bekleyen CAPTCHA login oturumunu iptal et (kullanıcı vazgeçti) */
  @Post('luca/credential/cancel')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  async cancelLuca(@Req() req: any) {
    return this.autoScraper.cancelLogin(req.user.tenantId);
  }

  @Get('luca/worker-accounts')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  listWorkerAccounts(@Req() req: any) {
    return this.autoScraper.listWorkerAccounts(req.user.tenantId);
  }

  @Post('luca/worker-accounts')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  createWorkerAccount(
    @Req() req: any,
    @Body()
    body: {
      displayName?: string;
      uyeNo?: string;
      username?: string;
      password?: string;
      isActive?: boolean;
      maxConcurrency?: number;
      sortOrder?: number;
    },
  ) {
    return this.autoScraper.saveWorkerAccount(req.user.tenantId, body, req.user.sub);
  }

  @Patch('luca/worker-accounts/:id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  updateWorkerAccount(
    @Req() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      displayName?: string;
      uyeNo?: string;
      username?: string;
      password?: string;
      isActive?: boolean;
      maxConcurrency?: number;
      sortOrder?: number;
    },
  ) {
    return this.autoScraper.saveWorkerAccount(req.user.tenantId, { ...body, id }, req.user.sub);
  }

  @Delete('luca/worker-accounts/:id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteWorkerAccount(@Req() req: any, @Param('id') id: string) {
    await this.autoScraper.deleteWorkerAccount(req.user.tenantId, id);
  }

  // ==================== PORTAL UI → /luca/* ====================

  @Get('luca/session')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  async getSession(@Req() req: any) {
    return (await this.luca.getSession(req.user.tenantId)) || { connected: false };
  }

  @Delete('luca/session')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearSession(@Req() req: any) {
    await this.luca.clearSession(req.user.tenantId);
  }

  @Get('luca/jobs')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  listJobs(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('tip') tip?: string,
  ) {
    return this.luca.listJobs(req.user.tenantId, {
      limit: limit ? Number(limit) : undefined,
      status,
      tip,
    });
  }

  @Get('luca/session-manager/status')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  getSessionManagerStatus(@Req() req: any) {
    return this.luca.getSessionManagerStatus(req.user.tenantId);
  }

  @Get('luca/session-manager/captcha')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  listCaptchaChallenges(@Req() req: any) {
    return this.luca.listCaptchaChallenges(req.user.tenantId);
  }

  @Post('luca/session-manager/captcha/:id/answer')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  submitPortalCaptcha(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { answer?: string; captchaText?: string },
  ) {
    const answer = body?.answer || body?.captchaText || '';
    return this.luca.submitCaptchaAnswer(
      req.user.tenantId,
      id,
      answer,
      req.user.userId || req.user.sub || null,
    );
  }

  @Post('luca/session-manager/captcha/:id/cancel')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  cancelPortalCaptcha(@Req() req: any, @Param('id') id: string) {
    return this.luca.cancelCaptchaChallenge(req.user.tenantId, id);
  }

  @Get('luca/jobs/:id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  getJob(@Req() req: any, @Param('id') id: string) {
    return this.luca.getJob(id, req.user.tenantId);
  }

  @Post('luca/jobs/:id/cancel')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  async cancelJob(@Req() req: any, @Param('id') id: string) {
    return this.luca.cancelJob(id, req.user.tenantId);
  }

  @Post('luca/jobs/reset-stuck')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  async resetStuckJobs(@Req() req: any) {
    const count = await this.luca.cleanupStuckRunning(req.user.tenantId);
    return { reset: count };
  }

  // ==================== RUNNER → /agent/luca/* ====================
  // NOT: X-Agent-Token doğrulaması için mevcut agent-events guard'ı kullanılır.
  // Yalnızca token'a sahip tarayıcı eklentisi bu endpoint'leri çağırabilir.
  // Basit bir tenant lookup ile tenantId çıkartılır (AgentEventsController
  // mevcut projedeki gibi davranır).

  @Post('agent/luca/token')
  @HttpCode(HttpStatus.OK)
  async syncToken(
    @Body() body: { token: string; cookies?: string; origin?: string; email?: string },
    @Headers('x-agent-token') agentToken: string,
  ) {
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    await this.luca.saveToken(tenantId, body, 'extension');
    return { ok: true };
  }

  @Get('agent/luca/credential')
  async getCredentialForAgent(@Headers('x-agent-token') agentToken: string) {
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    return this.autoScraper.getCredentialForAgent(tenantId);
  }

  @Get('agent/luca/worker-accounts')
  async getWorkerAccountsForAgent(@Headers('x-agent-token') agentToken: string) {
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    return this.autoScraper.getWorkerAccountsForAgent(tenantId);
  }

  // Ajan makine-token'lı yüksek-frekanslı poll'ları IP-throttle'a takılmasın
  // (çoklu makine tek IP = 429 fırtınası → ajan donuyordu). Token guard zaten korur.
  @SkipThrottle()
  @Get('agent/luca/jobs/pending')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  async pendingJobs(
    @Headers('x-agent-token') agentToken: string,
    @Query('deviceId') deviceId?: string,
    @Query('version') version?: string,
    @Query('agentVersion') agentVersionQuery?: string,
    @Query('ownerEmail') ownerEmail?: string,
    @Query('alsoUnowned') alsoUnowned?: string,
  ) {
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    const agentVersion = String(version || agentVersionQuery || '').trim();
    const ownerUserId = await this.resolveOwnerUserId(tenantId, ownerEmail);
    const jobs = await this.luca.pendingJobsForAgent(tenantId, deviceId, {
      ownerUserId,
      alsoUnowned: alsoUnowned === '1' || alsoUnowned === 'true',
    });
    return jobs.filter((job: any) => {
      const requiredVersion = this.requiredAgentVersionForJobTip(job.tip);
      if (!requiredVersion) return true;
      return this.compareAgentVersions(agentVersion, requiredVersion) >= 0;
    });
  }

  @SkipThrottle()
  @Get('agent/luca/jobs/active')
  async activeJobsForAgent(
    @Headers('x-agent-token') agentToken: string,
    @Query('deviceId') deviceId?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    return this.luca.listJobsForAgent(tenantId, {
      deviceId,
      limit: limit ? Number(limit) : undefined,
      status,
    });
  }

  @Post('agent/luca/kdv-control/repair-belge-no')
  @HttpCode(HttpStatus.OK)
  async repairKdvBelgeNoForAgent(
    @Headers('x-agent-token') agentToken: string,
    @Body()
    body: {
      sessionId?: string;
      taxpayerName?: string;
      periodLabel?: string;
      type?: 'KDV_191' | 'KDV_391' | 'ISLETME_GELIR' | 'ISLETME_GIDER';
      dryRun?: boolean;
      reconcile?: boolean;
    },
  ) {
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    return this.kdvControl.repairLucaRecordBelgeNosForAgent(tenantId, body || {});
  }

  @SkipThrottle()
  @Post('agent/luca/captcha')
  @HttpCode(HttpStatus.OK)
  async createAgentCaptcha(
    @Body() body: {
      jobId?: string;
      deviceId?: string;
      captchaImage: string;
      context?: any;
      expiresInSec?: number;
    },
    @Headers('x-agent-token') agentToken: string,
  ) {
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    return this.luca.createCaptchaChallengeFromAgent(tenantId, body);
  }

  @SkipThrottle()
  @Get('agent/luca/captcha/active')
  async getActiveAgentCaptcha(@Headers('x-agent-token') agentToken: string) {
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    return this.luca.getActiveCaptchaChallenge(tenantId);
  }

  @SkipThrottle()
  @Post('agent/luca/captcha/:id/answer')
  @HttpCode(HttpStatus.OK)
  async submitAgentCaptchaAnswer(
    @Param('id') id: string,
    @Body() body: { answer?: string; captchaText?: string },
    @Headers('x-agent-token') agentToken: string,
  ) {
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    const answer = body?.answer || body?.captchaText || '';
    return this.luca.submitCaptchaAnswer(tenantId, id, answer, 'local-agent-recovery');
  }

  @SkipThrottle()
  @Get('agent/luca/captcha/:id/answer')
  async getAgentCaptchaAnswer(
    @Param('id') id: string,
    @Headers('x-agent-token') agentToken: string,
  ) {
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    return this.luca.getCaptchaAnswerForAgent(tenantId, id);
  }

  @SkipThrottle()
  @Post('agent/luca/captcha/:id/consume')
  @HttpCode(HttpStatus.OK)
  async consumeAgentCaptchaAnswer(
    @Param('id') id: string,
    @Body() body: { ok?: boolean; error?: string },
    @Headers('x-agent-token') agentToken: string,
  ) {
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    return this.luca.consumeCaptchaAnswer(tenantId, id, body?.ok !== false, body?.error);
  }

  @SkipThrottle()
  @Post('agent/luca/jobs/:id/start')
  @HttpCode(HttpStatus.OK)
  async startJob(
    @Param('id') id: string,
    @Headers('x-agent-token') agentToken: string,
    @Body() body: { deviceId?: string; version?: string; agentVersion?: string },
    @Query('deviceId') queryDeviceId?: string,
  ) {
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    const existingJob = await this.luca.getJob(id, tenantId);
    const agentVersion = String(body?.version || body?.agentVersion || '').trim();
    const requiredVersion = this.requiredAgentVersionForJobTip(existingJob.tip);
    if (requiredVersion && this.compareAgentVersions(agentVersion, requiredVersion) < 0) {
      const label = agentVersion || 'bilinmiyor';
      if (!String(existingJob.errorMsg || '').includes('Ajan surumu eski')) {
        await this.luca.appendJobLog(
          id,
          `Ajan surumu eski (${label}); bu is icin v${requiredVersion}+ gerekli. Luca sekmesini yenileyip Moren Agent'i tekrar baslatin.`,
        );
      }
      return {
        ok: false,
        claimed: false,
        reason: 'STALE_AGENT_VERSION',
        requiredVersion,
        agentVersion: agentVersion || null,
      };
    }
    const job = await this.luca.markJobRunning(id, {
      tenantId,
      deviceId: body?.deviceId || queryDeviceId,
    });
    return { ok: !!job, claimed: !!job, job };
  }

  @SkipThrottle()
  @Post('agent/luca/jobs/:id/done')
  @HttpCode(HttpStatus.OK)
  async finishJob(
    @Param('id') id: string,
    @Body() body: { recordCount?: number },
    @Headers('x-agent-token') agentToken: string,
  ) {
    await this.resolveTenantFromAgentToken(agentToken);
    await this.luca.markJobDone(id, body.recordCount ?? 0);
    return { ok: true };
  }

  @SkipThrottle()
  @Post('agent/luca/jobs/:id/fail')
  @HttpCode(HttpStatus.OK)
  async failJob(
    @Param('id') id: string,
    @Body() body: { error: string },
    @Headers('x-agent-token') agentToken: string,
  ) {
    await this.resolveTenantFromAgentToken(agentToken);
    await this.luca.markJobFailed(id, body.error || 'bilinmeyen hata');
    return { ok: true };
  }

  // v1.38: INVOICE_POST BATCH_EXCEL — agent bu endpoint'ten Luca Fis Aktarim
  // Excel'ini indirir, sonra Luca'nin Toplu Aktarim menusune yukler.
  // payload.mode === 'BATCH_EXCEL' job'larda gecerli.
  @Get('agent/luca/jobs/:id/invoice-excel')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="luca-fis-aktarim.xlsx"')
  async getInvoiceExcel(
    @Param('id') id: string,
    @Headers('x-agent-token') agentToken: string,
    @Res() res: any,
  ) {
    await this.resolveTenantFromAgentToken(agentToken);
    const job = await (this.prisma as any).lucaFetchJob.findUnique({ where: { id } });
    if (!job) throw new BadRequestException('Job bulunamadi');
    if (job.tip !== 'INVOICE_POST') {
      throw new BadRequestException('Sadece INVOICE_POST job icin Excel uretilir');
    }
    const payload: any = job.payload || {};
    if (payload.mode !== 'BATCH_EXCEL' || !Array.isArray(payload.invoices) || !payload.invoices.length) {
      throw new BadRequestException('Job payload BATCH_EXCEL formatinda degil');
    }
    // v2.3: ISLETME mukellefte Luca "Hızlı Fiş Aktarım" CSV (cp1254);
    // BILANCO'da 14 sütun fiş xlsx (Excel Veri Aktarımı ekranı).
    if (payload.format === 'ISLETME_CSV') {
      const csv = buildLucaIsletmeHizliFisCsv(payload);
      res.setHeader('Content-Type', 'text/csv; charset=windows-1254');
      res.setHeader('Content-Disposition', 'attachment; filename="luca-isletme-hizli-fis.csv"');
      res.setHeader('Content-Length', csv.length.toString());
      res.end(csv);
      return;
    }
    const buffer = await buildLucaImportExcel(payload);
    res.setHeader('Content-Length', buffer.length.toString());
    res.end(buffer);
  }

  @SkipThrottle()
  @Post('agent/luca/jobs/:id/requeue')
  @HttpCode(HttpStatus.OK)
  async requeueJobForAgent(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Headers('x-agent-token') agentToken: string,
  ) {
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    const job = await this.luca.requeueJobForAgent(id, tenantId, body?.reason);
    return { ok: true, job };
  }

  @SkipThrottle()
  @Get('agent/luca/jobs/:id/status')
  async jobStatus(
    @Param('id') id: string,
    @Headers('x-agent-token') agentToken: string,
  ) {
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    const job = await this.luca.getJob(id, tenantId);
    return {
      id: job.id,
      status: job.status,
      tip: job.tip,
      sessionId: job.sessionId,
      targetDeviceId: job.targetDeviceId,
      recordCount: job.recordCount,
      errorMsg: job.errorMsg,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    };
  }

  /** Agent her aşamada ilerleme mesajı yollar — Mizan sayfası canlı gösterir. */
  @SkipThrottle()
  @Post('agent/luca/jobs/:id/log')
  @HttpCode(HttpStatus.OK)
  async logJob(
    @Param('id') id: string,
    @Body() body: { msg?: string; line?: string; message?: string },
    @Headers('x-agent-token') agentToken: string,
  ) {
    await this.resolveTenantFromAgentToken(agentToken);
    // Eski/yeni agent sürümleriyle uyum: msg, line ya da message kabul et.
    // Cache'lenmiş eski Luca tab'larındaki agent v1.17.0 da çalışsın.
    const text = body?.msg || body?.line || body?.message;
    if (text) await this.luca.appendJobLog(id, text);
    return { ok: true };
  }

  /** LUCA OPERATÖRÜ — ajan o an açık Luca ekranının snapshot'ını yazar (EKRAN_OKU). */
  @SkipThrottle()
  @Post('agent/luca/jobs/:id/screen')
  @HttpCode(HttpStatus.OK)
  async storeScreen(
    @Param('id') id: string,
    @Body() body: { snapshot?: any },
    @Headers('x-agent-token') agentToken: string,
  ) {
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    await this.luca.storeScreenSnapshot(id, tenantId, body?.snapshot ?? null);
    return { ok: true };
  }

  // ==================== RUNNER MIZAN UPLOAD ====================
  // Tarayıcı eklentisi (moren-agent.js) Luca sekmesinde gezinip mizan Excel'i
  // indirir, bu endpoint'e multipart POST ile yükler. Backend parse edip
  // Mizan + MizanHesap tablosuna yazar. Multi-user: her personel kendi
  // tarayıcısından kendi X-Agent-Token'ıyla çağırır.
  @Post('agent/luca/runner/upload-mizan')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async uploadMizanFromRunner(
    @Headers('x-agent-token') agentToken: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('mukellefId') mukellefId: string,
    @Query('donem') donem: string,
    @Query('donemTipi') donemTipi?: string,
    @Query('jobId') jobId?: string,
  ) {
    if (!file) throw new BadRequestException('Excel dosyası gerekli (field: file)');
    if (!mukellefId || !donem) {
      throw new BadRequestException('mukellefId ve donem query parametreleri gerekli');
    }
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    const job = await this.assertRunnerUploadJob({
      tenantId,
      jobId,
      allowedTips: ['MIZAN'],
      mukellefId,
      donem,
      label: 'Mizan',
    });

    try {
      const result = await this.mizan.importFromExcel({
        tenantId,
        taxpayerId: mukellefId,
        donem,
        donemTipi: this.normalizeMizanDonemTipi(donem, donemTipi) as any,
        buffer: file.buffer,
        createdBy: job?.sessionId ? `edefter-control:${job.sessionId}` : 'extension',
        kaynak: job?.sessionId ? 'EDEFTER' : 'EXCEL',
        replaceExisting: !job?.sessionId,
      });
      if (jobId) await this.luca.markJobDone(jobId, (result as any)?.rows || 0).catch(() => undefined);
      return {
        ok: true,
        mizanId: (result as any)?.id,
        rows: (result as any)?.rows,
        hesapCount: (result as any)?.rows ?? (result as any)?.hesapCount,
      };
    } catch (e: any) {
      throw new BadRequestException(
        `Mizan import hatası: ${e?.message || 'bilinmeyen'}`,
      );
    }
  }

  @Post('agent/luca/runner/upload-account-plan')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async uploadAccountPlanFromRunner(
    @Headers('x-agent-token') agentToken: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('mukellefId') mukellefId: string,
    @Query('jobId') jobId?: string,
  ) {
    if (!file) throw new BadRequestException('Excel dosyası gerekli (field: file)');
    if (!mukellefId) throw new BadRequestException('mukellefId query parametresi gerekli');
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    await this.assertRunnerUploadJob({
      tenantId,
      jobId,
      allowedTips: ['ACCOUNT_PLAN'],
      mukellefId,
      label: 'Hesap plani',
    });

    try {
      const rows = this.mizanParser.parse(file.buffer, {
        allowAccountPlanHeader: true,
        includeZeroRows: true,
      });
      const result = await this.faturaMuhasebelestirme.importAccountPlanSnapshot({
        tenantId,
        taxpayerId: mukellefId,
        jobId,
        rows,
        createdBy: 'extension',
      });
      if (jobId) await this.luca.markJobDone(jobId, result.accountCount).catch(() => {});
      return { ok: true, ...result };
    } catch (e: any) {
      if (jobId) await this.luca.markJobFailed(jobId, e?.message || 'bilinmeyen').catch(() => {});
      throw new BadRequestException(`Hesap planı import hatası: ${e?.message || 'bilinmeyen'}`);
    }
  }

  /**
   * KDV Beyanname için bağımsız mizan snapshot yükleme.
   * Mizan tablosuna YAZMAZ — KdvLucaSnapshot tablosuna yazar (geçici vergiyle karışmaz).
   * Aynı XLS parser'ı reuse eder.
   */
  @Post('agent/luca/runner/upload-kdv-mizan')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async uploadKdvMizanFromRunner(
    @Headers('x-agent-token') agentToken: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('mukellefId') mukellefId: string,
    @Query('donem') donem: string,
    @Query('jobId') jobId?: string,
  ) {
    if (!file) throw new BadRequestException('Excel dosyası gerekli (field: file)');
    if (!mukellefId || !donem) {
      throw new BadRequestException('mukellefId ve donem query parametreleri gerekli');
    }
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    await this.assertRunnerUploadJob({
      tenantId,
      jobId,
      allowedTips: ['KDV_MIZAN'],
      mukellefId,
      donem,
      label: 'KDV mizan',
    });

    try {
      const snapshot = await this.kdvBeyanname.importLucaSnapshotXls({
        tenantId,
        mukellefId,
        donem,
        fetchJobId: jobId,
        buffer: file.buffer,
      });
      if (jobId) await this.luca.markJobDone(jobId, (snapshot as any)?.toplamHesapAdet || 0).catch(() => {});
      return {
        ok: true,
        snapshotId: (snapshot as any)?.id,
        toplamHesapAdet: (snapshot as any)?.toplamHesapAdet,
      };
    } catch (e: any) {
      if (jobId) await this.luca.markJobFailed(jobId, e?.message || 'bilinmeyen').catch(() => {});
      throw new BadRequestException(
        `KDV mizan snapshot hatası: ${e?.message || 'bilinmeyen'}`,
      );
    }
  }

  /**
   * KDV Beyanname İŞLETME DEFTERİ gelir-gider KDV snapshot yükleme (BAĞIMSIZ).
   * KDV Kontrol'den ayrı: KdvLucaSnapshot.hamMizan'a {__isletmeGg:...} olarak yazar.
   * Tek Excel'de gelir (Hesaplanan KDV) + gider (İndirilecek KDV) toplamı çıkarılır.
   */
  @Post('agent/luca/runner/upload-kdv-isletme-gg')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async uploadKdvIsletmeGgFromRunner(
    @Headers('x-agent-token') agentToken: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('mukellefId') mukellefId: string,
    @Query('donem') donem: string,
    @Query('jobId') jobId?: string,
    @Query('ggMode') ggMode?: string,
  ) {
    if (!file) throw new BadRequestException('Excel dosyası gerekli (field: file)');
    if (!mukellefId || !donem) {
      throw new BadRequestException('mukellefId ve donem query parametreleri gerekli');
    }
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    await this.assertRunnerUploadJob({
      tenantId,
      jobId,
      allowedTips: ['KDV_ISLETME_GG'],
      mukellefId,
      donem,
      label: 'KDV işletme gelir-gider',
    });
    try {
      const mode = ggMode === 'gelir' ? 'gelir' : ggMode === 'gider' ? 'gider' : 'both';
      const snap = await this.kdvBeyanname.importIsletmeGGSnapshot({
        tenantId,
        mukellefId,
        donem,
        fetchJobId: jobId,
        buffer: file.buffer,
        ggMode: mode,
      });
      const adet = ((snap as any)?.gelirSatirAdet || 0) + ((snap as any)?.giderSatirAdet || 0);
      if (jobId) await this.luca.markJobDone(jobId, adet).catch(() => {});
      return {
        ok: true,
        snapshotId: (snap as any)?.id,
        gelirKdvToplam: (snap as any)?.gelirKdvToplam,
        giderKdvToplam: (snap as any)?.giderKdvToplam,
      };
    } catch (e: any) {
      if (jobId) await this.luca.markJobFailed(jobId, e?.message || 'bilinmeyen').catch(() => {});
      throw new BadRequestException(
        `KDV işletme gelir-gider snapshot hatası: ${e?.message || 'bilinmeyen'}`,
      );
    }
  }

  /**
   * İşletme Hesap Özeti için Luca'dan İşletme Defteri Excel'i — agent token ile çalışır.
   * Tek excel'den hem GELİRLER hem GİDERLER bölümü parse edilir, İHÖ kaydı doldurulur.
   */
  @Post('agent/luca/runner/upload-iho')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async uploadIhoFromRunner(
    @Headers('x-agent-token') agentToken: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('ihoId') ihoId: string,
    @Query('jobId') jobId?: string,
  ) {
    if (!file) throw new BadRequestException('Excel dosyası gerekli (field: file)');
    if (!ihoId) throw new BadRequestException('ihoId query parametresi gerekli');
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    await this.assertRunnerUploadJob({
      tenantId,
      jobId,
      allowedTips: ['IHO_FETCH'],
      sessionId: ihoId,
      label: 'Isletme hesap ozeti',
    });

    try {
      const updated = await this.isletmeHesapOzeti.applyLucaSnapshot({
        tenantId,
        ihoId,
        jobId,
        buffer: file.buffer,
      });
      if (jobId) await this.luca.markJobDone(jobId, 1).catch(() => {});
      return {
        ok: true,
        ihoId: (updated as any)?.id,
        satisHasilati: (updated as any)?.satisHasilati,
        malAlisi: (updated as any)?.malAlisi,
        donemIciGiderler: (updated as any)?.donemIciGiderler,
      };
    } catch (e: any) {
      if (jobId) await this.luca.markJobFailed(jobId, e?.message || 'bilinmeyen').catch(() => {});
      throw new BadRequestException(`İHÖ Luca uygulama hatası: ${e?.message || 'bilinmeyen'}`);
    }
  }

  /**
   * E-Arşiv / E-Fatura ZIP upload endpoint'i — agent token ile çalışır.
   * Agent Luca'dan ZIP dosyasını indirir, biz parse edip earsivFatura tablosuna yazarız.
   */
  @Post('agent/luca/runner/upload-earsiv')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async uploadEarsivFromRunner(
    @Headers('x-agent-token') agentToken: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('mukellefId') mukellefId: string,
    @Query('donem') donem: string,
    @Query('tip') tip: string,
    @Query('belgeKaynak') belgeKaynak: string,
    @Query('jobId') jobId?: string,
    @Query('bulunan') bulunan?: string,
  ) {
    if (!file) throw new BadRequestException('ZIP dosyası gerekli (field: file)');
    if (!mukellefId || !donem || !tip || !belgeKaynak) {
      throw new BadRequestException('mukellefId, donem, tip, belgeKaynak query parametreleri gerekli');
    }
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    await this.assertRunnerUploadJob({
      tenantId,
      jobId,
      allowedTips: ['EARSIV_SATIS', 'EARSIV_ALIS', 'EFATURA_SATIS', 'EFATURA_ALIS'],
      exactTip: `${String(belgeKaynak).toUpperCase()}_${String(tip).toUpperCase()}`,
      mukellefId,
      donem,
      label: 'E-Arsiv/E-Fatura',
    });

    try {
      const bulunanSayi = bulunan != null && bulunan !== '' && Number.isFinite(Number(bulunan))
        ? Math.max(0, Math.floor(Number(bulunan)))
        : undefined;
      const result = await this.earsiv.importFromZip({
        tenantId,
        taxpayerId: mukellefId,
        donem,
        tip: tip as EarsivTip,
        belgeKaynak: belgeKaynak as BelgeKaynak,
        fetchJobId: jobId,
        zipBuffer: file.buffer,
        bulunan: bulunanSayi,
      });
      if (jobId) {
        // Mutabakat uyarıları (eksik/çakışma) varsa job loguna düşür — kullanıcı panelde görsün.
        const uyarilar = (result as any).uyarilar as string[] | undefined;
        if (uyarilar && uyarilar.length) {
          for (const u of uyarilar) await this.luca.appendJobLog(jobId, u).catch(() => {});
        }
        await this.luca.markJobDone(jobId, result.inserted + result.duplicate).catch(() => {});
      }
      return {
        ok: true,
        inserted: result.inserted,
        duplicate: result.duplicate,
        skipped: result.skipped,
        total: result.total,
        meta: (result as any).meta,
      };
    } catch (e: any) {
      if (jobId) await this.luca.markJobFailed(jobId, e?.message || 'bilinmeyen').catch(() => {});
      throw new BadRequestException(`E-Arşiv ZIP import hatası: ${e?.message || 'bilinmeyen'}`);
    }
  }

  /**
   * Bağlı agent CİHAZLARINI listeler (hangi bilgisayar hangi tip agent çalıştırıyor).
   * Salt okuma — "diğer bilgisayarlarda arka plan worker var mı" tespiti için.
   */
  @Post('agent/luca/devices')
  @HttpCode(HttpStatus.OK)
  async lucaDevices(@Headers('x-agent-token') agentToken: string) {
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    return this.luca.listDevices(tenantId);
  }

  /**
   * KDV / İşletme defteri Excel upload endpoint'i — agent token ile çalışır.
   * `kdv-control/sessions/:id/excel-from-runner/:jobId` JWT guard'lı (panel kullanıcısı için);
   * agent JWT'ye sahip olmadığından bu yan endpoint'i mizan pattern'inde sağlıyoruz.
   */
  @Post('agent/luca/runner/upload-kdv')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async uploadKdvFromRunner(
    @Headers('x-agent-token') agentToken: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('sessionId') sessionId: string,
    @Query('jobId') jobId: string,
  ) {
    if (!file) throw new BadRequestException('Excel dosyası gerekli (field: file)');
    if (!sessionId || !jobId) {
      throw new BadRequestException('sessionId ve jobId query parametreleri gerekli');
    }
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    const session = await this.kdvControl.findSession(sessionId, tenantId);
    await this.assertRunnerUploadJob({
      tenantId,
      jobId,
      allowedTips: ['KDV_191', 'KDV_391', 'ISLETME_GELIR', 'ISLETME_GIDER'],
      exactTip: session.type,
      sessionId,
      label: 'KDV kontrol',
    });
    try {
      const result = await this.kdvControl.uploadExcelFromRunner(
        sessionId,
        tenantId,
        jobId,
        file.buffer,
      );
      return { ok: true, ...result };
    } catch (e: any) {
      throw new BadRequestException(
        `KDV import hatası: ${e?.message || 'bilinmeyen'}`,
      );
    }
  }

  // --------------------------------------------------------------
  // Agent token'dan tenantId çöz — Mihsap ile TAM UYUMLU:
  //  1. Önce AGENT_INGEST_TOKENS env variable (Mihsap ile aynı ortak)
  //  2. Bulunamazsa tenant.slug / tenant.id direkt
  // Her iki yol da kabul edilir — eski slug bazlı akış kırılmaz.
  // --------------------------------------------------------------
  private async assertRunnerUploadJob(opts: {
    tenantId: string;
    jobId?: string | null;
    allowedTips: string[];
    exactTip?: string | null;
    mukellefId?: string | null;
    donem?: string | null;
    sessionId?: string | null;
    label: string;
  }) {
    const jobId = String(opts.jobId || '').trim();
    if (!jobId) {
      throw new BadRequestException(`${opts.label} upload icin jobId zorunlu`);
    }
    const job = await this.luca.getJob(jobId, opts.tenantId).catch(() => null);
    if (!job) {
      throw new BadRequestException(`${opts.label} upload icin Luca job bulunamadi`);
    }
    if (!opts.allowedTips.includes(job.tip)) {
      throw new BadRequestException(
        `${opts.label} upload reddedildi: job tipi ${job.tip}, beklenen ${opts.allowedTips.join('/')}`,
      );
    }
    if (opts.exactTip && job.tip !== opts.exactTip) {
      throw new BadRequestException(`${opts.label} upload reddedildi: job tipi hedef modulle uyusmuyor`);
    }
    if (job.status !== 'running') {
      throw new BadRequestException(`${opts.label} upload reddedildi: job running degil (${job.status})`);
    }
    if (opts.mukellefId && job.mukellefId !== opts.mukellefId) {
      throw new BadRequestException(`${opts.label} upload reddedildi: mukellefId job ile uyusmuyor`);
    }
    if (opts.donem && this.normalizeRunnerDonem(job.donem) !== this.normalizeRunnerDonem(opts.donem)) {
      throw new BadRequestException(`${opts.label} upload reddedildi: donem job ile uyusmuyor`);
    }
    if (opts.sessionId && job.sessionId !== opts.sessionId) {
      throw new BadRequestException(`${opts.label} upload reddedildi: sessionId job ile uyusmuyor`);
    }
    return job;
  }

  private normalizeRunnerDonem(value?: string | null): string {
    return String(value || '').trim().replace('/', '-');
  }

  private async resolveTenantFromAgentToken(token?: string): Promise<string> {
    return resolveAgentTenant(token, this.prisma as any);
  }
}
