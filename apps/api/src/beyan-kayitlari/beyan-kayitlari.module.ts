import { Module } from '@nestjs/common';
import { BeyanKayitlariService } from './beyan-kayitlari.service';
import { BeyanKayitlariController } from './beyan-kayitlari.controller';
import { StorageModule } from '../storage/storage.module';

// DİKKAT: AkilliBildirimModule BURAYA IMPORT EDİLMEZ. Zincir BeyanKayitlari→AkilliBildirim→WhatsApp→
// MorenAi→KdvBeyanname→BeyanKayitlari dosya döngüsü kurar; forwardRef'siz MorenAiModule/CalisanModule
// dekoratörlerinde import `undefined` kalır ve açılış çöker. Elle gönderim (POST /gonder) için
// AkilliBildirimService çağrı anında ModuleRef ile çözülür (beyan-kayitlari.service.ts → gonder()).
@Module({
  imports: [StorageModule],
  providers: [BeyanKayitlariService],
  controllers: [BeyanKayitlariController],
  exports: [BeyanKayitlariService],
})
export class BeyanKayitlariModule {}
