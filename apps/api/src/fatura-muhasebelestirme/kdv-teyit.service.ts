/**
 * PLAN/16 §D — KDV RAPORU TEYİT PANELİ arka ucu.
 *
 *   GET fatura-muhasebelestirme/kdv-teyit?taxpayerId&period
 *
 * Aynı dönem için yan yana kaynaklar:
 *   • faturaMerkezi   — kdvClientReport (durum süzgeçli, tevkifat/iade/KDV-dışı vergi ayrımlı)
 *   • kdvKontrol      — KdvBeyannameService.kdv1OnHazirlik (KDV Kontrol oturumu yoksa {yok:true})
 *   • lucaMizan       — kdv_luca_snapshots (KDV'ye özel aylık mizan: 391 alacak / 191 borç / 190 borç;
 *                       işletme defterinde gelir-gider KDV toplamı) → yoksa mizanlar tablosu (donem eşleşen)
 *   • oncekiBeyanname — önceki dönem KDV1 beyannamesindeki "Sonraki Döneme Devreden KDV"
 *   • farklar[]       — hesaplanan / indirilecek / devreden / ödenecek / sonrakiDevreden satırlarında
 *                       kaynaklar arası fark (mutlak + yüzde; uyari = |fark| > 1 TL)
 *   • drilldown       — FM sayılarının belge id listeleri (FE tıklayınca liste açar)
 *   • notlar[]        — vergi kuralı/karşılaştırma notları (sessiz varsayım yok)
 *
 * KdvBeyannameService ÇAĞRI ANINDA ModuleRef ile çözülür (modül import zinciri/döngü riski yok; yoksa {yok:true}).
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { BeyanKayitlariService } from '../beyan-kayitlari/beyan-kayitlari.service';
import { FaturaMuhasebelestirmeService } from './fatura-muhasebelestirme.service';
import { KdvFark, kdvFark, kdvSonuc, mizanKdvOku } from './belge-akisi-kurallari';

type Kaynak = 'kdvKontrol' | 'lucaMizan' | 'oncekiBeyanname';
type Satir = 'hesaplanan' | 'indirilecek' | 'devreden' | 'odenecek' | 'sonrakiDevreden';

const SATIR_ETIKET: Record<Satir, string> = {
  hesaplanan: 'Hesaplanan KDV (391)',
  indirilecek: 'İndirilecek KDV (191)',
  devreden: 'Önceki dönemden devreden KDV (190)',
  odenecek: 'Ödenecek KDV',
  sonrakiDevreden: 'Sonraki döneme devreden KDV',
};

@Injectable()
export class KdvTeyitService {
  private readonly logger = new Logger(KdvTeyitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fm: FaturaMuhasebelestirmeService,
    private readonly beyanKayitlari: BeyanKayitlariService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async teyit(tenantId: string, opts: { taxpayerId?: string; period?: string }) {
    const taxpayerId = String(opts.taxpayerId || '').trim();
    const period = String(opts.period || '').trim();
    if (!taxpayerId) throw new BadRequestException('Mükellef seçimi gerekli');
    if (!/^\d{4}-\d{2}$/.test(period)) throw new BadRequestException('Dönem YYYY-MM formatında olmalı');
    const oncekiDonem = this.oncekiDonem(period);

    const rapor: any = await this.fm.kdvClientReport(tenantId, { taxpayerId, period });
    const [kdvKontrol, lucaMizan, oncekiBeyanname] = await Promise.all([
      this.kdvKontrolOku(tenantId, taxpayerId, period),
      this.lucaMizanOku(tenantId, taxpayerId, period),
      this.oncekiBeyannameOku(tenantId, taxpayerId, oncekiDonem),
    ]);

    const notlar: string[] = [...(Array.isArray(rapor.notlar) ? rapor.notlar : [])];
    const t: any = rapor.totals || {};
    const devredenFm: number | null = oncekiBeyanname.yok ? null : (oncekiBeyanname.devreden ?? null);
    const fmSonuc = kdvSonuc(Number(t.calculatedVatBeyan) || 0, Number(t.deductibleVat) || 0, devredenFm ?? 0);
    if (devredenFm == null) {
      notlar.push(`Önceki dönem (${oncekiDonem}) KDV1 beyannamesi sistemde yok → Fatura Merkezi ödenecek/devreden hesabında devreden 0 alındı.`);
    }
    const faturaMerkezi = {
      hesaplanan: this.n(t.calculatedVat),                 // faturadaki TAM hesaplanan KDV
      hesaplananBeyan: this.n(t.calculatedVatBeyan),       // KDV1'de beyan edilecek (kısmi tevkifatta kalan kısım)
      tevkifEdilen: this.n(t.tevkifEdilenVat),             // satışta alıcının tevkif ettiği (KDV2 — alıcı beyan eder)
      indirilecek: this.n(t.deductibleVat),                // TAM (191 + sorumlu-191)
      indirilecekTevkifatHaric: this.n(t.deductibleVatTevkifatHaric),
      kdv2Sorumlu: this.n(t.kdv2SorumluVat),               // alışta sorumlu sıfatıyla KDV2 ile beyan edilecek
      digerVergiler: this.n(t.otherTaxesTotal),            // KDV dışı — KDV'ye karışmaz
      devreden: devredenFm,
      odenecek: fmSonuc.odenecek,
      sonrakiDevreden: fmSonuc.sonrakiDevreden,
      kaynak: rapor.kaynak || null,
      matrah: { satis: this.n(t.salesBase), alis: this.n(t.purchaseBase) },
    };

    // KDV Kontrol formülü kdv1OnHazirlik ile aynı (diff = hesaplanan − indirilecek − devreden); tek fark girdi tabanı:
    //   KDV Kontrol tevkifat (KDV2) kısmını KDV1 indiriminden düşer → indirilecek karşılaştırması tevkifat-hariç yapılır.
    if (faturaMerkezi.kdv2Sorumlu > 0.005 && !kdvKontrol.yok) {
      notlar.push(`KDV Kontrol tevkifatlı alışta KDV2 kısmını (${this.para(faturaMerkezi.kdv2Sorumlu)} TL) KDV1 indiriminden düşüyor; Fatura Merkezi ise tamamını indirilecek sayıyor (KDV2 ile ödenen kısım aynı dönem KDV1'de indirilir). "İndirilecek" farkı bu tabanla (tevkifat hariç) hesaplandı; ödenecek satırında fark bu tutar kadar çıkabilir.`);
    }
    if (faturaMerkezi.tevkifEdilen > 0.005) {
      notlar.push(`Tevkifatlı satışta KDV Kontrol/Luca 391 tevkifat SONRASI kalan KDV'yi taşır; "Hesaplanan" farkı beyan tabanıyla (TAM − tevkif edilen = ${this.para(faturaMerkezi.hesaplananBeyan)} TL) hesaplandı.`);
    }

    const farklar = this.farklariKur(faturaMerkezi, kdvKontrol, lucaMizan, oncekiBeyanname);
    const uyariSayisi = farklar.reduce((s, f) => s + Object.values(f.fark).filter((x: any) => x && x.uyari).length, 0);

    return {
      taxpayer: rapor.taxpayer,
      period,
      periodLabel: rapor.periodLabel,
      oncekiDonem,
      generatedAt: new Date().toISOString(),
      faturaMerkezi,
      kdvKontrol,
      lucaMizan,
      oncekiBeyanname,
      farklar,
      uyariSayisi,
      esikTL: 1,
      drilldown: rapor.drilldown || {},
      hesapAtanmamis: rapor.hesapAtanmamis || null,
      notlar,
    };
  }

  private farklariKur(fm: any, kk: any, lm: any, ob: any) {
    const satirlar: Satir[] = ['hesaplanan', 'indirilecek', 'devreden', 'odenecek', 'sonrakiDevreden'];
    const kkDeger = (s: Satir): number | null => (kk.yok ? null : this.n(kk[s], null));
    const lmDeger = (s: Satir): number | null => (lm.yok ? null : this.n(lm[s], null));
    return satirlar.map((satir) => {
      const fmDeger: number | null = fm[satir] == null ? null : Number(fm[satir]);
      const fark: Record<Kaynak, (KdvFark & { fmEsas: number; aciklama?: string }) | null> = { kdvKontrol: null, lucaMizan: null, oncekiBeyanname: null };
      // KDV Kontrol: indirilecek tevkifat-hariç, hesaplanan beyan tabanıyla karşılaştırılır (notlarda açıklandı).
      const kkEsas = satir === 'indirilecek' ? fm.indirilecekTevkifatHaric : satir === 'hesaplanan' ? fm.hesaplananBeyan : fmDeger;
      const kkFark = kdvFark(kkEsas, kkDeger(satir));
      if (kkFark) fark.kdvKontrol = { ...kkFark, fmEsas: Number(kkEsas), ...(kkEsas !== fmDeger ? { aciklama: satir === 'indirilecek' ? 'FM tevkifat (KDV2) hariç tutarla karşılaştırıldı' : 'FM beyan tabanı (TAM − tevkif edilen) ile karşılaştırıldı' } : {}) };
      // Luca mizan: 391 alacak = tevkifat sonrası hesaplanan; 191 borç = TAM indirilecek (191 + sorumlu-191 yaprakları).
      const lmEsas = satir === 'hesaplanan' ? fm.hesaplananBeyan : fmDeger;
      const lmFark = kdvFark(lmEsas, lmDeger(satir));
      if (lmFark) fark.lucaMizan = { ...lmFark, fmEsas: Number(lmEsas), ...(lmEsas !== fmDeger ? { aciklama: 'FM beyan tabanı (TAM − tevkif edilen) ile karşılaştırıldı' } : {}) };
      if (satir === 'devreden' && !ob.yok) {
        const obFark = kdvFark(fmDeger, ob.devreden);
        if (obFark) fark.oncekiBeyanname = { ...obFark, fmEsas: Number(fmDeger) };
      }
      return {
        satir,
        etiket: SATIR_ETIKET[satir],
        fm: fmDeger,
        kdvKontrol: kkDeger(satir),
        lucaMizan: lmDeger(satir),
        oncekiBeyanname: satir === 'devreden' && !ob.yok ? ob.devreden : null,
        fark,
        uyari: Object.values(fark).some((x: any) => x && x.uyari),
      };
    });
  }

  /** KDV Kontrol (kdv1OnHazirlik) — oturum yoksa {yok:true}. Servis çağrı anında çözülür. */
  private async kdvKontrolOku(tenantId: string, taxpayerId: string, period: string) {
    const [y, m] = period.split('-');
    const ay = String(Number(m));
    const adaylar = Array.from(new Set([`${y}-${m}`, `${y}/${m}`, `${y}-${ay}`, `${y}/${ay}`]));
    const oturum = await (this.prisma as any).kdvControlSession.findFirst({
      where: {
        tenantId,
        OR: [{ taxpayerId }, { taxpayerId: null }],
        periodLabel: { in: adaylar },
        type: { in: ['KDV_191', 'ISLETME_GIDER', 'KDV_391', 'ISLETME_GELIR'] },
      },
      select: { id: true },
    }).catch(() => null);
    if (!oturum) return { yok: true, neden: 'KDV Kontrol oturumu yok' };
    try {
      const { KdvBeyannameService } = await import('../kdv-beyanname/kdv-beyanname.service');
      const svc: any = this.moduleRef.get(KdvBeyannameService, { strict: false });
      const h: any = await svc.kdv1OnHazirlik({ tenantId, mukellefId: taxpayerId, donem: period, computePrevDevreden: true });
      const s = h?.sonuc || {};
      return {
        yok: false,
        hesaplanan: this.n(s.hesaplananKdv),
        indirilecek: this.n(s.indirilecekKdv),
        devreden: this.n(s.devredenKdv),
        devredenKaynak: h?.devreden?.kaynak || null,
        odenecek: this.n(s.odenecekKdv),
        sonrakiDevreden: this.n(s.sonrakiAyaDevreden),
        satisFaturaAdet: this.n(h?.satis?.faturaAdet),
        alisFaturaAdet: this.n(h?.alis?.faturaAdet),
        tevkifatliAlis: h?.alis?.tevkifatli || null,
        veriGuveni: h?.veriGuveni ?? null,
        eksikVeriler: Array.isArray(h?.eksikVeriler) ? h.eksikVeriler.slice(0, 10) : [],
      };
    } catch (e: any) {
      this.logger.warn(`KDV teyit: kdv1OnHazirlik okunamadı (tp=${taxpayerId} donem=${period}): ${e?.message || e}`);
      return { yok: true, neden: `KDV Kontrol verisi okunamadı: ${String(e?.message || e).slice(0, 160)}` };
    }
  }

  /** Luca mizanı: önce KDV'ye özel aylık snapshot (kdv_luca_snapshots), yoksa mizanlar tablosu (donem eşleşen). */
  private async lucaMizanOku(tenantId: string, taxpayerId: string, period: string) {
    const snap = await (this.prisma as any).kdvLucaSnapshot.findUnique({
      where: { tenantId_taxpayerId_donem: { tenantId, taxpayerId, donem: period } },
      select: { id: true, cekildiAt: true, hamMizan: true, toplamHesapAdet: true },
    }).catch(() => null);
    if (snap) {
      const ham: any = snap.hamMizan;
      if (ham && !Array.isArray(ham) && ham.__isletmeGg) {
        return {
          yok: false, kaynak: 'kdv_luca_snapshot', tur: 'isletme', cekildiAt: snap.cekildiAt,
          hesaplanan: this.n(ham.gelirKdvToplam), indirilecek: this.n(ham.giderKdvToplam), devreden: null,
          odenecek: null, sonrakiDevreden: null,
        };
      }
      if (Array.isArray(ham) && ham.length) {
        const k = mizanKdvOku(ham);
        return {
          yok: false, kaynak: 'kdv_luca_snapshot', tur: 'bilanco', cekildiAt: snap.cekildiAt, hesapAdet: snap.toplamHesapAdet,
          hesaplanan: k.hesaplanan, indirilecek: k.indirilecek, devreden: k.devreden, odenecek: null, sonrakiDevreden: null,
        };
      }
    }
    const mizan = await (this.prisma as any).mizan.findFirst({
      where: { tenantId, taxpayerId, donem: period, status: 'READY' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, kaynak: true, donemTipi: true, createdAt: true, hesaplar: { select: { hesapKodu: true, borcToplami: true, alacakToplami: true, borcBakiye: true, alacakBakiye: true } } },
    }).catch(() => null);
    if (mizan && Array.isArray(mizan.hesaplar) && mizan.hesaplar.length) {
      const k = mizanKdvOku(mizan.hesaplar);
      return {
        yok: false, kaynak: `mizan:${mizan.kaynak || ''}`, tur: 'bilanco', cekildiAt: mizan.createdAt, mizanId: mizan.id,
        hesaplanan: k.hesaplanan, indirilecek: k.indirilecek, devreden: k.devreden, odenecek: null, sonrakiDevreden: null,
      };
    }
    return { yok: true, neden: 'Bu dönem için Luca mizanı (KDV snapshot / mizan) yok' };
  }

  private async oncekiBeyannameOku(tenantId: string, taxpayerId: string, oncekiDonem: string) {
    try {
      const dv = await this.beyanKayitlari.getSonrakiDonemeDevreden(tenantId, taxpayerId, oncekiDonem);
      if (!dv) return { yok: true, donem: oncekiDonem, neden: 'Önceki dönem KDV1 beyannamesi kaydı yok' };
      return { yok: false, donem: oncekiDonem, devreden: this.n(dv.tutar), beyanKaydiId: dv.beyanKaydiId };
    } catch (e: any) {
      this.logger.warn(`KDV teyit: devreden okunamadı (tp=${taxpayerId} donem=${oncekiDonem}): ${e?.message || e}`);
      return { yok: true, donem: oncekiDonem, neden: 'Önceki dönem beyannamesi okunamadı' };
    }
  }

  private oncekiDonem(period: string) {
    const [y, m] = period.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 2, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private n(v: any): number;
  private n(v: any, bos: null): number | null;
  private n(v: any, bos: any = 0): any {
    if (v === null || v === undefined || v === '') return bos;
    const x = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(x) ? Math.round(x * 100) / 100 : bos;
  }

  private para(v: number) {
    return (Number(v) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
