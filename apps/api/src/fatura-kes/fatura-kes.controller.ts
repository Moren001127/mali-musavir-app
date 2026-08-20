import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FaturaKesService, FaturaKesInput } from './fatura-kes.service';
import { FaturaKesGibService } from './fatura-kes-gib.service';

/**
 * FATURA KES uçları.
 *
 * GÜVENLİK: hiçbir uç RESMİ BELGE oluşturmaz.
 *   • taslak uçları  → yalnız bizde, hiçbir yere gitmez
 *   • taslak/:id/gib → GİB'de TASLAK oluşturur (silinebilir, vergi doğurmaz);
 *                      varsayılanı KURU TEST'tir, gövdede kuruTest:false denmedikçe
 *                      GİB'e hiçbir şey gönderilmez
 *   • kesinleştirme (imzalama) HENÜZ YOK — ayrı adım + ayrı onay + SMS kodu isteyecek
 */
@Controller('fatura-kes')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'STAFF')
export class FaturaKesController {
  constructor(
    private readonly service: FaturaKesService,
    private readonly gib: FaturaKesGibService,
  ) {}

  /** Taslak oluştur — hesaplar, kaydeder, önizleme döner. Gönderim YOK. */
  @Post('taslak')
  @HttpCode(HttpStatus.OK)
  create(@Req() req: any, @Body() body: FaturaKesInput) {
    return this.service.createDraft(req.user.tenantId, req.user?.userId || req.user?.sub || null, body);
  }

  /** Bu mükellefte fatura hangi kanaldan kesilir? (entegratör mü, GİB mi) */
  @Get('kanal')
  kanal(@Req() req: any, @Query('taxpayerId') taxpayerId: string) {
    return this.service.kanalTespit(req.user.tenantId, taxpayerId);
  }

  @Get('taslak')
  list(@Req() req: any, @Query() q: any) {
    return this.service.listDrafts(req.user.tenantId, {
      taxpayerId: q.taxpayerId,
      durum: q.durum,
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
    });
  }

  @Get('taslak/:id')
  get(@Req() req: any, @Param('id') id: string) {
    return this.service.getDraft(req.user.tenantId, id);
  }

  /** Önizlemeyi HTML olarak döndür (iframe / yeni sekme için). */
  @Get('taslak/:id/onizleme')
  async onizleme(@Req() req: any, @Param('id') id: string, @Res() res: any) {
    const d: any = await this.service.getDraft(req.user.tenantId, id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(d.onizlemeHtml || '<p>Önizleme üretilemedi</p>');
  }

  /**
   * Taslağı GİB e-Arşiv portalına gönder — GİB'de TASLAK oluşur, RESMİ BELGE DEĞİL.
   * kuruTest=true (VARSAYILAN): GİB'e hiçbir şey gitmez, yalnız gidecek veri döner.
   * Kesinleştirme (imzalama) BU UÇTA YOKTUR; ayrı adım + SMS kodu ister.
   */
  @Post('taslak/:id/gib')
  @HttpCode(HttpStatus.OK)
  gibeGonder(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const kuruTest = body?.kuruTest !== false; // güvenli varsayılan: KURU TEST
    // gibdeIsrar: entegratörlü mükellefte kanal engelini bile bile geçmek için (varsayılan KAPALI)
    return this.gib.gibeGonder(req.user.tenantId, id, { kuruTest, gibdeIsrar: body?.gibdeIsrar === true });
  }

  /** GİB'deki belgenin KENDİ görüntüsünü getir (salt okuma; oluşturmaz/imzalamaz/silmez). */
  @Post('taslak/:id/gorsel')
  @HttpCode(HttpStatus.OK)
  gorsel(@Req() req: any, @Param('id') id: string) {
    return this.gib.gorseliTazele(req.user.tenantId, id);
  }

  @Delete('taslak/:id')
  cancel(@Req() req: any, @Param('id') id: string) {
    return this.service.cancelDraft(req.user.tenantId, id);
  }
}
