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

@Module({
  imports: [PrismaModule, StorageModule, forwardRef(() => KdvControlModule), VendorMemoryModule, MihsapModule],
  controllers: [FaturaMuhasebelestirmeController],
  providers: [FaturaMuhasebelestirmeService, EarsivRenderService, FaturaMuhasebelestirmeCron, EFaturaSyncService, IcerikEslestirmeService],
  exports: [FaturaMuhasebelestirmeService, EFaturaSyncService, IcerikEslestirmeService],
})
export class FaturaMuhasebelestirmeModule {}
