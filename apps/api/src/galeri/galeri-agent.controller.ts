import {
  Controller, Post, Body, Param, Headers, UnauthorizedException,
} from '@nestjs/common';
import { GaleriService } from './galeri.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Galeri Agent endpoint'i — JWT yerine X-Agent-Token header ile auth.
 *
 * Local hgs-agent (Node + Playwright) bu endpoint'i kullanarak KGM
 * sorgu sonucunu portala yazar. X-Agent-Token aynı diğer agent'larda
 * (Luca, Mihsap) kullanılan tenant slug/id veya env map token'ıdır.
 */
@Controller('galeri/agent')
export class GaleriAgentController {
  constructor(
    private svc: GaleriService,
    private prisma: PrismaService,
  ) {}

  /** Token → tenantId çözücü (env map veya DB tenant.slug/id lookup) */
  private async resolveTenantFromToken(token?: string): Promise<string> {
    if (!token) throw new UnauthorizedException('Missing X-Agent-Token');

    // 1) Geriye uyumlu env map: AGENT_INGEST_TOKENS="tenantId1:token1,..."
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

    // 2) DB lookup: tenant.slug veya tenant.id eşleşmesi
    const t = (token || '').trim();
    const tenant = await (this.prisma as any).tenant.findFirst({
      where: { OR: [{ slug: t }, { id: t }] },
      select: { id: true },
    });
    if (!tenant) throw new UnauthorizedException('Invalid agent token');
    return tenant.id;
  }

  @Post('araclar/:id/hgs-sorgu-sonuc')
  async kaydetSorguSonucu(
    @Headers('x-agent-token') token: string,
    @Param('id') aracId: string,
    @Body() body: any,
  ) {
    const tenantId = await this.resolveTenantFromToken(token);
    return this.svc.kaydetSorguSonucu(tenantId, aracId, body);
  }
}
