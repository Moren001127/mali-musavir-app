import { Module, forwardRef } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { LucaService } from './luca.service';
import { LucaAutoScraperService } from './luca-auto-scraper.service';
import { LucaController } from './luca.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { KdvControlModule } from '../kdv-control/kdv-control.module';
import { MizanModule } from '../mizan/mizan.module';
import { KdvBeyannameModule } from '../kdv-beyanname/kdv-beyanname.module';
import { IsletmeHesapOzetiModule } from '../isletme-hesap-ozeti/isletme-hesap-ozeti.module';
import { EarsivModule } from '../earsiv/earsiv.module';

@Module({
  imports: [
    MulterModule.register({ limits: { fileSize: 25 * 1024 * 1024 } }),
    PrismaModule,
    forwardRef(() => KdvControlModule),
    forwardRef(() => MizanModule),
    forwardRef(() => KdvBeyannameModule),
    forwardRef(() => IsletmeHesapOzetiModule),
    forwardRef(() => EarsivModule),
  ],
  controllers: [LucaController],
  providers: [LucaService, LucaAutoScraperService],
  exports: [LucaService, LucaAutoScraperService],
})
export class LucaModule {}
