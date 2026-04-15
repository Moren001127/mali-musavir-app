import { Module } from '@nestjs/common';
import { FisYazdirmaController } from './fis-yazdirma.controller';
import { FisYazdirmaService } from './fis-yazdirma.service';

@Module({
  controllers: [FisYazdirmaController],
  providers: [FisYazdirmaService],
})
export class FisYazdirmaModule {}
