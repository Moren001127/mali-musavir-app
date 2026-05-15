import { Module } from '@nestjs/common';
import { MorenAiController } from './moren-ai.controller';
import { MorenAiService } from './moren-ai.service';
import { ToolExecutorService } from './tool-executor.service';
import { VoiceService } from './voice.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MorenAiController],
  providers: [MorenAiService, ToolExecutorService, VoiceService],
  // ToolExecutorService tek MOREN AI beynidir; portal verisi ve operasyon
  // aksiyonlari buradan yurutulur.
  exports: [MorenAiService, ToolExecutorService],
})
export class MorenAiModule {}
