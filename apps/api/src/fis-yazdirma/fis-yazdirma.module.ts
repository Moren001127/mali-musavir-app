import { Module } from '@nestjs/common';
import { FisYazdirmaController } from './fis-yazdirma.controller';
import { FisYazdirmaService } from './fis-yazdirma.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [FisYazdirmaController],
  providers: [FisYazdirmaService],
})
export class FisYazdirmaModule {}
