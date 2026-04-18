/**
 * Bilanço Servisi — mizan hesap kodlarından TDHP standart bilanço üretir.
 *
 * AKTİF (1XX Dönen + 2XX Duran)
 *   - 10 Hazır Değerler:        100, 101, 102, 103, 108
 *   - 11 Menkul Kıymetler:      110, 111, 112, 118
 *   - 12 Ticari Alacaklar:      120, 121, 122, 126, 128, 129 (-)
 *   - 13 Diğer Alacaklar:       131, 132, 133, 135, 136, 137, 138, 139
 *   - 15 Stoklar:               150, 151, 152, 153, 157, 158, 159 (-)
 *   - 17 Yıllara Yay. İnş.:     170, 171, 172, 173, 178
 *   - 18 Gel. Aylara Ait:       180, 181
 *   - 19 Diğer Dönen:           190, 191, 192, 193, 195, 196, 197, 198
 *   - 22 Uzun Alacaklar:        220-228, 229(-)
 *   - 24 Mali Duran:            240-248, 249(-)
 *   - 25 Maddi Duran:           250-258, 257(-amort), 259
 *   - 26 Maddi Olmayan:         260-268, 268(-amort), 269
 *   - 27 Özel Tükenmeye:        271, 272, 277, 278
 *   - 28 Gel. Yıllara Ait:      280, 281
 *   - 29 Diğer Duran:           291-298
 *
 * PASİF (3XX KVYK + 4XX UVYK + 5XX Özkaynak)
 *   - 30 Mali Borçlar:          300, 301, 303, 304, 308, 309
 *   - 32 Ticari Borçlar:        320, 321, 322, 326, 329
 *   - 33 Diğer Borçlar:         331-339
 *   - 34 Alınan Avanslar:       340, 349
 *   - 35 Yıllara Yay. İnş.:     350, 351, 358
 *   - 36 Ödenecek Vergi/Sosyal: 360, 361, 368, 369
 *   - 37 Borç/Gid. Karş.:       370-379
 *   - 38 Gel. Aylara Ait:       380-385
 *   - 39 Diğer KVYK:            391, 392, 393, 397, 399
 *   - 40 UV Mali Borçlar:       400, 405, 407-409
 *   - 42 UV Ticari Borçlar:     420, 421, 422, 426, 429
 *   - 43 UV Diğer Borçlar:      431-439
 *   - 44 Alınan Avanslar:       440, 449
 *   - 47 Borç/Gid. Karş.:       470-479
 *   - 48 Gel. Yıllara Ait:      480-485
 *   - 49 Diğer UVYK:            492, 493, 499
 *   - 50 Ödenmiş Sermaye:       500, 501(-), 502(-)
 *   - 52 Sermaye Yedekleri:     520-529
 *   - 54 Kar Yedekleri:         540, 541, 542, 548, 549
 *   - 57 Geçmiş Kar/Zarar:      570, 580(-)
 *   - 59 Dönem Kar/Zarar:       590, 591(-)
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MizanService } from './mizan.service';

interface KalemDetay {
  grup: string;
  kodRange: string;
  toplam: number;
  hesaplar: Array<{ kod: string; ad: string; tutar: number }>;
}

@Injectable()
export class BilancoService {
  private readonly logger = new Logger(BilancoService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => MizanService))
    private mizanService: MizanService,
  ) {}

  async generateFromMizan(params: {
    mizanId: string;
    tenantId: string;
    tarih?: Date;
    donemTipi?: string;
    createdBy?: string;
  }) {
    const mizan = await (this.prisma as any).mizan.findFirst({
      where: { id: params.mizanId, tenantId: params.tenantId },
    });
    if (!mizan) throw new NotFoundException('Mizan bulunamadı');

    const map = await this.mizanService.getHesaplarMap(params.mizanId);

    // Aktif hesaplar: borç bakiyesi verir, bazıları (-) hesap (alacak bakiyesi) çıkarılır
    const aktifKalem = (grup: string, prefixler: string[], negatifPrefixler: string[] = []): KalemDetay => {
      let toplam = 0;
      const hesaplar: KalemDetay['hesaplar'] = [];
      for (const [kod, h] of map.entries()) {
        if (h.seviye !== 0) continue;
        const anaKod = kod.split('.')[0];
        if (prefixler.includes(anaKod)) {
          const tutar = h.borcBakiye - h.alacakBakiye;
          if (tutar !== 0) {
            toplam += tutar;
            hesaplar.push({ kod, ad: h.hesapAdi, tutar });
          }
        } else if (negatifPrefixler.includes(anaKod)) {
          // Negatif hesap (amortisman vs.) — alacak bakiyesi pozitif tutulur, aktiften düşülür
          const tutar = h.alacakBakiye - h.borcBakiye;
          if (tutar !== 0) {
            toplam -= tutar;
            hesaplar.push({ kod, ad: h.hesapAdi, tutar: -tutar });
          }
        }
      }
      return {
        grup,
        kodRange: [...prefixler, ...negatifPrefixler.map((p) => `${p}(-)`)].join(','),
        toplam,
        hesaplar,
      };
    };

    // Pasif hesaplar: alacak bakiyesi verir
    const pasifKalem = (grup: string, prefixler: string[], negatifPrefixler: string[] = []): KalemDetay => {
      let toplam = 0;
      const hesaplar: KalemDetay['hesaplar'] = [];
      for (const [kod, h] of map.entries()) {
        if (h.seviye !== 0) continue;
        const anaKod = kod.split('.')[0];
        if (prefixler.includes(anaKod)) {
          const tutar = h.alacakBakiye - h.borcBakiye;
          if (tutar !== 0) {
            toplam += tutar;
            hesaplar.push({ kod, ad: h.hesapAdi, tutar });
          }
        } else if (negatifPrefixler.includes(anaKod)) {
          const tutar = h.borcBakiye - h.alacakBakiye;
          if (tutar !== 0) {
            toplam -= tutar;
            hesaplar.push({ kod, ad: h.hesapAdi, tutar: -tutar });
          }
        }
      }
      return {
        grup,
        kodRange: [...prefixler, ...negatifPrefixler.map((p) => `${p}(-)`)].join(','),
        toplam,
        hesaplar,
      };
    };

    // AKTİF
    const aktif = {
      hazirDegerler: aktifKalem('10 Hazır Değerler', ['100', '101', '102', '103', '108']),
      menkulKiymetler: aktifKalem('11 Menkul Kıymetler', ['110', '111', '112'], ['118']),
      ticariAlacaklar: aktifKalem('12 Ticari Alacaklar', ['120', '121', '122', '126', '127', '128'], ['129']),
      digerAlacaklar: aktifKalem('13 Diğer Alacaklar', ['131', '132', '133', '135', '136'], ['137', '138', '139']),
      stoklar: aktifKalem('15 Stoklar', ['150', '151', '152', '153', '157', '158'], ['159']),
      yillaraYayInsaat: aktifKalem('17 Yıllara Yay. Maliyetleri', ['170', '171', '172', '173', '178']),
      gelecekAylaraGiderler: aktifKalem('18 Gelecek Aylara Ait Giderler', ['180', '181']),
      digerDonenVarliklar: aktifKalem('19 Diğer Dönen Varlıklar', ['190', '191', '192', '193', '195', '196', '197', '198']),
      // Duran
      uzunAlacaklar: aktifKalem('22 Uzun Vadeli Ticari Alacaklar', ['220', '221', '222', '226', '227', '228'], ['229']),
      digerUzunAlacaklar: aktifKalem('23 Diğer Uzun Alacaklar', ['231', '232', '235', '236'], ['237', '238', '239']),
      maliDuran: aktifKalem('24 Mali Duran Varlıklar', ['240', '241', '242', '243', '244', '245', '247', '248'], ['246', '249']),
      maddiDuran: aktifKalem('25 Maddi Duran Varlıklar', ['250', '251', '252', '253', '254', '255', '256', '258'], ['257', '259']),
      maddiOlmayanDuran: aktifKalem('26 Maddi Olmayan Duran Varlıklar', ['260', '261', '262', '263', '264', '267'], ['268', '269']),
      ozelTukenmeye: aktifKalem('27 Özel Tükenmeye Tabi Varlıklar', ['271', '272'], ['277', '278']),
      gelecekYillaraGiderler: aktifKalem('28 Gelecek Yıllara Ait Giderler', ['280', '281']),
      digerDuranVarliklar: aktifKalem('29 Diğer Duran Varlıklar', ['291', '292', '293', '294', '295'], ['298', '299']),
    };

    const donenVarliklar =
      aktif.hazirDegerler.toplam +
      aktif.menkulKiymetler.toplam +
      aktif.ticariAlacaklar.toplam +
      aktif.digerAlacaklar.toplam +
      aktif.stoklar.toplam +
      aktif.yillaraYayInsaat.toplam +
      aktif.gelecekAylaraGiderler.toplam +
      aktif.digerDonenVarliklar.toplam;

    const duranVarliklar =
      aktif.uzunAlacaklar.toplam +
      aktif.digerUzunAlacaklar.toplam +
      aktif.maliDuran.toplam +
      aktif.maddiDuran.toplam +
      aktif.maddiOlmayanDuran.toplam +
      aktif.ozelTukenmeye.toplam +
      aktif.gelecekYillaraGiderler.toplam +
      aktif.digerDuranVarliklar.toplam;

    const aktifToplami = donenVarliklar + duranVarliklar;

    // PASİF
    const pasif = {
      // Kısa Vadeli Yabancı Kaynaklar
      kvMaliBorclar: pasifKalem('30 Mali Borçlar', ['300', '301', '303', '304', '308', '309']),
      kvTicariBorclar: pasifKalem('32 Ticari Borçlar', ['320', '321', '322', '326', '329']),
      kvDigerBorclar: pasifKalem('33 Diğer Borçlar', ['331', '332', '333', '335', '336', '337', '338', '339']),
      alinanAvanslar: pasifKalem('34 Alınan Avanslar', ['340', '349']),
      yillaraYayInsaatKV: pasifKalem('35 Yıllara Yay. Hakediş Bedelleri', ['350', '351', '358']),
      odenecekVergi: pasifKalem('36 Ödenecek Vergi ve Diğer Yük.', ['360', '361', '368', '369']),
      kvBorcGiderKars: pasifKalem('37 Borç/Gider Karşılıkları', ['370', '371', '372', '373', '379']),
      kvGelAylaraGelir: pasifKalem('38 Gelecek Aylara Ait Gelirler', ['380', '381']),
      digerKVYK: pasifKalem('39 Diğer KV Yab. Kaynaklar', ['391', '392', '393', '397', '399']),
      // Uzun Vadeli Yabancı Kaynaklar
      uvMaliBorclar: pasifKalem('40 UV Mali Borçlar', ['400', '405', '407', '408', '409']),
      uvTicariBorclar: pasifKalem('42 UV Ticari Borçlar', ['420', '421', '422', '426', '429']),
      uvDigerBorclar: pasifKalem('43 UV Diğer Borçlar', ['431', '432', '433', '436', '437', '438', '439']),
      uvAlinanAvanslar: pasifKalem('44 UV Alınan Avanslar', ['440', '449']),
      uvBorcGiderKars: pasifKalem('47 Borç/Gider Karşılıkları', ['470', '472', '479']),
      uvGelYillaraGelir: pasifKalem('48 Gelecek Yıllara Ait Gelirler', ['480', '481']),
      digerUVYK: pasifKalem('49 Diğer UV Yab. Kaynaklar', ['492', '493', '499']),
      // Özkaynaklar
      odenmisSermaye: pasifKalem('50 Ödenmiş Sermaye', ['500'], ['501', '502']),
      sermayeYedekleri: pasifKalem('52 Sermaye Yedekleri', ['520', '521', '522', '523', '524', '529']),
      karYedekleri: pasifKalem('54 Kar Yedekleri', ['540', '541', '542', '548', '549']),
      gecmisKarZarar: pasifKalem('57 Geçmiş Dönem Kar/Zarar', ['570'], ['580']),
      donemKarZarar: pasifKalem('59 Dönem Net Kar/Zarar', ['590'], ['591']),
    };

    const kvYabanciKaynak =
      pasif.kvMaliBorclar.toplam +
      pasif.kvTicariBorclar.toplam +
      pasif.kvDigerBorclar.toplam +
      pasif.alinanAvanslar.toplam +
      pasif.yillaraYayInsaatKV.toplam +
      pasif.odenecekVergi.toplam +
      pasif.kvBorcGiderKars.toplam +
      pasif.kvGelAylaraGelir.toplam +
      pasif.digerKVYK.toplam;

    const uvYabanciKaynak =
      pasif.uvMaliBorclar.toplam +
      pasif.uvTicariBorclar.toplam +
      pasif.uvDigerBorclar.toplam +
      pasif.uvAlinanAvanslar.toplam +
      pasif.uvBorcGiderKars.toplam +
      pasif.uvGelYillaraGelir.toplam +
      pasif.digerUVYK.toplam;

    const ozkaynaklar =
      pasif.odenmisSermaye.toplam +
      pasif.sermayeYedekleri.toplam +
      pasif.karYedekleri.toplam +
      pasif.gecmisKarZarar.toplam +
      pasif.donemKarZarar.toplam;

    const pasifToplami = kvYabanciKaynak + uvYabanciKaynak + ozkaynaklar;

    // Eski kaydı sil — kesin kayıtlı ise reddet
    const existing = await (this.prisma as any).bilanco.findFirst({
      where: {
        tenantId: params.tenantId,
        taxpayerId: mizan.taxpayerId,
        mizanId: params.mizanId,
      },
    });
    if (existing?.locked) {
      throw new BadRequestException('Bu mizandan üretilmiş kesin kayıtlı bilanço var. Yeniden oluşturmak için önce kilidi açın.');
    }
    if (existing) {
      await (this.prisma as any).bilanco.delete({ where: { id: existing.id } });
    }

    const bilanco = await (this.prisma as any).bilanco.create({
      data: {
        tenantId: params.tenantId,
        taxpayerId: mizan.taxpayerId,
        mizanId: params.mizanId,
        donem: mizan.donem,
        donemTipi: params.donemTipi || mizan.donemTipi || 'AYLIK',
        tarih: params.tarih || new Date(),
        donenVarliklar,
        duranVarliklar,
        aktifToplami,
        kvYabanciKaynak,
        uvYabanciKaynak,
        ozkaynaklar,
        pasifToplami,
        aktif: aktif as any,
        pasif: pasif as any,
        detay: {
          fark: aktifToplami - pasifToplami,
          denk: Math.abs(aktifToplami - pasifToplami) < 0.01,
        } as any,
        createdBy: params.createdBy || null,
      },
    });

    return bilanco;
  }

  async listBilancolar(tenantId: string, taxpayerId?: string) {
    // taxpayer relation tanımsız → manuel enrich
    const results = await (this.prisma as any).bilanco.findMany({
      where: { tenantId, ...(taxpayerId ? { taxpayerId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const taxpayerIds = [...new Set(results.map((r: any) => r.taxpayerId))];
    const taxpayers = taxpayerIds.length
      ? await (this.prisma as any).taxpayer.findMany({
          where: { id: { in: taxpayerIds }, tenantId },
          select: { id: true, firstName: true, lastName: true, companyName: true },
        })
      : [];
    const tpMap = new Map(taxpayers.map((t: any) => [t.id, t]));
    return results.map((r: any) => ({ ...r, taxpayer: tpMap.get(r.taxpayerId) || null }));
  }

  async getBilanco(id: string, tenantId: string) {
    const b = await (this.prisma as any).bilanco.findFirst({
      where: { id, tenantId },
      include: {
        mizan: { select: { id: true, donem: true, donemTipi: true } },
      },
    });
    if (!b) throw new NotFoundException('Bilanço bulunamadı');
    const tp = await (this.prisma as any).taxpayer.findFirst({
      where: { id: b.taxpayerId, tenantId },
      select: { id: true, firstName: true, lastName: true, companyName: true },
    });
    b.taxpayer = tp || null;

    // ── Gelir tablosu bağlantısı ─────────────────────────────
    // Bilanço ile aynı mizandan veya aynı taxpayer+dönem'den üretilmiş gelir
    // tablosunu bul → donemNetKari'yi al. 590/591 için manuel düzeltme yoksa
    // otomatik olarak buna göre uygulanır.
    let gelirTablosu: any = null;
    try {
      gelirTablosu = await (this.prisma as any).gelirTablosu.findFirst({
        where: {
          tenantId,
          taxpayerId: b.taxpayerId,
          OR: [
            ...(b.mizanId ? [{ mizanId: b.mizanId }] : []),
            { donem: b.donem },
          ],
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, donem: true, donemTipi: true, donemNetKari: true, locked: true },
      });
    } catch {
      gelirTablosu = null;
    }
    const gelirNet = gelirTablosu ? Number(gelirTablosu.donemNetKari) || 0 : 0;

    // Manuel düzeltmeler (detay.duzeltmeler) — geçici vergi dönemlerinde
    // 590/591 mizanda olmayabilir; kullanıcı manuel girince veya gelir
    // tablosundan otomatik geldiğinde burada bilançoya yansıtılır.
    const duzeltmeler = (b.detay as any)?.duzeltmeler || {};
    let netKari = Number(duzeltmeler.donemNetKari) || 0;
    let netZarari = Number(duzeltmeler.donemNetZarari) || 0;
    const manuelVar = netKari > 0 || netZarari > 0;

    // OTOMATIK BAĞLANTI: Manuel düzeltme yoksa ve gelir tablosu varsa
    // → net kâr pozitifse 590'a, negatifse 591'e otomatik yaz
    let otomatikKaynak: any = null;
    if (!manuelVar && gelirTablosu && gelirNet !== 0) {
      if (gelirNet > 0) {
        netKari = gelirNet;
      } else {
        netZarari = Math.abs(gelirNet);
      }
      otomatikKaynak = {
        gelirTablosuId: gelirTablosu.id,
        donem: gelirTablosu.donem,
        donemTipi: gelirTablosu.donemTipi,
        donemNetKari: gelirNet,
      };
    }

    // UI için: bağlantı bilgisini response'a ekle
    b.gelirTablosuBagli = gelirTablosu
      ? {
          id: gelirTablosu.id,
          donem: gelirTablosu.donem,
          donemTipi: gelirTablosu.donemTipi,
          donemNetKari: gelirNet,
          onerilenKar: gelirNet > 0 ? gelirNet : 0,
          onerilenZarar: gelirNet < 0 ? Math.abs(gelirNet) : 0,
        }
      : null;
    b.otomatikKaynak = otomatikKaynak;

    // ── FİNANSAL ORANLAR ve YORUMLAMA ────────────────────────────────
    // Aktif/pasif JSON'dan temel grup toplamlarını al
    const aktifJ: any = b.aktif || {};
    const pasifJ: any = b.pasif || {};
    const hazirDeg = Number(aktifJ.hazirDegerler?.toplam || 0);
    const ticariAlacak = Number(aktifJ.ticariAlacaklar?.toplam || 0);
    const digerAlacak = Number(aktifJ.digerAlacaklar?.toplam || 0);
    const stoklar = Number(aktifJ.stoklar?.toplam || 0);
    const donenVar = Number(b.donenVarliklar || 0);
    const duranVar = Number(b.duranVarliklar || 0);
    const aktifT = Number(b.aktifToplami || 0);
    const kvyk = Number(b.kvYabanciKaynak || 0);
    const uvyk = Number(b.uvYabanciKaynak || 0);
    const ozk = Number(b.ozkaynaklar || 0) + (duzeltmeEtkisi || 0); // düzeltme etkisi dahil
    const pasifT = Number(b.pasifToplami || 0) + (duzeltmeEtkisi || 0);
    const yabanciK = kvyk + uvyk;
    const netSatis = gelirTablosu ? await this.getNetSatis(gelirTablosu.id) : 0;
    const netKar = gelirNet; // gelir tablosundan
    const safeDiv = (a: number, b: number) => (b > 0 ? a / b : 0);

    const oran = (value: number, format: 'x' | '%' = 'x', decimals = 2): string => {
      if (!isFinite(value)) return '—';
      if (format === '%') return `%${(value * 100).toFixed(decimals)}`;
      return value.toFixed(decimals);
    };

    const oranlar = {
      // ─── LİKİDİTE ──────────────────────────────────
      likidite: [
        {
          ad: 'Cari Oran',
          kod: 'cari',
          deger: safeDiv(donenVar, kvyk),
          format: 'x' as const,
          ideal: '1.5 – 2.0',
          yorum: (v: number) =>
            v >= 1.5 && v <= 2.5
              ? '✓ İdeal aralıkta — kısa vadeli borçları rahat karşılıyor.'
              : v > 2.5
                ? '⚠ Çok yüksek — atıl dönen varlık olasılığı, yatırım düşünülebilir.'
                : v >= 1
                  ? '⚠ Sınırda — likidite riskine dikkat, işletme sermayesi zayıf.'
                  : '✗ Düşük — kısa vadeli borçları karşılamakta güçlük, acil önlem gerek.',
        },
        {
          ad: 'Asit-Test (Hızlı)',
          kod: 'asitTest',
          deger: safeDiv(donenVar - stoklar, kvyk),
          format: 'x' as const,
          ideal: '≥ 1.0',
          yorum: (v: number) =>
            v >= 1
              ? '✓ İdeal — stoksuz bile kısa vadeli borçları karşılayabiliyor.'
              : v >= 0.7
                ? '⚠ Sınırda — stok satılmazsa borç ödeme sıkıntısı olabilir.'
                : '✗ Düşük — stoğa bağımlı likidite, risk yüksek.',
        },
        {
          ad: 'Nakit Oran',
          kod: 'nakit',
          deger: safeDiv(hazirDeg, kvyk),
          format: 'x' as const,
          ideal: '0.2 – 0.5',
          yorum: (v: number) =>
            v >= 0.2 && v <= 0.5
              ? '✓ Sağlıklı nakit tamponu mevcut.'
              : v > 0.5
                ? '⚠ Aşırı nakit bekletiliyor — değerlendirilebilir.'
                : '⚠ Nakit tamponu düşük — kritik ödeme günlerinde sıkıntı olabilir.',
        },
      ],
      // ─── MALİ YAPI ─────────────────────────────────
      maliYapi: [
        {
          ad: 'Finansal Kaldıraç',
          kod: 'kaldirac',
          deger: safeDiv(yabanciK, aktifT),
          format: '%' as const,
          ideal: '≤ %50',
          yorum: (v: number) =>
            v <= 0.5
              ? '✓ Sağlıklı — varlıkların yarıdan azı borçla finanse edilmiş.'
              : v <= 0.7
                ? '⚠ Orta risk — borç yükü artıyor, faiz giderleri izlenmeli.'
                : '✗ Yüksek borçluluk — finansman riski yüksek, özkaynak güçlendirilmeli.',
        },
        {
          ad: 'Özkaynak Oranı',
          kod: 'ozkaynak',
          deger: safeDiv(ozk, pasifT),
          format: '%' as const,
          ideal: '≥ %50',
          yorum: (v: number) =>
            v >= 0.5
              ? '✓ Güçlü özkaynak yapısı — dışa bağımlılık düşük.'
              : v >= 0.3
                ? '⚠ Orta — özkaynak payı artırılabilir.'
                : '✗ Düşük özkaynak — mali yapı zayıf, sermaye artırımı düşünülmeli.',
        },
        {
          ad: 'Borç / Özkaynak',
          kod: 'borcOzk',
          deger: safeDiv(yabanciK, ozk),
          format: 'x' as const,
          ideal: '≤ 1.0',
          yorum: (v: number) =>
            v <= 1
              ? '✓ Sağlıklı — özkaynak borçtan fazla.'
              : v <= 2
                ? '⚠ Borç özkaynağın üzerinde — risk artıyor.'
                : '✗ Borç özkaynağın 2 katından fazla — kritik kaldıraç seviyesi.',
        },
      ],
      // ─── KÂRLILIK ─────────────────────────────────
      karlilik: [
        {
          ad: 'ROA (Aktif Kârlılığı)',
          kod: 'roa',
          deger: safeDiv(netKar, aktifT),
          format: '%' as const,
          ideal: '≥ %5',
          yorum: (v: number) =>
            !gelirTablosu
              ? 'Gelir tablosu oluşturulmamış — ROA hesaplanamıyor.'
              : v >= 0.05
                ? '✓ Varlıklar verimli kullanılıyor.'
                : v >= 0.02
                  ? '⚠ Düşük verimlilik — operasyon iyileştirilmeli.'
                  : v >= 0
                    ? '✗ Aktif verimliliği çok düşük.'
                    : '✗ Zarar — varlıkların finansal dönüşü negatif.',
        },
        {
          ad: 'ROE (Özkaynak Kârlılığı)',
          kod: 'roe',
          deger: safeDiv(netKar, ozk),
          format: '%' as const,
          ideal: '≥ %15',
          yorum: (v: number) =>
            !gelirTablosu
              ? 'Gelir tablosu oluşturulmamış — ROE hesaplanamıyor.'
              : v >= 0.15
                ? '✓ Ortakların sermayesi iyi getiri sağlıyor.'
                : v >= 0.08
                  ? '⚠ Sektör ortalamasına göre düşük — karlılık iyileştirilmeli.'
                  : v >= 0
                    ? '✗ Özkaynak getirisi yetersiz.'
                    : '✗ Zarar — ortakların sermayesi eriyor.',
        },
        ...(netSatis > 0
          ? [
              {
                ad: 'Net Kâr Marjı',
                kod: 'karMarji',
                deger: safeDiv(netKar, netSatis),
                format: '%' as const,
                ideal: 'Sektöre göre',
                yorum: (v: number) =>
                  v >= 0.1
                    ? '✓ Güçlü kâr marjı (>%10).'
                    : v >= 0.05
                      ? '⚠ Orta kâr marjı — maliyet kontrolü izlenmeli.'
                      : v >= 0
                        ? '⚠ İnce kâr marjı — fiyatlama/maliyet rekabetçiliği gözden geçirilmeli.'
                        : '✗ Zarar — gider yapısı acil incelensin.',
              },
            ]
          : []),
      ],
    };
    // Her oranı format'la ve yorumunu çalıştır
    const formatlanmisOranlar = {
      likidite: oranlar.likidite.map((o) => ({
        ...o,
        degerFmt: oran(o.deger, o.format),
        yorum: o.yorum(o.deger),
      })),
      maliYapi: oranlar.maliYapi.map((o) => ({
        ...o,
        degerFmt: oran(o.deger, o.format),
        yorum: o.yorum(o.deger),
      })),
      karlilik: oranlar.karlilik.map((o: any) => ({
        ...o,
        degerFmt: oran(o.deger, o.format),
        yorum: o.yorum(o.deger),
      })),
    };
    b.finansalOranlar = formatlanmisOranlar;
    // Genel yorumlama özet
    b.finansalOzet = this.genelYorum(b, formatlanmisOranlar);

    const duzeltmeEtkisi = netKari - netZarari; // + kar, - zarar
    if (duzeltmeEtkisi !== 0) {
      // Pasif JSON içinde 59 Dönem Kar/Zarar grubunu güncelle:
      //   - toplam'a düzeltme etkisini ekle
      //   - hesaplar[] array'ine 590 (kâr) veya 591 (zarar) alt kalemini ekle
      //     ki frontend "50 Ödenmiş Sermaye → 500 SERMAYE" gibi alt satır gösterebilsin
      if (b.pasif && typeof b.pasif === 'object') {
        const p: any = b.pasif;
        if (p.donemKarZarar) {
          // Mevcut hesaplar (mizandaki 590/591 varsa) korunsun
          const mevcutHesaplar = Array.isArray(p.donemKarZarar.hesaplar)
            ? [...p.donemKarZarar.hesaplar]
            : [];
          // Manuel düzeltme satırlarını ekle
          if (netKari > 0) {
            mevcutHesaplar.push({
              kod: '590',
              ad: 'Dönem Net Kârı (Manuel)',
              tutar: netKari,
            });
          }
          if (netZarari > 0) {
            mevcutHesaplar.push({
              kod: '591',
              ad: 'Dönem Net Zararı (-) (Manuel)',
              tutar: -netZarari,
            });
          }
          p.donemKarZarar = {
            ...p.donemKarZarar,
            toplam: Number(p.donemKarZarar.toplam || 0) + duzeltmeEtkisi,
            hesaplar: mevcutHesaplar,
            manuelDuzeltme: duzeltmeEtkisi,
          };
        }
      }
      b.ozkaynaklar = Number(b.ozkaynaklar || 0) + duzeltmeEtkisi;
      b.pasifToplami = Number(b.pasifToplami || 0) + duzeltmeEtkisi;
      // Denklik durumunu güncelle
      const fark = Number(b.aktifToplami || 0) - Number(b.pasifToplami || 0);
      b.detay = {
        ...(b.detay as any),
        fark,
        denk: Math.abs(fark) < 0.01,
      };
    }
    return b;
  }

  /**
   * Bilanço için manuel düzeltme kaydet — özellikle geçici vergi dönemlerinde
   * mizanda bulunmayan 590 Dönem Net Kârı / 591 Dönem Net Zararı için.
   * Input örnek: { donemNetKari: 150000, donemNetZarari: 0 }
   */
  async updateDuzeltmeler(
    id: string,
    tenantId: string,
    duzeltmeler: Record<string, number>,
  ) {
    const b = await (this.prisma as any).bilanco.findFirst({ where: { id, tenantId } });
    if (!b) throw new NotFoundException('Bilanço bulunamadı');
    if (b.locked) throw new BadRequestException('Kesin kayıtlı bilançoda düzeltme yapılamaz');

    // Temizle: sadece bilinen alanları (donemNetKari, donemNetZarari) kabul et
    const cleaned: Record<string, number> = {};
    const toNum = (v: any): number => {
      if (typeof v === 'number') return v;
      const s = String(v ?? '').trim();
      if (!s) return 0;
      const n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
      return isFinite(n) ? n : 0;
    };
    const allowedKeys = ['donemNetKari', 'donemNetZarari'];
    for (const k of allowedKeys) {
      const n = toNum(duzeltmeler?.[k]);
      if (n !== 0) cleaned[k] = n;
    }

    const newDetay = {
      ...((b.detay as any) || {}),
      duzeltmeler: cleaned,
    };

    return (this.prisma as any).bilanco.update({
      where: { id },
      data: { detay: newDetay as any },
    });
  }

  // ─── Finansal oran helper'ları ───────────────────────────
  private async getNetSatis(gelirTablosuId: string): Promise<number> {
    try {
      const gt = await (this.prisma as any).gelirTablosu.findUnique({
        where: { id: gelirTablosuId },
        select: { netSatislar: true },
      });
      return gt ? Number(gt.netSatislar || 0) : 0;
    } catch {
      return 0;
    }
  }

  /** Genel finansal sağlık yorumu — en önemli oranları birleştirip özet verir */
  private genelYorum(bilanco: any, oranlar: any): string {
    const kvyk = Number(bilanco.kvYabanciKaynak || 0);
    const donenVar = Number(bilanco.donenVarliklar || 0);
    const ozk = Number(bilanco.ozkaynaklar || 0);
    const aktif = Number(bilanco.aktifToplami || 0);
    const yabanciK = kvyk + Number(bilanco.uvYabanciKaynak || 0);

    const cariOran = kvyk > 0 ? donenVar / kvyk : 0;
    const ozkaynakOrani = aktif > 0 ? ozk / aktif : 0;
    const kaldirac = aktif > 0 ? yabanciK / aktif : 0;

    const notlar: string[] = [];
    if (cariOran >= 1.5 && cariOran <= 2.5) notlar.push('Likidite dengeli');
    else if (cariOran < 1) notlar.push('Likidite riskli — kısa vadeli borç baskısı var');
    else if (cariOran > 3) notlar.push('Aşırı likit — atıl varlık olasılığı');

    if (ozkaynakOrani >= 0.5) notlar.push('Güçlü özkaynak yapısı');
    else if (ozkaynakOrani < 0.3) notlar.push('Özkaynak zayıf — sermaye artırımı düşünülmeli');

    if (kaldirac > 0.7) notlar.push('Yüksek borçluluk — finansman riski');

    if (notlar.length === 0) return 'Finansal yapı sağlıklı görünüyor.';
    return notlar.join(' · ') + '.';
  }

  async deleteBilanco(id: string, tenantId: string) {
    const b = await (this.prisma as any).bilanco.findFirst({ where: { id, tenantId } });
    if (!b) throw new NotFoundException('Bilanço bulunamadı');
    if (b.locked) throw new BadRequestException('Kesin kayıtlı bilanço silinemez, önce kilidi açın');
    await (this.prisma as any).bilanco.delete({ where: { id } });
    return { deleted: true };
  }

  async lockBilanco(id: string, tenantId: string, userId: string, note?: string) {
    const b = await (this.prisma as any).bilanco.findFirst({ where: { id, tenantId } });
    if (!b) throw new NotFoundException('Bilanço bulunamadı');
    if (b.locked) throw new BadRequestException('Zaten kesin kayıtlı');
    // Denklik kontrolü: fark 0.01 TL'den büyükse lock reddet
    const fark = Math.abs(Number(b.aktifToplami) - Number(b.pasifToplami));
    if (fark > 0.01) {
      throw new BadRequestException(
        `Bilanço denk değil (fark: ${fark.toFixed(2)} TL). Denklik sağlanmadan kesin kayıt yapılamaz.`,
      );
    }
    return (this.prisma as any).bilanco.update({
      where: { id },
      data: {
        locked: true,
        lockedAt: new Date(),
        lockedBy: userId,
        lockNote: note?.slice(0, 500) || null,
      },
    });
  }

  async unlockBilanco(id: string, tenantId: string, userId: string, reason?: string) {
    const b = await (this.prisma as any).bilanco.findFirst({ where: { id, tenantId } });
    if (!b) throw new NotFoundException('Bilanço bulunamadı');
    if (!b.locked) throw new BadRequestException('Zaten açık');
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('Kilidi açmak için sebep belirtmelisiniz (en az 5 karakter)');
    }
    return (this.prisma as any).bilanco.update({
      where: { id },
      data: {
        locked: false,
        lockedAt: null,
        lockedBy: null,
        lockNote: `Kilit açıldı (${new Date().toLocaleString('tr-TR')}): ${reason}`.slice(0, 500),
      },
    });
  }
}
