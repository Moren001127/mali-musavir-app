import { Module } from '@nestjs/common';
import { FaturaKesService } from './fatura-kes.service';
import { FaturaKesController } from './fatura-kes.controller';

@Module({
  providers: [FaturaKesService],
  controllers: [FaturaKesController],
  exports: [FaturaKesService],
})
export class FaturaKesModule {}
