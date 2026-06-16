import {
  Controller,
  Get,
  Post,
  Body,
  Param,
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
    return this.service.getDashboard(req.user.taxpayerId);
  }

  @UseGuards(AuthGuard('taxpayer-jwt'))
  @Get('beyannameler')
  beyannameler(@Req() req: any) {
    return this.service.getBeyannameler(req.user.taxpayerId);
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
  @Post('ai/chat')
  @HttpCode(HttpStatus.OK)
  chat(@Req() req: any, @Body() body: { message?: string }) {
    if (!body?.message?.trim()) throw new BadRequestException('message zorunlu');
    return this.service.chat(req.user.taxpayerId, body.message);
  }

  // ============ MÜŞAVİR TARAFI: portal erişimi yönetimi (advisor jwt + ADMIN) ============
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Get('admin/taxpayers/:id/access')
  accessStatus(@Req() req: any, @Param('id') id: string) {
    return this.service.getPortalAccessStatus(req.user.tenantId, id);
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
