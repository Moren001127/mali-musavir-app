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
  // ToolExecutorService dışarıya açılır — Moren Ofis (7 ajan) ve ileride
  // Portal Geliştirme (5 ajan) aynı tool beynini paylaşır. Tek yerde tanımlı.
  exports: [MorenAiService, ToolExecutorService],
})
export class MorenAiModule {}
