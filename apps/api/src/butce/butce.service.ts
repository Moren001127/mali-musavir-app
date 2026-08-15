import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  donemKaydir,
  kesimVeSonOdeme,
  asgariTutarHesapla,
  odemePlaniHesapla,
  stratejiKarsilastir,
  ekstraOdemeFaydasi,
  PlanKalemi,
  Strateji,
} from './butce-hesap';

/** Prisma Decimal → number */
const num = (v: any): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v.toString());
  return Number.isFinite(n) ? n : 0;
};
const kurus = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

export interface Kimlik {
  tenantId: string;
  userId: string;
}

const bugunDonem = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Yeni kullanıcı için makul başlangıç kategorileri */
const VARSAYILAN_KATEGORILER: Array<{ ad: string; tur: string; zorunlu: boolean; renk: string }> = [
  { ad: 'Maaş / Ücret', tur: 'GELIR', zorunlu: false, renk: '#5ad18a' },
  { ad: 'Serbest Meslek Geliri', tur: 'GELIR', zorunlu: false, renk: '#4fc3a1' },
  { ad: 'Kira Geliri', tur: 'GELIR', zorunlu: false, renk: '#7ad3b0' },
  { ad: 'Diğer Gelir', tur: 'GELIR', zorunlu: false, renk: '#9fe0c4' },
  { ad: 'Kira', tur: 'GIDER', zorunlu: true, renk: '#e0697a' },
  { ad: 'Faturalar (elektrik/su/doğalgaz)', tur: 'GIDER', zorunlu: true, renk: '#e08a6b' },
  { ad: 'Market / Gıda', tur: 'GIDER', zorunlu: true, renk: '#d9a06c' },
  { ad: 'Ulaşım / Yakıt', tur: 'GIDER', zorunlu: true, renk: '#d8ad70' },
  { ad: 'Eğitim', tur: 'GIDER', zorunlu: true, renk: '#8cbde8' },
  { ad: 'Sağlık', tur: 'GIDER', zorunlu: true, renk: '#9da8b7' },
  { ad: 'Yeme-İçme / Eğlence', tur: 'GIDER', zorunlu: false, renk: '#f09aa8' },
  { ad: 'Giyim', tur: 'GIDER', zorunlu: false, renk: '#c9a0dc' },
  { ad: 'Abonelikler', tur: 'GIDER', zorunlu: false, renk: '#b0a0e0' },
  { ad: 'Diğer Gider', tur: 'GIDER', zorunlu: false, renk: '#9c9c9c' },
];

@Injectable()
export class ButceService {
  private readonly logger = new Logger(ButceService.name);
  constructor(private prisma: PrismaService) {}

  private get db(): any {
    return this.prisma as any;
  }

  /* ===================== AYARLAR ===================== */

  async ayarGetir(k: Kimlik) {
    let ayar = await this.db.butceAyar.findFirst({
      where: { tenantId: k.tenantId, userId: k.userId },
    });
    if (!ayar) {
      ayar = await this.db.butceAyar.create({
        data: { tenantId: k.tenantId, userId: k.userId },
      });
      await this.varsayilanKategorileriKur(k);
    }
    return {
      ...ayar,
      nakitYastigi: num(ayar.nakitYastigi),
    };
  }

  async ayarKaydet(k: Kimlik, body: any) {
    await this.ayarGetir(k); // yoksa oluştur
    const data: any = {};
    if (body.nakitYastigi !== undefined) data.nakitYastigi = kurus(Number(body.nakitYastigi));
    if (body.strateji !== undefined) {
      if (!['CIG', 'KARTOPU'].includes(body.strateji)) {
        throw new BadRequestException('strateji CIG veya KARTOPU olmalı');
      }
      data.strateji = body.strateji;
    }
    for (const alan of ['hatirlatmaWhatsapp', 'hatirlatmaPortal', 'hatirlatmaEmail']) {
      if (body[alan] !== undefined) data[alan] = !!body[alan];
    }
    if (body.whatsappNumara !== undefined) data.whatsappNumara = body.whatsappNumara || null;
    if (body.sabahSaati !== undefined) {
      const s = Math.trunc(Number(body.sabahSaati));
      if (!(s >= 0 && s <= 23)) throw new BadRequestException('sabahSaati 0-23 olmalı');
      data.sabahSaati = s;
    }
    await this.db.butceAyar.updateMany({
      where: { tenantId: k.tenantId, userId: k.userId },
      data,
    });
    return this.ayarGetir(k);
  }

  private async varsayilanKategorileriKur(k: Kimlik) {
    const mevcut = await this.db.butceKategori.count({
      where: { tenantId: k.tenantId, userId: k.userId },
    });
    if (mevcut > 0) return;
    await this.db.butceKategori.createMany({
      data: VARSAYILAN_KATEGORILER.map((c, i) => ({
        tenantId: k.tenantId,
        userId: k.userId,
        ad: c.ad,
        tur: c.tur,
        zorunlu: c.zorunlu,
        renk: c.renk,
        sira: i,
      })),
      skipDuplicates: true,
    });
  }

  /* ===================== KATEGORİ ===================== */

  async kategoriler(k: Kimlik) {
    await this.ayarGetir(k);
    return this.db.butceKategori.findMany({
      where: { tenantId: k.tenantId, userId: k.userId },
      orderBy: [{ tur: 'asc' }, { sira: 'asc' }, { ad: 'asc' }],
    });
  }

  async kategoriKaydet(k: Kimlik, body: any, id?: string) {
    if (!body?.ad?.trim()) throw new BadRequestException('ad gerekli');
    if (!['GELIR', 'GIDER'].includes(body.tur)) throw new BadRequestException('tur GELIR|GIDER');
    const data = {
      ad: String(body.ad).trim(),
      tur: body.tur,
      renk: body.renk || null,
      zorunlu: !!body.zorunlu,
      aktif: body.aktif === undefined ? true : !!body.aktif,
      sira: Number(body.sira) || 0,
    };
    if (id) {
      await this.sahiplikDogrula('butceKategori', k, id);
      return this.db.butceKategori.update({ where: { id }, data });
    }
    return this.db.butceKategori.create({
      data: { ...data, tenantId: k.tenantId, userId: k.userId },
    });
  }

  async kategoriSil(k: Kimlik, id: string) {
    await this.sahiplikDogrula('butceKategori', k, id);
    await this.db.butceKategori.delete({ where: { id } });
    return { ok: true };
  }

  /* ===================== İŞLEM (gelir/gider) ===================== */

  async islemler(k: Kimlik, filtre: { donem?: string; tur?: string; kategoriId?: string; kartId?: string }) {
    const where: any = { tenantId: k.tenantId, userId: k.userId };
    if (filtre.donem) where.donem = filtre.donem;
    if (filtre.tur) where.tur = filtre.tur;
    if (filtre.kategoriId) where.kategoriId = filtre.kategoriId;
    if (filtre.kartId) where.kartId = filtre.kartId;
    const kayitlar = await this.db.butceIslem.findMany({
      where,
      orderBy: [{ tarih: 'desc' }, { createdAt: 'desc' }],
      take: 1000,
      include: { kategori: { select: { id: true, ad: true, renk: true, zorunlu: true } } },
    });
    return kayitlar.map((x: any) => ({ ...x, tutar: num(x.tutar) }));
  }

  async islemKaydet(k: Kimlik, body: any, id?: string) {
    const tutar = kurus(Number(body?.tutar));
    if (!(tutar > 0)) throw new BadRequestException('tutar 0’dan büyük olmalı');
    if (!['GELIR', 'GIDER'].includes(body?.tur)) throw new BadRequestException('tur GELIR|GIDER');
    const tarih = body?.tarih ? new Date(body.tarih) : new Date();
    if (isNaN(tarih.getTime())) throw new BadRequestException('tarih geçersiz');
    const donem = `${tarih.getFullYear()}-${String(tarih.getMonth() + 1).padStart(2, '0')}`;

    if (body.kategoriId) await this.sahiplikDogrula('butceKategori', k, body.kategoriId);
    if (body.kartId) await this.sahiplikDogrula('butceKart', k, body.kartId);

    const data: any = {
      tarih,
      donem,
      tur: body.tur,
      tutar,
      kategoriId: body.kategoriId || null,
      aciklama: body.aciklama?.trim() || null,
      kaynak: ['NAKIT', 'BANKA', 'KART'].includes(body.kaynak) ? body.kaynak : 'NAKIT',
      kartId: body.kartId || null,
      planlanan: !!body.planlanan,
    };
    if (id) {
      await this.sahiplikDogrula('butceIslem', k, id);
      const g = await this.db.butceIslem.update({ where: { id }, data });
      return { ...g, tutar: num(g.tutar) };
    }
    const g = await this.db.butceIslem.create({
      data: { ...data, tenantId: k.tenantId, userId: k.userId },
    });
    return { ...g, tutar: num(g.tutar) };
  }

  async islemSil(k: Kimlik, id: string) {
    await this.sahiplikDogrula('butceIslem', k, id);
    await this.db.butceIslem.delete({ where: { id } });
    return { ok: true };
  }

  /* ===================== DÜZENLİ ÖDEMELER ===================== */

  async duzenliler(k: Kimlik) {
    const list = await this.db.butceDuzenliOdeme.findMany({
      where: { tenantId: k.tenantId, userId: k.userId },
      orderBy: [{ aktif: 'desc' }, { tur: 'asc' }, { ayinGunu: 'asc' }],
      include: { kategori: { select: { id: true, ad: true, renk: true } } },
    });
    return list.map((x: any) => ({ ...x, tutar: num(x.tutar) }));
  }

  async duzenliKaydet(k: Kimlik, body: any, id?: string) {
    if (!body?.ad?.trim()) throw new BadRequestException('ad gerekli');
    if (!['GELIR', 'GIDER'].includes(body?.tur)) throw new BadRequestException('tur GELIR|GIDER');
    const tutar = kurus(Number(body?.tutar));
    if (!(tutar > 0)) throw new BadRequestException('tutar 0’dan büyük olmalı');
    const gun = Math.trunc(Number(body?.ayinGunu) || 1);
    if (gun < 1 || gun > 31) throw new BadRequestException('ayinGunu 1-31 olmalı');
    if (body.kategoriId) await this.sahiplikDogrula('butceKategori', k, body.kategoriId);
    if (body.kartId) await this.sahiplikDogrula('butceKart', k, body.kartId);

    const data: any = {
      ad: String(body.ad).trim(),
      tur: body.tur,
      tutar,
      kategoriId: body.kategoriId || null,
      ayinGunu: gun,
      baslangicDonem: body.baslangicDonem || bugunDonem(),
      bitisDonem: body.bitisDonem || null,
      kaynak: ['NAKIT', 'BANKA', 'KART'].includes(body.kaynak) ? body.kaynak : 'NAKIT',
      kartId: body.kartId || null,
      zorunlu: body.zorunlu === undefined ? true : !!body.zorunlu,
      aktif: body.aktif === undefined ? true : !!body.aktif,
    };
    if (id) {
      await this.sahiplikDogrula('butceDuzenliOdeme', k, id);
      return this.db.butceDuzenliOdeme.update({ where: { id }, data });
    }
    return this.db.butceDuzenliOdeme.create({
      data: { ...data, tenantId: k.tenantId, userId: k.userId },
    });
  }

  async duzenliSil(k: Kimlik, id: string) {
    await this.sahiplikDogrula('butceDuzenliOdeme', k, id);
    await this.db.butceDuzenliOdeme.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Düzenli gelir/giderleri verilen döneme "planlanan" işlem olarak yazar.
   * Aynı dönem ikinci kez çalıştırılsa bile kopya üretmez (duzenliId + donem kontrolü).
   */
  async duzenlileriUygula(k: Kimlik, donem = bugunDonem()) {
    const liste = await this.db.butceDuzenliOdeme.findMany({
      where: { tenantId: k.tenantId, userId: k.userId, aktif: true },
    });
    let eklenen = 0;
    for (const d of liste) {
      if (d.baslangicDonem > donem) continue;
      if (d.bitisDonem && d.bitisDonem < donem) continue;
      const varMi = await this.db.butceIslem.count({
        where: { tenantId: k.tenantId, userId: k.userId, duzenliId: d.id, donem },
      });
      if (varMi > 0) continue;
      const [yil, ay] = donem.split('-').map(Number);
      const sonGun = new Date(Date.UTC(yil, ay, 0)).getUTCDate();
      const tarih = new Date(Date.UTC(yil, ay - 1, Math.min(d.ayinGunu, sonGun)));
      await this.db.butceIslem.create({
        data: {
          tenantId: k.tenantId,
          userId: k.userId,
          tarih,
          donem,
          tur: d.tur,
          tutar: d.tutar,
          kategoriId: d.kategoriId,
          aciklama: d.ad,
          kaynak: d.kaynak,
          kartId: d.kartId,
          duzenliId: d.id,
          planlanan: true,
        },
      });
      eklenen++;
      await this.db.butceDuzenliOdeme.update({
        where: { id: d.id },
        data: { sonUretilenDonem: donem },
      });
    }
    return { donem, eklenen };
  }

  /* ===================== KREDİ KARTLARI ===================== */

  async kartlar(k: Kimlik) {
    const liste = await this.db.butceKart.findMany({
      where: { tenantId: k.tenantId, userId: k.userId },
      orderBy: [{ aktif: 'desc' }, { sira: 'asc' }, { bankaAdi: 'asc' }],
      include: {
        ekstreler: { orderBy: { donem: 'desc' }, take: 3 },
      },
    });
    return liste.map((kart: any) => this.kartNormalize(kart));
  }

  private kartNormalize(kart: any) {
    const ekstreler = (kart.ekstreler || []).map((e: any) => this.ekstreNormalize(e));
    const guncel = ekstreler[0] || null;
    const kalanBorc = ekstreler
      .filter((e: any) => e.durum !== 'ODENDI')
      .reduce((t: number, e: any) => t + Math.max((e.borcTutari || 0) - e.odenenTutar, 0), 0);
    return {
      ...kart,
      kartLimiti: num(kart.kartLimiti),
      asgariOran: num(kart.asgariOran),
      aylikFaizOrani: num(kart.aylikFaizOrani),
      gecikmeFaizOrani: num(kart.gecikmeFaizOrani),
      ekstreler,
      guncelEkstre: guncel,
      kalanBorc: kurus(kalanBorc),
      kullanilabilirLimit: kurus(Math.max(num(kart.kartLimiti) - kalanBorc, 0)),
    };
  }

  private ekstreNormalize(e: any) {
    const borc = e.borcTutari === null || e.borcTutari === undefined ? null : num(e.borcTutari);
    const odenen = num(e.odenenTutar);
    return {
      ...e,
      borcTutari: borc,
      asgariTutar: e.asgariTutar === null || e.asgariTutar === undefined ? null : num(e.asgariTutar),
      odenenTutar: odenen,
      kalanTutar: borc === null ? null : kurus(Math.max(borc - odenen, 0)),
    };
  }

  async kartKaydet(k: Kimlik, body: any, id?: string) {
    if (!body?.bankaAdi?.trim()) throw new BadRequestException('bankaAdi gerekli');
    if (!body?.kartAdi?.trim()) throw new BadRequestException('kartAdi gerekli');
    const kesim = Math.trunc(Number(body?.kesimGunu));
    if (!(kesim >= 1 && kesim <= 31)) throw new BadRequestException('kesimGunu 1-31 olmalı');
    const fark = Math.trunc(Number(body?.sonOdemeGunFarki ?? 10));
    if (!(fark >= 0 && fark <= 30)) throw new BadRequestException('sonOdemeGunFarki 0-30 olmalı');

    const data: any = {
      bankaAdi: String(body.bankaAdi).trim(),
      kartAdi: String(body.kartAdi).trim(),
      sonDortHane: String(body.sonDortHane || '').replace(/\D/g, '').slice(-4) || null,
      kartLimiti: kurus(Number(body.kartLimiti) || 0),
      kesimGunu: kesim,
      sonOdemeGunFarki: fark,
      asgariOran: Number(body.asgariOran) || 20,
      aylikFaizOrani: Number(body.aylikFaizOrani) || 4.25,
      gecikmeFaizOrani: Number(body.gecikmeFaizOrani) || 4.75,
      renk: body.renk || null,
      aktif: body.aktif === undefined ? true : !!body.aktif,
      sira: Number(body.sira) || 0,
    };
    if (id) {
      await this.sahiplikDogrula('butceKart', k, id);
      const kart = await this.db.butceKart.update({ where: { id }, data });
      await this.ekstreTarihleriTazele(k, kart);
      return this.kartNormalize({ ...kart, ekstreler: [] });
    }
    const kart = await this.db.butceKart.create({
      data: { ...data, tenantId: k.tenantId, userId: k.userId },
    });
    // Açılışta içinde bulunulan dönemin ekstresi hazırlansın
    await this.ekstreDonemUret(k, kart, bugunDonem());
    return this.kartNormalize({ ...kart, ekstreler: [] });
  }

  async kartSil(k: Kimlik, id: string) {
    await this.sahiplikDogrula('butceKart', k, id);
    await this.db.butceKart.delete({ where: { id } });
    return { ok: true };
  }

  /** Kesim günü/gün farkı değişince ÖDENMEMİŞ ekstrelerin tarihleri güncellenir. */
  private async ekstreTarihleriTazele(k: Kimlik, kart: any) {
    const acikEkstreler = await this.db.butceKartEkstre.findMany({
      where: { tenantId: k.tenantId, kartId: kart.id, durum: { not: 'ODENDI' } },
    });
    for (const e of acikEkstreler) {
      const t = kesimVeSonOdeme(e.donem, kart.kesimGunu, kart.sonOdemeGunFarki);
      if (
        e.kesimTarihi?.getTime() !== t.kesimTarihi.getTime() ||
        e.sonOdemeTarihi?.getTime() !== t.sonOdemeTarihi.getTime()
      ) {
        await this.db.butceKartEkstre.update({
          where: { id: e.id },
          data: { kesimTarihi: t.kesimTarihi, sonOdemeTarihi: t.sonOdemeTarihi },
        });
      }
    }
  }

  /** Bir kart + dönem için ekstre kaydını (yoksa) açar. Cron ve elle ekleme kullanır. */
  async ekstreDonemUret(k: Kimlik, kart: any, donem: string) {
    const t = kesimVeSonOdeme(donem, kart.kesimGunu, kart.sonOdemeGunFarki);
    const mevcut = await this.db.butceKartEkstre.findFirst({
      where: { tenantId: k.tenantId, kartId: kart.id, donem },
    });
    if (mevcut) return this.ekstreNormalize(mevcut);
    const olusan = await this.db.butceKartEkstre.create({
      data: {
        tenantId: k.tenantId,
        userId: k.userId,
        kartId: kart.id,
        donem,
        kesimTarihi: t.kesimTarihi,
        sonOdemeTarihi: t.sonOdemeTarihi,
        durum: 'TUTAR_BEKLENIYOR',
      },
    });
    return this.ekstreNormalize(olusan);
  }

  async ekstreler(k: Kimlik, kartId?: string) {
    const where: any = { tenantId: k.tenantId, userId: k.userId };
    if (kartId) where.kartId = kartId;
    const liste = await this.db.butceKartEkstre.findMany({
      where,
      orderBy: [{ sonOdemeTarihi: 'desc' }],
      take: 60,
      include: { kart: { select: { id: true, bankaAdi: true, kartAdi: true, renk: true } } },
    });
    return liste.map((e: any) => this.ekstreNormalize(e));
  }

  /** Ekstre tutarını girer; asgari tutar otomatik hesaplanır. */
  async ekstreTutarGir(k: Kimlik, id: string, body: any) {
    const ekstre = await this.db.butceKartEkstre.findFirst({
      where: { id, tenantId: k.tenantId, userId: k.userId },
      include: { kart: true },
    });
    if (!ekstre) throw new NotFoundException('Ekstre bulunamadı');
    const borc = kurus(Number(body?.borcTutari));
    if (!(borc >= 0)) throw new BadRequestException('borcTutari geçersiz');
    const asgariOran = num(ekstre.kart.asgariOran) || 20;
    const asgari =
      body?.asgariTutar !== undefined && body?.asgariTutar !== null && body.asgariTutar !== ''
        ? kurus(Number(body.asgariTutar))
        : asgariTutarHesapla(borc, asgariOran);
    const odenen = num(ekstre.odenenTutar);
    const guncel = await this.db.butceKartEkstre.update({
      where: { id },
      data: {
        borcTutari: borc,
        asgariTutar: asgari,
        notlar: body?.notlar ?? ekstre.notlar,
        durum: this.ekstreDurumHesapla(borc, odenen, ekstre.sonOdemeTarihi),
      },
    });
    return this.ekstreNormalize(guncel);
  }

  /** Ekstreye ödeme işler (kısmi ödeme desteklenir). */
  async ekstreOdemeYap(k: Kimlik, id: string, body: any) {
    const ekstre = await this.db.butceKartEkstre.findFirst({
      where: { id, tenantId: k.tenantId, userId: k.userId },
    });
    if (!ekstre) throw new NotFoundException('Ekstre bulunamadı');
    if (ekstre.borcTutari === null) {
      throw new BadRequestException('Önce ekstre borç tutarını girin');
    }
    const borc = num(ekstre.borcTutari);
    const tutar = kurus(Number(body?.tutar));
    if (!(tutar > 0)) throw new BadRequestException('tutar 0’dan büyük olmalı');
    const tarih = body?.tarih ? new Date(body.tarih) : new Date();
    const odenen = kurus(num(ekstre.odenenTutar) + tutar);
    const donem = `${tarih.getFullYear()}-${String(tarih.getMonth() + 1).padStart(2, '0')}`;

    await this.db.butceOdeme.create({
      data: {
        tenantId: k.tenantId,
        userId: k.userId,
        tarih,
        donem,
        tutar,
        hedefTur: 'KART',
        kartEkstreId: id,
        tip: body?.tip || 'NORMAL',
        aciklama: body?.aciklama || null,
      },
    });

    const guncel = await this.db.butceKartEkstre.update({
      where: { id },
      data: {
        odenenTutar: odenen,
        durum: this.ekstreDurumHesapla(borc, odenen, ekstre.sonOdemeTarihi),
        odemeTarihi: odenen >= borc - 0.009 ? tarih : ekstre.odemeTarihi,
      },
    });
    return this.ekstreNormalize(guncel);
  }

  private ekstreDurumHesapla(borc: number | null, odenen: number, sonOdeme: Date): string {
    if (borc === null) return 'TUTAR_BEKLENIYOR';
    if (odenen >= borc - 0.009) return 'ODENDI';
    const gecti = new Date() > new Date(new Date(sonOdeme).getTime() + 86400000);
    if (gecti) return 'GECIKTI';
    if (odenen > 0) return 'KISMI';
    return 'ODENMEDI';
  }

  /* ===================== BORÇLAR (kredi/taksit) ===================== */

  async borclar(k: Kimlik, hepsi = false) {
    const where: any = { tenantId: k.tenantId, userId: k.userId };
    if (!hepsi) where.durum = 'AKTIF';
    const liste = await this.db.butceBorc.findMany({
      where,
      orderBy: [{ durum: 'asc' }, { odemeGunu: 'asc' }],
    });
    return liste.map((b: any) => this.borcNormalize(b));
  }

  private borcNormalize(b: any) {
    const yillik = num(b.yillikFaiz);
    return {
      ...b,
      toplamTutar: num(b.toplamTutar),
      kalanAnapara: num(b.kalanAnapara),
      yillikFaiz: yillik,
      aylikFaiz: kurus(yillik / 12),
      taksitTutari: num(b.taksitTutari),
      erkenKapamaCezasi: b.erkenKapamaCezasi === null ? null : num(b.erkenKapamaCezasi),
      kalanTaksit: Math.max((b.toplamTaksit || 0) - (b.odenenTaksit || 0), 0),
    };
  }

  async borcKaydet(k: Kimlik, body: any, id?: string) {
    if (!body?.ad?.trim()) throw new BadRequestException('ad gerekli');
    const toplam = kurus(Number(body?.toplamTutar));
    const kalan = kurus(Number(body?.kalanAnapara ?? body?.toplamTutar));
    if (!(toplam > 0)) throw new BadRequestException('toplamTutar 0’dan büyük olmalı');
    if (!(kalan >= 0)) throw new BadRequestException('kalanAnapara geçersiz');
    const gun = Math.trunc(Number(body?.odemeGunu) || 1);
    if (gun < 1 || gun > 31) throw new BadRequestException('odemeGunu 1-31 olmalı');

    const data: any = {
      ad: String(body.ad).trim(),
      tur: body.tur || 'DIGER',
      kurum: body.kurum?.trim() || null,
      toplamTutar: toplam,
      kalanAnapara: kalan,
      yillikFaiz: Number(body.yillikFaiz) || 0,
      taksitTutari: kurus(Number(body.taksitTutari) || 0),
      toplamTaksit: Math.trunc(Number(body.toplamTaksit) || 0),
      odenenTaksit: Math.trunc(Number(body.odenenTaksit) || 0),
      odemeGunu: gun,
      baslangicTarihi: body.baslangicTarihi ? new Date(body.baslangicTarihi) : null,
      bitisTarihi: body.bitisTarihi ? new Date(body.bitisTarihi) : null,
      erkenKapamaCezasi:
        body.erkenKapamaCezasi === undefined || body.erkenKapamaCezasi === null || body.erkenKapamaCezasi === ''
          ? null
          : Number(body.erkenKapamaCezasi),
      durum: kalan <= 0 ? 'KAPANDI' : body.durum || 'AKTIF',
      notlar: body.notlar?.trim() || null,
    };
    if (id) {
      await this.sahiplikDogrula('butceBorc', k, id);
      return this.borcNormalize(await this.db.butceBorc.update({ where: { id }, data }));
    }
    return this.borcNormalize(
      await this.db.butceBorc.create({ data: { ...data, tenantId: k.tenantId, userId: k.userId } }),
    );
  }

  async borcSil(k: Kimlik, id: string) {
    await this.sahiplikDogrula('butceBorc', k, id);
    await this.db.butceBorc.delete({ where: { id } });
    return { ok: true };
  }

  /** Borca ödeme işler: kalan anapara düşer, taksit sayacı ilerler, biterse kapanır. */
  async borcOdemeYap(k: Kimlik, id: string, body: any) {
    const borc = await this.db.butceBorc.findFirst({
      where: { id, tenantId: k.tenantId, userId: k.userId },
    });
    if (!borc) throw new NotFoundException('Borç bulunamadı');
    const tutar = kurus(Number(body?.tutar));
    if (!(tutar > 0)) throw new BadRequestException('tutar 0’dan büyük olmalı');
    const tarih = body?.tarih ? new Date(body.tarih) : new Date();
    const donem = `${tarih.getFullYear()}-${String(tarih.getMonth() + 1).padStart(2, '0')}`;
    const yeniKalan = kurus(Math.max(num(borc.kalanAnapara) - tutar, 0));
    const tip = body?.tip || 'NORMAL';

    await this.db.butceOdeme.create({
      data: {
        tenantId: k.tenantId,
        userId: k.userId,
        tarih,
        donem,
        tutar,
        hedefTur: 'BORC',
        borcId: id,
        tip,
        aciklama: body?.aciklama || null,
      },
    });

    const guncel = await this.db.butceBorc.update({
      where: { id },
      data: {
        kalanAnapara: yeniKalan,
        odenenTaksit: tip === 'EKSTRA' ? borc.odenenTaksit : Math.min(borc.odenenTaksit + 1, borc.toplamTaksit || borc.odenenTaksit + 1),
        durum: yeniKalan <= 0 ? 'KAPANDI' : 'AKTIF',
      },
    });
    return this.borcNormalize(guncel);
  }

  async odemeler(k: Kimlik, donem?: string) {
    const where: any = { tenantId: k.tenantId, userId: k.userId };
    if (donem) where.donem = donem;
    const liste = await this.db.butceOdeme.findMany({
      where,
      orderBy: { tarih: 'desc' },
      take: 500,
      include: {
        borc: { select: { id: true, ad: true } },
        kartEkstre: { select: { id: true, donem: true, kart: { select: { bankaAdi: true, kartAdi: true } } } },
      },
    });
    return liste.map((o: any) => ({ ...o, tutar: num(o.tutar) }));
  }

  /* ===================== ÖZET / GENEL BAKIŞ ===================== */

  async ozet(k: Kimlik, donem = bugunDonem()) {
    const ayar = await this.ayarGetir(k);
    const [islemler, kartlar, borclar, ekstreler] = await Promise.all([
      this.islemler(k, { donem }),
      this.kartlar(k),
      this.borclar(k),
      this.yaklasanEkstreler(k),
    ]);

    const gelir = kurus(islemler.filter((i: any) => i.tur === 'GELIR').reduce((t: number, i: any) => t + i.tutar, 0));
    const gider = kurus(islemler.filter((i: any) => i.tur === 'GIDER').reduce((t: number, i: any) => t + i.tutar, 0));
    // Kartla yapılan harcama o ay nakit çıkışı DEĞİLDİR; kart borcunu büyütür ve
    // ekstre ödendiğinde nakitten çıkar. Nakit akışı uyarıları bu ayrımı kullanır.
    const kartGideri = kurus(
      islemler
        .filter((i: any) => i.tur === 'GIDER' && i.kaynak === 'KART')
        .reduce((t: number, i: any) => t + i.tutar, 0),
    );
    const nakitGider = kurus(gider - kartGideri);
    const zorunluGider = kurus(
      islemler
        .filter((i: any) => i.tur === 'GIDER' && i.kategori?.zorunlu)
        .reduce((t: number, i: any) => t + i.tutar, 0),
    );

    const kartBorcu = kurus(kartlar.reduce((t: number, kk: any) => t + kk.kalanBorc, 0));
    const krediBorcu = kurus(borclar.reduce((t: number, b: any) => t + b.kalanAnapara, 0));

    // Kategori kırılımı (gider)
    const kategoriMap = new Map<string, { ad: string; renk: string; tutar: number; zorunlu: boolean }>();
    for (const i of islemler as any[]) {
      if (i.tur !== 'GIDER') continue;
      const ad = i.kategori?.ad || 'Kategorisiz';
      const kayit = kategoriMap.get(ad) || {
        ad,
        renk: i.kategori?.renk || '#9c9c9c',
        tutar: 0,
        zorunlu: !!i.kategori?.zorunlu,
      };
      kayit.tutar = kurus(kayit.tutar + i.tutar);
      kategoriMap.set(ad, kayit);
    }

    // Son 6 ay trendi
    const trend: Array<{ donem: string; gelir: number; gider: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const d = donemKaydir(donem, -i);
      const kayitlar = await this.db.butceIslem.groupBy({
        by: ['tur'],
        where: { tenantId: k.tenantId, userId: k.userId, donem: d },
        _sum: { tutar: true },
      });
      const g = kayitlar.find((x: any) => x.tur === 'GELIR');
      const gd = kayitlar.find((x: any) => x.tur === 'GIDER');
      trend.push({ donem: d, gelir: num(g?._sum?.tutar), gider: num(gd?._sum?.tutar) });
    }

    const uyarilar = await this.uyarilar(k, { ekstreler, gelir, gider: nakitGider, borclar, kartlar });

    return {
      donem,
      gelir,
      gider,
      kartGideri,
      nakitGider,
      net: kurus(gelir - gider),
      nakitNet: kurus(gelir - nakitGider),
      zorunluGider,
      istegeBagliGider: kurus(gider - zorunluGider),
      nakitYastigi: ayar.nakitYastigi,
      borcOzet: {
        kart: kartBorcu,
        kredi: krediBorcu,
        toplam: kurus(kartBorcu + krediBorcu),
        aylikZorunluOdeme: kurus(
          kartlar.reduce(
            (t: number, kk: any) =>
              t + (kk.guncelEkstre?.asgariTutar || asgariTutarHesapla(kk.kalanBorc, num(kk.asgariOran))),
            0,
          ) + borclar.reduce((t: number, b: any) => t + b.taksitTutari, 0),
        ),
      },
      kategoriKirilim: Array.from(kategoriMap.values()).sort((a, b) => b.tutar - a.tutar),
      trend,
      yaklasanOdemeler: ekstreler,
      uyarilar,
    };
  }

  /** Önümüzdeki 30 gün + geciken ekstreler ve kredi taksitleri */
  async yaklasanEkstreler(k: Kimlik) {
    const simdi = new Date();
    const bitis = new Date(simdi.getTime() + 30 * 86400000);
    const ekstreler = await this.db.butceKartEkstre.findMany({
      where: {
        tenantId: k.tenantId,
        userId: k.userId,
        durum: { not: 'ODENDI' },
        sonOdemeTarihi: { lte: bitis },
      },
      orderBy: { sonOdemeTarihi: 'asc' },
      include: { kart: { select: { id: true, bankaAdi: true, kartAdi: true, renk: true } } },
    });
    return ekstreler.map((e: any) => {
      const n = this.ekstreNormalize(e);
      const kalanGun = Math.ceil(
        (new Date(e.sonOdemeTarihi).getTime() - new Date(simdi.toDateString()).getTime()) / 86400000,
      );
      return { ...n, kalanGun };
    });
  }

  private async uyarilar(
    k: Kimlik,
    ctx: { ekstreler: any[]; gelir: number; gider: number; borclar: any[]; kartlar: any[] },
  ) {
    const list: Array<{ seviye: 'KRITIK' | 'UYARI' | 'BILGI'; baslik: string; mesaj: string }> = [];

    for (const e of ctx.ekstreler) {
      const kartAdi = `${e.kart?.bankaAdi || ''} ${e.kart?.kartAdi || ''}`.trim();
      if (e.durum === 'GECIKTI') {
        list.push({
          seviye: 'KRITIK',
          baslik: `${kartAdi} — son ödeme geçti`,
          mesaj: `${e.donem} dönemi ödenmedi. Gecikme faizi işliyor; en kısa sürede en az asgari tutarı ödeyin.`,
        });
      } else if (e.borcTutari === null && e.kalanGun <= 20) {
        list.push({
          seviye: 'UYARI',
          baslik: `${kartAdi} — ekstre tutarı girilmedi`,
          mesaj: `${e.donem} ekstresi kesildi ama borç tutarı girilmemiş. Plan bu kart olmadan hesaplanıyor.`,
        });
      } else if (e.kalanGun <= 3 && e.durum !== 'ODENDI') {
        list.push({
          seviye: 'UYARI',
          baslik: `${kartAdi} — son ödeme ${e.kalanGun} gün sonra`,
          mesaj: `Kalan ${e.kalanTutar?.toLocaleString('tr-TR')} TL. Son ödeme ${new Date(e.sonOdemeTarihi).toLocaleDateString('tr-TR')}.`,
        });
      }
    }

    if (ctx.gider > ctx.gelir && ctx.gelir > 0) {
      list.push({
        seviye: 'KRITIK',
        baslik: 'Bu ay nakit gideriniz gelirinizi aştı',
        mesaj: `Açık: ${kurus(ctx.gider - ctx.gelir).toLocaleString('tr-TR')} TL (kart harcamaları hariç). Borç ödemeleri için kapasite kalmıyor.`,
      });
    }

    const yuksekFaiz = ctx.kartlar.filter((kk: any) => kk.kalanBorc > 0);
    if (yuksekFaiz.length > 0) {
      list.push({
        seviye: 'BILGI',
        baslik: 'Kart borcu en pahalı borçtur',
        mesaj: 'Kredi kartı faizi kredilerin çok üstündedir. Fazladan her lirayı önce kart borcuna yönlendirmek en fazla faydayı sağlar.',
      });
    }

    return list;
  }

  /* ===================== ÖDEME PLANI ===================== */

  /** Borç kalemlerini (kart + kredi) simülasyon girdisine çevirir. */
  private async planKalemleri(k: Kimlik): Promise<PlanKalemi[]> {
    const [kartlar, borclar] = await Promise.all([this.kartlar(k), this.borclar(k)]);
    const kalemler: PlanKalemi[] = [];
    for (const kk of kartlar as any[]) {
      if (kk.kalanBorc > 0) {
        kalemler.push({
          id: `kart:${kk.id}`,
          ad: `${kk.bankaAdi} ${kk.kartAdi}`,
          tip: 'KART',
          kalan: kk.kalanBorc,
          aylikFaiz: (kk.aylikFaizOrani || 0) / 100,
          asgariOran: (kk.asgariOran || 20) / 100,
        });
      }
    }
    for (const b of borclar as any[]) {
      if (b.kalanAnapara > 0) {
        kalemler.push({
          id: `borc:${b.id}`,
          ad: b.ad,
          tip: 'KREDI',
          kalan: b.kalanAnapara,
          aylikFaiz: (b.yillikFaiz || 0) / 100 / 12,
          taksitTutari: b.taksitTutari,
        });
      }
    }
    return kalemler;
  }

  /**
   * Ödeme planı: aylık kapasiteyi hesaplar, iki stratejiyi karşılaştırır,
   * bu ay hangi borca ne kadar ödeneceğini çıkarır.
   *
   * Kapasite = (gelir − gider) veya kullanıcı elle verirse o tutar. Gider içinde
   * zaten borç ödemeleri varsa çift saymamak için borç ödemeleri gider sayılmaz;
   * bu yüzden kapasite "gelir − borç dışı gider − nakit yastığı" olarak alınır.
   */
  async plan(k: Kimlik, opts: { donem?: string; kapasite?: number; strateji?: Strateji } = {}) {
    const donem = opts.donem || bugunDonem();
    const ayar = await this.ayarGetir(k);
    const islemler = await this.islemler(k, { donem });
    const gelir = kurus(islemler.filter((i: any) => i.tur === 'GELIR').reduce((t: number, i: any) => t + i.tutar, 0));
    // Borç/kart ödemeleri "gider" olarak da girilmiş olabilir; kaynak=KART olanlar
    // kart borcunu büyüttüğü için kapasiteden düşülmez (zaten ekstrede sayılıyor).
    const gider = kurus(
      islemler
        .filter((i: any) => i.tur === 'GIDER' && i.kaynak !== 'KART')
        .reduce((t: number, i: any) => t + i.tutar, 0),
    );
    const otomatikKapasite = kurus(Math.max(gelir - gider - ayar.nakitYastigi, 0));
    const kapasite =
      opts.kapasite !== undefined && opts.kapasite !== null && !Number.isNaN(Number(opts.kapasite))
        ? kurus(Number(opts.kapasite))
        : otomatikKapasite;

    const kalemler = await this.planKalemleri(k);
    const karsilastirma = stratejiKarsilastir({ aylikKapasite: kapasite, kalemler });
    const strateji: Strateji = opts.strateji || (ayar.strateji as Strateji) || 'CIG';
    const secilen = strateji === 'KARTOPU' ? karsilastirma.kartopu : karsilastirma.cig;

    // "Elimde X fazla var, nereye koyayım?" için fayda sıralaması
    const kapanisAy = new Map(secilen.kapanisSirasi.map((x) => [x.id, x.ay]));
    const fayda = ekstraOdemeFaydasi(kalemler, kapasite > 0 ? kapasite : 1000, (kalem) =>
      kapanisAy.get(kalem.id) ?? 12,
    );

    return {
      donem,
      gelir,
      gider,
      nakitYastigi: ayar.nakitYastigi,
      otomatikKapasite,
      kapasite,
      strateji,
      kalemler,
      secilen,
      karsilastirma,
      fayda,
      not: 'Faiz hesapları tahminidir; banka yöntemi (gün sayısı, KKDF/BSMV) farklılık gösterebilir.',
    };
  }

  /** Belirli bir ekstra tutar için "hangi borca koyayım" analizi */
  async faydaAnalizi(k: Kimlik, tutar: number) {
    const kalemler = await this.planKalemleri(k);
    const ayar = await this.ayarGetir(k);
    const plan = odemePlaniHesapla({
      aylikKapasite: 0,
      kalemler,
      strateji: (ayar.strateji as Strateji) || 'CIG',
      maxAy: 240,
    });
    const kapanisAy = new Map(plan.kapanisSirasi.map((x) => [x.id, x.ay]));
    return {
      tutar: kurus(tutar),
      siralama: ekstraOdemeFaydasi(kalemler, tutar, (kalem) => kapanisAy.get(kalem.id) ?? 12),
    };
  }

  /* ===================== ORTAK ===================== */

  private async sahiplikDogrula(model: string, k: Kimlik, id: string) {
    const kayit = await this.db[model].findFirst({
      where: { id, tenantId: k.tenantId, userId: k.userId },
      select: { id: true },
    });
    if (!kayit) throw new NotFoundException('Kayıt bulunamadı');
    return kayit;
  }
}
