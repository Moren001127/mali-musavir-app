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
    return (this.prisma as any).bilanco.findMany({
      where: { tenantId, ...(taxpayerId ? { taxpayerId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        taxpayer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
      },
      take: 100,
    });
  }

  async getBilanco(id: string, tenantId: string) {
    const b = await (this.prisma as any).bilanco.findFirst({
      where: { id, tenantId },
      include: {
        taxpayer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
        mizan: { select: { id: true, donem: true, donemTipi: true } },
      },
    });
    if (!b) throw new NotFoundException('Bilanço bulunamadı');
    return b;
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
