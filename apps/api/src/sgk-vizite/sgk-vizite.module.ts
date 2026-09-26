import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SgkViziteController } from './sgk-vizite.controller';
import { SgkViziteService } from './sgk-vizite.service';

/**
 * SGK e-Rapor (vizite) + hastane iş kazası (2026-09-26) — SGK WS_Vizite web servisi.
 * Tarayıcı / güvenlik kodu / SMS yok; gece 02:30 + elle sorgu; onay ve "personelim değil" kullanıcı düğmesiyle.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [SgkViziteController],
  providers: [SgkViziteService],
  exports: [SgkViziteService],
})
export class SgkViziteModule {}
