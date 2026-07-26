import { Controller, Get, Post, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MaliYorumService } from './mali-yorum.service';

/**
 * Mali Yorum — Mizan/Bilanço/Gelir Tablosu/İşletme Hesap Özeti için
 * yapay zeka değerlendirmesi. Kayıtlı değerlendirmeyi getirir veya üretir.
 */
@Controller('mali-yorum')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class MaliYorumController {
  constructor(private readonly service: MaliYorumService) {}

  /** Kayıtlı değerlendirmeyi getir (yoksa null döner — sayfa "üret" düğmesi gösterir). */
  @Get(':kaynak/:kaynakId')
  get(@Req() req: any, @Param('kaynak') kaynak: string, @Param('kaynakId') kaynakId: string) {
    return this.service.get(req.user.tenantId, kaynak, decodeURIComponent(kaynakId));
  }

  /** Değerlendirme üret. ?force=1 verilirse yeniden üretir, aksi halde kayıtlıyı döner. */
  @Post(':kaynak/:kaynakId/uret')
  generate(
    @Req() req: any,
    @Param('kaynak') kaynak: string,
    @Param('kaynakId') kaynakId: string,
    @Query('force') force?: string,
  ) {
    const yenile = force === '1' || force === 'true';
    return this.service.generate(req.user.tenantId, kaynak, decodeURIComponent(kaynakId), yenile);
  }
}
