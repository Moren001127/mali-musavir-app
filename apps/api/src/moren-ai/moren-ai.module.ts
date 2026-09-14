import { Module } from '@nestjs/common';
import { MorenAiController } from './moren-ai.controller';
import { MorenAiService } from './moren-ai.service';
import { ToolExecutorService } from './tool-executor.service';
import { VoiceService } from './voice.service';
import { PrismaModule } from '../prisma/prisma.module';
import { KdvBeyannameModule } from '../kdv-beyanname/kdv-beyanname.module';

@Module({
  // KdvBeyannameModule: get_kdv1_on_hazirlik aracı KdvBeyannameService'i kullanır (döngü yok —
  // o modül yalnız Prisma/Notifications/BeyanKayitlari alır). Servis ToolExecutor'da
  // moduleRef.get(strict:false) ile çözülür; import bağımlılığı açıkça belgelemek için.
  imports: [PrismaModule, KdvBeyannameModule],
  controllers: [MorenAiController],
  providers: [MorenAiService, ToolExecutorService, VoiceService],
  // ToolExecutorService tek MOREN AI beynidir; portal verisi ve operasyon
  // aksiyonlari buradan yurutulur.
  // VoiceService: WhatsApp botu sahibin sesli notunu çevirip sesli cevap üretir (PLAN/19 §D, 2026-09-14).
  exports: [MorenAiService, ToolExecutorService, VoiceService],
})
export class MorenAiModule {}
