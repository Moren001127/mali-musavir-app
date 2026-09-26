import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { FaturaMuhasebelestirmeService } from './fatura-muhasebelestirme.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notification-types';
import {
  GECE_CRON_IFADESI,
  GECE_KANALLARI,
  GeceKosuOzeti,
  GecePlanSatiri,
  TAKILI_IS_ESIGI_MS,
  TAKILI_IS_MESAJI,
  GECE_BEKLEME_GUN,
  earsivDesteksizMi,
  geceCekimEnvKapaliMi,
  geceDonemleri,
  gecePlaniOlustur,
  geceSonTarih,
  istanbulSaati,
  istanbulTarihi,
} from './gece-cekim';

/**
 * Fatura Merkezi — gece scheduler (PLAN/16 §H: HAZIR ama VARSAYILAN KAPALI).
 *
 * IntegrationConnection.config.taxpayers[taxpayerId].talimat === true olan her sağlayıcı+mükellef
 * satırı, kendi `saat`inde (HH:MM, 00:00–06:59; yoksa 02:00) çekilir. Her entegratör için ÜÇ KANAL
 * ayrı ayrı çalışır: Alış e-Fatura (IN_EFATURA), Satış e-Fatura (OUT_EFATURA), Satış e-Arşiv (OUT_EARSIV).
 * TARİH (kullanıcı kararı 2026-09-26): fatura tarihi SON 10 GÜN içinde olanlar HİÇ alınmaz — iptal/red süresi
 *   (GECE_BEKLEME_GUN). 26.09 gecesi 01.09–16.09 arası gelir; 17.09+ süre dolunca sonraki gecelerde gelir, o arada
 *   iptal/red olmuşsa hiç gelmez (fetchConfiguredIntegrations sonTarih + iptal/red kapısı).
 * Dönem: son tarihin (bugün − 10 gün) ayı; son tarih ayın ilk 15 günündeyse önceki ay da taranır (geç düşenler için).
 * Gece çekimi belgeyi YALNIZ portala getirir; Luca'ya aktarım kullanıcı onayıyla yapılır.
 *
 * Cron: her saat başı 00:05 … 06:05 (Europe/Istanbul); her tikte yalnız saati o saate denk gelenler
 * işlenir (dakika yok sayılır). e-Beyanname runner 02:15'te çalışıyor; 02:00 varsayılanı 02:05'te
 * tetiklenir ve ondan önce biter/paralel gider — entegratör çağrıları Luca/GİB oturumu kullanmaz.
 *
 * Kapılar (hepsi geçmeli):
 *   1) NIGHTLY_EFATURA env'i off|0|false|kapali ise HİÇBİR ŞEY çekilmez (global kill-switch).
 *   2) talimat === true olmayan mükellef ASLA çekilmez (talimat 'global' anahtarında açılamaz).
 *
 * ESKİ İKİNCİ ÇEKİM SİSTEMİ KALDIRILDI (2026-09-26): adaptör tabanlı efatura_inbox senkronu
 *   (efatura-adapters/efatura-sync.service.ts → syncAll) artık gece ÇAĞRILMAZ. Ana yolun yanında ikinci
 *   kez çalışıp eLogo'ya hatalı giriş yapıyor (kilit riski), faturaları entegratörde "alındı" işaretliyor
 *   (başka programlar göremiyordu) ve Uyumsoft'un eski adresine gidiyordu. Tek yol: fetchConfiguredIntegrations.
 *
 * e-Arşiv desteklemeyen entegratörde OUT_EARSIV kanalı "e-Arşiv yok" döner — HATA SAYILMAZ, bildirim yapılmaz.
 *
 * Her satırın sonucu AuditLog(action 'GECE_CEKIM', resource 'gece-cekim') kaydına yazılır:
 *   { tarih, taxpayerId, provider, alis, satis, hata, sure, kanallar, notlar } — sabah özeti (Koordinatör) buradan okur.
 */
@Injectable()
export class FaturaMuhasebelestirmeCron {
  private readonly logger = new Logger(FaturaMuhasebelestirmeCron.name);
  private running = false;
  /** Tek çağrı için üst süre sınırı — asılan bir entegratör çağrısı tüm gece akışını kilitlemesin (10 dk). */
  private static readonly OP_TIMEOUT_MS = 10 * 60 * 1000;

  /** Bir promise'i üst süre ile sar; sürede bitmezse reddet (sonsuz askıyı önler, süreyi kısaltmaz). */
  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`zaman aşımı (${label}, ${Math.round(ms / 60000)} dk)`)),
        ms,
      );
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly service: FaturaMuhasebelestirmeService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(GECE_CRON_IFADESI, { timeZone: 'Europe/Istanbul' })
  async nightlyTick() {
    if (geceCekimEnvKapaliMi()) {
      this.logger.log('Gece e-Fatura çekimi env ile KAPALI (NIGHTLY_EFATURA) — hiçbir şey çekilmedi.');
      return;
    }
    if (this.running) {
      const saat = istanbulSaati(new Date());
      this.kacanSaatler.add(saat);
      this.logger.warn(`Önceki gece akışı hâlâ çalışıyor — saat ${String(saat).padStart(2, '0')} mükellefleri sıraya alındı, bitince işlenecek.`);
      return;
    }
    this.running = true;
    try {
      await this.runNightly(new Date());
    } catch (err: any) {
      this.logger.error(`Gece akışı hata: ${err?.message || err}`);
    }
    // TELAFİ (2026-09-26): bu koşu sürerken gelen saatler. Eskiden "tik atlanıyor" deniyordu → o saatin
    //   mükellefleri o gece HİÇ işlenmiyordu (her mükellefte 3 kanal × 1-2 dönem çağrısı var; koşu saati aşabilir).
    try {
      while (this.kacanSaatler.size) {
        const saat = Math.min(...this.kacanSaatler);
        this.kacanSaatler.delete(saat);
        try {
          await this.runNightly(new Date(), saat);
        } catch (err: any) {
          this.logger.error(`Gece akışı telafi (saat ${saat}) hata: ${err?.message || err}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Önceki koşu sürerken gelen tiklerin İstanbul saatleri — koşu bitince sırayla işlenir. */
  private readonly kacanSaatler = new Set<number>();

  /**
   * TAKILI İŞ TEMİZLİĞİ (2026-09-26): 2 saatten uzun "RUNNING" kalan entegratör çekim işleri
   *   (sunucu yeniden başladı / istek koptu) FAILED + "zaman aşımı — takılı kaldı" yapılır.
   *   Ekranda sonsuza kadar "çalışıyor" görünmesinler. Her 30 dakikada bir, env kapısından bağımsız.
   */
  @Cron('0 20,50 * * * *', { timeZone: 'Europe/Istanbul' })
  async takiliIsTemizligi() {
    try {
      const esik = new Date(Date.now() - TAKILI_IS_ESIGI_MS);
      const r = await (this.prisma as any).integrationJob.updateMany({
        where: {
          status: 'RUNNING',
          OR: [
            { startedAt: { lt: esik } },
            { startedAt: null, createdAt: { lt: esik } },
          ],
        },
        data: { status: 'FAILED', completedAt: new Date(), errorMessage: TAKILI_IS_MESAJI },
      });
      if (r?.count) this.logger.warn(`Takılı entegratör işi temizlendi: ${r.count} iş FAILED (${TAKILI_IS_MESAJI})`);
    } catch (e: any) {
      this.logger.warn(`Takılı iş temizliği hata: ${e?.message || e}`);
    }
  }

  /** Test/elle tetik için: verilen anın Istanbul saatine (ya da telafide verilen saate) denk gelen talimatlı satırları işler. */
  async runNightly(now: Date = new Date(), saatTelafi?: number) {
    // Dönem + gün Istanbul takvimine göre (sunucu UTC: 00:05 İstanbul = önceki gün 21:05 UTC).
    //   Son tarih = bugün − 10 gün (iptal/red süresi); dönemler bu son tarihten türetilir.
    const sonTarih = geceSonTarih(now);
    const donemler = geceDonemleri(now);
    const saat = saatTelafi ?? istanbulSaati(now);

    const tenants = await (this.prisma as any).tenant.findMany({
      select: { id: true },
    });

    for (const tenant of tenants) {
      const plan = await this.planForTenant(tenant.id, saat);
      if (plan.length === 0) {
        this.logger.log(`[Tenant ${tenant.id}] gece akışı (saat ${String(saat).padStart(2, '0')}): bu saate talimatlı mükellef yok`);
        continue;
      }

      const sonuc = await this.runForTenant(tenant.id, donemler, plan, sonTarih);
      if (sonuc.failed > 0) {
        await this.notifyFailures(tenant.id, donemler, sonuc);
      }
    }
  }

  /** Tenant'ın aktif bağlantılarından bu saate düşen talimatlı satırlar. */
  private async planForTenant(tenantId: string, saat: number): Promise<GecePlanSatiri[]> {
    const connections = await (this.prisma as any).integrationConnection.findMany({
      where: { tenantId, isActive: true },
      select: { provider: true, config: true, isActive: true },
    });
    return gecePlaniOlustur(connections, saat);
  }

  /** Gece koşusunda başarısızlık varsa tek toplu portal bildirimi (yalnız özet sayılar). */
  private async notifyFailures(
    tenantId: string,
    donemler: string[],
    sonuc: { alisOk: number; satisOk: number; failed: number },
  ) {
    const todayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());

    await this.notifications.createForTenant({
      tenantId,
      type: NOTIFICATION_TYPES.SYSTEM,
      title: `Gece fatura çekimi: ${sonuc.failed} kaynak başarısız`,
      body: `Dönem ${donemler.join(', ')} — başarılı: alış ${sonuc.alisOk}, satış ${sonuc.satisOk}; başarısız: ${sonuc.failed}.`,
      metadata: {
        alisOk: sonuc.alisOk,
        satisOk: sonuc.satisOk,
        failed: sonuc.failed,
        donemler,
        link: '/panel/faturalar',
      },
      dedupeKey: `fatura-gece-fail:${tenantId}:${todayKey}`,
      dedupeWindowMin: 60 * 20,
    }).catch((e) => {
      this.logger.warn(`Gece fatura bildirim hatası: ${(e as Error).message}`);
    });
  }

  /** Gece sonucu kaydı — AuditLog GECE_CEKIM (sabah özeti + FE geçmişi buradan okur). */
  private async kaydetGeceKosusu(tenantId: string, ozet: GeceKosuOzeti) {
    try {
      await (this.prisma as any).auditLog.create({
        data: {
          tenantId,
          userId: null,
          action: 'GECE_CEKIM',
          resource: 'gece-cekim',
          resourceId: `${ozet.provider}:${ozet.taxpayerId}`,
          newData: ozet,
        },
      });
    } catch (e: any) {
      this.logger.warn(`[Tenant ${tenantId}] GECE_CEKIM kaydı yazılamadı: ${e?.message || e}`);
    }
  }

  private async runForTenant(
    tenantId: string,
    donemler: string[],
    plan: GecePlanSatiri[],
    sonTarih: string,
  ): Promise<{ alisOk: number; satisOk: number; failed: number }> {
    if (plan.length === 0) return { alisOk: 0, satisOk: 0, failed: 0 };

    this.logger.log(
      `[Tenant ${tenantId}] gece akışı: ${plan.length} talimat işleniyor (dönem ${donemler.join(', ')}; fatura tarihi ≤ ${sonTarih}, son ${GECE_BEKLEME_GUN} gün iptal/red süresi için bekletilir)`,
    );

    const tarih = istanbulTarihi(new Date()).ymd;

    // Mükellef başına paralelliği sınırla — Uyumsoft/Izibiz API'larını boğmamak için
    // sıralı işle, her biri ortalama 5-30sn sürer
    let alisOk = 0;
    let satisOk = 0;
    let failed = 0;
    for (const item of plan) {
      const basladi = Date.now();
      const ozet: GeceKosuOzeti = {
        tarih, taxpayerId: item.taxpayerId, provider: item.provider, alis: 0, satis: 0, hata: 0, sure: 0, kanallar: {}, notlar: [],
        sonTarih, bekletilen: 0,
      };
      // e-Arşiv desteksiz entegratörde OUT_EARSIV bir kez "yok" dedikten sonra diğer dönemde tekrar sorulmaz.
      let earsivYok = false;
      for (const donem of donemler) {
        for (const { kanal, direction } of GECE_KANALLARI) {
          if (kanal === 'OUT_EARSIV' && earsivYok) continue;
          const etiket = `${item.provider}/${item.taxpayerId}/${kanal}/${donem}`;
          try {
            // Tek entegratör çağrısı asılırsa timeout ile kesilir; catch bloğu bunu 'failed' sayıp
            // döngüye devam eder — gece akışı bir mükellefte sonsuza kilitlenmesin.
            const r: any = await this.withTimeout(
              this.service.fetchConfiguredIntegrations(
                tenantId,
                {
                  taxpayerId: item.taxpayerId,
                  providers: [item.provider],
                  direction,
                  channel: kanal,
                  donem,
                  sonTarih,
                  limit: 500,
                },
                'scheduler',
              ),
              FaturaMuhasebelestirmeCron.OP_TIMEOUT_MS,
              etiket,
            );
            const durumlar: any[] = Array.isArray(r?.providers) ? r.providers : [];
            const durum = durumlar.find((p) => String(p?.provider || '').toUpperCase() === item.provider) || durumlar[0];
            // e-Arşiv desteksiz → HATA DEĞİL, bildirim YOK; yalnız not düşülür.
            if (kanal === 'OUT_EARSIV' && earsivDesteksizMi(durum)) {
              earsivYok = true;
              const not = `e-Arşiv yok (${item.provider})`;
              if (!ozet.notlar!.includes(not)) ozet.notlar!.push(not);
              continue;
            }
            if (durum?.status === 'FAILED') {
              failed++;
              ozet.hata++;
              this.logger.warn(`[Tenant ${tenantId}] ${etiket} başarısız: ${durum?.reason || durum?.errors?.[0]?.message || '-'}`);
              continue;
            }
            const gelen = Number(r?.created) || 0;
            if (direction === 'ALIS') { alisOk++; ozet.alis += gelen; }
            else { satisOk++; ozet.satis += gelen; }
            ozet.kanallar![kanal] = (ozet.kanallar![kanal] || 0) + gelen;
            ozet.bekletilen = (ozet.bekletilen || 0) + (Number(r?.bekletilen) || 0);
            ozet.hata += Number(r?.failed) || 0;
            for (const w of Array.isArray(r?.warnings) ? r.warnings : []) {
              if (ozet.notlar!.length < 10 && !ozet.notlar!.includes(String(w))) ozet.notlar!.push(String(w));
            }
          } catch (err: any) {
            const mesaj = err?.message || String(err);
            if (kanal === 'OUT_EARSIV' && earsivDesteksizMi({ reason: mesaj })) {
              earsivYok = true;
              const not = `e-Arşiv yok (${item.provider})`;
              if (!ozet.notlar!.includes(not)) ozet.notlar!.push(not);
              continue;
            }
            failed++;
            ozet.hata++;
            this.logger.warn(`[Tenant ${tenantId}] ${etiket} hata: ${mesaj}`);
          }
        }
      }
      ozet.sure = Math.round((Date.now() - basladi) / 1000);
      await this.kaydetGeceKosusu(tenantId, ozet);
    }

    this.logger.log(
      `[Tenant ${tenantId}] gece akışı bitti: alış=${alisOk}, satış=${satisOk}, hata=${failed}`,
    );
    return { alisOk, satisOk, failed };
  }
}
