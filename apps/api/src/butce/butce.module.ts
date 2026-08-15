import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { ButceController } from './butce.controller';
import { ButceService } from './butce.service';
import { ButceAiService } from './butce-ai.service';
import { ButceEkstreImportService } from './butce-ekstre-import.service';
import { ButceCron } from './butce.cron';
import { ButcePinService } from './butce-pin.service';
import { ButcePinGuard } from './butce-pin.guard';

/** Kişisel Bütçe & Borç Yönetimi — owner-only modül */
@Module({
  imports: [PrismaModule, NotificationsModule, WhatsAppModule],
  controllers: [ButceController],
  providers: [ButceService, ButceAiService, ButceEkstreImportService, ButceCron, ButcePinService, ButcePinGuard],
  exports: [ButceService],
})
export class ButceModule {}
