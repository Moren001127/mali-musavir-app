import { Module } from '@nestjs/common';
import { FisYazdirmaController, FisYazdirmaAgentController } from './fis-yazdirma.controller';
import { FisYazdirmaService } from './fis-yazdirma.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MihsapModule } from '../mihsap/mihsap.module';

@Module({
  imports: [PrismaModule, MihsapModule],
  controllers: [FisYazdirmaController, FisYazdirmaAgentController],
  providers: [FisYazdirmaService],
  exports: [FisYazdirmaService],
})
export class FisYazdirmaModule {}
