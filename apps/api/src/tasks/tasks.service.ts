import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateTaskDto {
  title: string;
  description?: string;
  category?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  color?: string;
  tags?: string[];
  taxpayerId?: string;
  dueDate?: string; // ISO string
  dueTime?: string; // "HH:mm"
  allDay?: boolean;
  recurrence?: any;
  reminderConfig?: any;
  notifyInApp?: boolean;
  notifyEmail?: boolean;
  notifyBrowser?: boolean;
  notifySound?: boolean;
}

export interface UpdateTaskDto extends Partial<CreateTaskDto> {
  status?: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'SNOOZED' | 'MISSED' | 'CANCELLED';
  snoozedUntil?: string;
}

export interface ListTasksFilters {
  tenantId: string;
  status?: string;
  taxpayerId?: string;
  category?: string;
  priority?: string;
  fromDate?: Date;
  toDate?: Date;
  search?: string;
  isTemplate?: boolean;
  limit?: number;
  offset?: number;
}

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  /** Görev oluştur */
  async create(tenantId: string, userId: string, dto: CreateTaskDto) {
    return (this.prisma as any).task.create({
      data: {
        tenantId,
        title: dto.title,
        description: dto.description,
        category: dto.category,
        priority: dto.priority ?? 'MEDIUM',
        color: dto.color,
        tags: dto.tags ?? [],
        taxpayerId: dto.taxpayerId || null,
        createdById: userId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        dueTime: dto.dueTime,
        allDay: dto.allDay ?? true,
        recurrence: dto.recurrence ?? null,
        reminderConfig: dto.reminderConfig ?? null,
        notifyInApp: dto.notifyInApp ?? true,
        notifyEmail: dto.notifyEmail ?? false,
        notifyBrowser: dto.notifyBrowser ?? true,
        notifySound: dto.notifySound ?? false,
        // Eğer recurrence varsa template olarak işaretle, sonraki occurrence'i hesapla
        isTemplate: !!dto.recurrence && dto.recurrence?.type !== 'NONE',
      },
      include: {
        taxpayer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  /** Görev güncelle */
  async update(tenantId: string, taskId: string, userId: string, dto: UpdateTaskDto) {
    const existing = await (this.prisma as any).task.findFirst({
      where: { id: taskId, tenantId },
    });
    if (!existing) throw new NotFoundException('Görev bulunamadı');

    const updateData: any = {};
    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.category !== undefined) updateData.category = dto.category;
    if (dto.priority !== undefined) updateData.priority = dto.priority;
    if (dto.color !== undefined) updateData.color = dto.color;
    if (dto.tags !== undefined) updateData.tags = dto.tags;
    if (dto.taxpayerId !== undefined) updateData.taxpayerId = dto.taxpayerId || null;
    if (dto.dueDate !== undefined) updateData.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    if (dto.dueTime !== undefined) updateData.dueTime = dto.dueTime;
    if (dto.allDay !== undefined) updateData.allDay = dto.allDay;
    if (dto.recurrence !== undefined) updateData.recurrence = dto.recurrence;
    if (dto.reminderConfig !== undefined) updateData.reminderConfig = dto.reminderConfig;
    if (dto.notifyInApp !== undefined) updateData.notifyInApp = dto.notifyInApp;
    if (dto.notifyEmail !== undefined) updateData.notifyEmail = dto.notifyEmail;
    if (dto.notifyBrowser !== undefined) updateData.notifyBrowser = dto.notifyBrowser;
    if (dto.notifySound !== undefined) updateData.notifySound = dto.notifySound;
    if (dto.status !== undefined) {
      updateData.status = dto.status;
      if (dto.status === 'DONE') {
        updateData.completedAt = new Date();
        updateData.completedById = userId;
      }
    }
    if (dto.snoozedUntil !== undefined) {
      updateData.snoozedUntil = dto.snoozedUntil ? new Date(dto.snoozedUntil) : null;
      if (dto.snoozedUntil) updateData.status = 'SNOOZED';
    }

    return (this.prisma as any).task.update({
      where: { id: taskId },
      data: updateData,
      include: {
        taxpayer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  /** Tek görev getir */
  async findOne(tenantId: string, taskId: string) {
    const task = await (this.prisma as any).task.findFirst({
      where: { id: taskId, tenantId },
      include: {
        taxpayer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        notes: {
          include: { user: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
        },
        attachments: true,
      },
    });
    if (!task) throw new NotFoundException('Görev bulunamadı');
    return task;
  }

  /** Görev listesi (filtreli) */
  async list(filters: ListTasksFilters) {
    const where: any = { tenantId: filters.tenantId };
    if (filters.status) where.status = filters.status;
    if (filters.taxpayerId) where.taxpayerId = filters.taxpayerId;
    if (filters.category) where.category = filters.category;
    if (filters.priority) where.priority = filters.priority;
    if (filters.isTemplate !== undefined) where.isTemplate = filters.isTemplate;
    if (filters.fromDate || filters.toDate) {
      where.dueDate = {};
      if (filters.fromDate) where.dueDate.gte = filters.fromDate;
      if (filters.toDate) where.dueDate.lte = filters.toDate;
    }
    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const limit = Math.min(filters.limit ?? 100, 500);
    const offset = filters.offset ?? 0;

    const [items, total] = await Promise.all([
      (this.prisma as any).task.findMany({
        where,
        orderBy: [
          { status: 'asc' }, // OPEN önce
          { dueDate: 'asc' },
          { priority: 'desc' },
        ],
        take: limit,
        skip: offset,
        include: {
          taxpayer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          notes: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            include: { user: { select: { id: true, firstName: true, lastName: true } } },
          },
          _count: { select: { notes: true, attachments: true } },
        },
      }),
      (this.prisma as any).task.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  /** Görev sil (soft delete - status = CANCELLED) */
  async remove(tenantId: string, taskId: string) {
    const existing = await (this.prisma as any).task.findFirst({
      where: { id: taskId, tenantId },
    });
    if (!existing) throw new NotFoundException('Görev bulunamadı');

    // Hard delete (cascades to notes, attachments, reminder_logs)
    return (this.prisma as any).task.delete({ where: { id: taskId } });
  }

  /** Sayaçlar — ana sayfa kart için */
  async getCounts(tenantId: string) {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const endOfWeek = new Date(now);
    endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));

    const [today, overdue, thisWeek, totalOpen] = await Promise.all([
      (this.prisma as any).task.count({
        where: {
          tenantId,
          status: { in: ['OPEN', 'IN_PROGRESS'] },
          isTemplate: false,
          dueDate: { gte: startOfDay, lte: endOfDay },
        },
      }),
      (this.prisma as any).task.count({
        where: {
          tenantId,
          status: { in: ['OPEN', 'IN_PROGRESS'] },
          isTemplate: false,
          dueDate: { lt: startOfDay },
        },
      }),
      (this.prisma as any).task.count({
        where: {
          tenantId,
          status: { in: ['OPEN', 'IN_PROGRESS'] },
          isTemplate: false,
          dueDate: { gte: startOfDay, lte: endOfWeek },
        },
      }),
      (this.prisma as any).task.count({
        where: {
          tenantId,
          status: { in: ['OPEN', 'IN_PROGRESS'] },
          isTemplate: false,
        },
      }),
    ]);

    return { today, overdue, thisWeek, totalOpen };
  }

  /** Görev not ekle */
  async addNote(tenantId: string, taskId: string, userId: string, content: string) {
    const task = await (this.prisma as any).task.findFirst({
      where: { id: taskId, tenantId },
    });
    if (!task) throw new NotFoundException('Görev bulunamadı');

    return (this.prisma as any).taskNote.create({
      data: { taskId, userId, content },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
  }

  /** Tamamlandı işaretle (kısa yol) */
  async complete(tenantId: string, taskId: string, userId: string) {
    return this.update(tenantId, taskId, userId, { status: 'DONE' });
  }

  /** Ertele */
  async snooze(tenantId: string, taskId: string, userId: string, until: string) {
    return this.update(tenantId, taskId, userId, { snoozedUntil: until });
  }
}
