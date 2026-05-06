import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BankaTakipController } from './banka-takip.controller';
import { BankaTakipService } from './banka-takip.service';

@Module({
  imports: [PrismaModule],
  controllers: [BankaTakipController],
  providers: [BankaTakipService],
  exports: [BankaTakipService],
})
export class BankaTakipModule {}
