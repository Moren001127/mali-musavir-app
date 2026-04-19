import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { VendorMemoryService } from './vendor-memory.service';

/**
 * Firma Hafizasi endpoint'leri. Yalniz web UI (JWT) kullanir — extension erisimi yok.
 */
@Controller('vendor-memory')
@UseGuards(AuthGuard('jwt'))
export class VendorMemoryController {
  constructor(private readonly service: VendorMemoryService) {}

  /** Tum firmalar, en cok kullanilana gore sirali. Arama destekli. */
  @Get()
  list(@Req() req: any, @Query('search') search?: string, @Query('limit') limit?: string) {
    const tenantId = req?.user?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId yok');
    const lim = limit ? Math.min(1000, Math.max(1, parseInt(limit, 10))) : 200;
    return this.service.listVendorMemory(tenantId, { search, limit: lim });
  }

  /** Tek firma detayi — tum kategorilerin dokumu */
  @Get(':firmaKimlikNo')
  detail(@Req() req: any, @Param('firmaKimlikNo') firmaKimlikNo: string) {
    const tenantId = req?.user?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId yok');
    if (!firmaKimlikNo || firmaKimlikNo.length < 10) {
      throw new BadRequestException('gecersiz VKN/TCKN');
    }
    return this.service.getVendorDetail(tenantId, firmaKimlikNo);
  }

  /** Yanlis ogrenme durumunu temizleme */
  @Delete(':firmaKimlikNo')
  async remove(@Req() req: any, @Param('firmaKimlikNo') firmaKimlikNo: string) {
    const tenantId = req?.user?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId yok');
    await this.service.deleteVendorMemory(tenantId, firmaKimlikNo);
    return { ok: true };
  }
}
