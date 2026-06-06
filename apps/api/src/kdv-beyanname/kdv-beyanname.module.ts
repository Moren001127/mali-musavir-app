import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { KdvBeyannameController } from './kdv-beyanname.controller';
import { KdvBeyannameService } from './kdv-beyanname.service';
import { KdvBeyannameCron } from './kdv-beyanname.cron';
import { MizanParserService } from '../mizan/mizan-parser.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { BeyanKayitlariModule } from '../beyan-kayitlari/beyan-kayitlari.module';

@Module({
  imports: [PrismaModule, NotificationsModule, BeyanKayitlariModule],
  controllers: [KdvBeyannameController],
  // MizanParserService — Luca XLS'i parse etmek için reuse, Mizan tablosuna YAZMAYIZ.
  providers: [KdvBeyannameService, MizanParserService, KdvBeyannameCron],
  exports: [KdvBeyannameService],
})
export class KdvBeyannameModule {}
