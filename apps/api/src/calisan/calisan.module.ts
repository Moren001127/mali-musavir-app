import { Module } from '@nestjs/common';
import { CalisanController } from './calisan.controller';
import { CalisanService } from './calisan.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MorenAiModule } from '../moren-ai/moren-ai.module';

/**
 * Moren Portal Çalışanı — izole modül (mevcut modüllere dokunmaz).
 * Müdür yok, öğrenme açık, model: kritik belge → Opus 4.8 / diğer → Sonnet 4.6.
 */
@Module({
  imports: [PrismaModule, MorenAiModule],
  controllers: [CalisanController],
  providers: [CalisanService],
  exports: [CalisanService],
})
export class CalisanModule {}
