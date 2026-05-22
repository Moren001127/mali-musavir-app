import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const MESSAGE_LIMIT = 4000;

@Injectable()
export class OfficeChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async listUsers(tenantId: string, currentUserId: string) {
    const users = await this.prisma.user.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { email: 'asc' }],
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        lastLoginAt: true,
      },
    });

    return users.map((user) => ({
      ...this.publicUser(user),
      isCurrent: user.id === currentUserId,
    }));
  }

  async listThreads(tenantId: string, userId: string) {
    const general = await this.ensureGeneralThread(tenantId, userId);
    const participantRows = await (this.prisma as any).officeChatParticipant.findMany({
      where: { tenantId, userId },
      select: { threadId: true },
    });
    const threadIds = Array.from(new Set([general.id, ...participantRows.map((p: any) => p.threadId)]));

    const rows = await (this.prisma as any).officeChatThread.findMany({
      where: {
        tenantId,
        id: { in: threadIds },
      },
      orderBy: { updatedAt: 'desc' },
      include: this.threadInclude(1),
    });

    return Promise.all(rows.map((row: any) => this.threadSummary(row, userId)));
  }

  async openDirectThread(tenantId: string, userId: string, targetUserId: string) {
    if (!targetUserId || targetUserId === userId) {
      throw new BadRequestException('Gecersiz kullanici secimi');
    }

    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, tenantId, isActive: true },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('Kullanici bulunamadi');

    const myThreads = await (this.prisma as any).officeChatParticipant.findMany({
      where: { tenantId, userId },
      select: { threadId: true },
    });
    const candidateIds = myThreads.map((p: any) => p.threadId);
    const candidates = candidateIds.length
      ? await (this.prisma as any).officeChatThread.findMany({
          where: { tenantId, kind: 'DIRECT', id: { in: candidateIds } },
          include: { participants: true },
        })
      : [];

    const existing = candidates.find((thread: any) => {
      const participantIds = thread.participants.map((p: any) => p.userId).sort();
      return participantIds.length === 2 && participantIds.includes(userId) && participantIds.includes(targetUserId);
    });

    if (existing) {
      return this.getThread(tenantId, userId, existing.id);
    }

    const thread = await (this.prisma as any).officeChatThread.create({
      data: {
        tenantId,
        kind: 'DIRECT',
        createdById: userId,
        participants: {
          create: [
            { tenantId, userId, lastReadAt: new Date() },
            { tenantId, userId: targetUserId, lastReadAt: null },
          ],
        },
      },
      include: this.threadInclude(50),
    });

    return this.threadDetail(thread, userId);
  }

  async getThread(tenantId: string, userId: string, threadId: string) {
    const thread = await this.findAuthorizedThread(tenantId, userId, threadId);

    await this.markRead(tenantId, userId, thread.id);

    const fresh = await (this.prisma as any).officeChatThread.findFirst({
      where: { id: thread.id, tenantId },
      include: this.threadInclude(80),
    });

    return this.threadDetail(fresh, userId);
  }

  async sendMessage(tenantId: string, userId: string, threadId: string, rawContent: string) {
    const content = String(rawContent || '').trim();
    if (!content) throw new BadRequestException('Mesaj bos olamaz');
    if (content.length > MESSAGE_LIMIT) {
      throw new BadRequestException(`Mesaj ${MESSAGE_LIMIT} karakteri gecemez`);
    }

    const thread = await this.findAuthorizedThread(tenantId, userId, threadId);
    const sender = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: this.userSelect(),
    });
    if (!sender) throw new NotFoundException('Kullanici bulunamadi');

    const message = await (this.prisma as any).officeChatMessage.create({
      data: {
        tenantId,
        threadId: thread.id,
        senderId: userId,
        content,
      },
      include: {
        sender: { select: this.userSelect() },
      },
    });

    await (this.prisma as any).officeChatThread.update({
      where: { id: thread.id },
      data: { updatedAt: new Date() },
    });

    const recipients = await this.resolveRecipients(tenantId, userId, thread);
    await Promise.all(
      recipients.map((recipient: any) =>
        this.notifications.create({
          tenantId,
          userId: recipient.id,
          title: `${this.displayName(sender)} mesaj gonderdi`,
          body: content.length > 180 ? `${content.slice(0, 177)}...` : content,
          type: 'OFFICE_CHAT',
          metadata: {
            link: `/panel?officeChat=open&threadId=${thread.id}`,
            threadId: thread.id,
            messageId: message.id,
            senderId: userId,
          },
        }).catch(() => null),
      ),
    );

    return {
      message: this.publicMessage(message),
      thread: await this.getThread(tenantId, userId, thread.id),
    };
  }

  async markRead(tenantId: string, userId: string, threadId: string) {
    const thread = await (this.prisma as any).officeChatThread.findFirst({
      where: { id: threadId, tenantId },
      include: { participants: true },
    });
    if (!thread) throw new NotFoundException('Sohbet bulunamadi');
    if (thread.kind !== 'GENERAL' && !thread.participants.some((p: any) => p.userId === userId)) {
      throw new ForbiddenException('Bu sohbete erisim yok');
    }

    await this.ensureParticipant(tenantId, threadId, userId, new Date());
    await (this.prisma as any).notification.updateMany({
      where: {
        tenantId,
        userId,
        type: 'OFFICE_CHAT',
        isRead: false,
        metadata: { path: ['threadId'], equals: threadId },
      },
      data: { isRead: true, readAt: new Date() },
    }).catch(() => null);
    return { ok: true };
  }

  private async ensureGeneralThread(tenantId: string, userId: string) {
    let thread = await (this.prisma as any).officeChatThread.findFirst({
      where: { tenantId, kind: 'GENERAL' },
      orderBy: { createdAt: 'asc' },
    });

    if (!thread) {
      thread = await (this.prisma as any).officeChatThread.create({
        data: {
          tenantId,
          kind: 'GENERAL',
          title: 'Ofis Genel',
          createdById: userId,
        },
      });
    }

    await this.ensureParticipant(tenantId, thread.id, userId, null);
    return thread;
  }

  private async findAuthorizedThread(tenantId: string, userId: string, threadId: string) {
    const thread = await (this.prisma as any).officeChatThread.findFirst({
      where: { id: threadId, tenantId },
      include: { participants: true },
    });
    if (!thread) throw new NotFoundException('Sohbet bulunamadi');

    if (thread.kind === 'GENERAL') {
      await this.ensureParticipant(tenantId, thread.id, userId, null);
      return thread;
    }

    if (!thread.participants.some((p: any) => p.userId === userId)) {
      throw new ForbiddenException('Bu sohbete erisim yok');
    }

    return thread;
  }

  private async ensureParticipant(
    tenantId: string,
    threadId: string,
    userId: string,
    lastReadAt: Date | null,
  ) {
    return (this.prisma as any).officeChatParticipant.upsert({
      where: { threadId_userId: { threadId, userId } },
      update: lastReadAt ? { lastReadAt } : {},
      create: { tenantId, threadId, userId, lastReadAt },
    });
  }

  private async resolveRecipients(tenantId: string, senderId: string, thread: any) {
    if (thread.kind === 'GENERAL') {
      const users = await this.prisma.user.findMany({
        where: { tenantId, isActive: true, id: { not: senderId } },
        select: { id: true },
      });

      await Promise.all(users.map((user) => this.ensureParticipant(tenantId, thread.id, user.id, null)));
      return users;
    }

    return thread.participants
      .filter((participant: any) => participant.userId !== senderId)
      .map((participant: any) => ({ id: participant.userId }));
  }

  private async threadSummary(thread: any, currentUserId: string) {
    const participant = thread.participants.find((p: any) => p.userId === currentUserId);
    const where: any = {
      threadId: thread.id,
      senderId: { not: currentUserId },
    };
    if (participant?.lastReadAt) where.createdAt = { gt: participant.lastReadAt };

    const unreadCount = await (this.prisma as any).officeChatMessage.count({ where });
    const participants = thread.participants.map((p: any) => this.publicUser(p.user));
    const lastMessage = thread.messages?.[0] ? this.publicMessage(thread.messages[0]) : null;

    return {
      id: thread.id,
      kind: thread.kind,
      title: this.threadTitle(thread, currentUserId),
      participants,
      lastMessage,
      unreadCount,
      updatedAt: thread.updatedAt,
      createdAt: thread.createdAt,
    };
  }

  private async threadDetail(thread: any, currentUserId: string) {
    const summary = await this.threadSummary(thread, currentUserId);
    return {
      ...summary,
      messages: [...(thread.messages || [])]
        .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map((message: any) => this.publicMessage(message)),
    };
  }

  private threadTitle(thread: any, currentUserId: string) {
    if (thread.kind === 'GENERAL') return thread.title || 'Ofis Genel';
    const other = thread.participants
      .map((participant: any) => participant.user)
      .find((user: any) => user?.id !== currentUserId);
    return other ? this.displayName(other) : thread.title || 'Birebir Sohbet';
  }

  private publicMessage(message: any) {
    return {
      id: message.id,
      threadId: message.threadId,
      content: message.content,
      createdAt: message.createdAt,
      sender: this.publicUser(message.sender),
    };
  }

  private publicUser(user: any) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: this.displayName(user),
      lastLoginAt: user.lastLoginAt ?? null,
    };
  }

  private displayName(user: any) {
    const name = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
    return name || user?.email || 'Kullanici';
  }

  private userSelect() {
    return {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      lastLoginAt: true,
    };
  }

  private threadInclude(messageTake: number) {
    return {
      participants: {
        include: {
          user: { select: this.userSelect() },
        },
      },
      messages: {
        take: messageTake,
        orderBy: { createdAt: 'desc' },
        include: {
          sender: { select: this.userSelect() },
        },
      },
    };
  }
}
