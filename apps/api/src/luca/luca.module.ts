import { Module, forwardRef } from '@nestjs/common';
import { LucaService } from './luca.service';
import { LucaController } from './luca.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { KdvControlModule } from '../kdv-control/kdv-control.module';

@Module({
  imports: [PrismaModule, forwardRef(() => KdvControlModule)],
  controllers: [LucaController],
  providers: [LucaService],
  exports: [LucaService],
})
export class LucaModule {}
