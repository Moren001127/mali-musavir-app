import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  donemKaydir,
  kesimVeSonOdeme,
  ekstreHarcamaAraligi,
  donemIciAralik,
  asgariTutarHesapla,
  odemePlaniHesapla,
  stratejiKarsilastir,
  ekstraOdemeFaydasi,
  kmhBorcKalemi,
  PlanKalemi,
  Strateji,
} from './butce-hesap';
import { nakitAkisiHesapla, akisOnerileri, AkisHareketi } from './butce-nakit-akis';
import { ButcePinService } from './butce-pin.service';

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

/**
 * ŞAHIS FİRMASI MODELİ — ayrım yalnız GİDER tarafındadır.
 *
 * Ofisin geliri zaten sahibinin geliridir; gelirleri ikiye bölmek gerçeğe aykırı
 * ve gereksizdi ("ofisten çekiş" diye olmayan bir işlem uydurmak zorunda kalıyorduk).
 * Anlamlı olan ayrım gider tarafında:
 *   OFIS   = mesleki gider  → kazançtan indirilir (kira, personel, SGK, yazılım)
 *   SAHSI  = kişisel gider  → indirilemez (market, giyim, ev kirası)
 * Böylece iki soru aynı anda cevaplanır: "kazancım ne" ve "elimde ne kaldı".
 */
export type Defter = 'SAHSI' | 'OFIS';
export type DefterSecim = Defter | 'TUMU';

const DEFTERLER: Defter[] = ['SAHSI', 'OFIS'];

const bugunDonem = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const defterWhere = (defter?: DefterSecim) => (!defter || defter === 'TUMU' ? {} : { defter });

/** Yeni kullanıcı için hazır kategoriler — her defter ayrı */
const VARSAYILAN_KATEGORILER: Array<{
  defter: Defter;
  ad: string;
  tur: string;
  zorunlu: boolean;
  renk: string;
}> = [
  // GELİRLER TEK HAVUZ (defter ayrımı gelirde yok; hepsi aynı listede görünür)
  { defter: 'OFIS', ad: 'Müşavirlik Ücreti', tur: 'GELIR', zorunlu: false, renk: '#5ad18a' },
  { defter: 'OFIS', ad: 'Danışmanlık / Rapor', tur: 'GELIR', zorunlu: false, renk: '#4fc3a1' },
  { defter: 'OFIS', ad: 'Kira Geliri', tur: 'GELIR', zorunlu: false, renk: '#7ad3b0' },
  { defter: 'OFIS', ad: 'Diğer Gelir', tur: 'GELIR', zorunlu: false, renk: '#9fe0c4' },
  { defter: 'SAHSI', ad: 'Ev Kirası', tur: 'GIDER', zorunlu: true, renk: '#e0697a' },
  { defter: 'SAHSI', ad: 'Faturalar (elektrik/su/doğalgaz)', tur: 'GIDER', zorunlu: true, renk: '#e08a6b' },
  { defter: 'SAHSI', ad: 'Market / Gıda', tur: 'GIDER', zorunlu: true, renk: '#d9a06c' },
  { defter: 'SAHSI', ad: 'Ulaşım / Yakıt', tur: 'GIDER', zorunlu: true, renk: '#d8ad70' },
  { defter: 'SAHSI', ad: 'Eğitim', tur: 'GIDER', zorunlu: true, renk: '#8cbde8' },
  { defter: 'SAHSI', ad: 'Sağlık', tur: 'GIDER', zorunlu: true, renk: '#9da8b7' },
  { defter: 'SAHSI', ad: 'Yeme-İçme / Eğlence', tur: 'GIDER', zorunlu: false, renk: '#f09aa8' },
  { defter: 'SAHSI', ad: 'Giyim', tur: 'GIDER', zorunlu: false, renk: '#c9a0dc' },
  { defter: 'SAHSI', ad: 'Abonelikler', tur: 'GIDER', zorunlu: false, renk: '#b0a0e0' },
  { defter: 'SAHSI', ad: 'Diğer Gider', tur: 'GIDER', zorunlu: false, renk: '#9c9c9c' },
  { defter: 'OFIS', ad: 'Ofis Kirası', tur: 'GIDER', zorunlu: true, renk: '#e0697a' },
  { defter: 'OFIS', ad: 'Personel Maaşı', tur: 'GIDER', zorunlu: true, renk: '#e08a6b' },
  { defter: 'OFIS', ad: 'SGK / Vergi', tur: 'GIDER', zorunlu: true, renk: '#d9a06c' },
  { defter: 'OFIS', ad: 'Oda / TÜRMOB Aidatı', tur: 'GIDER', zorunlu: true, renk: '#d8ad70' },
  { defter: 'OFIS', ad: 'Yazılım / Abonelik', tur: 'GIDER', zorunlu: true, renk: '#8cbde8' },
  { defter: 'OFIS', ad: 'Ofis Faturaları', tur: 'GIDER', zorunlu: true, renk: '#9da8b7' },
  { defter: 'OFIS', ad: 'Kırtasiye / Sarf', tur: 'GIDER', zorunlu: false, renk: '#b0a0e0' },
  { defter: 'OFIS', ad: 'Ulaşım / Yakıt (ofis)', tur: 'GIDER', zorunlu: false, renk: '#c9a0dc' },
  { defter: 'OFIS', ad: 'Temsil / Ağırlama', tur: 'GIDER', zorunlu: false, renk: '#f09aa8' },
  { defter: 'OFIS', ad: 'Demirbaş / Yatırım', tur: 'GIDER', zorunlu: false, renk: '#e6c878' },
  { defter: 'OFIS', ad: 'Diğer Ofis Gideri', tur: 'GIDER', zorunlu: false, renk: '#9c9c9c' },
];

/**
 * Bir kartın bu ay ödemesi gereken en az tutar.
 * Borç kapandıysa 0; kısmi ödeme yapıldıysa kalan asgari.
 * Özet ile ödeme planı AYNI fonksiyonu kullanır ki iki ekran çelişmesin.
 */
function kartZorunluOdeme(kart: any): number {
  const kalan = Math.max(Number(kart.ekstreBorcu) || 0, 0);
  if (kalan <= 0) return 0;
  const ekstre = kart.borcEkstresi || kart.guncelEkstre;
  const asgari = ekstre?.asgariTutar
    ? Number(ekstre.asgariTutar)
    : asgariTutarHesapla(kalan, Number(kart.asgariOran) || 20);
  const odenen = Number(ekstre?.odenenTutar) || 0;
  return Math.round(Math.max(Math.min(asgari - odenen, kalan), 0) * 100) / 100;
}

@Injectable()
export class ButceService {
  private readonly logger = new Logger(ButceService.name);
  constructor(private prisma: PrismaService) {}

  private get db(): any {
    return this.prisma as any;
  }

  private defterDogrula(d: any, varsayilan: Defter = 'SAHSI'): Defter {
    return DEFTERLER.includes(d) ? d : varsayilan;
  }

  /* ===================== AYARLAR ===================== */

  async ayarGetir(k: Kimlik) {
    let ayar = await this.db.butceAyar.findFirst({
      where: { tenantId: k.tenantId, userId: k.userId },
    });
    if (!ayar) {
      ayar = await this.db.butceAyar.create({ data: { tenantId: k.tenantId, userId: k.userId } });
    }
    // PIN özeti ve deneme sayacı istemciye GİTMEZ (ayar ucu tarayıcıya açık)
    return { ...ButcePinService.pinAlanlariniAyikla(ayar), nakitYastigi: num(ayar.nakitYastigi) };
  }

  async ayarKaydet(k: Kimlik, body: any) {
    await this.ayarGetir(k);
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
    await this.db.butceAyar.updateMany({ where: { tenantId: k.tenantId, userId: k.userId }, data });
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
        defter: c.defter,
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

  async kategoriler(k: Kimlik, defter?: DefterSecim) {
    await this.ayarGetir(k);
    await this.varsayilanKategorileriKur(k);
    return this.db.butceKategori.findMany({
      where: { tenantId: k.tenantId, userId: k.userId, ...defterWhere(defter) },
      orderBy: [{ defter: 'asc' }, { tur: 'asc' }, { sira: 'asc' }, { ad: 'asc' }],
    });
  }

  async kategoriKaydet(k: Kimlik, body: any, id?: string) {
    if (!body?.ad?.trim()) throw new BadRequestException('ad gerekli');
    if (!['GELIR', 'GIDER'].includes(body.tur)) throw new BadRequestException('tur GELIR|GIDER');
    const data = {
      defter: this.defterDogrula(body.defter),
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
    return this.db.butceKategori.create({ data: { ...data, tenantId: k.tenantId, userId: k.userId } });
  }

  /**
   * Hazır kategori setini ekler (var olanlara dokunmaz).
   * varsayilanKategorileriKur yalnız liste TAMAMEN boşken çalışır; kullanıcı bir
   * kategori eklemişse hazır set hiç gelmiyordu ve ofis kategorileri eksik kalıyordu.
   */
  async hazirKategorileriEkle(k: Kimlik) {
    const oncesi = await this.db.butceKategori.count({
      where: { tenantId: k.tenantId, userId: k.userId },
    });
    await this.db.butceKategori.createMany({
      data: VARSAYILAN_KATEGORILER.map((c, i) => ({
        tenantId: k.tenantId,
        userId: k.userId,
        defter: c.defter,
        ad: c.ad,
        tur: c.tur,
        zorunlu: c.zorunlu,
        renk: c.renk,
        sira: i,
      })),
      skipDuplicates: true,
    });
    const sonrasi = await this.db.butceKategori.count({
      where: { tenantId: k.tenantId, userId: k.userId },
    });
    return { eklenen: sonrasi - oncesi, toplam: sonrasi };
  }

  async kategoriSil(k: Kimlik, id: string) {
    await this.sahiplikDogrula('butceKategori', k, id);
    const kullanim = await this.db.butceIslem.count({
      where: { tenantId: k.tenantId, userId: k.userId, kategoriId: id },
    });
    if (kullanim > 0) {
      // Geçmiş kayıtlar kategorisiz kalmasın: siliniyor değil pasife alınıyor
      await this.db.butceKategori.update({ where: { id }, data: { aktif: false } });
      return { ok: true, pasifeAlindi: true, kullanim };
    }
    await this.db.butceKategori.delete({ where: { id } });
    return { ok: true, pasifeAlindi: false };
  }

  /* ===================== BANKA HESAPLARI ===================== */

  async bankaHesaplar(k: Kimlik) {
    const hesaplar = await this.db.butceBankaHesap.findMany({
      where: { tenantId: k.tenantId, userId: k.userId },
      orderBy: [{ aktif: 'desc' }, { sira: 'asc' }, { bankaAdi: 'asc' }],
    });
    const cikti: any[] = [];
    for (const h of hesaplar) cikti.push(await this.bankaHesapNormalize(k, h));
    return cikti;
  }

  /**
   * Bakiye = açılış + hesaba giren gelirler − hesaptan çıkan giderler − hesaptan yapılan ödemeler.
   * Kart harcaması bakiyeye dokunmaz (nakit çıkışı değil, kart borcu).
   */
  private async bankaHesapNormalize(k: Kimlik, h: any) {
    const [gelir, gider, odeme] = await Promise.all([
      this.db.butceIslem.aggregate({
        where: { tenantId: k.tenantId, userId: k.userId, bankaHesapId: h.id, tur: 'GELIR', planlanan: false },
        _sum: { tutar: true },
      }),
      this.db.butceIslem.aggregate({
        // kaynak !== KART: kart harcaması banka bakiyesinden düşmez (karta borçlanmadır)
        where: {
          tenantId: k.tenantId,
          userId: k.userId,
          bankaHesapId: h.id,
          tur: 'GIDER',
          planlanan: false,
          kaynak: { not: 'KART' },
        },
        _sum: { tutar: true },
      }),
      this.db.butceOdeme.aggregate({
        where: { tenantId: k.tenantId, userId: k.userId, bankaHesapId: h.id },
        _sum: { tutar: true },
      }),
    ]);

    const acilis = num(h.acilisBakiye);
    const bakiye = kurus(acilis + num(gelir._sum.tutar) - num(gider._sum.tutar) - num(odeme._sum.tutar));
    const kmhLimiti = num(h.kmhLimiti);
    const kmhBorcu = bakiye < 0 ? kurus(-bakiye) : 0;

    return {
      ...h,
      acilisBakiye: acilis,
      kmhLimiti,
      kmhAylikFaiz: num(h.kmhAylikFaiz),
      bakiye,
      kmhBorcu,
      kmhKalanLimit: kurus(Math.max(kmhLimiti - kmhBorcu, 0)),
      kmhDoluluk: kmhLimiti > 0 ? Math.min(Math.round((kmhBorcu / kmhLimiti) * 100), 100) : 0,
      kullanilabilir: kurus(bakiye + Math.max(kmhLimiti - kmhBorcu, 0)),
    };
  }

  async bankaHesapKaydet(k: Kimlik, body: any, id?: string) {
    if (!body?.ad?.trim()) throw new BadRequestException('ad gerekli');
    if (!body?.bankaAdi?.trim()) throw new BadRequestException('bankaAdi gerekli');
    const tur = body.tur === 'KMH' ? 'KMH' : 'VADESIZ';
    const data: any = {
      varsayilanDefter: this.defterDogrula(body.varsayilanDefter),
      ad: String(body.ad).trim(),
      bankaAdi: String(body.bankaAdi).trim(),
      iban4: String(body.iban4 || '').replace(/\D/g, '').slice(-4) || null,
      tur,
      acilisBakiye: kurus(Number(body.acilisBakiye) || 0),
      acilisTarihi: body.acilisTarihi ? new Date(body.acilisTarihi) : null,
      kmhLimiti: tur === 'KMH' ? kurus(Number(body.kmhLimiti) || 0) : 0,
      kmhAylikFaiz: tur === 'KMH' ? Number(body.kmhAylikFaiz) || 0 : 0,
      renk: body.renk || null,
      aktif: body.aktif === undefined ? true : !!body.aktif,
      sira: Number(body.sira) || 0,
    };
    if (id) {
      await this.sahiplikDogrula('butceBankaHesap', k, id);
      const h = await this.db.butceBankaHesap.update({ where: { id }, data });
      return this.bankaHesapNormalize(k, h);
    }
    const h = await this.db.butceBankaHesap.create({
      data: { ...data, tenantId: k.tenantId, userId: k.userId },
    });
    return this.bankaHesapNormalize(k, h);
  }

  async bankaHesapSil(k: Kimlik, id: string) {
    await this.sahiplikDogrula('butceBankaHesap', k, id);
    const kullanim = await this.db.butceIslem.count({
      where: { tenantId: k.tenantId, userId: k.userId, bankaHesapId: id },
    });
    if (kullanim > 0) {
      await this.db.butceBankaHesap.update({ where: { id }, data: { aktif: false } });
      return { ok: true, pasifeAlindi: true, kullanim };
    }
    await this.db.butceBankaHesap.delete({ where: { id } });
    return { ok: true, pasifeAlindi: false };
  }

  /** Hesap hareketleri: işlemler + o hesaptan yapılan borç/kart ödemeleri */
  async bankaHareketleri(k: Kimlik, hesapId: string, donem?: string) {
    await this.sahiplikDogrula('butceBankaHesap', k, hesapId);
    const islemWhere: any = { tenantId: k.tenantId, userId: k.userId, bankaHesapId: hesapId };
    const odemeWhere: any = { tenantId: k.tenantId, userId: k.userId, bankaHesapId: hesapId };
    if (donem) {
      islemWhere.donem = donem;
      odemeWhere.donem = donem;
    }
    const [islemler, odemeler] = await Promise.all([
      this.db.butceIslem.findMany({
        where: islemWhere,
        orderBy: { tarih: 'desc' },
        take: 500,
        include: { kategori: { select: { ad: true, renk: true } } },
      }),
      this.db.butceOdeme.findMany({
        where: odemeWhere,
        orderBy: { tarih: 'desc' },
        take: 500,
        include: {
          borc: { select: { ad: true } },
          kartEkstre: { select: { donem: true, kart: { select: { bankaAdi: true, kartAdi: true } } } },
        },
      }),
    ]);

    return [
      ...islemler.map((i: any) => ({
        id: i.id,
        tarih: i.tarih,
        aciklama: i.aciklama || i.kategori?.ad || '—',
        kategori: i.kategori?.ad || null,
        defter: i.defter,
        tutar: i.tur === 'GELIR' ? num(i.tutar) : -num(i.tutar),
        kayitTuru: i.transferGrupId ? 'TRANSFER' : 'ISLEM',
      })),
      ...odemeler.map((o: any) => ({
        id: o.id,
        tarih: o.tarih,
        aciklama:
          o.hedefTur === 'KART'
            ? `Kart ödemesi — ${o.kartEkstre?.kart?.bankaAdi || ''} ${o.kartEkstre?.kart?.kartAdi || ''} (${o.kartEkstre?.donem || ''})`
            : `Borç ödemesi — ${o.borc?.ad || ''}`,
        kategori: null,
        defter: null,
        tutar: -num(o.tutar),
        kayitTuru: 'ODEME',
      })),
    ].sort((a, b) => new Date(b.tarih).getTime() - new Date(a.tarih).getTime());
  }

  /* ===================== İŞLEM (gelir/gider) ===================== */

  async islemler(
    k: Kimlik,
    filtre: {
      donem?: string;
      tur?: string;
      kategoriId?: string;
      kartId?: string;
      bankaHesapId?: string;
      defter?: DefterSecim;
      transferHaric?: boolean;
      planlanan?: boolean;
    },
  ) {
    const where: any = { tenantId: k.tenantId, userId: k.userId, ...defterWhere(filtre.defter) };
    if (filtre.donem) where.donem = filtre.donem;
    if (filtre.tur) where.tur = filtre.tur;
    if (filtre.kategoriId) where.kategoriId = filtre.kategoriId;
    if (filtre.kartId) where.kartId = filtre.kartId;
    if (filtre.bankaHesapId) where.bankaHesapId = filtre.bankaHesapId;
    if (filtre.transferHaric) where.transferGrupId = null;
    if (filtre.planlanan !== undefined) where.planlanan = filtre.planlanan;
    const kayitlar = await this.db.butceIslem.findMany({
      where,
      orderBy: [{ tarih: 'desc' }, { createdAt: 'desc' }],
      take: 1000,
      include: {
        kategori: { select: { id: true, ad: true, renk: true, zorunlu: true } },
        kart: { select: { id: true, bankaAdi: true, kartAdi: true } },
        bankaHesap: { select: { id: true, ad: true, bankaAdi: true } },
      },
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

    if (body.kartId) await this.sahiplikDogrula('butceKart', k, body.kartId);
    if (body.bankaHesapId) await this.sahiplikDogrula('butceBankaHesap', k, body.bankaHesapId);

    // Defter sırası: elle seçilen → KATEGORİNİN defteri → kartın/hesabın varsayılanı → ŞAHSİ.
    // Kategoriye bakılmadığı için "Müşavirlik Ofisi Geliri" seçilen kayıt bile şahsi yazılıyordu.
    let secilenDefter: Defter | null = DEFTERLER.includes(body.defter) ? body.defter : null;
    if (body.kategoriId) {
      const kategori = await this.db.butceKategori.findFirst({
        where: { id: body.kategoriId, tenantId: k.tenantId, userId: k.userId },
        select: { id: true, defter: true },
      });
      if (!kategori) throw new NotFoundException('Kayıt bulunamadı');
      if (!secilenDefter) secilenDefter = (kategori.defter as Defter) || null;
    }
    if (!secilenDefter && body.kartId) {
      const kart = await this.db.butceKart.findFirst({
        where: { id: body.kartId },
        select: { varsayilanDefter: true },
      });
      secilenDefter = (kart?.varsayilanDefter as Defter) || null;
    }
    if (!secilenDefter && body.bankaHesapId) {
      const hesap = await this.db.butceBankaHesap.findFirst({
        where: { id: body.bankaHesapId },
        select: { varsayilanDefter: true },
      });
      secilenDefter = (hesap?.varsayilanDefter as Defter) || null;
    }

    const kaynak = ['NAKIT', 'BANKA', 'KART'].includes(body.kaynak) ? body.kaynak : 'NAKIT';
    if (kaynak === 'BANKA' && !body.bankaHesapId) {
      throw new BadRequestException('Banka seçtiniz; hangi hesap olduğunu da seçin');
    }
    if (kaynak === 'KART' && !body.kartId) {
      throw new BadRequestException('Kredi kartı seçtiniz; hangi kart olduğunu da seçin');
    }

    const data: any = {
      tarih,
      donem,
      tur: body.tur,
      tutar,
      defter: secilenDefter || 'SAHSI',
      kategoriId: body.kategoriId || null,
      aciklama: body.aciklama?.trim() || null,
      kaynak,
      kartId: kaynak === 'KART' ? body.kartId : null,
      bankaHesapId: kaynak === 'BANKA' ? body.bankaHesapId : null,
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
    const kayit = await this.db.butceIslem.findFirst({
      where: { id, tenantId: k.tenantId, userId: k.userId },
      select: { id: true, transferGrupId: true },
    });
    if (!kayit) throw new NotFoundException('Kayıt bulunamadı');
    if (kayit.transferGrupId) {
      // Transferin iki bacağı birlikte silinir; yarım transfer bakiyeyi bozar
      await this.db.butceIslem.deleteMany({
        where: { tenantId: k.tenantId, userId: k.userId, transferGrupId: kayit.transferGrupId },
      });
      return { ok: true, transfer: true };
    }
    await this.db.butceIslem.delete({ where: { id } });
    return { ok: true, transfer: false };
  }

  /** Beklenen tahsilat/ödemeyi gerçekleşmiş yapar (nakit akışına girer) */
  async islemGerceklesti(k: Kimlik, id: string, body: any = {}) {
    await this.sahiplikDogrula('butceIslem', k, id);
    const tarih = body?.tarih ? new Date(body.tarih) : new Date();
    const donem = `${tarih.getFullYear()}-${String(tarih.getMonth() + 1).padStart(2, '0')}`;
    const data: any = { planlanan: false, tarih, donem };
    if (body?.tutar !== undefined && body?.tutar !== null && body.tutar !== '') {
      const t = kurus(Number(body.tutar));
      if (!(t > 0)) throw new BadRequestException('tutar 0’dan büyük olmalı');
      data.tutar = t;
    }
    if (body?.bankaHesapId) {
      await this.sahiplikDogrula('butceBankaHesap', k, body.bankaHesapId);
      data.bankaHesapId = body.bankaHesapId;
      data.kaynak = 'BANKA';
    }
    const g = await this.db.butceIslem.update({ where: { id }, data });
    return { ...g, tutar: num(g.tutar) };
  }

  /**
   * Aktarım: hesaplar veya defterler arası para hareketi (ofisten kendine çekmek dâhil).
   * İki bacak üretir, aynı transferGrupId ile eşler; gelir/gider toplamlarına girmez.
   */
  async transferYap(k: Kimlik, body: any) {
    const tutar = kurus(Number(body?.tutar));
    if (!(tutar > 0)) throw new BadRequestException('tutar 0’dan büyük olmalı');
    const tarih = body?.tarih ? new Date(body.tarih) : new Date();
    if (isNaN(tarih.getTime())) throw new BadRequestException('tarih geçersiz');
    const donem = `${tarih.getFullYear()}-${String(tarih.getMonth() + 1).padStart(2, '0')}`;

    const kaynakDefter = this.defterDogrula(body?.kaynakDefter);
    const hedefDefter = this.defterDogrula(body?.hedefDefter);
    const kaynakHesapId = body?.kaynakHesapId || null;
    const hedefHesapId = body?.hedefHesapId || null;

    if (kaynakHesapId) await this.sahiplikDogrula('butceBankaHesap', k, kaynakHesapId);
    if (hedefHesapId) await this.sahiplikDogrula('butceBankaHesap', k, hedefHesapId);
    if (kaynakHesapId && kaynakHesapId === hedefHesapId) {
      throw new BadRequestException('Kaynak ve hedef hesap aynı olamaz');
    }
    if (!kaynakHesapId && !hedefHesapId && kaynakDefter === hedefDefter) {
      throw new BadRequestException('Aynı defter içinde hesapsız aktarımın etkisi olmaz');
    }

    const grup = `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const aciklama =
      body?.aciklama?.trim() ||
      (kaynakDefter !== hedefDefter
        ? kaynakDefter === 'OFIS'
          ? 'Ofisten şahsi hesaba aktarım'
          : 'Şahsiden ofise aktarım'
        : 'Hesaplar arası aktarım');

    const ortak = {
      tenantId: k.tenantId,
      userId: k.userId,
      tarih,
      donem,
      tutar,
      aciklama,
      transferGrupId: grup,
      planlanan: false,
    };

    await this.db.butceIslem.createMany({
      data: [
        {
          ...ortak,
          tur: 'GIDER',
          defter: kaynakDefter,
          kaynak: kaynakHesapId ? 'BANKA' : 'NAKIT',
          bankaHesapId: kaynakHesapId,
        },
        {
          ...ortak,
          tur: 'GELIR',
          defter: hedefDefter,
          kaynak: hedefHesapId ? 'BANKA' : 'NAKIT',
          bankaHesapId: hedefHesapId,
        },
      ],
    });
    return { ok: true, transferGrupId: grup, tutar, aciklama };
  }

  /* ===================== DÜZENLİ ÖDEMELER ===================== */

  async duzenliler(k: Kimlik, defter?: DefterSecim) {
    const list = await this.db.butceDuzenliOdeme.findMany({
      where: { tenantId: k.tenantId, userId: k.userId, ...defterWhere(defter) },
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
    if (body.kartId) await this.sahiplikDogrula('butceKart', k, body.kartId);
    let duzenliDefter: Defter | null = DEFTERLER.includes(body.defter) ? body.defter : null;
    if (body.kategoriId) {
      const kategori = await this.db.butceKategori.findFirst({
        where: { id: body.kategoriId, tenantId: k.tenantId, userId: k.userId },
        select: { id: true, defter: true },
      });
      if (!kategori) throw new NotFoundException('Kayıt bulunamadı');
      if (!duzenliDefter) duzenliDefter = (kategori.defter as Defter) || null;
    }

    const data: any = {
      defter: duzenliDefter || 'SAHSI',
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
          defter: d.defter || 'SAHSI',
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
      include: { ekstreler: { orderBy: { donem: 'desc' }, take: 4 } },
    });
    const cikti: any[] = [];
    for (const kart of liste) cikti.push(await this.kartNormalize(k, kart));
    return cikti;
  }

  /**
   * Kart özeti — bankadaki gibi üç rakam:
   *   ekstreBorcu     : kesilmiş, son ödeme tarihi olan borç
   *   donemIciHarcama : son kesimden sonra yapılan, gelecek ekstreye gidecek harcama
   *   guncelBorc      : ikisinin toplamı (limit bunun üzerinden düşer)
   */
  private async kartNormalize(k: Kimlik, kart: any) {
    const ekstreler = (kart.ekstreler || []).map((e: any) => this.ekstreNormalize(e, kart));
    const guncel = ekstreler[0] || null;

    // Banka ekstresindeki "dönem borcu" önceki ayın devrini ZATEN içerir.
    // Bu yüzden ödenmemiş tüm ekstreleri toplamak devri iki kez saymak olur.
    // Doğrusu: tutarı girilmiş EN SON ekstrenin kalanı = güncel kart borcu.
    // Daha eski ödenmemiş ekstreler o tutarın içinde erimiştir (devretti).
    const tutarGirilmisler = ekstreler
      .filter((e: any) => e.borcTutari !== null && e.borcTutari !== undefined)
      .sort((a: any, b: any) => String(b.donem).localeCompare(String(a.donem)));
    const borcEkstresi = tutarGirilmisler[0] || null;
    const ekstreBorcu = borcEkstresi
      ? kurus(Math.max(num(borcEkstresi.borcTutari) - num(borcEkstresi.odenenTutar), 0))
      : 0;
    // Eski ekstreler ekranda "devretti" olarak işaretlensin, toplama girmesin
    for (const e of ekstreler) {
      (e as any).devretti = !!borcEkstresi && e.id !== borcEkstresi.id && e.durum !== 'ODENDI';
    }

    const { sonKesim } = donemIciAralik(kart.kesimGunu, kart.sonOdemeGunFarki);
    const [harcama, iade] = await Promise.all([
      this.db.butceIslem.aggregate({
        where: {
          tenantId: k.tenantId,
          userId: k.userId,
          kartId: kart.id,
          tur: 'GIDER',
          tarih: { gt: sonKesim },
          // Beklenen (henüz olmamış) harcama kart borcu değildir
          planlanan: false,
        },
        _sum: { tutar: true },
      }),
      this.db.butceIslem.aggregate({
        where: {
          tenantId: k.tenantId,
          userId: k.userId,
          kartId: kart.id,
          tur: 'GELIR',
          tarih: { gt: sonKesim },
          planlanan: false,
        },
        _sum: { tutar: true },
      }),
    ]);
    const donemIciHarcama = kurus(Math.max(num(harcama._sum.tutar) - num(iade._sum.tutar), 0));

    const guncelBorc = kurus(ekstreBorcu + donemIciHarcama);
    const limit = num(kart.kartLimiti);

    return {
      ...kart,
      kartLimiti: limit,
      asgariOran: num(kart.asgariOran),
      aylikFaizOrani: num(kart.aylikFaizOrani),
      gecikmeFaizOrani: num(kart.gecikmeFaizOrani),
      ekstreler,
      guncelEkstre: guncel,
      /** Borcun hesaplandığı ekstre (tutarı girilmiş en son ekstre) */
      borcEkstresi,
      ekstreBorcu,
      donemIciHarcama,
      donemIciBaslangic: sonKesim,
      kalanBorc: guncelBorc,
      guncelBorc,
      kullanilabilirLimit: kurus(Math.max(limit - guncelBorc, 0)),
      limitDoluluk: limit > 0 ? Math.min(Math.round((guncelBorc / limit) * 100), 100) : 0,
    };
  }

  private ekstreNormalize(e: any, kart?: any) {
    const borc = e.borcTutari === null || e.borcTutari === undefined ? null : num(e.borcTutari);
    const odenen = num(e.odenenTutar);
    const kesilmedi = new Date(e.kesimTarihi).getTime() > Date.now();
    let aralik: { baslangic: Date; bitis: Date } | null = null;
    if (kart?.kesimGunu) {
      const a = ekstreHarcamaAraligi(e.donem, kart.kesimGunu, kart.sonOdemeGunFarki);
      aralik = { baslangic: a.baslangic, bitis: a.bitis };
    }
    return {
      ...e,
      borcTutari: borc,
      asgariTutar: e.asgariTutar === null || e.asgariTutar === undefined ? null : num(e.asgariTutar),
      odenenTutar: odenen,
      kalanTutar: borc === null ? null : kurus(Math.max(borc - odenen, 0)),
      /** Kesim tarihi henüz gelmedi — "tutar girilmedi" uyarısı verilmez */
      kesilmedi,
      harcamaBaslangic: aralik?.baslangic ?? null,
      harcamaBitis: aralik?.bitis ?? null,
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
      varsayilanDefter: this.defterDogrula(body.varsayilanDefter),
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
      return this.kartNormalize(k, { ...kart, ekstreler: [] });
    }
    const kart = await this.db.butceKart.create({
      data: { ...data, tenantId: k.tenantId, userId: k.userId },
    });
    await this.ekstreDonemUret(k, kart, bugunDonem());
    return this.kartNormalize(k, { ...kart, ekstreler: [] });
  }

  async kartSil(k: Kimlik, id: string) {
    await this.sahiplikDogrula('butceKart', k, id);
    await this.db.butceKart.delete({ where: { id } });
    return { ok: true };
  }

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

  async ekstreDonemUret(k: Kimlik, kart: any, donem: string) {
    const t = kesimVeSonOdeme(donem, kart.kesimGunu, kart.sonOdemeGunFarki);
    const mevcut = await this.db.butceKartEkstre.findFirst({
      where: { tenantId: k.tenantId, kartId: kart.id, donem },
    });
    if (mevcut) return this.ekstreNormalize(mevcut, kart);
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
    return this.ekstreNormalize(olusan, kart);
  }

  async ekstreler(k: Kimlik, kartId?: string) {
    const where: any = { tenantId: k.tenantId, userId: k.userId };
    if (kartId) where.kartId = kartId;
    const liste = await this.db.butceKartEkstre.findMany({
      where,
      orderBy: [{ sonOdemeTarihi: 'desc' }],
      take: 60,
      include: { kart: true },
    });
    return liste.map((e: any) => this.ekstreNormalize(e, e.kart));
  }

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
        durum: this.ekstreDurumHesapla(borc, odenen, ekstre.sonOdemeTarihi, asgari),
      },
    });
    return this.ekstreNormalize(guncel, ekstre.kart);
  }

  async ekstreOdemeYap(k: Kimlik, id: string, body: any) {
    const ekstre = await this.db.butceKartEkstre.findFirst({
      where: { id, tenantId: k.tenantId, userId: k.userId },
      include: { kart: true },
    });
    if (!ekstre) throw new NotFoundException('Ekstre bulunamadı');
    if (ekstre.borcTutari === null) {
      throw new BadRequestException('Önce ekstre borç tutarını girin');
    }
    const borc = num(ekstre.borcTutari);
    const tutar = kurus(Number(body?.tutar));
    if (!(tutar > 0)) throw new BadRequestException('tutar 0’dan büyük olmalı');
    if (body?.bankaHesapId) await this.sahiplikDogrula('butceBankaHesap', k, body.bankaHesapId);
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
        bankaHesapId: body?.bankaHesapId || null,
        tip: body?.tip || 'NORMAL',
        aciklama: body?.aciklama || null,
      },
    });

    const guncel = await this.db.butceKartEkstre.update({
      where: { id },
      data: {
        odenenTutar: odenen,
        durum: this.ekstreDurumHesapla(borc, odenen, ekstre.sonOdemeTarihi, num(ekstre.asgariTutar)),
        odemeTarihi: odenen >= borc - 0.009 ? tarih : ekstre.odemeTarihi,
      },
    });
    return this.ekstreNormalize(guncel, ekstre.kart);
  }

  /** Yanlış girilen ödemeyi geri alır; bakiye ve borç eski hâline döner */
  async odemeSil(k: Kimlik, odemeId: string) {
    const odeme = await this.db.butceOdeme.findFirst({
      where: { id: odemeId, tenantId: k.tenantId, userId: k.userId },
      include: { kartEkstre: true, borc: true },
    });
    if (!odeme) throw new NotFoundException('Ödeme bulunamadı');

    if (odeme.hedefTur === 'KART' && odeme.kartEkstre) {
      const yeniOdenen = kurus(Math.max(num(odeme.kartEkstre.odenenTutar) - num(odeme.tutar), 0));
      await this.db.butceKartEkstre.update({
        where: { id: odeme.kartEkstre.id },
        data: {
          odenenTutar: yeniOdenen,
          odemeTarihi: null,
          durum: this.ekstreDurumHesapla(
            odeme.kartEkstre.borcTutari === null ? null : num(odeme.kartEkstre.borcTutari),
            yeniOdenen,
            odeme.kartEkstre.sonOdemeTarihi,
            num(odeme.kartEkstre.asgariTutar),
          ),
        },
      });
    }
    if (odeme.hedefTur === 'BORC' && odeme.borc) {
      await this.db.butceBorc.update({
        where: { id: odeme.borc.id },
        data: {
          kalanAnapara: kurus(num(odeme.borc.kalanAnapara) + num(odeme.tutar)),
          durum: 'AKTIF',
          odenenTaksit: Math.max((odeme.borc.odenenTaksit || 0) - (odeme.tip === 'EKSTRA' ? 0 : 1), 0),
        },
      });
    }
    await this.db.butceOdeme.delete({ where: { id: odemeId } });
    return { ok: true };
  }

  /**
   * Ekstre durumu. Asgari tutarı ödeyen kişi GECİKMİŞ SAYILMAZ — bankaya göre de
   * gecikme yoktur, kalan yalnız devreder. Eskiden asgariyi ödeyene 7 gün boyunca
   * "ödeme gecikti, kredi notun etkileniyor" uyarısı gidiyordu.
   */
  private ekstreDurumHesapla(
    borc: number | null,
    odenen: number,
    sonOdeme: Date,
    asgari?: number | null,
  ): string {
    if (borc === null) return 'TUTAR_BEKLENIYOR';
    if (odenen >= borc - 0.009) return 'ODENDI';
    const gecti = new Date() > new Date(new Date(sonOdeme).getTime() + 86400000);
    const asgariTutar = asgari === null || asgari === undefined ? null : Number(asgari);
    const asgariKarsilandi = asgariTutar !== null && asgariTutar > 0 && odenen >= asgariTutar - 0.009;
    if (gecti) return asgariKarsilandi ? 'ASGARI_ODENDI' : 'GECIKTI';
    if (asgariKarsilandi) return 'ASGARI_ODENDI';
    if (odenen > 0) return 'KISMI';
    return 'ODENMEDI';
  }

  /* ===================== BORÇLAR ===================== */

  async borclar(k: Kimlik, hepsi = false, defter?: DefterSecim) {
    const where: any = { tenantId: k.tenantId, userId: k.userId, ...defterWhere(defter) };
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
      defter: this.defterDogrula(body.defter),
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

  async borcOdemeYap(k: Kimlik, id: string, body: any) {
    const borc = await this.db.butceBorc.findFirst({
      where: { id, tenantId: k.tenantId, userId: k.userId },
    });
    if (!borc) throw new NotFoundException('Borç bulunamadı');
    const tutar = kurus(Number(body?.tutar));
    if (!(tutar > 0)) throw new BadRequestException('tutar 0’dan büyük olmalı');
    if (body?.bankaHesapId) await this.sahiplikDogrula('butceBankaHesap', k, body.bankaHesapId);
    const tarih = body?.tarih ? new Date(body.tarih) : new Date();
    const donem = `${tarih.getFullYear()}-${String(tarih.getMonth() + 1).padStart(2, '0')}`;
    const tip = body?.tip || 'NORMAL';
    // Taksitin bir kısmı FAİZ, kalanı anaparadır. Tamamını anaparadan düşmek
    // krediyi olduğundan erken kapatıyor ve kalan borcu ekrandan siliyordu.
    const kalanAnapara = num(borc.kalanAnapara);
    const aylikFaizOrani = num(borc.yillikFaiz) / 12 / 100;
    const isleyenFaiz = kurus(kalanAnapara * Math.max(aylikFaizOrani, 0));
    const anaparayaGiden = kurus(Math.max(tutar - isleyenFaiz, 0));
    const yeniKalan = kurus(Math.max(kalanAnapara - anaparayaGiden, 0));

    await this.db.butceOdeme.create({
      data: {
        tenantId: k.tenantId,
        userId: k.userId,
        tarih,
        donem,
        tutar,
        hedefTur: 'BORC',
        borcId: id,
        bankaHesapId: body?.bankaHesapId || null,
        tip,
        aciklama: body?.aciklama || null,
      },
    });

    const yeniOdenenTaksit =
      tip === 'EKSTRA'
        ? borc.odenenTaksit
        : Math.min(borc.odenenTaksit + 1, borc.toplamTaksit || borc.odenenTaksit + 1);
    const taksitBitti = borc.toplamTaksit > 0 && yeniOdenenTaksit >= borc.toplamTaksit;

    const guncel = await this.db.butceBorc.update({
      where: { id },
      data: {
        kalanAnapara: yeniKalan,
        odenenTaksit: yeniOdenenTaksit,
        // Kapanış hem anapara hem taksit sayısı şartına bağlı: biri bitmeden kapanmaz
        durum: yeniKalan <= 0 && (borc.toplamTaksit === 0 || taksitBitti) ? 'KAPANDI' : 'AKTIF',
      },
    });
    return { ...this.borcNormalize(guncel), isleyenFaiz, anaparayaGiden };
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
        bankaHesap: { select: { id: true, ad: true, bankaAdi: true } },
      },
    });
    return liste.map((o: any) => ({ ...o, tutar: num(o.tutar) }));
  }

  /* ===================== NAKİT AKIŞI ===================== */

  /**
   * Gün gün nakit projeksiyonu. "Aylık kapasite" düzensiz gelirde yetersizdir:
   * paranın geldiği gün ile ödemenin düştüğü gün tutmayabilir.
   */
  async nakitAkisi(k: Kimlik, opts: { gunSayisi?: number } = {}) {
    const gunSayisi = Math.min(Math.max(opts.gunSayisi ?? 60, 7), 180);
    const bugun = new Date();
    const bitis = new Date(bugun.getTime() + gunSayisi * 86400000);

    const [hesaplar, ekstreler, borclar, planlananlar, duzenliler] = await Promise.all([
      this.bankaHesaplar(k),
      this.db.butceKartEkstre.findMany({
        where: { tenantId: k.tenantId, userId: k.userId, durum: { not: 'ODENDI' } },
        include: { kart: true },
      }),
      this.borclar(k, false, 'TUMU'),
      this.islemler(k, { planlanan: true, transferHaric: true }),
      this.duzenliler(k, 'TUMU'),
    ]);

    // Başlangıç nakdi = banka bakiyeleri + nakit kasası.
    // Kasa katılmazsa hesap seçilmeden girilen gelir akışta hiç görünmüyordu.
    const kasa = await this.nakitKasasi(k);
    const baslangicNakit = kurus(hesaplar.reduce((t: number, h: any) => t + h.bakiye, 0) + kasa);
    const kmhLimitToplam = kurus(hesaplar.reduce((t: number, h: any) => t + (h.kmhKalanLimit || 0), 0));
    const hareketler: AkisHareketi[] = [];

    // 1) Kart ekstreleri — son ödeme tarihinde çıkış, asgariye çekilebilir
    for (const e of ekstreler) {
      const borc = e.borcTutari === null ? null : num(e.borcTutari);
      const kalan = borc === null ? null : kurus(Math.max(borc - num(e.odenenTutar), 0));
      if (kalan === null || kalan <= 0) continue;
      const sonOdeme = new Date(e.sonOdemeTarihi);
      if (sonOdeme > bitis) continue;
      hareketler.push({
        tarih: sonOdeme,
        tutar: -kalan,
        ad: `${e.kart.bankaAdi} ${e.kart.kartAdi} ekstresi`,
        tur: 'KART_ODEME',
        kesin: true,
        kaynakId: e.id,
        esnek: {
          asgari: num(e.asgariTutar) || asgariTutarHesapla(kalan, num(e.kart.asgariOran) || 20),
          aylikFaiz: (num(e.kart.aylikFaizOrani) || 4.25) / 100,
        },
      });
    }

    // 2) Kredi taksitleri — ödeme gününde, kalan taksit sayısı kadar
    for (const b of borclar as any[]) {
      if (b.taksitTutari <= 0 || b.kalanAnapara <= 0) continue;
      for (let ay = 0; ay < Math.ceil(gunSayisi / 30) + 1; ay++) {
        const d = new Date(bugun.getFullYear(), bugun.getMonth() + ay, 1);
        const gunSayisiAy = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        const tarih = new Date(
          Date.UTC(d.getFullYear(), d.getMonth(), Math.min(b.odemeGunu, gunSayisiAy)),
        );
        if (tarih < new Date(bugun.toDateString()) || tarih > bitis) continue;
        hareketler.push({
          tarih,
          tutar: -Math.min(b.taksitTutari, b.kalanAnapara),
          ad: `${b.ad} taksiti`,
          tur: 'KREDI_TAKSIT',
          kesin: true,
          kaynakId: b.id,
        });
      }
    }

    // 3) Beklenen gelir/gider (planlanan işaretli kayıtlar)
    for (const i of planlananlar as any[]) {
      const tarih = new Date(i.tarih);
      if (tarih > bitis) continue;
      hareketler.push({
        tarih,
        tutar: i.tur === 'GELIR' ? i.tutar : -i.tutar,
        ad: i.aciklama || i.kategori?.ad || (i.tur === 'GELIR' ? 'Beklenen tahsilat' : 'Beklenen gider'),
        tur: i.tur === 'GELIR' ? 'GELIR' : 'GIDER',
        kesin: false,
        kaynakId: i.id,
      });
    }

    // 4) Düzenli kalemler — henüz işleme dönüşmemiş aylar için
    for (const d of duzenliler as any[]) {
      if (!d.aktif) continue;
      for (let ay = 0; ay < Math.ceil(gunSayisi / 30) + 1; ay++) {
        const t = new Date(bugun.getFullYear(), bugun.getMonth() + ay, 1);
        const donem = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
        if (d.baslangicDonem > donem) continue;
        if (d.bitisDonem && d.bitisDonem < donem) continue;
        const varMi = await this.db.butceIslem.count({
          where: { tenantId: k.tenantId, userId: k.userId, duzenliId: d.id, donem },
        });
        if (varMi > 0) continue; // zaten işleme dönüşmüş, ikinci kez sayma
        const gunSayisiAy = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
        const tarih = new Date(Date.UTC(t.getFullYear(), t.getMonth(), Math.min(d.ayinGunu, gunSayisiAy)));
        if (tarih < new Date(bugun.toDateString()) || tarih > bitis) continue;
        if (d.kaynak === 'KART') continue; // kart harcaması nakit çıkışı değil
        hareketler.push({
          tarih,
          tutar: d.tur === 'GELIR' ? d.tutar : -d.tutar,
          ad: d.ad,
          tur: d.tur === 'GELIR' ? 'GELIR' : 'GIDER',
          kesin: false,
          kaynakId: d.id,
        });
      }
    }

    const sonuc = nakitAkisiHesapla({ baslangicNakit, hareketler, gunSayisi, kmhLimitToplam });
    const ortalamaKmhFaiz =
      hesaplar.filter((h: any) => h.kmhAylikFaiz > 0).reduce((t: number, h: any) => t + h.kmhAylikFaiz, 0) /
        Math.max(hesaplar.filter((h: any) => h.kmhAylikFaiz > 0).length, 1) || 5;
    const oneriler = akisOnerileri(sonuc, hareketler, {
      kmhAylikFaiz: ortalamaKmhFaiz,
      kmhKullanilabilir: kmhLimitToplam,
      // Öneri hangi hesaptan ne kadar kullanılacağını adıyla söylesin
      kmhHesaplari: hesaplar
        .filter((h: any) => (h.kmhKalanLimit || 0) > 0)
        .map((h: any) => ({
          id: h.id,
          banka: h.bankaAdi,
          ad: h.ad,
          kullanilabilir: h.kmhKalanLimit,
          aylikFaiz: h.kmhAylikFaiz || 0,
        })),
    });

    return {
      ...sonuc,
      kmhLimitToplam,
      /** Hiç banka hesabı tanımlı değilse başlangıç nakdi 0 kabul edilir — ekran bunu söylemeli */
      hesapTanimliMi: hesaplar.length > 0,
      oneriler,
      hesaplar: hesaplar.map((h: any) => ({
        id: h.id,
        ad: h.ad,
        bankaAdi: h.bankaAdi,
        bakiye: h.bakiye,
        renk: h.renk,
      })),
    };
  }

  /**
   * NAKİT KASASI — banka hesabı seçilmeden girilen gerçekleşmiş hareketlerin net etkisi.
   *
   * Kullanıcı bir geliri "banka" diye işaretlese de hangi hesap olduğunu seçmezse
   * o para hiçbir hesabın bakiyesine yazılmaz. Eskiden bu kayıtlar Genel Bakış'ta
   * gelir olarak görünüp Nakit Akışı'nda hiç görünmüyordu; "115.000 gelir var ama
   * akışta 0 ₺ giriyor" çelişkisinin sebebi buydu.
   *
   * Bu tutar elde/kasada duran para gibi davranır ve ÜÇ EKRANDA DA aynı şekilde
   * hesaba katılır: Genel Bakış, Nakit Akışı, Ödeme Planı.
   *
   * Kart harcamaları hariçtir (kart nakit çıkışı değil, karta borçlanmadır).
   */
  private async nakitKasasi(k: Kimlik): Promise<number> {
    const ortak = {
      tenantId: k.tenantId,
      userId: k.userId,
      planlanan: false,
      transferGrupId: null,
      bankaHesapId: null,
    };
    const [giris, cikis] = await Promise.all([
      this.db.butceIslem.aggregate({ where: { ...ortak, tur: 'GELIR' }, _sum: { tutar: true } }),
      this.db.butceIslem.aggregate({
        where: { ...ortak, tur: 'GIDER', kaynak: { not: 'KART' } },
        _sum: { tutar: true },
      }),
    ]);
    return kurus(num(giris._sum.tutar) - num(cikis._sum.tutar));
  }

  /**
   * NAKİT KASA ÖZETİ — Hesaplar ekranında banka hesaplarının yanında gösterilir.
   *
   * Kasa ayrı bir hesap kaydı değildir: banka hesabı seçilmeden girilmiş
   * hareketlerin toplamıdır. Kullanıcı "hangi bankada ne kadar, kasada ne kadar
   * var" sorusunu tek ekrandan görebilsin diye ayrı bir kart olarak sunulur.
   */
  async kasaOzet(k: Kimlik) {
    const ortak = {
      tenantId: k.tenantId,
      userId: k.userId,
      planlanan: false,
      transferGrupId: null,
      bankaHesapId: null,
    };
    const [giris, cikis, sayi, sonHareketler] = await Promise.all([
      this.db.butceIslem.aggregate({ where: { ...ortak, tur: 'GELIR' }, _sum: { tutar: true } }),
      this.db.butceIslem.aggregate({
        where: { ...ortak, tur: 'GIDER', kaynak: { not: 'KART' } },
        _sum: { tutar: true },
      }),
      this.db.butceIslem.count({
        where: { ...ortak, OR: [{ tur: 'GELIR' }, { tur: 'GIDER', kaynak: { not: 'KART' } }] },
      }),
      this.db.butceIslem.findMany({
        where: { ...ortak, OR: [{ tur: 'GELIR' }, { tur: 'GIDER', kaynak: { not: 'KART' } }] },
        orderBy: [{ tarih: 'desc' }, { createdAt: 'desc' }],
        take: 5,
        include: { kategori: { select: { ad: true, renk: true } } },
      }),
    ]);

    const toplamGiris = kurus(num(giris._sum.tutar));
    const toplamCikis = kurus(num(cikis._sum.tutar));
    return {
      bakiye: kurus(toplamGiris - toplamCikis),
      giris: toplamGiris,
      cikis: toplamCikis,
      hareketSayisi: sayi,
      sonHareketler: sonHareketler.map((i: any) => ({
        id: i.id,
        tarih: i.tarih,
        tur: i.tur,
        tutar: num(i.tutar),
        aciklama: i.aciklama,
        kategori: i.kategori,
      })),
    };
  }

  /* ===================== ÖZET ===================== */

  async ozet(k: Kimlik, donem = bugunDonem(), defter: DefterSecim = 'TUMU') {
    const ayar = await this.ayarGetir(k);
    // GELİR tek havuzdur: defter filtresi yalnız GİDERE uygulanır.
    // (Şahıs firmasında ofisin geliri zaten sahibinin geliridir.)
    const [tumIslemler, kartlar, borclar, ekstreler, hesaplar] = await Promise.all([
      this.islemler(k, { donem, transferHaric: true, planlanan: false }),
      this.kartlar(k),
      // BORÇ DEFTERDEN BAĞIMSIZDIR. Şahıs firmasında borcu ödeyen tek kişi var:
      // siz. "Mesleki gider" süzgecine basınca araç kredisinin kaybolması
      // yanıltıcıydı — toplam borç ve net varlık her süzgeçte aynı kalmalı.
      this.borclar(k, false, 'TUMU'),
      this.yaklasanEkstreler(k),
      this.bankaHesaplar(k),
    ]);

    const gelirler = tumIslemler.filter((i: any) => i.tur === 'GELIR');
    const tumGiderler = tumIslemler.filter((i: any) => i.tur === 'GIDER');
    // Seçili deftere göre süzülen giderler (ekranda gösterilen liste)
    const giderler =
      !defter || defter === 'TUMU' ? tumGiderler : tumGiderler.filter((i: any) => i.defter === defter);
    const islemler = [...gelirler, ...giderler];

    const gelir = kurus(gelirler.reduce((t: number, i: any) => t + i.tutar, 0));
    const gider = kurus(giderler.reduce((t: number, i: any) => t + i.tutar, 0));
    // Mesleki / kişisel gider ayrımı — vergi açısından anlamlı olan ayrım budur
    const meslekiGider = kurus(
      tumGiderler.filter((i: any) => i.defter === 'OFIS').reduce((t: number, i: any) => t + i.tutar, 0),
    );
    const kisiselGider = kurus(
      tumGiderler.filter((i: any) => i.defter === 'SAHSI').reduce((t: number, i: any) => t + i.tutar, 0),
    );
    const kartGideri = kurus(
      giderler.filter((i: any) => i.kaynak === 'KART').reduce((t: number, i: any) => t + i.tutar, 0),
    );
    const nakitGider = kurus(gider - kartGideri);

    const kartBorcu = kurus(kartlar.reduce((t: number, kk: any) => t + kk.ekstreBorcu, 0));
    const kartDonemIci = kurus(kartlar.reduce((t: number, kk: any) => t + kk.donemIciHarcama, 0));
    const krediBorcu = kurus(borclar.reduce((t: number, b: any) => t + b.kalanAnapara, 0));
    const kmhBorcu = kurus(hesaplar.reduce((t: number, h: any) => t + (h.kmhBorcu || 0), 0));
    // Nakit varlık TEK TANIM: net banka bakiyesi (eksideki hesaplar dahil) + kasa.
    // Eskiden burada yalnız artı bakiyeler sayılıyordu; Nakit Akışı ise eksileri de
    // katıyordu, dolayısıyla bir hesap eksiye düştüğünde iki ekran farklı rakam
    // gösteriyordu. Eksi bakiye zaten KMH borcudur; aşağıda net varlıkta ikinci
    // kez düşülmemesi için kmhBorcu ayrıca çıkarılmaz.
    const bankaBakiyesi = kurus(hesaplar.reduce((t: number, h: any) => t + h.bakiye, 0));
    const kasa = await this.nakitKasasi(k);
    const nakitVarlik = kurus(bankaBakiyesi + kasa);

    // Kategori kırılımı mesleki/kişisel ayrımını KATEGORİ ÜSTÜNDE taşır.
    // Üstteki genel süzgeç kaldırıldı; ayrımı görmek isteyen buradan görür.
    const kategoriMap = new Map<
      string,
      { ad: string; renk: string; tutar: number; zorunlu: boolean; defter: Defter }
    >();
    for (const i of islemler as any[]) {
      if (i.tur !== 'GIDER') continue;
      const ad = i.kategori?.ad || 'Kategorisiz';
      const kayit = kategoriMap.get(ad) || {
        ad,
        renk: i.kategori?.renk || '#9c9c9c',
        tutar: 0,
        zorunlu: !!i.kategori?.zorunlu,
        defter: (i.defter as Defter) || 'SAHSI',
      };
      kayit.tutar = kurus(kayit.tutar + i.tutar);
      kategoriMap.set(ad, kayit);
    }

    const trend: Array<{ donem: string; gelir: number; gider: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const d = donemKaydir(donem, -i);
      const ortak = {
        tenantId: k.tenantId,
        userId: k.userId,
        donem: d,
        transferGrupId: null,
        planlanan: false,
      };
      const [gelirToplam, giderToplam] = await Promise.all([
        this.db.butceIslem.aggregate({ where: { ...ortak, tur: 'GELIR' }, _sum: { tutar: true } }),
        this.db.butceIslem.aggregate({
          where: { ...ortak, tur: 'GIDER', ...defterWhere(defter) },
          _sum: { tutar: true },
        }),
      ]);
      trend.push({
        donem: d,
        gelir: num(gelirToplam._sum.tutar),
        gider: num(giderToplam._sum.tutar),
      });
    }

    const uyarilar = await this.uyarilar(k, {
      ekstreler,
      gelir,
      gider: nakitGider,
      borclar,
      kartlar,
      hesaplar,
    });

    return {
      donem,
      defter,
      gelir,
      gider,
      /** Kazançtan indirilebilecek mesleki giderler (ofis) */
      meslekiGider,
      /** İndirilemeyen kişisel harcamalar */
      kisiselGider,
      /** Vergi matrahına esas: gelir − mesleki gider */
      meslekiKazanc: kurus(gelir - meslekiGider),
      /** Cepte kalan: gelir − tüm giderler */
      cepteKalan: kurus(gelir - (meslekiGider + kisiselGider)),
      kartGideri,
      nakitGider,
      /**
       * "Ay sonu kalan" — süzgeçten ETKİLENMEZ. Mesleki süzgeçteyken kişisel
       * harcamalarınız yok sayılıp cebinizde 115.000 varmış gibi görünmesi
       * yanlış yönlendirmeydi; gerçekte kalan para her zaman aynıdır.
       */
      net: kurus(gelir - (meslekiGider + kisiselGider)),
      nakitNet: kurus(gelir - nakitGider),
      nakitYastigi: ayar.nakitYastigi,
      nakitVarlik,
      /** Banka hesaplarındaki bakiye toplamı */
      bankaBakiyesi,
      /** Hesap seçilmeden girilmiş hareketlerin net etkisi (eldeki nakit) */
      nakitKasasi: kasa,
      /** Borca ayrılabilecek para — Ödeme Planı ile aynı hesap */
      odemeKapasitesi: kurus(Math.max(nakitVarlik - ayar.nakitYastigi, 0)),
      borcOzet: {
        kart: kartBorcu,
        kartDonemIci,
        kredi: krediBorcu,
        kmh: kmhBorcu,
        /**
         * Dönem içi harcama da BORÇTUR — henüz ekstresi kesilmemiş olması onu
         * borç olmaktan çıkarmaz. Eskiden toplamdan düşüyordu; kartında 50.000
         * dönem içi harcama varken toplam borç eksik görünüyordu.
         */
        toplam: kurus(kartBorcu + kartDonemIci + krediBorcu + kmhBorcu),
        // Zorunlu ödeme KALAN borçtan türetilir: borç kapandıysa 0, kısmi ödendiyse
        // ödenen düşülür. Aksi hâlde borç 0 iken bile "asgari ödemen var" yazıyordu.
        aylikZorunluOdeme: kurus(
          kartlar.reduce((t: number, kk: any) => t + kartZorunluOdeme(kk), 0) +
            borclar.reduce((t: number, b: any) => t + Math.min(b.taksitTutari, b.kalanAnapara), 0),
        ),
      },
      // kmhBorcu burada AYRICA düşülmez: eksi banka bakiyesi olarak nakitVarlık'ta zaten var
      netVarlik: kurus(nakitVarlik - (kartBorcu + kartDonemIci + krediBorcu)),
      hesapOzet: hesaplar.map((h: any) => ({
        id: h.id,
        ad: h.ad,
        bankaAdi: h.bankaAdi,
        bakiye: h.bakiye,
        kmhBorcu: h.kmhBorcu,
        renk: h.renk,
      })),
      kategoriKirilim: Array.from(kategoriMap.values()).sort((a, b) => b.tutar - a.tutar),
      trend,
      yaklasanOdemeler: ekstreler,
      uyarilar,
    };
  }

  /** Ofis kâr/zarar özeti */
  async ofisOzet(k: Kimlik, donem = bugunDonem()) {
    const islemler = await this.islemler(k, {
      donem,
      defter: 'OFIS',
      transferHaric: true,
      planlanan: false,
    });
    const gelir = kurus(islemler.filter((i: any) => i.tur === 'GELIR').reduce((t: number, i: any) => t + i.tutar, 0));
    const gider = kurus(islemler.filter((i: any) => i.tur === 'GIDER').reduce((t: number, i: any) => t + i.tutar, 0));

    const cekis = await this.db.butceIslem.aggregate({
      where: {
        tenantId: k.tenantId,
        userId: k.userId,
        donem,
        defter: 'OFIS',
        tur: 'GIDER',
        transferGrupId: { not: null },
      },
      _sum: { tutar: true },
    });

    const yil = donem.slice(0, 4);
    const yillik = await this.db.butceIslem.groupBy({
      by: ['tur'],
      where: {
        tenantId: k.tenantId,
        userId: k.userId,
        defter: 'OFIS',
        transferGrupId: null,
        planlanan: false,
        donem: { gte: `${yil}-01`, lte: donem },
      },
      _sum: { tutar: true },
    });
    const yilGelir = num(yillik.find((x: any) => x.tur === 'GELIR')?._sum?.tutar);
    const yilGider = num(yillik.find((x: any) => x.tur === 'GIDER')?._sum?.tutar);

    // OFİSTE KALAN PARA: tüm zamanların kârı − sahibin çektiği toplam.
    // Ofisin yatırım kapasitesi budur; sahibin şahsi bütçesiyle karışmaz.
    const [tumZamanlar, tumCekisler] = await Promise.all([
      this.db.butceIslem.groupBy({
        by: ['tur'],
        where: {
          tenantId: k.tenantId,
          userId: k.userId,
          defter: 'OFIS',
          transferGrupId: null,
          planlanan: false,
        },
        _sum: { tutar: true },
      }),
      this.db.butceIslem.aggregate({
        where: {
          tenantId: k.tenantId,
          userId: k.userId,
          defter: 'OFIS',
          tur: 'GIDER',
          transferGrupId: { not: null },
        },
        _sum: { tutar: true },
      }),
    ]);
    const kumulatifGelir = num(tumZamanlar.find((x: any) => x.tur === 'GELIR')?._sum?.tutar);
    const kumulatifGider = num(tumZamanlar.find((x: any) => x.tur === 'GIDER')?._sum?.tutar);
    const kumulatifKar = kurus(kumulatifGelir - kumulatifGider);
    const kumulatifCekis = num(tumCekisler._sum.tutar);

    // Ofisin kendi yatırımı (demirbaş/araç) zaten gider olarak kârı azaltmıştır;
    // burada ayrıca gösterilir ki "kâr nereye gitti" sorusu cevaplansın.
    const yatirim = await this.db.butceIslem.aggregate({
      where: {
        tenantId: k.tenantId,
        userId: k.userId,
        defter: 'OFIS',
        tur: 'GIDER',
        transferGrupId: null,
        kategori: { ad: { contains: 'Demirbaş', mode: 'insensitive' } },
      },
      _sum: { tutar: true },
    });

    return {
      donem,
      gelir,
      gider,
      kar: kurus(gelir - gider),
      karMarji: gelir > 0 ? Math.round(((gelir - gider) / gelir) * 100) : 0,
      /** Bu dönem sahibin ofisten çektiği para (gider değil, sermaye hareketi) */
      sahipCekisi: num(cekis._sum.tutar),
      yilBasindanBeri: { gelir: yilGelir, gider: yilGider, kar: kurus(yilGelir - yilGider) },
      tumZamanlar: {
        gelir: kumulatifGelir,
        gider: kumulatifGider,
        kar: kumulatifKar,
        cekis: kumulatifCekis,
        /** Ofiste biriken, henüz çekilmemiş para — yatırım kapasitesi */
        ofisteKalan: kurus(kumulatifKar - kumulatifCekis),
        yatirim: num(yatirim._sum.tutar),
      },
    };
  }

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
      include: { kart: true },
    });
    return ekstreler.map((e: any) => {
      const n = this.ekstreNormalize(e, e.kart);
      const kalanGun = Math.ceil(
        (new Date(e.sonOdemeTarihi).getTime() - new Date(simdi.toDateString()).getTime()) / 86400000,
      );
      return {
        ...n,
        kalanGun,
        kart: { id: e.kart.id, bankaAdi: e.kart.bankaAdi, kartAdi: e.kart.kartAdi, renk: e.kart.renk },
      };
    });
  }

  private async uyarilar(
    k: Kimlik,
    ctx: { ekstreler: any[]; gelir: number; gider: number; borclar: any[]; kartlar: any[]; hesaplar: any[] },
  ) {
    const list: Array<{ seviye: 'KRITIK' | 'UYARI' | 'BILGI'; baslik: string; mesaj: string }> = [];

    for (const e of ctx.ekstreler) {
      const kartAdi = `${e.kart?.bankaAdi || ''} ${e.kart?.kartAdi || ''}`.trim();
      if (e.durum === 'ASGARI_ODENDI') {
        // Gecikme yok; yalnız devreden tutarın faiz maliyeti hatırlatılır
        continue;
      }
      if (e.durum === 'GECIKTI') {
        list.push({
          seviye: 'KRITIK',
          baslik: `${kartAdi} — son ödeme geçti`,
          mesaj: `${e.donem} dönemi ödenmedi. Gecikme faizi işliyor; en kısa sürede en az asgari tutarı ödeyin.`,
        });
      } else if (e.borcTutari === null && !e.kesilmedi && e.kalanGun <= 20) {
        list.push({
          seviye: 'UYARI',
          baslik: `${kartAdi} — ekstre tutarı girilmedi`,
          mesaj: `${e.donem} ekstresi kesildi ama borç tutarı girilmemiş. Plan bu kart olmadan hesaplanıyor.`,
        });
      } else if (e.kalanGun <= 3 && e.kalanGun >= 0 && e.durum !== 'ODENDI' && e.borcTutari !== null) {
        list.push({
          seviye: 'UYARI',
          baslik: `${kartAdi} — son ödeme ${e.kalanGun} gün sonra`,
          mesaj: `Kalan ${e.kalanTutar?.toLocaleString('tr-TR')} TL. Son ödeme ${new Date(e.sonOdemeTarihi).toLocaleDateString('tr-TR')}.`,
        });
      }
    }

    for (const h of ctx.hesaplar as any[]) {
      if ((h.kmhBorcu || 0) > 0) {
        list.push({
          seviye: h.kmhDoluluk >= 80 ? 'KRITIK' : 'UYARI',
          baslik: `${h.bankaAdi} ${h.ad} — KMH kullanımda`,
          mesaj: `Hesap ${h.kmhBorcu.toLocaleString('tr-TR')} TL eksideniz (limitin %${h.kmhDoluluk}'i). KMH faizi günlük işler; ödeme planında öncelik verilir.`,
        });
      }
    }

    if (ctx.gider > ctx.gelir && ctx.gelir > 0) {
      list.push({
        seviye: 'KRITIK',
        baslik: 'Bu ay nakit gideriniz gelirinizi aştı',
        mesaj: `Açık: ${kurus(ctx.gider - ctx.gelir).toLocaleString('tr-TR')} TL (kart harcamaları hariç).`,
      });
    }

    const limitDolu = ctx.kartlar.filter((kk: any) => kk.limitDoluluk >= 90);
    if (limitDolu.length > 0) {
      list.push({
        seviye: 'UYARI',
        baslik: 'Kart limiti dolmak üzere',
        mesaj: `${limitDolu.map((x: any) => `${x.bankaAdi} ${x.kartAdi}`).join(', ')} limitinin %90’ından fazlası kullanılmış.`,
      });
    }

    return list;
  }

  /**
   * Son 6 ayın ORTALAMA aylık gelir ve nakit gideri.
   *
   * Düzensiz gelirde tek ayın rakamı "her ay böyle olacak" anlamına gelmez.
   * Yalnız hareket görmüş aylar sayılır: hiç kayıt girilmemiş aylar ortalamayı
   * haksız yere aşağı çekmesin.
   */
  private async aylikOrtalamaAkis(k: Kimlik, donem: string) {
    const donemler: string[] = [];
    for (let i = 5; i >= 0; i--) donemler.push(donemKaydir(donem, -i));

    const kayitlar = await this.db.butceIslem.groupBy({
      by: ['donem', 'tur'],
      where: {
        tenantId: k.tenantId,
        userId: k.userId,
        donem: { in: donemler },
        planlanan: false,
        transferGrupId: null,
        OR: [{ tur: 'GELIR' }, { tur: 'GIDER', kaynak: { not: 'KART' } }],
      },
      _sum: { tutar: true },
    });

    let toplamGelir = 0;
    let toplamGider = 0;
    const dolu = new Set<string>();
    for (const r of kayitlar as any[]) {
      const tutar = num(r._sum?.tutar);
      if (tutar <= 0) continue;
      dolu.add(r.donem);
      if (r.tur === 'GELIR') toplamGelir += tutar;
      else toplamGider += tutar;
    }

    const aySayisi = Math.max(dolu.size, 1);
    return {
      aySayisi,
      ortGelir: kurus(toplamGelir / aySayisi),
      ortGider: kurus(toplamGider / aySayisi),
    };
  }

  /* ===================== ÖDEME PLANI ===================== */

  private async planKalemleri(k: Kimlik, _defter?: DefterSecim): Promise<PlanKalemi[]> {
    // Ödeme planı HER ZAMAN tüm borçları kapsar. Borcu ödeyen tek kasa var;
    // "mesleki gider" süzgeci araç kredisini plandan düşürmemeli.
    const [kartlar, borclar, hesaplar] = await Promise.all([
      this.kartlar(k),
      this.borclar(k, false, 'TUMU'),
      this.bankaHesaplar(k),
    ]);
    const kalemler: PlanKalemi[] = [];

    for (const kk of kartlar as any[]) {
      // Plan yalnız KESİLMİŞ ekstre borcunu öder; dönem içi harcamanın ödeme günü henüz yok
      if (kk.ekstreBorcu > 0) {
        kalemler.push({
          id: `kart:${kk.id}`,
          ad: `${kk.bankaAdi} ${kk.kartAdi}`,
          tip: 'KART',
          kalan: kk.ekstreBorcu,
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
    for (const h of hesaplar as any[]) {
      const kalem = kmhBorcKalemi({
        id: `kmh:${h.id}`,
        ad: `${h.bankaAdi} ${h.ad} (KMH)`,
        eksiBakiye: h.kmhBorcu || 0,
        aylikFaizYuzde: h.kmhAylikFaiz || 0,
      });
      if (kalem) kalemler.push(kalem);
    }
    return kalemler;
  }

  async plan(
    k: Kimlik,
    opts: { donem?: string; kapasite?: number; strateji?: Strateji; defter?: DefterSecim } = {},
  ) {
    const donem = opts.donem || bugunDonem();
    const defter = opts.defter || 'TUMU';
    const ayar = await this.ayarGetir(k);
    const islemler = await this.islemler(k, {
      donem,
      defter,
      transferHaric: true,
      planlanan: false,
    });
    const gelir = kurus(islemler.filter((i: any) => i.tur === 'GELIR').reduce((t: number, i: any) => t + i.tutar, 0));
    const gider = kurus(
      islemler.filter((i: any) => i.tur === 'GIDER' && i.kaynak !== 'KART').reduce((t: number, i: any) => t + i.tutar, 0),
    );

    // İKİ AYRI KAPASİTE — biri tek seferlik, biri sürdürülebilir.
    //
    // Kullanıcı bulgusu: "bankadaki 98.789 + gelir − gider" tek rakam olarak
    // aylık kapasite sayılınca plan "5 ayda borçsuz kalırsınız" diyordu. Ama
    // bankadaki birikim BİR KERELİKTİR; gelecek ay tekrar gelmez. Karıştırınca
    // süre gerçekte tutmayacak kadar iyimser çıkıyordu.
    //
    //   aylikKapasite → her ay tekrar eden: gelir − nakit gider − yastık
    //   ilkAyEkNakit  → yalnız bu aya özel: bugün hesapta duran birikim
    //
    // ÇİFT SAYIM KORUMASI: bir gelir/gider banka hesabına bağlıysa etkisi zaten
    // bakiyededir; birikime ikinci kez eklenmemesi için ayrıca sayılmaz.
    const hesaplar = await this.bankaHesaplar(k);
    const bankaBakiyesi = kurus(hesaplar.reduce((t: number, h: any) => t + h.bakiye, 0));
    const kasa = await this.nakitKasasi(k);
    // Elde olan toplam para — Genel Bakış ve Nakit Akışı ile AYNI tanım
    const nakitVarlik = kurus(bankaBakiyesi + kasa);
    // HER AY TEKRAR EDEN KAPASİTE — tek ayın verisinden değil, GEÇMİŞ AYLARIN
    // ORTALAMASINDAN türetilir.
    //
    // Kullanıcı bulgusu: geliri düzensiz olan biri için "her ay 95.000
    // ayırabilirsiniz" demek yanıltıcıydı; o rakam yalnız içinde bulunulan ayın
    // gelir − giderinden geliyordu. Mükellef tahsilatları aydan aya değişiyor.
    const gecmis = await this.aylikOrtalamaAkis(k, donem);
    const otomatikKapasite = kurus(Math.max(gecmis.ortGelir - gecmis.ortGider - ayar.nakitYastigi, 0));
    // Bu ay öncesinden devreden para: elde duran paradan bu ayın akışı düşülür,
    // çünkü bu ayın geliri zaten aylık kapasitede sayıldı (çift sayım olmasın).
    const birikim = kurus(Math.max(nakitVarlik - gelir + gider, 0));
    const kullanilabilirNakit = nakitVarlik;
    const kapasite =
      opts.kapasite !== undefined && opts.kapasite !== null && !Number.isNaN(Number(opts.kapasite))
        ? kurus(Number(opts.kapasite))
        : otomatikKapasite;

    const kalemler = await this.planKalemleri(k, defter);
    const karsilastirma = stratejiKarsilastir({
      aylikKapasite: kapasite,
      ilkAyEkNakit: birikim,
      kalemler,
    });
    const strateji: Strateji = opts.strateji || (ayar.strateji as Strateji) || 'CIG';
    const secilen = strateji === 'KARTOPU' ? karsilastirma.kartopu : karsilastirma.cig;

    const kapanisAy = new Map(secilen.kapanisSirasi.map((x) => [x.id, x.ay]));
    const fayda = ekstraOdemeFaydasi(kalemler, kapasite > 0 ? kapasite : 1000, (kalem) =>
      kapanisAy.get(kalem.id) ?? 12,
    );

    return {
      donem,
      defter,
      gelir,
      gider,
      nakitYastigi: ayar.nakitYastigi,
      /** Elde olan toplam para: banka bakiyeleri + nakit kasası */
      nakitVarlik,
      /** Banka hesaplarındaki bakiye */
      bankaBakiyesi,
      /** Hesap seçilmeden girilmiş hareketlerin net etkisi */
      nakitKasasi: kasa,
      /** Yastık düşülmeden önce elde olan toplam para */
      kullanilabilirNakit,
      /** Bu ay öncesinden devreden para — her ay tekrarlamaz */
      birikim,
      /** Ortalamanın kaç aylık veriye dayandığı (1 ise yalnız bu ay) */
      ortalamaAySayisi: gecmis.aySayisi,
      /** Ortalama aylık gelir (kapasite bundan türer) */
      ortalamaGelir: gecmis.ortGelir,
      /** Ortalama aylık nakit gider */
      ortalamaGider: gecmis.ortGider,
      /** Her ay tekrar eden kapasite: gelir − nakit gider − yastık */
      otomatikKapasite,
      /** Bu ay fiilen ödeyebileceğiniz toplam: tekrarlayan + birikim */
      buAyToplam: kurus(kapasite + birikim),
      kapasite,
      strateji,
      kalemler,
      secilen,
      karsilastirma,
      fayda,
      not: 'Faiz hesapları tahminidir; banka yöntemi (gün sayısı, KKDF/BSMV) farklılık gösterebilir.',
    };
  }

  async faydaAnalizi(k: Kimlik, tutar: number, defter?: DefterSecim) {
    const kalemler = await this.planKalemleri(k, defter);
    // Kapasite 0 ile çalıştırılırsa hiçbir borç kapanmaz ve her kaleme sabit 12 ay
    // varsayılırdı; kazanç kredide şişik, kartta eksik çıkıyordu. Gerçek kapasiteyi kullan.
    const plan = await this.plan(k, { defter });
    const kapanisAy = new Map(plan.secilen.kapanisSirasi.map((x) => [x.id, x.ay]));
    const kapanmayan = plan.secilen.kapanmiyor;
    return {
      tutar: kurus(tutar),
      kapasite: plan.kapasite,
      /** Bu kapasiteyle borç kapanmıyorsa süreler tahminidir, kullanıcıya söylenir */
      kapanmiyor: kapanmayan,
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
