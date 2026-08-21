import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MizanModule } from '../mizan/mizan.module';
import { Yapilandirma7582Controller } from './yapilandirma-7582.controller';
import { Yapilandirma7582Service } from './yapilandirma-7582.service';

/**
 * 7582 / Seri:B Sıra No:20 yapılandırma modülü.
 * MizanModule SALT OKUMA amaçlı import edilir (BilancoService) — kilitli modül DEĞİŞTİRİLMEZ.
 */
@Module({
  imports: [PrismaModule, MizanModule],
  controllers: [Yapilandirma7582Controller],
  providers: [Yapilandirma7582Service],
  exports: [Yapilandirma7582Service],
})
export class Yapilandirma7582Module {}
