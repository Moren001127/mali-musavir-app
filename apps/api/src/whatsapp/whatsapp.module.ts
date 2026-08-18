import { forwardRef, Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { BaileysService } from './baileys.service';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppBotController } from './whatsapp-bot.controller';
import { WhatsAppIntegrationController } from './whatsapp-integration.controller';
import { WhatsAppQualityController } from './whatsapp-quality.controller';
import { CalisanModule } from '../calisan/calisan.module';
import { IntentClassifierService } from './intent-classifier.service';
import { WhatsAppBotContextService } from './bot-context.service';
import { WhatsAppBotPostFilterService } from './bot-post-filter.service';
import { WhatsAppRateLimiterService } from './rate-limiter.service';
import { WhatsAppBotCacheService } from './bot-cache.service';
import { BotEvalService } from './bot-eval.service';
import { QualityLogService } from './quality-log.service';
import { BotTestRunnerService } from './bot-test-runner.service';
import { BotQACron } from '../schedule/bot-qa.cron';
import { OwnerNotifierService } from './owner-notifier.service';
import { OwnerBriefingCron } from './owner-briefing.cron';
import { OwnerDigestService } from './owner-digest.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MorenAiModule } from '../moren-ai/moren-ai.module';
import { StorageModule } from '../storage/storage.module';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ButceModule } from '../butce/butce.module';
import { EvrakMesajService } from '../schedule/evrak-mesaj.service';

@Module({
  imports: [forwardRef(() => ButceModule), PrismaModule, MorenAiModule, StorageModule, EmailModule, NotificationsModule, CalisanModule],
  providers: [
    // Durumsuz servis (cron/dinleyici yok), bu yuzden AppModule'deki ornekten
    // ayri bir ornek olusmasi zararsiz. ReminderCron'da AYNI SEYI YAPMA:
    // orada ikinci ornek cron'u iki kez calistirir.
    EvrakMesajService,
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
    OwnerNotifierService,
    OwnerBriefingCron,
    OwnerDigestService,
  ],
  controllers: [WhatsAppController, WhatsAppBotController, WhatsAppIntegrationController, WhatsAppQualityController],
  exports: [WhatsAppService, QualityLogService, BotTestRunnerService],
})
export class WhatsAppModule {}
