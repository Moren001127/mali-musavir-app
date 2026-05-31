import {
  Controller, Post, Body, Param, Headers,
} from '@nestjs/common';
import { GaleriService } from './galeri.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolveTenantFromAgentToken as resolveAgentTenant } from '../common/agent-token';

@Controller('galeri/agent')
export class GaleriAgentController {
  constructor(
    private svc: GaleriService,
    private prisma: PrismaService,
  ) {}

  private async resolveTenantFromToken(token?: string): Promise<string> {
    return resolveAgentTenant(token, this.prisma as any);
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

  @Post('cleanup-stale')
  async cleanupStale(@Headers('x-agent-token') token: string) {
    const tenantId = await this.resolveTenantFromToken(token);
    const result = await (this.prisma as any).agentCommand.updateMany({
      where: {
        tenantId,
        agent: 'hgs',
        status: { in: ['pending', 'running'] },
      },
      data: {
        status: 'failed',
        result: { message: 'Agent restarted; stale command cancelled', stale: true } as any,
        finishedAt: new Date(),
      },
    });
    return { ok: true, temizlenen: result.count };
  }
}
