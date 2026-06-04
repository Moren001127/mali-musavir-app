import { Module } from '@nestjs/common';
import { DesktopController } from './desktop.controller';
import { DesktopService } from './desktop.service';

/**
 * Moren Masaüstü uygulaması modülü — additive, mevcut modüllere dokunmaz.
 * PrismaService global olarak sağlandığı için ekstra import gerekmez.
 */
@Module({
  controllers: [DesktopController],
  providers: [DesktopService],
  exports: [DesktopService],
})
export class DesktopModule {}
