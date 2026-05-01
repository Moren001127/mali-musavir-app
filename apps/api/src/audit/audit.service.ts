import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditListFilters {
  tenantId: string;
  userId?: string;
  resource?: string;
  action?: string;
  from?: Date;
  to?: Date;
  search?: string; // resource veya resourceId substring
  limit?: number;
  offset?: number;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: AuditListFilters) {
    const where: any = { tenantId: filters.tenantId };
    if (filters.userId) where.userId = filters.userId;
    if (filters.resource) where.resource = filters.resource;
    if (filters.action) where.action = filters.action;
    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) where.createdAt.gte = filters.from;
      if (filters.to) where.createdAt.lte = filters.to;
    }
    if (filters.search) {
      where.OR = [
        { resource: { contains: filters.search, mode: 'insensitive' } },
        { resourceId: { contains: filters.search, mode: 'insensitive' } },
        { action: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const limit = Math.min(filters.limit ?? 100, 500);
    const offset = filters.offset ?? 0;

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  /** Filtre dropdown'larını doldurmak için benzersiz kaynak/aksiyon listesi */
  async getFacets(tenantId: string) {
    // Postgres distinct group-by — son 90 gün ile sınırla (perf için)
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const [resources, actions, users] = await Promise.all([
      this.prisma.auditLog.groupBy({
        by: ['resource'],
        where: { tenantId, createdAt: { gte: since } },
        _count: { _all: true },
        orderBy: { _count: { resource: 'desc' } },
        take: 30,
      }),
      this.prisma.auditLog.groupBy({
        by: ['action'],
        where: { tenantId, createdAt: { gte: since } },
        _count: { _all: true },
        orderBy: { _count: { action: 'desc' } },
        take: 30,
      }),
      this.prisma.user.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, email: true, firstName: true, lastName: true },
        orderBy: { firstName: 'asc' },
      }),
    ]);

    return {
      resources: resources.map((r) => ({ value: r.resource, count: r._count._all })),
      actions: actions.map((a) => ({ value: a.action, count: a._count._all })),
      users,
    };
  }

  /** Son 30 günün günlük aksiyon sayısı — küçük chart için */
  async getDailyStats(tenantId: string, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT DATE_TRUNC('day', "createdAt") AS day, COUNT(*)::bigint AS count
      FROM audit_logs
      WHERE "tenantId" = ${tenantId} AND "createdAt" >= ${since}
      GROUP BY day
      ORDER BY day ASC
    `;
    return rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      count: Number(r.count),
    }));
  }
}
