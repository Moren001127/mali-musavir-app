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

/**
 * 2026-09-25 bulgu 01 geçişi: bir ofisin AGENT_INGEST_TOKENS'taki GERÇEK anahtarını verir.
 * `luca/agent/me/token` ucu bunu kullanır; eskiden ofis kısa adını token diye dağıtıyordu ve
 * kurulan her ajan otomatik olarak açık yoldan çalışıyordu. Anahtar tanımlı değilse null döner —
 * çağıran taraf "anahtar kurulmamış" der, kısa ad ASLA yedek olarak sunulmaz.
 */
export function agentTokenForTenant(tenantId: string): string | null {
  const pairs = parseTokenMap(process.env.AGENT_INGEST_TOKENS || '');
  const bulunan = pairs.find((p) => p.tenantId === tenantId);
  return bulunan ? bulunan.token : null;
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
  /**
   * SIKI MOD — ofis kısa adı (slug) yedeğine DÜŞMEZ.
   *
   * Geriye dönük uyumluluk için normalde slug da anahtar sayılıyor; slug
   * ofis adından türetiliyor (küçük harf + tire), yani tahmin edilebilir ve
   * gizli değil. Yeni uçlar bunu kabul etmemeli. Mevcut ajan/eklenti
   * kurulumları kırılmasın diye eski uçlar sıkı mod KULLANMAZ.
   */
  opts: { strict?: boolean } = {},
): Promise<string> {
  const presented = String(token || '').trim();
  if (!presented) throw new UnauthorizedException('Missing X-Agent-Token');

  const pairs = parseTokenMap(process.env.AGENT_INGEST_TOKENS || '');
  for (const pair of pairs) {
    if (safeEqual(presented, pair.token)) return pair.tenantId;
  }

  if (opts.strict) throw new UnauthorizedException('Invalid agent token');

  const allowLegacyLookup =
    envFlag(process.env.AGENT_TOKEN_ALLOW_TENANT_ID) || process.env.NODE_ENV !== 'production';
  if (!prisma?.tenant) {
    if (pairs.length > 0) throw new UnauthorizedException('Invalid agent token');
    throw new UnauthorizedException('Agent token map is not configured');
  }

  // Backward compatibility: existing desktop/local-agent installs use tenant slug as
  // the agent token. Keep accepting that while AGENT_INGEST_TOKENS is rolled out.
  const tenant = await prisma.tenant.findFirst({
    where: { OR: [{ slug: presented }, { id: presented }] },
    select: { id: true },
  });
  if (!tenant) {
    if (pairs.length > 0) throw new UnauthorizedException('Invalid agent token');
    if (!allowLegacyLookup) throw new UnauthorizedException('Agent token map is not configured');
    throw new UnauthorizedException('Invalid agent token');
  }
  // 2026-09-25 denetim bulgusu 01 — KAPATMA DÜĞMESİ YANLIŞ YERDEYDİ.
  //   `allowLegacyLookup` yukarıda hesaplanıyor ama YALNIZ `if (!tenant)` dalında okunuyordu; ofis
  //   kısa adı gerçek bir ofisle eşleşince akış buraya düşüp kimliği KOŞULSUZ döndürüyordu. Yani
  //   AGENT_TOKEN_ALLOW_TENANT_ID=false, NODE_ENV=production ve AGENT_INGEST_TOKENS dolu olsa bile
  //   kısa ad kabul ediliyordu. (Canlı ölçüm 2026-09-25: üçü de doğru ayarlıydı, yol yine açıktı.)
  //   Kısa ad gizli değil — tenant.slug ofis adından türer ve `GET luca/agent/me/token` onu token
  //   olarak dağıtıyor; bu yolla `GET agent/luca/credential` Luca parolasını açık döndürüyor.
  //
  //   GEÇİŞ NOTU (sahip kararı, kademeli): yerel ajan ve tarayıcı eklentisi ŞU AN kısa adla
  //   çalışıyor. Yol hemen kapatılırsa Luca otomasyonu durur. Bu yüzden şimdilik kabul edilmeye
  //   devam ediyor ama HER KULLANIM KAYDA GEÇİYOR. Ajanlar gerçek anahtara geçtikten sonra
  //   aşağıdaki blok `if (!allowLegacyLookup) throw ...` ile kapatılacak — o an tek satırlık iş.
  if (!legacyUyarildi.has(presented)) {
    legacyUyarildi.add(presented);
    // eslint-disable-next-line no-console
    console.warn(
      `[AGENT-TOKEN] ESKİ YOL: ofis kısa adı/kimliği anahtar olarak kabul edildi (ofis ${tenant.id}). `
      + `Bu yol kapatılacak — ajan yapılandırmasını AGENT_INGEST_TOKENS'taki gerçek anahtarla güncelleyin.`,
    );
  }
  return tenant.id;
}

/** Aynı kısa ad için tekrar tekrar uyarı basmamak (günlük şişmesin) — süreç ömrü boyunca bir kez. */
const legacyUyarildi = new Set<string>();
