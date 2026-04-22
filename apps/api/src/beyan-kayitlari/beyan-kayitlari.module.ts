import { Module } from '@nestjs/common';
import { BeyanKayitlariService } from './beyan-kayitlari.service';
import { BeyanKayitlariController } from './beyan-kayitlari.controller';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  providers: [BeyanKayitlariService],
  controllers: [BeyanKayitlariController],
  exports: [BeyanKayitlariService],
})
export class BeyanKayitlariModule {}
