/**
 * ANLIK BİLDİRİM (push) modülü — apps/api/src/push. PrismaModule global; Passport stratejileri
 * ('jwt' AuthModule, 'taxpayer-jwt' TaxpayerPortalModule) uygulama genelinde kayıtlı, import gerekmez.
 */
import { Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { PushKimlikGuard } from './push-kimlik.guard';
import { PushService } from './push.service';

@Module({
  controllers: [PushController],
  providers: [PushService, PushKimlikGuard],
  exports: [PushService],
})
export class PushModule {}
