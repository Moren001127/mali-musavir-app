import { Module } from '@nestjs/common';
import { FaturaKesService } from './fatura-kes.service';
import { FaturaKesGibService } from './fatura-kes-gib.service';
import { FaturaKesController } from './fatura-kes.controller';
import { FaturaKesKomutService } from './fatura-kes-komut.service';
import { ElogoFaturaService } from './elogo-fatura.service';

@Module({
  providers: [FaturaKesService, FaturaKesGibService, FaturaKesKomutService, ElogoFaturaService],
  controllers: [FaturaKesController],
  exports: [FaturaKesService, FaturaKesGibService, FaturaKesKomutService, ElogoFaturaService],
})
export class FaturaKesModule {}
