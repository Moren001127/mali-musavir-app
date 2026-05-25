import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  Headers,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AgentEventsService, AgentEventInput } from './agent-events.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Ajanlar için API.
 *
 * İki tür kimlik doğrulama:
 *  - JWT (web UI için) — `@UseGuards(AuthGuard('jwt'))`
 *  - API Key (yerel script'ler için) — `X-Agent-Token` header, tenantId bu sayede belirlenir.
 *    Token ENV: AGENT_INGEST_TOKENS="tenantId1:token1,tenantId2:token2"
 */
@Controller('agent')
export class AgentEventsController {
  constructor(
    private readonly service: AgentEventsService,
    private readonly prisma: PrismaService,
  ) {}

  private resolveTenantFromToken(token?: string): string {
    if (!token) throw new UnauthorizedException('Missing X-Agent-Token');
    const raw = process.env.AGENT_INGEST_TOKENS || '';
    const map: Record<string, string> = {};
    for (const pair of raw.split(',')) {
      const [tid, tok] = pair.split(':');
      if (tid && tok) map[tok.trim()] = tid.trim();
    }
    const tenantId = map[token.trim()];
    if (!tenantId) throw new UnauthorizedException('Invalid agent token');
    return tenantId;
  }

  /** Async resolver — DB tenant.slug/id lookup. Status ping için kullanılır. */
  private async resolveTenantFromTokenAsync(token?: string): Promise<string> {
    if (!token) throw new UnauthorizedException('Missing X-Agent-Token');
    // Eski env map (geriye uyumlu)
    const raw = process.env.AGENT_INGEST_TOKENS || '';
    if (raw) {
      const map: Record<string, string> = {};
      for (const pair of raw.split(',')) {
        const [tid, tok] = pair.split(':');
        if (tid && tok) map[tok.trim()] = tid.trim();
      }
      const fromEnv = map[token.trim()];
      if (fromEnv) return fromEnv;
    }
    // DB lookup — tenant.slug veya tenant.id ile
    const t = (token || '').trim();
    const tenant = await (this.prisma as any).tenant.findFirst({
      where: { OR: [{ slug: t }, { id: t }] },
      select: { id: true },
    });
    if (!tenant) throw new UnauthorizedException('Invalid agent token');
    return tenant.id;
  }

  // ---- VERSION LATEST (extension auto-update banner için) ----
  /**
   * v1.36.44: Frontend AgentControlCard bunu çağırıp kullanıcının yüklü versiyonu
   * ile karşılaştırır. Eski ise sarı "Yeni güncelleme var" banner'ı gösterir.
   * Public endpoint — auth gerekmez (sadece versiyon string'i döner).
   */
  @Get('version/latest')
  async latestVersion() {
    // agent-runtime.js'in baş kısmından AGENT_VERSION'u dinamik oku.
    // Böylece her deploy'da otomatik güncel kalır, manuel constant tutulması gerekmez.
    try {
      const fs = await import('fs');
      const path = await import('path');
      const candidatePaths = [
        path.resolve(process.cwd(), 'apps/api/public/agent-runtime.js'),
        path.resolve(process.cwd(), 'public/agent-runtime.js'),
        path.resolve(__dirname, '../../public/agent-runtime.js'),
      ];
      let runtimeContent = '';
      for (const p of candidatePaths) {
        try {
          if (fs.existsSync(p)) {
            runtimeContent = fs.readFileSync(p, 'utf8').slice(0, 4000);
            break;
          }
        } catch {}
      }
      const m = runtimeContent.match(/AGENT_VERSION\s*=\s*['"`]([^'"`]+)['"`]/);
      const runtime = m ? m[1] : null;
      // Extension manifest version (loader update gerektirir)
      let extensionManifest: string | null = null;
      const extPaths = [
        path.resolve(process.cwd(), 'apps/moren-auto-agent/manifest.json'),
        path.resolve(__dirname, '../../../moren-auto-agent/manifest.json'),
      ];
      for (const p of extPaths) {
        try {
          if (fs.existsSync(p)) {
            const j = JSON.parse(fs.readFileSync(p, 'utf8'));
            extensionManifest = j.version || null;
            break;
          }
        } catch {}
      }
      return {
        runtime: runtime || 'unknown',
        extensionManifest: extensionManifest || 'unknown',
        zipUrl: '/moren-auto-agent.zip',
      };
    } catch (e: any) {
      return { runtime: 'unknown', extensionManifest: 'unknown', error: e?.message };
    }
  }

  // ---- INGEST (local script → portal) ----

  /** Yerel ajan bir olay kaydeder */
  @Post('events/ingest')
  async ingest(@Headers('x-agent-token') token: string, @Body() body: AgentEventInput) {
    const tenantId = await this.resolveTenantFromTokenAsync(token);
    if (!body?.agent || !body?.status) throw new BadRequestException('agent ve status zorunlu');
    return this.service.createEvent(tenantId, body);
  }

  /** Yerel ajan çalışma durumunu günceller */
  @Post('status/ping')
  async ping(
    @Headers('x-agent-token') token: string,
    @Body() body: {
      agent: string;
      running?: boolean;
      hedefAy?: string;
      status?: string;
      version?: string;
      deviceId?: string;
      meta?: any;
    },
  ) {
    const tenantId = await this.resolveTenantFromTokenAsync(token);
    if (!body?.agent) throw new BadRequestException('agent zorunlu');
    return this.service.upsertStatus(tenantId, body.agent, body);
  }

  // ---- WEB UI (JWT'li) ----

  @Get('events')
  @UseGuards(AuthGuard('jwt'))
  list(
    @Req() req: any,
    @Query('agent') agent?: string,
    @Query('mukellef') mukellef?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('since') since?: string,
  ) {
    return this.service.listEvents(req.user.tenantId, {
      agent,
      mukellef,
      status,
      limit: limit ? parseInt(limit, 10) : 200,
      since,
    });
  }

  @Get('stats')
  @UseGuards(AuthGuard('jwt'))
  stats(@Req() req: any) {
    return this.service.stats(req.user.tenantId);
  }

  /** Mükellef bazında ayın özet: seçili ayda her mükellef için kaç alış/satış işlendi */
  @Get('events/summary-by-mukellef')
  @UseGuards(AuthGuard('jwt'))
  summaryByMukellef(
    @Req() req: any,
    @Query('agent') agent: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    if (!agent) throw new BadRequestException('agent gerekli (mihsap)');
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    if (!y || !m || m < 1 || m > 12) {
      throw new BadRequestException('geçerli year ve month gerekli');
    }
    return this.service.eventSummaryByMukellef(req.user.tenantId, agent, y, m);
  }

  /** AI kullanım istatistikleri (bugün / bu ay / toplam + bakiye) */
  @Get('ai/usage-stats')
  @UseGuards(AuthGuard('jwt'))
  aiUsageStats(@Req() req: any) {
    return this.service.getAiUsageStats(req.user.tenantId);
  }

  /**
   * Diagnostic — son 30 AI usage kaydını dümdüz döner.
   * "Maliyet neden 0 görünüyor?" sorusunu cevaplamak için.
   * mukellef NULL mı? costUsd 0 mı? token sayısı 0 mı? görelim.
   */
  @Get('ai/diag')
  @UseGuards(AuthGuard('jwt'))
  async aiDiag(@Req() req: any) {
    return this.service.aiUsageDiag(req.user.tenantId);
  }

  /**
   * Local agent token ile dar maliyet teshisi.
   * Canli loglarda "bu islemde API parasi gitti mi?" sorusunu JWT olmadan kontrol etmek icin.
   */
  @Get('diag/mihsap-cost')
  async mihsapCostDiag(
    @Headers('x-agent-token') token: string,
    @Query('mukellef') mukellef?: string,
    @Query('limit') limit?: string,
    @Query('since') since?: string,
  ) {
    const tenantId = await this.resolveTenantFromTokenAsync(token);
    return this.service.mihsapCostDiag(tenantId, {
      mukellef,
      limit: limit ? parseInt(limit, 10) : undefined,
      since,
    });
  }

  /** Kontör yükleme kaydet */
  @Post('ai/credit-topup')
  @UseGuards(AuthGuard('jwt'))
  addCreditTopup(
    @Req() req: any,
    @Body() body: { amountUsd: number; note?: string },
  ) {
    if (!body?.amountUsd || body.amountUsd <= 0) {
      throw new BadRequestException('amountUsd > 0 olmalı');
    }
    return this.service.addCreditTopup(
      req.user.tenantId,
      req.user.userId || null,
      body.amountUsd,
      body.note,
    );
  }

  /** Kontör yükleme geçmişi */
  @Get('ai/credit-topups')
  @UseGuards(AuthGuard('jwt'))
  listCreditTopups(@Req() req: any) {
    return this.service.listCreditTopups(req.user.tenantId);
  }

  @Get('status')
  @UseGuards(AuthGuard('jwt'))
  statusList(@Req() req: any) {
    return this.service.listStatus(req.user.tenantId);
  }

  /** Sağlık Paneli için tek endpoint — agents + activity chart + totals */
  @Get('health-summary')
  @UseGuards(AuthGuard('jwt'))
  healthSummary(@Req() req: any) {
    return this.service.getHealthSummary(req.user.tenantId);
  }

  @Get('registry')
  @UseGuards(AuthGuard('jwt'))
  registry() {
    return this.service.getAgentRegistry();
  }

  // === PAUSE/RESUME ===
  /** Portaldan agent durdur/devam — JWT'li (admin/staff) */
  @Post('control/state')
  @UseGuards(AuthGuard('jwt'))
  async setControlState(
    @Req() req: any,
    @Body() body: { agent: string; state: 'RUNNING' | 'PAUSED' | 'STOP' },
  ) {
    if (!body?.agent) throw new BadRequestException('agent zorunlu');
    if (!['RUNNING', 'PAUSED', 'STOP'].includes(body?.state)) {
      throw new BadRequestException('state RUNNING|PAUSED|STOP olmalı');
    }
    return this.service.setControlState(
      req.user.tenantId,
      body.agent,
      body.state,
      req.user?.email || req.user?.userId || 'unknown',
    );
  }

  /** Frontend buton durumu için */
  @Get('control/state')
  @UseGuards(AuthGuard('jwt'))
  async getControlStateUi(@Req() req: any, @Query('agent') agent: string) {
    if (!agent) throw new BadRequestException('agent gerekli');
    return this.service.getControlState(req.user.tenantId, agent);
  }

  /** Agent kendi durumunu okur (X-Agent-Token ile) */
  @Get('control/state/agent-read')
  async getControlStateForAgent(
    @Headers('x-agent-token') token: string,
    @Query('agent') agent: string,
  ) {
    const tenantId = await this.resolveTenantFromTokenAsync(token);
    if (!agent) throw new BadRequestException('agent gerekli');
    return this.service.getControlState(tenantId, agent);
  }

  @Get('rules')
  @UseGuards(AuthGuard('jwt'))
  rules(@Req() req: any) {
    return this.service.listRules(req.user.tenantId);
  }

  @Get('rules/:mukellef')
  @UseGuards(AuthGuard('jwt'))
  getRule(@Req() req: any, @Param('mukellef') mukellef: string) {
    return this.service.getRule(req.user.tenantId, decodeURIComponent(mukellef));
  }

  @Put('rules/:mukellef')
  @UseGuards(AuthGuard('jwt'))
  upsertRule(
    @Req() req: any,
    @Param('mukellef') mukellef: string,
    @Body() body: { faaliyet?: string; defterTuru?: string; profile: any },
  ) {
    return this.service.upsertRule(req.user.tenantId, decodeURIComponent(mukellef), body);
  }

  @Delete('rules/:mukellef')
  @UseGuards(AuthGuard('jwt'))
  deleteRule(@Req() req: any, @Param('mukellef') mukellef: string) {
    return this.service.deleteRule(req.user.tenantId, decodeURIComponent(mukellef));
  }

  // ---- KOMUT KUYRUĞU ----

  /** Web UI komut gönderir */
  @Post('commands')
  @UseGuards(AuthGuard('jwt'))
  createCommand(
    @Req() req: any,
    @Body() body: { agent: string; action: string; payload: any },
  ) {
    if (!body?.agent || !body?.action) {
      throw new BadRequestException('agent ve action zorunlu');
    }
    return this.service.createCommand(req.user.tenantId, {
      agent: body.agent,
      action: body.action,
      payload: body.payload ?? {},
      createdBy: req.user.userId,
    });
  }

  /** Web UI komut listesi */
  @Get('commands')
  @UseGuards(AuthGuard('jwt'))
  listCommands(
    @Req() req: any,
    @Query('agent') agent?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listCommands(req.user.tenantId, {
      agent,
      status,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  /** Yerel runner bekleyen komutları çeker ve claim eder.
   * v1.36.61: deviceId varsa SADECE bu device'a atanmış (veya target-yok) komutlar döner. */
  @Post('commands/claim')
  async claimCommands(
    @Headers('x-agent-token') token: string,
    @Body() body: { agent?: string; deviceId?: string } = {},
  ) {
    const tenantId = await this.resolveTenantFromTokenAsync(token);
    return this.service.claimPendingCommands(tenantId, body?.agent, body?.deviceId);
  }

  /** Yerel runner komutu sonucunu günceller */
  @Put('commands/:id')
  async updateCommandLocal(
    @Headers('x-agent-token') token: string,
    @Param('id') id: string,
    @Body() body: { status?: string; result?: any },
  ) {
    const tenantId = await this.resolveTenantFromTokenAsync(token);
    return this.service.updateCommand(tenantId, id, body);
  }

  /** Tek komutu getir - agent cancel-check icin (agent-token) */
  @Get('commands/:id')
  async getCommandSingle(@Headers('x-agent-token') token: string, @Param('id') id: string) {
    const tenantId = await this.resolveTenantFromTokenAsync(token);
    return this.service.getCommand(tenantId, id);
  }

  /** Tek komutu JWT ile getir - frontend canli log paneli icin */
  @Get('commands-jwt/:id')
  @UseGuards(AuthGuard('jwt'))
  async getCommandSingleJwt(@Req() req: any, @Param('id') id: string) {
    return this.service.getCommand(req.user.tenantId, id);
  }

  /** Agent canlı log gönderir — result.logs array'ine append edilir. */
  @Post('commands/:id/log')
  async appendCommandLog(
    @Headers('x-agent-token') token: string,
    @Param('id') id: string,
    @Body() body: { level?: string; message?: string },
  ) {
    const tenantId = await this.resolveTenantFromTokenAsync(token);
    return this.service.appendCommandLog(tenantId, id, body?.level || 'info', body?.message || '');
  }

  /** Web UI komutu iptal eder */
  @Post('commands/:id/cancel')
  @UseGuards(AuthGuard('jwt'))
  cancelCommand(@Req() req: any, @Param('id') id: string) {
    return this.service.cancelCommand(req.user.tenantId, id);
  }

  /** Claude ile fatura kararı: onay/atla/emin_degil
   *  YENİ: bosAlanSecenekleri verilirse AI boş alan için hesap kodu önerir.
   *  Öneriler, ${response}.onerilenler objesinde döner. */
  @Post('ai/decide-fatura')
  async decideFatura(
    @Headers('x-agent-token') token: string,
    @Body() body: {
      faturaImageBase64?: string;
      faturaImageMediaType?: string;
      faturaText?: string;
      hesapKodlari: string[];
      faturaTarihi?: string;
      hedefAy?: string;
      belgeNo?: string;
      belgeTuru?: string;
      faturaTuru?: string;
      mukellef?: string;
      mukellefId?: string; // Taxpayer.id — Firma Hafizasi mukellef-bazli
      firma?: string;
      firmaKimlikNo?: string; // VKN/TCKN — Firma Hafizasi icin
      tutar?: number | string;
      action?: string;
      forceFresh?: boolean;
      ruleOnly?: boolean;
      bosAlanSecenekleri?: {
        matrahKodlari?: string[];
        kdvKodlari?: string[];
        cariKodlari?: string[];
      };
    },
  ) {
    const tenantId = await this.resolveTenantFromTokenAsync(token);
    if ((!body?.faturaImageBase64 && !body?.ruleOnly) || !Array.isArray(body?.hesapKodlari)) {
      throw new BadRequestException('faturaImageBase64 ve hesapKodlari gerekli');
    }
    return this.service.decideFatura({ ...body, faturaImageBase64: body.faturaImageBase64 || '', tenantId });
  }

  /** Claude ile İşletme Defteri Kayıt Türü + K. Alt Türü kararı */
  @Post('ai/decide-isletme')
  async decideIsletme(
    @Headers('x-agent-token') token: string,
    @Body() body: {
      faturaImageBase64: string;
      faturaImageMediaType?: string;
      kayitTuruOptions: string[];
      altTuruOptions: string[];
      faturaTarihi?: string;
      belgeNo?: string;
      belgeTuru?: string;
      faturaTuru?: string;
      mukellef?: string;
      mukellefId?: string; // Taxpayer.id — Firma Hafizasi mukellef-bazli
      firma?: string;
      firmaKimlikNo?: string; // VKN/TCKN — Firma Hafizasi icin
      tutar?: number | string;
      action?: string;
      matrah?: string | number;
      kdv?: string;
      blokIndex?: number;
      blokToplam?: number;
    },
  ) {
    const tenantId = await this.resolveTenantFromTokenAsync(token);
    if (!body?.faturaImageBase64 || !Array.isArray(body?.kayitTuruOptions)) {
      throw new BadRequestException('faturaImageBase64 ve kayitTuruOptions gerekli');
    }
    return this.service.decideIsletme({ ...body, tenantId });
  }

  /** Mihsap'tan çekilen mükellefleri toplu upsert */
  @Post('taxpayers/bulk-import')
  async bulkImportTaxpayers(
    @Headers('x-agent-token') token: string,
    @Body() body: { taxpayers: any[] },
  ) {
    const tenantId = await this.resolveTenantFromTokenAsync(token);
    if (!Array.isArray(body?.taxpayers)) {
      throw new BadRequestException('taxpayers dizisi gerekli');
    }
    return this.service.bulkImportTaxpayers(tenantId, body.taxpayers);
  }
}
