import { Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppBotController } from './whatsapp-bot.controller';
import { WhatsAppIntegrationController } from './whatsapp-integration.controller';
import { WhatsAppQualityController } from './whatsapp-quality.controller';
import { IntentClassifierService } from './intent-classifier.service';
import { WhatsAppBotContextService } from './bot-context.service';
import { WhatsAppBotPostFilterService } from './bot-post-filter.service';
import { WhatsAppRateLimiterService } from './rate-limiter.service';
import { BotEvalService } from './bot-eval.service';
import { QualityLogService } from './quality-log.service';
import { BotTestRunnerService } from './bot-test-runner.service';
import { BotQACron } from '../schedule/bot-qa.cron';
import { PrismaModule } from '../prisma/prisma.module';
import { MorenAiModule } from '../moren-ai/moren-ai.module';
import { StorageModule } from '../storage/storage.module';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, MorenAiModule, StorageModule, EmailModule, NotificationsModule],
  providers: [
    WhatsAppService,
    IntentClassifierService,
    WhatsAppBotContextService,
    WhatsAppBotPostFilterService,
    WhatsAppRateLimiterService,
    BotEvalService,
    QualityLogService,
    BotTestRunnerService,
    BotQACron,
  ],
  controllers: [WhatsAppController, WhatsAppBotController, WhatsAppIntegrationController, WhatsAppQualityController],
  exports: [WhatsAppService, QualityLogService, BotTestRunnerService],
})
export class WhatsAppModule {}
