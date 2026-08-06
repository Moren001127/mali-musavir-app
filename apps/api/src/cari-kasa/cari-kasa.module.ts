import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { StorageModule } from '../storage/storage.module';
import { CariKasaAgentController, CariKasaController } from './cari-kasa.controller';
import { CariKasaService } from './cari-kasa.service';
import { CariKasaCron } from './cari-kasa.cron';

@Module({
  imports: [PrismaModule, WhatsAppModule, StorageModule],
  controllers: [CariKasaController, CariKasaAgentController],
  providers: [CariKasaService, CariKasaCron],
  exports: [CariKasaService],
})
export class CariKasaModule {}
