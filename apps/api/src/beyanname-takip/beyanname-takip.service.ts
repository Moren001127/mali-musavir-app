import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EDEFTER_BELGE_ETIKETLERI, eDefterDonemEtiketi, type EDefterMukellefTipi, type EDefterTercih } from '@mali-musavir/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  eDefterBaslangicCoz,
  eDefterBeklenenDonemler,
  eDefterBeratVerildiMi,
  eDefterDurumCoz,
  eDefterOzetVergiDonemi,
  eDefterSonYukleme,
  eDefterTercihCoz,
  eDefterTipiCoz,
  type EDefterBeklenenDonem,
  type EDefterDurum,
} from './edefter-takip';

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
        // WhatsApp Mesaj Merkezi'nin sanal kayıtları (WHATSAPP-*) gerçek mükellef değil — sayma.
        taxNumber: { not: { startsWith: 'WHATSAPP-' } },
        // endDate dolu ve geçmişte ise (işi bırakmış) hariç tut
        OR: [
          { endDate: null },
          { endDate: { gt: now } },
        ],
      },
      include: { beyanConfig: true, portalCredentials: sgkCredentialInclude() },
      orderBy: [{ companyName: 'asc' }, { firstName: 'asc' }],
    });
    return taxpayers.map((t: any) => ({
      taxpayerId: t.id,
      ad: adFormat(t),
      startDate: t.startDate,
      endDate: t.endDate,
      isActive: t.isActive,
      config: effectiveBeyanConfig(t),
    }));
  }

  // Tek mükellefin mükellefiyet ayarı — AKTİF/PASİF ve işi-bırakma (endDate) FİLTRESİZ.
  // listConfigs "işi bırakmış" mükellefi gizlediği için kapanmış firmada ayarlar geri
  // gelmiyordu (kaydedildiği halde "silinmiş" görünüyordu). Kart bu ucu kullanır.
  async getConfig(tenantId: string, taxpayerId: string) {
    const tp = await (this.prisma as any).taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      include: { beyanConfig: true, portalCredentials: sgkCredentialInclude() },
    });
    if (!tp) throw new NotFoundException('Mükellef bulunamadı');
    return {
      taxpayerId: tp.id,
      ad: adFormat(tp),
      startDate: tp.startDate,
      endDate: tp.endDate,
      isActive: tp.isActive,
      config: effectiveBeyanConfig(tp),
    };
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
      // e-Defter mükellefiyetinin başladığı ay "YYYY-MM" (Hattat "Başlangıç"); null = sınırsız (2026-09-22)
      eDefterBaslangic?: string | null;
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

    // eDefterBaslangic: boş → null; doluysa "YYYY-MM" olmalı (ör. 2026-07).
    if (Object.prototype.hasOwnProperty.call(data, 'eDefterBaslangic')) {
      const ham = data.eDefterBaslangic;
      if (ham === null || ham === undefined || String(ham).trim() === '') {
        data.eDefterBaslangic = null;
      } else {
        const temiz = eDefterBaslangicCoz(String(ham).trim());
        if (!temiz) throw new BadRequestException('e-Defter başlangıç ayı YYYY-AA biçiminde olmalı (ör. 2026-07)');
        data.eDefterBaslangic = temiz;
      }
    }

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
  /**
   * SGK e-Bildirge tahakkuk fişi indirilmiş (= aylık bildirge SGK'ya verilmiş) mükellef id seti.
   * PortalDocument.period 'YYYY/MM' (örn 2026/04); beyanname-takip vergiDonem 'YYYY-MM' → ikisini de dener.
   */
  private async sgkBildirgeVerilenSet(tenantId: string, vergiDonem: string): Promise<Set<string>> {
    const donemler = Array.from(new Set([vergiDonem, vergiDonem.replace('-', '/')]));
    const docs = await (this.prisma as any).portalDocument.findMany({
      where: { tenantId, belgeTuru: 'SGK_TAHAKKUK', storageKey: { not: null }, period: { in: donemler } },
      select: { taxpayerId: true },
    }).catch(() => []);
    const set = new Set<string>();
    for (const d of docs || []) { if (d.taxpayerId) set.add(d.taxpayerId); }
    return set;
  }

  /** "1.234,56" / "0,00" → number. Boş/geçersiz → 0. */
  private parseTrTutar(v: unknown): number {
    if (v == null) return 0;
    const n = Number(String(v).replace(/\./g, '').replace(',', '.').trim());
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * KDV2 (2 No.lu KDV / tevkifat beyannamesi) GEREKEN mükellef kümesi.
   *
   * İş kuralı: KDV2 yalnız TEVKİFATLI ALIMI olan mükellef için verilir. Bu yüzden
   * "alış (KDV_191) kontrol seansı VAR" yetmez — o dönem alış belgelerinde GERÇEK
   * tevkifat (ocr/confirmed tevkifat tutarı > 0) bulunmalı. Aksi halde tevkifatsız
   * mükellef de yanlışlıkla KDV2'ye düşüyordu.
   */
  private async computeKdv2OcrSet(tenantId: string, vergiDonem: string): Promise<Set<string>> {
    const set = new Set<string>();
    const donemler = Array.from(new Set([vergiDonem, vergiDonem.replace('-', '/')]));
    // 1) Mihsap tevkifatlı alış faturası (faturaTuru tevkifat bilgisi taşıyorsa)
    const tevkifatliInvoices = await (this.prisma as any).mihsapInvoice.findMany({
      where: {
        tenantId,
        donem: vergiDonem,
        AND: [{ faturaTuru: { contains: 'TEVKIFAT' } }, { faturaTuru: { contains: 'ALIS' } }],
      },
      select: { mukellefId: true },
      distinct: ['mukellefId'],
    }).catch(() => []);
    for (const i of tevkifatliInvoices || []) { if (i.mukellefId) set.add(i.mukellefId); }
    // 2) OCR/KDV kontrolü: alış seansında tevkifat tutarı > 0 olan fatura bulunan mükellef
    const alisImages = await (this.prisma as any).receiptImage.findMany({
      where: {
        session: { tenantId, type: { in: ['KDV_191', 'ISLETME_GIDER'] }, periodLabel: { in: donemler } },
      },
      select: {
        confirmedKdvTevkifat: true,
        ocrKdvTevkifat: true,
        session: { select: { taxpayerId: true } },
      },
    }).catch(() => []);
    for (const im of alisImages || []) {
      const tev = this.parseTrTutar(im.confirmedKdvTevkifat ?? im.ocrKdvTevkifat);
      if (tev > 0 && im.session?.taxpayerId) set.add(im.session.taxpayerId);
    }
    return set;
  }

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
      where: { tenantId, isActive: true, taxNumber: { not: { startsWith: 'WHATSAPP-' } } },
      include: { beyanConfig: true, portalCredentials: sgkCredentialInclude() },
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

    // KDV2 OCR oto-tespiti: mihsap tevkifatlı alış faturaları olan mükellefler
    const vergiYil = donemTuru === 'VERILME' ? (ay === 1 ? yil - 1 : yil) : yil;
    const vergiAy  = donemTuru === 'VERILME' ? (ay === 1 ? 12 : ay - 1) : ay;
    const vergiDonem = `${vergiYil}-${String(vergiAy).padStart(2, '0')}`;
    // KDV2: tevkifatlı ALIMI olan mükellef (gerçek tevkifat tutarı > 0) — detay için computeKdv2OcrSet
    const kdv2OcrSet = await this.computeKdv2OcrSet(tenantId, vergiDonem);

    // SGK Bildirge: tahakkuk fişi indirildiyse bildirge verilmiş say (BeyanDurumu/BeyanKaydi yoksa da).
    const sgkBildirgeSet = await this.sgkBildirgeVerilenSet(tenantId, vergiDonem);

    // Her mükellef için hangi beyanları vermesi gerektiğini hesapla
    type Agg = { beyanTipi: BeyanTipi; toplam: number; onaylanan: number; bekleyen: number; hatali: number; muaf: number; kalan: number };
    const agg = Object.fromEntries(ALL_BEYAN_TIPLERI.map((tip) => [tip, blank(tip)])) as Record<BeyanTipi, Agg>;

    for (const tp of taxpayers) {
      if (tp.isActive === false) continue;
      const cfg = effectiveBeyanConfig(tp);
      const beklenen = beklenenBeyanlar(cfg, yil, ay, donemTuru, kdv2OcrSet, tp.id);

      for (const tip of beklenen) {
        // Mükellef bu beyannamenin kapsadığı VERGİ DÖNEMİNDE aktif miydi?
        // (işe başlama / işi bırakma tarihine göre — verilme ayına göre DEĞİL)
        if (!aktifMiBeyanDoneminde(tp, tip, yil, ay, donem, donemTuru)) continue;
        agg[tip].toplam++;
        const resolved = resolveBeyanState(durumMap, kayitMap, tp.id, tip, yil, ay, donem, donemTuru);
        let durum = resolved.durum;
        // SGK tahakkuk fişi indirilmişse bildirge verilmiş (elle 'hatali' işareti korunur).
        if (tip === 'BILDIRGE' && (durum === 'kalan' || durum === 'bekleyen' || durum === 'beklemede') && sgkBildirgeSet.has(tp.id)) {
          durum = 'onaylandi';
        }
        switch (durum) {
          case 'onaylandi': agg[tip].onaylanan++; break;
          case 'hatali':    agg[tip].hatali++; break;
          case 'muaf':      agg[tip].muaf++; break;
          case 'kalan':     agg[tip].kalan++; break;
          default:          agg[tip].bekleyen++;
        }
      }
    }

    // e-Defter: KDV takvimi DEĞİL, berat takvimi (Sıra No 5 Tebliğ) — ayrı yol. Mükellef beklenen HER dönem için
    // 1 sayılır (Haziran'da Ocak+Şubat beratı düşen şahıs 2 sayılır). Bekleyen/hatalı üretilmez.
    const eDefter = await this.eDefterHesapla(tenantId, taxpayers, donem, donemTuru);
    const eDefterDonemleri = new Set<string>();
    for (const sonuc of eDefter.values()) {
      for (const d of sonuc.donemler) {
        eDefterDonemleri.add(d.donem);
        agg.EDEFTER.toplam++;
        if (d.durum === 'onaylandi') agg.EDEFTER.onaylanan++;
        else agg.EDEFTER.kalan++;
      }
    }

    const rows = Object.values(agg).map((r) => {
      const vergiDonem = r.beyanTipi === 'EDEFTER'
        ? eDefterOzetVergiDonemi(donem, donemTuru, eDefterDonemleri)
        : vergiDonemForTip(r.beyanTipi as BeyanTipi, yil, ay, donem, donemTuru);
      const donemler = r.beyanTipi === 'EDEFTER' ? Array.from(eDefterDonemleri).sort() : [vergiDonem];
      return {
        ...r,
        vergiDonem,
        // O ay takibe düşen dönem anahtarları (tekrarsız). e-Defter'de birden çok olabilir: ['2026-05', '2026-Q2'].
        donemler,
        yuzde: r.toplam > 0 ? Math.round(((r.onaylanan) / r.toplam) * 100) : 0,
      };
    });

    return { donem, donemTuru, rows };
  }

  // ══════════════════════════════════════════════════════════
  // E-DEFTER BERAT TAKİBİ (2026-09-22)
  // ══════════════════════════════════════════════════════════

  /**
   * e-Defter mükellefleri için seçilen ayda beklenen dönemler + berat satırlarından durum.
   * Yalnız eDefterPeriod dolu, o dönemde aktif mükellefler; beklenen dönemi olmayan mükellef haritaya girmez.
   */
  private async eDefterHesapla(
    tenantId: string,
    taxpayers: any[],
    donem: string,
    donemTuru: DonemTuru,
    secenek: { tumBelgeler?: boolean } = {},
  ): Promise<Map<string, EDefterMukellefSonucu>> {
    const sonuclar = new Map<string, EDefterMukellefSonucu>();
    const aylar = new Set<string>();
    const donemAnahtarlari = new Set<string>();

    for (const tp of taxpayers) {
      if (tp.isActive === false) continue;
      const cfg = effectiveBeyanConfig(tp);
      const tercih = eDefterTercihCoz(cfg?.eDefterPeriod);
      if (!tercih) continue;
      const tip = eDefterTipiCoz(tp.type, cfg?.incomeTaxType);
      const baslangic = eDefterBaslangicCoz(cfg?.eDefterBaslangic);
      // Aktiflik dönemin kendi aylarına göre (işe başlama / işi bırakma) — verilme ayına göre değil.
      const beklenen = eDefterBeklenenDonemler(donem, donemTuru, tercih, tip, baslangic)
        .filter((d) => { const { baslangic: b, bitis } = vergiDonemAraligi(d.donem); return aktifMiAralikta(tp, b, bitis); });
      if (beklenen.length === 0) continue;
      for (const d of beklenen) { donemAnahtarlari.add(d.donem); for (const a of d.aylar) aylar.add(a); }
      sonuclar.set(tp.id, {
        tp, tercih, tip, baslangic,
        donemler: beklenen.map((d) => ({ ...d, durum: 'kalan', verildi: false, beratlar: [], elleKaydi: null, sonYukleme: null })),
      });
    }
    if (sonuclar.size === 0) return sonuclar;

    const ids = Array.from(sonuclar.keys());
    const beratlar: any[] = await (this.prisma as any).eDefterBerat.findMany({
      where: {
        tenantId,
        taxpayerId: { in: ids },
        donem: { in: Array.from(aylar) },
        ...(secenek.tumBelgeler ? {} : { belgeTuru: { in: ['KB', 'YB'] } }),
      },
      select: { taxpayerId: true, donem: true, belgeTuru: true, paketId: true, islemOid: true, alinmaZamani: true, durumKodu: true, durumAciklama: true, sorguTarihi: true },
      orderBy: [{ donem: 'asc' }, { belgeTuru: 'asc' }, { alinmaZamani: 'asc' }],
    }).catch(() => []);
    const beratMap = new Map<string, any[]>();
    for (const b of beratlar || []) {
      const liste = beratMap.get(b.taxpayerId) || [];
      liste.push(b);
      beratMap.set(b.taxpayerId, liste);
    }

    // Elle işaret: BeyanDurumu EDEFTER + dönem anahtarı ('2026-05' ya da '2026-Q2').
    const elleKayitlar: any[] = await (this.prisma as any).beyanDurumu.findMany({
      where: { tenantId, beyanTipi: 'EDEFTER', taxpayerId: { in: ids }, donem: { in: Array.from(donemAnahtarlari) } },
    }).catch(() => []);
    const elleMap = new Map<string, any>();
    for (const k of elleKayitlar || []) elleMap.set(`${k.taxpayerId}::${k.donem}`, k);

    for (const [taxpayerId, sonuc] of sonuclar) {
      const tumBeratlar = beratMap.get(taxpayerId) || [];
      for (const d of sonuc.donemler) {
        const aySet = new Set(d.aylar);
        d.beratlar = tumBeratlar.filter((b) => aySet.has(b.donem));
        d.elleKaydi = elleMap.get(`${taxpayerId}::${d.donem}`) || null;
        d.durum = eDefterDurumCoz(d.aylar, d.beratlar, d.elleKaydi?.durum);
        d.verildi = d.durum === 'onaylandi';
        d.sonYukleme = eDefterSonYukleme(d.aylar, d.beratlar);
      }
    }
    return sonuclar;
  }

  /**
   * "E-Defter Detayı" penceresi: GET /beyanname-takip/edefter?donem=YYYY-MM&donemTuru=VERILME|VERGI
   * Yalnız e-Defter mükellefleri (eDefterPeriod dolu, aktif, WHATSAPP-* hariç). Her mükellefte o ay beklenen
   * dönemler, her dönemin ayları ve o aya ait berat/defter paketleri (KB, YB, Y, K).
   */
  async listEDefterDetay(tenantId: string, donem: string, donemTuru: DonemTuru = 'VERILME') {
    const [yilStr, ayStr] = donem.split('-');
    const yil = parseInt(yilStr, 10);
    const ay = parseInt(ayStr, 10);
    if (!yil || !ay || ay < 1 || ay > 12) throw new BadRequestException(`Geçersiz dönem: ${donem}`);

    const taxpayers = await (this.prisma as any).taxpayer.findMany({
      where: {
        tenantId,
        isActive: true,
        taxNumber: { not: { startsWith: 'WHATSAPP-' } },
        beyanConfig: { is: { eDefterPeriod: { in: ['AYLIK', 'UCAYLIK'] } } },
      },
      include: { beyanConfig: true, portalCredentials: sgkCredentialInclude() },
      orderBy: [{ companyName: 'asc' }, { firstName: 'asc' }],
    });

    const sonuclar = await this.eDefterHesapla(tenantId, taxpayers, donem, donemTuru, { tumBelgeler: true });
    const ids = Array.from(sonuclar.keys());

    // Son sorgu kaydı — mükellef + AY başına en yeni (EKRANDAKİ dönemin ayları için; başka ayın sorgusu gösterilmez —
    //   Ekim ekranında Haziran satırının altında Mayıs sorgusunun "3 paket"i görünüyordu, 2026-09-22).
    type SonSorgu = { sorguTarihi: string; hata: string | null; paketSayisi: number; kaynak: string };
    const sonSorguAyMap = new Map<string, SonSorgu>(); // taxpayerId::YYYY-MM
    if (ids.length > 0) {
      const sorgular: any[] = await (this.prisma as any).eDefterSorguKaydi.findMany({
        where: { tenantId, taxpayerId: { in: ids } },
        orderBy: { sorguTarihi: 'desc' },
        select: { taxpayerId: true, donem: true, sorguTarihi: true, hata: true, paketSayisi: true, kaynak: true },
      }).catch(() => []);
      for (const s of sorgular || []) {
        const k = `${s.taxpayerId}::${s.donem}`;
        if (sonSorguAyMap.has(k)) continue;
        sonSorguAyMap.set(k, {
          sorguTarihi: s.sorguTarihi instanceof Date ? s.sorguTarihi.toISOString() : String(s.sorguTarihi),
          hata: s.hata ?? null,
          paketSayisi: Number(s.paketSayisi) || 0,
          kaynak: s.kaynak || 'manual',
        });
      }
    }
    /** Ekrandaki dönemlerin ayları içinde en yeni sorgu (paket sayısı toplanır; hata varsa ilk hata). */
    const sonSorguSec = (taxpayerId: string, aylar: string[]): SonSorgu | null => {
      const kayitlar = aylar.map((a) => sonSorguAyMap.get(`${taxpayerId}::${a}`)).filter((x): x is SonSorgu => !!x);
      if (!kayitlar.length) return null;
      const enYeni = kayitlar.reduce((a, b) => (a.sorguTarihi >= b.sorguTarihi ? a : b));
      return {
        sorguTarihi: enYeni.sorguTarihi,
        hata: kayitlar.find((k) => k.hata)?.hata ?? null,
        paketSayisi: kayitlar.reduce((n, k) => n + k.paketSayisi, 0),
        kaynak: enYeni.kaynak,
      };
    };

    const collator = new Intl.Collator('tr', { sensitivity: 'base' });
    const mukellefler = Array.from(sonuclar.values()).map((sonuc) => {
      const tp = sonuc.tp;
      const donemler = sonuc.donemler.map((d) => ({
        donem: d.donem,
        etiket: eDefterDonemEtiketi(d.donem),
        tercih: sonuc.tercih,
        tebligTarihi: d.tebligTarihi,
        sonGun: d.sonGun,
        uzatildi: d.uzatildi,
        uzatmaKaynagi: d.uzatmaKaynagi,
        verildi: d.verildi,
        elleIsaretli: !!d.elleKaydi && d.elleKaydi.durum === 'onaylandi' && !eDefterBeratVerildiMi(d.aylar, d.beratlar),
        sonYukleme: d.sonYukleme,
        aylar: d.aylar.map((a) => ({
          ay: a,
          etiket: eDefterDonemEtiketi(a),
          verildi: eDefterDurumCoz([a], d.beratlar) === 'onaylandi',
          belgeler: d.beratlar
            .filter((b) => b.donem === a)
            .map((b) => ({
              belgeTuru: b.belgeTuru,
              etiket: (EDEFTER_BELGE_ETIKETLERI as Record<string, string>)[b.belgeTuru] || b.belgeTuru,
              paketId: b.paketId,
              islemOid: b.islemOid ?? null,
              alinmaZamani: b.alinmaZamani instanceof Date ? b.alinmaZamani.toISOString() : (b.alinmaZamani ?? null),
              durumKodu: b.durumKodu ?? null,
              durumAciklama: b.durumAciklama ?? null,
            })),
        })),
      }));
      const verildi = donemler.every((d) => d.verildi);
      const sonYuklemeler = donemler.map((d) => d.sonYukleme).filter((x): x is string => !!x).sort();
      return {
        taxpayerId: tp.id,
        ad: adFormat(tp),
        taxNumber: tp.taxNumber ?? null,
        tip: sonuc.tip,
        tipEtiketi: sonuc.tip === 'FIRMA' ? 'Kurumlar Vergisi' : 'Gelir Vergisi',
        tercih: sonuc.tercih,
        tercihEtiketi: sonuc.tercih === 'UCAYLIK' ? '3 Aylık' : 'Aylık',
        baslangic: sonuc.baslangic,
        donemler,
        verildi,
        sonSorgu: sonSorguSec(tp.id, donemler.flatMap((d) => d.aylar.map((a) => a.ay))),
        sonYukleme: sonYuklemeler.length > 0 ? sonYuklemeler[sonYuklemeler.length - 1] : null,
      };
    }).sort((a, b) => collator.compare(a.ad, b.ad));

    // Özet: panel tablosuyla aynı sayım — dönem başına 1 (birden çok dönem düşen mükellef kadar).
    let toplam = 0;
    let verilen = 0;
    for (const m of mukellefler) for (const d of m.donemler) { toplam++; if (d.verildi) verilen++; }
    return {
      donem,
      donemTuru,
      mukellefler,
      ozet: { toplam, verilen, kalan: toplam - verilen, mukellef: mukellefler.length, verilenMukellef: mukellefler.filter((m) => m.verildi).length },
    };
  }

  /**
   * SGK Bildirge — "çalışan var / yok" (2026-09-22, Muzaffer Bey).
   * SGK şifresi tanımlı ama o dönem personel çalıştırmayan mükellef için bildirge verilmez; "çalışan yok" işareti o
   * VERGİ DÖNEMİ için mükellefi Verildi saydırır (BeyanDurumu BILDIRGE + dönem: onaylandi, notlar CALISAN_YOK).
   * Dönem bazlıdır, sonraki aya taşınmaz. "Çalışan var"a dönüş yalnız CALISAN_YOK notlu kaydı siler — indirilmiş
   * SGK fişi (PortalDocument) ya da gerçek onay kaydına dokunmaz.
   */
  async bildirgeCalisanDurumu(tenantId: string, taxpayerId: string, donem: string, calisanVar: boolean) {
    const tp = await (this.prisma as any).taxpayer.findFirst({ where: { id: taxpayerId, tenantId }, select: { id: true } });
    if (!tp) throw new NotFoundException('Mükellef bulunamadı');
    const where = { tenantId_taxpayerId_beyanTipi_donem: { tenantId, taxpayerId, beyanTipi: 'BILDIRGE', donem } };
    const mevcut = await (this.prisma as any).beyanDurumu.findUnique({ where });
    if (!calisanVar) {
      if (mevcut && mevcut.durum === 'onaylandi' && mevcut.notlar !== BILDIRGE_CALISAN_YOK_NOTU) {
        // Gerçekten verilmiş görünen kaydı ezme.
        return { calisanYok: false, degisti: false, neden: 'Bu dönemin bildirgesi zaten verilmiş görünüyor.' };
      }
      const veri = { durum: 'onaylandi', onayTarihi: new Date(), notlar: BILDIRGE_CALISAN_YOK_NOTU };
      await (this.prisma as any).beyanDurumu.upsert({
        where,
        create: { tenantId, taxpayerId, beyanTipi: 'BILDIRGE', donem, ...veri },
        update: veri,
      });
      return { calisanYok: true, degisti: true };
    }
    if (mevcut && mevcut.notlar === BILDIRGE_CALISAN_YOK_NOTU) {
      await (this.prisma as any).beyanDurumu.delete({ where });
      return { calisanYok: false, degisti: true };
    }
    return { calisanYok: false, degisti: false };
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
    // 2026-09-25 (portal denetimi bulgu 49): durum geri alınınca `onayTarihi` TEMİZLENİYOR.
    //   Eskiden yalnız 'onaylandi'da yazılıyor, geri alınınca eski damga duruyordu:
    //   beyanname "beklemede" görünürken üstünde onay tarihi kalıyor, raporlar da o tarihi
    //   "verildi" diye okuyordu.
    if (data.durum === 'onaylandi') updateData.onayTarihi = new Date();
    else if (data.durum !== undefined) updateData.onayTarihi = null;

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
      where: { tenantId, isActive: true, taxNumber: { not: { startsWith: 'WHATSAPP-' } } },
      include: { beyanConfig: true, portalCredentials: sgkCredentialInclude() },
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

    // KDV2 OCR oto-tespiti (aynı mantık listDonemOzet ile)
    const vYil2 = donemTuru === 'VERILME' ? (ay === 1 ? yil - 1 : yil) : yil;
    const vAy2  = donemTuru === 'VERILME' ? (ay === 1 ? 12 : ay - 1) : ay;
    const vDonem2 = `${vYil2}-${String(vAy2).padStart(2, '0')}`;
    const kdv2OcrSet2 = await this.computeKdv2OcrSet(tenantId, vDonem2);

    // SGK Bildirge: tahakkuk fişi indirildiyse bildirge verilmiş say (özet ile aynı kural).
    const sgkBildirgeSet = await this.sgkBildirgeVerilenSet(tenantId, vDonem2);

    // e-Defter: berat takvimi (özet ile aynı kural) — her beklenen dönem ayrı girdi, vergiDonem = dönem anahtarı.
    const eDefter = await this.eDefterHesapla(tenantId, taxpayers, donem, donemTuru);

    return taxpayers
      .filter((tp: any) => tp.isActive !== false)
      .map((tp: any) => {
        const cfg = effectiveBeyanConfig(tp);
        // Sadece mükellefin VERGİ DÖNEMİNDE aktif olduğu beyannameler kalsın
        const beklenen = beklenenBeyanlar(cfg, yil, ay, donemTuru, kdv2OcrSet2, tp.id)
          .filter((tip) => aktifMiBeyanDoneminde(tp, tip, yil, ay, donem, donemTuru));
        const eDefterGirdileri = (eDefter.get(tp.id)?.donemler || []).map((d) => ({
          beyanTipi: 'EDEFTER' as BeyanTipi,
          durum: d.durum,
          vergiDonem: d.donem,
          tahakkukTutari: null as number | null,
          onayTarihi: (d.sonYukleme || d.elleKaydi?.onayTarihi || null) as string | Date | null,
        }));
        const beyanlar = beklenen.map((tip) => {
          const resolved = resolveBeyanState(durumMap, kayitMap, tp.id, tip, yil, ay, donem, donemTuru);
          let durum = resolved.durum;
          if (tip === 'BILDIRGE' && (durum === 'kalan' || durum === 'bekleyen' || durum === 'beklemede') && sgkBildirgeSet.has(tp.id)) {
            durum = 'onaylandi';
          }
          return {
            beyanTipi: tip,
            durum,
            // Eşleşen beyanname VARSA onun GERÇEK dönemi (or. 3 aylık muhtasar
            // "2026-Q2") gösterilir; yoksa (kalan) hesaplanan dönem.
            vergiDonem: resolved.matchedDonem ?? vergiDonemForTip(tip, yil, ay, donem, donemTuru),
            tahakkukTutari: resolved.durumKaydi?.tahakkukTutari || resolved.beyanKaydi?.tahakkukTutari || null,
            onayTarihi: resolved.durumKaydi?.onayTarihi || resolved.beyanKaydi?.beyanTarihi || null,
            // Bildirge: "çalışan yok" işaretiyle Verildi sayılan dönem (pencerede ayrı etiket + geri alma).
            calisanYok: tip === 'BILDIRGE' && resolved.durumKaydi?.notlar === BILDIRGE_CALISAN_YOK_NOTU,
          };
        });
        return {
          taxpayerId: tp.id,
          ad: adFormat(tp),
          beyanlar: [...beyanlar, ...eDefterGirdileri],
        };
      })
      // Vergi döneminde hiç aktif beyannamesi olmayan mükellefi listeden çıkar
      .filter((row: any) => row.beyanlar.length > 0);
  }
}

/** eDefterHesapla çıktısı: mükellef + tercih/tip + o ay beklenen dönemler (durumla). */
type EDefterMukellefSonucu = {
  tp: any;
  tercih: EDefterTercih;
  tip: EDefterMukellefTipi;
  baslangic: string | null;
  donemler: Array<EDefterBeklenenDonem & {
    durum: EDefterDurum;
    verildi: boolean;
    /** Dönem aylarına ait berat/defter paketleri (EDefterBerat satırları) */
    beratlar: any[];
    /** Elle işaretlenmiş BeyanDurumu (EDEFTER + dönem anahtarı) */
    elleKaydi: any | null;
    sonYukleme: string | null;
  }>;
};

// ══════════════════════════════════════════════════════════
// YARDIMCILAR
// ══════════════════════════════════════════════════════════

/** BeyanDurumu.notlar değeri: bildirge "çalışan yok" işareti (bkz. bildirgeCalisanDurumu). */
export const BILDIRGE_CALISAN_YOK_NOTU = 'CALISAN_YOK';

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
    eDefterBaslangic: null,
    notes: null,
  };
}

function sgkCredentialInclude() {
  return {
    where: {
      provider: 'SGK_EBILDIRGE',
      isActive: true,
    },
    select: {
      provider: true,
      username: true,
      userCode: true,
      workplaceCode: true,
      encryptedPassword: true,
      encryptedSecondaryPassword: true,
      isActive: true,
    },
  };
}

function hasReadySgkCredential(tp: any): boolean {
  const credentials = Array.isArray(tp?.portalCredentials) ? tp.portalCredentials : [];
  return credentials.some((credential: any) => (
    credential?.provider === 'SGK_EBILDIRGE' &&
    credential?.isActive !== false &&
    Boolean((credential?.username || credential?.userCode) && credential?.workplaceCode && credential?.encryptedPassword && credential?.encryptedSecondaryPassword)
  ));
}

function effectiveBeyanConfig(tp: any) {
  const cfg = tp?.beyanConfig || defaultConfig();
  if (!hasReadySgkCredential(tp)) return cfg;
  return { ...cfg, sgkBildirgeEnabled: true };
}

function adFormat(tp: { firstName?: string | null; lastName?: string | null; companyName?: string | null }): string {
  if (tp.companyName && tp.companyName.trim()) return tp.companyName.trim();
  return [tp.firstName, tp.lastName].filter(Boolean).join(' ').trim() || '(isimsiz)';
}

/**
 * Mükellef, verilen takvim aralığında (bir vergi döneminin aralığı) aktif miydi?
 * İşe başlama (startDate) ve işi bırakma (endDate) tarihlerini, dönemin GERÇEK
 * takvim aralığıyla karşılaştırır (kesişim mantığı, sınır günleri dahil).
 */
function aktifMiAralikta(tp: any, baslangic: Date, bitis: Date): boolean {
  if (tp.isActive === false) return false;
  if (tp.startDate) {
    const s = new Date(tp.startDate);
    if (s > bitis) return false; // dönem bittikten sonra işe başlamış → o dönemde mükellef değil
  }
  if (tp.endDate) {
    const e = new Date(tp.endDate);
    if (e < baslangic) return false; // dönem başlamadan işi bırakmış → o dönemde mükellef değil
  }
  return true;
}

/**
 * Dönem anahtarını gerçek takvim aralığına çevirir:
 *   "2026-04" → aylık (1–30 Nisan)
 *   "2026-Q2" → geçici vergi çeyreği (1 Nis–30 Haz)
 *   "2026-YIL" → yıllık (1 Oca–31 Ara)
 * Tanınmayan anahtarda çok geniş aralık döner (yanlışlıkla gizlememek için).
 */
function vergiDonemAraligi(anahtar: string): { baslangic: Date; bitis: Date } {
  let m = /^(\d{4})-(\d{2})$/.exec(anahtar);
  if (m) {
    const y = +m[1], ay = +m[2];
    return { baslangic: new Date(y, ay - 1, 1), bitis: new Date(y, ay, 0, 23, 59, 59, 999) };
  }
  m = /^(\d{4})-Q(\d)$/.exec(anahtar);
  if (m) {
    const y = +m[1], q = +m[2];
    const ilkAy = (q - 1) * 3; // Q1→0(Oca), Q2→3(Nis), Q3→6(Tem), Q4→9(Eki)
    return { baslangic: new Date(y, ilkAy, 1), bitis: new Date(y, ilkAy + 3, 0, 23, 59, 59, 999) };
  }
  m = /^(\d{4})-YIL$/.exec(anahtar);
  if (m) {
    const y = +m[1];
    return { baslangic: new Date(y, 0, 1), bitis: new Date(y, 11, 31, 23, 59, 59, 999) };
  }
  return { baslangic: new Date(-8640000000000000), bitis: new Date(8640000000000000) };
}

/**
 * Mükellef, bir beyanname tipinin kapsadığı vergi döneminde aktif miydi?
 * Süzme artık verilme ayına göre değil, beyannamenin GERÇEK vergi dönemine göre.
 */
/**
 * Bu mükellefte bu beyan tipi 3 AYLIK mı? (config'e göre). Poşet her zaman 3 aylık.
 * 3 aylık beyanlarda aktiflik kontrolü tek aya değil, ÇEYREĞE bakmalı — aksi halde
 * çeyrek başında işi bırakan (ör. 01.04'te kapanan) mükellef, o çeyreğin son ayında
 * aktif olmadığı için yanlışlıkla eleniyor ve verilecek muhtasarı takibe düşmüyordu.
 */
function isUcaylikForTip(cfg: any, tip: BeyanTipi): boolean {
  if (tip === 'POSET') return true; // poşet mevzuaten 3 aylık
  const period =
    tip === 'MUHSGK' ? cfg?.muhtasarPeriod :
    tip === 'KDV1' ? cfg?.kdv1Period :
    tip === 'TURIZM' ? cfg?.turizmPeriod :
    tip === 'EDEFTER' ? cfg?.eDefterPeriod :
    null;
  return period === 'UCAYLIK';
}

function aktifMiBeyanDoneminde(
  tp: any,
  tip: BeyanTipi,
  yil: number,
  ay: number,
  donem: string,
  donemTuru: DonemTuru,
): boolean {
  let anahtar = vergiDonemForTip(tip, yil, ay, donem, donemTuru);
  // 3 aylık beyanda aylık anahtarı (yyyy-mm) çeyreğe (yyyy-Qn) çevir → aktiflik
  // çeyrek boyunca kontrol edilsin (çeyrek başında aktif olan kapanmış firma dahil).
  const mm = /^(\d{4})-(\d{2})$/.exec(anahtar);
  if (mm && isUcaylikForTip(effectiveBeyanConfig(tp), tip)) {
    anahtar = quarterDonem(+mm[1], +mm[2]);
  }
  const { baslangic, bitis } = vergiDonemAraligi(anahtar);
  return aktifMiAralikta(tp, baslangic, bitis);
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

export function resolveBeyanState(
  durumIndex: Map<string, any>,
  kayitIndex: Map<string, any>,
  taxpayerId: string,
  tip: BeyanTipi,
  yil: number,
  ay: number,
  donem: string,
  donemTuru: DonemTuru,
) {
  // EN GÜNCEL GERÇEK DURUM (kullanıcı kuralı): aynı beyanname birden çok dönem/durumda
  // olabilir (aylık "2026-06" + çeyrek "2026-Q2"; hatalı verip sonra düzeltilir).
  //   1) ONAYLI kesin kazanır: indirilmiş beyanname (BeyanKaydı) VEYA durum=onaylandi.
  //      Onaylanan beyanname iptal edilemez; eski hatalı/beklemede denemesi onu düşürmez.
  //   2) Onaylı yoksa, beklemede/hatalı/muaf içinde EN GÜNCEL geçerli. Güncellik
  //      GİB'in kendi satır tarihine göre (notlardaki gibTarih); yoksa updatedAt.
  //      updatedAt tek başına yanıltıcı: GİB sorgusu hatalı→onay-bekliyor SIRAYLA
  //      yazdığı için beklemede'nin updatedAt'i aynı koşuda hep daha yeni çıkıyordu —
  //      YILMAZ'ın GİB'de hatalı beyannamesi panelde "onay bekliyor" görünüyordu.
  let onayli: any = null;
  let guncel: any = null; // beklemede/hatali/muaf içinde en güncel (katman + tarih)
  // Katmanlı kıyas: elle işaret (2) > GİB gibTarih'li (1) > GİB gibTarih'siz eski kayıt (0).
  // GİB kayıtlarında updatedAt yazım zamanıdır (her koşuda tazelenir) — paket tarihi
  // (gibTarih) ile karşılaştırılamaz; gibTarih'siz eski GİB kaydı en alta düşer ki
  // taze gibTarih'li durumu (or. hatalı) ezemesin. Elle işaret her zaman korunur.
  const zaman = (k: any): { tier: number; ms: number } => {
    const gib = gibTarihFromNotlar(k?.notlar);
    if (gib) return { tier: 1, ms: gib.getTime() };
    const t = k?.updatedAt || k?.onayTarihi || k?.createdAt;
    const ms = t ? new Date(t).getTime() : 0;
    const gibAgentKaydi = /gib agent|portal-automation/i.test(String(k?.notlar || ''));
    return { tier: gibAgentKaydi ? 0 : 2, ms };
  };
  const dahaGuncel = (a: { tier: number; ms: number }, b: { tier: number; ms: number }) =>
    a.tier !== b.tier ? a.tier > b.tier : a.ms > b.ms;
  for (const candidate of lookupKeysForExpected(tip, yil, ay, donem, donemTuru)) {
    const key = `${taxpayerId}::${candidate.tip}::${candidate.donem}`;
    const durumKaydi = durumIndex.get(key);
    const beyanKaydi = kayitIndex.get(key);
    if (beyanKaydi) {
      // İndirilmiş beyanname = kesin onaylı (en güvenilir kanıt).
      onayli = onayli || { durum: 'onaylandi', durumKaydi: durumKaydi || null, beyanKaydi, matchedDonem: candidate.donem };
      continue;
    }
    if (!durumKaydi) continue;
    if (durumKaydi.durum === 'onaylandi') {
      onayli = onayli || { durum: 'onaylandi', durumKaydi, beyanKaydi: null, matchedDonem: candidate.donem };
      continue;
    }
    // beklemede: yalnız gerçek e-beyanname onay-bekliyor işaretiyse say (sızıntı değil).
    let eff: string | null = durumKaydi.durum;
    if (durumKaydi.durum === 'beklemede' && !isEDeclarationApprovalPending(durumKaydi)) eff = null;
    if (!eff) continue;
    const cand = { durum: eff, durumKaydi, beyanKaydi: null, matchedDonem: candidate.donem };
    if (!guncel || dahaGuncel(zaman(durumKaydi), zaman(guncel.durumKaydi))) guncel = cand;
  }
  if (onayli) return onayli;
  if (guncel) return guncel;
  return { durum: 'kalan', durumKaydi: null, beyanKaydi: null, matchedDonem: null };
}

function isEDeclarationApprovalPending(durumKaydi: any): boolean {
  const note = String(durumKaydi?.notlar || '').toLowerCase();
  return /gib agent onay bekliyor|e-beyanname onay bekliyor|portal-automation.*onay/.test(note);
}

/** Notlardaki GİB satır tarihi (gibTarih=<ISO>) — portal-automation yazıyor. */
export function gibTarihFromNotlar(notlar?: string | null): Date | null {
  const m = String(notlar || '').match(/gibTarih=([0-9T:.Z+-]+)/);
  if (!m) return null;
  const d = new Date(m[1]);
  return Number.isNaN(d.getTime()) ? null : d;
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
    // Aylık dönem anahtarı (aylık beyanname beyanKaydi.donem = "2026-06").
    donemler.add(donemTuru === 'VERGI' ? donem : monthDonem(prev.yil, prev.ay));
    // GENEL KURAL (yalnız muhtasara özel DEĞİL): yıllık (KURUMLAR/GELIR/GMSI) ve geçici
    // vergi (GGECICI/KGECICI) DIŞINDAKİ HER beyanname mükellef config'inde ÜÇ AYLIK
    // seçilmiş olabilir; o zaman beyanKaydi ÇEYREK dönemle kayıtlıdır (or. "2026-Q2").
    // Bu fonksiyon config'i almadığından hem tek-ay HEM çeyrek anahtarı aranır —
    // aylıksa "2026-06", üç aylıksa "2026-Q2" ile eşleşir. Farklı tip karışmaz
    // (anahtar taxpayerId::tip::donem). Kök bug: 3 aylık beyannameler sadece "2026-06"
    // aranıp bulunamıyor, indirilmiş olsa da "kalan" görünüyordu (muhtasar + tümü).
    donemler.add(donemTuru === 'VERGI' ? quarterDonem(yil, ay) : quarterDonem(prev.yil, prev.ay));
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
 * E-Defter: BURADA DEĞİL — berat takvimi (edefter-takip.ts / eDefterHesapla)
 */
function beklenenBeyanlar(cfg: any, yil: number, ay: number, donemTuru: DonemTuru, kdv2OcrSet?: Set<string>, taxpayerId?: string): BeyanTipi[] {
  const tipler: BeyanTipi[] = [];

  // KDV1
  if (cfg.kdv1Period === 'AYLIK') tipler.push('KDV1');
  else if (periodDue(cfg.kdv1Period, ay, donemTuru)) tipler.push('KDV1');

  // KDV2: sadece OCR tespit — mihsap tevkifatlı alış veya KDV_191 session
  if (kdv2OcrSet && taxpayerId && kdv2OcrSet.has(taxpayerId)) tipler.push('KDV2');
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

  // E-Defter: KDV takvimiyle DEĞİL, berat takvimiyle (Sıra No 5 Tebliğ) hesaplanır → eDefterHesapla (ayrı yol).
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
