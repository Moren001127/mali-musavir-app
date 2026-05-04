import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { KdvBeyannameController } from './kdv-beyanname.controller';
import { KdvBeyannameService } from './kdv-beyanname.service';
import { MizanParserService } from '../mizan/mizan-parser.service';

@Module({
  imports: [PrismaModule],
  controllers: [KdvBeyannameController],
  // MizanParserService — Luca XLS'i parse etmek için reuse, Mizan tablosuna YAZMAYIZ.
  providers: [KdvBeyannameService, MizanParserService],
  exports: [KdvBeyannameService],
})
export class KdvBeyannameModule {}
