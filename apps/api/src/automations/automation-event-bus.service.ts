import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';

/**
 * Otomasyon olay otobüsü — in-process pub/sub.
 *
 * Domain modülleri (Taxpayers, Documents, WhatsApp, Beyanname vb.) bir şey
 * olduğunda burada `emit('Event.Name', payload)` yapar.
 *
 * AutomationRunnerService boot'ta ACTIVE + EVENT otomasyonları için listener
 * kayıt eder. Bir event geldiğinde uygun otomasyonları yürütür.
 *
 * Neden NestJS @EventPattern veya Bus değil de Node EventEmitter?
 *  - Bağımlılık eklemekten kaçınma (ekstra paket yok).
 *  - Same-process kullanım — distributed mesajlaşma gerek yok.
 *  - Faz 5'in MVP'si için yeterli; ileride Redis pub/sub'a (Bull mevcut) geçilebilir.
 *
 * Event isimleri PASCAL.PascalCase formatında (örn. Taxpayer.EvrakDurumuChanged).
 * Tüm payload'larda `tenantId` ZORUNLU — multi-tenant izolasyonu runner'da
 * filtre yaparken kullanılır.
 */
@Injectable()
export class AutomationEventBus {
  private readonly logger = new Logger(AutomationEventBus.name);
  private readonly emitter = new EventEmitter();

  constructor() {
    // Çok sayıda otomasyon aynı event'i dinleyebilir — limit yükseltilir
    this.emitter.setMaxListeners(100);
  }

  /**
   * Bir olayı yayınla. Domain servisleri bunu çağırır.
   *
   * @param eventName Catalog'daki standard isim (örn. "Taxpayer.EvrakDurumuChanged")
   * @param payload Olay verisi — tenantId MUTLAKA dahil edilmeli.
   */
  emit(eventName: string, payload: Record<string, unknown> & { tenantId: string }): void {
    if (!payload?.tenantId) {
      this.logger.warn(
        `Event "${eventName}" tenantId olmadan yayınlandı — yok sayıldı.`,
      );
      return;
    }
    this.logger.debug(`emit ${eventName} tenant=${payload.tenantId}`);
    try {
      this.emitter.emit(eventName, payload);
    } catch (err: any) {
      // Listener içinde hata olursa diğer listener'ları etkilemesin
      this.logger.error(`emit ${eventName} hata: ${err.message}`);
    }
  }

  /**
   * Olay dinleyicisi kaydet. Runner bunu çağırır.
   *
   * @returns unsubscribe fonksiyonu
   */
  on(
    eventName: string,
    handler: (payload: Record<string, unknown> & { tenantId: string }) => void | Promise<void>,
  ): () => void {
    const safeHandler = (payload: any) => {
      try {
        const result = handler(payload);
        if (result instanceof Promise) {
          result.catch((err) =>
            this.logger.error(`Listener "${eventName}" hatası: ${err?.message}`),
          );
        }
      } catch (err: any) {
        this.logger.error(`Listener "${eventName}" sync hatası: ${err.message}`);
      }
    };
    this.emitter.on(eventName, safeHandler);
    return () => this.emitter.off(eventName, safeHandler);
  }

  /** Belirli bir event'in mevcut listener sayısı (debug için) */
  listenerCount(eventName: string): number {
    return this.emitter.listenerCount(eventName);
  }
}
