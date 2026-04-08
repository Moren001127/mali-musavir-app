import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as argon2 from 'argon2';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAllByTenant(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        userRoles: { include: { role: true } },
      },
    });
  }

  async findOne(id: string, tenantId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId },
      include: { userRoles: { include: { role: true } } },
    });
    if (!user) throw new NotFoundException('Kullanıcı bulunamadı');
    const { passwordHash, ...safe } = user;
    return safe;
  }

  async invite(
    tenantId: string,
    dto: { email: string; firstName: string; lastName: string; roleName: string },
  ) {
    const tempPassword = Math.random().toString(36).slice(-12) + 'A1!';
    const passwordHash = await argon2.hash(tempPassword, { type: argon2.argon2id });

    const role = await this.prisma.role.upsert({
      where: { name: dto.roleName },
      create: { name: dto.roleName },
      update: {},
    });

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        userRoles: { create: { roleId: role.id } },
      },
    });

    return { userId: user.id, tempPassword };
  }

  async deactivate(id: string, tenantId: string) {
    const user = await this.prisma.user.findFirst({ where: { id, tenantId } });
    if (!user) throw new NotFoundException();
    return this.prisma.user.update({ where: { id }, data: { isActive: false } });
  }
}
