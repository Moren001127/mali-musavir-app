import { Module } from '@nestjs/common';
import { GaleriService } from './galeri.service';
import { PdfRaporService } from './pdf-rapor.service';
import { GaleriController } from './galeri.controller';

@Module({
  providers: [GaleriService, PdfRaporService],
  controllers: [GaleriController],
  exports: [GaleriService, PdfRaporService],
})
export class GaleriModule {}
