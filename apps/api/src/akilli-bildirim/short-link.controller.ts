import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { Injectable } from '@nestjs/common';

/** Mesajlara konan kısa belge linki üretici. */
@Injectable()
export class ShortLinkService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, storageKey: string, filename: string, days = 7): Promise<string> {
    const token = randomBytes(6).toString('base64url'); // 8 karakter
    await (this.prisma as any).shortLink.create({
      data: { token, tenantId, storageKey, filename, expiresAt: new Date(Date.now() + days * 24 * 3600 * 1000) },
    });
    const base = process.env.PORTAL_PUBLIC_URL || 'https://portal.morenmusavirlik.com';
    return `${base}/b/${token}`;
  }
}

/** Herkese açık kısa link ucu: /b/:token → belgeye yönlendirir (süresi dolunca 404). */
@Controller('b')
export class ShortLinkController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get(':token')
  async open(@Param('token') token: string, @Res() res: Response) {
    const clean = String(token).replace(/\.pdf$/i, '');
    const link = await (this.prisma as any).shortLink.findUnique({ where: { token: clean } });
    if (!link || link.expiresAt < new Date()) throw new NotFoundException('Belge linkinin süresi dolmuş');
    const url = await this.storage.getPresignedInlineUrl(link.storageKey, link.filename, 'application/pdf', 3600);
    res.redirect(302, url);
  }
}
