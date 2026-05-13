import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MorenOfisService } from './moren-ofis.service';
import { MorenOfisController } from './moren-ofis.controller';
import { OpenRouterAdapter } from './providers/openrouter.adapter';
import { MorenOfisMemoryService } from './memory.service';
import { MorenOfisPatrolService } from './patrol.service';

@Module({
  imports: [PrismaModule],
  providers: [MorenOfisService, OpenRouterAdapter, MorenOfisMemoryService, MorenOfisPatrolService],
  controllers: [MorenOfisController],
  exports: [MorenOfisService, MorenOfisMemoryService, MorenOfisPatrolService],
})
export class MorenOfisModule {}
