import { Module } from '@nestjs/common';
import { GenelSorgularController } from './genel-sorgular.controller';
import { GenelSorgularService } from './genel-sorgular.service';

/**
 * Genel Sorgulamalar (2026-09-14) — vergi borcu / e-haciz / yoklama-denetim / POS / gelen e-arşiv
 * sorgu sonuçlarının okunması ve kaydı. Şimdilik İSKELET: sorgu üretmez, yalnız listeler ve
 * `kaydet()` ile ileride sorgu işlerinin yazacağı satırları tutar.
 */
@Module({
  controllers: [GenelSorgularController],
  providers: [GenelSorgularService],
  exports: [GenelSorgularService],
})
export class GenelSorgularModule {}
