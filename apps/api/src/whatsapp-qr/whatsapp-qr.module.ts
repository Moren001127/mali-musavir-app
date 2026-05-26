import { Global, Module } from '@nestjs/common';
import { WhatsAppQrController } from './whatsapp-qr.controller';
import { WhatsAppQrService } from './whatsapp-qr.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

/**
 * WhatsApp QR — Meta Cloud API'sinin yanında çalışan ikinci kanal.
 * Global module çünkü ActionDispatcher (automations module) buradan inject ediyor.
 */
@Global()
@Module({
  imports: [PrismaModule, StorageModule],
  providers: [WhatsAppQrService],
  controllers: [WhatsAppQrController],
  exports: [WhatsAppQrService],
})
export class WhatsAppQrModule {}
