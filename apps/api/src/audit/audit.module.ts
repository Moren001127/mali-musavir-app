import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * v1.36.73: AuditInterceptor APP_INTERCEPTOR ile GLOBAL register edildi.
 * Önceden sadece provider olarak kayıtlıydı — hiçbir request'te tetiklenmiyordu.
 * Şimdi tüm POST/PUT/PATCH/DELETE çağrıları otomatik audit_logs tablosuna
 * yazılacak. Sadece JWT auth'lu (req.user.sub var) request'ler kaydedilir.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AuditController],
  providers: [
    AuditInterceptor,
    AuditService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
  exports: [AuditInterceptor, AuditService],
})
export class AuditModule {}
