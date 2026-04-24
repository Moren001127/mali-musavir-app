import { Module, forwardRef } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { LucaService } from './luca.service';
import { LucaAutoScraperService } from './luca-auto-scraper.service';
import { LucaController } from './luca.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { KdvControlModule } from '../kdv-control/kdv-control.module';
import { MizanModule } from '../mizan/mizan.module';

@Module({
  imports: [
    MulterModule.register({ limits: { fileSize: 25 * 1024 * 1024 } }),
    PrismaModule,
    forwardRef(() => KdvControlModule),
    forwardRef(() => MizanModule),
  ],
  controllers: [LucaController],
  providers: [LucaService, LucaAutoScraperService],
  exports: [LucaService, LucaAutoScraperService],
})
export class LucaModule {}
