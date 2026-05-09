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

    // Düzeltme etkisini önceden hesapla (oran hesabında özkaynak için gerekli)
    const duzeltmeEtkisi = netKari - netZarari; // + kar, - zarar

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
            v >= 1.5 && v <= 2.5 ? '✓ İdeal'
            : v > 2.5 ? '⚠ Atıl varlık'
            : v >= 1 ? '⚠ Sınırda'
            : '✗ Borç baskısı',
        },
        {
          ad: 'Asit-Test',
          kod: 'asitTest',
          deger: safeDiv(donenVar - stoklar, kvyk),
          format: 'x' as const,
          ideal: '≥ 1.0',
          yorum: (v: number) =>
            v >= 1 ? '✓ Güçlü'
            : v >= 0.7 ? '⚠ Sınırda'
            : '✗ Stoğa bağımlı',
        },
        {
          ad: 'Nakit Oran',
          kod: 'nakit',
          deger: safeDiv(hazirDeg, kvyk),
          format: 'x' as const,
          ideal: '0.2 – 0.5',
          yorum: (v: number) =>
            v >= 0.2 && v <= 0.5 ? '✓ Sağlıklı'
            : v > 0.5 ? '⚠ Aşırı nakit'
            : '⚠ Nakit düşük',
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
            v <= 0.5 ? '✓ Sağlıklı'
            : v <= 0.7 ? '⚠ Orta risk'
            : '✗ Yüksek borç',
        },
        {
          ad: 'Özkaynak Oranı',
          kod: 'ozkaynak',
          deger: safeDiv(ozk, pasifT),
          format: '%' as const,
          ideal: '≥ %50',
          yorum: (v: number) =>
            v >= 0.5 ? '✓ Güçlü'
            : v >= 0.3 ? '⚠ Orta'
            : '✗ Zayıf',
        },
        {
          ad: 'Borç / Özkaynak',
          kod: 'borcOzk',
          deger: safeDiv(yabanciK, ozk),
          format: 'x' as const,
          ideal: '≤ 1.0',
          yorum: (v: number) =>
            v <= 1 ? '✓ Sağlıklı'
            : v <= 2 ? '⚠ Risk artıyor'
            : '✗ Kritik kaldıraç',
        },
      ],
      // ─── KÂRLILIK ─────────────────────────────────
      karlilik: [
        {
          ad: 'ROA',
          kod: 'roa',
          deger: safeDiv(netKar, aktifT),
          format: '%' as const,
          ideal: '≥ %5',
          yorum: (v: number) =>
            !gelirTablosu ? '— Gelir tablosu yok'
            : v >= 0.05 ? '✓ Verimli'
            : v >= 0.02 ? '⚠ Düşük verim'
            : v >= 0 ? '✗ Yetersiz'
            : '✗ Zarar',
        },
        {
          ad: 'ROE',
          kod: 'roe',
          deger: safeDiv(netKar, ozk),
          format: '%' as const,
          ideal: '≥ %15',
          yorum: (v: number) =>
            !gelirTablosu ? '— Gelir tablosu yok'
            : v >= 0.15 ? '✓ İyi getiri'
            : v >= 0.08 ? '⚠ Düşük getiri'
            : v >= 0 ? '✗ Yetersiz'
            : '✗ Zarar',
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
                  v >= 0.1 ? '✓ Güçlü'
                  : v >= 0.05 ? '⚠ Orta'
                  : v >= 0 ? '⚠ İnce marj'
                  : '✗ Zarar',
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
    // ── ÖNCEKİ DÖNEM KARŞILAŞTIRMASI ─────────────────────────
    // Aynı mükellefin önceki dönem bilançosunu bul, oranları hesapla ve
    // her orana trend/değişim bilgisi ekle. Önce aynı yıl önceki dönemi,
    // yoksa geçen yıl aynı dönemi tercih et.
    let oncekiBilanco: any = null;
    try {
      const DONEM_SIRASI: Record<string, number> = {
        AYLIK: 0, GECICI_Q1: 1, GECICI_Q2: 2, GECICI_Q3: 3, GECICI_Q4: 4, YILLIK: 5,
      };
      const mevcutSira = DONEM_SIRASI[String(b.donemTipi || '')] || 0;
      const yilMatch = String(b.donem || '').match(/^(\d{4})/);
      const yil = yilMatch ? yilMatch[1] : null;

      if (yil && mevcutSira >= 1) {
        // 1. tercih: aynı yıl, önceki dönem
        const oncekiTipler = Object.keys(DONEM_SIRASI).filter(
          (t) => DONEM_SIRASI[t] < mevcutSira && DONEM_SIRASI[t] >= 1,
        );
        if (oncekiTipler.length > 0) {
          oncekiBilanco = await (this.prisma as any).bilanco.findFirst({
            where: {
              tenantId, taxpayerId: b.taxpayerId,
              donem: { startsWith: yil },
              donemTipi: { in: oncekiTipler },
              id: { not: b.id },
            },
            orderBy: { createdAt: 'desc' },
          });
        }
      }
      // 2. tercih: geçen yıl aynı dönem
      if (!oncekiBilanco && yil) {
        const oncekiYil = String(Number(yil) - 1);
        oncekiBilanco = await (this.prisma as any).bilanco.findFirst({
          where: {
            tenantId, taxpayerId: b.taxpayerId,
            donem: { startsWith: oncekiYil },
            donemTipi: b.donemTipi,
            id: { not: b.id },
          },
          orderBy: { createdAt: 'desc' },
        });
      }
    } catch {
      oncekiBilanco = null;
    }

    // Önceki bilançonun oran değerlerini hesapla (ve mevcut oranlarla karşılaştır)
    if (oncekiBilanco) {
      const oncekiVals = this.hesaplaOranDegerleri(oncekiBilanco);
      const applyKarsilastir = (arr: any[]) =>
        arr.map((o: any) => {
          const eski = oncekiVals[o.kod];
          if (eski === undefined || !isFinite(eski)) return o;
          const degisim = o.deger - eski;
          const degisimYuzde = Math.abs(eski) > 0.0001 ? (degisim / Math.abs(eski)) * 100 : 0;
          const trend: 'up' | 'down' | 'flat' =
            Math.abs(degisimYuzde) < 1 ? 'flat' : degisimYuzde > 0 ? 'up' : 'down';
          return {
            ...o,
            onceki: eski,
            oncekiFmt: o.format === '%' ? `%${(eski * 100).toFixed(2)}` : eski.toFixed(2),
            degisim,
            degisimYuzde,
            trend,
          };
        });
      formatlanmisOranlar.likidite = applyKarsilastir(formatlanmisOranlar.likidite);
      formatlanmisOranlar.maliYapi = applyKarsilastir(formatlanmisOranlar.maliYapi);
      formatlanmisOranlar.karlilik = applyKarsilastir(formatlanmisOranlar.karlilik);
    }

    b.finansalOranlar = formatlanmisOranlar;
    b.oncekiDonemBilgi = oncekiBilanco
      ? {
          id: oncekiBilanco.id,
          donem: oncekiBilanco.donem,
          donemTipi: oncekiBilanco.donemTipi,
        }
      : null;
    // Genel yorumlama özet
    b.finansalOzet = this.genelYorum(b, formatlanmisOranlar);

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
  /** Bilanço objesinden oran değerlerini hesaplar (sadece sayısal sonuç) — karşılaştırma için */
  private hesaplaOranDegerleri(b: any): Record<string, number> {
    const aktifJ: any = b.aktif || {};
    const hazirDeg = Number(aktifJ.hazirDegerler?.toplam || 0);
    const stoklar = Number(aktifJ.stoklar?.toplam || 0);
    const donenVar = Number(b.donenVarliklar || 0);
    const aktifT = Number(b.aktifToplami || 0);
    const kvyk = Number(b.kvYabanciKaynak || 0);
    const uvyk = Number(b.uvYabanciKaynak || 0);
    const ozk = Number(b.ozkaynaklar || 0);
    const pasifT = Number(b.pasifToplami || 0);
    const yabanciK = kvyk + uvyk;
    const safeDiv = (a: number, c: number) => (c > 0 ? a / c : 0);
    return {
      cari: safeDiv(donenVar, kvyk),
      asitTest: safeDiv(donenVar - stoklar, kvyk),
      nakit: safeDiv(hazirDeg, kvyk),
      kaldirac: safeDiv(yabanciK, aktifT),
      ozkaynak: safeDiv(ozk, pasifT),
      borcOzk: safeDiv(yabanciK, ozk),
      // ROA/ROE/karMarji gelir tablosuna bağlı, geçmiş bilanço için uygulanmaz
      roa: 0,
      roe: 0,
      karMarji: 0,
    };
  }

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

  async exportToExcel(id: string, tenantId: string): Promise<Buffer> {
    const ExcelJS = await import('exceljs');
    const b = await this.getBilanco(id, tenantId);
    const wb = new (ExcelJS as any).Workbook();
    const ws = wb.addWorksheet('Bilanço');
    const taxpayerName =
      b.taxpayer?.companyName ||
      [b.taxpayer?.firstName, b.taxpayer?.lastName].filter(Boolean).join(' ') ||
      'Mükellef';

    wb.creator = 'Moren Mali Müşavirlik';
    wb.created = new Date();
    ws.views = [{ state: 'frozen', ySplit: 5 }];
    ws.columns = [
      { header: 'Taraf', key: 'taraf', width: 13 },
      { header: 'Kod/Grup', key: 'kod', width: 16 },
      { header: 'Kalem', key: 'kalem', width: 54 },
      { header: 'Tutar', key: 'tutar', width: 18 },
    ];

    ws.spliceRows(1, 0, [], [], [], []);
    ws.mergeCells('A1:D1');
    ws.getCell('A1').value = 'BİLANÇO';
    ws.mergeCells('A2:D2');
    ws.getCell('A2').value = taxpayerName;
    ws.mergeCells('A3:D3');
    ws.getCell('A3').value = `${b.donem} · ${b.donemTipi || 'Dönem'} · ${b.tarih ? new Date(b.tarih).toLocaleDateString('tr-TR') : ''}`;

    for (const addr of ['A1', 'A2', 'A3']) {
      const cell = ws.getCell(addr);
      cell.alignment = { horizontal: 'center' };
      cell.font = { bold: true, size: addr === 'A1' ? 16 : 12, color: { argb: addr === 'A1' ? 'FFD4B876' : 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF11100D' } };
    }

    const header = ws.getRow(5);
    header.values = ['Taraf', 'Kod/Grup', 'Kalem', 'Tutar'];
    header.height = 24;
    header.eachCell((cell: any) => {
      cell.font = { bold: true, color: { argb: 'FFF5EFE3' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3A3324' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF8A7445' } },
        bottom: { style: 'thin', color: { argb: 'FF8A7445' } },
        left: { style: 'thin', color: { argb: 'FF4A412E' } },
        right: { style: 'thin', color: { argb: 'FF4A412E' } },
      };
    });

    const aktif = (b.aktif as any) || {};
    const pasif = (b.pasif as any) || {};
    const activeDonen = [
      'hazirDegerler', 'menkulKiymetler', 'ticariAlacaklar', 'digerAlacaklar',
      'stoklar', 'yillaraYayInsaat', 'gelecekAylaraGiderler', 'digerDonenVarliklar',
    ];
    const activeDuran = [
      'uzunVadeliAlacaklar', 'maliDuran', 'maddiDuran', 'maddiOlmayanDuran',
      'ozelTukenmeye', 'gelecekYillaraGiderler', 'digerDuranVarliklar',
    ];
    const passiveKv = [
      'kvMaliBorclar', 'kvTicariBorclar', 'kvDigerBorclar', 'alinanAvanslar',
      'yillaraYayInsaatKV', 'odenecekVergi', 'kvBorcGiderKars', 'kvGelAylaraGelir', 'digerKVYK',
    ];
    const passiveUv = [
      'uvMaliBorclar', 'uvTicariBorclar', 'uvDigerBorclar', 'uvAlinanAvanslar',
      'uvBorcGiderKars', 'uvGelYillaraGelir', 'digerUVYK',
    ];
    const passiveOzk = ['odenmisSermaye', 'sermayeYedekleri', 'karYedekleri', 'gecmisKarZarar', 'donemKarZarar'];

    const rows: Array<{ taraf: string; kod: string; kalem: string; tutar: number | null; type?: 'section' | 'total' | 'group' | 'account' }> = [];
    const addSection = (label: string) => rows.push({ taraf: label, kod: '', kalem: label, tutar: null, type: 'section' });
    const addTotal = (taraf: string, label: string, tutar: number) => rows.push({ taraf, kod: '', kalem: label, tutar, type: 'total' });
    const addGroup = (taraf: string, key: string, side: any) => {
      const g = side?.[key];
      if (!g) return;
      rows.push({ taraf, kod: g.kodRange || '', kalem: g.grup || key, tutar: Number(g.toplam || 0), type: 'group' });
      for (const h of Array.isArray(g.hesaplar) ? g.hesaplar : []) {
        rows.push({ taraf, kod: h.kod || '', kalem: h.ad || '', tutar: Number(h.tutar || 0), type: 'account' });
      }
    };

    addSection('AKTİF');
    addTotal('AKTİF', 'DÖNEN VARLIKLAR', Number(b.donenVarliklar || 0));
    activeDonen.forEach((key) => addGroup('AKTİF', key, aktif));
    addTotal('AKTİF', 'DURAN VARLIKLAR', Number(b.duranVarliklar || 0));
    activeDuran.forEach((key) => addGroup('AKTİF', key, aktif));
    addTotal('AKTİF', 'AKTİF TOPLAMI', Number(b.aktifToplami || 0));

    addSection('PASİF');
    addTotal('PASİF', 'KISA VADELİ YABANCI KAYNAKLAR', Number(b.kvYabanciKaynak || 0));
    passiveKv.forEach((key) => addGroup('PASİF', key, pasif));
    addTotal('PASİF', 'UZUN VADELİ YABANCI KAYNAKLAR', Number(b.uvYabanciKaynak || 0));
    passiveUv.forEach((key) => addGroup('PASİF', key, pasif));
    addTotal('PASİF', 'ÖZKAYNAKLAR', Number(b.ozkaynaklar || 0));
    passiveOzk.forEach((key) => addGroup('PASİF', key, pasif));
    addTotal('PASİF', 'PASİF TOPLAMI', Number(b.pasifToplami || 0));
    addTotal('KONTROL', 'AKTİF - PASİF FARKI', Number(b.aktifToplami || 0) - Number(b.pasifToplami || 0));

    let rowNo = 6;
    for (const item of rows) {
      const row = ws.getRow(rowNo++);
      row.values = [item.taraf, item.kod, item.kalem, item.tutar];
      const isSection = item.type === 'section';
      const isTotal = item.type === 'total';
      const isGroup = item.type === 'group';
      row.height = isSection ? 25 : 22;
      row.eachCell((cell: any, col: number) => {
        cell.font = {
          bold: isSection || isTotal || isGroup,
          color: { argb: isSection ? 'FFFFFFFF' : isTotal ? 'FF111827' : isGroup ? 'FF1F2937' : 'FF374151' },
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: isSection ? 'FF11100D' : isTotal ? 'FFFFF1C2' : isGroup ? 'FFFFF7E6' : 'FFFFFFFF' },
        };
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        };
        cell.alignment = { horizontal: col === 4 ? 'right' : 'left', vertical: 'middle', indent: item.type === 'account' && col === 3 ? 1 : 0 };
        if (col === 4) cell.numFmt = '#,##0.00;[Red]-#,##0.00';
      });
    }

    const buffer = await wb.xlsx.writeBuffer();
    return buffer as Buffer;
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
