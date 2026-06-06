import {
  Injectable,
  Logger,
  Optional,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { AutomationEventBus } from '../automations/automation-event-bus.service';
import { KdvBeyannameService } from './kdv-beyanname.service';

/**
 * KDV otomatik çekim dinleyicisi.
 *
 * Mükellefin aylık kontrolü tamamlanınca (evrak geldi+işlendi + indirilecek +
 * hesaplanan + e-arşiv kontrol hepsi true) taxpayers servisi
 * `Taxpayer.KdvKontrolTamam` event'i yayınlar. Burada dinleyip:
 *   - BİLANÇO mükellef → Luca KDV mizan job'u (191/391/190) otomatik açılır.
 *   - İŞLETME defteri → mizan yoktur; gelir-gider snapshot'ı (FAZ 2) açılacak.
 *
 * Manuel "Luca'dan Çek" butonuyla aynı `fetchLucaSnapshot`'ı kullanır; tekrar
 * önleme orada (aynı dönem için bekleyen/çalışan job varsa yenisi açılmaz).
 */
@Injectable()
export class KdvAutoFetchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KdvAutoFetchService.name);
  private unsubscribe?: () => void;

  constructor(
    private readonly kdvBeyanname: KdvBeyannameService,
    @Optional() private readonly eventBus?: AutomationEventBus,
  ) {}

  onModuleInit() {
    if (!this.eventBus) {
      this.logger.warn('AutomationEventBus yok — KDV otomatik çekim devre dışı.');
      return;
    }
    this.unsubscribe = this.eventBus.on('Taxpayer.KdvKontrolTamam', (payload) =>
      this.handle(payload),
    );
    this.logger.log('KDV otomatik çekim aktif (Taxpayer.KdvKontrolTamam dinleniyor).');
  }

  onModuleDestroy() {
    this.unsubscribe?.();
  }

  private async handle(payload: Record<string, any>) {
    const tenantId = payload?.tenantId;
    const taxpayerId = payload?.taxpayerId;
    const donem = payload?.donem;
    if (!tenantId || !taxpayerId || !donem) return;
    try {
      // Bilanço → Luca KDV mizan. İşletme defteri mükellefte fetchLucaSnapshot
      // "mizan uygulanmaz" diye reddeder → yakalanır (FAZ 2: işletme gelir-gider).
      const res = await this.kdvBeyanname.fetchLucaSnapshot({
        tenantId,
        mukellefId: taxpayerId,
        donem,
      });
      this.logger.log(
        `[OTO-KDV] ${taxpayerId} ${donem}: Luca mizan job ${res.jobId} (${res.status}${(res as any).reused ? ', mevcut' : ''}).`,
      );
    } catch (e: any) {
      this.logger.log(
        `[OTO-KDV] ${taxpayerId} ${donem}: mizan çekilmedi (${e?.message || e}).`,
      );
    }
  }
}
