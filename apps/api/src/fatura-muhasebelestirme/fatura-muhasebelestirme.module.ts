import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { KdvControlModule } from '../kdv-control/kdv-control.module';
import { VendorMemoryModule } from '../vendor-memory/vendor-memory.module';
import { EarsivRenderService } from '../earsiv/earsiv-render.service';
import { FaturaMuhasebelestirmeController } from './fatura-muhasebelestirme.controller';
import { FaturaMuhasebelestirmeService } from './fatura-muhasebelestirme.service';
import { FaturaMuhasebelestirmeCron } from './fatura-muhasebelestirme.cron';
import { EFaturaSyncService } from '../efatura-adapters/efatura-sync.service';
import { IcerikEslestirmeService } from './icerik-eslestirme.service';
import { MihsapModule } from '../mihsap/mihsap.module';
import { PortalAutomationModule } from '../portal-automation/portal-automation.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BeyanKayitlariModule } from '../beyan-kayitlari/beyan-kayitlari.module';

@Module({
  // ⚠️ WhatsAppModule BURAYA IMPORT EDİLMEZ: Fatura → WhatsApp → Calisan → Luca → Fatura modül
  // DÖNGÜSÜ açılışı çökertiyor (2026-07-19 Railway kesintisi; forwardRef de yetmedi — dosya-düzeyi
  // döngü). WhatsApp gönderimi serviste ÇAĞRI ANINDA ModuleRef + dinamik import ile çözülür.
  imports: [PrismaModule, StorageModule, forwardRef(() => KdvControlModule), VendorMemoryModule, MihsapModule, PortalAutomationModule, NotificationsModule, BeyanKayitlariModule],
  controllers: [FaturaMuhasebelestirmeController],
  providers: [FaturaMuhasebelestirmeService, EarsivRenderService, FaturaMuhasebelestirmeCron, EFaturaSyncService, IcerikEslestirmeService],
  exports: [FaturaMuhasebelestirmeService, EFaturaSyncService, IcerikEslestirmeService],
})
export class FaturaMuhasebelestirmeModule {}
