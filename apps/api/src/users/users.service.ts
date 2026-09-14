import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as argon2 from 'argon2';

/** Türkiye cep numarası → 90XXXXXXXXXX; tanınmazsa null. */
export function normalizeTelefon(raw: unknown): string | null {
  let d = String(raw ?? '').replace(/[^\d]/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length === 11) d = '90' + d.slice(1);
  if (d.length === 10 && d.startsWith('5')) d = '90' + d;
  return /^905\d{9}$/.test(d) ? d : null;
}

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
        phone: true,
        lastLoginAt: true,
        createdAt: true,
        userRoles: { include: { role: true } },
      },
    });
  }

  /** WhatsApp telefonu (2026-09-14 görev hatırlatması) — boş/geçersiz → null. 90XXXXXXXXXX biçiminde saklanır. */
  async updatePhone(id: string, tenantId: string, phoneRaw: unknown) {
    const user = await this.prisma.user.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!user) throw new NotFoundException('Kullanıcı bulunamadı');
    const phone = normalizeTelefon(phoneRaw);
    if (phoneRaw && String(phoneRaw).trim() && !phone) throw new BadRequestException('Telefon geçersiz — 05XX XXX XX XX biçiminde yazın');
    return this.prisma.user.update({ where: { id }, data: { phone }, select: { id: true, email: true, firstName: true, lastName: true, phone: true } });
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

  async createWithPassword(
    tenantId: string,
    dto: { email: string; password: string; firstName?: string; lastName?: string; roleName: string },
  ) {
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const role = await this.prisma.role.upsert({
      where: { name: dto.roleName },
      create: { name: dto.roleName },
      update: {},
    });
    const existing = await this.prisma.user.findFirst({ where: { tenantId, email: dto.email } });
    if (existing) throw new NotFoundException('Bu email zaten kayıtlı');
    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email: dto.email,
        passwordHash,
        firstName: dto.firstName || '',
        lastName: dto.lastName || '',
        userRoles: { create: { roleId: role.id } },
      },
    });
    return { userId: user.id };
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
