import { Module, forwardRef } from '@nestjs/common';
import { LucaService } from './luca.service';
import { LucaAutoScraperService } from './luca-auto-scraper.service';
import { LucaController } from './luca.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { KdvControlModule } from '../kdv-control/kdv-control.module';

@Module({
  imports: [PrismaModule, forwardRef(() => KdvControlModule)],
  controllers: [LucaController],
  providers: [LucaService, LucaAutoScraperService],
  exports: [LucaService, LucaAutoScraperService],
})
export class LucaModule {}
