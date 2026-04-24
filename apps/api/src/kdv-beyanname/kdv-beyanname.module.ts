import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { KdvBeyannameController } from './kdv-beyanname.controller';
import { KdvBeyannameService } from './kdv-beyanname.service';

@Module({
  imports: [PrismaModule],
  controllers: [KdvBeyannameController],
  providers: [KdvBeyannameService],
  exports: [KdvBeyannameService],
})
export class KdvBeyannameModule {}
