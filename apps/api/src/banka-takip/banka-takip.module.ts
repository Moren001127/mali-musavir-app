import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BankaTakipController } from './banka-takip.controller';
import { BankaTakipService } from './banka-takip.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [BankaTakipController],
  providers: [BankaTakipService],
  exports: [BankaTakipService],
})
export class BankaTakipModule {}
