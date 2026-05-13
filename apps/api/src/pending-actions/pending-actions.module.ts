import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PendingActionsService } from './pending-actions.service';
import { PendingActionsController } from './pending-actions.controller';

@Module({
  imports: [PrismaModule],
  providers: [PendingActionsService],
  controllers: [PendingActionsController],
  exports: [PendingActionsService],
})
export class PendingActionsModule {}
