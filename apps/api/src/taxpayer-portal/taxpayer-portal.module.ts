import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TaxpayerPortalController } from './taxpayer-portal.controller';
import { TaxpayerPortalOdemeController } from './taxpayer-portal-odeme.controller';
import { TaxpayerPortalService } from './taxpayer-portal.service';
import { TaxpayerJwtStrategy } from './strategies/taxpayer-jwt.strategy';
import { KdvBeyannameModule } from '../kdv-beyanname/kdv-beyanname.module';
import { DriveModule } from '../drive/drive.module';
import { EmailModule } from '../email/email.module';
import { AkilliBildirimModule } from '../akilli-bildirim/akilli-bildirim.module';

@Module({
  imports: [
    PassportModule,
    EmailModule,
    // KDV özeti (aylık alış/satış/ödenecek KDV) — Luca-mutabık ön-hazırlık verisi.
    KdvBeyannameModule,
    // Fatura görüntüsü (Drive-öncelikli → MIHSAP) — storageKey olmasa da gösterebilmek için.
    DriveModule,
    // Aylık ödeme cetveli (mükellef kendi satırlarını görür) — AylikOdemeService buradan gelir.
    AkilliBildirimModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret || secret.length < 32 || /change-this/i.test(secret)) {
          throw new Error('JWT_SECRET must be a non-default secret with at least 32 characters');
        }
        return { secret };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [TaxpayerPortalController, TaxpayerPortalOdemeController],
  providers: [TaxpayerPortalService, TaxpayerJwtStrategy],
})
export class TaxpayerPortalModule {}
