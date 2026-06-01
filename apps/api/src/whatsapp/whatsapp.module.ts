import { Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { BaileysService } from './baileys.service';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppBotController } from './whatsapp-bot.controller';
import { WhatsAppIntegrationController } from './whatsapp-integration.controller';
import { WhatsAppQualityController } from './whatsapp-quality.controller';
import { BotDataController } from './bot-data.controller';
import { IntentClassifierService } from './intent-classifier.service';
import { WhatsAppBotContextService } from './bot-context.service';
import { WhatsAppBotPostFilterService } from './bot-post-filter.service';
import { WhatsAppRateLimiterService } from './rate-limiter.service';
import { WhatsAppBotCacheService } from './bot-cache.service';
import { BotEvalService } from './bot-eval.service';
import { QualityLogService } from './quality-log.service';
import { BotTestRunnerService } from './bot-test-runner.service';
import { BotQACron } from '../schedule/bot-qa.cron';
import { BuseGunaydinCron } from '../schedule/buse-gunaydin.cron';
import { OwnerNotifierService } from './owner-notifier.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MorenAiModule } from '../moren-ai/moren-ai.module';
import { StorageModule } from '../storage/storage.module';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, MorenAiModule, StorageModule, EmailModule, NotificationsModule],
  providers: [
    WhatsAppService,
    BaileysService,
    IntentClassifierService,
    WhatsAppBotContextService,
    WhatsAppBotPostFilterService,
    WhatsAppRateLimiterService,
    WhatsAppBotCacheService,
    BotEvalService,
    QualityLogService,
    BotTestRunnerService,
    BotQACron,
    BuseGunaydinCron,
    OwnerNotifierService,
  ],
  controllers: [WhatsAppController, WhatsAppBotController, WhatsAppIntegrationController, WhatsAppQualityController, BotDataController],
  exports: [WhatsAppService, QualityLogService, BotTestRunnerService],
})
export class WhatsAppModule {}
