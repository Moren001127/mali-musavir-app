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
  prisma: { tenant?: { findFirst: (args: any) => Promise<{ id: string } | null> } } | undefined,
  /**
   * SIKI MOD — ofis kısa adı (slug) yedeğine DÜŞMEZ.
   *
   * Geriye dönük uyumluluk için normalde slug da anahtar sayılıyor; slug
   * ofis adından türetiliyor (küçük harf + tire), yani tahmin edilebilir ve
   * gizli değil. Yeni uçlar bunu kabul etmemeli. Mevcut ajan/eklenti
   * kurulumları kırılmasın diye eski uçlar sıkı mod KULLANMAZ.
   */
  /**
   * `kaynak` ZORUNLUDUR (2026-09-25). Eski yol uyarısı bu etiketi basar; etiketsiz
   * bir çağıran kalırsa uyarı "bilinmiyor" der ve hangi modülün hâlâ kısa ad
   * sunduğunu bulmak imkânsızlaşır. Zorunlu tutuldu ki yeni bir uç eklenirken
   * unutulması DERLEME HATASI olsun — "hiç uyarı çıkmıyor" ölçütü ancak böyle güvenilir.
   */
  opts: { strict?: boolean; kaynak: string },
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
  //   GEÇİŞ TAMAMLANDI — 2026-09-25, kısa ad yolu CANLIDA KAPALI.
  //     Kapatma ölçütü (yönergede yazılıydı): sunucu yeniden başladıktan sonra hiç "ESKİ YOL"
  //     satırı çıkmaması. Ölçüm yapıldı: dört yoklayıcı (vps-radore-luca, vps-radore-luca-operator,
  //     hgs, DEV-moxegoee-O514TN eklentisi) 0–19 saniye arayla çağırıyordu ve uyarı sayısı SIFIRDI —
  //     yani sessizlik trafik yokluğundan değil, hepsinin gerçek anahtara geçmesindendi.
  //     Son geçen HGS ajanıydı (anahtarı 23 karakterlik ofis kısa adıydı, 32 karakterlik gerçek
  //     anahtara çevrildi; yedek: hgs-agent/.env.eski-anahtar.yedek).
  //
  //   AÇMA DÜĞMESİ: `AGENT_TOKEN_ALLOW_TENANT_ID=1`. Uzun süre kapalı kalmış bir bilgisayar
  //     önbelleğindeki kısa adla gelirse 401 alır; portal açılır açılmaz eklentiye gerçek anahtar
  //     itilir (panel düzeni her ekranda tazeliyor) ve kendi kendine düzelir. Acil durumda bu
  //     değişkenle yol geçici açılır. Yerelde (NODE_ENV != production) yol zaten açık.
  if (!allowLegacyLookup) {
    legacyEskiYolReddedildi(tenant.id, opts.kaynak || 'bilinmiyor');
    throw new UnauthorizedException('Invalid agent token');
  }
  legacyEskiYolKullanimi(presented, tenant.id, opts.kaynak || 'bilinmiyor');
  return tenant.id;
}

/**
 * REDDEDİLEN eski yol — 2026-09-25 kapatmadan sonra.
 *
 * Kapatmanın sessiz 401 üretmesi teşhisi imkânsızlaştırırdı ("Luca çalışmıyor" deyip
 * sebebini bulamazdık). Bu yüzden her ret KAYNAK etiketiyle kayda geçer: hangi modülün,
 * hangi ofis adına kısa ad sunduğu tek satırda görünür. Gürültü olmasın diye kaynak
 * başına en çok 5 satır basılır.
 */
const redSayac = new Map<string, number>();
const EN_FAZLA_RED_SATIRI = 5;

function legacyEskiYolReddedildi(tenantId: string, kaynak: string) {
  const adet = (redSayac.get(kaynak) || 0) + 1;
  redSayac.set(kaynak, adet);
  if (adet > EN_FAZLA_RED_SATIRI) return;
  // eslint-disable-next-line no-console
  console.warn(
    `[AGENT-TOKEN] REDDEDİLDİ: ofis kısa adı anahtar olarak sunuldu (ofis ${tenantId}, kaynak: ${kaynak}). `
    + `Kısa ad yolu 2026-09-25'te kapatıldı. Çözüm: o kurulumun anahtarını AGENT_INGEST_TOKENS'taki `
    + `gerçek anahtarla değiştirin (portal açılınca tarayıcı eklentisi kendi kendine alır). `
    + `Acil durumda geçici açma: AGENT_TOKEN_ALLOW_TENANT_ID=1.`,
  );
}

/**
 * Eski yol kullanım SAYACI — 2026-09-25 (ikinci tur).
 *
 * İlk hâlde uyarı anahtar başına SÜREÇ ÖMRÜ BOYUNCA BİR KEZ basılıyordu. O yüzden kayıtta
 * "1 uyarı" görmek hiçbir şey söylemiyordu: 30 saniyede bir yoklayan bir ajan da, tek seferlik
 * bir istek de aynı tek satırı üretiyordu. "Geçiş bitti mi, kapatabilir miyim?" sorusunu
 * kayıttan yanıtlayamıyorduk.
 *
 * Artık ilk kullanımda uyarı, sonra her `RAPOR_ARALIGI` kullanımda bir SAYIM satırı basılıyor.
 * Kapatma kararı buna bakarak verilir: sayım artmıyorsa geçiş gerçekten bitmiştir.
 */
const RAPOR_ARALIGI = 25;
const legacySayac = new Map<string, number>();

function legacyEskiYolKullanimi(presented: string, tenantId: string, kaynak: string) {
  const anahtar = `${presented}::${kaynak}`;
  const adet = (legacySayac.get(anahtar) || 0) + 1;
  legacySayac.set(anahtar, adet);
  if (adet === 1) {
    // eslint-disable-next-line no-console
    console.warn(
      `[AGENT-TOKEN] ESKİ YOL: ofis kısa adı/kimliği anahtar olarak kabul edildi (ofis ${tenantId}, kaynak: ${kaynak}). `
      + `Bu yol kapatılacak — ajan yapılandırmasını AGENT_INGEST_TOKENS'taki gerçek anahtarla güncelleyin.`,
    );
    return;
  }
  if (adet % RAPOR_ARALIGI === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[AGENT-TOKEN] ESKİ YOL HÂLÂ KULLANILIYOR: ofis ${tenantId} · KAYNAK: ${kaynak} · sunucu açılışından beri ${adet} kez. `
      + `Bu sayı artmayı bırakana kadar kısa ad yolu KAPATILAMAZ.`,
    );
  }
}

/** Sayacın anlık hâli — teşhis için (kapatma kararında kullanılır). */
export function legacyEskiYolSayaci(): Array<{ anahtarUzunluk: number; kaynak: string; adet: number }> {
  return Array.from(legacySayac.entries()).map(([k, adet]) => {
    const i = k.lastIndexOf('::');
    return { anahtarUzunluk: i > 0 ? i : k.length, kaynak: i > 0 ? k.slice(i + 2) : 'bilinmiyor', adet };
  });
}
