import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type BeyanTipi =
  | 'KURUMLAR'
  | 'GELIR'
  | 'KDV1'
  | 'KDV2'
  | 'DAMGA'
  | 'MUHSGK'
  | 'POSET'
  | 'BILDIRGE'
  | 'EDEFTER';

type Period = 'AYLIK' | 'UCAYLIK' | null;

/**
 * Mükellef Beyanname Takip — Hattat-stil toplu beyan durumu takibi.
 *
 * İki veri kümesi:
 *  1) TaxpayerBeyanConfig — her mükellefin hangi beyannameleri verdiği (statik)
 *  2) BeyanDurumu — dönem bazlı durum kayıtları (dinamik)
 *
 * listDonemOzet(donem): bir dönem için tüm mükelleflerin "vermesi gereken" beyanname
 * listesini config'e göre üretir, BeyanDurumu ile birleştirip toplam/onaylanan/hatalı/kalan verir.
 */
@Injectable()
export class BeyannameTakipService {
  constructor(private prisma: PrismaService) {}

  // ══════════════════════════════════════════════════════════
  // CONFIG — her mükellefin beyan yapısı
  // ══════════════════════════════════════════════════════════

  async listConfigs(tenantId: string) {
    const taxpayers = await (this.prisma as any).taxpayer.findMany({
      where: { tenantId },
      include: { beyanConfig: true },
      orderBy: [{ companyName: 'asc' }, { firstName: 'asc' }],
    });
    return taxpayers.map((t: any) => ({
      taxpayerId: t.id,
      ad: adFormat(t),
      startDate: t.startDate,
      endDate: t.endDate,
      isActive: t.isActive,
      config: t.beyanConfig || defaultConfig(),
    }));
  }

  async upsertConfig(
    tenantId: string,
    taxpayerId: string,
    data: {
      incomeTaxType?: string | null;
      kdv1Period?: Period;
      kdv2Enabled?: boolean;
      muhtasarPeriod?: Period;
      damgaEnabled?: boolean;
      posetEnabled?: boolean;
      sgkBildirgeEnabled?: boolean;
      eDefterPeriod?: Period;
      notes?: string | null;
    },
  ) {
    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      select: { id: true },
    });
    if (!taxpayer) throw new NotFoundException('Mükellef bulunamadı');

    return (this.prisma as any).taxpayerBeyanConfig.upsert({
      where: { taxpayerId },
      create: { taxpayerId, ...data },
      update: data,
    });
  }

  // ══════════════════════════════════════════════════════════
  // DURUM — dönem bazlı kayıt işlemleri
  // ══════════════════════════════════════════════════════════

  /**
   * Bir döneme ait toplu beyan özetini getir.
   * Config'e göre mükelleflerin o dönem vermesi gereken beyannameler hesaplanır,
   * BeyanDurumu ile birleştirilir, beyan tipi bazında aggregate edilir.
   */
  async listDonemOzet(tenantId: string, donem: string) {
    // donem: "2026-03" formatı
    const [yilStr, ayStr] = donem.split('-');
    const yil = parseInt(yilStr, 10);
    const ay = parseInt(ayStr, 10);
    if (!yil || !ay || ay < 1 || ay > 12) {
      throw new Error(`Geçersiz dönem: ${donem}`);
    }

    // Tüm aktif mükellefleri + config'lerini getir
    const taxpayers = await (this.prisma as any).taxpayer.findMany({
      where: { tenantId, isActive: true },
      include: { beyanConfig: true },
    });

    // İlgili döneme ait tüm BeyanDurumu kayıtlarını çek
    const durumlar = await (this.prisma as any).beyanDurumu.findMany({
      where: { tenantId, donem },
    });
    const durumMap = new Map<string, any>();
    for (const d of durumlar) {
      durumMap.set(`${d.taxpayerId}::${d.beyanTipi}`, d);
    }

    // Her mükellef için hangi beyanları vermesi gerektiğini hesapla
    type Agg = { beyanTipi: BeyanTipi; toplam: number; onaylanan: number; bekleyen: number; hatali: number; muaf: number };
    const agg: Record<BeyanTipi, Agg> = {
      KURUMLAR: blank('KURUMLAR'),
      GELIR:    blank('GELIR'),
      KDV1:     blank('KDV1'),
      KDV2:     blank('KDV2'),
      DAMGA:    blank('DAMGA'),
      MUHSGK:   blank('MUHSGK'),
      POSET:    blank('POSET'),
      BILDIRGE: blank('BILDIRGE'),
      EDEFTER:  blank('EDEFTER'),
    };

    for (const tp of taxpayers) {
      if (!isTaxpayerActiveInPeriod(tp, yil, ay)) continue;
      const cfg = tp.beyanConfig || defaultConfig();
      const beklenen = beklenenBeyanlar(cfg, yil, ay);

      for (const tip of beklenen) {
        agg[tip].toplam++;
        const d = durumMap.get(`${tp.id}::${tip}`);
        if (!d) {
          agg[tip].bekleyen++;
        } else {
          switch (d.durum) {
            case 'onaylandi': agg[tip].onaylanan++; break;
            case 'hatali':   agg[tip].hatali++; break;
            case 'muaf':     agg[tip].muaf++; break;
            default:         agg[tip].bekleyen++;
          }
        }
      }
    }

    // Kalan = bekleyen (hatalı ve muaf sayılmaz kalanlar)
    const rows = Object.values(agg).map((r) => ({
      ...r,
      kalan: r.toplam - r.onaylanan - r.muaf,
      yuzde: r.toplam > 0 ? Math.round(((r.onaylanan) / r.toplam) * 100) : 0,
    }));

    return { donem, rows };
  }

  /** Belirli bir mükellefin belirli bir beyannamesinin durumunu güncelle */
  async upsertDurum(
    tenantId: string,
    taxpayerId: string,
    beyanTipi: BeyanTipi,
    donem: string,
    data: { durum?: string; tahakkukTutari?: number | null; notlar?: string | null },
  ) {
    const tp = await (this.prisma as any).taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      select: { id: true },
    });
    if (!tp) throw new NotFoundException('Mükellef bulunamadı');

    const updateData: any = { ...data };
    if (data.durum === 'onaylandi') updateData.onayTarihi = new Date();

    return (this.prisma as any).beyanDurumu.upsert({
      where: { tenantId_taxpayerId_beyanTipi_donem: { tenantId, taxpayerId, beyanTipi, donem } },
      create: { tenantId, taxpayerId, beyanTipi, donem, ...updateData },
      update: updateData,
    });
  }

  /** Dönem detayı — her mükellef satırda, her beyan tipi sütun */
  async listDonemDetay(tenantId: string, donem: string) {
    const [yilStr, ayStr] = donem.split('-');
    const yil = parseInt(yilStr, 10);
    const ay = parseInt(ayStr, 10);

    const taxpayers = await (this.prisma as any).taxpayer.findMany({
      where: { tenantId, isActive: true },
      include: { beyanConfig: true },
      orderBy: [{ companyName: 'asc' }, { firstName: 'asc' }],
    });

    const durumlar = await (this.prisma as any).beyanDurumu.findMany({
      where: { tenantId, donem },
    });
    const durumMap = new Map<string, any>();
    for (const d of durumlar) {
      durumMap.set(`${d.taxpayerId}::${d.beyanTipi}`, d);
    }

    return taxpayers
      .filter((tp: any) => isTaxpayerActiveInPeriod(tp, yil, ay))
      .map((tp: any) => {
        const cfg = tp.beyanConfig || defaultConfig();
        const beklenen = beklenenBeyanlar(cfg, yil, ay);
        const beyanlar = beklenen.map((tip) => {
          const d = durumMap.get(`${tp.id}::${tip}`);
          return {
            beyanTipi: tip,
            durum: d?.durum || 'beklemede',
            tahakkukTutari: d?.tahakkukTutari || null,
            onayTarihi: d?.onayTarihi || null,
          };
        });
        return {
          taxpayerId: tp.id,
          ad: adFormat(tp),
          beyanlar,
        };
      });
  }
}

// ══════════════════════════════════════════════════════════
// YARDIMCILAR
// ══════════════════════════════════════════════════════════

function blank(tip: BeyanTipi) {
  return { beyanTipi: tip, toplam: 0, onaylanan: 0, bekleyen: 0, hatali: 0, muaf: 0 };
}

function defaultConfig() {
  return {
    incomeTaxType: null,
    kdv1Period: null,
    kdv2Enabled: false,
    muhtasarPeriod: null,
    damgaEnabled: false,
    posetEnabled: false,
    sgkBildirgeEnabled: false,
    eDefterPeriod: null,
    notes: null,
  };
}

function adFormat(tp: { firstName?: string | null; lastName?: string | null; companyName?: string | null }): string {
  if (tp.companyName && tp.companyName.trim()) return tp.companyName.trim();
  return [tp.firstName, tp.lastName].filter(Boolean).join(' ').trim() || '(isimsiz)';
}

function isTaxpayerActiveInPeriod(tp: any, yil: number, ay: number): boolean {
  const donemBaslangic = new Date(yil, ay - 1, 1);
  const donemBitis = new Date(yil, ay, 0); // ayın son günü
  if (tp.startDate) {
    const s = new Date(tp.startDate);
    if (s > donemBitis) return false; // henüz başlamamış
  }
  if (tp.endDate) {
    const e = new Date(tp.endDate);
    if (e < donemBaslangic) return false; // işi bırakmış, dönem öncesi
  }
  return tp.isActive !== false;
}

/**
 * Mükellef config'e göre verilen dönemde hangi beyanname tiplerini vermeli?
 *
 * Aylıklar her ay
 * 3 aylıklar (KDV/MUHSGK): sadece 3/6/9/12. aylarda (Q1/Q2/Q3/Q4 son ayı)
 * POSET 3 aylık: 1/4/7/10 aylarında verilir (önceki çeyrek)
 * Kurumlar: sadece Nisan (4. ay)
 * Gelir: sadece Mart (3. ay)
 * E-Defter aylık: her ay; 3 aylık: 3/6/9/12
 */
function beklenenBeyanlar(cfg: any, yil: number, ay: number): BeyanTipi[] {
  const tipler: BeyanTipi[] = [];

  // KDV1
  if (cfg.kdv1Period === 'AYLIK') tipler.push('KDV1');
  else if (cfg.kdv1Period === 'UCAYLIK' && [3, 6, 9, 12].includes(ay)) tipler.push('KDV1');

  // KDV2 (her ay, tevkifat aylık zorunlu)
  if (cfg.kdv2Enabled) tipler.push('KDV2');

  // Muhtasar/MUHSGK
  if (cfg.muhtasarPeriod === 'AYLIK') tipler.push('MUHSGK');
  else if (cfg.muhtasarPeriod === 'UCAYLIK' && [3, 6, 9, 12].includes(ay)) tipler.push('MUHSGK');

  // Damga (sürekli mükellef → aylık)
  if (cfg.damgaEnabled) tipler.push('DAMGA');

  // Poşet (3 aylık — 1/4/7/10)
  if (cfg.posetEnabled && [1, 4, 7, 10].includes(ay)) tipler.push('POSET');

  // SGK Bildirge (aylık, MUHSGK zaten birleşik ama ayrı bildirgeler için)
  if (cfg.sgkBildirgeEnabled) tipler.push('BILDIRGE');

  // E-Defter
  if (cfg.eDefterPeriod === 'AYLIK') tipler.push('EDEFTER');
  else if (cfg.eDefterPeriod === 'UCAYLIK' && [3, 6, 9, 12].includes(ay)) tipler.push('EDEFTER');

  // Kurumlar (sadece Nisan — önceki yıla ait)
  if (cfg.incomeTaxType === 'KURUMLAR' && ay === 4) tipler.push('KURUMLAR');

  // Gelir (sadece Mart — önceki yıla ait)
  if (cfg.incomeTaxType === 'GELIR' && ay === 3) tipler.push('GELIR');

  return tipler;
}
