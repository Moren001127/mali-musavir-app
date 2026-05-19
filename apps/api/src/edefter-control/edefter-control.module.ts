import { Module, forwardRef } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { PrismaModule } from '../prisma/prisma.module';
import { LucaModule } from '../luca/luca.module';
import { EDefterControlController } from './edefter-control.controller';
import { EDefterControlService } from './edefter-control.service';
import { EDefterFisListesiParserService } from './edefter-fis-listesi-parser.service';

@Module({
  imports: [
    MulterModule.register({ limits: { fileSize: 100 * 1024 * 1024 } }),
    PrismaModule,
    forwardRef(() => LucaModule),
  ],
  controllers: [EDefterControlController],
  providers: [EDefterControlService, EDefterFisListesiParserService],
  exports: [EDefterControlService, EDefterFisListesiParserService],
})
export class EDefterControlModule {}
