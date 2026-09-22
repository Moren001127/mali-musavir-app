import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GENEL_SORGU_TURLERI, type GenelSorguTuru } from '@mali-musavir/shared';
import { enSonSonuclar, guncelSatirlar, type GuncelTur, type HamSonuc } from './guncel-durum';

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
   * GET /genel-sorgular/guncel?tur=&taxpayerId=&donem=&page=&pageSize= — GÜNCEL DURUM (koşu geçmişi değil).
   * Mükellef (POS/e-Arşiv'de mükellef+ay) başına EN SON sonucu alır, ekran satırlarına açar (bkz. guncel-durum.ts).
   * `donem` yalnız POS ve GELEN_EARSIV'de anlamlıdır; diğer türlerde yok sayılır (güncel durum ay bağımsız).
   * pageSize 1-5000 (Excel için büyük sayfa).
   */
  async guncel(tenantId: string, secenek: { tur: string; taxpayerId?: string; donem?: string; page?: number; pageSize?: number }) {
    const tur = this.turDogrula(secenek.tur);
    if (!tur) throw new BadRequestException(`tur zorunlu: ${GENEL_SORGU_TURLERI.join(' | ')}`);
    if (secenek.donem && !DONEM_DESENI.test(secenek.donem)) {
      throw new BadRequestException('donem YYYY-MM biçiminde olmalı');
    }
    const page = Math.max(1, Number(secenek.page) || 1);
    const pageSize = Math.min(5000, Math.max(1, Number(secenek.pageSize) || 50));
    const ayBazli = tur === 'POS' || tur === 'GELEN_EARSIV';

    const where: any = { tenantId, tur };
    if (secenek.taxpayerId) where.taxpayerId = secenek.taxpayerId;
    if (ayBazli && secenek.donem) where.donem = secenek.donem;
    const ham: HamSonuc[] = await (this.prisma as any).genelSorguSonucu.findMany({
      where,
      orderBy: { sorguTarihi: 'desc' },
      take: 4000,
      select: { id: true, taxpayerId: true, taxpayer: { select: TAXPAYER_SELECT }, tur: true, donem: true, sorguTarihi: true, kaynak: true, veri: true },
    });
    const enSon = enSonSonuclar(tur as GuncelTur, ham);
    const { rows, ozet } = guncelSatirlar(tur as GuncelTur, enSon);
    const total = rows.length;
    return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, ozet };
  }

  /**
   * GET /genel-sorgular/earsiv-eksik — "Görseli eksik faturalar" (2026-09-22).
   * Dijital Vergi Dairesi'nden çekilen GELEN e-Arşiv listesi (GenelSorguSonucu GELEN_EARSIV; mükellef+dönem başına
   * EN SON sorgu) ile Luca'dan indirilen alış e-Arşiv/e-Fatura kayıtları (EarsivFatura tip ALIS) karşılaştırılır.
   *   LUCA_YOK   → fatura Luca çekiminde hiç yok (fatura no + satıcı VKN eşleşmedi)
   *   GORSEL_YOK → Luca'da kayıt var ama PDF/HTML görseli inmemiş
   * Eşleşme anahtarı: faturaNo + satıcı VKN (GİB belge no küresel benzersiz DEĞİL); VKN yoksa yalnız faturaNo.
   * Fatura Merkezi'ne hiçbir şey yazılmaz (yalnız liste).
   */
  async eksikGorseller(tenantId: string, secenek: { taxpayerId?: string; donem?: string }) {
    if (secenek.donem && !DONEM_DESENI.test(secenek.donem)) {
      throw new BadRequestException('donem YYYY-MM biçiminde olmalı');
    }
    const db = this.prisma as any;
    const where: any = { tenantId, tur: 'GELEN_EARSIV' };
    if (secenek.taxpayerId) where.taxpayerId = secenek.taxpayerId;
    if (secenek.donem) where.donem = secenek.donem;
    const sonuclar: any[] = await db.genelSorguSonucu.findMany({
      where,
      orderBy: { sorguTarihi: 'desc' },
      take: 600,
      select: { taxpayerId: true, donem: true, sorguTarihi: true, veri: true, taxpayer: { select: TAXPAYER_SELECT } },
    });
    // Mükellef + dönem başına en son sorgu
    const sonSorgu = new Map<string, any>();
    for (const r of sonuclar) {
      const k = `${r.taxpayerId}::${r.donem || ''}`;
      if (!sonSorgu.has(k)) sonSorgu.set(k, r);
    }
    type DvdFatura = { taxpayerId: string; taxpayer: any; donem: string | null; sorguTarihi: Date; faturaNo: string; saticiVkn: string; saticiUnvan: string; duzenlenmeTarihi: string | null; odenecekTutar: number; toplamTutar: number; vergilerTutari: number };
    const dvd: DvdFatura[] = [];
    for (const r of sonSorgu.values()) {
      const faturalar: any[] = Array.isArray(r.veri?.faturalar) ? r.veri.faturalar : [];
      for (const f of faturalar) {
        const faturaNo = String(f?.faturaNo || '').trim();
        if (!faturaNo) continue;
        dvd.push({
          taxpayerId: r.taxpayerId, taxpayer: r.taxpayer, donem: r.donem ?? null, sorguTarihi: r.sorguTarihi,
          faturaNo, saticiVkn: String(f?.saticiVkn || '').trim(), saticiUnvan: String(f?.saticiUnvan || '').trim(),
          duzenlenmeTarihi: f?.duzenlenmeTarihi ?? null,
          odenecekTutar: Number(f?.odenecekTutar) || 0, toplamTutar: Number(f?.toplamTutar) || 0, vergilerTutari: Number(f?.vergilerTutari) || 0,
        });
      }
    }
    if (!dvd.length) return { rows: [], ozet: { dvd: 0, lucaVar: 0, lucaYok: 0, gorselYok: 0, sorguSayisi: sonSorgu.size } };

    const taxpayerIds = Array.from(new Set(dvd.map((d) => d.taxpayerId)));
    const faturaNolar = Array.from(new Set(dvd.map((d) => d.faturaNo)));
    const lucaKayitlari: any[] = [];
    for (let i = 0; i < faturaNolar.length; i += 500) {
      const parca = await db.earsivFatura.findMany({
        where: { tenantId, taxpayerId: { in: taxpayerIds }, tip: 'ALIS', faturaNo: { in: faturaNolar.slice(i, i + 500) } },
        select: { taxpayerId: true, faturaNo: true, saticiVergiNo: true, pdfStorageKey: true, htmlStorageKey: true, belgeKaynak: true, faturaTarihi: true },
      });
      lucaKayitlari.push(...parca);
    }
    // Anahtar: mükellef::faturaNo::vkn ve mükellef::faturaNo (VKN'siz yedek)
    const gorselli = new Set<string>();
    const kayitli = new Set<string>();
    for (const k of lucaKayitlari) {
      const vkn = String(k.saticiVergiNo || '').trim();
      const anahtarlar = [`${k.taxpayerId}::${k.faturaNo}::${vkn}`, `${k.taxpayerId}::${k.faturaNo}::`];
      for (const a of anahtarlar) {
        kayitli.add(a);
        if (k.pdfStorageKey || k.htmlStorageKey) gorselli.add(a);
      }
    }
    const rows = [];
    let lucaVar = 0;
    for (const d of dvd) {
      const tam = `${d.taxpayerId}::${d.faturaNo}::${d.saticiVkn}`;
      const kisa = `${d.taxpayerId}::${d.faturaNo}::`;
      const varMi = kayitli.has(tam) || kayitli.has(kisa);
      const gorselVarMi = gorselli.has(tam) || gorselli.has(kisa);
      if (varMi && gorselVarMi) { lucaVar++; continue; }
      rows.push({
        taxpayerId: d.taxpayerId, taxpayer: d.taxpayer, donem: d.donem, sorguTarihi: d.sorguTarihi,
        faturaNo: d.faturaNo, duzenlenmeTarihi: d.duzenlenmeTarihi, saticiUnvan: d.saticiUnvan, saticiVkn: d.saticiVkn,
        toplamTutar: d.toplamTutar, vergilerTutari: d.vergilerTutari, odenecekTutar: d.odenecekTutar,
        durum: varMi ? 'GORSEL_YOK' : 'LUCA_YOK',
      });
    }
    rows.sort((a, b) => String(b.duzenlenmeTarihi || '').localeCompare(String(a.duzenlenmeTarihi || '')));
    return {
      rows,
      ozet: { dvd: dvd.length, lucaVar, lucaYok: rows.filter((r) => r.durum === 'LUCA_YOK').length, gorselYok: rows.filter((r) => r.durum === 'GORSEL_YOK').length, sorguSayisi: sonSorgu.size },
    };
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
