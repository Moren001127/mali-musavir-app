import { Injectable, UnauthorizedException, ConflictException, BadRequestException, Logger, Optional } from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notification-types';
import { RegisterDto } from '@mali-musavir/shared';
import { randomBytes, createHash } from 'crypto';
import { encrypt, tryDecrypt } from '../common/crypto';
import { generateBase32Secret, verifyTotp, buildOtpauthUri, formatSecretForDisplay } from '../common/totp';

// Brute-force: hesap bazlı kilit (IP değil — ofis tek-IP'de cezalanmaz)
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
    private jwtService: JwtService,
    private config: ConfigService,
    @Optional() private notifications?: NotificationsService,
    @Optional() private email?: EmailService,
  ) {}

  // === ŞİFREMİ UNUTTUM (müşavir) — DB migration YOK: reset tokenı JWT (ayrı secret). Şifre değişince
  //   token içindeki 'pv' (passwordHash özeti) tutmaz → TEK KULLANIMLIK + otomatik geçersiz. ===
  private resetSecret(): string {
    return (this.config.get<string>('JWT_SECRET') || '') + '::pwreset';
  }

  /** Sıfırlama iste: kullanıcı varsa e-posta ile 1 saatlik link gönder. Varlık bilgisi SIZDIRMAZ
   *  (kayıtlı olsun olmasın aynı yanıt). */
  async requestPasswordReset(email: string): Promise<{ ok: true }> {
    const clean = String(email || '').trim().toLowerCase();
    if (clean) {
      const user = await this.prisma.user
        .findFirst({ where: { email: { equals: clean, mode: 'insensitive' }, isActive: true } })
        .catch(() => null);
      if (user) {
        const pv = createHash('sha256').update(user.passwordHash).digest('hex').slice(0, 16);
        const token = this.jwtService.sign({ sub: user.id, typ: 'pwreset', pv }, { secret: this.resetSecret(), expiresIn: '1h' });
        const base = String(process.env.PUBLIC_WEB_URL || 'https://portal.morenmusavirlik.com').replace(/\/+$/, '');
        const link = `${base}/sifre-sifirla?token=${encodeURIComponent(token)}`;
        const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1f2937">`
          + `<h2 style="color:#1e3a8a;margin:0 0 12px">Moren Portal — Şifre Sıfırlama</h2>`
          + `<p>Merhaba ${this.htmlEscape(user.firstName || '')},</p>`
          + `<p>Hesabınız için şifre sıfırlama talebi aldık. Yeni şifre belirlemek için aşağıdaki butona tıklayın (bağlantı <b>1 saat</b> geçerlidir):</p>`
          + `<p style="text-align:center;margin:24px 0"><a href="${link}" style="background:#1e3a8a;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:700;display:inline-block">Şifremi Sıfırla</a></p>`
          + `<p style="font-size:12px;color:#6b7280">Bu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz; şifreniz değişmez.</p>`
          + `<p style="font-size:11px;color:#9ca3af;word-break:break-all">Buton çalışmazsa: ${link}</p></div>`;
        await this.email
          ?.send({ to: user.email, subject: 'Moren Portal — Şifre Sıfırlama', html }, user.tenantId)
          .catch((e: any) => this.logger.warn(`Şifre sıfırlama e-postası gönderilemedi: ${e?.message || e}`));
      }
    }
    return { ok: true };
  }

  /** Sıfırla: token doğrula (typ+pv+süre) → yeni şifre (argon2) + kilit sıfırla + oturumları iptal. */
  async resetPassword(token: string, newPassword: string): Promise<{ ok: true }> {
    const pw = String(newPassword || '');
    if (pw.length < 8) throw new BadRequestException('Şifre en az 8 karakter olmalıdır');
    let payload: any = null;
    try { payload = this.jwtService.verify(String(token || ''), { secret: this.resetSecret() }); }
    catch { throw new UnauthorizedException('Sıfırlama bağlantısı geçersiz veya süresi dolmuş — yeni bağlantı isteyin'); }
    if (payload?.typ !== 'pwreset' || !payload?.sub) throw new UnauthorizedException('Geçersiz sıfırlama bağlantısı');
    const user = await this.prisma.user.findFirst({ where: { id: String(payload.sub), isActive: true } });
    if (!user) throw new UnauthorizedException('Kullanıcı bulunamadı');
    const pv = createHash('sha256').update(user.passwordHash).digest('hex').slice(0, 16);
    if (pv !== payload.pv) throw new UnauthorizedException('Bağlantı kullanılmış veya şifre değişmiş — yeni bağlantı isteyin');
    const passwordHash = await argon2.hash(pw, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3 });
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null } });
    await this.prisma.refreshToken.deleteMany({ where: { userId: user.id } }).catch(() => {}); // tüm oturumları kapat
    return { ok: true };
  }

  private htmlEscape(s: string): string {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findFirst({
      where: { email, isActive: true },
      include: { userRoles: { include: { role: true } } },
    });

    if (!user) throw new UnauthorizedException('Geçersiz e-posta veya şifre');

    // Hesap kilitli mi? (brute-force koruması)
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const dk = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new UnauthorizedException(`Çok fazla hatalı deneme. Hesap ${dk} dakika kilitli.`);
    }

    const isValid = await argon2.verify(user.passwordHash, password);
    if (!isValid) {
      await this.registerFailedLogin(user.id, user.failedLoginCount || 0);
      throw new UnauthorizedException('Geçersiz e-posta veya şifre');
    }

    // Başarılı giriş → sayaç/kilit sıfırla (gerekiyorsa)
    if ((user.failedLoginCount || 0) > 0 || user.lockedUntil) {
      await this.prisma.user
        .update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } })
        .catch(() => null);
    }

    return user;
  }

  /** Hatalı şifre denemesini say; eşiğe gelince hesabı geçici kilitle. */
  private async registerFailedLogin(userId: string, current: number) {
    const next = current + 1;
    const data: any = { failedLoginCount: next };
    if (next >= MAX_FAILED_LOGINS) {
      data.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
      data.failedLoginCount = 0; // kilit süresi koruma sağlar; sayaç sıfırlanır
    }
    await this.prisma.user.update({ where: { id: userId }, data }).catch(() => null);
  }

  async login(user: any, ipAddress?: string, totpCode?: string) {
    // İki adımlı doğrulama açıksa kod zorunlu
    if (user.totpEnabled) {
      if (!totpCode) {
        throw new UnauthorizedException('2FA_REQUIRED');
      }
      const secret = tryDecrypt(user.totpSecret || null);
      if (!secret || !verifyTotp(secret, totpCode)) {
        throw new UnauthorizedException('2FA_INVALID');
      }
    }

    const payload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      roles: user.userRoles?.map((ur: any) => ur.role.name) || [],
    };

    // === AUTH_NEW_DEVICE: Yeni IP'den giris tespit ===
    // Bu IP daha once bu kullanici icin refresh token olusturmus mu?
    if (ipAddress && this.notifications) {
      try {
        const knownIp = await this.prisma.refreshToken.findFirst({
          where: { userId: user.id, ipAddress },
          select: { id: true },
        }).catch(() => null);
        if (!knownIp) {
          await this.notifications.create({
            tenantId: user.tenantId,
            userId: user.id,
            type: NOTIFICATION_TYPES.AUTH_NEW_DEVICE,
            title: `🔐 Yeni cihazdan giriş`,
            body: `Hesabınıza yeni bir IP adresinden (${ipAddress}) giriş yapıldı. Bu siz değilseniz şifrenizi hemen değiştirin.`,
            metadata: {
              ipAddress,
              loginAt: new Date().toISOString(),
              link: '/panel/ayarlar',
            },
            dedupeKey: `auth-new-device:${user.id}:${ipAddress}`,
            dedupeWindowMin: 60 * 24 * 7, // 7 gun
          });
        }
      } catch (e) {
        this.logger.warn(`AUTH_NEW_DEVICE check failed: ${(e as Error).message}`);
      }
    }

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

  async refreshTokens(token?: string) {
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('Refresh token gereklidir');
    }
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

  // === İKİ ADIMLI DOĞRULAMA (TOTP) ===

  async getTotpStatus(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { totpEnabled: true } });
    return { enabled: !!u?.totpEnabled };
  }

  /** Yeni secret üret + (henüz aktif etmeden) şifreli sakla; QR/otpauth döndür. */
  async setupTotp(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, totpEnabled: true },
    });
    if (!u) throw new UnauthorizedException();
    if (u.totpEnabled) throw new ConflictException('İki adımlı doğrulama zaten açık.');
    const secret = generateBase32Secret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: encrypt(secret), totpEnabled: false },
    });
    return { secret: formatSecretForDisplay(secret), otpauthUri: buildOtpauthUri(secret, u.email) };
  }

  /** İlk kodu doğrulayıp 2FA'yı aç. */
  async enableTotp(userId: string, code: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { totpSecret: true } });
    const secret = tryDecrypt(u?.totpSecret || null);
    if (!secret) throw new UnauthorizedException('Önce kurulumu başlatın.');
    if (!verifyTotp(secret, code)) {
      throw new UnauthorizedException('Kod geçersiz. Uygulamadaki güncel 6 haneli kodu girin.');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { totpEnabled: true } });
    return { enabled: true };
  }

  /** Geçerli kodla 2FA'yı kapat + secret'ı sil. */
  async disableTotp(userId: string, code: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { totpSecret: true, totpEnabled: true },
    });
    if (!u?.totpEnabled) return { enabled: false };
    const secret = tryDecrypt(u.totpSecret || null);
    if (!secret || !verifyTotp(secret, code)) throw new UnauthorizedException('Kod geçersiz.');
    await this.prisma.user.update({ where: { id: userId }, data: { totpEnabled: false, totpSecret: null } });
    return { enabled: false };
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
