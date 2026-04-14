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

  // ---- INGEST (local script → portal) ----

  /** Yerel ajan bir olay kaydeder */
  @Post('events/ingest')
  ingest(@Headers('x-agent-token') token: string, @Body() body: AgentEventInput) {
    const tenantId = this.resolveTenantFromToken(token);
    if (!body?.agent || !body?.status) throw new BadRequestException('agent ve status zorunlu');
    return this.service.createEvent(tenantId, body);
  }

  /** Yerel ajan çalışma durumunu günceller */
  @Post('status/ping')
  ping(
    @Headers('x-agent-token') token: string,
    @Body() body: { agent: string; running?: boolean; hedefAy?: string; meta?: any },
  ) {
    const tenantId = this.resolveTenantFromToken(token);
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

  @Get('status')
  @UseGuards(AuthGuard('jwt'))
  statusList(@Req() req: any) {
    return this.service.listStatus(req.user.tenantId);
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
}
