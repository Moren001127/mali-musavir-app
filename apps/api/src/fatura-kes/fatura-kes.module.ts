import { Module } from '@nestjs/common';
import { FaturaKesService } from './fatura-kes.service';
import { FaturaKesGibService } from './fatura-kes-gib.service';
import { FaturaKesController } from './fatura-kes.controller';
import { FaturaKesKomutService } from './fatura-kes-komut.service';

@Module({
  providers: [FaturaKesService, FaturaKesGibService, FaturaKesKomutService],
  controllers: [FaturaKesController],
  exports: [FaturaKesService, FaturaKesGibService, FaturaKesKomutService],
})
export class FaturaKesModule {}
