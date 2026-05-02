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
    // D. Satışların Maliyeti (620, 621, 622, 623 + 740 7/A)
    const satisMal = giderBy(['620', '621', '622', '623', '740']);
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
    const toplamStok = stokHesaplari.reduce((s, h) => s + h.bakiye, 0);

    const maliyetHesaplari = [
      tekHesap('720'), // Direkt İlk Madde Malzeme Gideri
      tekHesap('721'), // Direkt İlk Madde Malzeme Gideri Yansıtma (-)
      tekHesap('730'), // Genel Üretim Giderleri
      tekHesap('731'), // Genel Üretim Giderleri Yansıtma (-)
    ];

    // Kalan Stok = Toplam Stok - Satılan Malın Maliyeti (satisMal.toplam)
    const kalanStok = toplamStok - satisMal.toplam;

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
      select: { id: true, firstName: true, lastName: true, companyName: true },
    });
    gt.taxpayer = tp || null;

    // ── STOK & MALİYET (backend tarafında detay JSON'a kayıt edildi) ─────
    const detay = (gt.detay as any) || {};
    const duzeltmeler = (gt.duzeltmeler as any) || {};
    const stokHesaplari = Array.isArray(detay.stokHesaplari) ? detay.stokHesaplari : [];
    const maliyetHesaplari = Array.isArray(detay.maliyetHesaplari) ? detay.maliyetHesaplari : [];
    const toplamStok = Number(detay.toplamStok || 0);
    // Satılan Malın Maliyeti: kullanıcının gelir tablosunda manuel girdiği değer
    // (duzeltmeler.satisMaliyetiManuel) varsa onu kullan, yoksa 621 bakiyesi.
    // Eğer manuel girilmemişse 0 göster — çünkü 153 bakiyesi zaten maliyet düşülmüş halde geliyor.
    const satisMaliyetiManuel = Number(duzeltmeler.satisMaliyetiManuel || 0);
    const satisMaliyeti = satisMaliyetiManuel > 0 ? satisMaliyetiManuel : Number(gt.satisMaliyeti || 0);
    // Kalan Stok = mizandaki 150-157 toplam bakiyesi (zaten net, maliyet düşülmüş)
    const kalanStok = toplamStok;
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
        const dHesap = dMatrah * 0.25;
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
    const gecicVergiOrani = 0.25; // %25 kurumlar vergisi oranı (2026)
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
    // İzinli alanlar: gelir tablosu kalemleri + vergi matrahı manuel alanları.
    const cleaned: Record<string, number> = { ...((gt.duzeltmeler as any) || {}) };
    for (const [k, v] of Object.entries(duzeltmeler || {})) {
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
      if (!isFinite(n)) continue;
      if (n === 0) {
        delete cleaned[k]; // sıfır gelirse o key'i temizle
      } else {
        cleaned[k] = n;
      }
    }

    return (this.prisma as any).gelirTablosu.update({
      where: { id },
      data: { duzeltmeler: cleaned },
    });
  }

  /** Excel export — standart gelir tablosu formatı (3 dönem yan yana hazır değil, tek dönem) */
  async exportToExcel(id: string, tenantId: string): Promise<Buffer> {
    const gt = await this.getGelirTablosu(id, tenantId);
    const xlsx = await import('xlsx');

    const netSatis = Number(gt.netSatislar) || 1;
    const pct = (x: number) => (x / netSatis) * 100;

    const rows: any[] = [
      ['Kod', 'Kalem', 'Cari Dönem', 'Oran %'],
      ['', 'A. BRÜT SATIŞLAR', Number(gt.brutSatislar), ''],
      ['', 'B. SATIŞ İNDİRİMLERİ (-)', Number(gt.satisIndirimleri), ''],
      ['', 'C. NET SATIŞLAR', Number(gt.netSatislar), 100],
      ['', 'D. SATIŞLARIN MALİYETİ (-)', Number(gt.satisMaliyeti), ''],
      ['', 'BRÜT SATIŞ KARI VEYA ZARARI', Number(gt.brutSatisKari), pct(Number(gt.brutSatisKari))],
      ['', 'E. FAALİYET GİDERLERİ (-)', Number(gt.faaliyetGiderleri), pct(Number(gt.faaliyetGiderleri))],
      ['', 'FAALİYET KARI VEYA ZARARI', Number(gt.faaliyetKari), pct(Number(gt.faaliyetKari))],
      ['', 'F. DİĞER FAAL. OLAĞAN GELİR VE KARLAR', Number(gt.digerGelirler), ''],
      ['', 'G. DİĞER FAAL. OLAĞAN GİDER VE ZARARLAR (-)', Number(gt.digerGiderler), ''],
      ['', 'H. FİNANSMAN GİDERLERİ (-)', Number(gt.finansmanGiderleri), pct(Number(gt.finansmanGiderleri))],
      ['', 'OLAĞAN KAR VEYA ZARAR', Number(gt.olaganKar), pct(Number(gt.olaganKar))],
      ['', 'I. OLAĞANDIŞI GELİR VE KARLAR', Number(gt.olaganDisiGelir), ''],
      ['', 'J. OLAĞANDIŞI GİDER VE ZARARLAR (-)', Number(gt.olaganDisiGider), ''],
      ['', 'DÖNEM KARI VEYA ZARARI', Number(gt.donemKari), pct(Number(gt.donemKari))],
      ['', 'K. DÖNEM KARI VERGİ VE DİĞER YASAL YÜKÜMLÜLÜK KARŞILIKLARI (-)', Number(gt.vergiKarsiligi), ''],
      ['', 'DÖNEM NET KARI VEYA ZARARI', Number(gt.donemNetKari), pct(Number(gt.donemNetKari))],
    ];

    const ws = xlsx.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 8 }, { wch: 52 }, { wch: 18 }, { wch: 10 }];
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Gelir Tablosu');
    return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }
}
