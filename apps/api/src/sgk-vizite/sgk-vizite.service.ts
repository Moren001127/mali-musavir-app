import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  isoGunuBicimle,
  type SgkIsKazasiSatiri,
  type SgkOnayParcasi,
  type SgkRaporDurum,
  type SgkRaporSatiri,
  type SgkViziteIslemSonucu,
  type SgkViziteMukellefDurumu,
  type SgkViziteOzet,
  type SgkViziteSorguBaslat,
} from '@mali-musavir/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notification-types';
import { tryDecrypt } from '../common/crypto';
import {
  ViziteHatasi,
  hastaneIsKazalari,
  onayBekleyenRaporlar,
  onayliRaporDetayi,
  onayliRaporlar,
  personelimDegil,
  raporOnayla,
  viziteOturumAc,
  type ViziteCevap,
  type ViziteKimlik,
} from './sgk-vizite-istemci';
import {
  bekleyenRaporCoz,
  bugunIso,
  gunSayisi,
  isKazasiCoz,
  isoGunEkle,
  kalanAralik,
  onayBaslangici,
  onayEnGecBitisi,
  onayParcasiCoz,
  onayliRaporCoz,
  raporDurumuAdi,
  type IsKazasiKaydi,
  type OnayParcasiKaydi,
  type RaporKaydi,
} from './sgk-vizite-cozumleyici';

/** Onaylı rapor sorgu aralığı (gün). */
const ONAYLI_GUN = 180;
/** Hastane iş kazası sorgu aralığı (gün). */
const IS_KAZASI_GUN = 90;
/** Detayı okunacak onaylı raporlar: işbaşı/kontrol tarihi bu kadar gün içinde (ya da ileride). */
const DETAY_YAKIN_GUN = 45;
/** Mükellef başına bir koşuda en çok detay sorgusu (SGK dakikada bir izin veriyor). */
const DETAY_TAVAN = 8;

type Kaynak = 'gece' | 'elle';

interface Hedef {
  taxpayerId: string;
  mukellefAdi: string;
  kullaniciAdi: string;
  isyeriKodu: string;
  sifreliIsyeriSifresi: string;
}

const kapaliMi = (v?: string) => ['0', 'off', 'false', 'kapali', 'hayir'].includes(String(v || '').trim().toLowerCase());

/**
 * SGK e-Rapor (vizite) + hastane iş kazası — WS_Vizite web servisi (2026-09-26).
 *
 * Gece 02:30 (İstanbul) ve elle "Şimdi sorgula": iki faz.
 *  Faz A (hızlı, tüm mükellefler): giriş → onay bekleyen raporlar → hastane iş kazaları → kaydet → yeni olana bildirim.
 *  Faz B (yavaş): onaylı raporlar + seçili raporların onay ayrıntısı — SGK bu iki sorguya DAKİKADA BİR izin
 *  veriyor (istemci `sinirliSira` ile sıraya koyar). Parçalı rapor tespiti burada.
 *
 * Kurallar:
 *  - Ortak SGK şifre kaydının lastError alanına YAZILMAZ; hata `SgkViziteDurum`da tutulur (hizmet listesi etkilenmez).
 *  - raporOkunduKapat ÇAĞRILMAZ (Hattat ya da işverenin programı da aynı işyerini sorguluyor olabilir).
 *  - Onay / personelim değil yalnız kullanıcı düğmesinden; her biri `SgkRaporIslem`e yazılır.
 *  - İlk başarılı sorgu "taban"dır: o ana kadar var olan raporlar için bildirim üretilmez.
 * Kapatma anahtarları: SGK_VIZITE_GECE=off (gece sorgusu), SGK_VIZITE_BILDIRIM=off (bildirimler).
 */
@Injectable()
export class SgkViziteService {
  private readonly logger = new Logger('SgkVizite');
  private calisma: { tenantId: string; toplam: number; biten: number; baslangic: Date; kaynak: Kaynak } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─────────────────────────── zamanlama ───────────────────────────

  @Cron('0 30 2 * * *', { timeZone: 'Europe/Istanbul' })
  async geceSorgusu() {
    if (kapaliMi(process.env.SGK_VIZITE_GECE)) return;
    try {
      const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
      for (const t of tenants) {
        const hedefler = await this.hedefler(t.id);
        if (hedefler.length) await this.topluSorgu(t.id, hedefler, 'gece');
      }
    } catch (e: any) {
      this.logger.error(`Gece sorgusu hata: ${e?.message || e}`);
    }
  }

  async sorguBaslat(tenantId: string, taxpayerIds?: string[]): Promise<SgkViziteSorguBaslat> {
    if (this.calisma) {
      return {
        baslatildi: false,
        mukellefSayisi: this.calisma.toplam,
        mesaj: `Sorgu zaten sürüyor (${this.calisma.biten}/${this.calisma.toplam}).`,
      };
    }
    const hedefler = await this.hedefler(tenantId, taxpayerIds?.length ? taxpayerIds : undefined);
    if (!hedefler.length) {
      return { baslatildi: false, mukellefSayisi: 0, mesaj: 'SGK şifresi (kullanıcı adı, işyeri kodu, işyeri şifresi) kayıtlı mükellef yok.' };
    }
    void this.topluSorgu(tenantId, hedefler, 'elle').catch((e) => this.logger.error(`Elle sorgu hata: ${e?.message || e}`));
    const dakika = hedefler.length;
    return {
      baslatildi: true,
      mukellefSayisi: hedefler.length,
      mesaj:
        hedefler.length === 1
          ? 'Sorgu başladı. Onay bekleyenler birkaç saniyede gelir; onaylı raporlar SGK sınırı nedeniyle 1-3 dakika sürer.'
          : `${hedefler.length} mükellef sorgulanıyor. Onay bekleyenler birkaç dakikada gelir; onaylı raporlar SGK sınırı nedeniyle yaklaşık ${dakika} dakika sürer.`,
    };
  }

  private async topluSorgu(tenantId: string, hedefler: Hedef[], kaynak: Kaynak) {
    if (this.calisma) {
      this.logger.warn(`Sorgu zaten sürüyor; ${kaynak} sorgusu atlandı.`);
      return;
    }
    this.calisma = { tenantId, toplam: hedefler.length, biten: 0, baslangic: new Date(), kaynak };
    const t0 = Date.now();
    let hataA = 0;
    let hataB = 0;
    try {
      for (const h of hedefler) {
        if (!(await this.hizliSorgu(tenantId, h, kaynak))) hataA++;
      }
      for (const h of hedefler) {
        if (!(await this.onayliSorgu(tenantId, h))) hataB++;
        if (this.calisma) this.calisma.biten++;
      }
    } finally {
      this.calisma = null;
      this.logger.log(`[SgkVizite] ${kaynak} sorgusu bitti: ${hedefler.length} mükellef, hızlı faz hata=${hataA}, onaylı faz hata=${hataB}, ${Math.round((Date.now() - t0) / 1000)} sn`);
    }
  }

  // ─────────────────────────── hedefler / kimlik ───────────────────────────

  private mukellefAdi(t: { companyName?: string | null; firstName?: string | null; lastName?: string | null }): string {
    return (t.companyName || `${t.firstName || ''} ${t.lastName || ''}`).trim() || 'Mükellef';
  }

  private async hedefler(tenantId: string, taxpayerIds?: string[]): Promise<Hedef[]> {
    const creds = await this.prisma.portalCredential.findMany({
      where: {
        tenantId,
        provider: 'SGK_EBILDIRGE',
        ownerType: 'TAXPAYER',
        isActive: true,
        ...(taxpayerIds ? { ownerId: { in: taxpayerIds } } : {}),
      },
      select: { ownerId: true, username: true, workplaceCode: true, encryptedSecondaryPassword: true },
    });
    const tamam = creds.filter((c) => c.username?.trim() && c.workplaceCode?.trim() && c.encryptedSecondaryPassword);
    if (!tamam.length) return [];
    const tps = await this.prisma.taxpayer.findMany({
      where: { tenantId, isActive: true, id: { in: tamam.map((c) => c.ownerId) } },
      select: { id: true, companyName: true, firstName: true, lastName: true },
    });
    const adlar = new Map(tps.map((t) => [t.id, this.mukellefAdi(t)]));
    return tamam
      .filter((c) => adlar.has(c.ownerId))
      .map((c) => ({
        taxpayerId: c.ownerId,
        mukellefAdi: adlar.get(c.ownerId)!,
        kullaniciAdi: c.username!.trim(),
        isyeriKodu: c.workplaceCode!.trim(),
        sifreliIsyeriSifresi: c.encryptedSecondaryPassword!,
      }))
      .sort((a, b) => a.mukellefAdi.localeCompare(b.mukellefAdi, 'tr'));
  }

  private kimlik(h: Hedef): ViziteKimlik {
    const sifre = tryDecrypt(h.sifreliIsyeriSifresi);
    if (!sifre) throw new ViziteHatasi('İşyeri şifresi çözülemedi (portal şifre kaydını yeniden kaydedin).', null, 'KIMLIK');
    return { kullaniciAdi: h.kullaniciAdi, isyeriKodu: h.isyeriKodu, isyeriSifresi: sifre };
  }

  private hataMetni(e: any): { mesaj: string; kod: number | null } {
    if (e instanceof ViziteHatasi) return { mesaj: e.message, kod: e.sonucKod };
    return { mesaj: `Beklenmeyen hata: ${String(e?.message || e).slice(0, 200)}`, kod: null };
  }

  // ─────────────────────────── Faz A: onay bekleyen + iş kazası ───────────────────────────

  /** true = başarılı. */
  private async hizliSorgu(tenantId: string, h: Hedef, kaynak: Kaynak): Promise<boolean> {
    const simdi = new Date();
    const durumOnce = await this.prisma.sgkViziteDurum.findUnique({ where: { taxpayerId: h.taxpayerId } });
    const taban = !!durumOnce?.ilkBasariAt;
    try {
      const oturum = await viziteOturumAc(this.kimlik(h));
      const bugun = bugunIso(simdi);
      const bekleyen = (await onayBekleyenRaporlar(oturum, isoGunEkle(bugun, 1)))
        .map(bekleyenRaporCoz)
        .filter((r): r is RaporKaydi => !!r);
      if (bekleyen.length >= 100) {
        this.logger.warn(`[SgkVizite] ${h.mukellefAdi}: onay bekleyen 100 sınırına ulaştı (SGK en çok 100 döndürür).`);
      }
      const yeniRaporlar = await this.bekleyenleriYaz(tenantId, h.taxpayerId, bekleyen, simdi);

      // İş kazası sorgusu ayrı: hata verirse raporlar yine kaydedilmiş olur.
      let kazaHatasi: { mesaj: string; kod: number | null } | null = null;
      let yeniKazalar: Array<IsKazasiKaydi & { adSoyad: string | null }> = [];
      try {
        const kazalar = (await hastaneIsKazalari(oturum, isoGunEkle(bugun, -IS_KAZASI_GUN), bugun))
          .map(isKazasiCoz)
          .filter((k): k is IsKazasiKaydi => !!k);
        yeniKazalar = await this.kazalariYaz(tenantId, h.taxpayerId, kazalar, simdi);
      } catch (e: any) {
        kazaHatasi = this.hataMetni(e);
        this.logger.warn(`[SgkVizite] ${h.mukellefAdi} (iş kazası): ${kazaHatasi.mesaj}`);
      }

      await this.prisma.sgkViziteDurum.upsert({
        where: { taxpayerId: h.taxpayerId },
        create: {
          tenantId,
          taxpayerId: h.taxpayerId,
          ilkBasariAt: simdi,
          sonSorguAt: simdi,
          sonBasariAt: simdi,
          sonKaynak: kaynak,
          sonHata: kazaHatasi ? `Hastane iş kazası: ${kazaHatasi.mesaj}`.slice(0, 500) : null,
          sonHataKod: kazaHatasi?.kod ?? null,
        },
        update: {
          ...(durumOnce?.ilkBasariAt ? {} : { ilkBasariAt: simdi }),
          sonSorguAt: simdi,
          sonBasariAt: simdi,
          sonHata: kazaHatasi ? `Hastane iş kazası: ${kazaHatasi.mesaj}`.slice(0, 500) : null,
          sonHataKod: kazaHatasi?.kod ?? null,
          sonKaynak: kaynak,
        },
      });

      if (taban && !kapaliMi(process.env.SGK_VIZITE_BILDIRIM)) {
        if (yeniRaporlar.length) await this.raporBildir(tenantId, h, yeniRaporlar);
        for (const k of yeniKazalar) await this.kazaBildir(tenantId, h, k);
      }
      return true;
    } catch (e: any) {
      const { mesaj, kod } = this.hataMetni(e);
      this.logger.warn(`[SgkVizite] ${h.mukellefAdi}: ${mesaj}`);
      await this.prisma.sgkViziteDurum
        .upsert({
          where: { taxpayerId: h.taxpayerId },
          create: { tenantId, taxpayerId: h.taxpayerId, sonSorguAt: simdi, sonHata: mesaj.slice(0, 500), sonHataKod: kod, sonKaynak: kaynak },
          update: { sonSorguAt: simdi, sonHata: mesaj.slice(0, 500), sonHataKod: kod, sonKaynak: kaynak },
        })
        .catch(() => undefined);
      return false;
    }
  }

  /** Onay bekleyenleri yazar; bu koşuda İLK KEZ görülenleri döndürür. */
  private async bekleyenleriYaz(tenantId: string, taxpayerId: string, raporlar: RaporKaydi[], simdi: Date): Promise<RaporKaydi[]> {
    const ids = raporlar.map((r) => r.medulaRaporId);
    const mevcut = await this.prisma.sgkRapor.findMany({
      where: { tenantId, taxpayerId, medulaRaporId: { in: ids } },
      select: { medulaRaporId: true },
    });
    const varOlan = new Set(mevcut.map((m) => m.medulaRaporId));
    const yeni: RaporKaydi[] = [];
    for (const r of raporlar) {
      const alanlar = {
        tcKimlikNo: r.tcKimlikNo,
        adSoyad: r.adSoyad,
        vaka: r.vaka,
        vakaAdi: r.vakaAdi,
        raporTakipNo: r.raporTakipNo,
        raporSiraNo: r.raporSiraNo,
        poliklinikTarihi: r.poliklinikTarihi,
        raporBaslangic: r.raporBaslangic,
        raporBitis: r.raporBitis,
        isbasiKontrolTarihi: r.isbasiKontrolTarihi,
        isKazasiTarihi: r.isKazasiTarihi,
        raporDurumuKodu: r.raporDurumuKodu,
        raw: r.raw as any,
      };
      await this.prisma.sgkRapor.upsert({
        where: { tenantId_taxpayerId_medulaRaporId: { tenantId, taxpayerId, medulaRaporId: r.medulaRaporId } },
        create: { tenantId, taxpayerId, medulaRaporId: r.medulaRaporId, ...alanlar, durum: 'BEKLIYOR', bekleyenListede: true, ilkGorulme: simdi, sonGorulme: simdi },
        update: { ...alanlar, durum: 'BEKLIYOR', bekleyenListede: true, sonGorulme: simdi },
      });
      if (!varOlan.has(r.medulaRaporId)) yeni.push(r);
    }
    // Listeden düşenler (onaylanmış / başka yerden kapatılmış) artık "onay bekleyen" görünmez.
    await this.prisma.sgkRapor.updateMany({
      where: { tenantId, taxpayerId, bekleyenListede: true, ...(ids.length ? { medulaRaporId: { notIn: ids } } : {}) },
      data: { bekleyenListede: false },
    });
    return yeni;
  }

  /** Hastane iş kazası bildirimlerini yazar; İLK KEZ görülenleri döndürür. Ad, aynı TC'nin raporundan. */
  private async kazalariYaz(
    tenantId: string,
    taxpayerId: string,
    kazalar: IsKazasiKaydi[],
    simdi: Date,
  ): Promise<Array<IsKazasiKaydi & { adSoyad: string | null }>> {
    if (!kazalar.length) return [];
    const mevcut = await this.prisma.sgkIsKazasi.findMany({
      where: { tenantId, taxpayerId, bildirimId: { in: kazalar.map((k) => k.bildirimId) } },
      select: { bildirimId: true },
    });
    const varOlan = new Set(mevcut.map((m) => m.bildirimId));
    const adKaynagi = await this.prisma.sgkRapor.findMany({
      where: { tenantId, taxpayerId, tcKimlikNo: { in: kazalar.map((k) => k.tcKimlikNo) } },
      select: { tcKimlikNo: true, adSoyad: true },
      orderBy: { sonGorulme: 'desc' },
    });
    const adlar = new Map<string, string>();
    for (const a of adKaynagi) if (!adlar.has(a.tcKimlikNo) && a.adSoyad) adlar.set(a.tcKimlikNo, a.adSoyad);
    const yeni: Array<IsKazasiKaydi & { adSoyad: string | null }> = [];
    for (const k of kazalar) {
      const adSoyad = adlar.get(k.tcKimlikNo) ?? null;
      const alanlar = {
        tcKimlikNo: k.tcKimlikNo,
        cinsiyet: k.cinsiyet,
        isKazasiTarihi: k.isKazasiTarihi,
        provizyonTarihi: k.provizyonTarihi,
        provizyonTipi: k.provizyonTipi,
        tesisAdi: k.tesisAdi,
        unvani: k.unvani,
        islemTuru: k.islemTuru,
        sgkBildirimSonGun: k.sgkBildirimSonGun,
        raw: k.raw as any,
        ...(adSoyad ? { adSoyad } : {}),
      };
      await this.prisma.sgkIsKazasi.upsert({
        where: { tenantId_taxpayerId_bildirimId: { tenantId, taxpayerId, bildirimId: k.bildirimId } },
        create: { tenantId, taxpayerId, bildirimId: k.bildirimId, ...alanlar, ilkGorulme: simdi, sonGorulme: simdi },
        update: { ...alanlar, sonGorulme: simdi },
      });
      if (!varOlan.has(k.bildirimId)) yeni.push({ ...k, adSoyad });
    }
    return yeni;
  }

  // ─────────────────────────── Faz B: onaylı + parçalı ───────────────────────────

  /** true = başarılı. */
  private async onayliSorgu(tenantId: string, h: Hedef): Promise<boolean> {
    const simdi = new Date();
    try {
      const oturum = await viziteOturumAc(this.kimlik(h));
      const bugun = bugunIso(simdi);
      const onayli = (await onayliRaporlar(oturum, isoGunEkle(bugun, -ONAYLI_GUN), bugun))
        .map(onayliRaporCoz)
        .filter((r): r is RaporKaydi => !!r);
      const ids = onayli.map((r) => r.medulaRaporId);
      const mevcut = await this.prisma.sgkRapor.findMany({ where: { tenantId, taxpayerId: h.taxpayerId, medulaRaporId: { in: ids } } });
      const mevcutMap = new Map(mevcut.map((m) => [m.medulaRaporId, m]));
      for (const r of onayli) {
        const m = mevcutMap.get(r.medulaRaporId);
        if (!m) {
          // upsert: aynı anda çalışan hızlı faz (ör. onay sonrası tazeleme) satırı açmış olabilir.
          await this.prisma.sgkRapor.upsert({
            where: { tenantId_taxpayerId_medulaRaporId: { tenantId, taxpayerId: h.taxpayerId, medulaRaporId: r.medulaRaporId } },
            create: {
              tenantId,
              taxpayerId: h.taxpayerId,
              medulaRaporId: r.medulaRaporId,
              tcKimlikNo: r.tcKimlikNo,
              adSoyad: r.adSoyad,
              vaka: r.vaka,
              vakaAdi: r.vakaAdi,
              raporTakipNo: r.raporTakipNo,
              raporSiraNo: r.raporSiraNo,
              poliklinikTarihi: r.poliklinikTarihi,
              raporBaslangic: r.raporBaslangic,
              raporBitis: r.raporBitis,
              isbasiKontrolTarihi: r.isbasiKontrolTarihi,
              isKazasiTarihi: r.isKazasiTarihi,
              durum: 'ONAYLANDI',
              onayliListede: true,
              ilkGorulme: simdi,
              sonGorulme: simdi,
              raw: r.raw as any,
            },
            update: { onayliListede: true, sonGorulme: simdi },
          });
        } else {
          // Onay bekleyen listesinden gelen zengin tarihleri EZME; yalnız boş olanları doldur.
          await this.prisma.sgkRapor.update({
            where: { id: m.id },
            data: {
              onayliListede: true,
              sonGorulme: simdi,
              isbasiKontrolTarihi: m.isbasiKontrolTarihi ?? r.isbasiKontrolTarihi,
              poliklinikTarihi: m.poliklinikTarihi ?? r.poliklinikTarihi,
              raporBaslangic: m.raporBaslangic ?? r.raporBaslangic,
              raporBitis: m.raporBitis ?? r.raporBitis,
              vaka: m.vaka ?? r.vaka,
              vakaAdi: m.vakaAdi ?? r.vakaAdi,
            },
          });
        }
      }
      await this.prisma.sgkRapor.updateMany({
        where: { tenantId, taxpayerId: h.taxpayerId, onayliListede: true, ...(ids.length ? { medulaRaporId: { notIn: ids } } : {}) },
        data: { onayliListede: false },
      });

      // Detay adayları: onay bekleyenlerde de olanlar (onaylanmış kısmı göstermek için), parçalılar,
      // ve detayı hiç okunmamış yakın tarihli (ya da süren) raporlar.
      const esik = isoGunEkle(bugun, -DETAY_YAKIN_GUN);
      const satirlar = await this.prisma.sgkRapor.findMany({ where: { tenantId, taxpayerId: h.taxpayerId, onayliListede: true } });
      const oncelik = (s: (typeof satirlar)[number]) => (s.bekleyenListede ? 0 : s.durum === 'PARCALI' ? 1 : 2);
      const adaylar = satirlar
        .filter((s) => s.bekleyenListede || s.durum === 'PARCALI' || (!s.detayAt && (!s.isbasiKontrolTarihi || s.isbasiKontrolTarihi >= esik)))
        .sort((a, b) => oncelik(a) - oncelik(b) || String(b.isbasiKontrolTarihi || '').localeCompare(String(a.isbasiKontrolTarihi || '')))
        .slice(0, DETAY_TAVAN);
      const okunan: string[] = [];
      for (const s of adaylar) {
        let parcalar: OnayParcasiKaydi[];
        try {
          parcalar = (await onayliRaporDetayi(oturum, s.medulaRaporId))
            .map(onayParcasiCoz)
            .filter((p): p is OnayParcasiKaydi => !!p)
            .sort((a, b) => a.baslangic.localeCompare(b.baslangic));
        } catch (e: any) {
          this.logger.warn(`[SgkVizite] ${h.mukellefAdi} detay ${s.medulaRaporId}: ${this.hataMetni(e).mesaj}`);
          if (e instanceof ViziteHatasi && (e.tur === 'SINIR' || e.tur === 'AG' || e.tur === 'KIMLIK')) break;
          continue;
        }
        const durum: SgkRaporDurum = s.bekleyenListede ? 'BEKLIYOR' : kalanAralik(s, parcalar) ? 'PARCALI' : 'ONAYLANDI';
        await this.prisma.sgkRapor.update({ where: { id: s.id }, data: { onayParcalari: parcalar as any, detayAt: new Date(), durum } });
        okunan.push(s.id);
      }
      // Onay bekleyenden düşüp onaylıda görünen, detayı bu koşuda okunmayanlar → onaylandı.
      await this.prisma.sgkRapor.updateMany({
        where: { tenantId, taxpayerId: h.taxpayerId, onayliListede: true, bekleyenListede: false, durum: 'BEKLIYOR', id: { notIn: okunan } },
        data: { durum: 'ONAYLANDI' },
      });

      // Bu fazın eski hatası kaldıysa temizle (hızlı fazın hatasına dokunma).
      await this.prisma.sgkViziteDurum.updateMany({
        where: { taxpayerId: h.taxpayerId, sonHata: { startsWith: 'Onaylı raporlar:' } },
        data: { sonHata: null, sonHataKod: null },
      });
      return true;
    } catch (e: any) {
      const { mesaj, kod } = this.hataMetni(e);
      this.logger.warn(`[SgkVizite] ${h.mukellefAdi} (onaylı): ${mesaj}`);
      await this.prisma.sgkViziteDurum
        .updateMany({
          where: { taxpayerId: h.taxpayerId, sonHata: null },
          data: { sonHata: `Onaylı raporlar: ${mesaj}`.slice(0, 500), sonHataKod: kod },
        })
        .catch(() => undefined);
      return false;
    }
  }

  // ─────────────────────────── bildirimler ───────────────────────────

  private async raporBildir(tenantId: string, h: Hedef, raporlar: RaporKaydi[]) {
    const bicim = (r: RaporKaydi) =>
      `${r.adSoyad} — ${r.vakaAdi || 'rapor'}, ${isoGunuBicimle(r.raporBaslangic || r.poliklinikTarihi)}${r.raporBitis ? `–${isoGunuBicimle(r.raporBitis)}` : ''}`;
    const body =
      raporlar.length === 1
        ? `${bicim(raporlar[0])} — onay bekliyor.`
        : `${raporlar.length} yeni rapor onay bekliyor: ${raporlar.slice(0, 3).map(bicim).join('; ')}${raporlar.length > 3 ? '; …' : ''}`;
    await this.notifications
      .createForTenant({
        tenantId,
        type: NOTIFICATION_TYPES.SGK_RAPOR,
        title: `SGK e-Rapor: ${h.mukellefAdi}`,
        body,
        metadata: { taxpayerId: h.taxpayerId, medulaRaporIds: raporlar.map((r) => r.medulaRaporId), link: '/panel/ajanlar/sgk?bolum=rapor' },
        dedupeKey: `sgk-rapor:${h.taxpayerId}:${raporlar.map((r) => r.medulaRaporId).sort().join(',')}`,
        dedupeWindowMin: 60 * 24 * 7,
      } as any)
      .catch((e: any) => this.logger.warn(`SGK_RAPOR bildirimi yazılamadı: ${e?.message || e}`));
  }

  private async kazaBildir(tenantId: string, h: Hedef, k: IsKazasiKaydi & { adSoyad: string | null }) {
    const kim = k.adSoyad || `TC ${k.tcKimlikNo.slice(0, 3)}******${k.tcKimlikNo.slice(-2)}`;
    const body =
      `${kim} — kaza ${isoGunuBicimle(k.isKazasiTarihi) || 'tarihi yok'}${k.tesisAdi ? `, ${k.tesisAdi}` : ''}.` +
      (k.sgkBildirimSonGun ? ` SGK'ya iş kazası bildirimi son gün: ${isoGunuBicimle(k.sgkBildirimSonGun)}.` : '');
    await this.notifications
      .createForTenant({
        tenantId,
        type: NOTIFICATION_TYPES.SGK_IS_KAZASI,
        title: `SGK iş kazası bildirimi: ${h.mukellefAdi}`,
        body,
        metadata: { taxpayerId: h.taxpayerId, bildirimId: k.bildirimId, link: '/panel/ajanlar/sgk?bolum=rapor' },
        dedupeKey: `sgk-is-kazasi:${h.taxpayerId}:${k.bildirimId}`,
        dedupeWindowMin: 60 * 24 * 30,
      } as any)
      .catch((e: any) => this.logger.warn(`SGK_IS_KAZASI bildirimi yazılamadı: ${e?.message || e}`));
  }

  // ─────────────────────────── işveren beyanları (kullanıcı düğmesi) ───────────────────────────

  async raporOnay(tenantId: string, userId: string | null, raporId: string, govde: { bitisTarihi?: string; calisti?: boolean }): Promise<SgkViziteIslemSonucu> {
    const bitis = String(govde?.bitisTarihi || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bitis)) throw new BadRequestException('bitisTarihi YYYY-AA-GG olmalı');
    if (typeof govde?.calisti !== 'boolean') throw new BadRequestException('calisti true/false olmalı');
    return this.beyan(tenantId, userId, raporId, 'ONAY', { bitisTarihi: bitis, calisti: govde.calisti });
  }

  async personelimDegil(tenantId: string, userId: string | null, raporId: string): Promise<SgkViziteIslemSonucu> {
    return this.beyan(tenantId, userId, raporId, 'PERSONELIM_DEGIL', {});
  }

  private async beyan(
    tenantId: string,
    userId: string | null,
    raporId: string,
    islem: 'ONAY' | 'PERSONELIM_DEGIL',
    istek: { bitisTarihi?: string; calisti?: boolean },
  ): Promise<SgkViziteIslemSonucu> {
    const rapor = await this.prisma.sgkRapor.findFirst({ where: { id: raporId, tenantId } });
    if (!rapor) throw new NotFoundException('Rapor bulunamadı');
    if (!rapor.vaka) throw new BadRequestException('Raporun vaka türü bilinmiyor; SGK ekranından işlem yapın.');
    const [h] = await this.hedefler(tenantId, [rapor.taxpayerId]);
    if (!h) throw new BadRequestException('Bu mükellefin SGK şifresi (kullanıcı adı, işyeri kodu, işyeri şifresi) kayıtlı değil.');

    let cevap: ViziteCevap;
    try {
      const oturum = await viziteOturumAc(this.kimlik(h));
      cevap =
        islem === 'ONAY'
          ? await raporOnayla(oturum, {
              tcKimlikNo: rapor.tcKimlikNo,
              vaka: rapor.vaka,
              medulaRaporId: rapor.medulaRaporId,
              calisti: !!istek.calisti,
              bitisIso: istek.bitisTarihi!,
            })
          : await personelimDegil(oturum, { tcKimlikNo: rapor.tcKimlikNo, vaka: rapor.vaka, medulaRaporId: rapor.medulaRaporId });
    } catch (e: any) {
      const { mesaj, kod } = this.hataMetni(e);
      cevap = { sonucKod: kod, sonucAciklama: mesaj, kayitlar: [] };
    }
    const basarili = cevap.sonucKod === 0;
    await this.prisma.sgkRaporIslem.create({
      data: {
        tenantId,
        taxpayerId: rapor.taxpayerId,
        raporId: rapor.id,
        medulaRaporId: rapor.medulaRaporId,
        islem,
        istek: istek as any,
        basarili,
        sonucKod: cevap.sonucKod,
        sonucAciklama: (cevap.sonucAciklama || '').slice(0, 500),
        userId,
      },
    });
    this.logger.log(`[SgkVizite] ${islem} ${h.mukellefAdi} rapor=${rapor.medulaRaporId}: kod=${cevap.sonucKod} ${cevap.sonucAciklama}`);
    if (basarili) {
      // Onay bekleyen listesini hemen tazele; onaylı ayrıntısı SGK sınırı nedeniyle arka planda.
      await this.hizliSorgu(tenantId, h, 'elle');
      void this.onayliSorgu(tenantId, h);
    }
    const satir = (await this.raporSatirlari(tenantId, { id: rapor.id }))[0] ?? null;
    return {
      basarili,
      sonucKod: cevap.sonucKod,
      sonucAciklama: cevap.sonucAciklama || (basarili ? 'Başarılı' : 'SGK cevabı alınamadı'),
      rapor: satir,
    };
  }

  // ─────────────────────────── okuma uçları ───────────────────────────

  private bekleyenKosulu() {
    return { OR: [{ durum: 'BEKLIYOR', bekleyenListede: true }, { durum: 'PARCALI', onayliListede: true }] };
  }

  private onaylananKosulu() {
    return { durum: 'ONAYLANDI', onayliListede: true };
  }

  async raporlar(tenantId: string, durum: string, taxpayerId?: string): Promise<{ satirlar: SgkRaporSatiri[] }> {
    const kosul = durum === 'onaylanan' ? this.onaylananKosulu() : this.bekleyenKosulu();
    return { satirlar: await this.raporSatirlari(tenantId, { ...kosul, ...(taxpayerId ? { taxpayerId } : {}) }) };
  }

  private async raporSatirlari(tenantId: string, where: Record<string, any>): Promise<SgkRaporSatiri[]> {
    const satirlar = await this.prisma.sgkRapor.findMany({
      where: { tenantId, ...where },
      include: { taxpayer: { select: { companyName: true, firstName: true, lastName: true } } },
      take: 2000,
    });
    if (!satirlar.length) return [];
    const islemler = await this.prisma.sgkRaporIslem.findMany({
      where: { tenantId, raporId: { in: satirlar.map((s) => s.id) } },
      orderBy: { createdAt: 'desc' },
    });
    const kullaniciIds = [...new Set(islemler.map((i) => i.userId).filter((x): x is string => !!x))];
    const kullanicilar = kullaniciIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: kullaniciIds } }, select: { id: true, firstName: true, lastName: true, email: true } })
      : [];
    const kullaniciAdi = new Map(kullanicilar.map((u: any) => [u.id, `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || null]));
    const sonIslem = new Map<string, (typeof islemler)[number]>();
    for (const i of islemler) if (!sonIslem.has(i.raporId)) sonIslem.set(i.raporId, i);
    const bugun = bugunIso();

    const sonuc = satirlar.map((s): SgkRaporSatiri => {
      const parcalar: SgkOnayParcasi[] = Array.isArray(s.onayParcalari)
        ? (s.onayParcalari as any[]).map((p) => ({
            baslangic: p.baslangic,
            bitis: p.bitis,
            calisti: !!p.calisti,
            islemTarihi: p.islemTarihi ?? null,
            odemeCikti: p.odemeCikti ?? null,
          }))
        : [];
      const kalan = s.durum === 'PARCALI' ? kalanAralik(s, parcalar as any) : null;
      const islem = sonIslem.get(s.id);
      return {
        id: s.id,
        taxpayerId: s.taxpayerId,
        mukellefAdi: this.mukellefAdi(s.taxpayer as any),
        medulaRaporId: s.medulaRaporId,
        tcKimlikNo: s.tcKimlikNo,
        adSoyad: s.adSoyad,
        vaka: s.vaka,
        vakaAdi: s.vakaAdi,
        poliklinikTarihi: s.poliklinikTarihi,
        raporBaslangic: s.raporBaslangic,
        raporBitis: s.raporBitis,
        isbasiKontrolTarihi: s.isbasiKontrolTarihi,
        gunSayisi: gunSayisi(s.raporBaslangic, s.raporBitis),
        raporDurumuKodu: s.raporDurumuKodu,
        raporDurumuAdi: raporDurumuAdi(s.raporDurumuKodu),
        isKazasiTarihi: s.isKazasiTarihi,
        durum: s.durum as SgkRaporDurum,
        onayParcalari: parcalar,
        onayBaslangic: onayBaslangici(s, parcalar as any),
        onayEnGecBitis: onayEnGecBitisi(s, bugun),
        kalanBaslangic: kalan?.kalanBaslangic ?? null,
        kalanBitis: kalan?.kalanBitis ?? null,
        ilkGorulme: s.ilkGorulme.toISOString(),
        sonGorulme: s.sonGorulme.toISOString(),
        sonPortalIslemi: islem
          ? {
              islem: islem.islem as 'ONAY' | 'PERSONELIM_DEGIL',
              tarih: islem.createdAt.toISOString(),
              kullanici: islem.userId ? kullaniciAdi.get(islem.userId) ?? null : null,
              basarili: islem.basarili,
              sonucKod: islem.sonucKod,
              sonucAciklama: islem.sonucAciklama,
            }
          : null,
      };
    });
    return sonuc.sort(
      (a, b) =>
        a.mukellefAdi.localeCompare(b.mukellefAdi, 'tr') ||
        String(a.poliklinikTarihi || '').localeCompare(String(b.poliklinikTarihi || '')) ||
        a.adSoyad.localeCompare(b.adSoyad, 'tr'),
    );
  }

  private kazaKosulu() {
    const esik = isoGunEkle(bugunIso(), -IS_KAZASI_GUN);
    return { OR: [{ isKazasiTarihi: { gte: esik } }, { isKazasiTarihi: null, provizyonTarihi: { gte: esik } }] };
  }

  async isKazalari(tenantId: string, taxpayerId?: string): Promise<{ satirlar: SgkIsKazasiSatiri[] }> {
    const satirlar = await this.prisma.sgkIsKazasi.findMany({
      where: { tenantId, ...this.kazaKosulu(), ...(taxpayerId ? { taxpayerId } : {}) },
      include: { taxpayer: { select: { companyName: true, firstName: true, lastName: true } } },
      take: 1000,
    });
    return {
      satirlar: satirlar
        .map(
          (k): SgkIsKazasiSatiri => ({
            id: k.id,
            taxpayerId: k.taxpayerId,
            mukellefAdi: this.mukellefAdi(k.taxpayer as any),
            bildirimId: k.bildirimId,
            tcKimlikNo: k.tcKimlikNo,
            adSoyad: k.adSoyad,
            cinsiyet: k.cinsiyet,
            isKazasiTarihi: k.isKazasiTarihi,
            provizyonTarihi: k.provizyonTarihi,
            tesisAdi: k.tesisAdi,
            unvani: k.unvani,
            islemTuru: k.islemTuru,
            sgkBildirimSonGun: k.sgkBildirimSonGun,
            ilkGorulme: k.ilkGorulme.toISOString(),
          }),
        )
        .sort(
          (a, b) =>
            a.mukellefAdi.localeCompare(b.mukellefAdi, 'tr') || String(b.isKazasiTarihi || '').localeCompare(String(a.isKazasiTarihi || '')),
        ),
    };
  }

  async durumlar(tenantId: string): Promise<{ satirlar: SgkViziteMukellefDurumu[] }> {
    const satirlar = await this.prisma.sgkViziteDurum.findMany({
      where: { tenantId, sonHata: { not: null } },
      include: { taxpayer: { select: { companyName: true, firstName: true, lastName: true } } },
    });
    return {
      satirlar: satirlar
        .map((d) => ({
          taxpayerId: d.taxpayerId,
          mukellefAdi: this.mukellefAdi(d.taxpayer as any),
          sonSorgu: d.sonSorguAt?.toISOString() ?? null,
          sonBasari: d.sonBasariAt?.toISOString() ?? null,
          hata: d.sonHata,
        }))
        .sort((a, b) => a.mukellefAdi.localeCompare(b.mukellefAdi, 'tr')),
    };
  }

  async ozet(tenantId: string, taxpayerId?: string): Promise<SgkViziteOzet> {
    const tp = taxpayerId ? { taxpayerId } : {};
    const [bekleyen, parcali, onaylanan, isKazasi, hedefSayisi, sonGece] = await Promise.all([
      this.prisma.sgkRapor.count({ where: { tenantId, ...tp, ...this.bekleyenKosulu() } }),
      this.prisma.sgkRapor.count({ where: { tenantId, ...tp, durum: 'PARCALI', onayliListede: true } }),
      this.prisma.sgkRapor.count({ where: { tenantId, ...tp, ...this.onaylananKosulu() } }),
      this.prisma.sgkIsKazasi.count({ where: { tenantId, ...tp, ...this.kazaKosulu() } }),
      this.hedefler(tenantId).then((h) => h.length),
      // "Son sorgu": gece ya da elle, en yenisi. Hata sayısı = şu an hatası süren mükellef.
      this.prisma.sgkViziteDurum.findFirst({ where: { tenantId, sonSorguAt: { not: null } }, orderBy: { sonSorguAt: 'desc' }, select: { sonSorguAt: true } }),
    ]);
    let sonGeceSorgusu: SgkViziteOzet['sonGeceSorgusu'] = null;
    if (sonGece?.sonSorguAt) {
      const pencere = new Date(sonGece.sonSorguAt.getTime() - 6 * 3600_000);
      const [mukellefSayisi, hataSayisi] = await Promise.all([
        this.prisma.sgkViziteDurum.count({ where: { tenantId, sonSorguAt: { gte: pencere } } }),
        this.prisma.sgkViziteDurum.count({ where: { tenantId, sonHata: { not: null } } }),
      ]);
      sonGeceSorgusu = { tarih: sonGece.sonSorguAt.toISOString(), mukellefSayisi, hataSayisi };
    }
    const c = this.calisma && this.calisma.tenantId === tenantId ? this.calisma : null;
    return {
      onayBekleyen: bekleyen,
      parcali,
      onaylanan,
      isKazasi,
      iseGirisCikisBagli: false,
      sonGeceSorgusu,
      sorgu: { suruyor: !!c, toplam: c?.toplam ?? 0, biten: c?.biten ?? 0, baslangic: c?.baslangic.toISOString() ?? null },
      sgkSifreliMukellef: hedefSayisi,
    };
  }
}
