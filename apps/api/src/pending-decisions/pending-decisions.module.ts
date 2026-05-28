import { Module } from '@nestjs/common';
import { PendingDecisionsController } from './pending-decisions.controller';
import { PendingDecisionsService } from './pending-decisions.service';
import { PrismaModule } from '../prisma/prisma.module';
import { VendorMemoryModule } from '../vendor-memory/vendor-memory.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, VendorMemoryModule, NotificationsModule],
  controllers: [PendingDecisionsController],
  providers: [PendingDecisionsService],
  exports: [PendingDecisionsService],
})
export class PendingDecisionsModule {}
