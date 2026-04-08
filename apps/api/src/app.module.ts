import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TaxpayersModule } from './taxpayers/taxpayers.module';
import { DocumentsModule } from './documents/documents.module';
import { KdvControlModule } from './kdv-control/kdv-control.module';
import { AuditModule } from './audit/audit.module';
import { NotificationsModule } from './notifications/notifications.module';
import { FisYazdirmaModule } from './fis-yazdirma/fis-yazdirma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    StorageModule,
    AuthModule,
    UsersModule,
    TaxpayersModule,
    DocumentsModule,
    KdvControlModule,
    AuditModule,
    NotificationsModule,
    FisYazdirmaModule,
  ],
})
export class AppModule {}
