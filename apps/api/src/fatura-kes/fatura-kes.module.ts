import { Module } from '@nestjs/common';
import { FaturaKesService } from './fatura-kes.service';
import { FaturaKesGibService } from './fatura-kes-gib.service';
import { FaturaKesController } from './fatura-kes.controller';

@Module({
  providers: [FaturaKesService, FaturaKesGibService],
  controllers: [FaturaKesController],
  exports: [FaturaKesService, FaturaKesGibService],
})
export class FaturaKesModule {}
