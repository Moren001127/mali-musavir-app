import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MorenOfisModule } from '../moren-ofis/moren-ofis.module';
import { PortalDevService } from './portal-dev.service';
import { PortalDevController } from './portal-dev.controller';
import { OpenRouterAdapter } from '../moren-ofis/providers/openrouter.adapter';

@Module({
  imports: [PrismaModule, MorenOfisModule],
  providers: [PortalDevService, OpenRouterAdapter],
  controllers: [PortalDevController],
  exports: [PortalDevService],
})
export class PortalDevModule {}
