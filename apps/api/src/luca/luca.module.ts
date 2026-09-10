import { Module, forwardRef } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { LucaService } from './luca.service';
import { LucaAutoScraperService } from './luca-auto-scraper.service';
import { LucaScheduleService } from './luca-schedule.service';
import { LucaController } from './luca.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { KdvControlModule } from '../kdv-control/kdv-control.module';
import { MizanModule } from '../mizan/mizan.module';
import { KdvBeyannameModule } from '../kdv-beyanname/kdv-beyanname.module';
import { IsletmeHesapOzetiModule } from '../isletme-hesap-ozeti/isletme-hesap-ozeti.module';
import { EarsivModule } from '../earsiv/earsiv.module';
import { FaturaMuhasebelestirmeModule } from '../fatura-muhasebelestirme/fatura-muhasebelestirme.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EDefterControlModule } from '../edefter-control/edefter-control.module';

@Module({
  imports: [
    MulterModule.register({ limits: { fileSize: 200 * 1024 * 1024 } }),
    PrismaModule,
    NotificationsModule,
    forwardRef(() => KdvControlModule),
    forwardRef(() => MizanModule),
    forwardRef(() => KdvBeyannameModule),
    forwardRef(() => IsletmeHesapOzetiModule),
    forwardRef(() => EarsivModule),
    forwardRef(() => FaturaMuhasebelestirmeModule),
    // Mizan yuklenince eslik ettigi e-Defter oturumunu yeniden analiz etmek icin.
    forwardRef(() => EDefterControlModule),
  ],
  controllers: [LucaController],
  providers: [LucaService, LucaAutoScraperService, LucaScheduleService],
  exports: [LucaService, LucaAutoScraperService],
})
export class LucaModule {}
