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
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  // WhatsAppModule forwardRef ŞART: Fatura → WhatsApp → Calisan → Luca → Fatura modül DÖNGÜSÜ var —
  // düz import açılışta "module is undefined" ile Railway'i çökertti (2026-07-19).
  imports: [PrismaModule, StorageModule, forwardRef(() => KdvControlModule), VendorMemoryModule, MihsapModule, PortalAutomationModule, NotificationsModule, BeyanKayitlariModule, forwardRef(() => WhatsAppModule)],
  controllers: [FaturaMuhasebelestirmeController],
  providers: [FaturaMuhasebelestirmeService, EarsivRenderService, FaturaMuhasebelestirmeCron, EFaturaSyncService, IcerikEslestirmeService],
  exports: [FaturaMuhasebelestirmeService, EFaturaSyncService, IcerikEslestirmeService],
})
export class FaturaMuhasebelestirmeModule {}
