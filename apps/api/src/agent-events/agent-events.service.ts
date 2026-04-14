import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AgentEventInput {
  agent: string;
  action?: string;
  status: string;
  message?: string;
  mukellef?: string;
  firma?: string;
  fisNo?: string;
  tutar?: number;
  hesapKodu?: string;
  kdv?: string;
  meta?: any;
  ts?: string | Date;
}

@Injectable()
export class AgentEventsService {
  constructor(private prisma: PrismaService) {}

  async createEvent(tenantId: string, input: AgentEventInput) {
    return this.prisma.agentEvent.create({
      data: {
        tenantId,
        agent: input.agent,
        action: input.action,
        status: input.status,
        message: input.message,
        mukellef: input.mukellef,
        firma: input.firma,
        fisNo: input.fisNo,
        tutar: input.tutar,
        hesapKodu: input.hesapKodu,
        kdv: input.kdv,
        meta: input.meta ?? undefined,
        ts: input.ts ? new Date(input.ts) : new Date(),
      },
    });
  }

  async listEvents(
    tenantId: string,
    opts: { agent?: string; mukellef?: string; status?: string; limit?: number; since?: string } = {},
  ) {
    const { agent, mukellef, status, limit = 200, since } = opts;
    const where: any = { tenantId };
    if (agent) where.agent = agent;
    if (mukellef) where.mukellef = { contains: mukellef, mode: 'insensitive' };
    if (status) where.status = status;
    if (since) where.ts = { gte: new Date(since) };
    return this.prisma.agentEvent.findMany({
      where,
      orderBy: { ts: 'desc' },
      take: Math.min(limit, 1000),
    });
  }

  async stats(tenantId: string) {
    const now = new Date();
    const bugun = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const ayBas = new Date(now.getFullYear(), now.getMonth(), 1);

    const [toplam, buGun, buAy, hata] = await Promise.all([
      this.prisma.agentEvent.count({ where: { tenantId } }),
      this.prisma.agentEvent.count({ where: { tenantId, ts: { gte: bugun } } }),
      this.prisma.agentEvent.count({ where: { tenantId, status: 'onaylandi', ts: { gte: ayBas } } }),
      this.prisma.agentEvent.count({ where: { tenantId, status: 'hata', ts: { gte: bugun } } }),
    ]);

    const perMukellef = await this.prisma.agentEvent.groupBy({
      by: ['mukellef', 'status'],
      where: { tenantId, mukellef: { not: null } },
      _count: { _all: true },
    });

    return { toplam, buGun, buAy, hataBugun: hata, perMukellef };
  }

  async upsertStatus(tenantId: string, agent: string, data: { running?: boolean; hedefAy?: string; meta?: any }) {
    return this.prisma.agentStatus.upsert({
      where: { tenantId_agent: { tenantId, agent } },
      update: { ...data, lastPing: new Date() },
      create: { tenantId, agent, ...data },
    });
  }

  async listStatus(tenantId: string) {
    return this.prisma.agentStatus.findMany({ where: { tenantId } });
  }

  // Rules
  async listRules(tenantId: string) {
    return this.prisma.agentRule.findMany({ where: { tenantId }, orderBy: { mukellef: 'asc' } });
  }

  async getRule(tenantId: string, mukellef: string) {
    return this.prisma.agentRule.findUnique({ where: { tenantId_mukellef: { tenantId, mukellef } } });
  }

  async upsertRule(tenantId: string, mukellef: string, data: { faaliyet?: string; defterTuru?: string; profile: any }) {
    return this.prisma.agentRule.upsert({
      where: { tenantId_mukellef: { tenantId, mukellef } },
      update: data,
      create: { tenantId, mukellef, ...data },
    });
  }

  async deleteRule(tenantId: string, mukellef: string) {
    return this.prisma.agentRule.delete({ where: { tenantId_mukellef: { tenantId, mukellef } } });
  }
}
