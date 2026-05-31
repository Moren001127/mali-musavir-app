import { UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';

function envFlag(value?: string | null) {
  return ['1', 'true', 'yes', 'on', 'evet'].includes(String(value || '').trim().toLowerCase());
}

function safeEqual(a: string, b: string) {
  const ah = createHash('sha256').update(a).digest();
  const bh = createHash('sha256').update(b).digest();
  return timingSafeEqual(ah, bh);
}

function parseTokenMap(raw: string) {
  return raw
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf(':');
      if (idx <= 0) return null;
      return {
        tenantId: pair.slice(0, idx).trim(),
        token: pair.slice(idx + 1).trim(),
      };
    })
    .filter((pair): pair is { tenantId: string; token: string } => !!pair?.tenantId && !!pair?.token);
}

export async function resolveTenantFromAgentToken(
  token: string | undefined,
  prisma?: { tenant?: { findFirst: (args: any) => Promise<{ id: string } | null> } },
): Promise<string> {
  const presented = String(token || '').trim();
  if (!presented) throw new UnauthorizedException('Missing X-Agent-Token');

  const pairs = parseTokenMap(process.env.AGENT_INGEST_TOKENS || '');
  for (const pair of pairs) {
    if (safeEqual(presented, pair.token)) return pair.tenantId;
  }

  if (pairs.length > 0) {
    throw new UnauthorizedException('Invalid agent token');
  }

  const allowLegacyLookup =
    envFlag(process.env.AGENT_TOKEN_ALLOW_TENANT_ID) || process.env.NODE_ENV !== 'production';
  if (!allowLegacyLookup || !prisma?.tenant) {
    throw new UnauthorizedException('Agent token map is not configured');
  }

  const tenant = await prisma.tenant.findFirst({
    where: { OR: [{ slug: presented }, { id: presented }] },
    select: { id: true },
  });
  if (!tenant) throw new UnauthorizedException('Invalid agent token');
  return tenant.id;
}
