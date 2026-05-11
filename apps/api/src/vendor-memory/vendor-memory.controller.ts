import {
  Controller,
  Get,
  Post,
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
  list(
    @Req() req: any,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('taxpayerId') taxpayerId?: string,
  ) {
    const tenantId = req?.user?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId yok');
    const lim = limit ? Math.min(1000, Math.max(1, parseInt(limit, 10))) : 200;
    return this.service.listVendorMemory(tenantId, { search, limit: lim, taxpayerId });
  }

  /**
   * BACKFILL — tum "(ortak)" VendorMemoryDecision kayitlarini,
   * AgentEvent tablosundaki gecmis islemlere bakarak mukelleflere bagla.
   * Bir kerelik bakim islemi — butona basilir, sonra raporu doner.
   */
  @Post('backfill-mukellef')
  async backfill(@Req() req: any) {
    const tenantId = req?.user?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId yok');
    const result = await this.service.backfillMukellefIds(tenantId);
    return {
      ok: true,
      mesaj: `${result.eslesti} karar mukellefe baglandi. ` +
        `${result.eslesmeyenFirmalar} firmada AgentEvent bulunamadi, ` +
        `${result.mukellefBulunamayan} firmada Taxpayer tablosunda eslesme yok.`,
      ...result,
    };
  }

  @Post('cleanup-unscoped')
  async cleanupUnscoped(@Req() req: any) {
    const tenantId = req?.user?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId yok');
    const result = await this.service.cleanupUnscopedMemory(tenantId);
    return {
      ok: true,
      mesaj: `${result.removedUnscopedDecisions} mukellefsiz karar ve ${result.removedEmptyMemories} bos firma hafizasi temizlendi.`,
      ...result,
    };
  }

  /** Tek firma detayi — tum kategorilerin dokumu */
  @Get('import-mihsap-events/preview')
  async previewMihsapEvents(@Req() req: any, @Query('limit') limit?: string) {
    const tenantId = req?.user?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId yok');
    return this.service.importFromMihsapEvents(tenantId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      dryRun: true,
    });
  }

  @Post('import-mihsap-events')
  async importMihsapEvents(@Req() req: any, @Query('limit') limit?: string) {
    const tenantId = req?.user?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId yok');
    const result = await this.service.importFromMihsapEvents(tenantId, {
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    const cleanup = await this.service.cleanupUnscopedMemory(tenantId);
    return {
      ok: true,
      mesaj: `${result.imported} Mihsap gecmis islemi firma hafizasina aktarildi. ` +
        `${result.skipped} kayit atlandi, ${result.missingTaxpayer} kayitta mukellef eslesmedi. ` +
        `${cleanup.removedEmptyMemories} bos hafiza satiri temizlendi.`,
      cleanup,
      ...result,
    };
  }

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
