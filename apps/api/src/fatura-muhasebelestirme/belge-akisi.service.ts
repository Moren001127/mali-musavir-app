/**
 * PLAN/16 §E — BELGE AKIŞI (ofis geneli, tüm mükellefler) arka ucu.
 *
 *   GET fatura-muhasebelestirme/documents/akis?sekme=yuklenen|entegrator|gib|silinen&taxpayerId&kaynak&yon&durum&from&to&q&page&limit
 *
 *   • Sekmeler `source` alanından türetilir (belge-akisi-kurallari.sekmeWhere); "silinen" = AuditLog
 *     (resource='fatura-belge', action='DELETE') — şemada soft-delete yok, silme izi audit'te.
 *   • Durum sözlüğü + Prisma where tek kaynaktan (belgeDurumu / durumWhere) → liste, süzgeç ve sayaçlar
 *     birbiriyle çelişmez. "Karar bekliyor" uyarı JSON'undan ham SQL ile çıkarılır (KARAR_SQL_KOSULU).
 *   • Sayaçlar süzgeçlerden bağımsız (mükellef verildiyse o mükellef); akış-durmuş listesi 30 sn önbellekli.
 *   • `lines` include edilmez; güven için yalnız group/accountCode/kaynak seçilir (computeDocConfidence girdisi).
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FaturaMuhasebelestirmeService } from './fatura-muhasebelestirme.service';
import {
  AkisDurum, AkisSekme, DURUM_ETIKET, KARAR_SQL_KOSULU, belgeDurumu, durumWhere, kaynakEtiketi,
  sekmeKaynagi, sekmeWhere, uyariOzetListesi,
} from './belge-akisi-kurallari';

const SEKMELER: AkisSekme[] = ['tumu', 'yuklenen', 'entegrator', 'gib', 'silinen'];
const DURUMLAR: AkisDurum[] = ['iptal', 'hata', 'okunuyor', 'lucada', 'onayli', 'karar_bekliyor', 'okundu'];
const AKIS_DURMUS_GUN = 30;
const AKIS_DURMUS_TAVAN = 100;
const AKIS_DURMUS_ONBELLEK_MS = 30_000;

export interface AkisSorgu {
  sekme?: string;
  taxpayerId?: string;
  kaynak?: string;
  yon?: string;
  durum?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number | string;
  limit?: number | string;
}

@Injectable()
export class BelgeAkisiService {
  private readonly logger = new Logger(BelgeAkisiService.name);
  private readonly akisDurmusOnbellek = new Map<string, { at: number; veri: any[] }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly fm: FaturaMuhasebelestirmeService,
  ) {}

  async akis(tenantId: string, q: AkisSorgu) {
    const sekme = (SEKMELER.includes(String(q.sekme || '') as AkisSekme) ? String(q.sekme) : 'tumu') as AkisSekme; // varsayılan: tüm kaynaklar (kullanıcı kararı 2026-09-12)
    const taxpayerId = String(q.taxpayerId || '').trim() || undefined;
    const sayfa = Math.max(1, parseInt(String(q.page || '1'), 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(String(q.limit || '50'), 10) || 50));
    const yon = String(q.yon || '').trim().toUpperCase();
    if (yon && !['ALIS', 'SATIS'].includes(yon)) throw new BadRequestException('yon ALIS ya da SATIS olmalı');
    const durum = String(q.durum || '').trim().toLowerCase();
    if (durum && !DURUMLAR.includes(durum as AkisDurum)) throw new BadRequestException(`durum geçersiz (${DURUMLAR.join('|')})`);
    const from = this.tarih(q.from, false);
    const to = this.tarih(q.to, true);
    const arama = String(q.q || '').trim();

    const [sayaclar, akisDurmus] = await Promise.all([
      this.sayaclar(tenantId, taxpayerId),
      this.akisDurmus(tenantId),
    ]);

    if (sekme === 'silinen') {
      const s = await this.silinenler(tenantId, { taxpayerId, yon: yon || undefined, from, to, arama, sayfa, limit });
      return { sekme, toplam: s.toplam, sayfa, limit, satirlar: s.satirlar, kaynaklar: [], sayaclar, akisDurmus };
    }

    const where: any = { tenantId, ...(taxpayerId ? { taxpayerId } : {}) };
    const and: any[] = [sekmeWhere(sekme)];
    if (q.kaynak) {
      const kaynaklar = String(q.kaynak).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (kaynaklar.length) and.push({ source: { in: kaynaklar } });
    }
    if (yon) where.invoiceKind = yon;
    if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) };
    if (arama) {
      const rakam = arama.replace(/\D/g, '');
      and.push({
        OR: [
          { vendorName: { contains: arama, mode: 'insensitive' } },
          { customerName: { contains: arama, mode: 'insensitive' } },
          { belgeNo: { contains: arama, mode: 'insensitive' } },
          ...(rakam.length >= 3 ? [{ sellerVkn: { contains: rakam } }, { buyerVkn: { contains: rakam } }] : []),
        ],
      });
    }
    if (durum) {
      const kararIds = (durum === 'karar_bekliyor' || durum === 'okundu') ? await this.kararBekleyenIdler(tenantId, taxpayerId) : [];
      and.push(durumWhere(durum as AkisDurum, kararIds));
    }
    where.AND = and;

    const [toplam, docs, kaynakGruplari] = await Promise.all([
      (this.prisma as any).invoiceAccountingDocument.count({ where }),
      (this.prisma as any).invoiceAccountingDocument.findMany({
        where,
        select: {
          id: true, taxpayerId: true, source: true, documentType: true, invoiceKind: true, status: true,
          duplicateOfId: true, belgeNo: true, faturaTarihi: true, createdAt: true, sellerVkn: true, buyerVkn: true,
          vendorName: true, customerName: true, totalAmount: true, ocrStatus: true, ocrData: true, lucaStatus: true,
          lucaFisNo: true, validationStatus: true, validationIssues: true,
          lines: { select: { group: true, accountCode: true, kaynak: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (sayfa - 1) * limit,
        take: limit,
      }),
      (this.prisma as any).invoiceAccountingDocument.groupBy({
        by: ['source'],
        where: { tenantId, ...(taxpayerId ? { taxpayerId } : {}), AND: [sekmeWhere(sekme)] },
        _count: { _all: true },
      }).catch(() => []),
    ]);

    const tpAdlari = await this.mukellefAdlari(tenantId, docs.map((d: any) => d.taxpayerId));
    const satirlar = docs.map((d: any) => this.satir(d, tpAdlari));
    const kaynaklar = (kaynakGruplari as any[])
      .map((g) => ({ kod: String(g.source || ''), etiket: kaynakEtiketi(g.source), adet: g._count?._all || 0 }))
      .sort((a, b) => b.adet - a.adet);

    return { sekme, toplam, sayfa, limit, satirlar, kaynaklar, sayaclar, akisDurmus };
  }

  /** Tek belge satırı (liste sözleşmesi). */
  private satir(d: any, tpAdlari: Map<string, string>) {
    const kaynak = sekmeKaynagi(d);
    const durum = belgeDurumu(d);
    const yon = String(d.invoiceKind || '').toUpperCase() === 'SATIS' ? 'SATIS' : 'ALIS';
    const uyarilarTum = Array.isArray(d.ocrData?.uyarilar) ? d.ocrData.uyarilar : [];
    return {
      id: d.id,
      taxpayerId: d.taxpayerId || null,
      mukellefAd: (d.taxpayerId && tpAdlari.get(d.taxpayerId)) || null,
      sekme: kaynak.sekme,
      kaynak: kaynak.etiket,
      kaynakKod: kaynak.kod,
      belgeTuru: d.documentType || null,
      yon,
      belgeNo: d.belgeNo || null,
      faturaTarihi: d.faturaTarihi ? new Date(d.faturaTarihi).toISOString() : null,
      gelisZamani: d.createdAt ? new Date(d.createdAt).toISOString() : null,
      karsiTaraf: (yon === 'SATIS' ? d.customerName : d.vendorName) || null,
      karsiVkn: (yon === 'SATIS' ? d.buyerVkn : d.sellerVkn) || null,
      tutar: d.totalAmount == null ? null : Number(d.totalAmount),
      durum,
      durumEtiketi: DURUM_ETIKET[durum],
      status: d.status || null,
      ocrStatus: d.ocrStatus || null,
      lucaStatus: d.lucaStatus || null,
      lucaFisNo: d.lucaFisNo || null,
      mukerrerBagi: d.duplicateOfId || null,
      uyarilar: uyariOzetListesi(uyarilarTum, 4),
      uyariSayisi: uyarilarTum.length,
      guven: this.fm.docGuven(d),
    };
  }

  /** Karar bekleyen belge id'leri (uyarı JSON'u ham SQL ile; yalnız bekleyen statüler). */
  private async kararBekleyenIdler(tenantId: string, taxpayerId?: string): Promise<string[]> {
    try {
      const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT "id" FROM "invoice_accounting_documents"
          WHERE "tenantId" = $1 ${taxpayerId ? 'AND "taxpayerId" = $2' : ''}
            AND "status" NOT IN ('APPROVED', 'CANCELLED', 'REJECTED')
            AND ${KARAR_SQL_KOSULU}`,
        ...(taxpayerId ? [tenantId, taxpayerId] : [tenantId]),
      );
      return (rows || []).map((r) => String(r.id));
    } catch (e: any) {
      this.logger.warn(`Belge akışı: karar bekleyen id sorgusu başarısız: ${e?.message || e}`);
      return [];
    }
  }

  /** Üst canlı sayaç — süzgeçlerden bağımsız, ofis geneli (mükellef verildiyse o mükellef). */
  async sayaclar(tenantId: string, taxpayerId?: string) {
    const taban = { tenantId, ...(taxpayerId ? { taxpayerId } : {}) };
    const kararIds = await this.kararBekleyenIdler(tenantId, taxpayerId);
    const say = (w: any) => (this.prisma as any).invoiceAccountingDocument.count({ where: { ...taban, AND: [w] } }).catch(() => 0);
    const [okunuyor, kararBekleyen, hata, bugunGelen] = await Promise.all([
      say(durumWhere('okunuyor')),
      kararIds.length ? say(durumWhere('karar_bekliyor', kararIds)) : Promise.resolve(0),
      say(durumWhere('hata')),
      (this.prisma as any).invoiceAccountingDocument.count({ where: { ...taban, createdAt: { gte: this.bugunBaslangici() } } }).catch(() => 0),
    ]);
    return { okunuyor: Number(okunuyor) || 0, kararBekleyen: Number(kararBekleyen) || 0, bugunGelen: Number(bugunGelen) || 0, hata: Number(hata) || 0 };
  }

  /** Türkiye saatiyle (UTC+3, yaz saati yok) bugünün başlangıcı. */
  private bugunBaslangici(): Date {
    const simdi = Date.now() + 3 * 3600_000;
    const gun = Math.floor(simdi / 86_400_000) * 86_400_000;
    return new Date(gun - 3 * 3600_000);
  }

  /**
   * Akış durmuş: aktif (isActive, endDate boş) mükelleflerden son 30+ gündür belge gelmeyenler; hiç belge
   * gelmemiş olanlar da (kayıt 30+ günlükse) listelenir. En fazla 100, gün sayısına göre azalan. 30 sn önbellek.
   */
  async akisDurmus(tenantId: string) {
    const c = this.akisDurmusOnbellek.get(tenantId);
    if (c && Date.now() - c.at < AKIS_DURMUS_ONBELLEK_MS) return c.veri;
    const [mukellefler, sonBelgeler] = await Promise.all([
      (this.prisma as any).taxpayer.findMany({
        where: { tenantId, isActive: true, endDate: null },
        select: { id: true, companyName: true, firstName: true, lastName: true, createdAt: true },
      }),
      (this.prisma as any).invoiceAccountingDocument.groupBy({
        by: ['taxpayerId'], where: { tenantId, taxpayerId: { not: null } }, _max: { createdAt: true },
      }).catch(() => []),
    ]);
    const sonMap = new Map<string, Date>();
    for (const g of sonBelgeler as any[]) if (g.taxpayerId && g._max?.createdAt) sonMap.set(String(g.taxpayerId), new Date(g._max.createdAt));
    const simdi = Date.now();
    const gun = (d: Date) => Math.floor((simdi - d.getTime()) / 86_400_000);
    const veri: Array<{ taxpayerId: string; ad: string; sonBelgeTarihi: string | null; gunSayisi: number }> = [];
    for (const m of mukellefler as any[]) {
      const son = sonMap.get(m.id) || null;
      const gunSayisi = son ? gun(son) : gun(new Date(m.createdAt || simdi));
      if (gunSayisi < AKIS_DURMUS_GUN) continue;
      veri.push({ taxpayerId: m.id, ad: this.mukellefAdi(m), sonBelgeTarihi: son ? son.toISOString() : null, gunSayisi });
    }
    veri.sort((a, b) => b.gunSayisi - a.gunSayisi);
    const kesik = veri.slice(0, AKIS_DURMUS_TAVAN);
    this.akisDurmusOnbellek.set(tenantId, { at: Date.now(), veri: kesik });
    return kesik;
  }

  /**
   * SİLİNEN sekmesi — AuditLog (resource='fatura-belge', action='DELETE'). oldData: {belgeNo, invoiceKind,
   * totalAmount, status} (+ varsa taxpayerId/vendorName/customerName/source). Silen kişi: kaydın userId'si;
   * boşsa aynı isteğin genel denetim kaydı (resource='fatura-muhasebelestirme', ≤3 sn sonra) ile eşlenir.
   */
  private async silinenler(tenantId: string, o: { taxpayerId?: string; yon?: string; from?: Date | null; to?: Date | null; arama: string; sayfa: number; limit: number }) {
    const kosul: string[] = [`a."tenantId" = $1`, `a."resource" = 'fatura-belge'`, `a."action" = 'DELETE'`];
    const params: any[] = [tenantId];
    const p = (v: any) => { params.push(v); return `$${params.length}`; };
    if (o.taxpayerId) kosul.push(`(a."oldData"->>'taxpayerId') = ${p(o.taxpayerId)}`);
    if (o.yon) kosul.push(`upper(a."oldData"->>'invoiceKind') = ${p(o.yon)}`);
    if (o.from) kosul.push(`a."createdAt" >= ${p(o.from)}`);
    if (o.to) kosul.push(`a."createdAt" < ${p(o.to)}`);
    if (o.arama) {
      const like = p(`%${o.arama}%`);
      kosul.push(`((a."oldData"->>'belgeNo') ILIKE ${like} OR (a."oldData"->>'vendorName') ILIKE ${like} OR (a."oldData"->>'customerName') ILIKE ${like} OR a."resourceId" = ${p(o.arama)})`);
    }
    const whereSql = kosul.join(' AND ');
    const [sayRows, rows] = await Promise.all([
      (this.prisma as any).$queryRawUnsafe(`SELECT count(*)::int AS n FROM "audit_logs" a WHERE ${whereSql}`, ...params),
      (this.prisma as any).$queryRawUnsafe(
        `SELECT a."id", a."userId", a."resourceId", a."oldData", a."createdAt", u."firstName", u."lastName", u."email"
           FROM "audit_logs" a LEFT JOIN "users" u ON u."id" = a."userId"
          WHERE ${whereSql}
          ORDER BY a."createdAt" DESC
          LIMIT ${o.limit} OFFSET ${(o.sayfa - 1) * o.limit}`,
        ...params,
      ),
    ]);
    const toplam = Number(sayRows?.[0]?.n) || 0;
    const list: any[] = rows || [];

    // Silen kişi eksikse (eski kayıtlarda userId boş) genel denetim kaydıyla eşle.
    const eksik = list.filter((r) => !r.userId);
    const eslenen = new Map<string, { id: string; ad: string }>();
    if (eksik.length) {
      const zamanlar = eksik.map((r) => new Date(r.createdAt).getTime());
      const min = new Date(Math.min(...zamanlar));
      const max = new Date(Math.max(...zamanlar) + 3000);
      const genel: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT a."userId", a."createdAt", u."firstName", u."lastName", u."email"
           FROM "audit_logs" a LEFT JOIN "users" u ON u."id" = a."userId"
          WHERE a."tenantId" = $1 AND a."resource" = 'fatura-muhasebelestirme' AND a."action" = 'DELETE'
            AND a."createdAt" >= $2 AND a."createdAt" <= $3 AND a."userId" IS NOT NULL
          ORDER BY a."createdAt" ASC`,
        tenantId, min, max,
      ).catch(() => []);
      for (const r of eksik) {
        const t = new Date(r.createdAt).getTime();
        const aday = (genel || []).find((g) => { const gt = new Date(g.createdAt).getTime(); return gt >= t - 500 && gt <= t + 3000; });
        if (aday) eslenen.set(r.id, { id: aday.userId, ad: this.kullaniciAdi(aday) });
      }
    }

    const tpIds = list.map((r) => r.oldData?.taxpayerId).filter(Boolean);
    const tpAdlari = await this.mukellefAdlari(tenantId, tpIds);
    const satirlar = list.map((r) => {
      const od: any = r.oldData || {};
      const yon = String(od.invoiceKind || '').toUpperCase() === 'SATIS' ? 'SATIS' : (od.invoiceKind ? 'ALIS' : null);
      const silen = r.userId ? { id: r.userId, ad: this.kullaniciAdi(r) } : (eslenen.get(r.id) || null);
      const tutar = od.totalAmount === '' || od.totalAmount == null ? null : Number(od.totalAmount);
      return {
        id: r.id,
        belgeId: r.resourceId || null,
        taxpayerId: od.taxpayerId || null,
        mukellefAd: (od.taxpayerId && tpAdlari.get(od.taxpayerId)) || null,
        sekme: 'silinen',
        kaynak: od.source ? kaynakEtiketi(od.source, { documentType: od.documentType }) : null,
        kaynakKod: od.source || null,
        belgeTuru: od.documentType || null,
        yon,
        belgeNo: od.belgeNo || null,
        faturaTarihi: od.faturaTarihi || null,
        gelisZamani: od.createdAt || null,
        silinmeZamani: new Date(r.createdAt).toISOString(),
        silen,
        karsiTaraf: (yon === 'SATIS' ? od.customerName : od.vendorName) || null,
        karsiVkn: null,
        tutar: Number.isFinite(tutar as number) ? tutar : null,
        durum: 'silindi',
        durumEtiketi: 'Silindi',
        eskiDurum: od.status || null,
        status: null, ocrStatus: null, lucaStatus: null, lucaFisNo: null, mukerrerBagi: null,
        uyarilar: [], uyariSayisi: 0, guven: null,
      };
    });
    return { toplam, satirlar };
  }

  private async mukellefAdlari(tenantId: string, ids: any[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter(Boolean).map(String))];
    const map = new Map<string, string>();
    if (!uniq.length) return map;
    const rows: any[] = await (this.prisma as any).taxpayer.findMany({
      where: { tenantId, id: { in: uniq } },
      select: { id: true, companyName: true, firstName: true, lastName: true },
    }).catch(() => []);
    for (const r of rows) map.set(r.id, this.mukellefAdi(r));
    return map;
  }

  private mukellefAdi(t: any): string {
    return String(t?.companyName || [t?.firstName, t?.lastName].filter(Boolean).join(' ') || 'Mükellef').trim();
  }

  private kullaniciAdi(u: any): string {
    return String([u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.email || u?.userId || '').trim();
  }

  private tarih(v: any, gunSonu: boolean): Date | null {
    const s = String(v || '').trim();
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0)) : new Date(s);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`Tarih geçersiz: ${s}`);
    if (m) {
      // Gün sınırları Türkiye saatiyle (UTC+3): from = günün başı, to = ertesi günün başı (hariç).
      const tr = d.getTime() - 3 * 3600_000;
      return new Date(gunSonu ? tr + 86_400_000 : tr);
    }
    return d;
  }
}
