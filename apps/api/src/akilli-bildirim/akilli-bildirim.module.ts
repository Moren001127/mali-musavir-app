import { Module } from '@nestjs/common';
import { AkilliBildirimService } from './akilli-bildirim.service';
import { AkilliBildirimController } from './akilli-bildirim.controller';
import { AkilliBildirimCron } from './akilli-bildirim.cron';
import { StorageModule } from '../storage/storage.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [StorageModule, WhatsAppModule, EmailModule],
  controllers: [AkilliBildirimController],
  providers: [AkilliBildirimService, AkilliBildirimCron],
  exports: [AkilliBildirimService],
})
export class AkilliBildirimModule {}
