import { forwardRef, Module } from '@nestjs/common';
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
import { ButceWhatsappService } from './butce-whatsapp.service';
import { ButceFaizOranlariService } from './butce-faiz-oranlari.service';

/** Kişisel Bütçe & Borç Yönetimi — owner-only modül */
@Module({
  imports: [PrismaModule, NotificationsModule, forwardRef(() => WhatsAppModule)],
  controllers: [ButceController],
  providers: [ButceService, ButceAiService, ButceEkstreImportService, ButceCron, ButcePinService, ButcePinGuard, ButceWhatsappService, ButceFaizOranlariService],
  exports: [ButceService, ButceWhatsappService, ButceFaizOranlariService],
})
export class ButceModule {}
