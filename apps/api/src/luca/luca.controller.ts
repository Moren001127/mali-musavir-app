import {
  Controller,
  Get,
  Post,
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
  ForbiddenException,
} from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { LucaService } from './luca.service';
import { LucaAutoScraperService } from './luca-auto-scraper.service';
import { MizanService } from '../mizan/mizan.service';
import { PrismaService } from '../prisma/prisma.service';
import { KdvControlService } from '../kdv-control/kdv-control.service';

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
  ) {}

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
  listJobs(@Req() req: any) {
    return this.luca.listJobs(req.user.tenantId);
  }

  @Get('luca/jobs/:id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  getJob(@Req() req: any, @Param('id') id: string) {
    return this.luca.getJob(id, req.user.tenantId);
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

  @Get('agent/luca/jobs/pending')
  async pendingJobs(@Headers('x-agent-token') agentToken: string) {
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    return this.luca.pendingJobsForAgent(tenantId);
  }

  @Post('agent/luca/jobs/:id/start')
  @HttpCode(HttpStatus.OK)
  async startJob(
    @Param('id') id: string,
    @Headers('x-agent-token') agentToken: string,
  ) {
    await this.resolveTenantFromAgentToken(agentToken);
    await this.luca.markJobRunning(id);
    return { ok: true };
  }

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

  /** Agent her aşamada ilerleme mesajı yollar — Mizan sayfası canlı gösterir. */
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
  ) {
    if (!file) throw new BadRequestException('Excel dosyası gerekli (field: file)');
    if (!mukellefId || !donem) {
      throw new BadRequestException('mukellefId ve donem query parametreleri gerekli');
    }
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);

    try {
      const result = await this.mizan.importFromExcel({
        tenantId,
        taxpayerId: mukellefId,
        donem,
        donemTipi: (donemTipi as any) || 'AYLIK',
        buffer: file.buffer,
        createdBy: 'extension',
      });
      return {
        ok: true,
        mizanId: (result as any)?.id,
        hesapCount: (result as any)?.hesapCount,
      };
    } catch (e: any) {
      throw new BadRequestException(
        `Mizan import hatası: ${e?.message || 'bilinmeyen'}`,
      );
    }
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
  private async resolveTenantFromAgentToken(token?: string): Promise<string> {
    if (!token) throw new ForbiddenException('Agent token eksik');
    const t = token.trim();

    // 1. AGENT_INGEST_TOKENS env'i (format: "tenantId1:token1,tenantId2:token2")
    const raw = process.env.AGENT_INGEST_TOKENS || '';
    const map: Record<string, string> = {};
    for (const pair of raw.split(',')) {
      const [tid, tok] = pair.split(':');
      if (tid && tok) map[tok.trim()] = tid.trim();
    }
    if (map[t]) return map[t];

    // 2. Fallback: tenant.slug veya tenant.id direkt
    const tenant = await (this.prisma as any).tenant.findFirst({
      where: { OR: [{ slug: t }, { id: t }] },
    });
    if (!tenant) throw new ForbiddenException('Agent token geçersiz');
    return tenant.id;
  }
}
