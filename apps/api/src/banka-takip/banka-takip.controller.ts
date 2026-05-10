import {
  Controller, Get, Post, Put, Delete, Body, Param, Query, Req, UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { BankaTakipService } from './banka-takip.service';

@Controller('banka-takip')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'STAFF')
export class BankaTakipController {
  constructor(private readonly service: BankaTakipService) {}

  // ===== ANA LİSTE — donem bazlı =====
  @Get('list')
  list(@Req() req: any, @Query('donem') donem: string) {
    if (!donem) throw new BadRequestException('donem (YYYY-MM) gerekli');
    return this.service.listForDonem(req.user.tenantId, donem);
  }

  // ===== BANKA HESABI CRUD =====
  @Get('hesaplar')
  listHesaplar(@Req() req: any, @Query('taxpayerId') taxpayerId?: string) {
    return this.service.listBankaHesaplari(req.user.tenantId, taxpayerId);
  }

  @Post('hesaplar')
  createHesap(
    @Req() req: any,
    @Body() body: {
      taxpayerId: string;
      bankaAdi: string;
      hesapNo?: string;
      iban?: string;
      sube?: string;
      paraBirimi?: string;
      aciklama?: string;
      sira?: number;
    },
  ) {
    return this.service.createBankaHesap(req.user.tenantId, body);
  }

  @Put('hesaplar/:id')
  updateHesap(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.service.updateBankaHesap(req.user.tenantId, id, body);
  }

  @Delete('hesaplar/:id')
  deleteHesap(@Req() req: any, @Param('id') id: string) {
    return this.service.deleteBankaHesap(req.user.tenantId, id);
  }

  // ===== EKSTRE UPSERT =====
  @Post('ekstre')
  upsertEkstre(
    @Req() req: any,
    @Body() body: {
      taxpayerId: string;
      bankaHesapId?: string | null;
      donem: string;
      ekstreGeldi?: boolean;
      ekstreIslendi?: boolean;
      islenmeNotu?: string;
      notlar?: string;
    },
  ) {
    return this.service.upsertEkstreKaydi(req.user.tenantId, body);
  }

  @Post('eksik-ekstre-gorevleri')
  createEksikEkstreTasks(
    @Req() req: any,
    @Body() body: { donem: string; taxpayerIds?: string[] },
  ) {
    return this.service.createEksikEkstreTasks(req.user.tenantId, req.user.sub, body);
  }
}
