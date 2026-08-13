import { Module, forwardRef } from '@nestjs/common';
import { AgentEventsController } from './agent-events.controller';
import { AgentEventsService } from './agent-events.service';
import { PrismaModule } from '../prisma/prisma.module';
import { VendorMemoryModule } from '../vendor-memory/vendor-memory.module';
import { PendingDecisionsModule } from '../pending-decisions/pending-decisions.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [PrismaModule, VendorMemoryModule, PendingDecisionsModule, forwardRef(() => WhatsAppModule)],
  controllers: [AgentEventsController],
  providers: [AgentEventsService],
  exports: [AgentEventsService],
})
export class AgentEventsModule {}
