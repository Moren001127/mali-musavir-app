import { Module } from '@nestjs/common';
import { VendorMemoryController } from './vendor-memory.controller';
import { VendorMemoryService } from './vendor-memory.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [VendorMemoryController],
  providers: [VendorMemoryService],
  exports: [VendorMemoryService],
})
export class VendorMemoryModule {}
