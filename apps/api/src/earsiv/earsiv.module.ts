import { Module } from '@nestjs/common';
import { EarsivController } from './earsiv.controller';
import { EarsivService } from './earsiv.service';
import { EarsivZipParserService } from './earsiv-zip-parser.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LucaModule } from '../luca/luca.module';

@Module({
  imports: [PrismaModule, LucaModule],
  controllers: [EarsivController],
  providers: [EarsivService, EarsivZipParserService],
  exports: [EarsivService],
})
export class EarsivModule {}
