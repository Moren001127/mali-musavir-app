import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { KdvControlModule } from '../kdv-control/kdv-control.module';
import { FaturaMuhasebelestirmeController } from './fatura-muhasebelestirme.controller';
import { FaturaMuhasebelestirmeService } from './fatura-muhasebelestirme.service';

@Module({
  imports: [PrismaModule, StorageModule, forwardRef(() => KdvControlModule)],
  controllers: [FaturaMuhasebelestirmeController],
  providers: [FaturaMuhasebelestirmeService],
  exports: [FaturaMuhasebelestirmeService],
})
export class FaturaMuhasebelestirmeModule {}
