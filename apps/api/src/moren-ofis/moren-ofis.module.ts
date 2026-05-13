import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MorenOfisService } from './moren-ofis.service';
import { MorenOfisController } from './moren-ofis.controller';
import { OpenRouterAdapter } from './providers/openrouter.adapter';
import { MorenOfisMemoryService } from './memory.service';

@Module({
  imports: [PrismaModule],
  providers: [MorenOfisService, OpenRouterAdapter, MorenOfisMemoryService],
  controllers: [MorenOfisController],
  exports: [MorenOfisService, MorenOfisMemoryService],
})
export class MorenOfisModule {}
