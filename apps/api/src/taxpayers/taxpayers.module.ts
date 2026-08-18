import { Module } from '@nestjs/common';
import { TaxpayersService } from './taxpayers.service';
import { TaxpayersController } from './taxpayers.controller';
import { TaxpayerEksikRaporController } from './taxpayer-eksik-rapor.controller';

@Module({
  providers: [TaxpayersService],
  controllers: [TaxpayersController, TaxpayerEksikRaporController],
  exports: [TaxpayersService],
})
export class TaxpayersModule {}
