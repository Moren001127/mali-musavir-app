import { Module } from '@nestjs/common';
import { AgentEventsController } from './agent-events.controller';
import { AgentEventsService } from './agent-events.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AgentEventsController],
  providers: [AgentEventsService],
  exports: [AgentEventsService],
})
export class AgentEventsModule {}
