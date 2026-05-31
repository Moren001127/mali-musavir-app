import { Module } from '@nestjs/common';
import { MihsapController } from './mihsap.controller';
import { MihsapService } from './mihsap.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, StorageModule, NotificationsModule],
  controllers: [MihsapController],
  providers: [MihsapService],
  exports: [MihsapService],
})
export class MihsapModule {}
