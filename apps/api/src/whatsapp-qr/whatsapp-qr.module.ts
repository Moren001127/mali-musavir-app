import { Global, Module } from '@nestjs/common';
import { WhatsAppQrController } from './whatsapp-qr.controller';
import { WhatsAppQrService } from './whatsapp-qr.service';

/**
 * WhatsApp QR — Meta Cloud API'sinin yanında çalışan ikinci kanal.
 * Global module çünkü ActionDispatcher (automations module) buradan inject ediyor.
 */
@Global()
@Module({
  providers: [WhatsAppQrService],
  controllers: [WhatsAppQrController],
  exports: [WhatsAppQrService],
})
export class WhatsAppQrModule {}
