import {
  BadRequestException, Body, Controller, Post, Req, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Yapilandirma7582Service } from './yapilandirma-7582.service';

/**
 * 7582 / Seri:B Sıra No:20 YAPILANDIRMA uçları.
 *
 * HEPSİ SALT HESAP: hiçbir uç GİB'e, Luca'ya ya da mükellefe bir şey göndermez.
 * Luca'dan mizan çekme, kilitli Mizan modülünün kendi ucundan yapılır
 * (POST /mizan/fetch-from-luca) — burada tekrarlanmaz.
 */
@Controller('yapilandirma-7582')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'STAFF')
export class Yapilandirma7582Controller {
  constructor(private readonly servis: Yapilandirma7582Service) {}

  /** Çekilmiş mizandan likidite oranı (bilanço esası). */
  @Post('likidite')
  likidite(@Req() req: any, @Body() body: { mizanId: string }) {
    if (!body?.mizanId) throw new BadRequestException('mizanId gerekli');
    return this.servis.likiditeMizandan(req.user.tenantId, body.mizanId);
  }

  /** Borç satırları + parametreler → tüm taksit seçenekleri. */
  @Post('hesapla')
  hesapla(@Body() body: any) {
    if (!Array.isArray(body?.satirlar) || !body.satirlar.length) {
      throw new BadRequestException('En az bir borç satırı gerekli');
    }
    return this.servis.hesapla(body);
  }

  /** Seçilen taksit sayısı için aylık ödeme planı. */
  @Post('plan')
  plan(@Body() body: { tutar: number; taksitSayisi: number; talepTarihi?: string }) {
    if (!body?.tutar || !body?.taksitSayisi) {
      throw new BadRequestException('tutar ve taksitSayisi gerekli');
    }
    return this.servis.plan(body);
  }

  /**
   * GİB borç listesini TOPLU yükle: bütün mükellefler tek dosyadan, kapsam elemesi
   * uygulanmış olarak döner. Hiçbir şey kaydetmez; salt hesap.
   */
  @Post('excel-toplu')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }))
  excelToplu(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Excel dosyası gerekli');
    return this.servis.excelTopluOku(req.user.tenantId, file.buffer);
  }

  /** Excel yükle → başlıklar + ham satırlar (eşleştirme ekranda yapılır). */
  @Post('excel')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }))
  excel(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Excel dosyası gerekli');
    return this.servis.excelOku(file.buffer);
  }
}
