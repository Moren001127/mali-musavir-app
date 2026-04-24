import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Kdv1OnHazirlik, Kdv2OnHazirlik, OranRow, DonemOzet, KdvTip } from './types';

/**
 * KDV Beyanname Ön Hazırlık Servisi.
 *
 * Bu modül TAMAMEN KENDİ BAŞINA çalışır — Mizan/GelirTablosu/Bilanço
 * tablolarına BAĞIMLI DEĞİLDİR (o tablolar geçici vergi modülü için).
 *
 * Veri kaynakları:
 *   1. MihsapInvoice — fatura metadata (toplam tutar). OCR'dan geçmemişse sadece toplam.
 *   2. KdvRecord (KDV Kontrol) — OCR'dan geçmiş faturalarda oran bazlı matrah+KDV + tevkifat.
 *   3. BeyanKaydi — geçmiş dönem sonu devreden KDV.
 *
 * Akış:
 *   - Satış faturaları → oran bazlı gruplama (OCR varsa kesin, yoksa %20 tahmin).
 *   - Alış faturaları → oran bazlı gruplama + tevkifatlı/tevkifatsız ayrımı.
 *   - Geçen ay BeyanKaydi'nden devreden KDV.
 *   - Sonuç: ödenecek veya sonraki aya devreden.
 *
 * TODO (gelecek iş): KDV'ye özel Luca sync — `KdvLucaSnapshot` tablosu + muavin
 * çekimiyle 191/391/190 aylık bakiye çapraz kontrol. Mizan modülünden BAĞIMSIZ.
 */

const DEFAULT_KDV_ORAN = 20; // Mihsap'ta KDV detayı yoksa varsayılan

@Injectable()
export class KdvBeyannameService {
  private readonly logger = new Logger(KdvBeyannameService.name);

  constructor(private readonly prisma: PrismaService) {}

  // =========================================================
  // KDV1 — Ana beyanname ön hazırlığı
  // =========================================================
  async kdv1OnHazirlik(params: {
    tenantId: string;
    mukellefId: string;
    donem: string;
  }): Promise<Kdv1OnHazirlik> {
    const { tenantId, mukellefId, donem } = params;
    const mukellef = await this.getMukellef(tenantId, mukellefId);

    // 1) SATIŞ faturaları (Mihsap + KdvRecord override)
    const satis = await this.derleOranBazliMatrahKdv(tenantId, mukellefId, donem, 'SATIS');

    // 2) ALIŞ faturaları + tevkifat ayrımı
    const alisTumu = await this.derleOranBazliMatrahKdv(tenantId, mukellefId, donem, 'ALIS');
    const tevkifatAyri = await this.ayirTevkifatliAlis(tenantId, mukellefId, donem);

    const alis = {
      oranlar: alisTumu.oranlar,
      toplamMatrah: alisTumu.toplamMatrah,
      toplamIndirilecekKdv: alisTumu.toplamKdv - tevkifatAyri.tevkifatKdvToplam, // Tevkifat tutarı KDV1'de değil KDV2'de
      faturaAdet: alisTumu.faturaAdet,
      tevkifatsiz: {
        matrah: alisTumu.toplamMatrah - tevkifatAyri.matrah,
        kdv: alisTumu.toplamKdv - tevkifatAyri.tevkifatKdvToplam,
        adet: alisTumu.faturaAdet - tevkifatAyri.adet,
      },
      tevkifatli: {
        matrah: tevkifatAyri.matrah,
        kdv: tevkifatAyri.hesaplananKdvToplam,
        adet: tevkifatAyri.adet,
      },
    };

    // 3) Geçen dönemden devreden
    const devreden = await this.getDevredenKdv(tenantId, mukellefId, donem);

    // 4) Luca çapraz kontrol
    const lucaKontrol = await this.lucaCrosscheck(
      tenantId,
      mukellefId,
      donem,
      satis.toplamKdv,
      alis.toplamIndirilecekKdv,
      devreden.tutar,
    );

    // 5) Sonuç
    const hesaplananKdv = Math.round(satis.toplamKdv * 100) / 100;
    const indirilecekKdv = Math.round(alis.toplamIndirilecekKdv * 100) / 100;
    const devredenKdv = Math.round(devreden.tutar * 100) / 100;
    const diff = hesaplananKdv - indirilecekKdv - devredenKdv;
    const odenecekKdv = diff > 0 ? diff : 0;
    const sonrakiAyaDevreden = diff < 0 ? -diff : 0;

    // 6) Kalite raporu
    const kaliteRapor = this.raporKalite(satis, alisTumu);

    return {
      mukellefId,
      mukellefAd: this.formatMukellefAd(mukellef),
      donem,
      satis: {
        oranlar: satis.oranlar,
        toplamMatrah: Math.round(satis.toplamMatrah * 100) / 100,
        toplamHesaplananKdv: hesaplananKdv,
        faturaAdet: satis.faturaAdet,
      },
      alis: {
        oranlar: alis.oranlar,
        toplamMatrah: Math.round(alis.toplamMatrah * 100) / 100,
        toplamIndirilecekKdv: indirilecekKdv,
        faturaAdet: alis.faturaAdet,
        tevkifatsiz: {
          matrah: Math.round(alis.tevkifatsiz.matrah * 100) / 100,
          kdv: Math.round(alis.tevkifatsiz.kdv * 100) / 100,
          adet: alis.tevkifatsiz.adet,
        },
        tevkifatli: {
          matrah: Math.round(alis.tevkifatli.matrah * 100) / 100,
          kdv: Math.round(alis.tevkifatli.kdv * 100) / 100,
          adet: alis.tevkifatli.adet,
        },
      },
      devreden,
      sonuc: {
        hesaplananKdv,
        indirilecekKdv,
        devredenKdv,
        odenecekKdv: Math.round(odenecekKdv * 100) / 100,
        sonrakiAyaDevreden: Math.round(sonrakiAyaDevreden * 100) / 100,
      },
      lucaKontrol,
      kaliteRapor,
    };
  }

  // =========================================================
  // KDV2 — Tevkifat sorumlusu beyanname
  // =========================================================
  async kdv2OnHazirlik(params: {
    tenantId: string;
    mukellefId: string;
    donem: string;
  }): Promise<Kdv2OnHazirlik> {
    const { tenantId, mukellefId, donem } = params;
    const mukellef = await this.getMukellef(tenantId, mukellefId);

    // Tevkifatlı alış faturaları — KdvRecord üzerinden (OCR'dan tevkifat varsa)
    // veya MihsapInvoice.raw'daki tevkifat işaretleriyle
    const faturalar = await this.getTevkifatliAlisFaturalari(tenantId, mukellefId, donem);

    const satirlar = faturalar.map((f: any) => ({
      belgeNo: f.belgeNo,
      satici: f.satici,
      saticiVkn: f.saticiVkn || '',
      tarih: f.tarih,
      matrah: Math.round(f.matrah * 100) / 100,
      hesaplananKdv: Math.round(f.hesaplananKdv * 100) / 100,
      tevkifatOrani: f.tevkifatOrani || '1/2',
      tevkifatTutari: Math.round(f.tevkifatTutari * 100) / 100,
    }));

    const toplamMatrah = satirlar.reduce((s: number, r: any) => s + r.matrah, 0);
    const toplamHesaplananKdv = satirlar.reduce((s: number, r: any) => s + r.hesaplananKdv, 0);
    const toplamTevkifat = satirlar.reduce((s: number, r: any) => s + r.tevkifatTutari, 0);

    // Tevkifat oranı bazlı gruplama
    const gruplar = new Map<string, { matrah: number; tevkifat: number; adet: number }>();
    for (const s of satirlar) {
      const g = gruplar.get(s.tevkifatOrani) || { matrah: 0, tevkifat: 0, adet: 0 };
      g.matrah += s.matrah;
      g.tevkifat += s.tevkifatTutari;
      g.adet += 1;
      gruplar.set(s.tevkifatOrani, g);
    }

    const tevkifatKodlari = Array.from(gruplar.entries()).map(([kod, v]) => ({
      kod,
      matrah: Math.round(v.matrah * 100) / 100,
      tevkifat: Math.round(v.tevkifat * 100) / 100,
      adet: v.adet,
    }));

    const uyarilar: string[] = [];
    if (satirlar.length === 0) {
      uyarilar.push('Bu dönemde tevkifatlı alış faturası tespit edilmedi.');
    }
    const tevkifatsizTespitEdilen = faturalar.filter((f: any) => f.kaynak === 'mihsap_only').length;
    if (tevkifatsizTespitEdilen > 0) {
      uyarilar.push(
        `${tevkifatsizTespitEdilen} fatura için oran tespiti yapılamadı (varsayılan 1/2). Kesin değer için KDV Kontrol'den geçirin.`,
      );
    }

    return {
      mukellefId,
      mukellefAd: this.formatMukellefAd(mukellef),
      donem,
      tevkifatli: satirlar,
      toplamlar: {
        faturaAdet: satirlar.length,
        toplamMatrah: Math.round(toplamMatrah * 100) / 100,
        toplamHesaplananKdv: Math.round(toplamHesaplananKdv * 100) / 100,
        toplamTevkifat: Math.round(toplamTevkifat * 100) / 100,
      },
      tevkifatKodlari,
      uyarilar,
    };
  }

  // =========================================================
  // DÖNEM ÖZETİ — tüm mükellefler için dashboard
  // =========================================================
  async donemOzet(tenantId: string, donem: string, tip: KdvTip): Promise<DonemOzet> {
    // Aktif + KDV mükellefi olanları al
    const mukellefler = await (this.prisma as any).taxpayer.findMany({
      where: { tenantId, isActive: true },
      include: { beyanConfig: true },
      orderBy: [{ companyName: 'asc' }],
    });

    const aktifKdvMukellef = mukellefler.filter((m: any) =>
      tip === 'KDV1' ? m.beyanConfig?.kdv1Period : m.beyanConfig?.kdv2Enabled,
    );

    const satirlar = [];
    let toplamOdenecek = 0;
    let toplamDevreden = 0;
    let hazirAdet = 0;

    for (const m of aktifKdvMukellef) {
      try {
        const sonuc =
          tip === 'KDV1'
            ? await this.kdv1OnHazirlik({ tenantId, mukellefId: m.id, donem })
            : null;

        if (!sonuc) {
          satirlar.push({
            mukellefId: m.id,
            ad: this.formatMukellefAd(m),
            faturaAdet: 0,
            hesaplananKdv: 0,
            indirilecekKdv: 0,
            odenecek: 0,
            devreden: 0,
            durum: 'bos' as const,
          });
          continue;
        }

        const faturaAdet = sonuc.satis.faturaAdet + sonuc.alis.faturaAdet;
        const durum: 'hazir' | 'eksik' | 'bos' =
          faturaAdet === 0
            ? 'bos'
            : sonuc.kaliteRapor.tahminFaturaOrani > 0.5
              ? 'eksik'
              : 'hazir';

        satirlar.push({
          mukellefId: m.id,
          ad: sonuc.mukellefAd,
          faturaAdet,
          hesaplananKdv: sonuc.sonuc.hesaplananKdv,
          indirilecekKdv: sonuc.sonuc.indirilecekKdv,
          odenecek: sonuc.sonuc.odenecekKdv,
          devreden: sonuc.sonuc.sonrakiAyaDevreden,
          durum,
        });

        toplamOdenecek += sonuc.sonuc.odenecekKdv;
        toplamDevreden += sonuc.sonuc.sonrakiAyaDevreden;
        if (durum !== 'bos') hazirAdet++;
      } catch (e: any) {
        this.logger.warn(`Mükellef ${m.id} için KDV özet başarısız: ${e.message}`);
      }
    }

    return {
      donem,
      tip,
      toplam: {
        mukellefAdet: aktifKdvMukellef.length,
        hazirMukellefAdet: hazirAdet,
        toplamOdenecek: Math.round(toplamOdenecek * 100) / 100,
        toplamDevreden: Math.round(toplamDevreden * 100) / 100,
      },
      mukellefler: satirlar,
    };
  }

  // =========================================================
  // === Yardımcılar ===
  // =========================================================

  private async getMukellef(tenantId: string, mukellefId: string) {
    const m = await (this.prisma as any).taxpayer.findFirst({
      where: { id: mukellefId, tenantId },
    });
    if (!m) throw new NotFoundException('Mükellef bulunamadı');
    return m;
  }

  private formatMukellefAd(m: any): string {
    return (
      m.companyName ||
      `${m.firstName || ''} ${m.lastName || ''}`.trim() ||
      m.taxNumber
    );
  }

  /**
   * Dönem + faturaTuru için oran bazlı matrah+KDV derle.
   * - OCR geçmiş (KdvRecord var) → kesin oran+matrah+KDV kullanılır
   * - OCR yok (sadece MihsapInvoice) → toplamTutar'dan %20 varsayılanıyla tahmin
   */
  private async derleOranBazliMatrahKdv(
    tenantId: string,
    mukellefId: string,
    donem: string,
    faturaTuru: 'ALIS' | 'SATIS',
  ) {
    // ÖNEMLİ: faturaTuru "TEVKIFATLI_ALIS" / "TEVKIFATLI_SATIS" gibi varyantlarda
    // da gelebiliyor. KDV1 ön hazırlığı için tevkifatlı alış da indirilecek
    // KDV'ye dahildir (tevkifat tutarı sonradan ayrılır). contains ile alıyoruz.
    const faturalar = await (this.prisma as any).mihsapInvoice.findMany({
      where: {
        tenantId,
        mukellefId,
        donem,
        faturaTuru: { contains: faturaTuru },
      },
      select: {
        id: true,
        faturaNo: true,
        toplamTutar: true,
        belgeTuru: true,
        faturaTuru: true,
        raw: true,
      },
    });

    // Sadece fatura niteliğindekiler — fiş/Z raporu/irsaliye atla
    const faturaOnly = faturalar.filter((f: any) => {
      const bt = String(f.belgeTuru || '').toUpperCase().replace(/[-\s]/g, '_');
      if (/FI[SŞ]|OKC|Z_?RAPOR|IRSALIYE|İRSALİYE|PERAKENDE/.test(bt)) return false;
      return true;
    });

    // OCR verileri — bu dönem için KdvRecord'da olan faturaları bul
    const belgeNoSet = new Set(faturaOnly.map((f: any) => f.faturaNo));
    const kdvRecords =
      belgeNoSet.size === 0
        ? []
        : await (this.prisma as any).kdvRecord.findMany({
            where: {
              session: {
                tenantId,
                taxpayerId: mukellefId,
                periodLabel: { in: [donem, donem.replace('-', '/')] },
              },
              belgeNo: { in: Array.from(belgeNoSet) as string[] },
            },
          });
    const ocrMap = new Map<string, any>();
    for (const r of kdvRecords) {
      if (r.belgeNo && !ocrMap.has(r.belgeNo)) ocrMap.set(r.belgeNo, r);
    }

    // Oran bazlı toplama
    const oranMap = new Map<number, { matrah: number; kdv: number; adet: number }>();
    const addToOran = (oran: number, matrah: number, kdv: number) => {
      const g = oranMap.get(oran) || { matrah: 0, kdv: 0, adet: 0 };
      g.matrah += matrah;
      g.kdv += kdv;
      g.adet += 1;
      oranMap.set(oran, g);
    };

    let ocrliAdet = 0;
    let tahminAdet = 0;

    for (const f of faturaOnly) {
      const ocr = ocrMap.get(f.faturaNo);
      if (ocr && ocr.kdvMatrahi && ocr.kdvOrani) {
        addToOran(Number(ocr.kdvOrani), Number(ocr.kdvMatrahi), Number(ocr.kdvTutari));
        ocrliAdet++;
      } else {
        // Tahmin: toplam = matrah * (1 + oran/100) → matrah = toplam / 1.20
        const toplam = Number(f.toplamTutar || 0);
        const matrah = toplam / (1 + DEFAULT_KDV_ORAN / 100);
        const kdv = toplam - matrah;
        addToOran(DEFAULT_KDV_ORAN, matrah, kdv);
        tahminAdet++;
      }
    }

    const oranlar: OranRow[] = Array.from(oranMap.entries())
      .map(([oran, v]) => ({
        oran,
        matrah: Math.round(v.matrah * 100) / 100,
        kdv: Math.round(v.kdv * 100) / 100,
        adet: v.adet,
      }))
      .sort((a: any, b: any) => a.oran - b.oran);

    const toplamMatrah = oranlar.reduce((s: number, o: any) => s + o.matrah, 0);
    const toplamKdv = oranlar.reduce((s: number, o: any) => s + o.kdv, 0);

    return {
      oranlar,
      toplamMatrah,
      toplamKdv,
      faturaAdet: faturaOnly.length,
      ocrliAdet,
      tahminAdet,
    };
  }

  /** Tevkifatlı alış faturalarını ayır (KDV2'ye girer) */
  private async ayirTevkifatliAlis(
    tenantId: string,
    mukellefId: string,
    donem: string,
  ): Promise<{
    matrah: number;
    tevkifatKdvToplam: number;
    hesaplananKdvToplam: number;
    adet: number;
  }> {
    // OCR'dan geçen ve tevkifat alanı dolu olanlar
    const records = await (this.prisma as any).kdvRecord.findMany({
      where: {
        session: {
          tenantId,
          taxpayerId: mukellefId,
          periodLabel: { in: [donem, donem.replace('-', '/')] },
          type: 'KDV_191',
        },
      },
    });

    let matrah = 0;
    let tevkifatKdv = 0;
    let hesaplananKdv = 0;
    let adet = 0;
    for (const r of records) {
      const tevkifat = Number(r.rawData?.kdvTevkifat || 0);
      if (tevkifat > 0) {
        matrah += Number(r.kdvMatrahi || 0);
        tevkifatKdv += tevkifat;
        hesaplananKdv += Number(r.kdvTutari || 0) + tevkifat; // kdvTutari NET, hesaplanan = NET + tevkifat
        adet++;
      }
    }
    return { matrah, tevkifatKdvToplam: tevkifatKdv, hesaplananKdvToplam: hesaplananKdv, adet };
  }

  /** KDV2 için tüm tevkifatlı alış faturalarını döner (detay satır) */
  private async getTevkifatliAlisFaturalari(
    tenantId: string,
    mukellefId: string,
    donem: string,
  ) {
    const records = await (this.prisma as any).kdvRecord.findMany({
      where: {
        session: {
          tenantId,
          taxpayerId: mukellefId,
          periodLabel: { in: [donem, donem.replace('-', '/')] },
          type: 'KDV_191',
        },
      },
      orderBy: { belgeDate: 'asc' },
    });

    return records
      .filter((r: any) => Number(r.rawData?.kdvTevkifat || 0) > 0)
      .map((r: any) => {
        const tevkifat = Number(r.rawData?.kdvTevkifat || 0);
        const netKdv = Number(r.kdvTutari || 0);
        const hesaplanan = netKdv + tevkifat;
        // Tevkifat oranı: tevkifat / hesaplanan ≈ 1/2, 5/10, 9/10
        const oran = hesaplanan > 0 ? tevkifat / hesaplanan : 0;
        const oranStr = this.tevkifatOranStr(oran);
        return {
          belgeNo: r.belgeNo || '',
          satici: r.karsiTaraf || '—',
          saticiVkn: r.rawData?.saticiVkn || r.rawData?.vkn || '',
          tarih: r.belgeDate ? r.belgeDate.toISOString().slice(0, 10) : '',
          matrah: Number(r.kdvMatrahi || 0),
          hesaplananKdv: hesaplanan,
          tevkifatOrani: oranStr,
          tevkifatTutari: tevkifat,
          kaynak: 'ocr' as const,
        };
      });
  }

  private tevkifatOranStr(oran: number): string {
    // En yakın yaygın orana yuvarla
    const yaygin: Array<[number, string]> = [
      [0.1, '1/10'],
      [0.2, '2/10'],
      [0.3, '3/10'],
      [0.4, '4/10'],
      [0.5, '5/10'],
      [0.7, '7/10'],
      [0.9, '9/10'],
    ];
    let best = yaygin[4]; // varsayılan 5/10
    let minDiff = Math.abs(oran - best[0]);
    for (const y of yaygin) {
      const d = Math.abs(oran - y[0]);
      if (d < minDiff) {
        minDiff = d;
        best = y;
      }
    }
    return best[1];
  }

  /**
   * Geçen dönem sonu devreden KDV tutarını bul.
   * SADECE BeyanKaydi tablosundan — Mizan tablosuna dokunmaz
   * (Mizan geçici vergi modülüne ait, KDV beyannamesi kendi başına çalışır).
   */
  private async getDevredenKdv(
    tenantId: string,
    mukellefId: string,
    donem: string,
  ) {
    const onceki = this.oncekiDonem(donem);

    const beyan = await (this.prisma as any).beyanKaydi.findFirst({
      where: {
        tenantId,
        taxpayerId: mukellefId,
        beyanTipi: 'KDV1',
        donem: onceki,
      },
    });

    if (beyan?.notlar) {
      // notlar'da "devreden: 1234.56" şeklinde yazılabilir
      const m = /devreden[:\s]+([0-9.,]+)/i.exec(beyan.notlar);
      if (m) {
        return {
          tutar: Number(m[1].replace(/\./g, '').replace(',', '.')),
          kaynak: 'beyan_kaydi' as const,
          sonKayitDonem: onceki,
        };
      }
    }

    return {
      tutar: 0,
      kaynak: 'yok' as const,
      sonKayitDonem: null,
    };
  }

  /**
   * Luca çapraz kontrol — KDV'YE ÖZEL Luca sync (ileride aktif olacak).
   *
   * Mizan modülünden VERİ ÇEKMEZ (o modül geçici vergi için). Gelecekte:
   *   - KdvLucaSnapshot tablosuna mükellef+dönem bazlı 191/391/190 bakiyeleri
   *   - /kdv-beyanname/luca-sync endpoint'i ile Playwright muavin indirir
   *   - Buradan okuyup karşılaştırır.
   *
   * Şimdilik tüm alanlar null — frontend "Luca senkronizasyonu v2'de" gösterir.
   */
  private async lucaCrosscheck(
    _tenantId: string,
    _mukellefId: string,
    _donem: string,
    _mihsapHesaplanan: number,
    _mihsapIndirilecek: number,
    _devreden: number,
  ) {
    const uyarilar: string[] = []; // İleride KDV-özel Luca sync eklenecek
    return {
      mizanVar: false,
      luca391Bakiye: null,
      luca191Bakiye: null,
      luca190Bakiye: null,
      fark391: null,
      fark191: null,
      uyarilar,
    };
  }

  private raporKalite(
    satis: { ocrliAdet: number; tahminAdet: number; faturaAdet: number },
    alis: { ocrliAdet: number; tahminAdet: number; faturaAdet: number },
  ) {
    const toplam = satis.faturaAdet + alis.faturaAdet;
    const ocrli = satis.ocrliAdet + alis.ocrliAdet;
    const tahmin = satis.tahminAdet + alis.tahminAdet;

    const ocrliOran = toplam > 0 ? ocrli / toplam : 0;
    const tahminOran = toplam > 0 ? tahmin / toplam : 0;

    const uyarilar: string[] = [];
    if (tahminOran > 0.8) {
      uyarilar.push(
        'Faturaların %80+\'ı OCR\'dan geçmemiş — oran tespiti varsayılan %20 ile yapıldı. Kesin değerler için KDV Kontrol modülünden geçirin.',
      );
    } else if (tahminOran > 0.3) {
      uyarilar.push(
        `Faturaların %${Math.round(tahminOran * 100)}'ı OCR'dan geçmemiş — bu kısım tahmini.`,
      );
    }
    if (toplam === 0) {
      uyarilar.push('Bu dönem için hiç fatura bulunamadı.');
    }

    return {
      ocrliFaturaOrani: Math.round(ocrliOran * 100) / 100,
      tahminFaturaOrani: Math.round(tahminOran * 100) / 100,
      uyarilar,
    };
  }

  private oncekiDonem(donem: string): string {
    // "2026-03" → "2026-02"
    const m = /^(\d{4})-(\d{2})$/.exec(donem);
    if (!m) return donem;
    const yil = parseInt(m[1], 10);
    const ay = parseInt(m[2], 10);
    if (ay === 1) return `${yil - 1}-12`;
    return `${yil}-${String(ay - 1).padStart(2, '0')}`;
  }
}
