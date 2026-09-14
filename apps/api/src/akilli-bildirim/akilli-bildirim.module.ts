import { Module } from '@nestjs/common';
import { AkilliBildirimService } from './akilli-bildirim.service';
import { AkilliBildirimController } from './akilli-bildirim.controller';
import { AkilliBildirimCron } from './akilli-bildirim.cron';
import { AylikOdemeService } from './aylik-odeme.service';
import { AylikOdemeController } from './aylik-odeme.controller';
import { AylikOdemeCron } from './aylik-odeme.cron';
import { ShortLinkController, ShortLinkService } from './short-link.controller';
import { StorageModule } from '../storage/storage.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { EmailModule } from '../email/email.module';
import { BeyannameTakipModule } from '../beyanname-takip/beyanname-takip.module';
import { NotificationsModule } from '../notifications/notifications.module';

import { SgkTeshisController } from './sgk-teshis.controller';

@Module({
  imports: [StorageModule, WhatsAppModule, EmailModule, BeyannameTakipModule, NotificationsModule],
  controllers: [AkilliBildirimController, AylikOdemeController, ShortLinkController, SgkTeshisController],
  providers: [AkilliBildirimService, AkilliBildirimCron, AylikOdemeService, AylikOdemeCron, ShortLinkService],
  exports: [AkilliBildirimService, AylikOdemeService, ShortLinkService],
})
export class AkilliBildirimModule {}
