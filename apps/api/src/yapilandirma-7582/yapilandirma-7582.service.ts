import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { BilancoService } from '../mizan/bilanco.service';
import {
  BorcSatiri, BorcTuru, DefterTuru, HukukiStatu,
  azamiTaksit, borcTuruBelirle, likiditeOrani, odemePlani, taksitSecenekleri,
  BASVURU_SON, TECIL_FAIZI_YILLIK, TEMINATSIZ_SINIR,
} from './yapilandirma-7582.hesap';

/**
 * 7582 / Seri:B Sıra No:20 YAPILANDIRMA (tecil-taksitlendirme) SERVİSİ.
 *
 * Hesabın kendisi saf modülde (yapilandirma-7582.hesap.ts) — burada yalnız veri toplama var.
 *
 * MİZAN: kilitli Mizan modülüne DOKUNULMAZ; onun kendi uçları kullanılır.
 *   • Luca'dan taze mizan: POST /mizan/fetch-from-luca (web tarafı doğrudan çağırır)
 *   • Oran: çekilen mizandan BilancoService ile bilanço üretilir, kalemleri kullanılır.
 *     Böylece oran, portalın kendi bilançosuyla AYNI rakamlardan çıkar.
 */
@Injectable()
export class Yapilandirma7582Service {
  private readonly logger = new Logger(Yapilandirma7582Service.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bilanco: BilancoService,
  ) {}

  /**
   * SEÇİLEN MİZANDAN LİKİDİTE ORANI (bilanço esası).
   *
   * Oran = (Dönen Varlıklar − Stoklar) / Kısa Vadeli Yabancı Kaynaklar
   * Kalemler, mizandan üretilen bilançodan gelir; hangi mizan/dönem kullanıldığı da döner
   * çünkü mevzuat dönemi belirlemiyor ve beyan edilen oranın kaynağı belli olmalı.
   */
  async likiditeMizandan(tenantId: string, mizanId: string) {
    const mizan: any = await (this.prisma as any).mizan.findFirst({
      where: { id: mizanId, tenantId },
      select: { id: true, donem: true, donemTipi: true, taxpayerId: true, createdAt: true },
    });
    if (!mizan) throw new NotFoundException('Mizan bulunamadı');

    const b: any = await this.bilanco.generateFromMizan({ mizanId, tenantId });
    const donenVarliklar = Number(b?.donenVarliklar || 0);
    const stoklar = Number((b?.aktif as any)?.stoklar?.toplam || 0);
    const kvyk = Number(b?.kvYabanciKaynak || 0);

    const oran = likiditeOrani({
      defter: 'BILANCO',
      donenVarliklar,
      stoklar,
      kisaVadeliYabanciKaynak: kvyk,
    });

    return {
      mizanId,
      donem: mizan.donem,
      donemTipi: mizan.donemTipi,
      mizanTarihi: mizan.createdAt,
      donenVarliklar,
      stoklar,
      kisaVadeliYabanciKaynak: kvyk,
      oran,
      // Oran hesaplanamadıysa sebebini SÖYLE — sessizce null dönmek teşhisi imkânsızlaştırır.
      not: oran == null
        ? 'Kısa vadeli yabancı kaynak sıfır göründüğü için oran hesaplanamadı — mizan dönemi doğru mu?'
        : null,
    };
  }

  /**
   * EXCEL'DEN BORÇ SATIRLARI.
   *
   * Sütun adları mükelleften mükellefe değişebildiği için ESNEK okunur; hiçbir sütun
   * tahmin edilmez — bulunamayan alan boş kalır ve kullanıcıya "eşleştir" denir.
   */
  excelOku(buf: Buffer): { basliklar: string[]; satirlar: Record<string, any>[] } {
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
    const sayfa = wb.SheetNames[0];
    if (!sayfa) throw new BadRequestException('Excel dosyasında sayfa yok');
    const satirlar = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[sayfa], { defval: null });
    const basliklar = satirlar.length ? Object.keys(satirlar[0]) : [];
    return { basliklar, satirlar };
  }

  /**
   * BİR MÜKELLEF İÇİN TÜM TAKSİT SEÇENEKLERİ.
   *
   * Borç satırları ÜÇ GRUBA ayrılır (KDV/BSMV · diğer · kapsam dışı) çünkü aynı mükellefin
   * borcu tek planla ödenmez: KDV 12 taksit, diğerleri 36/48/72. Kapsam dışı olanlar
   * toplama HİÇ katılmaz, ayrıca listelenir.
   */
  hesapla(g: {
    satirlar: BorcSatiri[];
    defter: DefterTuru;
    statu?: HukukiStatu;
    faalMi?: boolean;
    oran?: number | null;
    talepTarihi?: string;
  }) {
    const talep = g.talepTarihi ? new Date(g.talepTarihi) : new Date();
    if (isNaN(talep.getTime())) throw new BadRequestException('Tecil talep tarihi geçersiz');

    const gruplar: Record<BorcTuru, { tutar: number; satirlar: BorcSatiri[] }> = {
      KDV_BSMV: { tutar: 0, satirlar: [] },
      DIGER: { tutar: 0, satirlar: [] },
      KAPSAM_DISI: { tutar: 0, satirlar: [] },
      BELIRSIZ: { tutar: 0, satirlar: [] },
    };
    for (const s of g.satirlar || []) {
      const tur: BorcTuru = s.turElle || borcTuruBelirle(s.vergiTuru);
      const tutar = Number(s.tutar) || 0;
      gruplar[tur].tutar = Math.round((gruplar[tur].tutar + tutar) * 100) / 100;
      gruplar[tur].satirlar.push({ ...s, turElle: tur });
    }

    const statu: HukukiStatu = g.statu || 'NORMAL';
    const faalMi = g.faalMi !== false;
    const oran = g.oran == null ? null : Number(g.oran);

    const paketler = (['KDV_BSMV', 'DIGER'] as BorcTuru[])
      .filter((t) => gruplar[t].tutar > 0)
      .map((t) => {
        const azami = azamiTaksit({ borcTuru: t, statu, faalMi, defter: g.defter, oran });
        const tutar = gruplar[t].tutar;
        const secenekler = azami.taksit
          ? taksitSecenekleri(azami.taksit).map((n) => {
              const plan = odemePlani(tutar, n, talep);
              return {
                taksitSayisi: n,
                aylikTaksit: plan.aylikTaksit,
                ilkTaksit: plan.ilkTaksit,
                toplamFaiz: plan.toplamFaiz,
                toplamOdeme: plan.toplamOdeme,
                // Faizin borca oranı — "hangi seçenek bana kaça mal olur" sorusunun cevabı.
                faizYuku: Math.round((plan.toplamFaiz / tutar) * 10000) / 100,
              };
            })
          : [];
        return {
          grup: t,
          grupAdi: t === 'KDV_BSMV' ? 'KDV / BSMV ve fer’ileri' : 'Diğer borçlar',
          tutar,
          azamiTaksit: azami.taksit,
          gerekce: azami.gerekce,
          secenekler,
          satirlar: gruplar[t].satirlar,
        };
      });

    const tecilEdilebilir = paketler.reduce((t, p) => t + p.tutar, 0);
    const asan = tecilEdilebilir - TEMINATSIZ_SINIR;

    return {
      talepTarihi: talep.toISOString().slice(0, 10),
      basvuruSonTarihi: BASVURU_SON,
      tecilFaiziYillik: TECIL_FAIZI_YILLIK,
      likiditeOrani: oran,
      defter: g.defter,
      statu,
      faalMi,
      tecilEdilebilirToplam: Math.round(tecilEdilebilir * 100) / 100,
      teminatGerekli: asan > 0 ? Math.round((asan / 2) * 100) / 100 : 0,
      paketler,
      kapsamDisi: gruplar.KAPSAM_DISI,
      belirsiz: gruplar.BELIRSIZ,
      uyarilar: [
        gruplar.BELIRSIZ.tutar > 0
          ? `${gruplar.BELIRSIZ.satirlar.length} satırın borç türü belirlenemedi (${gruplar.BELIRSIZ.tutar} TL) — KDV/BSMV mi değil mi işaretlenmeli, yoksa taksit sayısı yanlış çıkar.`
          : null,
        gruplar.KAPSAM_DISI.tutar > 0
          ? `${gruplar.KAPSAM_DISI.tutar} TL borç tebliğ kapsamı dışı (ÖTV / 2026 geçici vergi) — taksitlendirilemez.`
          : null,
        oran == null && (g.defter === 'BILANCO' || g.defter === 'ISLETME') && faalMi
          ? 'Likidite oranı girilmedi — taksit sayısı belirlenemez, tüm seçenekler yine de gösterilir.'
          : null,
      ].filter(Boolean) as string[],
    };
  }

  /** Seçilen taksit sayısı için tam ödeme planı (aylık satırlar). */
  plan(g: { tutar: number; taksitSayisi: number; talepTarihi?: string }) {
    const talep = g.talepTarihi ? new Date(g.talepTarihi) : new Date();
    if (isNaN(talep.getTime())) throw new BadRequestException('Tecil talep tarihi geçersiz');
    return odemePlani(Number(g.tutar), Number(g.taksitSayisi), talep);
  }
}
