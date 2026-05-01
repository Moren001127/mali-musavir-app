import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, userId: string) {
    return this.prisma.notification.findMany({
      where: {
        tenantId,
        OR: [{ userId }, { userId: null }],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getUnreadCount(tenantId: string, userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: {
        tenantId,
        isRead: false,
        OR: [{ userId }, { userId: null }],
      },
    });
  }

  async markRead(id: string) {
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
  }

  /** Tenant + (kullanıcının kendi + tenant geneli) tüm okunmamış bildirimleri okundu işaretler */
  async markAllRead(tenantId: string, userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: {
        tenantId,
        isRead: false,
        OR: [{ userId }, { userId: null }],
      },
      data: { isRead: true, readAt: new Date() },
    });
    return { count: result.count };
  }

  async create(data: {
    tenantId: string;
    userId?: string;
    title: string;
    body: string;
    type: string;
    metadata?: any;
  }) {
    return this.prisma.notification.create({ data });
  }
}
