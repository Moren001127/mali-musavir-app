import { Injectable, OnModuleInit, OnApplicationShutdown, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { bildirimPolitikasi } from '../notifications/notification-policy';

type NotificationCreatedCallback = (notification: any) => void;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name);
  private notificationCreatedCallbacks: NotificationCreatedCallback[] = [];

  async onModuleInit() {
    await this.$connect();

    // Middleware: her Notification.create sonrasi callbacks tetiklenir.
    // OwnerNotifierService bu sayede portala dusen butun bildirimleri yakalayip
    // owner'a WhatsApp mesaji ile iletebilir (tek noktadan, kod degisikligi yok).
    this.$use(async (params, next) => {
      // BİLDİRİM POLİTİKASI (2026-09-14): bazı üreticiler (kilitli kdv-control dahil) NotificationsService'i
      //   atlayıp doğrudan prisma.notification.create çağırıyor. Kopya / bilgi-kirliliği kuralları burada da
      //   uygulanır; "atla" ise kayıt AÇILMAZ, WhatsApp/push kancaları da tetiklenmez.
      if (params.model === 'Notification' && params.action === 'create') {
        try {
          const karar = bildirimPolitikasi(params.args?.data || {});
          if (karar.atla) {
            this.logger.debug(`Bildirim politika ile atlandi (${params.args?.data?.type}): ${karar.neden || ''}`);
            return { id: 'policy-skipped', skipped: true, neden: karar.neden };
          }
        } catch (err: any) {
          this.logger.warn(`Bildirim politikasi hatasi (uretime devam): ${err?.message || err}`);
        }
      }
      const result = await next(params);
      if (params.model === 'Notification' && (params.action === 'create' || params.action === 'createMany')) {
        const items = params.action === 'create' ? [result] : (Array.isArray(result) ? result : []);
        for (const item of items) {
          for (const cb of this.notificationCreatedCallbacks) {
            try {
              cb(item);
            } catch (err: any) {
              this.logger.warn(`Notification callback hatasi: ${err?.message || err}`);
            }
          }
        }
      }
      return result;
    });
  }

  /**
   * Bağlantı EN SON kapanır (onApplicationShutdown; onModuleDestroy DEĞİL): dağıtımda SIGTERM gelince
   * süren ekip koşuları (EkipRunnerService.onApplicationShutdown drenajı) sonucunu iş dosyasına yazabilsin — 2026-09-15.
   */
  async onApplicationShutdown() {
    await this.$disconnect();
  }

  /** Notification olusturuldugunda tetiklenen callback kaydeder. */
  onNotificationCreated(cb: NotificationCreatedCallback): void {
    this.notificationCreatedCallbacks.push(cb);
  }
}
