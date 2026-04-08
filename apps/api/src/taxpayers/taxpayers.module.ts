import { Module } from '@nestjs/common';
import { TaxpayersService } from './taxpayers.service';
import { TaxpayersController } from './taxpayers.controller';

@Module({
  providers: [TaxpayersService],
  controllers: [TaxpayersController],
  exports: [TaxpayersService],
})
export class TaxpayersModule {}
