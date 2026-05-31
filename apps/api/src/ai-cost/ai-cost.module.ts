import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiCostController } from './ai-cost.controller';
import { AiCostService } from './ai-cost.service';

@Module({
  imports: [PrismaModule],
  controllers: [AiCostController],
  providers: [AiCostService],
})
export class AiCostModule {}
