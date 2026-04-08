import {
  Controller, Get, Post, Put, Patch, Delete,
  Param, Body, Query, UseGuards, Req, BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { TaxpayersService } from './taxpayers.service';
import { CreateTaxpayerSchema } from '@mali-musavir/shared';

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
  ) {
    return this.taxpayersService.findAll(
      req.user.tenantId,
      search,
      year ? parseInt(year) : undefined,
      month ? parseInt(month) : undefined,
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
      const messages = result.error.errors.map(
        (e) => `${e.path.join('.')}: ${e.message}`,
      );
      throw new BadRequestException(messages);
    }
    const dto = Object.fromEntries(
      Object.entries(result.data).map(([k, v]) => [k, v === '' ? null : v]),
    ) as any;
    return this.taxpayersService.create(req.user.tenantId, dto);
  }

  @Put(':id')
  @Roles('ADMIN', 'STAFF')
  update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.taxpayersService.update(id, req.user.tenantId, body);
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
    const { year, month, ...data } = body;
    return this.taxpayersService.updateMonthlyStatus(
      id, req.user.tenantId, year, month, data,
    );
  }
}
