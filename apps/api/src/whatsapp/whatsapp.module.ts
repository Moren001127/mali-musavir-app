import { Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppBotController } from './whatsapp-bot.controller';
import { WhatsAppIntegrationController } from './whatsapp-integration.controller';
import { IntentClassifierService } from './intent-classifier.service';
import { WhatsAppBotContextService } from './bot-context.service';
import { WhatsAppBotPostFilterService } from './bot-post-filter.service';
import { WhatsAppRateLimiterService } from './rate-limiter.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MorenAiModule } from '../moren-ai/moren-ai.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [PrismaModule, MorenAiModule, StorageModule],
  providers: [
    WhatsAppService,
    IntentClassifierService,
    WhatsAppBotContextService,
    WhatsAppBotPostFilterService,
    WhatsAppRateLimiterService,
  ],
  controllers: [WhatsAppController, WhatsAppBotController, WhatsAppIntegrationController],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
