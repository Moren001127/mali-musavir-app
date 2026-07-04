/**
 * Gelir Tablosu Servisi — mizan hesap kodlarından TDHP standart gelir
 * tablosunu üretir.
 *
 * TDHP 6XX grubu (gelir tablosu):
 *   - 600/601/602     → Brüt Satışlar
 *   - 610/611/612     → Satış İndirimleri (-)
 *   - 620/621/622/623 → Satışların Maliyeti (-) (7/B)
 *   - 740             → Hizmet Üretim Maliyeti (7/A) → maliyet olarak yansır
 *   - 631/632/633     → Faaliyet Giderleri (-) (7/B)
 *   - 750/760/770/780 → Faaliyet Giderleri (-) (7/A)
 *   - 640-649         → Diğer Olağan Gelir ve Karlar
 *   - 653-659         → Diğer Olağan Gider ve Zararlar (-)
 *   - 660/661/780     → Finansman Giderleri (-)
 *   - 671/672/679     → Olağandışı Gelir ve Karlar
 *   - 680/681/689     → Olağandışı Gider ve Zararlar (-)
 *   - 690             → Dönem Kar/Zarar
 *   - 691             → Dönem Karı Vergi Karşılığı (-)
 *   - 692             → Dönem Net Kar/Zarar
 */
import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MizanService } from './mizan.service';

type KalemHesap = { kod: string; tutar: number; hesapAdi: string };

@Injectable()
export class GelirTablosuService {
  private readonly logger = new Logger(GelirTablosuService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => MizanService))
    private mizanService: MizanService,
  ) {}

  /**
   * Mizandan gelir tablosu üret. Mizan'ın aynı dönem için mevcut gelir
   * tablosu varsa üstüne yazılır.
   */
  async generateFromMizan(params: {
    mizanId: string;
    tenantId: string;
    donemTipi?: string;
    createdBy?: string;
  }) {
    const mizan = await (this.prisma as any).mizan.findFirst({
      where: { id: params.mizanId, tenantId: params.tenantId },
    });
    if (!mizan) throw new NotFoundException('Mizan bulunamadı');

    const map = await this.mizanService.getHesaplarMap(params.mizanId);

    // Hesap bakiyeleri toplayıcı: alacak bakiyesi (satışlar) / borç bakiyesi (maliyet/gider)
    // TDHP mantığı:
    //   Gelir hesapları (6XX satışlar, 64X gelirler) → alacak bakiyesi pozitif kar getirir
    //   Gider/maliyet hesapları (62X, 63X, 65X, 66X, 7XX) → borç bakiyesi pozitif gider getirir
    const gelirBy = (prefixler: string[]): { toplam: number; detay: KalemHesap[] } => {
      let toplam = 0;
      const detay: KalemHesap[] = [];
      for (const [kod, h] of map.entries()) {
        if (h.seviye !== 0) continue; // sadece ana hesaplar
        if (!prefixler.some((p) => kod.startsWith(p))) continue;
        // Net: alacak bakiyesi - borç bakiyesi
        const net = h.alacakBakiye - h.borcBakiye;
        if (net !== 0) {
          toplam += net;
          detay.push({ kod, tutar: net, hesapAdi: h.hesapAdi });
        }
      }
      return { toplam, detay };
    };
    const giderBy = (prefixler: string[]): { toplam: number; detay: KalemHesap[] } => {
      let toplam = 0;
      const detay: KalemHesap[] = [];
      for (const [kod, h] of map.entries()) {
        if (h.seviye !== 0) continue;
        if (!prefixler.some((p) => kod.startsWith(p))) continue;
        // Gider: borç bakiyesi - alacak bakiyesi
        const net = h.borcBakiye - h.alacakBakiye;
        if (net !== 0) {
          toplam += net;
          detay.push({ kod, tutar: net, hesapAdi: h.hesapAdi });
        }
      }
      return { toplam, detay };
    };

    // A. Brüt Satışlar (600, 601, 602)
    const brutSatis = gelirBy(['600', '601', '602']);
    // B. Satış İndirimleri (610, 611, 612) — bunlar (-) hesap olmasına rağmen borç bakiyesi pozitif kaydedilir
    const satisInd = giderBy(['610', '611', '612']);
    // C. Net Satışlar = A - B
    const netSatis = brutSatis.toplam - satisInd.toplam;
    // D. Satışların Maliyeti — v1.36.52: 620 + 621 + 622 + 623 + 740 dahil (TDHP standartı).
    // Manuel SMM input SADECE 621 (Satılan Ticari Mallar Maliyeti) yerine geçer; diğerleri (620, 622, 623, 740) otomatik kalır.
    // Bu sayede hizmet firmasında 740 (Hizmet Üretim Maliyeti) bakiyesi otomatik yansır,
    // kullanıcı sadece ticari mal maliyetini elinde girer.
    const satisMal = giderBy(['620', '621', '622', '623', '740']);
    const satisMal621Auto = giderBy(['621']).toplam; // 621 ayrı sakla (manuel override için)
    // Brüt Satış Karı = C - D
    const brutKar = netSatis - satisMal.toplam;
    // E. Faaliyet Giderleri (631, 632, 633 + 750, 760, 770)
    const faalGid = giderBy(['631', '632', '633', '750', '760', '770']);
    // Faaliyet Karı
    const faalKar = brutKar - faalGid.toplam;
    // F. Diğer Olağan Gelir (640-649)
    const digerGelir = gelirBy(['640', '641', '642', '643', '644', '645', '646', '647', '648', '649']);
    // G. Diğer Olağan Gider (653-659)
    const digerGider = giderBy(['653', '654', '655', '656', '657', '658', '659']);
    // H. Finansman Giderleri (660, 661, 780)
    const finansman = giderBy(['660', '661', '780']);
    // Olağan Kar
    const olaganKar = faalKar + digerGelir.toplam - digerGider.toplam - finansman.toplam;
    // I. Olağandışı Gelir (671, 672, 679)
    const olDisiGelir = gelirBy(['671', '672', '679']);
    // J. Olağandışı Gider (680, 681, 689)
    const olDisiGider = giderBy(['680', '681', '689']);
    // Dönem Karı
    const donemKar = olaganKar + olDisiGelir.toplam - olDisiGider.toplam;
    // K. Vergi Karşılığı (691)
    const vergi = giderBy(['691']);
    // Dönem Net Karı
    const donemNetKar = donemKar - vergi.toplam;

    // ── STOK ve MALİYET hesapları (mizandan bakiye) — gelir tablosu altındaki widget için ──
    // Net bakiye = borçBakiye - alacakBakiye (aktif hesaplar için)
    const hesapBakiye = (prefix: string): { kod: string; hesapAdi: string; bakiye: number }[] => {
      const out: { kod: string; hesapAdi: string; bakiye: number }[] = [];
      for (const [kod, h] of map.entries()) {
        if (!kod.startsWith(prefix)) continue;
        // Sadece leaf (en alt seviye) değil, ana hesabı al
        // seviye 0 varsa onu, yoksa ilk eşleşeni
        if (h.seviye === 0 || (kod === prefix)) {
          const net = Number(h.borcBakiye) - Number(h.alacakBakiye);
          out.push({ kod, hesapAdi: h.hesapAdi, bakiye: net });
        }
      }
      return out;
    };
    // Hesap kodu ve TÜM ALT KIRILIMLARI için net bakiye toplamı.
    // 153 hesabında kendi satırında bakiye 0 gözükse bile alt kırılımlarında
    // (153.01, 153.01.001 gibi) değer olabilir. Ana hesap adı seviye 0'dan,
    // bakiye = en düşük seviyeli (leaf) hesapların toplamı.
    const tekHesap = (kod: string): { kod: string; hesapAdi: string; bakiye: number } => {
      const anaH = map.get(kod);
      const prefix = kod + '.';
      let toplam = 0;
      let leafCount = 0;
      // Leaf hesapları tespit et ve topla
      for (const [k, h] of map.entries()) {
        if (k !== kod && !k.startsWith(prefix)) continue;
        // Leaf: altında başka detay yok
        const altPrefix = k + '.';
        let isLeaf = true;
        for (const kk of map.keys()) {
          if (kk !== k && kk.startsWith(altPrefix)) { isLeaf = false; break; }
        }
        if (isLeaf) {
          toplam += Number(h.borcBakiye) - Number(h.alacakBakiye);
          leafCount++;
        }
      }
      // Leaf yoksa (sadece ana hesap kaydı) direkt ana hesabın bakiyesi
      if (leafCount === 0 && anaH) {
        toplam = Number(anaH.borcBakiye) - Number(anaH.alacakBakiye);
      }
      return {
        kod,
        hesapAdi: anaH?.hesapAdi || '',
        bakiye: toplam,
      };
    };

    const stokHesaplari = [
      tekHesap('150'), // İlk Madde ve Malzeme
      tekHesap('151'), // Yarı Mamuller
      tekHesap('152'), // Mamuller
      tekHesap('153'), // Ticari Mallar
      tekHesap('157'), // Diğer Stoklar
    ];

    const maliyetHesaplari = [
      tekHesap('720'), // Direkt İlk Madde Malzeme Gideri
      tekHesap('721'), // Direkt İlk Madde Malzeme Gideri Yansıtma (-)
      tekHesap('730'), // Genel Üretim Giderleri
      tekHesap('731'), // Genel Üretim Giderleri Yansıtma (-)
    ];

    // v1.36.37: Stok bolumu kullanici mental modeli (FINAL):
    //   Toplam Stok = TUM goruntulenen satirlarin toplami (150-157 + 720-731)
    //   SMM         = MANUEL giris (duzeltmeler.satisMaliyetiManuel) — backend
    //                 otomatik 621'den almaz. User elinde girer.
    //   Kalan Stok  = Toplam Stok - SMM
    // Ana gelir tablosundaki D. Satislarin Maliyeti yine 620-623+740 toplami.
    const stokToplam150_157 = stokHesaplari.reduce((s, h) => s + h.bakiye, 0);
    const maliyetToplam720_731 = maliyetHesaplari.reduce((s, h) => s + h.bakiye, 0);
    const toplamStok = stokToplam150_157 + maliyetToplam720_731;
    // v1.36.52: 621'in OTOMATİK değerini sakla — manuel override için referans gerekli.
    // Kullanıcı manuel SMM girmediyse bu değer kullanılır; girdiyse manuel onun yerine geçer.
    const satisMaliyeti621 = satisMal621Auto;
    const kalanStok = toplamStok;

    // KKEG — 689 hesap bakiyesi (Math.abs ile + işaretli pozitif olarak gelsin)
    // Eğer 950 nazım hesabı kullanılıyorsa o öncelikli, yoksa 689
    const kkeg950 = tekHesap('950');
    const kkeg689 = tekHesap('689');
    const kkeg = kkeg950.bakiye !== 0
      ? Math.abs(kkeg950.bakiye)
      : Math.abs(kkeg689.bakiye);

    const detay = {
      brutSatis,
      satisInd,
      satisMal,
      faalGid,
      digerGelir,
      digerGider,
      finansman,
      olDisiGelir,
      olDisiGider,
      vergi,
      // Yeni: stok & maliyet & KKEG (gelir tablosu altı widget için)
      stokHesaplari,
      toplamStok,
      maliyetHesaplari,
      kalanStok,
      kkeg,
      // v1.36.35: stok bölümü için sadece 621 (ticari mal) maliyeti
      satisMaliyeti621,
    };

    // Eski kaydı sil — kesin kayıtlı ise reddet
    const existing = await (this.prisma as any).gelirTablosu.findFirst({
      where: {
        tenantId: params.tenantId,
        taxpayerId: mizan.taxpayerId,
        mizanId: params.mizanId,
      },
    });
    if (existing?.locked) {
      throw new BadRequestException('Bu mizandan üretilmiş kesin kayıtlı gelir tablosu var. Yeniden oluşturmak için önce kilidi açın.');
    }
    // v1.36.53: yeniden üretimde kullanıcının elle girdiği düzeltmeleri KORU.
    // (ör. 1. dönem Satılan Ticari Mallar Maliyeti manuel girişi tablo tekrar üretilince silinmesin)
    const preservedDuzeltmeler = (existing?.duzeltmeler as any) || null;
    if (existing) {
      await (this.prisma as any).gelirTablosu.delete({ where: { id: existing.id } });
    }

    const gt = await (this.prisma as any).gelirTablosu.create({
      data: {
        tenantId: params.tenantId,
        taxpayerId: mizan.taxpayerId,
        mizanId: params.mizanId,
        donem: mizan.donem,
        donemTipi: params.donemTipi || mizan.donemTipi || 'GECICI_Q1',
        brutSatislar: brutSatis.toplam,
        satisIndirimleri: satisInd.toplam,
        netSatislar: netSatis,
        satisMaliyeti: satisMal.toplam,
        brutSatisKari: brutKar,
        faaliyetGiderleri: faalGid.toplam,
        faaliyetKari: faalKar,
        digerGelirler: digerGelir.toplam,
        digerGiderler: digerGider.toplam,
        finansmanGiderleri: finansman.toplam,
        olaganKar: olaganKar,
        olaganDisiGelir: olDisiGelir.toplam,
        olaganDisiGider: olDisiGider.toplam,
        donemKari: donemKar,
        vergiKarsiligi: vergi.toplam,
        donemNetKari: donemNetKar,
        detay: detay as any,
        createdBy: params.createdBy || null,
      },
    });

    // v1.36.53: önceki manuel düzeltmeleri yeni kayda taşı + türevleri (brütKar, satışMaliyeti…)
    // updateDuzeltmeler'in test edilmiş mantığıyla yeniden hesapla. Taşınamazsa ham tablo döner (veri kaybı yok).
    if (preservedDuzeltmeler && Object.keys(preservedDuzeltmeler).length > 0) {
      try {
        return await this.updateDuzeltmeler(gt.id, params.tenantId, preservedDuzeltmeler);
      } catch {
        return gt;
      }
    }

    return gt;
  }

  async listGelirTablolari(tenantId: string, taxpayerId?: string) {
    // taxpayer relation tanımsız → manuel enrich
    const results = await (this.prisma as any).gelirTablosu.findMany({
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

  async getGelirTablosu(id: string, tenantId: string) {
    const gt = await (this.prisma as any).gelirTablosu.findFirst({
      where: { id, tenantId },
      include: {
        mizan: { select: { id: true, donem: true, donemTipi: true } },
      },
    });
    if (!gt) throw new NotFoundException('Gelir tablosu bulunamadı');
    const tp = await (this.prisma as any).taxpayer.findFirst({
      where: { id: gt.taxpayerId, tenantId },
      select: { id: true, firstName: true, lastName: true, companyName: true, type: true },
    });
    gt.taxpayer = tp || null;

    // ── STOK & MALİYET (backend tarafında detay JSON'a kayıt edildi) ─────
    const detay = (gt.detay as any) || {};
    const duzeltmeler = (gt.duzeltmeler as any) || {};
    const stokHesaplari = Array.isArray(detay.stokHesaplari) ? detay.stokHesaplari : [];
    const maliyetHesaplari = Array.isArray(detay.maliyetHesaplari) ? detay.maliyetHesaplari : [];
    // v1.36.38: Toplam Stok her zaman hesaplari toplamindan dinamik hesaplanir.
    // DB'de detay.toplamStok eski formulle saklanmis olabilir — biz arrays'ten
    // her acilista yeniden hesaplariz, eski kayitlar da dogru gorunur.
    // Toplam Stok = stokHesaplari (150-157) + maliyetHesaplari (720-731) toplami
    // SMM = SADECE duzeltmeler.satisMaliyetiManuel (kullanicinin yeni manuel input'u)
    // Eski kayitlardaki duzeltmeler.satisMaliyeti otomatik 622-Hizmet Maliyeti ile
    // doldurulmus olabiliyordu — onu artik OKUMUYORUZ. Boylece eski kayitlarda da
    // yanlis hizmet maliyeti SMM olarak gorunmez, sifir gosterir; kullanici yeni
    // ana GT'de "Manuel Satilan Ticari Mallar Maliyeti"e yazinca dogru deger gelir.
    // Kalan Stok = Toplam Stok - SMM
    const toplamStok = stokHesaplari.reduce((s: number, h: any) => s + Number(h.bakiye || 0), 0)
                     + maliyetHesaplari.reduce((s: number, h: any) => s + Number(h.bakiye || 0), 0);
    const satisMaliyeti = Number(duzeltmeler.satisMaliyetiManuel || 0);
    const kalanStok = toplamStok - satisMaliyeti;
    const kkeg = Number(detay.kkeg || 0);

    // ── GEÇİCİ VERGİ MATRAHI HESAPLAMASI ──────────────────────────────────
    const donemNetKari = Number(gt.donemNetKari || 0);
    const gecmisYilZarari = Number(duzeltmeler.gecmisYilZarari || 0); // manuel giriş

    // Önceki dönem ödenen geçici vergi: kümülatif toplam
    //   Q1 → 0 (ilk dönem)
    //   Q2 → Q1.odenecekGeciciVergi
    //   Q3 → Q1 + Q2 ödenecek toplamı
    //   Q4 → Q1 + Q2 + Q3 ödenecek toplamı
    const DONEM_SIRASI: Record<string, number> = {
      GECICI_Q1: 1, GECICI_Q2: 2, GECICI_Q3: 3, GECICI_Q4: 4, YILLIK: 5,
    };
    const mevcutSira = DONEM_SIRASI[String(gt.donemTipi || '')] || 0;
    const yilMatch = String(gt.donem || '').match(/^(\d{4})/);
    const yil = yilMatch ? yilMatch[1] : null;
    let oncekiDonemOtomatikToplam = 0;
    if (mevcutSira >= 2 && yil) {
      const oncekiTipler = Object.keys(DONEM_SIRASI).filter(
        (t) => DONEM_SIRASI[t] < mevcutSira,
      );
      const oncekiTablolar = await (this.prisma as any).gelirTablosu.findMany({
        where: {
          tenantId,
          taxpayerId: gt.taxpayerId,
          donem: { startsWith: yil },
          donemTipi: { in: oncekiTipler },
          id: { not: gt.id },
        },
      });
      // Her bir önceki döneminin ödenecek vergisini tekrar hesapla ve topla
      for (const o of oncekiTablolar) {
        const dDetay = (o.detay as any) || {};
        const dDuz = (o.duzeltmeler as any) || {};
        const dKkeg = Number(dDetay.kkeg || 0);
        const dToplamKar = Number(o.donemNetKari || 0) + dKkeg;
        const dGecmisYil = Number(dDuz.gecmisYilZarari || 0);
        const dMatrah = Math.max(0, dToplamKar - dGecmisYil);
        // v1.36.47: önceki dönem hesabında da aynı oran uygulanmalı
        const dHesap = dMatrah * (tp?.type === 'GERCEK_KISI' ? 0.15 : 0.25);
        // O dönemin "önceki ödenen" değerini de dikkate al (kümülatif zincir)
        const dOncekiOdenen = Number(dDuz.oncekiDonemOdenenGeciciVergi || 0);
        const dOdenecek = Math.max(0, dHesap - dOncekiOdenen);
        oncekiDonemOtomatikToplam += dOdenecek;
      }
    }

    // Manuel override varsa onu kullan, yoksa otomatik kümülatif toplamı
    const manuelOncekiOdenen = Number(duzeltmeler.oncekiDonemOdenenGeciciVergi || 0);
    const oncekiDonemOdenenGeciciVergi =
      manuelOncekiOdenen > 0 ? manuelOncekiOdenen : oncekiDonemOtomatikToplam;

    const toplamKar = donemNetKari + kkeg;
    const gecicVergiMatrahi = Math.max(0, toplamKar - gecmisYilZarari);
    // v1.36.47: Mükellef tipine göre geçici vergi oranı:
    //   - TUZEL_KISI → %25 (kurumlar vergisi)
    //   - GERCEK_KISI → %15 (gelir vergisi geçici taksit dilimi)
    const gecicVergiOrani = tp?.type === 'GERCEK_KISI' ? 0.15 : 0.25;
    const hesaplananGeciciVergi = gecicVergiMatrahi * gecicVergiOrani;
    const odenecekGeciciVergi = Math.max(0, hesaplananGeciciVergi - oncekiDonemOdenenGeciciVergi);

    gt.stokMaliyetOzet = {
      stokHesaplari,
      maliyetHesaplari,
      toplamStok,
      satisMaliyeti,
      kalanStok,
    };
    gt.geciciVergiHesabi = {
      kkeg,
      donemNetKari,
      toplamKar,
      gecmisYilZarari,
      gecicVergiMatrahi,
      gecicVergiOrani,
      hesaplananGeciciVergi,
      oncekiDonemOdenenGeciciVergi,
      oncekiDonemOtomatikToplam,
      oncekiDonemKaynak: manuelOncekiOdenen > 0 ? 'manuel' : 'otomatik',
      odenecekGeciciVergi,
      donemSirasi: mevcutSira, // 1=Q1, 2=Q2, 3=Q3, 4=Q4, 5=Yıllık
    };

    return gt;
  }

  async deleteGelirTablosu(id: string, tenantId: string) {
    const gt = await (this.prisma as any).gelirTablosu.findFirst({ where: { id, tenantId } });
    if (!gt) throw new NotFoundException('Gelir tablosu bulunamadı');
    if (gt.locked) throw new BadRequestException('Kesin kayıtlı gelir tablosu silinemez, önce kilidi açın');
    await (this.prisma as any).gelirTablosu.delete({ where: { id } });
    return { deleted: true };
  }

  async lockGelirTablosu(id: string, tenantId: string, userId: string, note?: string) {
    const gt = await (this.prisma as any).gelirTablosu.findFirst({ where: { id, tenantId } });
    if (!gt) throw new NotFoundException('Gelir tablosu bulunamadı');
    if (gt.locked) throw new BadRequestException('Zaten kesin kayıtlı');
    return (this.prisma as any).gelirTablosu.update({
      where: { id },
      data: {
        locked: true,
        lockedAt: new Date(),
        lockedBy: userId,
        lockNote: note?.slice(0, 500) || null,
      },
    });
  }

  async unlockGelirTablosu(id: string, tenantId: string, userId: string, reason?: string) {
    const gt = await (this.prisma as any).gelirTablosu.findFirst({ where: { id, tenantId } });
    if (!gt) throw new NotFoundException('Gelir tablosu bulunamadı');
    if (!gt.locked) throw new BadRequestException('Zaten açık');
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('Kilidi açmak için sebep belirtmelisiniz (en az 5 karakter)');
    }
    return (this.prisma as any).gelirTablosu.update({
      where: { id },
      data: {
        locked: false,
        lockedAt: null,
        lockedBy: null,
        lockNote: `Kilit açıldı (${new Date().toLocaleString('tr-TR')}): ${reason}`.slice(0, 500),
      },
    });
  }

  /**
   * Manuel düzeltmeleri kaydet. Örnek: 2. dönem için mizana henüz
   * kaydedilmemiş maliyet/gider tahmini.
   * Format:
   *   {
   *     "satisMaliyeti": 150000,
   *     "faaliyetGiderleri": 20000,
   *     "digerGelirler": 0,
   *     ...
   *   }
   */
  async updateDuzeltmeler(
    id: string,
    tenantId: string,
    duzeltmeler: Record<string, number>,
  ) {
    const gt = await (this.prisma as any).gelirTablosu.findFirst({ where: { id, tenantId } });
    if (!gt) throw new NotFoundException('Gelir tablosu bulunamadı');
    if (gt.locked) throw new BadRequestException('Kesin kayıtlı gelir tablosunda düzeltme yapılamaz');

    // Mevcut düzeltmeleri koru, üstüne yeni gelenleri yaz (partial update).
    const cleaned: Record<string, number> = { ...((gt.duzeltmeler as any) || {}) };
    for (const [k, v] of Object.entries(duzeltmeler || {})) {
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
      if (!isFinite(n)) continue;
      if (n === 0) {
        delete cleaned[k];
      } else {
        cleaned[k] = n;
      }
    }

    // Türevleri yeniden hesapla — manuel düzeltme bilançoya / geçici vergiye yansısın
    // effectiveVal: ham (gt[key]) değer üstüne manuel düzeltme eklenir (frontend ile aynı kural)
    const effective = (key: string): number => {
      const base = Number(gt[key]) || 0;
      const adj = cleaned[key];
      return typeof adj === 'number' ? base + adj : base;
    };

    const brutSatislar = effective('brutSatislar');
    const satisIndirimleri = effective('satisIndirimleri');
    const netSatislar = brutSatislar - satisIndirimleri;
    // v1.36.52: SMM için override mantığı — Manuel SMM input SADECE 621'i (Satılan Ticari Mallar Maliyeti) ezer.
    // 620, 622, 623, 740 otomatik kalır. Hizmet firmasında 740 yansır + kullanıcı 621'i elinde girer.
    // Formül: total = baseSMM (otomatik 620+621+622+623+740) - satisMaliyeti621 (ortomatik 621) + manuelSMM
    const manuelSMM = Number((cleaned as any).satisMaliyetiManuel) || 0;
    const auto621 = Number((gt.detay as any)?.satisMaliyeti621) || 0;
    const originalSMM = Number((gt.detay as any)?.satisMal?.toplam);
    const baseSMM = Number.isFinite(originalSMM) ? originalSMM : Number(gt.satisMaliyeti) || 0;
    const satisMaliyeti = manuelSMM > 0 ? (baseSMM - auto621 + manuelSMM) : baseSMM;
    const brutSatisKari = netSatislar - satisMaliyeti;
    const faaliyetGiderleri = effective('faaliyetGiderleri');
    const faaliyetKari = brutSatisKari - faaliyetGiderleri;
    const digerGelirler = effective('digerGelirler');
    const digerGiderler = effective('digerGiderler');
    const finansmanGiderleri = effective('finansmanGiderleri');
    const olaganKar = faaliyetKari + digerGelirler - digerGiderler - finansmanGiderleri;
    const olaganDisiGelir = effective('olaganDisiGelir');
    const olaganDisiGider = effective('olaganDisiGider');
    const donemKari = olaganKar + olaganDisiGelir - olaganDisiGider;
    const vergiKarsiligi = effective('vergiKarsiligi');
    const donemNetKari = donemKari - vergiKarsiligi;

    return (this.prisma as any).gelirTablosu.update({
      where: { id },
      data: {
        duzeltmeler: cleaned,
        // Türev değerler — bilanço, geçici vergi tablosu ve diğer raporlar bu alanları okur
        netSatislar,
        satisMaliyeti,
        brutSatisKari,
        faaliyetKari,
        olaganKar,
        donemNetKari,
      },
    });
  }

  /** Excel export — standart gelir tablosu formatı (3 dönem yan yana hazır değil, tek dönem) */
  async exportToExcel(id: string, tenantId: string): Promise<Buffer> {
    const ExcelJS = await import('exceljs');
    const gt = await this.getGelirTablosu(id, tenantId);
    const wb = new (ExcelJS as any).Workbook();
    const ws = wb.addWorksheet('Gelir Tablosu');

    const taxpayerName =
      gt.taxpayer?.companyName ||
      [gt.taxpayer?.firstName, gt.taxpayer?.lastName].filter(Boolean).join(' ') ||
      'Mükellef';

    wb.creator = 'Moren Mali Müşavirlik';
    wb.created = new Date();
    ws.views = [{ state: 'frozen', ySplit: 5 }];
    ws.columns = [
      { header: 'Kod', key: 'kod', width: 14 },
      { header: 'Kalem', key: 'kalem', width: 66 },
      { header: 'Cari Dönem', key: 'tutar', width: 18 },
      { header: 'Oran %', key: 'oran', width: 12 },
    ];
    ws.autoFilter = 'A5:D5';

    ws.spliceRows(1, 0, [], [], [], []);
    ws.mergeCells('A1:D1');
    ws.getCell('A1').value = 'GELİR TABLOSU';
    ws.mergeCells('A2:D2');
    ws.getCell('A2').value = taxpayerName;
    ws.mergeCells('A3:D3');
    ws.getCell('A3').value = `${gt.donem} · ${gt.donemTipi || 'Dönem'}`;

    for (const addr of ['A1', 'A2', 'A3']) {
      const cell = ws.getCell(addr);
      cell.alignment = { horizontal: 'center' };
      cell.font = { bold: true, size: addr === 'A1' ? 16 : 12, color: { argb: addr === 'A1' ? 'FFD4B876' : 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF11100D' } };
    }

    const netSatis = Number(gt.netSatislar) || 0;
    const pct = (x: number) => (netSatis ? x / netSatis : null);

    type ExportRow = { kod: string; kalem: string; tutar: number; oran: number | null; type?: 'group' | 'total' | 'final' | 'account' };
    const detay = (gt.detay as any) || {};
    const detailKeysByTitle: Record<string, string> = {
      'A. BRÜT SATIŞLAR': 'brutSatis',
      'B. SATIŞ İNDİRİMLERİ (-)': 'satisInd',
      'D. SATIŞLARIN MALİYETİ (-)': 'satisMal',
      'E. FAALİYET GİDERLERİ (-)': 'faalGid',
      'F. DİĞER FAAL. OLAĞAN GELİR VE KARLAR': 'digerGelir',
      'G. DİĞER FAAL. OLAĞAN GİDER VE ZARARLAR (-)': 'digerGider',
      'H. FİNANSMAN GİDERLERİ (-)': 'finansman',
      'I. OLAĞANDIŞI GELİR VE KARLAR': 'olDisiGelir',
      'J. OLAĞANDIŞI GİDER VE ZARARLAR (-)': 'olDisiGider',
      'K. DÖNEM KARI VERGİ VE DİĞER YASAL YÜKÜMLÜLÜK KARŞILIKLARI (-)': 'vergi',
    };
    const detailRowsFor = (item: ExportRow): ExportRow[] => {
      const detailKey = detailKeysByTitle[item.kalem];
      const list = detailKey && Array.isArray(detay?.[detailKey]?.detay) ? detay[detailKey].detay : [];
      return list
        .filter((h: any) => Number(h?.tutar || 0) !== 0)
        .sort((a: any, b: any) => String(a.kod || '').localeCompare(String(b.kod || ''), 'tr'))
        .map((h: any) => ({
          kod: String(h.kod || ''),
          kalem: String(h.hesapAdi || h.ad || h.kod || ''),
          tutar: Number(h.tutar || 0),
          oran: pct(Number(h.tutar || 0)),
          type: 'account' as const,
        }));
    };

    const rows: ExportRow[] = [
      { kod: '', kalem: 'A. BRÜT SATIŞLAR', tutar: Number(gt.brutSatislar), oran: null, type: 'group' },
      { kod: '', kalem: 'B. SATIŞ İNDİRİMLERİ (-)', tutar: Number(gt.satisIndirimleri), oran: null, type: 'group' },
      { kod: '', kalem: 'C. NET SATIŞLAR', tutar: Number(gt.netSatislar), oran: netSatis ? 1 : null, type: 'total' },
      { kod: '', kalem: 'D. SATIŞLARIN MALİYETİ (-)', tutar: Number(gt.satisMaliyeti), oran: null, type: 'group' },
      { kod: '', kalem: 'BRÜT SATIŞ KARI VEYA ZARARI', tutar: Number(gt.brutSatisKari), oran: pct(Number(gt.brutSatisKari)), type: 'total' },
      { kod: '', kalem: 'E. FAALİYET GİDERLERİ (-)', tutar: Number(gt.faaliyetGiderleri), oran: pct(Number(gt.faaliyetGiderleri)), type: 'group' },
      { kod: '', kalem: 'FAALİYET KARI VEYA ZARARI', tutar: Number(gt.faaliyetKari), oran: pct(Number(gt.faaliyetKari)), type: 'total' },
      { kod: '', kalem: 'F. DİĞER FAAL. OLAĞAN GELİR VE KARLAR', tutar: Number(gt.digerGelirler), oran: null, type: 'group' },
      { kod: '', kalem: 'G. DİĞER FAAL. OLAĞAN GİDER VE ZARARLAR (-)', tutar: Number(gt.digerGiderler), oran: null, type: 'group' },
      { kod: '', kalem: 'H. FİNANSMAN GİDERLERİ (-)', tutar: Number(gt.finansmanGiderleri), oran: pct(Number(gt.finansmanGiderleri)), type: 'group' },
      { kod: '', kalem: 'OLAĞAN KAR VEYA ZARAR', tutar: Number(gt.olaganKar), oran: pct(Number(gt.olaganKar)), type: 'total' },
      { kod: '', kalem: 'I. OLAĞANDIŞI GELİR VE KARLAR', tutar: Number(gt.olaganDisiGelir), oran: null, type: 'group' },
      { kod: '', kalem: 'J. OLAĞANDIŞI GİDER VE ZARARLAR (-)', tutar: Number(gt.olaganDisiGider), oran: null, type: 'group' },
      { kod: '', kalem: 'DÖNEM KARI VEYA ZARARI', tutar: Number(gt.donemKari), oran: pct(Number(gt.donemKari)), type: 'total' },
      { kod: '', kalem: 'K. DÖNEM KARI VERGİ VE DİĞER YASAL YÜKÜMLÜLÜK KARŞILIKLARI (-)', tutar: Number(gt.vergiKarsiligi), oran: null, type: 'group' },
      { kod: '', kalem: 'DÖNEM NET KARI VEYA ZARARI', tutar: Number(gt.donemNetKari), oran: pct(Number(gt.donemNetKari)), type: 'final' },
    ];
    const detailedRows: ExportRow[] = [];
    for (const item of rows) {
      detailedRows.push(item);
      detailedRows.push(...detailRowsFor(item));
    }

    const header = ws.getRow(5);
    header.values = ['Kod', 'Kalem', 'Cari Dönem', 'Oran %'];
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

    let rowNo = 6;
    for (const item of detailedRows) {
      const row = ws.getRow(rowNo++);
      row.values = [item.kod, item.kalem, Number.isFinite(item.tutar) ? item.tutar : null, item.oran];
      const isFinal = item.type === 'final';
      const isTotal = item.type === 'total' || isFinal;
      const isAccount = item.type === 'account';
      const isLoss = item.tutar < 0;
      row.height = isFinal ? 25 : isAccount ? 21 : 22;
      row.eachCell((cell: any, col: number) => {
        cell.font = {
          bold: isTotal || item.type === 'group',
          size: isFinal ? 12 : isAccount ? 10 : 11,
          color: {
            argb:
              col === 3 && isLoss
                ? 'FFB91C1C'
                : col === 3 && isTotal
                  ? 'FF047857'
                  : col === 3 && isAccount
                    ? 'FF374151'
                  : col === 2 && isTotal
                    ? 'FF111827'
                    : isAccount
                      ? 'FF374151'
                      : 'FF1F2937',
          },
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: isFinal ? 'FFFFF1C2' : isTotal ? 'FFFFF7E6' : item.type === 'group' ? 'FFF8FAFC' : 'FFFFFFFF' },
        };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        };
        cell.alignment = { horizontal: col >= 3 ? 'right' : 'left', vertical: 'middle', indent: isAccount && col === 2 ? 1 : 0 };
        if (col === 3) cell.numFmt = '#,##0.00;[Red]-#,##0.00';
        if (col === 4) cell.numFmt = '0.00%;[Red]-0.00%';
      });
    }

    const buffer = await wb.xlsx.writeBuffer();
    return buffer as Buffer;
  }
}
