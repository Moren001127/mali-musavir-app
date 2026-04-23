import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Plaka normalize — boşlukları kaldır, büyük harfe çevir. "34 abc 123" → "34ABC123" */
function normalizePlaka(p: string): string {
  return (p || '').replace(/[\s-]/g, '').toUpperCase().trim();
}

/** Plaka görselleştirme: "34ABC123" → "34 ABC 123" (boşluklu gösterim) */
function formatPlaka(p: string): string {
  const s = normalizePlaka(p);
  const m = s.match(/^(\d{1,3})([A-Z]{1,3})(\d{1,4})$/);
  if (m) return `${m[1]} ${m[2]} ${m[3]}`;
  return s;
}

@Injectable()
export class GaleriService {
  constructor(private prisma: PrismaService) {}

  // ════════════ ARAÇLAR ════════════

  async listAraclar(tenantId: string, opts: { search?: string; aktif?: boolean } = {}) {
    const where: any = { tenantId };
    if (opts.aktif !== undefined) where.aktif = opts.aktif;
    if (opts.search && opts.search.trim()) {
      const q = opts.search.trim().toUpperCase();
      where.OR = [
        { plaka: { contains: q } },
        { marka: { contains: q, mode: 'insensitive' } },
        { model: { contains: q, mode: 'insensitive' } },
        { sahipAd: { contains: q, mode: 'insensitive' } },
      ];
    }
    const araclar = await (this.prisma as any).arac.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      include: {
        hgsSonuclari: {
          orderBy: { sorguTarihi: 'desc' },
          take: 1, // en son sorgu
        },
      },
    });
    // Her aracın son sorgu özetini ekle
    return araclar.map((a: any) => ({
      ...a,
      plakaGorunum: formatPlaka(a.plaka),
      sonSorgu: a.hgsSonuclari?.[0] || null,
      hgsSonuclari: undefined, // UI'a tek ihtiyaç sonSorgu
    }));
  }

  async createArac(
    tenantId: string,
    data: { plaka: string; marka?: string; model?: string; sahipAd?: string; taxpayerId?: string | null; notlar?: string | null },
  ) {
    const plakaNormal = normalizePlaka(data.plaka);
    if (!plakaNormal || plakaNormal.length < 5) {
      throw new BadRequestException('Geçerli bir plaka girin');
    }
    // Aynı plaka var mı?
    const existing = await (this.prisma as any).arac.findUnique({
      where: { tenantId_plaka: { tenantId, plaka: plakaNormal } },
    });
    if (existing) throw new BadRequestException(`Bu plaka zaten kayıtlı: ${formatPlaka(plakaNormal)}`);

    return (this.prisma as any).arac.create({
      data: {
        tenantId,
        plaka: plakaNormal,
        marka: data.marka?.trim() || null,
        model: data.model?.trim() || null,
        sahipAd: data.sahipAd?.trim() || null,
        taxpayerId: data.taxpayerId || null,
        notlar: data.notlar?.trim() || null,
      },
    });
  }

  async updateArac(
    tenantId: string,
    id: string,
    data: { marka?: string | null; model?: string | null; sahipAd?: string | null; taxpayerId?: string | null; notlar?: string | null; aktif?: boolean },
  ) {
    const arac = await (this.prisma as any).arac.findFirst({ where: { id, tenantId } });
    if (!arac) throw new NotFoundException('Araç bulunamadı');

    return (this.prisma as any).arac.update({
      where: { id },
      data: {
        marka: data.marka === undefined ? undefined : (data.marka?.trim() || null),
        model: data.model === undefined ? undefined : (data.model?.trim() || null),
        sahipAd: data.sahipAd === undefined ? undefined : (data.sahipAd?.trim() || null),
        taxpayerId: data.taxpayerId === undefined ? undefined : (data.taxpayerId || null),
        notlar: data.notlar === undefined ? undefined : (data.notlar?.trim() || null),
        aktif: data.aktif === undefined ? undefined : data.aktif,
      },
    });
  }

  async deleteArac(tenantId: string, id: string) {
    const arac = await (this.prisma as any).arac.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!arac) throw new NotFoundException('Araç bulunamadı');
    await (this.prisma as any).arac.delete({ where: { id } });
  }

  // ════════════ HGS SORGU SONUÇLARI ════════════

  /**
   * Manuel sorgu sonucu kaydet — Chrome agent veya kullanıcı elle girer.
   * İleride Pazartesi cron bu endpoint'i kullanarak otomatik kayıt yapacak.
   */
  async kaydetSorguSonucu(
    tenantId: string,
    aracId: string,
    data: {
      durum: 'basarili' | 'hatali' | 'beklemede';
      ihlalSayisi?: number;
      toplamTutar?: number | null;
      detaylar?: any;
      rawHtml?: string;
      hataMesaji?: string | null;
      kaynak?: 'manuel' | 'cron_pazartesi' | 'tek_sefer';
    },
  ) {
    const arac = await (this.prisma as any).arac.findFirst({ where: { id: aracId, tenantId }, select: { id: true } });
    if (!arac) throw new NotFoundException('Araç bulunamadı');

    return (this.prisma as any).hgsIhlalSorguSonucu.create({
      data: {
        tenantId,
        aracId,
        durum: data.durum,
        ihlalSayisi: data.ihlalSayisi || 0,
        toplamTutar: data.toplamTutar || null,
        detaylar: data.detaylar || null,
        rawHtml: data.rawHtml || null,
        hataMesaji: data.hataMesaji || null,
        kaynak: data.kaynak || 'manuel',
      },
    });
  }

  async listSorguGecmisi(tenantId: string, aracId: string) {
    const arac = await (this.prisma as any).arac.findFirst({ where: { id: aracId, tenantId } });
    if (!arac) throw new NotFoundException('Araç bulunamadı');

    return (this.prisma as any).hgsIhlalSorguSonucu.findMany({
      where: { tenantId, aracId },
      orderBy: { sorguTarihi: 'desc' },
      take: 50,
    });
  }

  /** Dashboard için: toplam araç, ihlalli araç sayısı, toplam tutar */
  async ozet(tenantId: string) {
    const toplamArac = await (this.prisma as any).arac.count({ where: { tenantId, aktif: true } });
    // Her aracın EN SON sorgusuna göre ihlal özeti
    const araclar = await (this.prisma as any).arac.findMany({
      where: { tenantId, aktif: true },
      include: { hgsSonuclari: { orderBy: { sorguTarihi: 'desc' }, take: 1 } },
    });
    let ihlalliArac = 0;
    let toplamIhlal = 0;
    let toplamTutar = 0;
    for (const a of araclar) {
      const sonuc = a.hgsSonuclari?.[0];
      if (sonuc && sonuc.ihlalSayisi > 0) {
        ihlalliArac++;
        toplamIhlal += sonuc.ihlalSayisi;
        toplamTutar += Number(sonuc.toplamTutar || 0);
      }
    }
    return { toplamArac, ihlalliArac, toplamIhlal, toplamTutar };
  }
}
