import { Module, forwardRef } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { MizanController } from './mizan.controller';
import { MizanService } from './mizan.service';
import { MizanParserService } from './mizan-parser.service';
import { GelirTablosuService } from './gelir-tablosu.service';
import { BilancoService } from './bilanco.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LucaModule } from '../luca/luca.module';

@Module({
  imports: [
    MulterModule.register({ limits: { fileSize: 25 * 1024 * 1024 } }),
    PrismaModule,
    forwardRef(() => LucaModule),
  ],
  controllers: [MizanController],
  providers: [MizanService, MizanParserService, GelirTablosuService, BilancoService],
  exports: [MizanService, GelirTablosuService, BilancoService],
})
export class MizanModule {}
