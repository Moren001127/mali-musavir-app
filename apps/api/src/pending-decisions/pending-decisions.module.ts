import { Module } from '@nestjs/common';
import { PendingDecisionsController } from './pending-decisions.controller';
import { PendingDecisionsService } from './pending-decisions.service';
import { PrismaModule } from '../prisma/prisma.module';
import { VendorMemoryModule } from '../vendor-memory/vendor-memory.module';

@Module({
  imports: [PrismaModule, VendorMemoryModule],
  controllers: [PendingDecisionsController],
  providers: [PendingDecisionsService],
  exports: [PendingDecisionsService],
})
export class PendingDecisionsModule {}
