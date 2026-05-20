import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MorenAiModule } from '../moren-ai/moren-ai.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { ActionDispatcherService } from './action-dispatcher.service';
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
  imports: [PrismaModule, ScheduleModule.forRoot(), MorenAiModule, NotificationsModule, WhatsAppModule],
  controllers: [AutomationsController],
  providers: [
    AutomationsService,
    AutomationParserService,
    ActionDispatcherService,
    AutomationRunnerService,
    AutomationEventBus,
  ],
  exports: [
    AutomationsService,
    AutomationParserService,
    AutomationRunnerService,
    AutomationEventBus,
  ],
})
export class AutomationsModule {}
