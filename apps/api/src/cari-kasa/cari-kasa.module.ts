import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CariKasaController } from './cari-kasa.controller';
import { CariKasaService } from './cari-kasa.service';
import { CariKasaCron } from './cari-kasa.cron';

@Module({
  imports: [PrismaModule],
  controllers: [CariKasaController],
  providers: [CariKasaService, CariKasaCron],
  exports: [CariKasaService],
})
export class CariKasaModule {}
