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

  // ════════════ TOPLU OTOMATIK SORGU (AgentCommand köprüsü) ════════════

  /**
   * Portal UI'ından veya Cron'dan tetiklenir.
   * AgentCommand tablosuna 'hgs'/'toplu-sorgu' komutu yazar — local hgs-agent
   * `/agent/commands/claim` endpoint'iyle bu komutu alıp çalıştırır.
   *
   * Aynı anda birden fazla pending komutu engellemek için basit kontrol var.
   */
  async baslatTopluSorgu(
    tenantId: string,
    userId: string | null,
    opts: { aracIds?: string[]; sadeceAktif?: boolean } = {},
  ) {
    // Zaten bekleyen veya çalışan bir HGS komutu var mı?
    const mevcut = await (this.prisma as any).agentCommand.findFirst({
      where: {
        tenantId,
        agent: 'hgs',
        action: 'toplu-sorgu',
        status: { in: ['pending', 'running'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (mevcut) {
      return {
        ok: false,
        sebep: 'Zaten çalışan bir toplu sorgu komutu var',
        komutId: mevcut.id,
        durum: mevcut.status,
        olusturmaZamani: mevcut.createdAt,
      };
    }

    // Sorgulanacak araçları belirle
    const where: any = { tenantId };
    if (opts.sadeceAktif) where.aktif = true;
    if (opts.aracIds && opts.aracIds.length > 0) where.id = { in: opts.aracIds };

    const araclar = await (this.prisma as any).arac.findMany({
      where,
      select: { id: true, plaka: true },
    });

    if (araclar.length === 0) {
      return { ok: false, sebep: 'Sorgulanacak araç bulunamadı', araclar: 0 };
    }

    const komut = await (this.prisma as any).agentCommand.create({
      data: {
        tenantId,
        agent: 'hgs',
        action: 'toplu-sorgu',
        payload: {
          aracIds: araclar.map((a: any) => a.id),
          plakalar: araclar.map((a: any) => a.plaka),
          tarih: new Date().toISOString(),
          tetikleyici: userId ? 'manuel' : 'cron_pazartesi',
        },
        status: 'pending',
        createdBy: userId,
      },
    });

    return {
      ok: true,
      komutId: komut.id,
      aracSayisi: araclar.length,
      mesaj: `${araclar.length} plaka için sorgu komutu oluşturuldu. Local HGS agent yakında çalıştıracak.`,
    };
  }

  /** Agent'ın son ping'i, running durumu, son meta bilgisi */
  async agentDurumu(tenantId: string) {
    const status = await (this.prisma as any).agentStatus.findUnique({
      where: { tenantId_agent: { tenantId, agent: 'hgs' } },
    }).catch(() => null);

    // Aktif komut var mı?
    const aktifKomut = await (this.prisma as any).agentCommand.findFirst({
      where: {
        tenantId,
        agent: 'hgs',
        status: { in: ['pending', 'running'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Son tamamlanan komut (ne zaman, ne kadar sürdü)
    const sonKomut = await (this.prisma as any).agentCommand.findFirst({
      where: {
        tenantId,
        agent: 'hgs',
        status: { in: ['done', 'failed'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    const now = Date.now();
    const lastPingMs = status?.lastPing ? new Date(status.lastPing).getTime() : 0;
    const pingYasi = lastPingMs > 0 ? Math.floor((now - lastPingMs) / 1000) : null; // saniye
    const canli = pingYasi !== null && pingYasi < 120; // 2 dk içinde ping varsa canlı say

    return {
      status: status || null,
      canli,
      pingYasiSaniye: pingYasi,
      aktifKomut,
      sonKomut,
    };
  }

  /** Son 20 komut — durum takibi */
  async komutKuyrugu(tenantId: string) {
    return (this.prisma as any).agentCommand.findMany({
      where: { tenantId, agent: 'hgs' },
      orderBy: { createdAt: 'desc' },
      take: 20,
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
