import {
  Controller, Get, Post, Put, Patch, Delete,
  Param, Body, Query, UseGuards, Req, BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { TaxpayersService } from './taxpayers.service';
import {
  CreateTaxpayerSchema,
  UpdateTaxpayerSchema,
  CreateTaxpayerYetkiliSchema,
  UpdateTaxpayerYetkiliSchema,
} from '@mali-musavir/shared';

const MONTHLY_STATUS_FIELDS = new Set([
  'evraklarGeldi',
  'evraklarIslendi',
  'kontrolEdildi',
  'beyannameVerildi',
  'kdvKontrolEdildi',
  'indirilecekKdvKontrol',
  'hesaplananKdvKontrol',
  'eArsivKontrol',
  'notes',
]);

function zodMessages(result: any) {
  return result.error.errors.map((e: any) => `${e.path.join('.')}: ${e.message}`);
}

function normalizeTaxpayerDto(data: Record<string, any>) {
  const dto = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, v === '' ? null : v]),
  ) as any;
  if (dto.startDate) dto.startDate = new Date(dto.startDate);
  if (dto.endDate) dto.endDate = new Date(dto.endDate);
  return dto;
}

@Controller('taxpayers')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class TaxpayersController {
  constructor(private taxpayersService: TaxpayersService) {}

  @Get()
  findAll(
    @Req() req: any,
    @Query('search') search?: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('scope') scope?: string,
    @Query('status') status?: string,
  ) {
    return this.taxpayersService.findAll(
      req.user.tenantId,
      search,
      year ? parseInt(year) : undefined,
      month ? parseInt(month) : undefined,
      {
        scope: scope === 'directory' ? 'directory' : 'monthly',
        status: status === 'inactive' || status === 'all' ? status : 'active',
      },
    );
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.taxpayersService.findOne(id, req.user.tenantId);
  }

  @Post()
  @Roles('ADMIN', 'STAFF')
  create(@Req() req: any, @Body() body: any) {
    const result = CreateTaxpayerSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException(zodMessages(result));
    }
    const dto = normalizeTaxpayerDto(result.data);
    // Tarih alanlarını Date nesnesine çevir
    if (dto.startDate) dto.startDate = new Date(dto.startDate);
    if (dto.endDate) dto.endDate = new Date(dto.endDate);
    return this.taxpayersService.create(req.user.tenantId, dto);
  }

  @Put(':id')
  @Roles('ADMIN', 'STAFF')
  update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const result = UpdateTaxpayerSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException(zodMessages(result));
    }
    const dto = normalizeTaxpayerDto(result.data);
    return this.taxpayersService.update(id, req.user.tenantId, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.taxpayersService.softDelete(id, req.user.tenantId);
  }

  // ── Aylık Durum Endpoint'leri ──────────────────────────────

  @Get(':id/monthly-status')
  getMonthlyStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.taxpayersService.getMonthlyStatus(
      id, req.user.tenantId, parseInt(year), parseInt(month),
    );
  }

  @Patch(':id/monthly-status')
  @Roles('ADMIN', 'STAFF')
  updateMonthlyStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { year: number; month: number; [key: string]: any },
  ) {
    const year = Number(body?.year);
    const month = Number(body?.month);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('year 2000-2100 araliginda olmali');
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('month 1-12 araliginda olmali');
    }
    const extras = Object.keys(body || {}).filter(
      (key) => key !== 'year' && key !== 'month' && !MONTHLY_STATUS_FIELDS.has(key),
    );
    if (extras.length) {
      throw new BadRequestException(`Gecersiz alanlar: ${extras.join(', ')}`);
    }
    const data: Record<string, any> = {};
    for (const key of MONTHLY_STATUS_FIELDS) {
      if (body?.[key] !== undefined) data[key] = body[key];
    }
    for (const [key, value] of Object.entries(data)) {
      if (key === 'notes') {
        if (value !== null && typeof value !== 'string') {
          throw new BadRequestException('notes metin olmali');
        }
      } else if (typeof value !== 'boolean') {
        throw new BadRequestException(`${key} boolean olmali`);
      }
    }
    return this.taxpayersService.updateMonthlyStatus(
      id, req.user.tenantId, year, month, data,
    );
  }

  /**
   * Bu ay için mükellef özet istatistikleri — karlılık takibi için.
   * AI çağrı sayısı, KDV session, fatura/fiş sayısı, cari kasa hareketi
   */
  @Get(':id/stats')
  getStats(
    @Req() req: any,
    @Param('id') id: string,
    @Query('months') months?: string,
  ) {
    return this.taxpayersService.getStats(
      id,
      req.user.tenantId,
      months ? Math.min(parseInt(months, 10), 12) : 1,
    );
  }

  /**
   * v1.36.76: Mükellef profil tamamlığı (skor 0-100, eksik alanlar listesi).
   * Banner ve detay panel için kullanılır.
   */
  @Get(':id/completeness')
  getCompleteness(@Req() req: any, @Param('id') id: string) {
    return this.taxpayersService.getCompleteness(id, req.user.tenantId);
  }

  /**
   * v1.36.76: Tüm mükelleflerin tamamlık özeti (dashboard widget).
   * Profili eksik mükellefleri listeler — en eksik üstte sıralı.
   */
  @Get('completeness/summary')
  getCompletenessSummary(@Req() req: any) {
    return this.taxpayersService.getCompletenessSummary(req.user.tenantId);
  }

  /**
   * v1.36.77: Belge Takibi matrix — mükellef × dönem, FATURA + BANKA durumu.
   * @param donem "YYYY-MM" formatında (örn. "2026-04")
   */
  @Get('belge-takip/matrix')
  getBelgeTakipMatrix(@Req() req: any, @Query('donem') donem: string) {
    if (!donem || !/^\d{4}-\d{2}$/.test(donem)) {
      const now = new Date();
      donem = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    return this.taxpayersService.getBelgeTakipMatrix(req.user.tenantId, donem);
  }

  /**
   * v1.36.78: İş Akışı kuyruğu — sıralı görev listesi (FIFO).
   * Mükelleflerin monthly status'una göre aşamalara böler ve sıraya koyar.
   * Kim önce hazır geldiyse o önce işlenir.
   */
  @Get('workflow/queue')
  getWorkflowQueue(
    @Req() req: any,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    return this.taxpayersService.getWorkflowQueue(
      req.user.tenantId,
      year ? parseInt(year, 10) : undefined,
      month ? parseInt(month, 10) : undefined,
    );
  }

  // ============================================================
  // v1.37.0: Firma Yetkilileri CRUD
  // ============================================================
  @Get(':id/yetkililer')
  listYetkililer(@Req() req: any, @Param('id') id: string) {
    return this.taxpayersService.listYetkililer(id, req.user.tenantId);
  }

  @Post(':id/yetkililer')
  @Roles('ADMIN', 'STAFF')
  createYetkili(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const result = CreateTaxpayerYetkiliSchema.safeParse(body);
    if (!result.success) {
      const messages = result.error.errors.map(
        (e: any) => `${e.path.join('.')}: ${e.message}`,
      );
      throw new BadRequestException(messages);
    }
    return this.taxpayersService.createYetkili(id, req.user.tenantId, result.data);
  }

  @Put(':id/yetkililer/:yetkiliId')
  @Roles('ADMIN', 'STAFF')
  updateYetkili(
    @Req() req: any,
    @Param('id') id: string,
    @Param('yetkiliId') yetkiliId: string,
    @Body() body: any,
  ) {
    const result = UpdateTaxpayerYetkiliSchema.safeParse(body);
    if (!result.success) {
      const messages = result.error.errors.map(
        (e: any) => `${e.path.join('.')}: ${e.message}`,
      );
      throw new BadRequestException(messages);
    }
    return this.taxpayersService.updateYetkili(
      id,
      yetkiliId,
      req.user.tenantId,
      result.data,
    );
  }

  @Delete(':id/yetkililer/:yetkiliId')
  @Roles('ADMIN', 'STAFF')
  deleteYetkili(
    @Req() req: any,
    @Param('id') id: string,
    @Param('yetkiliId') yetkiliId: string,
  ) {
    return this.taxpayersService.deleteYetkili(id, yetkiliId, req.user.tenantId);
  }
}
