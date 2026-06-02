import { Module } from '@nestjs/common';
import { CalisanController } from './calisan.controller';
import { CalisanService } from './calisan.service';
import { LucaOperatorController } from './luca-operator.controller';
import { LucaOperatorService } from './luca-operator.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MorenAiModule } from '../moren-ai/moren-ai.module';

/**
 * Moren Portal Çalışanı — izole modül (mevcut modüllere dokunmaz).
 * Müdür yok, öğrenme açık, model: kritik belge → Opus 4.8 / diğer → Sonnet 4.6.
 * Luca Operatörü: Max + araçlı sohbet (MorenAiModule'den ToolExecutorService kullanır).
 */
@Module({
  imports: [PrismaModule, MorenAiModule],
  controllers: [CalisanController, LucaOperatorController],
  providers: [CalisanService, LucaOperatorService],
  exports: [CalisanService, LucaOperatorService],
})
export class CalisanModule {}
