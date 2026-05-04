import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LucaModule } from '../luca/luca.module';
import { KdvControlModule } from '../kdv-control/kdv-control.module';
import { IsletmeHesapOzetiController } from './isletme-hesap-ozeti.controller';
import { IsletmeHesapOzetiService } from './isletme-hesap-ozeti.service';
import { ExcelParserService } from '../kdv-control/excel-parser.service';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => LucaModule),
    forwardRef(() => KdvControlModule),
  ],
  controllers: [IsletmeHesapOzetiController],
  providers: [IsletmeHesapOzetiService, ExcelParserService],
  exports: [IsletmeHesapOzetiService],
})
export class IsletmeHesapOzetiModule {}
