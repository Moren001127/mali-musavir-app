import { Module } from '@nestjs/common';
import { GaleriService } from './galeri.service';
import { PdfRaporService } from './pdf-rapor.service';
import { GaleriController } from './galeri.controller';
import { GaleriAgentController } from './galeri-agent.controller';

@Module({
  providers: [GaleriService, PdfRaporService],
  controllers: [GaleriController, GaleriAgentController],
  exports: [GaleriService, PdfRaporService],
})
export class GaleriModule {}
