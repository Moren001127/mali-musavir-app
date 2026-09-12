import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AkisBildirim,
  AkisIs,
  AkisOnay,
  AkisSayaclari,
  KUTULAR,
  Kutu,
  Vaka,
  akisOzetSatiri,
  akisSayaclari,
  vakaGrupla,
} from './ekip-akis';

/**
 * EKİP AKIŞ SERVİSİ — Muzaffer Bey’in tek ekranı: vakalar (iş dosyası zincirleri) + üç kutu sayaçları.
 *  GET  /ekip/akis                → akis()
 *  POST /ekip/istek/:id/kapat     → istekKapat()
 *  Sabah özeti hazır verisi       → ozetSatiri()
 *  /ekip/durum akis alanı         → sayaclar()
 *
 * Sorgular: AgentCommand (agent 'ekip:*', son N gün, 500 tavan) + pencere dışındaki eksik kökler,
 * OwnerApprovalRequest (ekip:*), Notification (AUTOMATION, metadata.automationId 'ekip:' ile başlar;
 * Postgres JSON süzgeci olmazsa bellekte süzülür), taxpayer adları. Şema değişikliği YOK.
 */
export interface AkisSecenekleri {
  gun?: 1 | 7 | 30;
  filtre?: 'tumu' | Kutu;
  taxpayerId?: string | null;
  limit?: number;
}

export interface Akis {
  vakalar: Vaka[];
  sayaclar: AkisSayaclari;
  pencere: { gun: number; baslangic: string };
}

const IS_TAVANI = 500;

@Injectable()
export class EkipAkisService {
  private readonly logger = new Logger('EkipAkisService');

  constructor(private readonly prisma: PrismaService) {}

  private gunSec(g: any): 1 | 7 | 30 {
    const n = Number(g);
    return n === 1 || n === 30 ? n : 7;
  }

  /** Tüm pencerenin vakaları (süzgeçsiz) — akis/sayaclar/ozetSatiri ortak çekirdeği. */
  private async vakalariTopla(tenantId: string, gun: 1 | 7 | 30): Promise<{ vakalar: Vaka[]; baslangic: Date }> {
    const baslangic = new Date(Date.now() - gun * 24 * 60 * 60 * 1000);
    const db: any = this.prisma;
    const [isler, onaylar, bildirimler] = await Promise.all([
      db.agentCommand
        .findMany({ where: { tenantId, agent: { startsWith: 'ekip:' }, createdAt: { gte: baslangic } }, orderBy: { createdAt: 'desc' }, take: IS_TAVANI })
        .catch((e: any) => (this.logger.warn(`akış: işler okunamadı: ${e?.message || e}`), [] as any[])),
      db.ownerApprovalRequest
        .findMany({ where: { tenantId, agent: { startsWith: 'ekip:' }, createdAt: { gte: baslangic } }, orderBy: { createdAt: 'desc' }, take: IS_TAVANI })
        .catch(() => [] as any[]),
      this.ekipBildirimleri(tenantId, baslangic),
    ]);

    // Pencere dışında kalan kökler (vaka 8 gün önce açılmış, çocuğu bugün koşmuş olabilir)
    const idler = new Set<string>((isler as any[]).map((r) => r.id));
    const eksikKokler = Array.from(
      new Set(
        (isler as any[])
          .map((r) => (r?.payload && typeof r.payload === 'object' ? r.payload.vakaId : null))
          .filter((v: any) => typeof v === 'string' && v && !idler.has(v)),
      ),
    ) as string[];
    let kokler: any[] = [];
    if (eksikKokler.length) {
      kokler = await db.agentCommand
        .findMany({ where: { tenantId, id: { in: eksikKokler.slice(0, 200) } } })
        .catch(() => [] as any[]);
    }

    const vakalar = vakaGrupla([...(isler as AkisIs[]), ...(kokler as AkisIs[])], onaylar as AkisOnay[], bildirimler as AkisBildirim[]);
    await this.mukellefAdlariniCoz(tenantId, vakalar);
    return { vakalar, baslangic };
  }

  /** AUTOMATION bildirimleri, metadata.automationId 'ekip:' ile başlayanlar. JSON süzgeci düşerse bellekte süz. */
  private async ekipBildirimleri(tenantId: string, baslangic: Date): Promise<any[]> {
    const db: any = this.prisma;
    const temel = { tenantId, type: 'AUTOMATION', createdAt: { gte: baslangic } };
    try {
      return await db.notification.findMany({
        where: { ...temel, metadata: { path: ['automationId'], string_starts_with: 'ekip:' } },
        orderBy: { createdAt: 'desc' },
        take: IS_TAVANI,
      });
    } catch (e: any) {
      this.logger.debug(`akış: bildirim JSON süzgeci düştü (${e?.message || e}); bellekte süzülüyor`);
      const rows: any[] = await db.notification.findMany({ where: temel, orderBy: { createdAt: 'desc' }, take: 2000 }).catch(() => []);
      return rows.filter((r) => String(r?.metadata?.automationId || '').startsWith('ekip:')).slice(0, IS_TAVANI);
    }
  }

  /** Vakalardaki mükellef kimliklerini toplu tek sorguyla ada çevirir (companyName | ad soyad). Hata → ad null kalır. */
  private async mukellefAdlariniCoz(tenantId: string, vakalar: Vaka[]): Promise<void> {
    const idler = Array.from(new Set(vakalar.map((v) => v.mukellef?.id).filter((x): x is string => Boolean(x))));
    if (!idler.length) return;
    const adlar = await this.taxpayerAdlari(tenantId, idler);
    for (const v of vakalar) if (v.mukellef) v.mukellef.ad = adlar.get(v.mukellef.id) ?? null;
  }

  /** id → görünen ad (companyName ya da "ad soyad"). Sorgu düşerse boş harita. */
  async taxpayerAdlari(tenantId: string, idler: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!idler.length) return out;
    try {
      const rows: any[] = await (this.prisma as any).taxpayer.findMany({
        where: { tenantId, id: { in: idler } },
        select: { id: true, companyName: true, firstName: true, lastName: true },
      });
      for (const t of rows || []) {
        const ad = String(t?.companyName || '').trim() || `${String(t?.firstName || '').trim()} ${String(t?.lastName || '').trim()}`.trim();
        if (ad) out.set(t.id, ad);
      }
    } catch (e: any) {
      this.logger.warn(`akış: mükellef adları okunamadı: ${e?.message || e}`);
    }
    return out;
  }

  /** GET /ekip/akis — sayaçlar süzgeçten BAĞIMSIZ, vakalar süzgeçli. */
  async akis(tenantId: string, opts: AkisSecenekleri = {}): Promise<Akis> {
    const gun = this.gunSec(opts.gun);
    const { vakalar, baslangic } = await this.vakalariTopla(tenantId, gun);
    const sayaclar = akisSayaclari(vakalar);
    const filtre = KUTULAR.includes(opts.filtre as Kutu) ? (opts.filtre as Kutu) : 'tumu';
    const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), IS_TAVANI);
    const taxpayerId = String(opts.taxpayerId || '').trim() || null;
    const suzulen = vakalar
      .filter((v) => filtre === 'tumu' || v.kutu === filtre)
      .filter((v) => !taxpayerId || v.mukellef?.id === taxpayerId)
      .slice(0, limit);
    return { vakalar: suzulen, sayaclar, pencere: { gun, baslangic: baslangic.toISOString() } };
  }

  /** /ekip/durum `akis` alanı — 7 günlük pencere sayaçları. */
  async sayaclar(tenantId: string, gun: 1 | 7 | 30 = 7): Promise<AkisSayaclari> {
    try {
      const { vakalar } = await this.vakalariTopla(tenantId, gun);
      return akisSayaclari(vakalar);
    } catch (e: any) {
      this.logger.warn(`akış sayaçları alınamadı: ${e?.message || e}`);
      return { suruyor: 0, onay: 0, istek: 0, bitti: 0, gecikti: 0 };
    }
  }

  /** Sabah özeti hazır verisi (7 gün). Sorgu düşerse "veri alınamadı" — akış bozulmaz. */
  async ozetSatiri(tenantId: string): Promise<string> {
    try {
      const { vakalar } = await this.vakalariTopla(tenantId, 7);
      return akisOzetSatiri(vakalar);
    } catch (e: any) {
      this.logger.warn(`akış özet satırı alınamadı: ${e?.message || e}`);
      return 'Ekip akışı: veri alınamadı';
    }
  }

  /**
   * POST /ekip/istek/:bildirimId/kapat — "Sizden istenen" kalemi yapıldı: isRead + metadata.kapandi/kapatan.
   * JSON tam yazılır: önce oku, sonra {...eski, kapandi, kapatan}. Yalnız ekip bildirimleri (automationId 'ekip:').
   */
  async istekKapat(tenantId: string, userId: string | null, bildirimId: string): Promise<{ ok: boolean; id?: string; vakaId?: string | null; zatenKapali?: boolean; error?: string }> {
    const id = String(bildirimId || '').trim();
    if (!id) return { ok: false, error: 'Bildirim bulunamadı' };
    const db: any = this.prisma;
    const r = await db.notification.findFirst({ where: { id, tenantId } }).catch(() => null);
    const md = r?.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata) ? r.metadata : null;
    if (!r || !md || !String(md.automationId || '').startsWith('ekip:')) return { ok: false, error: 'Bildirim bulunamadı' };
    if (md.kapandi) return { ok: true, id: r.id, vakaId: md.vakaId || null, zatenKapali: true };
    const simdi = new Date();
    try {
      await db.notification.update({
        where: { id: r.id },
        data: { isRead: true, readAt: simdi, metadata: { ...md, kapandi: simdi.toISOString(), kapatan: userId || null } },
      });
    } catch (e: any) {
      return { ok: false, error: `Kapatılamadı: ${e?.message || e}` };
    }
    return { ok: true, id: r.id, vakaId: md.vakaId || null };
  }
}
