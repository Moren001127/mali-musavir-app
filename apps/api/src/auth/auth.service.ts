import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from '@mali-musavir/shared';
import { randomBytes, createHash } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findFirst({
      where: { email, isActive: true },
      include: { userRoles: { include: { role: true } } },
    });

    if (!user) throw new UnauthorizedException('Geçersiz e-posta veya şifre');

    const isValid = await argon2.verify(user.passwordHash, password);
    if (!isValid) throw new UnauthorizedException('Geçersiz e-posta veya şifre');

    return user;
  }

  async login(user: any, ipAddress?: string) {
    const payload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      roles: user.userRoles?.map((ur: any) => ur.role.name) || [],
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = await this.generateRefreshToken(user.id, ipAddress);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return { accessToken, refreshToken, user: this.sanitizeUser(user) };
  }

  async register(dto: RegisterDto) {
    const slug = dto.tenantName
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');

    const existingTenant = await this.prisma.tenant.findUnique({ where: { slug } });
    if (existingTenant) {
      throw new ConflictException('Bu ofis adı zaten kullanılıyor');
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: dto.tenantName, slug, email: dto.email },
      });

      const adminRole = await tx.role.upsert({
        where: { name: 'ADMIN' },
        create: { name: 'ADMIN', description: 'Tam yetkili yönetici' },
        update: {},
      });

      await tx.role.upsert({
        where: { name: 'STAFF' },
        create: { name: 'STAFF', description: 'Ofis personeli' },
        update: {},
      });

      await tx.role.upsert({
        where: { name: 'READONLY' },
        create: { name: 'READONLY', description: 'Salt okunur erişim' },
        update: {},
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: dto.email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          userRoles: { create: { roleId: adminRole.id } },
        },
        include: { userRoles: { include: { role: true } } },
      });

      await tx.dataRetentionPolicy.createMany({
        data: [
          { tenantId: tenant.id, resourceType: 'invoice', retentionMonths: 60, legalBasis: 'VUK Madde 253 - 5 Yıl' },
          { tenantId: tenant.id, resourceType: 'payroll', retentionMonths: 120, legalBasis: 'SGK Kanunu - 10 Yıl' },
          { tenantId: tenant.id, resourceType: 'document', retentionMonths: 60, legalBasis: 'VUK - 5 Yıl' },
          { tenantId: tenant.id, resourceType: 'taxpayer', retentionMonths: 60, legalBasis: 'Sözleşme + 1 Yıl' },
        ],
      });

      return { tenant, user };
    });

    return this.sanitizeUser(result.user);
  }

  async refreshTokens(token: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.isRevoked || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Geçersiz veya süresi dolmuş refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      include: { userRoles: { include: { role: true } } },
    });

    if (!user || !user.isActive) throw new UnauthorizedException();

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { isRevoked: true },
    });

    const newRefreshToken = await this.generateRefreshToken(user.id);
    const payload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      roles: user.userRoles.map((ur) => ur.role.name),
    };
    const accessToken = this.jwtService.sign(payload);

    return { accessToken, refreshToken: newRefreshToken };
  }

  async logout(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true },
    });
  }

  private async generateRefreshToken(userId: string, ipAddress?: string): Promise<string> {
    const token = randomBytes(64).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt, ipAddress },
    });

    return token;
  }

  private sanitizeUser(user: any) {
    const { passwordHash, ...safe } = user;
    return safe;
  }
}
