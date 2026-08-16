import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { OwnerOnlyGuard } from '../auth/guards/owner-only.guard';
import { ButceService } from './butce.service';
import { donemKaydir, kesimVeSonOdeme, ekstreHarcamaAraligi } from './butce-hesap';
import * as MESAJ from './butce-mesajlar';

/**
 * Bütçe hatırlatmaları.
 *
 * Cron SAATLİK çalışır, işini yalnız kullanıcının seçtiği saatte yapar. Eskiden
 * sabit 09:00'du; Ayarlar'daki "hatırlatma saati" hiçbir yerde okunmuyordu.
 *
 * Gönderilen her hatırlatma ekstre üzerindeki `hatirlatmalar` alanına yazılır;
 * aynı mesaj iki kez gitmez. Sunucu kapalı kalıp bir gün ıskalanırsa, ertesi gün
 * telafi edilir (kesim günü ekstresi geriye dönük açılır).
 */
@Injectable()
export class ButceCron {
  private readonly logger = new Logger(ButceCron.name);

  constructor(
    private prisma: PrismaService,
    private butce: ButceService,
    private notifications: NotificationsService,
    private whatsapp: WhatsAppService,
  ) {}

  private get db(): any {
    return this.prisma as any;
  }

  private async sahip(): Promise<{ tenantId: string; userId: string } | null> {
    const email = OwnerOnlyGuard.ownerEmail();
    if (!email) return null;
    const user = await this.db.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, isActive: true },
      select: { id: true, tenantId: true },
    });
    return user ? { tenantId: user.tenantId, userId: user.id } : null;
  }

  /** İstanbul saatine göre bugünün 00:00'ı (UTC Date olarak) */
  private istanbulBugun(): Date {
    const s = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    return new Date(`${s}T00:00:00.000Z`);
  }

  /** İstanbul saatine göre şu anki saat (0-23) */
  private istanbulSaat(): number {
    return Number(
      new Intl.DateTimeFormat('tr-TR', {
        hour: '2-digit',
        hour12: false,
        timeZone: 'Europe/Istanbul',
      }).format(new Date()),
    );
  }

  /** Saatlik tetik — işini yalnız kullanıcının seçtiği saatte yapar */
  @Cron('0 * * * *', { timeZone: 'Europe/Istanbul' })
  async saatlikTetik() {
    const k = await this.sahip();
    if (!k) return;
    try {
      const ayar = await this.butce.ayarGetir(k);
      const hedefSaat = Number(ayar.sabahSaati ?? 9);
      if (this.istanbulSaat() !== hedefSaat) return;
      await this.gunlukTarama(k, ayar);
    } catch (e: any) {
      this.logger.error(`[ButceCron] saatlik tetik hatası: ${e?.message || e}`);
    }
  }

  /** Günlük tarama — kesim, tutar, son ödeme, gecikme, taksit, nakit açığı */
  private async gunlukTarama(k: { tenantId: string; userId: string }, ayar: any) {
    const bugun = this.istanbulBugun();
    const donem = bugun.toISOString().slice(0, 7);

    await this.butce.duzenlileriUygula(k, donem).catch(() => null);
    await this.ekstreleriTazele(k, bugun, donem);

    const ekstreler = await this.db.butceKartEkstre.findMany({
      where: { tenantId: k.tenantId, userId: k.userId, durum: { not: 'ODENDI' } },
      include: { kart: true },
    });

    // Nakit durumu — mesajlarda "hesaplarınızda şu kadar var" satırı için
    const hesaplar = await this.butce.bankaHesaplar(k);
    const nakit = hesaplar.length
      ? hesaplar.reduce((t: number, h: any) => t + h.bakiye, 0)
      : null;

    for (const e of ekstreler) {
      const kart = e.kart;
      const kesimGun = Math.round((bugun.getTime() - new Date(e.kesimTarihi).getTime()) / 86400000);
      const kalanGun = Math.round((new Date(e.sonOdemeTarihi).getTime() - bugun.getTime()) / 86400000);
      const gonderilen: string[] = Array.isArray(e.hatirlatmalar) ? e.hatirlatmalar : [];
      const yeni: string[] = [];

      const gonder = async (m: MESAJ.Mesaj) => {
        if (gonderilen.includes(m.anahtar)) return;
        await this.bildir(k, ayar, m);
        yeni.push(m.anahtar);
      };

      // Kesim günü — ekstre bugün kesildi
      if (kesimGun === 0) {
        const aralik = ekstreHarcamaAraligi(e.donem, kart.kesimGunu, kart.sonOdemeGunFarki);
        await gonder(
          MESAJ.kesimGunu({
            banka: kart.bankaAdi,
            kart: kart.kartAdi,
            sonOdemeTarihi: e.sonOdemeTarihi,
            harcamaBaslangic: aralik.baslangic,
          }),
        );
      }

      // Tutar hâlâ girilmedi (yalnız kesilmiş ekstrelerde)
      if (e.borcTutari === null && kesimGun > 0 && [1, 3].includes(kesimGun)) {
        await gonder(
          MESAJ.tutarBekleniyor({
            banka: kart.bankaAdi,
            kart: kart.kartAdi,
            donem: e.donem,
            gecenGun: kesimGun,
            sonOdemeTarihi: e.sonOdemeTarihi,
            kalanGun,
          }),
        );
      }

      if (e.borcTutari !== null) {
        const borc = Number(e.borcTutari);
        const odenen = Number(e.odenenTutar) || 0;
        const kalanTutar = Math.max(borc - odenen, 0);
        const asgari = Number(e.asgariTutar) || 0;

        // Son ödeme yaklaşıyor
        if (kalanTutar > 0 && kalanGun >= 0 && [3, 1, 0].includes(kalanGun)) {
          await gonder(
            MESAJ.sonOdemeYaklasti({
              banka: kart.bankaAdi,
              kart: kart.kartAdi,
              kalanGun,
              kalanTutar,
              asgariTutar: asgari,
              sonOdemeTarihi: e.sonOdemeTarihi,
              nakit,
            }),
          );
        }

        // Gecikme — ASGARİ ÖDENDİYSE gecikme sayılmaz
        if (kalanGun < 0 && kalanTutar > 0) {
          const gecikmeGun = -kalanGun;
          const asgariKarsilandi = asgari > 0 && odenen >= asgari - 0.009;
          if (asgariKarsilandi) {
            await gonder(
              MESAJ.asgariOdendi({
                banka: kart.bankaAdi,
                kart: kart.kartAdi,
                kalanTutar,
                aylikFaiz: Number(kart.aylikFaizOrani) || 4.25,
              }),
            );
          } else if (gecikmeGun <= 7) {
            await gonder(
              MESAJ.odemeGecikti({
                banka: kart.bankaAdi,
                kart: kart.kartAdi,
                gecikmeGun,
                kalanTutar,
                asgariTutar: asgari,
                gecikmeFaizi: Number(kart.gecikmeFaizOrani) || 4.75,
              }),
            );
          }
          // Durumu tazele
          const yeniDurum = asgariKarsilandi ? 'ASGARI_ODENDI' : 'GECIKTI';
          if (e.durum !== yeniDurum) {
            await this.db.butceKartEkstre.update({ where: { id: e.id }, data: { durum: yeniDurum } });
          }
        }
      }

      if (yeni.length > 0) {
        await this.db.butceKartEkstre.update({
          where: { id: e.id },
          data: { hatirlatmalar: [...gonderilen, ...yeni] },
        });
      }
    }

    await this.krediTaksitleri(k, ayar, bugun);
    await this.limitVeKmh(k, ayar);
    // Nakit açığı taraması pazartesi günleri (haftada bir yeter, her gün bunaltır)
    if (bugun.getUTCDay() === 1) await this.nakitAcigiTaramasi(k, ayar);
  }

  /**
   * Kesim günü gelmiş kartların ekstresini açar. Sunucu o gün kapalıysa ertesi gün
   * telafi eder: son 5 günü geriye doğru tarar, eksik ekstreyi geriye dönük oluşturur.
   */
  private async ekstreleriTazele(k: { tenantId: string; userId: string }, bugun: Date, donem: string) {
    const kartlar = await this.db.butceKart.findMany({
      where: { tenantId: k.tenantId, userId: k.userId, aktif: true },
    });
    for (const kart of kartlar) {
      for (const gerileme of [0, 1, 2, 3, 4, 5]) {
        const gun = new Date(bugun.getTime() - gerileme * 86400000);
        const d = gun.toISOString().slice(0, 7);
        const t = kesimVeSonOdeme(d, kart.kesimGunu, kart.sonOdemeGunFarki);
        if (t.kesimTarihi.getTime() === gun.getTime()) {
          await this.butce.ekstreDonemUret(k, kart, d).catch(() => null);
        }
      }
      void donem;
    }
  }

  private async krediTaksitleri(k: { tenantId: string; userId: string }, ayar: any, bugun: Date) {
    const borclar = await this.db.butceBorc.findMany({
      where: { tenantId: k.tenantId, userId: k.userId, durum: 'AKTIF' },
    });
    const ayGun = new Date(Date.UTC(bugun.getUTCFullYear(), bugun.getUTCMonth() + 1, 0)).getUTCDate();
    for (const b of borclar) {
      const odemeGunu = Math.min(b.odemeGunu, ayGun);
      const fark = odemeGunu - bugun.getUTCDate();
      if (![2, 0].includes(fark)) continue;
      const m = MESAJ.krediTaksiti({
        ad: b.ad,
        tutar: Math.min(Number(b.taksitTutari), Number(b.kalanAnapara)),
        kalanGun: fark,
        odemeGunu: b.odemeGunu,
        kalanAnapara: Number(b.kalanAnapara),
        kalanTaksit: Math.max((b.toplamTaksit || 0) - (b.odenenTaksit || 0), 0),
      });
      await this.bildir(k, ayar, m, `${b.id}-${bugun.toISOString().slice(0, 10)}`);
    }
  }

  private async limitVeKmh(k: { tenantId: string; userId: string }, ayar: any) {
    const [kartlar, hesaplar] = await Promise.all([this.butce.kartlar(k), this.butce.bankaHesaplar(k)]);
    for (const kk of kartlar as any[]) {
      if (kk.limitDoluluk >= 90 && kk.kartLimiti > 0) {
        await this.bildir(
          k,
          ayar,
          MESAJ.limitUyarisi({
            banka: kk.bankaAdi,
            kart: kk.kartAdi,
            doluluk: kk.limitDoluluk,
            kalanLimit: kk.kullanilabilirLimit,
          }),
          `limit-${kk.id}`,
        );
      }
    }
    for (const h of hesaplar as any[]) {
      if ((h.kmhBorcu || 0) > 0) {
        await this.bildir(
          k,
          ayar,
          MESAJ.kmhUyarisi({
            banka: h.bankaAdi,
            hesap: h.ad,
            borc: h.kmhBorcu,
            limit: h.kmhLimiti,
            aylikFaiz: h.kmhAylikFaiz,
          }),
          `kmh-${h.id}`,
        );
      }
    }
  }

  /** Önümüzdeki 30 günde nakit açığı var mı — varsa en ucuz çözümle birlikte bildir */
  private async nakitAcigiTaramasi(k: { tenantId: string; userId: string }, ayar: any) {
    const akis = await this.butce.nakitAkisi(k, { gunSayisi: 30 }).catch(() => null);
    if (!akis || !akis.oneriler?.length) return;
    const ilk = akis.oneriler[0];
    const gun = akis.gunler.find((g: any) => g.tarih === ilk.tarih);
    await this.bildir(
      k,
      ayar,
      MESAJ.nakitAcigi({
        tarih: new Date(`${ilk.tarih}T00:00:00.000Z`),
        acik: ilk.acik,
        toplamAcik: ilk.toplamAcik,
        devredenAcik: ilk.devredenAcik,
        odemeToplami: gun?.cikis,
        nakit: gun ? gun.bakiye + gun.cikis - gun.giris : undefined,
        enUcuzSecenek: ilk.secenekler?.find((x: any) => x.onerilen) || null,
      }),
      `nakit-${ilk.tarih}`,
    );
  }

  /** Ayın 1'i — geçen ayın özeti ve bu ayın planı */
  @Cron('30 * 1 * *', { timeZone: 'Europe/Istanbul' })
  async aylikOzetTetik() {
    const k = await this.sahip();
    if (!k) return;
    try {
      const ayar = await this.butce.ayarGetir(k);
      if (this.istanbulSaat() !== Number(ayar.sabahSaati ?? 9)) return;
      const oncekiDonem = donemKaydir(this.istanbulBugun().toISOString().slice(0, 7), -1);
      const [ozet, plan] = await Promise.all([
        this.butce.ozet(k, oncekiDonem, 'TUMU'),
        this.butce.plan(k, {}),
      ]);
      await this.bildir(
        k,
        ayar,
        MESAJ.aylikOzet({
          ofisGider: ozet.meslekiGider,
          kisiselGider: ozet.kisiselGider,
          donem: oncekiDonem,
          gelir: ozet.gelir,
          gider: ozet.gider,
          net: ozet.net,
          toplamBorc: ozet.borcOzet.toplam,
          kapasite: plan.kapasite,
          ilkAy: plan.secilen.ilkAy.filter((x: any) => x.toplam > 0).map((x: any) => ({ ad: x.ad, tutar: x.toplam })),
          kapanisAy: plan.secilen.ayAdedi,
        }),
        `aylik-${oncekiDonem}`,
      );
    } catch (e: any) {
      this.logger.error(`[ButceCron] aylık özet hatası: ${e?.message || e}`);
    }
  }

  /**
   * Bildirim: portal zili (yalnız sahibin kullanıcısına) + WhatsApp.
   * dedupeEk verilirse aynı gün ikinci kez gönderilmez.
   */
  /**
   * TÜM ŞABLONLARI GERÇEK VERİYLE ÜRET.
   *
   * Amaç: kullanıcı bildirimlerin nasıl görüneceğini önceden görebilsin ve
   * model değişikliklerinden sonra bozulan şablon varsa yakalansın.
   * `gonder` false ise HİÇBİR mesaj gitmez; yalnız metinler döner.
   */
  async sablonOnizleme(
    k: { tenantId: string; userId: string },
    gonder = false,
  ): Promise<Array<{ anahtar: string; baslik: string; metin: string; gonderildi: boolean }>> {
    const ayar = await this.butce.ayarGetir(k);
    const donem = new Date().toISOString().slice(0, 7);
    const bugun = new Date();

    const [ozet, plan, akis, kartlar, hesaplar, borclar] = await Promise.all([
      this.butce.ozet(k, donem).catch(() => null),
      this.butce.plan(k, {}).catch(() => null),
      this.butce.nakitAkisi(k, { gunSayisi: 30 }).catch(() => null),
      this.butce.kartlar(k).catch(() => [] as any[]),
      this.butce.bankaHesaplar(k).catch(() => [] as any[]),
      this.butce.borclar(k, false, 'TUMU').catch(() => [] as any[]),
    ]);

    const mesajlar: MESAJ.Mesaj[] = [];
    const ekle = (m: MESAJ.Mesaj | null) => {
      if (m) mesajlar.push(m);
    };

    // 1) Kart ekstreleri — durumuna göre uygun şablon
    for (const kk of kartlar as any[]) {
      const e = (kk.ekstreler || [])[0];
      if (!e) continue;
      const ortak = { banka: kk.bankaAdi, kart: kk.kartAdi };
      if (e.borcTutari === null) {
        ekle(
          MESAJ.tutarBekleniyor({
            ...ortak,
            donem: e.donem,
            gecenGun: Math.max(0, -(e.kalanGun ?? 0)),
            sonOdemeTarihi: new Date(e.sonOdemeTarihi),
            kalanGun: e.kalanGun ?? 0,
          }),
        );
      } else if (e.durum === 'GECIKTI') {
        ekle(
          MESAJ.odemeGecikti({
            ...ortak,
            gecikmeGun: Math.abs(e.kalanGun ?? 0),
            kalanTutar: e.kalanTutar ?? 0,
            asgariTutar: e.asgariTutar ?? undefined,
            gecikmeFaizi: kk.gecikmeFaizOrani || kk.aylikFaizOrani || 0,
          }),
        );
      } else if (e.durum === 'ASGARI_ODENDI') {
        ekle(
          MESAJ.asgariOdendi({
            ...ortak,
            kalanTutar: e.kalanTutar ?? 0,
            aylikFaiz: kk.aylikFaizOrani || 0,
          }),
        );
      } else {
        ekle(
          MESAJ.sonOdemeYaklasti({
            ...ortak,
            kalanGun: e.kalanGun ?? 0,
            kalanTutar: e.kalanTutar ?? 0,
            asgariTutar: e.asgariTutar ?? 0,
            sonOdemeTarihi: new Date(e.sonOdemeTarihi),
          }),
        );
      }
      // Limit uyarısı
      if ((kk.doluluk || 0) >= 90) {
        ekle(
          MESAJ.limitUyarisi({
            ...ortak,
            doluluk: Math.round(kk.doluluk || 0),
            kalanLimit: kk.kullanilabilirLimit || 0,
          }),
        );
      }
    }

    // 2) Kredi taksiti
    for (const b of borclar as any[]) {
      if (b.kalanAnapara <= 0) continue;
      ekle(
        MESAJ.krediTaksiti({
          ad: b.ad,
          tutar: b.taksitTutari,
          kalanGun: Math.max(0, (b.odemeGunu || 1) - new Date().getUTCDate()),
          odemeGunu: b.odemeGunu,
          kalanTaksit: b.kalanTaksit,
          kalanAnapara: b.kalanAnapara,
        }),
      );
      break; // önizlemede tek örnek yeter
    }

    // 3) KMH uyarısı
    for (const h of hesaplar as any[]) {
      if ((h.kmhBorcu || 0) > 0) {
        ekle(
          MESAJ.kmhUyarisi({
            banka: h.bankaAdi,
            hesap: h.ad,
            borc: h.kmhBorcu,
            limit: h.kmhLimiti,
            aylikFaiz: h.kmhAylikFaiz || 0,
          }),
        );
        break;
      }
    }

    // 4) Nakit açığı
    if (akis?.oneriler?.length) {
      const ilk: any = akis.oneriler[0];
      const gun: any = akis.gunler.find((g: any) => g.tarih === ilk.tarih);
      ekle(
        MESAJ.nakitAcigi({
          tarih: new Date(`${ilk.tarih}T00:00:00.000Z`),
          acik: ilk.acik,
          toplamAcik: ilk.toplamAcik,
          devredenAcik: ilk.devredenAcik,
          odemeToplami: gun?.cikis,
          nakit: gun ? gun.bakiye + gun.cikis - gun.giris : undefined,
          enUcuzSecenek: ilk.secenekler?.find((x: any) => x.onerilen) || null,
        }),
      );
    }

    // 5) Günün ödemeleri
    if (akis?.gunler?.length) {
      const bugunKey = bugun.toISOString().slice(0, 10);
      const g: any = akis.gunler.find((x: any) => x.tarih === bugunKey) || akis.gunler[0];
      ekle(
        MESAJ.gunlukOzet({
          bugun: new Date(`${g.tarih}T00:00:00.000Z`),
          nakit: ozet?.nakitVarlik ?? 0,
          odemeler: (g.hareketler || [])
            .filter((h: any) => h.tutar < 0)
            .map((h: any) => ({ ad: h.ad, tutar: Math.abs(h.tutar) })),
          beklenenGirisler: (g.hareketler || [])
            .filter((h: any) => h.tutar > 0)
            .map((h: any) => ({ ad: h.ad, tutar: h.tutar })),
        }),
      );
    }

    // 6) Aylık özet
    if (ozet && plan) {
      ekle(
        MESAJ.aylikOzet({
          donem,
          gelir: ozet.gelir,
          gider: ozet.gider,
          ofisGider: ozet.meslekiGider,
          kisiselGider: ozet.kisiselGider,
          net: ozet.net,
          toplamBorc: ozet.borcOzet.toplam,
          kapasite: plan.kapasite,
          ilkAy: plan.secilen.ilkAy
            .filter((x: any) => x.toplam > 0)
            .map((x: any) => ({ ad: x.ad, tutar: x.toplam })),
          kapanisAy: plan.secilen.ayAdedi,
        }),
      );
    }

    // 7) Hesap kesim hatırlatması (ilk kart üzerinden örnek)
    const ilkKart: any = (kartlar as any[])[0];
    if (ilkKart) {
      ekle(
        MESAJ.kesimGunu({
          banka: ilkKart.bankaAdi,
          kart: ilkKart.kartAdi,
          sonOdemeTarihi: new Date(bugun.getTime() + 10 * 86400000),
        }),
      );
    }

    const numara =
      ayar.whatsappNumara ||
      String(process.env.MOREN_OWNER_WHATSAPP_PHONES || process.env.MOREN_OWNER_WHATSAPP_PHONE || '')
        .split(',')[0]
        .trim();

    const cikti: Array<{ anahtar: string; baslik: string; metin: string; gonderildi: boolean }> = [];
    for (const m of mesajlar) {
      const metin = MESAJ.whatsappMetni(m);
      let gonderildi = false;
      if (gonder && numara) {
        try {
          await this.whatsapp.sendMessageDetailed(numara, metin, k.tenantId);
          gonderildi = true;
          // Köprüyü boğmamak için araya kısa bekleme
          await new Promise((r) => setTimeout(r, 1200));
        } catch (e: any) {
          this.logger.warn(`şablon testi gönderilemedi: ${e?.message || e}`);
        }
      }
      cikti.push({ anahtar: m.anahtar, baslik: m.baslik, metin, gonderildi });
    }
    return cikti;
  }

  private async bildir(
    k: { tenantId: string; userId: string },
    ayar: any,
    m: MESAJ.Mesaj,
    dedupeEk?: string,
  ) {
    const anahtar = `butce:${m.anahtar}${dedupeEk ? `:${dedupeEk}` : ''}`;
    if (ayar.hatirlatmaPortal) {
      await this.notifications
        .create({
          tenantId: k.tenantId,
          userId: k.userId,
          title: m.baslik,
          body: m.govde,
          type: m.kritik ? 'BUTCE_KRITIK' : 'BUTCE',
          metadata: { modul: 'butce' },
          dedupeKey: anahtar,
          dedupeWindowMin: 720,
        })
        .catch((e: any) => this.logger.warn(`bildirim yazılamadı: ${e?.message || e}`));
    }
    if (ayar.hatirlatmaWhatsapp) {
      const numara =
        ayar.whatsappNumara ||
        String(process.env.MOREN_OWNER_WHATSAPP_PHONES || process.env.MOREN_OWNER_WHATSAPP_PHONE || '')
          .split(',')[0]
          .trim();
      if (numara) {
        await this.whatsapp
          .sendMessage(numara, MESAJ.whatsappMetni(m), k.tenantId)
          .catch((e: any) => this.logger.warn(`WhatsApp gönderilemedi: ${e?.message || e}`));
      }
    }
  }
}
