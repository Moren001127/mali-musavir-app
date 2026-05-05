import { Module, forwardRef } from '@nestjs/common';
import { EarsivController } from './earsiv.controller';
import { EarsivService } from './earsiv.service';
import { EarsivZipParserService } from './earsiv-zip-parser.service';
import { EarsivRenderService } from './earsiv-render.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LucaModule } from '../luca/luca.module';

@Module({
  imports: [PrismaModule, forwardRef(() => LucaModule)],
  controllers: [EarsivController],
  providers: [EarsivService, EarsivZipParserService, EarsivRenderService],
  exports: [EarsivService],
})
export class EarsivModule {}
