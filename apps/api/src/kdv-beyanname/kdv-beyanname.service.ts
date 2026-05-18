import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MizanParserService } from '../mizan/mizan-parser.service';
import {
  Kdv1OnHazirlik,
  Kdv2OnHazirlik,
  OranRow,
  DonemOzet,
  KdvTip,
  KdvEksikVeri,
  VeriGuveni,
} from './types';

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

const KDV_KONTROL_DURUMU = 'KDV Kontrol gerekli';
const GECERLI_KDV_ORANLARI = [1, 8, 10, 18, 20];
const DEVREDEN_MANUEL_TAG = 'KDV_DEVREDEN_MANUEL';
const SONRAKI_DEVREDEN_TAG = 'KDV_SONRAKI_DEVREDEN';

@Injectable()
export class KdvBeyannameService {
  private readonly logger = new Logger(KdvBeyannameService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mizanParser: MizanParserService,
  ) {}

  /**
   * Agent'ın yüklediği XLS buffer'ı parse et + KdvLucaSnapshot'a yaz.
   * Mizan parser'ı reuse eder ama Mizan tablosuna YAZMAZ — sadece KDV snapshot'una.
   */
  async importLucaSnapshotXls(params: {
    tenantId: string;
    mukellefId: string;
    donem: string;
    fetchJobId?: string;
    buffer: Buffer;
  }) {
    const parsed = this.mizanParser.parse(params.buffer);
    if (!parsed || parsed.length === 0) {
      throw new BadRequestException('Mizan Excel parse edildi ama satır bulunamadı');
    }
    return this.importSnapshotFromRows({
      tenantId: params.tenantId,
      mukellefId: params.mukellefId,
      donem: params.donem,
      fetchJobId: params.fetchJobId,
      parsedRows: parsed.map((p: any) => ({
        hesapKodu: p.hesapKodu,
        hesapAdi: p.hesapAdi,
        borcToplami: Number(p.borcToplami) || 0,
        alacakToplami: Number(p.alacakToplami) || 0,
        borcBakiye: Number(p.borcBakiye) || 0,
        alacakBakiye: Number(p.alacakBakiye) || 0,
      })),
    });
  }

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
    if (tevkifatAyri.ocrsizTevkifatliAdet > 0) {
      kaliteRapor.uyarilar.push(
        `${tevkifatAyri.ocrsizTevkifatliAdet} adet tevkifatlı alış faturası OCR'dan geçmemiş — ` +
          `KDV2 tutarı eksik hesaplanmış olabilir. Kesin rakam için KDV Kontrol modülünden geçirin.`,
      );
    }

    const eksikVeriler: KdvEksikVeri[] = [
      ...satis.eksikVeriler,
      ...alisTumu.eksikVeriler,
      ...tevkifatAyri.eksikVeriler,
    ];
    if (!lucaKontrol.mizanVar) {
      eksikVeriler.push({
        tur: 'luca_mizan',
        seviye: 'bilgi',
        taraf: 'LUCA',
        mesaj: 'Bu dönem için KDV’ye özel Luca aylık mizan henüz çekilmedi.',
        aksiyon: "Luca'dan Veri Çek ile seçili ay mizanını al.",
      });
    }
    if (devreden.kaynak === 'yok') {
      eksikVeriler.push({
        tur: 'devreden_kdv',
        seviye: 'bilgi',
        taraf: 'GENEL',
        mesaj: 'Önceki dönem devreden KDV kaydı bulunamadı; tutar 0 kabul edildi.',
        aksiyon: 'Önceki KDV1 beyan kaydındaki devreden tutarı kontrol et.',
      });
    }
    const veriGuveni = this.hesaplaVeriGuveni({
      kesinFaturaAdet: satis.ocrliAdet + satis.xmlAdet + alisTumu.ocrliAdet + alisTumu.xmlAdet,
      toplamFaturaAdet: satis.faturaAdet + alisTumu.faturaAdet,
      kontrolGerekliAdet:
        satis.kontrolGerekliAdet + alisTumu.kontrolGerekliAdet + tevkifatAyri.ocrsizTevkifatliAdet,
      lucaMizanVar: lucaKontrol.mizanVar,
      kritikEksikAdet: eksikVeriler.filter((e) => e.seviye === 'kritik').length,
    });

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
      eksikVeriler,
      veriGuveni,
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
      tevkifatKodu: f.tevkifatKodu || 'KOD_YOK',
      tevkifatTutari: Math.round(f.tevkifatTutari * 100) / 100,
      kaynak: f.kaynak || 'ocr_eksik',
    }));

    const toplamMatrah = satirlar.reduce((s: number, r: any) => s + r.matrah, 0);
    const toplamHesaplananKdv = satirlar.reduce((s: number, r: any) => s + r.hesaplananKdv, 0);
    const toplamTevkifat = satirlar.reduce((s: number, r: any) => s + r.tevkifatTutari, 0);

    // Tevkifat oranı bazlı gruplama
    const gruplar = new Map<string, { matrah: number; tevkifat: number; adet: number }>();
    for (const s of satirlar) {
      if (s.kaynak !== 'ocr') continue;
      const kod = s.tevkifatKodu || 'KOD_YOK';
      const g = gruplar.get(kod) || { matrah: 0, tevkifat: 0, adet: 0 };
      g.matrah += s.matrah;
      g.tevkifat += s.tevkifatTutari;
      g.adet += 1;
      gruplar.set(kod, g);
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
    const eksikVeriler: KdvEksikVeri[] = satirlar
      .filter((f: any) => f.kaynak === 'ocr_eksik')
      .map((f: any) => ({
        tur: 'tevkifat_ocr',
        seviye: 'kritik',
        belgeNo: f.belgeNo,
        taraf: 'KDV2',
        mesaj: 'Tevkifatlı alış faturasında OCR/teyitli tevkifat tutarı yok; KDV2 toplamına dahil edilmedi.',
        aksiyon: KDV_KONTROL_DURUMU,
      }));
    const kodEksikleri: KdvEksikVeri[] = satirlar
      .filter((f: any) => f.kaynak === 'ocr' && f.tevkifatKodu === 'KOD_YOK')
      .map((f: any) => ({
        tur: 'tevkifat_kodu',
        seviye: 'uyari',
        belgeNo: f.belgeNo,
        taraf: 'KDV2',
        mesaj: 'Tevkifat tutarı bulundu ama GİB tevkifat kodu okunamadı; oran/kod elle kontrol edilmeli.',
        aksiyon: 'Tevkifat kodunu KDV Kontrol sonucundan veya faturadan teyit et.',
      }));
    eksikVeriler.push(...kodEksikleri);
    if (eksikVeriler.some((e) => e.tur === 'tevkifat_ocr')) {
      uyarilar.push(
        `${eksikVeriler.filter((e) => e.tur === 'tevkifat_ocr').length} tevkifatlı alış faturası için tutar okunamadı. Kesin değer için KDV Kontrol'den geçirin.`,
      );
    }

    if (kodEksikleri.length > 0) {
      uyarilar.push(`${kodEksikleri.length} tevkifat satırında GİB kodu okunamadı; kod bazlı özet kontrol edilmeli.`);
    }

    const veriGuveni = this.hesaplaVeriGuveni({
      kesinFaturaAdet: satirlar.filter((s: any) => s.kaynak === 'ocr').length,
      toplamFaturaAdet: satirlar.length,
      kontrolGerekliAdet: eksikVeriler.length,
      lucaMizanVar: false,
      kritikEksikAdet: eksikVeriler.filter((e) => e.seviye === 'kritik').length,
    });

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
      eksikVeriler,
      veriGuveni,
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

    // KDV beyannamesine dahil etme kuralı:
    //   HER ŞEY DAHİL — kullanıcı kuralı: Faturalar listesinde görünen bütün
    //   belgeler KDV matrah/hesaplamasına girer. Tevkifatlı faturalar dahil,
    //   fişler dahil, Z raporu dahil, irsaliye dahil. Hiçbir kısıtlama yok.
    //   (Tevkifat ayrıca `ayirTevkifatliAlis` ile KDV2'ye yönlendirilir.)
    const faturaOnly = faturalar;

    // KDV Kontrol verileri: SQL tarafında birebir belgeNo arama yapmıyoruz.
    // Luca/Mihsap belge no formatı sıfır, tire, slash veya boşluk farkıyla gelebiliyor;
    // bu yüzden ilgili dönem/tip kayıtlarını alıp belge no'yu JS tarafında normalize ederek eşliyoruz.
    const kdvTipleri =
      faturaTuru === 'SATIS' ? ['KDV_391', 'ISLETME_GELIR'] : ['KDV_191', 'ISLETME_GIDER'];
    const sessionWhere = {
      tenantId,
      OR: [{ taxpayerId: mukellefId }, { taxpayerId: null }],
      periodLabel: { in: this.periodLabelCandidates(donem) },
      type: { in: kdvTipleri },
    };

    const kdvResults = await (this.prisma as any).reconciliationResult.findMany({
      where: {
        session: sessionWhere,
        status: { in: ['MATCHED', 'CONFIRMED', 'PARTIAL_MATCH', 'NEEDS_REVIEW'] },
      },
      include: { image: true, kdvRecord: true },
    });

    const controlMap = new Map<string, Array<{ oran: number; matrah: number; kdv: number }>>();
    const setControlRows = (belgeNo: any, rows: Array<{ oran: number; matrah: number; kdv: number }>) => {
      if (!rows.length) return;
      for (const key of this.belgeNoKeys(belgeNo)) {
        if (!controlMap.has(key)) controlMap.set(key, rows);
      }
    };

    for (const res of kdvResults) {
      const rows = this.kdvRowsFromControl(res.kdvRecord, res.image);
      setControlRows(res.image?.confirmedBelgeNo, rows);
      setControlRows(res.image?.ocrBelgeNo, rows);
      setControlRows(res.kdvRecord?.belgeNo, rows);
    }

    const kdvRecords = await (this.prisma as any).kdvRecord.findMany({
      where: {
        session: sessionWhere,
      },
    });
    for (const r of kdvRecords) {
      setControlRows(r.belgeNo, this.kdvRowsFromControl(r, null));
    }

    const receiptImages = await (this.prisma as any).receiptImage.findMany({
      where: { session: sessionWhere },
    });
    for (const image of receiptImages) {
      const rows = this.kdvRowsFromControl(null, image);
      setControlRows(image.confirmedBelgeNo, rows);
      setControlRows(image.ocrBelgeNo, rows);
      setControlRows(image.originalName, rows);
    }

    // Oran bazlı toplama
    const oranMap = new Map<
      number,
      { matrah: number; kdv: number; adet: number; kaynak?: 'kdv_kontrol' | 'mihsap_xml' }
    >();
    const addToOran = (
      oran: number,
      matrah: number,
      kdv: number,
      kaynak: 'kdv_kontrol' | 'mihsap_xml',
    ) => {
      const g = oranMap.get(oran) || { matrah: 0, kdv: 0, adet: 0, kaynak };
      g.matrah += matrah;
      g.kdv += kdv;
      g.adet += 1;
      if (g.kaynak !== kaynak) g.kaynak = undefined;
      oranMap.set(oran, g);
    };

    let ocrliAdet = 0;
    let xmlAdet = 0;
    let kontrolGerekliAdet = 0;
    const eksikVeriler: KdvEksikVeri[] = [];

    for (const f of faturaOnly) {
      const controlRows = this.completeControlRows(
        this.findByBelgeNo(controlMap, f.faturaNo) || [],
        f,
      );
      if (controlRows.length > 0) {
        for (const row of controlRows) {
          addToOran(row.oran, row.matrah, row.kdv, 'kdv_kontrol');
        }
        ocrliAdet++;
      } else {
        // Tahmin: toplam = matrah * (1 + oran/100) → matrah = toplam / 1.20
        const breakdown = this.extractKdvBreakdownFromRaw(f.raw);
        if (breakdown.length > 0) {
          for (const b of breakdown) {
            addToOran(b.oran, b.matrah, b.kdv, 'mihsap_xml');
          }
          xmlAdet++;
        } else {
          kontrolGerekliAdet++;
          eksikVeriler.push({
            tur: 'kdv_kontrol',
            seviye: 'uyari',
            belgeNo: f.faturaNo,
            taraf: faturaTuru,
            mesaj: `${faturaTuru === 'ALIS' ? 'Alış' : 'Satış'} faturasında KDV oran/matrah detayı yok; beyan toplamına dahil edilmedi.`,
            aksiyon: KDV_KONTROL_DURUMU,
          });
        }
      }
    }

    const oranlar: OranRow[] = Array.from(oranMap.entries())
      .map(([oran, v]) => ({
        oran,
        matrah: Math.round(v.matrah * 100) / 100,
        kdv: Math.round(v.kdv * 100) / 100,
        kaynak: v.kaynak,
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
      xmlAdet,
      kontrolGerekliAdet,
      tahminAdet: kontrolGerekliAdet,
      eksikVeriler,
    };
  }

  /** Tevkifatlı alış faturalarını ayır (KDV2'ye girer)
   *
   *  ÖNCELİK: OCR (KdvRecord) → kesin matrah + hesaplanan KDV + tevkifat tutarı.
   *  FALLBACK: OCR'dan geçmeyen TEVKIFATLI_ALIS faturası varsa TAHMİN YAPMAZ —
   *  sadece "şu kadar fatura OCR'dan geçmemiş, KDV2 eksik olabilir" uyarısını
   *  `ocrsizTevkifatliAdet` ile yukarı bildirir. Beyannameye yanlış rakam
   *  yazmaktansa kullanıcıyı OCR'a yönlendirmek doğru.
   */
  private async ayirTevkifatliAlis(
    tenantId: string,
    mukellefId: string,
    donem: string,
  ): Promise<{
    matrah: number;
    tevkifatKdvToplam: number;
    hesaplananKdvToplam: number;
    adet: number;
    ocrsizTevkifatliAdet: number;
    eksikVeriler: KdvEksikVeri[];
  }> {
    const faturalar = await this.getTevkifatliAlisFaturalari(tenantId, mukellefId, donem);
    const kesinSatirlar = faturalar.filter((f: any) => f.kaynak === 'ocr');
    const eksikSatirlar = faturalar.filter((f: any) => f.kaynak === 'ocr_eksik');
    return {
      matrah: kesinSatirlar.reduce((s: number, f: any) => s + Number(f.matrah || 0), 0),
      tevkifatKdvToplam: kesinSatirlar.reduce((s: number, f: any) => s + Number(f.tevkifatTutari || 0), 0),
      hesaplananKdvToplam: kesinSatirlar.reduce((s: number, f: any) => s + Number(f.hesaplananKdv || 0), 0),
      adet: kesinSatirlar.length,
      ocrsizTevkifatliAdet: eksikSatirlar.length,
      eksikVeriler: eksikSatirlar.map((f: any) => ({
        tur: 'tevkifat_ocr',
        seviye: 'kritik',
        belgeNo: f.belgeNo,
        taraf: 'KDV2',
        mesaj: 'Tevkifatlı alış faturasında OCR/teyitli tevkifat tutarı yok; KDV2 toplamına dahil edilmedi.',
        aksiyon: KDV_KONTROL_DURUMU,
      })),
    };

    let matrah = 0;
    let tevkifatKdv = 0;
    let hesaplananKdv = 0;
    let adet = 0;
    const seenBelgeNo = new Set<string>();

    // Birincil kaynak — OCR (KdvRecord + rawData.kdvTevkifat)
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
    for (const r of records) {
      const tevkifat = Number(r.rawData?.kdvTevkifat || 0);
      if (tevkifat > 0) {
        matrah += Number(r.kdvMatrahi || 0);
        tevkifatKdv += tevkifat;
        hesaplananKdv += Number(r.kdvTutari || 0) + tevkifat;
        adet++;
        if (r.belgeNo) seenBelgeNo.add(r.belgeNo);
      }
    }

    // OCR'dan geçmemiş tevkifatlı faturalar — sadece adet say, tahmin yapma
    const mihsapTevkifat = await (this.prisma as any).mihsapInvoice.findMany({
      where: {
        tenantId,
        mukellefId,
        donem,
        // Sadece ALIŞ tarafı tevkifatı (tevkifat sorumlusu sıfatıyla beyan).
        // "TEVKIFATLI_SATIS" HARİÇ — o firmanın kendi hesapladığı KDV, KDV1'de.
        AND: [
          { faturaTuru: { contains: 'TEVKIFAT' } },
          { faturaTuru: { contains: 'ALIS' } },
        ],
      },
      select: { faturaNo: true },
    });
    const ocrsizTevkifatliAdet = mihsapTevkifat.filter(
      (f: any) => !seenBelgeNo.has(f.faturaNo),
    ).length;
    const eksikVeriler: KdvEksikVeri[] = mihsapTevkifat
      .filter((f: any) => !seenBelgeNo.has(f.faturaNo))
      .map((f: any) => ({
        tur: 'tevkifat_ocr',
        seviye: 'kritik',
        belgeNo: f.faturaNo,
        taraf: 'KDV2',
        mesaj: 'Tevkifatlı alış faturasında OCR/teyitli tevkifat tutarı yok; KDV2 toplamına dahil edilmedi.',
        aksiyon: KDV_KONTROL_DURUMU,
      }));

    return {
      matrah,
      tevkifatKdvToplam: tevkifatKdv,
      hesaplananKdvToplam: hesaplananKdv,
      adet,
      ocrsizTevkifatliAdet,
      eksikVeriler,
    };
  }

  /** KDV2 için tüm tevkifatlı alış faturalarını döner (detay satır)
   *
   *  ÖNCELİK: OCR (KdvRecord + rawData.kdvTevkifat) → kesin rakam.
   *  OCR'ı olmayan TEVKIFATLI_ALIS faturaları listeye "oran ve tutarı bilinmiyor"
   *  etiketiyle eklenir. Kullanıcı hangi faturaları OCR'dan geçirmesi gerektiğini
   *  görür; sistem yanlış rakam beyannameye yazmaz.
   */
  private async getTevkifatliAlisFaturalari(
    tenantId: string,
    mukellefId: string,
    donem: string,
  ) {
    const satirlar: any[] = [];
    const seenBelgeNo = new Set<string>();

    const results = await (this.prisma as any).reconciliationResult.findMany({
      where: {
        session: {
          tenantId,
          taxpayerId: mukellefId,
          periodLabel: { in: [donem, donem.replace('-', '/')] },
          type: 'KDV_191',
        },
      },
      include: { image: true, kdvRecord: true },
      orderBy: { createdAt: 'asc' },
    });

    for (const res of results) {
      const image = res.image;
      const r = res.kdvRecord;
      const tevkifat = this.parseTrAmount(image?.confirmedKdvTevkifat ?? image?.ocrKdvTevkifat);
      if (tevkifat <= 0) continue;

      const belgeNo = image?.confirmedBelgeNo || image?.ocrBelgeNo || r?.belgeNo || '';
      const key = this.normalizeBelgeNo(belgeNo);
      if (key && seenBelgeNo.has(key)) continue;

      const netKdv =
        this.parseTrAmount(image?.confirmedKdvTutari ?? image?.ocrKdvTutari) ||
        this.parseTrAmount(r?.kdvTutari);
      const hesaplanan = netKdv + tevkifat;
      const breakdown = this.extractKdvBreakdownFromRaw(image?.confirmedKdvBreakdown ?? image?.ocrKdvBreakdown);
      const oran = this.parseTrAmount(r?.kdvOrani) || breakdown[0]?.oran || 0;
      const matrah =
        breakdown.reduce((sum, b) => sum + b.matrah, 0) ||
        this.parseTrAmount(r?.kdvMatrahi) ||
        (oran > 0 ? hesaplanan / (oran / 100) : 0);

      satirlar.push({
        belgeNo,
        satici: image?.ocrSatici || r?.karsiTaraf || '—',
        saticiVkn: image?.ocrSaticiVkn || r?.rawData?.saticiVkn || r?.rawData?.vkn || '',
        tarih: image?.confirmedDate || image?.ocrDate || (r?.belgeDate ? r.belgeDate.toISOString().slice(0, 10) : ''),
        matrah,
        hesaplananKdv: hesaplanan,
        tevkifatOrani: this.tevkifatOranStr(hesaplanan > 0 ? tevkifat / hesaplanan : 0),
        tevkifatKodu: this.extractTevkifatKodu(image, r),
        tevkifatTutari: tevkifat,
        kaynak: 'ocr' as const,
      });
      if (key) seenBelgeNo.add(key);
    }

    // Birincil — OCR (kesin)
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
    for (const r of records) {
      const key = this.normalizeBelgeNo(r.belgeNo);
      if (key && seenBelgeNo.has(key)) continue;
      const tevkifat = this.parseTrAmount(r.rawData?.kdvTevkifat);
      if (tevkifat <= 0) continue;
      const netKdv = this.parseTrAmount(r.kdvTutari);
      const hesaplanan = netKdv + tevkifat;
      const oran = hesaplanan > 0 ? tevkifat / hesaplanan : 0;
      satirlar.push({
        belgeNo: r.belgeNo || '',
        satici: r.karsiTaraf || '—',
        saticiVkn: r.rawData?.saticiVkn || r.rawData?.vkn || '',
        tarih: r.belgeDate ? r.belgeDate.toISOString().slice(0, 10) : '',
        matrah: Number(r.kdvMatrahi || 0),
        hesaplananKdv: hesaplanan,
        tevkifatOrani: this.tevkifatOranStr(oran),
        tevkifatKodu: this.extractTevkifatKodu(null, r),
        tevkifatTutari: tevkifat,
        kaynak: 'ocr' as const,
      });
      if (key) seenBelgeNo.add(key);
    }

    // OCR'ı olmayan TEVKIFATLI_ALIS faturalar — işaretli listele (rakamlar 0)
    const mihsapTevkifat = await (this.prisma as any).mihsapInvoice.findMany({
      where: {
        tenantId,
        mukellefId,
        donem,
        // Sadece ALIŞ tarafı tevkifatı (tevkifat sorumlusu sıfatıyla beyan).
        // "TEVKIFATLI_SATIS" HARİÇ — o firmanın kendi hesapladığı KDV, KDV1'de.
        AND: [
          { faturaTuru: { contains: 'TEVKIFAT' } },
          { faturaTuru: { contains: 'ALIS' } },
        ],
      },
      orderBy: { faturaTarihi: 'asc' },
    });
    for (const f of mihsapTevkifat) {
      const key = this.normalizeBelgeNo(f.faturaNo);
      if (key && seenBelgeNo.has(key)) continue;
      satirlar.push({
        belgeNo: f.faturaNo || '',
        satici: f.firmaUnvan || '—',
        saticiVkn: f.firmaKimlikNo || '',
        tarih: f.faturaTarihi ? new Date(f.faturaTarihi).toISOString().slice(0, 10) : '',
        matrah: 0,
        hesaplananKdv: 0,
        tevkifatOrani: 'OCR gerekli',
        tevkifatKodu: 'KOD_YOK',
        tevkifatTutari: 0,
        kaynak: 'ocr_eksik' as const,
        toplamTutar: Number(f.toplamTutar || 0), // referans için
      });
    }

    return satirlar;
  }

  private normalizeBelgeNo(value: any): string {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  private belgeNoKeys(value: any): string[] {
    const normalized = this.normalizeBelgeNo(value);
    if (!normalized) return [];
    const keys = new Set<string>([normalized]);
    const stripped = this.stripLeadingZeros(normalized);
    if (stripped) keys.add(stripped);
    keys.add(this.eInvoiceComparableKey(normalized));
    const digitRuns = normalized.match(/\d+/g) || [];
    const lastDigits = digitRuns[digitRuns.length - 1] || '';
    for (const len of [4, 5, 6, 7, 8, 9]) {
      if (lastDigits.length >= len) {
        keys.add(this.stripLeadingZeros(lastDigits.slice(-len)));
      }
    }
    return Array.from(keys).filter(Boolean);
  }

  private findByBelgeNo<T>(map: Map<string, T>, belgeNo: any): T | undefined {
    for (const key of this.belgeNoKeys(belgeNo)) {
      const hit = map.get(key);
      if (hit) return hit;
    }
    return undefined;
  }

  private completeControlRows(
    rows: Array<{ oran: number; matrah: number; kdv: number }>,
    invoice: any,
  ): Array<{ oran: number; matrah: number; kdv: number }> {
    return rows
      .map((row) => this.completeControlRow(row, invoice))
      .filter((row) => row.kdv > 0 && row.matrah > 0 && row.oran > 0);
  }

  private completeControlRow(
    row: { oran: number; matrah: number; kdv: number },
    invoice: any,
  ): { oran: number; matrah: number; kdv: number } {
    let oran = Number(row.oran || 0);
    let matrah = Number(row.matrah || 0);
    let kdv = Number(row.kdv || 0);
    if (oran > 0) oran = this.nearestKdvRate(oran);

    if (!kdv && oran > 0 && matrah > 0) kdv = matrah * (oran / 100);
    if (!matrah && oran > 0 && kdv > 0) matrah = kdv / (oran / 100);

    if (!oran && matrah > 0 && kdv > 0) {
      oran = this.nearestKdvRate((kdv / matrah) * 100);
    }

    if ((!matrah || !oran) && kdv > 0) {
      const gross = Number(invoice?.toplamTutar || 0);
      const inferredBase = gross > kdv ? gross - kdv : 0;
      if (inferredBase > 0) {
        const inferredRate = this.nearestKdvRate((kdv / inferredBase) * 100);
        if (!oran) oran = inferredRate;
        if (!matrah) matrah = inferredBase;
      }
    }

    oran = this.nearestKdvRate(oran);
    if (!oran && matrah > 0 && kdv > 0) {
      oran = this.nearestKdvRate((kdv / matrah) * 100);
    }
    if (!oran && kdv > 0 && Number(invoice?.toplamTutar || 0) > kdv) {
      const gross = Number(invoice?.toplamTutar || 0);
      const inferredBase = gross - kdv;
      const inferredRate = this.nearestKdvRate((kdv / inferredBase) * 100);
      if (inferredRate) {
        oran = inferredRate;
        matrah = inferredBase;
      }
    }
    if (!oran) return { oran: 0, matrah: 0, kdv: 0 };
    if (!matrah && oran > 0 && kdv > 0) matrah = kdv / (oran / 100);

    if (matrah > 0 && kdv > 0) {
      const expectedKdv = matrah * (oran / 100);
      const tolerance = Math.max(0.1, Math.abs(kdv) * 0.03);
      if (Math.abs(expectedKdv - kdv) > tolerance) {
        const inferredRate = this.nearestKdvRate((kdv / matrah) * 100);
        if (inferredRate && inferredRate !== oran) {
          oran = inferredRate;
        } else {
          return { oran: 0, matrah: 0, kdv: 0 };
        }
      }
    }

    return {
      oran,
      matrah: Math.round(matrah * 100) / 100,
      kdv: Math.round(kdv * 100) / 100,
    };
  }

  private nearestKdvRate(rate: number): number {
    if (!Number.isFinite(rate) || rate <= 0) return 0;
    if (rate > 0 && rate < 1) rate = rate * 100;
    let best = GECERLI_KDV_ORANLARI[0];
    let bestDiff = Math.abs(rate - best);
    for (const candidate of GECERLI_KDV_ORANLARI.slice(1)) {
      const diff = Math.abs(rate - candidate);
      if (diff < bestDiff) {
        best = candidate;
        bestDiff = diff;
      }
    }
    return bestDiff <= 1.25 ? best : 0;
  }

  private kdvRowsFromControl(record: any, image: any): Array<{ oran: number; matrah: number; kdv: number }> {
    const breakdown = this.extractKdvBreakdownFromRaw(
      image?.confirmedKdvBreakdown ?? image?.ocrKdvBreakdown,
    );
    if (breakdown.length > 0) return breakdown;

    const oran = this.parseTrAmount(record?.kdvOrani);
    const matrah = this.parseTrAmount(record?.kdvMatrahi);
    const kdv = this.parseTrAmount(record?.kdvTutari);
    if (oran > 0 && (matrah > 0 || kdv > 0)) {
      return [{
        oran,
        matrah: matrah || kdv / (oran / 100),
        kdv: kdv || matrah * (oran / 100),
      }];
    }
    const imageKdv = this.parseTrAmount(image?.confirmedKdvTutari ?? image?.ocrKdvTutari);
    if (imageKdv > 0) {
      return [{ oran: 0, matrah: 0, kdv: imageKdv }];
    }
    return [];
  }

  private stripLeadingZeros(value: string): string {
    return value.replace(/^0+/, '') || '0';
  }

  private eInvoiceComparableKey(normalizedBelgeNo: string): string {
    const m = normalizedBelgeNo.match(/^([A-Z]{2,4})(20\d{2})(\d{6,14})$/)
      ?? normalizedBelgeNo.match(/^([A-Z]\d{2})(20\d{2})(\d{6,14})$/);
    if (!m) return normalizedBelgeNo;
    return `${m[1]}${m[2]}${m[3].replace(/^0+/, '') || '0'}`;
  }

  private periodLabelCandidates(donem: string): string[] {
    const m = /^(\d{4})[-/](\d{1,2})$/.exec(String(donem || '').trim());
    if (!m) return [donem, donem.replace('-', '/')].filter(Boolean);
    const yil = m[1];
    const ay = String(Number(m[2]));
    const ay2 = ay.padStart(2, '0');
    return Array.from(new Set([`${yil}-${ay2}`, `${yil}/${ay2}`, `${yil}-${ay}`, `${yil}/${ay}`]));
  }

  private parseTrAmount(value: any): number {
    if (value == null || value === '') return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const raw = String(value)
      .replace(/\s/g, '')
      .replace(/TL|TRY|₺/gi, '')
      .trim();
    if (!raw) return 0;
    const normalized =
      raw.includes(',') && raw.includes('.')
        ? raw.replace(/\./g, '').replace(',', '.')
        : raw.includes(',')
          ? raw.replace(',', '.')
          : raw;
    const n = Number(normalized.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  private extractKdvBreakdownFromRaw(raw: any): Array<{ oran: number; matrah: number; kdv: number }> {
    if (raw == null) return [];
    let value = raw;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return [];
      try {
        value = JSON.parse(trimmed);
      } catch {
        return [];
      }
    }

    const rows: Array<{ oran: number; matrah: number; kdv: number }> = [];
    const seen = new Set<string>();
    const rateKeys = ['oran', 'kdvOrani', 'kdv_orani', 'taxRate', 'tax_rate', 'rate', 'percent', 'yuzde'];
    const baseKeys = ['matrah', 'kdvMatrahi', 'kdv_matrahi', 'taxBase', 'tax_base', 'taxableAmount', 'malHizmetTutari'];
    const vatKeys = ['kdv', 'kdvTutari', 'kdv_tutari', 'taxAmount', 'tax_amount', 'hesaplananKdv', 'tutar', 'amount'];

    const pick = (obj: any, keys: string[]) => {
      if (!obj || typeof obj !== 'object') return 0;
      for (const key of keys) {
        if (obj[key] != null) return this.parseTrAmount(obj[key]);
      }
      return 0;
    };

    const addIfBreakdown = (obj: any) => {
      const oran = pick(obj, rateKeys);
      let matrah = pick(obj, baseKeys);
      let kdv = pick(obj, vatKeys);
      if (!oran || (!matrah && !kdv)) return;
      if (!matrah && kdv) matrah = kdv / (oran / 100);
      if (!kdv && matrah) kdv = matrah * (oran / 100);
      if (!matrah && !kdv) return;
      const cleaned = this.completeControlRow({ oran, matrah, kdv }, null);
      if (!cleaned.oran || !cleaned.matrah || !cleaned.kdv) return;
      const key = `${cleaned.oran}:${Math.round(cleaned.matrah * 100)}:${Math.round(cleaned.kdv * 100)}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(cleaned);
    };

    const visit = (node: any, depth = 0) => {
      if (node == null || depth > 5) return;
      if (Array.isArray(node)) {
        for (const item of node) visit(item, depth + 1);
        return;
      }
      if (typeof node !== 'object') return;
      addIfBreakdown(node);
      for (const child of Object.values(node)) visit(child, depth + 1);
    };

    visit(value);
    return rows;
  }

  private extractTevkifatKodu(image: any, record: any): string {
    const buckets = [
      image?.ocrRawText,
      image?.confirmedKdvBreakdown,
      image?.ocrKdvBreakdown,
      record?.rawData,
    ];
    for (const bucket of buckets) {
      if (!bucket) continue;
      const text = typeof bucket === 'string' ? bucket : JSON.stringify(bucket);
      const explicit = /tevkifat[^0-9]{0,20}(6\d{2})/i.exec(text);
      if (explicit?.[1]) return explicit[1];
      const anyCode = /\b(6\d{2})\b/.exec(text);
      if (anyCode?.[1]) return anyCode[1];
    }
    return 'KOD_YOK';
  }

  private hesaplaVeriGuveni(params: {
    kesinFaturaAdet: number;
    toplamFaturaAdet: number;
    kontrolGerekliAdet: number;
    lucaMizanVar: boolean;
    kritikEksikAdet: number;
  }): VeriGuveni {
    const toplam = Math.max(params.toplamFaturaAdet, 0);
    const kesinOran = toplam > 0 ? params.kesinFaturaAdet / toplam : 1;
    let puan = Math.round(kesinOran * 85) + (params.lucaMizanVar ? 15 : 0);
    puan -= Math.min(params.kritikEksikAdet * 10, 40);
    puan = Math.max(0, Math.min(100, puan));
    return {
      seviye:
        params.kritikEksikAdet > 0 || puan < 60
          ? 'eksik'
          : params.kontrolGerekliAdet > 0 || !params.lucaMizanVar || puan < 90
            ? 'kontrol_gerekli'
            : 'kesin',
      puan,
      kesinFaturaAdet: params.kesinFaturaAdet,
      toplamFaturaAdet: params.toplamFaturaAdet,
      kontrolGerekliAdet: params.kontrolGerekliAdet,
      lucaMizanVar: params.lucaMizanVar,
    };
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

  async setDevredenKdv(params: {
    tenantId: string;
    mukellefId: string;
    donem: string;
    tutar: number;
    mode?: 'onceki' | 'sonraki';
  }) {
    if (!/^\d{4}-\d{2}$/.test(params.donem)) {
      throw new BadRequestException('Dönem yyyy-mm formatında olmalı.');
    }
    await this.getMukellef(params.tenantId, params.mukellefId);
    const mode = params.mode === 'sonraki' ? 'sonraki' : 'onceki';
    const tutar = Math.max(0, Math.round(Number(params.tutar || 0) * 100) / 100);
    const tag = mode === 'sonraki' ? SONRAKI_DEVREDEN_TAG : DEVREDEN_MANUEL_TAG;
    const existing = await (this.prisma as any).beyanDurumu.findUnique({
      where: {
        tenantId_taxpayerId_beyanTipi_donem: {
          tenantId: params.tenantId,
          taxpayerId: params.mukellefId,
          beyanTipi: 'KDV1',
          donem: params.donem,
        },
      },
      select: { notlar: true },
    });
    const notlar = this.setTaggedAmount(existing?.notlar, tag, tutar);
    const kayit = await (this.prisma as any).beyanDurumu.upsert({
      where: {
        tenantId_taxpayerId_beyanTipi_donem: {
          tenantId: params.tenantId,
          taxpayerId: params.mukellefId,
          beyanTipi: 'KDV1',
          donem: params.donem,
        },
      },
      create: {
        tenantId: params.tenantId,
        taxpayerId: params.mukellefId,
        beyanTipi: 'KDV1',
        donem: params.donem,
        durum: 'beklemede',
        notlar,
      },
      update: { notlar },
    });
    return {
      ok: true,
      mode,
      donem: params.donem,
      sonrakiDonem: mode === 'sonraki' ? this.sonrakiDonem(params.donem) : null,
      tutar,
      kayitId: kayit.id,
    };
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

    const mevcutDurum = await (this.prisma as any).beyanDurumu.findUnique({
      where: {
        tenantId_taxpayerId_beyanTipi_donem: {
          tenantId,
          taxpayerId: mukellefId,
          beyanTipi: 'KDV1',
          donem,
        },
      },
      select: { notlar: true },
    });
    const manuel = this.readTaggedAmount(mevcutDurum?.notlar, DEVREDEN_MANUEL_TAG);
    if (manuel !== null) {
      return {
        tutar: manuel,
        kaynak: 'manuel' as const,
        sonKayitDonem: donem,
      };
    }

    const oncekiDurum = await (this.prisma as any).beyanDurumu.findUnique({
      where: {
        tenantId_taxpayerId_beyanTipi_donem: {
          tenantId,
          taxpayerId: mukellefId,
          beyanTipi: 'KDV1',
          donem: onceki,
        },
      },
      select: { notlar: true },
    });
    const oncekidenAktarilan = this.readTaggedAmount(oncekiDurum?.notlar, SONRAKI_DEVREDEN_TAG);
    if (oncekidenAktarilan !== null) {
      return {
        tutar: oncekidenAktarilan,
        kaynak: 'beyan_durumu' as const,
        sonKayitDonem: onceki,
      };
    }

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
    tenantId: string,
    mukellefId: string,
    donem: string,
    mihsapHesaplanan: number,
    mihsapIndirilecek: number,
    devreden: number,
  ) {
    const uyarilar: string[] = [];
    const snapshot = await (this.prisma as any).kdvLucaSnapshot.findUnique({
      where: { tenantId_taxpayerId_donem: { tenantId, taxpayerId: mukellefId, donem } },
    });

    if (!snapshot) {
      return {
        mizanVar: false,
        luca391Bakiye: null,
        luca191Bakiye: null,
        luca190Bakiye: null,
        fark391: null,
        fark191: null,
        uyarilar,
        cekildiAt: null,
        donemTipi: 'AYLIK' as const,
      };
    }

    const rows: any[] = Array.isArray(snapshot.hamMizan) ? snapshot.hamMizan : [];

    // Luca mizan hiyerarsik gelir: 391, 391.01 ve 391.01.001 ayni bakiyeyi
    // tasiyabilir. Capraz kontrolde sadece en detay (leaf) satirlari toplayarak
    // ana/ara hesap tekrarlarini saymiyoruz.
    const sumBakiye = (kodPrefix: string, tip: 'borc' | 'alacak'): number | null => {
      const matches = rows.filter((r: any) => this.isKodOrChild(this.mizanKod(r), kodPrefix));
      if (matches.length === 0) return null;

      const matchKodlar = new Set(matches.map((r: any) => this.mizanKod(r)).filter(Boolean));
      const leafMatches = matches.filter((r: any) => this.isLeafMizanKod(this.mizanKod(r), matchKodlar));
      const sideValue = (r: any) => this.mizanAmount(tip === 'borc' ? r.borcBakiye : r.alacakBakiye);
      const sumRows = (items: any[]) =>
        Math.round(items.reduce((acc, r) => acc + sideValue(r), 0) * 100) / 100;

      const leafTotal = sumRows(leafMatches);
      if (Math.abs(leafTotal) > 0.005) return leafTotal;

      const exact = matches.find((r: any) => this.mizanKod(r) === kodPrefix);
      if (exact && Math.abs(sideValue(exact)) > 0.005) {
        return Math.round(sideValue(exact) * 100) / 100;
      }

      return sumRows(matches);
    };

    const luca391 = sumBakiye('391', 'alacak');
    const luca191 = sumBakiye('191', 'borc');
    const luca190 = sumBakiye('190', 'borc');

    const fark391 = luca391 !== null ? Math.round((mihsapHesaplanan - luca391) * 100) / 100 : null;
    const fark191 = luca191 !== null ? Math.round((mihsapIndirilecek - luca191) * 100) / 100 : null;

    const TOL_TL = 1;
    if (fark391 !== null && Math.abs(fark391) > TOL_TL && Math.abs(fark391) > mihsapHesaplanan * 0.005) {
      uyarilar.push(
        `391 Hesaplanan KDV uyumsuz: Mihsap ${this.fmt(mihsapHesaplanan)} ≠ Luca ${this.fmt(luca391!)} (fark ${this.fmt(fark391)})`,
      );
    }
    if (fark191 !== null && Math.abs(fark191) > TOL_TL && Math.abs(fark191) > mihsapIndirilecek * 0.005) {
      uyarilar.push(
        `191 İndirilecek KDV uyumsuz: Mihsap ${this.fmt(mihsapIndirilecek)} ≠ Luca ${this.fmt(luca191!)} (fark ${this.fmt(fark191)})`,
      );
    }
    if (luca190 !== null && devreden > 0 && Math.abs(luca190 - devreden) > TOL_TL) {
      uyarilar.push(
        `190 Devreden KDV uyumsuz: BeyanKaydi ${this.fmt(devreden)} ≠ Luca ${this.fmt(luca190)}`,
      );
    }

    return {
      mizanVar: true,
      luca391Bakiye: luca391,
      luca191Bakiye: luca191,
      luca190Bakiye: luca190,
      fark391,
      fark191,
      uyarilar,
      cekildiAt: snapshot.cekildiAt,
      donemTipi: 'AYLIK' as const,
    };
  }

  private fmt(n: number): string {
    return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ===== KDV-ÖZEL LUCA SNAPSHOT =====

  /** KDV-özel Luca mizan job yarat (KDV_MIZAN tipi) */
  async fetchLucaSnapshot(params: {
    tenantId: string;
    mukellefId: string;
    donem: string;
    createdBy?: string;
    targetDeviceId?: string;
  }) {
    if (!/^\d{4}-\d{2}$/.test(params.donem)) {
      throw new BadRequestException('KDV mizan çekimi aylık dönem ister (yyyy-mm).');
    }
    const mukellef = await this.getMukellef(params.tenantId, params.mukellefId);
    const job = await (this.prisma as any).lucaFetchJob.create({
      data: {
        tenantId: params.tenantId,
        sessionId: null,
        mukellefId: params.mukellefId,
        donem: params.donem,
        tip: 'KDV_MIZAN',
        status: 'pending',
        createdBy: params.createdBy || null,
        targetDeviceId: params.targetDeviceId || null,
        preferredAgent: 'local-node',
        priority: 2,
        errorMsg: `[META] mukellefAdi=${this.formatMukellefAd(mukellef)}\nKDV Beyanname aylık mizan: ${params.donem}`,
      },
    });
    return { jobId: job.id, status: job.status };
  }

  /** Snapshot job durumu (frontend polling) */
  async getLucaJob(jobId: string, tenantId: string) {
    const job = await (this.prisma as any).lucaFetchJob.findUnique({ where: { id: jobId } });
    if (!job || job.tenantId !== tenantId) {
      throw new NotFoundException('Job bulunamadı');
    }
    let snapshot: any = null;
    if (job.status === 'done') {
      snapshot = await (this.prisma as any).kdvLucaSnapshot.findUnique({
        where: {
          tenantId_taxpayerId_donem: {
            tenantId,
            taxpayerId: job.mukellefId,
            donem: job.donem,
          },
        },
        select: { id: true, cekildiAt: true, toplamHesapAdet: true },
      });
    }
    return { job, snapshot };
  }

  /** Mükellef + dönem için son snapshot — UI için filtrelenmiş KDV satırlarıyla */
  async getLucaSnapshot(tenantId: string, mukellefId: string, donem: string) {
    const s = await (this.prisma as any).kdvLucaSnapshot.findUnique({
      where: { tenantId_taxpayerId_donem: { tenantId, taxpayerId: mukellefId, donem } },
    });
    if (!s) return { exists: false };
    return {
      exists: true,
      cekildiAt: s.cekildiAt,
      toplamHesapAdet: s.toplamHesapAdet,
      kdvSatirlari: this.filterKdvSatirlari(s.hamMizan as any[]),
    };
  }

  /** UI icin hareket goren, cari/kasa/banka disi leaf mizan satirlarini sec */
  private filterKdvSatirlari(rows: any[]): any[] {
    if (!Array.isArray(rows)) return [];
    const rowsWithKod = rows
      .map((row: any) => ({ row, kod: this.mizanKod(row) }))
      .filter(({ kod }) => this.isValidMizanKod(kod));
    const kodlar = new Set(rowsWithKod.map(({ kod }) => kod));

    return rowsWithKod
      .filter(({ row, kod }) => {
        return (
          (this.hasMizanMovement(row) || (this.isKdvControlKod(kod) && this.hasMizanValue(row))) &&
          this.isLeafMizanKod(kod, kodlar) &&
          !this.isKdvSnapshotExcludedKod(kod)
        );
      })
      .sort((a, b) => a.kod.localeCompare(b.kod, 'tr', { numeric: true }))
      .map(({ row, kod }) => ({
        kod,
        ad: row.ad || row.hesapAdi || '',
        borcToplami: this.mizanAmount(row.borcToplami),
        alacakToplami: this.mizanAmount(row.alacakToplami),
        borcBakiye: this.mizanAmount(row.borcBakiye),
        alacakBakiye: this.mizanAmount(row.alacakBakiye),
      }));
  }

  /** Mizan kodu ve hareket filtresi icin ortak yardimcilar */
  private mizanKod(row: any): string {
    return String(row?.kod || row?.hesapKodu || '').trim();
  }

  private mizanAmount(value: any): number {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  private isValidMizanKod(kod: string): boolean {
    return /^\d{3}(?:\.\d+)*$/.test(kod);
  }

  private isKodOrChild(kod: string, prefix: string): boolean {
    return kod === prefix || kod.startsWith(prefix + '.');
  }

  private isLeafMizanKod(kod: string, kodlar: Set<string>): boolean {
    if (!kod) return false;
    const prefix = kod + '.';
    for (const other of kodlar) {
      if (other !== kod && other.startsWith(prefix)) return false;
    }
    return true;
  }

  private hasMizanMovement(row: any): boolean {
    return (
      Math.abs(this.mizanAmount(row?.borcToplami)) > 0.005 ||
      Math.abs(this.mizanAmount(row?.alacakToplami)) > 0.005
    );
  }

  private hasMizanValue(row: any): boolean {
    return (
      this.hasMizanMovement(row) ||
      Math.abs(this.mizanAmount(row?.borcBakiye)) > 0.005 ||
      Math.abs(this.mizanAmount(row?.alacakBakiye)) > 0.005
    );
  }

  private isKdvControlKod(kod: string): boolean {
    return ['190', '191', '192', '193', '391', '392', '393'].some((prefix) =>
      this.isKodOrChild(kod, prefix),
    );
  }

  private isKdvSnapshotExcludedKod(kod: string): boolean {
    const excludedPrefixes = [
      '100',
      '101',
      '102',
      '103',
      '108',
      '120',
      '121',
      '126',
      '127',
      '128',
      '129',
      '131',
      '132',
      '136',
      '159',
      '320',
      '321',
      '326',
      '329',
      '331',
      '332',
      '336',
      '340',
    ];
    return excludedPrefixes.some((prefix) => this.isKodOrChild(kod, prefix));
  }

  /** Agent yüklediği XLS sonrası snapshot oluştur (parser caller'da, burada sadece DB) */
  async importSnapshotFromRows(params: {
    tenantId: string;
    mukellefId: string;
    donem: string;
    fetchJobId?: string;
    parsedRows: Array<{
      hesapKodu: string;
      hesapAdi: string;
      borcToplami: number;
      alacakToplami: number;
      borcBakiye: number;
      alacakBakiye: number;
    }>;
  }) {
    const ham = params.parsedRows.map((r) => ({
      kod: r.hesapKodu,
      ad: r.hesapAdi,
      borcToplami: r.borcToplami,
      alacakToplami: r.alacakToplami,
      borcBakiye: r.borcBakiye,
      alacakBakiye: r.alacakBakiye,
    }));

    return (this.prisma as any).kdvLucaSnapshot.upsert({
      where: {
        tenantId_taxpayerId_donem: {
          tenantId: params.tenantId,
          taxpayerId: params.mukellefId,
          donem: params.donem,
        },
      },
      create: {
        tenantId: params.tenantId,
        taxpayerId: params.mukellefId,
        donem: params.donem,
        fetchJobId: params.fetchJobId || null,
        hamMizan: ham,
        toplamHesapAdet: ham.length,
      },
      update: {
        cekildiAt: new Date(),
        fetchJobId: params.fetchJobId || null,
        hamMizan: ham,
        toplamHesapAdet: ham.length,
      },
    });
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
        'Faturaların %80+ oranında KDV detayı eksik; bu kayıtlar tahmin edilmedi. Kesin değerler için KDV Kontrol modülünden geçirin.',
      );
    } else if (tahminOran > 0.3) {
      uyarilar.push(
        `Faturaların %${Math.round(tahminOran * 100)}'ında KDV detayı eksik; bu kısım beyan toplamına eklenmedi.`,
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

  private sonrakiDonem(donem: string): string {
    const m = /^(\d{4})-(\d{2})$/.exec(donem);
    if (!m) return donem;
    const yil = parseInt(m[1], 10);
    const ay = parseInt(m[2], 10);
    if (ay === 12) return `${yil + 1}-01`;
    return `${yil}-${String(ay + 1).padStart(2, '0')}`;
  }

  private readTaggedAmount(notlar: any, tag: string): number | null {
    if (!notlar) return null;
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\[${escaped}=([^\\]]+)\\]`);
    const m = re.exec(String(notlar));
    if (!m) return null;
    const n = this.parseTrAmount(m[1]);
    return Number.isFinite(n) ? Math.max(0, Math.round(n * 100) / 100) : null;
  }

  private setTaggedAmount(notlar: any, tag: string, amount: number): string {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\s*\\[${escaped}=[^\\]]+\\]\\s*`, 'g');
    const base = String(notlar || '').replace(re, '\n').trim();
    const line = `[${tag}=${Math.max(0, amount).toFixed(2)}]`;
    return base ? `${base}\n${line}` : line;
  }
}
