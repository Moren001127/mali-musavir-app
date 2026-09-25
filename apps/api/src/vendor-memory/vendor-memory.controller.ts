import {
  Controller,
  Get,
  Post,
  Body,
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

  /** CARİ DEFTERİ — VKN/TCKN yazılınca ünvan + vergi dairesi + adres döner (fatura formu için). */
  @Get('cari/:kimlikNo')
  cariAra(@Req() req: any, @Param('kimlikNo') kimlikNo: string) {
    const tenantId = req?.user?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId yok');
    return this.service.cariAra(tenantId, kimlikNo);
  }

  /** CARİ DEFTERİNİ KUR — arşivdeki UBL XML'lerini tarayıp defteri doldurur (bakım işlemi). */
  @Post('cari-defteri-kur')
  cariDefteriKur(@Req() req: any, @Query('limit') limit?: string) {
    const tenantId = req?.user?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId yok');
    return this.service.cariDefteriKur(tenantId, { limit: limit ? parseInt(limit, 10) : undefined });
  }

  /**
   * ÜNVAN HİZALA — bir VKN için TEK doğru ünvan (cari defteri + o VKN'li alış belgeleri).
   * Aynı satıcının farklı yazılışlarla durmasını (Luca'da mükerrer cari) bitirir.
   * dryRun varsayılan TRUE. `documents/reparse-satici-unvan`dan SONRA çalıştırılmalı.
   */
  @Post('cari-unvan-hizala')
  cariUnvanHizala(@Req() req: any, @Body() body: { dryRun?: boolean; limit?: number }) {
    const tenantId = req?.user?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId yok');
    return this.service.cariUnvanHizala(tenantId, {
      dryRun: body?.dryRun !== false,
      limit: body?.limit,
    });
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
