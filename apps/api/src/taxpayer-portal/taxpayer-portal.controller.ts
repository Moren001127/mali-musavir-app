import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TaxpayerPortalService } from './taxpayer-portal.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('portal')
export class TaxpayerPortalController {
  constructor(private readonly service: TaxpayerPortalService) {}

  // ============ MÜKELLEF GİRİŞİ (guard yok) ============
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: { email?: string; password?: string }) {
    return this.service.login(String(body?.email || ''), String(body?.password || ''));
  }

  // ============ MÜKELLEFE KİLİTLİ UÇLAR (taxpayer-jwt) ============
  @UseGuards(AuthGuard('taxpayer-jwt'))
  @Get('me')
  me(@Req() req: any) {
    return this.service.getProfile(req.user.taxpayerId);
  }

  @UseGuards(AuthGuard('taxpayer-jwt'))
  @Get('dashboard')
  dashboard(@Req() req: any) {
    return this.service.getDashboard(req.user.taxpayerId, req.user.tenantId);
  }

  @UseGuards(AuthGuard('taxpayer-jwt'))
  @Get('brifing')
  brifing(@Req() req: any, @Query('force') force?: string) {
    return this.service.getBrifing(req.user.taxpayerId, req.user.tenantId, force === '1' || force === 'true');
  }

  @UseGuards(AuthGuard('taxpayer-jwt'))
  @Get('beyannameler')
  beyannameler(@Req() req: any) {
    return this.service.getBeyannamelerListe(req.user.taxpayerId);
  }

  @UseGuards(AuthGuard('taxpayer-jwt'))
  @Get('cari')
  cari(@Req() req: any) {
    return this.service.getCariOzet(req.user.taxpayerId);
  }

  @UseGuards(AuthGuard('taxpayer-jwt'))
  @Get('evraklar')
  evraklar(@Req() req: any) {
    return this.service.getEvraklar(req.user.taxpayerId);
  }

  @UseGuards(AuthGuard('taxpayer-jwt'))
  @Get('faturalar')
  faturalar(@Req() req: any, @Query('yil') yil?: string, @Query('donem') donem?: string) {
    const yilNum = yil && /^\d{4}$/.test(yil) ? Number(yil) : undefined;
    return this.service.getFaturalarDetay(req.user.taxpayerId, req.user.tenantId, {
      yil: yilNum,
      donem: donem && /^\d{4}-\d{2}$/.test(donem) ? donem : undefined,
    });
  }

  @UseGuards(AuthGuard('taxpayer-jwt'))
  @Get('tebligatlar')
  tebligatlar(@Req() req: any) {
    return this.service.getTebligatlar(req.user.taxpayerId, req.user.tenantId);
  }

  @UseGuards(AuthGuard('taxpayer-jwt'))
  @Get('sgk')
  sgk(@Req() req: any) {
    return this.service.getSgkBelgeleri(req.user.taxpayerId, req.user.tenantId);
  }

  // Belge görüntüleme (presigned inline URL) — tur: beyanname | evrak | tebligat | sgk | fatura
  @UseGuards(AuthGuard('taxpayer-jwt'))
  @Get('belge/:tur/:id/view')
  belgeView(@Req() req: any, @Param('tur') tur: string, @Param('id') id: string, @Query('kind') kind?: string) {
    return this.service.getBelgeViewUrl(req.user.taxpayerId, req.user.tenantId, tur, id, kind);
  }

  // Belge özeti — AI belgeyi okuyup sade Türkçe özetler.
  @UseGuards(AuthGuard('taxpayer-jwt'))
  @Post('belge/:tur/:id/ozet')
  @HttpCode(HttpStatus.OK)
  belgeOzet(@Req() req: any, @Param('tur') tur: string, @Param('id') id: string, @Query('kind') kind?: string) {
    return this.service.belgeOzeti(req.user.taxpayerId, req.user.tenantId, tur, id, kind);
  }

  // Mükellef kendi şifresini değiştirir.
  @UseGuards(AuthGuard('taxpayer-jwt'))
  @Post('me/password')
  @HttpCode(HttpStatus.OK)
  changePassword(@Req() req: any, @Body() body: { currentPassword?: string; newPassword?: string }) {
    return this.service.changePassword(req.user.taxpayerId, String(body?.currentPassword || ''), String(body?.newPassword || ''));
  }

  @UseGuards(AuthGuard('taxpayer-jwt'))
  @Post('ai/chat')
  @HttpCode(HttpStatus.OK)
  chat(@Req() req: any, @Body() body: { message?: string; history?: { role?: string; text?: string }[] }) {
    if (!body?.message?.trim()) throw new BadRequestException('message zorunlu');
    const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
    return this.service.chat(req.user.taxpayerId, req.user.tenantId, body.message, history);
  }

  // Mükellefin kendi MOREN AI sohbet geçmişi (kalıcı — sayfa değişince gitmez).
  @UseGuards(AuthGuard('taxpayer-jwt'))
  @Get('ai/gecmis')
  aiGecmis(@Req() req: any) {
    return this.service.getChatHistory(req.user.taxpayerId);
  }

  // ============ MÜŞAVİR TARAFI: portal erişimi yönetimi (advisor jwt + ADMIN) ============
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Get('admin/taxpayers/:id/access')
  accessStatus(@Req() req: any, @Param('id') id: string) {
    return this.service.getPortalAccessStatus(req.user.tenantId, id);
  }

  // Müşavir tarafı: bir mükellefin MOREN AI sohbet dökümü.
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Get('admin/taxpayers/:id/ai-chat')
  taxpayerAiChat(@Req() req: any, @Param('id') id: string) {
    return this.service.getTaxpayerChatForAdvisor(req.user.tenantId, id);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Post('admin/taxpayers/:id/access')
  @HttpCode(HttpStatus.OK)
  setAccess(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { enabled?: boolean; portalEmail?: string; password?: string },
  ) {
    return this.service.setPortalAccess(req.user.tenantId, id, body || {});
  }
}
