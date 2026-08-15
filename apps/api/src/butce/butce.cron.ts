import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { OwnerOnlyGuard } from '../auth/guards/owner-only.guard';
import { ButceService } from './butce.service';
import { donemKaydir, kesimVeSonOdeme } from './butce-hesap';

/**
 * Bütçe hatırlatmaları — her sabah tek tarama.
 *
 * 1) Bugün hesap kesim günü olan kartlar için dönem ekstresi açılır →
 *    "ekstre kesildi, PDF'i yükleyin ya da tutarı girin" hatırlatması
 * 2) Tutarı girilmemiş ekstreler için kesim + 1 ve + 3. günde tekrar
 * 3) Son ödemeye 3 gün / 1 gün kala ve son ödeme günü sabahı
 * 4) Son ödeme geçmiş ve ödenmemişse gecikme uyarısı (her gün, 7 gün boyunca)
 *
 * Aynı hatırlatma iki kez gitmez: gönderilen anahtarlar ekstre üzerinde tutulur.
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

  /** Modülün sahibi (tek kişi). Kullanıcı yoksa cron sessizce çıkar. */
  private async sahip(): Promise<{ tenantId: string; userId: string } | null> {
    const email = OwnerOnlyGuard.ownerEmail();
    if (!email) return null;
    const user = await this.db.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, isActive: true },
      select: { id: true, tenantId: true },
    });
    if (!user) return null;
    return { tenantId: user.tenantId, userId: user.id };
  }

  private istanbulBugun(): Date {
    const s = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    return new Date(`${s}T00:00:00.000Z`);
  }

  /** Her sabah 09:00 (Europe/Istanbul) */
  @Cron('0 9 * * *', { timeZone: 'Europe/Istanbul' })
  async gunlukTarama() {
    const k = await this.sahip();
    if (!k) return;
    try {
      const ayar = await this.butce.ayarGetir(k);
      const bugun = this.istanbulBugun();
      const donem = bugun.toISOString().slice(0, 7);

      // Düzenli gelir/giderleri bu döneme yansıt (ayın 1'inde biriktirir)
      await this.butce.duzenlileriUygula(k, donem).catch(() => null);

      // 1) Bugün kesim günü olan kartlar için ekstre aç
      const kartlar = await this.db.butceKart.findMany({
        where: { tenantId: k.tenantId, userId: k.userId, aktif: true },
      });
      for (const kart of kartlar) {
        const t = kesimVeSonOdeme(donem, kart.kesimGunu, kart.sonOdemeGunFarki);
        if (t.kesimTarihi.getTime() === bugun.getTime()) {
          await this.butce.ekstreDonemUret(k, kart, donem);
        }
        // Gelecek dönem ekstresi de hazır dursun (ay sonu kesimlerde tarih kayması olmasın)
        if (bugun.getUTCDate() >= 25) {
          await this.butce.ekstreDonemUret(k, kart, donemKaydir(donem, 1)).catch(() => null);
        }
      }

      // 2-4) Açık ekstreleri tara
      const ekstreler = await this.db.butceKartEkstre.findMany({
        where: { tenantId: k.tenantId, userId: k.userId, durum: { not: 'ODENDI' } },
        include: { kart: true },
      });

      for (const e of ekstreler) {
        const kartAdi = `${e.kart.bankaAdi} ${e.kart.kartAdi}`.trim();
        const kesimGun = Math.round((bugun.getTime() - new Date(e.kesimTarihi).getTime()) / 86400000);
        const kalanGun = Math.round((new Date(e.sonOdemeTarihi).getTime() - bugun.getTime()) / 86400000);
        const gonderilen: string[] = Array.isArray(e.hatirlatmalar) ? e.hatirlatmalar : [];
        const yeni: string[] = [];

        const gonder = async (anahtar: string, baslik: string, mesaj: string, kritik: boolean) => {
          if (gonderilen.includes(anahtar)) return;
          await this.bildir(k, ayar, baslik, mesaj, kritik);
          yeni.push(anahtar);
        };

        // Tutar girilmemiş
        if (e.borcTutari === null) {
          if (kesimGun === 0) {
            await gonder(
              `tutar-0`,
              `${kartAdi} — ekstre kesildi`,
              `${e.donem} dönemi hesap özeti bugün kesildi. Ekstre PDF'ini portala yükleyin; hareketler ve tutar otomatik işlensin. Son ödeme: ${this.tarih(e.sonOdemeTarihi)}.`,
              false,
            );
          } else if (kesimGun === 1 || kesimGun === 3) {
            await gonder(
              `tutar-${kesimGun}`,
              `${kartAdi} — ekstre tutarı hâlâ girilmedi`,
              `${e.donem} ekstresi ${kesimGun} gün önce kesildi, tutar girilmedi. Son ödeme ${this.tarih(e.sonOdemeTarihi)} (${kalanGun} gün kaldı). Ödeme planı bu kart olmadan hesaplanıyor.`,
              kesimGun === 3,
            );
          }
        }

        // Son ödeme yaklaşıyor
        if (e.borcTutari !== null && kalanGun >= 0) {
          const kalanTutar = Math.max(Number(e.borcTutari) - Number(e.odenenTutar), 0);
          if (kalanTutar > 0 && [3, 1, 0].includes(kalanGun)) {
            const ne = kalanGun === 0 ? 'BUGÜN' : `${kalanGun} gün sonra`;
            await gonder(
              `son-odeme-${kalanGun}`,
              `${kartAdi} — son ödeme ${ne}`,
              `${e.donem} dönemi kalan borç: ${this.para(kalanTutar)} TL. Asgari: ${this.para(Number(e.asgariTutar || 0))} TL. Son ödeme tarihi ${this.tarih(e.sonOdemeTarihi)}.`,
              kalanGun <= 1,
            );
          }
        }

        // Gecikme
        if (kalanGun < 0 && e.borcTutari !== null) {
          const kalanTutar = Math.max(Number(e.borcTutari) - Number(e.odenenTutar), 0);
          const gecikmeGun = -kalanGun;
          if (kalanTutar > 0 && gecikmeGun <= 7) {
            await gonder(
              `gecikme-${gecikmeGun}`,
              `${kartAdi} — ÖDEME GECİKTİ (${gecikmeGun} gün)`,
              `${e.donem} dönemi ${this.para(kalanTutar)} TL ödenmedi. Gecikme faizi işliyor ve kredi notu etkileniyor. En azından asgari tutarı bugün ödeyin.`,
              true,
            );
          }
        }

        // Durum tazele (son ödeme geçtiyse GECIKTI'ye çek)
        if (kalanGun < 0 && e.borcTutari !== null && e.durum !== 'GECIKTI') {
          const kalanTutar = Math.max(Number(e.borcTutari) - Number(e.odenenTutar), 0);
          if (kalanTutar > 0) {
            await this.db.butceKartEkstre.update({ where: { id: e.id }, data: { durum: 'GECIKTI' } });
          }
        }

        if (yeni.length > 0) {
          await this.db.butceKartEkstre.update({
            where: { id: e.id },
            data: { hatirlatmalar: [...gonderilen, ...yeni] },
          });
        }
      }

      // Kredi taksitleri: ödeme gününe 2 gün kala
      const borclar = await this.db.butceBorc.findMany({
        where: { tenantId: k.tenantId, userId: k.userId, durum: 'AKTIF' },
      });
      for (const b of borclar) {
        const gunSayisi = new Date(Date.UTC(bugun.getUTCFullYear(), bugun.getUTCMonth() + 1, 0)).getUTCDate();
        const odemeGunu = Math.min(b.odemeGunu, gunSayisi);
        const fark = odemeGunu - bugun.getUTCDate();
        if (fark === 2) {
          await this.bildir(
            k,
            ayar,
            `${b.ad} — taksit ödemesi 2 gün sonra`,
            `${this.para(Number(b.taksitTutari))} TL taksit ${odemeGunu}. gün ödenecek. Kalan anapara: ${this.para(Number(b.kalanAnapara))} TL.`,
            false,
          );
        }
      }
    } catch (e: any) {
      this.logger.error(`[ButceCron] tarama hatası: ${e?.message || e}`);
    }
  }

  /** Ayın 1'i 09:30 — aylık özet + o ayın ödeme planı */
  @Cron('30 9 1 * *', { timeZone: 'Europe/Istanbul' })
  async aylikOzet() {
    const k = await this.sahip();
    if (!k) return;
    try {
      const ayar = await this.butce.ayarGetir(k);
      const oncekiDonem = donemKaydir(new Date().toISOString().slice(0, 7), -1);
      const ozet = await this.butce.ozet(k, oncekiDonem);
      const plan = await this.butce.plan(k, {});
      const ilkAy = plan.secilen.ilkAy
        .filter((x) => x.toplam > 0)
        .map((x) => `• ${x.ad}: ${this.para(x.toplam)} TL`)
        .join('\n');

      const mesaj = [
        `${oncekiDonem} özeti`,
        `Gelir: ${this.para(ozet.gelir)} TL`,
        `Gider: ${this.para(ozet.gider)} TL`,
        `Kalan: ${this.para(ozet.net)} TL`,
        '',
        `Toplam borç: ${this.para(ozet.borcOzet.toplam)} TL`,
        `Bu ay ödeme kapasitesi: ${this.para(plan.kapasite)} TL`,
        '',
        'Bu ay önerilen dağılım:',
        ilkAy || '• Borç kaydı yok',
        plan.secilen.ayAdedi
          ? `\nBu tempoda borçsuz kalma: ${plan.secilen.ayAdedi} ay sonra.`
          : '\nBu kapasiteyle borç kapanmıyor — kapasiteyi artırmak gerekiyor.',
      ].join('\n');

      await this.bildir(k, ayar, `Aylık bütçe özeti — ${oncekiDonem}`, mesaj, false);
    } catch (e: any) {
      this.logger.error(`[ButceCron] aylık özet hatası: ${e?.message || e}`);
    }
  }

  /* ===================== ORTAK ===================== */

  private para(n: number): string {
    return Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private tarih(d: Date | string): string {
    return new Date(d).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  /**
   * Bildirim: portal zili (yalnız sahibin kullanıcısına) + WhatsApp.
   * Bildirim kaydı userId ile yazılır; başka kullanıcı bu bildirimi görmez.
   */
  private async bildir(
    k: { tenantId: string; userId: string },
    ayar: any,
    baslik: string,
    mesaj: string,
    kritik: boolean,
  ) {
    if (ayar.hatirlatmaPortal) {
      await this.notifications
        .create({
          tenantId: k.tenantId,
          userId: k.userId,
          title: baslik,
          body: mesaj,
          type: kritik ? 'BUTCE_KRITIK' : 'BUTCE',
          metadata: { modul: 'butce' },
          dedupeKey: `butce:${baslik}`,
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
          .sendMessage(numara, `${kritik ? '🔴' : '💳'} ${baslik}\n\n${mesaj}`, k.tenantId)
          .catch((e: any) => this.logger.warn(`WhatsApp gönderilemedi: ${e?.message || e}`));
      }
    }
  }
}
