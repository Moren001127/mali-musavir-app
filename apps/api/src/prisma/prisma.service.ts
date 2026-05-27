import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

type NotificationCreatedCallback = (notification: any) => void;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private notificationCreatedCallbacks: NotificationCreatedCallback[] = [];

  async onModuleInit() {
    await this.$connect();

    // Middleware: her Notification.create sonrasi callbacks tetiklenir.
    // OwnerNotifierService bu sayede portala dusen butun bildirimleri yakalayip
    // owner'a WhatsApp mesaji ile iletebilir (tek noktadan, kod degisikligi yok).
    this.$use(async (params, next) => {
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

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Notification olusturuldugunda tetiklenen callback kaydeder. */
  onNotificationCreated(cb: NotificationCreatedCallback): void {
    this.notificationCreatedCallbacks.push(cb);
  }
}
