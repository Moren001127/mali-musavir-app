import { Module } from '@nestjs/common';
import { DesktopController } from './desktop.controller';
import { DesktopDownloadController } from './desktop-download.controller';
import { DesktopService } from './desktop.service';

/**
 * Moren Masaüstü uygulaması modülü — additive, mevcut modüllere dokunmaz.
 * PrismaService global olarak sağlandığı için ekstra import gerekmez.
 */
@Module({
  controllers: [DesktopController, DesktopDownloadController],
  providers: [DesktopService],
  exports: [DesktopService],
})
export class DesktopModule {}
