import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WhatsAppQrService } from './whatsapp-qr.service';

/**
 * WhatsApp QR yönetim API'si.
 *
 *  GET  /whatsapp-qr/status    — bağlantı durumu + QR (varsa)
 *  POST /whatsapp-qr/connect   — yeni oturum başlat (QR üretir)
 *  POST /whatsapp-qr/send      — test mesajı gönder (otomasyondan da çağrılır)
 *  DELETE /whatsapp-qr         — oturumu kapat ve auth'u sil
 */
@Controller('whatsapp-qr')
@UseGuards(AuthGuard('jwt'))
export class WhatsAppQrController {
  constructor(private readonly qrService: WhatsAppQrService) {}

  @Get('status')
  status(@Req() req: any) {
    return this.qrService.getStatus(req.user.tenantId);
  }

  @Post('connect')
  @HttpCode(HttpStatus.ACCEPTED)
  async connect(@Req() req: any) {
    await this.qrService.startConnection(req.user.tenantId);
    return { status: 'starting' };
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  async disconnect(@Req() req: any) {
    await this.qrService.disconnect(req.user.tenantId);
    return { status: 'disconnected' };
  }

  @Post('send')
  async send(
    @Req() req: any,
    @Body() body: { to: string; message: string },
  ) {
    const result = await this.qrService.sendMessage(
      req.user.tenantId,
      String(body.to ?? ''),
      String(body.message ?? '').slice(0, 4000),
    );
    return { sent: true, ...result };
  }

  @Post('check-number')
  async checkNumber(@Req() req: any, @Body() body: { phone: string }) {
    const exists = await this.qrService.isOnWhatsApp(req.user.tenantId, body.phone);
    return { phone: body.phone, hasWhatsApp: exists };
  }
}
