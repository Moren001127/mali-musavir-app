import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MorenAiModule } from '../moren-ai/moren-ai.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { FisYazdirmaModule } from '../fis-yazdirma/fis-yazdirma.module';
import { MihsapModule } from '../mihsap/mihsap.module';
import { EmailModule } from '../email/email.module';
import { KdvBeyannameModule } from '../kdv-beyanname/kdv-beyanname.module';
import { TaxpayersModule } from '../taxpayers/taxpayers.module';
import { DriveModule } from '../drive/drive.module';
import { ActionDispatcherService } from './action-dispatcher.service';
import { OwnerCommandRunnerService } from './owner-command-runner.service';
import { EDefterControlModule } from '../edefter-control/edefter-control.module';
import { LucaModule } from '../luca/luca.module';
import { AutomationEventBus } from './automation-event-bus.service';
import { AutomationParserService } from './automation-parser.service';
import { AutomationRunnerService } from './automation-runner.service';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';

/**
 * Moren AI Otomasyon Motoru.
 *
 *  - Faz 1: AutomationsService (CRUD)
 *  - Faz 2: AutomationParserService (cümle → workflow JSON)
 *  - Faz 3: AutomationRunnerService + ActionDispatcherService ← BU FAZ
 *  - Faz 5: Event listener'lar (agent-events modülüyle entegre)
 *  - Faz 6: OCR + Luca aksiyonlarının gerçek implementasyonu (şimdi stub)
 *
 * Bağımlılıklar:
 *  - MorenAiModule → ToolExecutorService (38 read tool'un yeniden kullanımı)
 *  - NotificationsModule → in-app bildirim oluşturma
 *  - WhatsAppModule → WhatsApp template + freeform mesaj
 *  - ScheduleModule.forRoot() → SchedulerRegistry (cron job'ları için)
 */
@Global()
@Module({
  imports: [PrismaModule, ScheduleModule.forRoot(), MorenAiModule, NotificationsModule, WhatsAppModule, FisYazdirmaModule, MihsapModule, EmailModule, KdvBeyannameModule, TaxpayersModule, DriveModule, EDefterControlModule, LucaModule],
  controllers: [AutomationsController],
  providers: [
    AutomationsService,
    AutomationParserService,
    ActionDispatcherService,
    AutomationRunnerService,
    AutomationEventBus,
    OwnerCommandRunnerService,
  ],
  exports: [
    AutomationsService,
    AutomationParserService,
    AutomationRunnerService,
    AutomationEventBus,
  ],
})
export class AutomationsModule {}
