import { Module } from '@nestjs/common';
import { AkilliBildirimService } from './akilli-bildirim.service';
import { AkilliBildirimController } from './akilli-bildirim.controller';
import { AkilliBildirimCron } from './akilli-bildirim.cron';
import { AylikOdemeService } from './aylik-odeme.service';
import { AylikOdemeController } from './aylik-odeme.controller';
import { StorageModule } from '../storage/storage.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [StorageModule, WhatsAppModule, EmailModule],
  controllers: [AkilliBildirimController, AylikOdemeController],
  providers: [AkilliBildirimService, AkilliBildirimCron, AylikOdemeService],
  exports: [AkilliBildirimService, AylikOdemeService],
})
export class AkilliBildirimModule {}
