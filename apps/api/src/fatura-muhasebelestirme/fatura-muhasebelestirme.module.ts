import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { KdvControlModule } from '../kdv-control/kdv-control.module';
import { VendorMemoryModule } from '../vendor-memory/vendor-memory.module';
import { EarsivRenderService } from '../earsiv/earsiv-render.service';
import { FaturaMuhasebelestirmeController } from './fatura-muhasebelestirme.controller';
import { FaturaMuhasebelestirmeService } from './fatura-muhasebelestirme.service';
import { FaturaMuhasebelestirmeCron } from './fatura-muhasebelestirme.cron';

@Module({
  imports: [PrismaModule, StorageModule, forwardRef(() => KdvControlModule), VendorMemoryModule],
  controllers: [FaturaMuhasebelestirmeController],
  providers: [FaturaMuhasebelestirmeService, EarsivRenderService, FaturaMuhasebelestirmeCron],
  exports: [FaturaMuhasebelestirmeService],
})
export class FaturaMuhasebelestirmeModule {}
