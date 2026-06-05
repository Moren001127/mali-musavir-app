import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type BeyanTipi =
  | 'KURUMLAR'
  | 'GELIR'
  | 'KDV1'
  | 'KDV2'
  | 'KDV4'
  | 'KDV9015'
  | 'DAMGA'
  | 'MUHSGK'
  | 'MUHSGK2'
  | 'GGECICI'
  | 'KGECICI'
  | 'POSET'
  | 'BILDIRGE'
  | 'EDEFTER'
  | 'OTV1'
  | 'OTV3A'
  | 'OTV3B'
  | 'OTV4'
  | 'KONAKLAMA'
  | 'OIV'
  | 'GMSI'
  | 'TURIZM';

type Period = 'AYLIK' | 'UCAYLIK' | 'ON_BES_GUNLUK' | null;
export type DonemTuru = 'VERILME' | 'VERGI';

const ALL_BEYAN_TIPLERI: BeyanTipi[] = [
  'KURUMLAR', 'GELIR',
  'KDV1', 'KDV2', 'KDV4', 'KDV9015',
  'DAMGA', 'MUHSGK', 'MUHSGK2',
  'GGECICI', 'KGECICI',
  'POSET', 'BILDIRGE', 'EDEFTER',
  'OTV1', 'OTV3A', 'OTV3B', 'OTV4',
  'KONAKLAMA', 'OIV', 'GMSI', 'TURIZM',
];

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
    // Sadece aktif + işi bırakmamış mükellefleri göster
    const now = new Date();
    const taxpayers = await (this.prisma as any).taxpayer.findMany({
      where: {
        tenantId,
        isActive: true,
        // endDate dolu ve geçmişte ise (işi bırakmış) hariç tut
        OR: [
          { endDate: null },
          { endDate: { gt: now } },
        ],
      },
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
      // v1.37.1 — Hattat tarzı genişletme
      kdv4Period?: Period | null;
      kdv9015Period?: Period | null;
      gelirGeciciPeriod?: Period | null;
      kurumGeciciPeriod?: Period | null;
      otv1Period?: Period | null;
      otv3aPeriod?: Period | null;
      otv3bPeriod?: Period | null;
      otv4Period?: Period | null;
      muhtasar2Period?: Period | null;
      turizmPeriod?: Period | null;
      konaklamaEnabled?: boolean;
      oivEnabled?: boolean;
      gmsiEnabled?: boolean;
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
  async listDonemOzet(tenantId: string, donem: string, donemTuru: DonemTuru = 'VERILME') {
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

    // İlgili dönem ve olası beyan kayıt dönemlerini çek. Hattat/e-Beyanname
    // importları BeyanKaydi üretip BeyanDurumu üretmemişse de dashboard onaylı sayabilsin.
    const donemAdaylari = donemCandidatesForLookup(yil, ay, donem);
    const durumlar = await (this.prisma as any).beyanDurumu.findMany({
      where: { tenantId, donem: { in: donemAdaylari } },
    });
    const durumMap = new Map<string, any>();
    for (const d of durumlar) {
      durumMap.set(`${d.taxpayerId}::${d.beyanTipi}::${d.donem}`, d);
    }

    const kayitlar = await (this.prisma as any).beyanKaydi.findMany({
      where: { tenantId, donem: { in: donemAdaylari } },
      select: { taxpayerId: true, beyanTipi: true, donem: true, tahakkukTutari: true, beyanTarihi: true },
    });
    const kayitMap = new Map<string, any>();
    for (const k of kayitlar) {
      const key = `${k.taxpayerId}::${k.beyanTipi}::${k.donem}`;
      if (!kayitMap.has(key)) kayitMap.set(key, k);
    }

    // Her mükellef için hangi beyanları vermesi gerektiğini hesapla
    type Agg = { beyanTipi: BeyanTipi; toplam: number; onaylanan: number; bekleyen: number; hatali: number; muaf: number; kalan: number };
    const agg = Object.fromEntries(ALL_BEYAN_TIPLERI.map((tip) => [tip, blank(tip)])) as Record<BeyanTipi, Agg>;

    for (const tp of taxpayers) {
      if (!isTaxpayerActiveInPeriod(tp, yil, ay)) continue;
      const cfg = tp.beyanConfig || defaultConfig();
      const beklenen = beklenenBeyanlar(cfg, yil, ay, donemTuru);

      for (const tip of beklenen) {
        agg[tip].toplam++;
        const resolved = resolveBeyanState(durumMap, kayitMap, tp.id, tip, yil, ay, donem, donemTuru);
        switch (resolved.durum) {
          case 'onaylandi': agg[tip].onaylanan++; break;
          case 'hatali':    agg[tip].hatali++; break;
          case 'muaf':      agg[tip].muaf++; break;
          case 'kalan':     agg[tip].kalan++; break;
          default:          agg[tip].bekleyen++;
        }
      }
    }

    const rows = Object.values(agg).map((r) => ({
      ...r,
      vergiDonem: vergiDonemForTip(r.beyanTipi as BeyanTipi, yil, ay, donem, donemTuru),
      yuzde: r.toplam > 0 ? Math.round(((r.onaylanan) / r.toplam) * 100) : 0,
    }));

    return { donem, donemTuru, rows };
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
  async listDonemDetay(tenantId: string, donem: string, donemTuru: DonemTuru = 'VERILME') {
    const [yilStr, ayStr] = donem.split('-');
    const yil = parseInt(yilStr, 10);
    const ay = parseInt(ayStr, 10);

    const taxpayers = await (this.prisma as any).taxpayer.findMany({
      where: { tenantId, isActive: true },
      include: { beyanConfig: true },
      orderBy: [{ companyName: 'asc' }, { firstName: 'asc' }],
    });

    const donemAdaylari = donemCandidatesForLookup(yil, ay, donem);
    const durumlar = await (this.prisma as any).beyanDurumu.findMany({
      where: { tenantId, donem: { in: donemAdaylari } },
    });
    const durumMap = new Map<string, any>();
    for (const d of durumlar) {
      durumMap.set(`${d.taxpayerId}::${d.beyanTipi}::${d.donem}`, d);
    }

    const kayitlar = await (this.prisma as any).beyanKaydi.findMany({
      where: { tenantId, donem: { in: donemAdaylari } },
      select: { taxpayerId: true, beyanTipi: true, donem: true, tahakkukTutari: true, beyanTarihi: true },
    });
    const kayitMap = new Map<string, any>();
    for (const k of kayitlar) {
      const key = `${k.taxpayerId}::${k.beyanTipi}::${k.donem}`;
      if (!kayitMap.has(key)) kayitMap.set(key, k);
    }

    return taxpayers
      .filter((tp: any) => isTaxpayerActiveInPeriod(tp, yil, ay))
      .map((tp: any) => {
        const cfg = tp.beyanConfig || defaultConfig();
        const beklenen = beklenenBeyanlar(cfg, yil, ay, donemTuru);
        const beyanlar = beklenen.map((tip) => {
          const resolved = resolveBeyanState(durumMap, kayitMap, tp.id, tip, yil, ay, donem, donemTuru);
          return {
            beyanTipi: tip,
            durum: resolved.durum,
            vergiDonem: vergiDonemForTip(tip, yil, ay, donem, donemTuru),
            tahakkukTutari: resolved.durumKaydi?.tahakkukTutari || resolved.beyanKaydi?.tahakkukTutari || null,
            onayTarihi: resolved.durumKaydi?.onayTarihi || resolved.beyanKaydi?.beyanTarihi || null,
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
  return { beyanTipi: tip, toplam: 0, onaylanan: 0, bekleyen: 0, hatali: 0, muaf: 0, kalan: 0 };
}

function defaultConfig() {
  return {
    incomeTaxType: null,
    kdv1Period: null,
    kdv2Enabled: false,
    kdv4Period: null,
    kdv9015Period: null,
    muhtasarPeriod: null,
    muhtasar2Period: null,
    gelirGeciciPeriod: null,
    kurumGeciciPeriod: null,
    otv1Period: null,
    otv3aPeriod: null,
    otv3bPeriod: null,
    otv4Period: null,
    damgaEnabled: false,
    posetEnabled: false,
    sgkBildirgeEnabled: false,
    konaklamaEnabled: false,
    oivEnabled: false,
    gmsiEnabled: false,
    turizmPeriod: null,
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

function periodDue(period: Period | undefined, ay: number, donemTuru: DonemTuru): boolean {
  if (period === 'AYLIK' || period === 'ON_BES_GUNLUK') return true;
  if (period === 'UCAYLIK') return (donemTuru === 'VERGI' ? [3, 6, 9, 12] : [1, 4, 7, 10]).includes(ay);
  return false;
}

function posetDue(ay: number, donemTuru: DonemTuru): boolean {
  return (donemTuru === 'VERGI' ? [3, 6, 9, 12] : [1, 4, 7, 10]).includes(ay);
}

/**
 * Geçici vergi (gelir/kurum) 3 aylık takvimi — poşet/KDV'den FARKLI.
 *   Verilme ayları: Q1→Mayıs(5), Q2→Ağustos(8), Q3→Kasım(11), Q4→Şubat(2, sonraki yıl)
 *   Vergi (çeyrek sonu) ayları: 3, 6, 9, 12
 * (4. dönem kullanıcı tercihiyle takip ediliyor; güncel mevzuatta Q4 yıllık beyana dahildir.)
 */
function geciciDue(ay: number, donemTuru: DonemTuru): boolean {
  return (donemTuru === 'VERGI' ? [3, 6, 9, 12] : [2, 5, 8, 11]).includes(ay);
}

/** Geçici vergi için ilgili çeyrek dönem anahtarı (örn. "2026-Q1"). */
function geciciVergiQuarter(yil: number, ay: number, donemTuru: DonemTuru): string {
  if (donemTuru === 'VERGI') {
    return `${yil}-Q${Math.ceil(ay / 3)}`; // 3→Q1, 6→Q2, 9→Q3, 12→Q4
  }
  // VERILME: hangi ayda hangi çeyreğin beyannamesi verilir
  if (ay === 2) return `${yil - 1}-Q4`; // Şubat → bir önceki yılın Q4'ü
  if (ay === 5) return `${yil}-Q1`;
  if (ay === 8) return `${yil}-Q2`;
  if (ay === 11) return `${yil}-Q3`;
  return `${yil}-Q${Math.ceil(ay / 3)}`; // güvenli yedek
}

/**
 * Bir beyanname tipinin, seçilen döneme karşılık gelen VERGİ DÖNEMİ anahtarını döner.
 * (lookupKeysForExpected ile aynı kuralı yansıtır — gösterimde "verilme + vergi dönemi" için.)
 *   Aylık → bir önceki ay (verilme) / seçili ay (vergi)
 *   Geçici → ilgili çeyrek (Mayıs→Q1 vb.)
 *   Kurumlar/Gelir/GMSI → yıllık
 */
function vergiDonemForTip(
  tip: BeyanTipi,
  yil: number,
  ay: number,
  donem: string,
  donemTuru: DonemTuru,
): string {
  const prev = previousMonth(yil, ay);
  if (tip === 'KURUMLAR' || tip === 'GELIR' || tip === 'GMSI') {
    return donemTuru === 'VERGI' ? `${yil}-YIL` : `${yil - 1}-YIL`;
  }
  if (tip === 'GGECICI' || tip === 'KGECICI') {
    return geciciVergiQuarter(yil, ay, donemTuru);
  }
  return donemTuru === 'VERGI' ? donem : monthDonem(prev.yil, prev.ay);
}

function previousMonth(yil: number, ay: number) {
  if (ay === 1) return { yil: yil - 1, ay: 12 };
  return { yil, ay: ay - 1 };
}

function monthDonem(yil: number, ay: number) {
  return `${yil}-${String(ay).padStart(2, '0')}`;
}

function quarterDonem(yil: number, ay: number) {
  return `${yil}-Q${Math.ceil(ay / 3)}`;
}

function donemCandidatesForLookup(yil: number, ay: number, donem: string) {
  const prev = previousMonth(yil, ay);
  return Array.from(new Set([
    donem,
    monthDonem(prev.yil, prev.ay),
    `${yil}-YIL`,
    `${yil - 1}-YIL`,
    quarterDonem(yil, ay),
    quarterDonem(prev.yil, prev.ay),
    // Geçici vergi çeyreği (verilme: Mayıs→Q1, Ağustos→Q2, Kasım→Q3, Şubat→önceki yıl Q4)
    geciciVergiQuarter(yil, ay, 'VERGI'),
    geciciVergiQuarter(yil, ay, 'VERILME'),
  ]));
}

function resolveBeyanState(
  durumIndex: Map<string, any>,
  kayitIndex: Map<string, any>,
  taxpayerId: string,
  tip: BeyanTipi,
  yil: number,
  ay: number,
  donem: string,
  donemTuru: DonemTuru,
) {
  for (const candidate of lookupKeysForExpected(tip, yil, ay, donem, donemTuru)) {
    const key = `${taxpayerId}::${candidate.tip}::${candidate.donem}`;
    const durumKaydi = durumIndex.get(key);
    const beyanKaydi = kayitIndex.get(key);
    if (durumKaydi) {
      if (durumKaydi.durum === 'beklemede') {
        if (beyanKaydi) return { durum: 'onaylandi', durumKaydi, beyanKaydi };
        if (isEDeclarationApprovalPending(durumKaydi)) return { durum: 'beklemede', durumKaydi, beyanKaydi };
        continue;
      }
      const durum = durumKaydi.durum;
      return { durum, durumKaydi, beyanKaydi };
    }
    if (beyanKaydi) return { durum: 'onaylandi', durumKaydi: null, beyanKaydi };
  }
  return { durum: 'kalan', durumKaydi: null, beyanKaydi: null };
}

function isEDeclarationApprovalPending(durumKaydi: any): boolean {
  const note = String(durumKaydi?.notlar || '').toLowerCase();
  return /gib agent onay bekliyor|e-beyanname onay bekliyor|portal-automation.*onay/.test(note);
}

function lookupKeysForExpected(tip: BeyanTipi, yil: number, ay: number, donem: string, donemTuru: DonemTuru) {
  const prev = previousMonth(yil, ay);
  const tipler = new Set<string>([tip]);
  if (tip === 'GGECICI' || tip === 'KGECICI') tipler.add('GECICI_VERGI');
  if (tip === 'MUHSGK2') tipler.add('MUHSGK');

  const donemler = new Set<string>();
  if (tip === 'KURUMLAR' || tip === 'GELIR' || tip === 'GMSI') {
    donemler.add(donemTuru === 'VERGI' ? `${yil}-YIL` : `${yil - 1}-YIL`);
  } else if (tip === 'GGECICI' || tip === 'KGECICI') {
    donemler.add(geciciVergiQuarter(yil, ay, donemTuru));
  } else {
    donemler.add(donemTuru === 'VERGI' ? donem : monthDonem(prev.yil, prev.ay));
  }

  const keys: Array<{ tip: string; donem: string }> = [];
  for (const t of tipler) {
    for (const d of donemler) keys.push({ tip: t, donem: d });
  }
  return keys;
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
function beklenenBeyanlar(cfg: any, yil: number, ay: number, donemTuru: DonemTuru): BeyanTipi[] {
  const tipler: BeyanTipi[] = [];

  // KDV1
  if (cfg.kdv1Period === 'AYLIK') tipler.push('KDV1');
  else if (periodDue(cfg.kdv1Period, ay, donemTuru)) tipler.push('KDV1');

  // KDV2 (her ay, tevkifat aylık zorunlu)
  if (cfg.kdv2Enabled) tipler.push('KDV2');
  if (periodDue(cfg.kdv4Period, ay, donemTuru)) tipler.push('KDV4');
  if (periodDue(cfg.kdv9015Period, ay, donemTuru)) tipler.push('KDV9015');

  // Muhtasar/MUHSGK
  if (cfg.muhtasarPeriod === 'AYLIK') tipler.push('MUHSGK');
  else if (periodDue(cfg.muhtasarPeriod, ay, donemTuru)) tipler.push('MUHSGK');
  if (periodDue(cfg.muhtasar2Period, ay, donemTuru)) tipler.push('MUHSGK2');
  if (cfg.gelirGeciciPeriod && geciciDue(ay, donemTuru)) tipler.push('GGECICI');
  if (cfg.kurumGeciciPeriod && geciciDue(ay, donemTuru)) tipler.push('KGECICI');

  // Damga (sürekli mükellef → aylık)
  if (cfg.damgaEnabled) tipler.push('DAMGA');

  // Poşet (3 aylık — 1/4/7/10)
  if (cfg.posetEnabled && posetDue(ay, donemTuru)) tipler.push('POSET');

  // SGK Bildirge (aylık, MUHSGK zaten birleşik ama ayrı bildirgeler için)
  if (cfg.sgkBildirgeEnabled) tipler.push('BILDIRGE');

  // E-Defter
  if (cfg.eDefterPeriod === 'AYLIK') tipler.push('EDEFTER');
  else if (periodDue(cfg.eDefterPeriod, ay, donemTuru)) tipler.push('EDEFTER');
  if (periodDue(cfg.otv1Period, ay, donemTuru)) tipler.push('OTV1');
  if (periodDue(cfg.otv3aPeriod, ay, donemTuru)) tipler.push('OTV3A');
  if (periodDue(cfg.otv3bPeriod, ay, donemTuru)) tipler.push('OTV3B');
  if (periodDue(cfg.otv4Period, ay, donemTuru)) tipler.push('OTV4');
  if (cfg.konaklamaEnabled) tipler.push('KONAKLAMA');
  if (cfg.oivEnabled) tipler.push('OIV');
  if (cfg.gmsiEnabled && (donemTuru === 'VERGI' ? ay === 12 : ay === 3)) tipler.push('GMSI');
  if (periodDue(cfg.turizmPeriod, ay, donemTuru)) tipler.push('TURIZM');

  // Kurumlar (sadece Nisan — önceki yıla ait)
  if (cfg.incomeTaxType === 'KURUMLAR' && (donemTuru === 'VERGI' ? ay === 12 : ay === 4)) tipler.push('KURUMLAR');

  // Gelir (sadece Mart — önceki yıla ait)
  if (cfg.incomeTaxType === 'GELIR' && (donemTuru === 'VERGI' ? ay === 12 : ay === 3)) tipler.push('GELIR');

  return tipler;
}
