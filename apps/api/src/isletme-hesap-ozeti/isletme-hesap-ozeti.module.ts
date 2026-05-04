import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { IsletmeHesapOzetiController } from './isletme-hesap-ozeti.controller';
import { IsletmeHesapOzetiService } from './isletme-hesap-ozeti.service';

@Module({
  imports: [PrismaModule],
  controllers: [IsletmeHesapOzetiController],
  providers: [IsletmeHesapOzetiService],
  exports: [IsletmeHesapOzetiService],
})
export class IsletmeHesapOzetiModule {}
