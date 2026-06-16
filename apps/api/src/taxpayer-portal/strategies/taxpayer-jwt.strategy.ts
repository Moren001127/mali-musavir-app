import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Mükellef (taxpayer) self-servis portal token'ı.
 * Müşavir/personel token'ından AYRI bir strateji ('taxpayer-jwt'):
 *  - payload.type === 'taxpayer' ve payload.sub === taxpayerId olmalı.
 *  - Müşavir 'jwt' stratejisi sub'ı `users` tablosunda arar → mükellef token'ı orada
 *    bulunamaz, yani mükellef token'ı müşavir uçlarını AÇAMAZ.
 *  - Bu strateji sub'ı `taxpayers` tablosunda arar → müşavir token'ı burada bulunamaz.
 *  Böylece iki taraf birbirinin uçlarına erişemez.
 */
@Injectable()
export class TaxpayerJwtStrategy extends PassportStrategy(Strategy, 'taxpayer-jwt') {
  constructor(config: ConfigService, private prisma: PrismaService) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret || secret.length < 32 || /change-this/i.test(secret)) {
      throw new Error('JWT_SECRET must be a non-default secret with at least 32 characters');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: any) {
    if (!payload || payload.type !== 'taxpayer' || !payload.sub) {
      throw new UnauthorizedException();
    }
    const taxpayer = await this.prisma.taxpayer.findUnique({
      where: { id: payload.sub },
      select: { id: true, tenantId: true, isActive: true, portalEnabled: true },
    });
    if (!taxpayer || !taxpayer.isActive || !taxpayer.portalEnabled) {
      throw new UnauthorizedException();
    }
    return { taxpayerId: taxpayer.id, tenantId: taxpayer.tenantId, type: 'taxpayer' };
  }
}
