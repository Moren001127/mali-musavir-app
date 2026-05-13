import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MorenOfisService } from './moren-ofis.service';
import { MorenOfisController } from './moren-ofis.controller';
import { OpenRouterAdapter } from './providers/openrouter.adapter';

@Module({
  imports: [PrismaModule],
  providers: [MorenOfisService, OpenRouterAdapter],
  controllers: [MorenOfisController],
  exports: [MorenOfisService],
})
export class MorenOfisModule {}
