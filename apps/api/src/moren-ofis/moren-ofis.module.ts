import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MorenAiModule } from '../moren-ai/moren-ai.module';
import { MorenOfisService } from './moren-ofis.service';
import { MorenOfisController } from './moren-ofis.controller';
import { OpenRouterAdapter } from './providers/openrouter.adapter';
import { MorenOfisMemoryService } from './memory.service';
import { MorenOfisPatrolService } from './patrol.service';

// FAZ 1 — MorenAiModule'u import ediyoruz ki ToolExecutorService paylaşılsın.
// Tek araç beyni (tool-core), iki ekip ortak kullanır. Yeni tool eklenirse
// MoreAi'de tanımlanır, hem tek-ajan hem Ofis ekibi otomatik görür.
@Module({
  imports: [PrismaModule, MorenAiModule],
  providers: [MorenOfisService, OpenRouterAdapter, MorenOfisMemoryService, MorenOfisPatrolService],
  controllers: [MorenOfisController],
  exports: [MorenOfisService, MorenOfisMemoryService, MorenOfisPatrolService],
})
export class MorenOfisModule {}
