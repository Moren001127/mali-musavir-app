import { Module } from '@nestjs/common';
import { GaleriService } from './galeri.service';
import { GaleriController } from './galeri.controller';

@Module({
  providers: [GaleriService],
  controllers: [GaleriController],
  exports: [GaleriService],
})
export class GaleriModule {}
