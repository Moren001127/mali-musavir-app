import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TaxpayerPortalController } from './taxpayer-portal.controller';
import { TaxpayerPortalService } from './taxpayer-portal.service';
import { TaxpayerJwtStrategy } from './strategies/taxpayer-jwt.strategy';

@Module({
  imports: [
    PassportModule,
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
  controllers: [TaxpayerPortalController],
  providers: [TaxpayerPortalService, TaxpayerJwtStrategy],
})
export class TaxpayerPortalModule {}
