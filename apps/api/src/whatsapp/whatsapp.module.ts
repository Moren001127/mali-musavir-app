import { Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppBotController } from './whatsapp-bot.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { MorenAiModule } from '../moren-ai/moren-ai.module';

@Module({
  imports: [PrismaModule, MorenAiModule],
  providers: [WhatsAppService],
  controllers: [WhatsAppController, WhatsAppBotController],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
