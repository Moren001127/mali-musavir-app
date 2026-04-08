import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { WhatsAppService } from './whatsapp.service';
import * as QRCode from 'qrcode';

@Controller('whatsapp')
@UseGuards(AuthGuard('jwt'))
export class WhatsAppController {
  constructor(private whatsappService: WhatsAppService) {}

  @Get('status')
  getStatus() {
    return this.whatsappService.getStatus();
  }

  @Get('qr')
  async getQr(@Res() res: Response) {
    const qr = this.whatsappService.getQr();
    if (!qr) {
      return res.status(404).json({ message: 'QR kodu mevcut değil. Zaten bağlı olabilir.' });
    }
    const pngBuffer = await QRCode.toBuffer(qr);
    res.set('Content-Type', 'image/png');
    return res.send(pngBuffer);
  }
}
