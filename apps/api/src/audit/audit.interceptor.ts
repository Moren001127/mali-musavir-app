import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const { method, url, user, ip } = req;

    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    if (!isWrite || !user?.sub) return next.handle();

    const action = method === 'DELETE' ? 'DELETE' : method === 'POST' ? 'CREATE' : 'UPDATE';
    const resource = url.split('/')[3] || 'unknown';

    return next.handle().pipe(
      tap(() => {
        this.prisma.auditLog
          .create({
            data: {
              tenantId: user.tenantId,
              userId: user.sub,
              action,
              resource,
              ipAddress: ip,
            },
          })
          .catch(() => {});
      }),
    );
  }
}
