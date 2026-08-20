import { Module } from '@nestjs/common';
import { FaturaKesService } from './fatura-kes.service';
import { FaturaKesGibService } from './fatura-kes-gib.service';
import { FaturaKesController } from './fatura-kes.controller';
import { FaturaKesKomutService } from './fatura-kes-komut.service';
import { ElogoFaturaService } from './elogo-fatura.service';
import { ElogoPortalService } from './elogo-portal.service';

@Module({
  providers: [FaturaKesService, FaturaKesGibService, FaturaKesKomutService, ElogoFaturaService, ElogoPortalService],
  controllers: [FaturaKesController],
  exports: [FaturaKesService, FaturaKesGibService, FaturaKesKomutService, ElogoFaturaService, ElogoPortalService],
})
export class FaturaKesModule {}
