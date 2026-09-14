import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GENEL_SORGU_TURLERI, type GenelSorguTuru } from '@mali-musavir/shared';

export type GenelSorguListeSecenekleri = {
  taxpayerId?: string;
  tur?: string;
  donem?: string; // "YYYY-MM"
  page?: number;
  pageSize?: number;
};

export type GenelSorguKayitSecenekleri = {
  donem?: string | null;
  ozet?: string | null;
  kaynak?: 'manual' | 'nightly';
  jobId?: string | null;
};

/** Liste satırında dönen mükellef alanları. */
const TAXPAYER_SELECT = { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true } as const;

const DONEM_DESENI = /^\d{4}-(0[1-9]|1[0-2])$/;

@Injectable()
export class GenelSorgularService {
  constructor(private readonly prisma: PrismaService) {}

  private turDogrula(tur: string | undefined): GenelSorguTuru | undefined {
    if (tur === undefined || tur === null || tur === '') return undefined;
    if (!(GENEL_SORGU_TURLERI as readonly string[]).includes(tur)) {
      throw new BadRequestException(`tur geçersiz: ${GENEL_SORGU_TURLERI.join(' | ')}`);
    }
    return tur as GenelSorguTuru;
  }

  /**
   * GET /genel-sorgular — sonuç listesi (sorguTarihi desc, sayfalı).
   * Süzgeçler: taxpayerId, tur, donem ("YYYY-MM"). pageSize 1-200 (varsayılan 50).
   */
  async listele(tenantId: string, secenek: GenelSorguListeSecenekleri) {
    const tur = this.turDogrula(secenek.tur);
    if (secenek.donem && !DONEM_DESENI.test(secenek.donem)) {
      throw new BadRequestException('donem YYYY-MM biçiminde olmalı');
    }
    const page = Math.max(1, Number(secenek.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(secenek.pageSize) || 50));

    const where: any = { tenantId };
    if (secenek.taxpayerId) where.taxpayerId = secenek.taxpayerId;
    if (tur) where.tur = tur;
    if (secenek.donem) where.donem = secenek.donem;

    const db = this.prisma as any;
    const [rows, total] = await Promise.all([
      db.genelSorguSonucu.findMany({
        where,
        orderBy: { sorguTarihi: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          taxpayerId: true,
          taxpayer: { select: TAXPAYER_SELECT },
          tur: true,
          donem: true,
          sorguTarihi: true,
          ozet: true,
          veri: true,
          kaynak: true,
          whatsappGonderildiMi: true,
        },
      }),
      db.genelSorguSonucu.count({ where }),
    ]);

    return { rows, total, page, pageSize };
  }

  /**
   * GET /genel-sorgular/ozet — tür başına adet + son sorgu zamanı.
   * Sonucu olmayan tür de { adet: 0, sonSorgu: null } ile döner (ekran boş kart çizebilsin).
   */
  async ozet(tenantId: string) {
    const gruplar: Array<{ tur: string; _count: { _all: number }; _max: { sorguTarihi: Date | null } }> =
      await (this.prisma as any).genelSorguSonucu.groupBy({
        by: ['tur'],
        where: { tenantId },
        _count: { _all: true },
        _max: { sorguTarihi: true },
      });

    const sonuc = {} as Record<GenelSorguTuru, { adet: number; sonSorgu: Date | null }>;
    for (const tur of GENEL_SORGU_TURLERI) sonuc[tur] = { adet: 0, sonSorgu: null };
    for (const g of gruplar) {
      if ((GENEL_SORGU_TURLERI as readonly string[]).includes(g.tur)) {
        sonuc[g.tur as GenelSorguTuru] = { adet: g._count._all, sonSorgu: g._max.sorguTarihi ?? null };
      }
    }
    return sonuc;
  }

  /**
   * Sonuç yazma — ileride sorgu işleri (gece cron / elle "Şimdi sorgula") bunu çağıracak.
   * Her çağrı YENİ satır açar (geçmiş korunur). Mükellef tenant'a ait değilse hata.
   */
  async kaydet(
    tenantId: string,
    taxpayerId: string,
    tur: GenelSorguTuru,
    veri: unknown,
    secenek: GenelSorguKayitSecenekleri = {},
  ) {
    this.turDogrula(tur);
    if (secenek.donem && !DONEM_DESENI.test(secenek.donem)) {
      throw new BadRequestException('donem YYYY-MM biçiminde olmalı');
    }
    const tp = await this.prisma.taxpayer.findFirst({ where: { id: taxpayerId, tenantId }, select: { id: true } });
    if (!tp) throw new BadRequestException('Mükellef bu ofise ait değil');

    return (this.prisma as any).genelSorguSonucu.create({
      data: {
        tenantId,
        taxpayerId,
        tur,
        donem: secenek.donem ?? null,
        ozet: secenek.ozet ?? null,
        veri: (veri ?? {}) as any,
        kaynak: secenek.kaynak ?? 'manual',
        jobId: secenek.jobId ?? null,
      },
    });
  }
}
