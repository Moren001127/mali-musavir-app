import { Controller, Headers, Post, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveTenantFromAgentToken } from '../common/agent-token';

/**
 * SGK TAHAKKUK TEŞHİSİ — Aylık Ödeme Listesi'nde eksik SGK satırları.
 *
 * Kullanıcı tespiti: "bazı mükelleflerde SGK tahakkuku olmasına rağmen ödeme
 * listesine dahil edilmiyor." Kodda üç ayrı eleme noktası var:
 *   1. Tutar okunamıyor  → aylik-odeme.service.ts:125 `continue` (SESSİZ)
 *   2. Dönem boş/biçimsiz → dönem filtresine hiç takılmıyor
 *   3. Mükellef bağı yok  → :122 `if (!d.taxpayer) continue`
 *
 * Hangisinin baskın olduğu ANCAK ÖLÇÜLEBİLİR — tahminle düzeltme yapılırsa
 * yanlış yer onarılır. Bu uç o ölçümü verir; hiçbir şey değiştirmez.
 *
 * Yalnız OKUR. Mükellef adı ve belge sayıları döner, belge içeriği dönmez.
 */
@Controller('sgk-teshis')
export class SgkTeshisController {
  constructor(private prisma: PrismaService) {}

  @Post()
  async teshis(@Headers('x-agent-token') token: string, @Query('month') month?: string) {
    const tenantId = await resolveTenantFromAgentToken(token, this.prisma as any, { strict: true });

    const simdi = new Date();
    const ay = month || `${simdi.getFullYear()}-${String(simdi.getMonth() + 1).padStart(2, '0')}`;

    const belgeler = await (this.prisma as any).portalDocument.findMany({
      where: { tenantId, belgeTuru: 'SGK_TAHAKKUK' },
      select: {
        id: true, period: true, title: true, raw: true, taxpayerId: true, createdAt: true,
        taxpayer: { select: { companyName: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 800,
    });

    // aylik-odeme.service.ts:37 ile AYNI mantık — farklı olursa ölçüm yanıltır
    const tutarOku = (v: unknown): number | null => {
      if (v == null) return null;
      const n = Number(String(v).replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.'));
      return Number.isFinite(n) && n !== 0 ? n : null;
    };
    const ad = (t: any) =>
      t?.companyName || `${t?.firstName || ''} ${t?.lastName || ''}`.trim() || '(mükellef bağı yok)';

    let donemBos = 0, donemBicimsiz = 0, tutarBos = 0, mukellefYok = 0, saglam = 0;
    const sorunlular: any[] = [];

    for (const d of belgeler) {
      const raw = (d.raw || {}) as Record<string, any>;
      const tutar = tutarOku(raw.tutar);
      const donem = String(d.period || '');
      const donemGecerli = /^\d{4}[-/]\d{1,2}$/.test(donem);

      const sebepler: string[] = [];
      if (!d.taxpayerId) { mukellefYok++; sebepler.push('mükellef bağı yok'); }
      if (!donem) { donemBos++; sebepler.push('dönem boş'); }
      else if (!donemGecerli) { donemBicimsiz++; sebepler.push(`dönem biçimsiz (${donem})`); }
      if (tutar == null) {
        tutarBos++;
        // raw içinde tutar başka bir alanda duruyor olabilir — düzeltmenin
        // hangi alandan okuyacağını bilmek için anahtarları görüyoruz.
        sebepler.push(`tutar okunamadı (raw.tutar=${JSON.stringify(raw.tutar ?? null)})`);
      }

      if (!sebepler.length) { saglam++; continue; }
      if (sorunlular.length < 40) {
        sorunlular.push({
          mukellef: ad(d.taxpayer),
          donem: donem || null,
          baslik: d.title,
          sebepler,
          rawAnahtarlari: Object.keys(raw).slice(0, 12),
        });
      }
    }

    // ISTENEN AYIN SGK DONEMI — aylik-odeme.service.ts:61-63 ile AYNI hesap.
    // Agustos listesi 2026/07 donemini arar (Temmuz primi Agustos'ta odenir).
    const [ay1, ay2] = ay.split('-').map(Number);
    const oncekiAy = new Date(ay1, ay2 - 2, 1);
    const arananDonem =
      `${oncekiAy.getFullYear()}/${String(oncekiAy.getMonth() + 1).padStart(2, '0')}`;

    const oDonem = belgeler.filter((d: any) => {
      const p = String(d.period || '');
      return p === arananDonem || p === arananDonem.replace('/', '-');
    });
    const oDonemGecerli = oDonem.filter((d: any) => tutarOku(((d.raw || {}) as any).tutar) != null);

    // Bu ay SGK belgesi HIC olmayan, ama daha once SGK belgesi gelmis
    // mukellefler — "tahakkuku var ama listede yok" sikayetinin en olasi
    // kaynagi: belge henuz cekilmemis olabilir.
    const oDonemMukellefleri = new Set(oDonem.map((d: any) => d.taxpayerId));
    const gecmisteSgkOlanlar = new Map<string, string>();
    for (const d of belgeler) {
      if (d.taxpayerId && !oDonemMukellefleri.has(d.taxpayerId)) {
        gecmisteSgkOlanlar.set(d.taxpayerId, ad(d.taxpayer));
      }
    }

    return {
      istenenAy: ay,
      arananSgkDonemi: arananDonem,
      buDonemBelgeSayisi: oDonem.length,
      buDonemListeyeGiren: oDonemGecerli.length,
      buDonemElenenTutarSifir: oDonem.length - oDonemGecerli.length,
      gecmisteSgkVarBuDonemYok: {
        adet: gecmisteSgkOlanlar.size,
        mukellefler: [...gecmisteSgkOlanlar.values()].slice(0, 30),
      },
      toplamSgkBelgesi: belgeler.length,
      listeyeGirebilecek: saglam,
      elenen: {
        tutarOkunamadi: tutarBos,
        donemBos,
        donemBicimsiz,
        mukellefBagiYok: mukellefYok,
      },
      not: 'Bir belge birden fazla sebeple elenebilir; sayıların toplamı elenen belge sayısından fazla olabilir.',
      ornekler: sorunlular,
    };
  }
}
