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
import { EkipBekciService } from './ekip-bekci.service';
import { EkipWhatsappService } from './ekip-whatsapp.service';
import { EkipKotaService } from './ekip-kota.service';
import { EkipKuyrukService } from './ekip-kuyruk.service';
import { EkipRutinService } from './ekip-rutin.service';

/**
 * EKİP — ajan kadrosu omurgası (PLAN/13-AJAN-KADROSU.md Faz A+D).
 * Araç defteri + yetki kademesi + iş dosyası + dönem panosu + koordinatör.
 * Mevcut modüllere yalnız bağımlılıkla bağlanır; migration yok.
 * EkipWhatsappService (PLAN/19 §C): WhatsApp botu ↔ Koordinatör köprüsü; bot controller bunu ModuleRef (strict:false) ile
 * çözer — WhatsAppModule bu modülü import ETMEZ (ters yön döngü yaratır).
 * İş düzeni (PLAN/20 §D, 2026-09-22): EkipKotaService (Max kota bekçisi) + EkipKuyrukService (sıralı işleyici, 15 sn) +
 * EkipRutinService (zamanlayıcı, 5 dk) — migration 20260922_ekip_rutin_kuyruk (ekip_rutinler, ekip_kuyruklar).
 */
@Module({
  imports: [PrismaModule, MorenAiModule, LucaModule, CalisanModule, WhatsAppModule, AutomationsModule],
  controllers: [EkipController],
  providers: [
    EkipKotaService,
    EkipRunnerService,
    KoordinatorService,
    EkipOnayService,
    EkipAkisService,
    EkipBekciService,
    EkipWhatsappService,
    EkipKuyrukService,
    EkipRutinService,
  ],
  exports: [EkipRunnerService, KoordinatorService, EkipOnayService, EkipAkisService, EkipWhatsappService, EkipKotaService, EkipKuyrukService, EkipRutinService],
})
export class EkipModule {}
