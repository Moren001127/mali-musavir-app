import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MorenAiModule } from '../moren-ai/moren-ai.module';
import { LucaModule } from '../luca/luca.module';
import { CalisanModule } from '../calisan/calisan.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { AutomationsModule } from '../automations/automations.module';
import { EkipController } from './ekip.controller';
import { EkipRunnerService } from './ekip-runner.service';
import { KoordinatorService } from './koordinator.service';
import { EkipOnayService } from './ekip-onay.service';
import { EkipAkisService } from './ekip-akis.service';

/**
 * EKİP — ajan kadrosu omurgası (PLAN/13-AJAN-KADROSU.md Faz A+D).
 * Araç defteri + yetki kademesi + iş dosyası + dönem panosu + koordinatör.
 * Mevcut modüllere yalnız bağımlılıkla bağlanır; migration yok.
 */
@Module({
  imports: [PrismaModule, MorenAiModule, LucaModule, CalisanModule, WhatsAppModule, AutomationsModule],
  controllers: [EkipController],
  providers: [EkipRunnerService, KoordinatorService, EkipOnayService, EkipAkisService],
  exports: [EkipRunnerService, KoordinatorService, EkipOnayService, EkipAkisService],
})
export class EkipModule {}
