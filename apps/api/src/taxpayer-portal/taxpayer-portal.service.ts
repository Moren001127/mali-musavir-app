import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { claudeTextViaMax } from '../common/max-inference';

/**
 * Mükellef self-servis portal mantığı.
 * TÜM veri okumaları taxpayerId'ye KİLİTLİdir; client'tan gelen taxpayerId asla
 * kullanılmaz — yalnız token'daki (doğrulanmış) taxpayerId kullanılır.
 */
@Injectable()
export class TaxpayerPortalService {
  private readonly logger = new Logger(TaxpayerPortalService.name);

  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  // ============ AUTH ============

  async login(email: string, password: string) {
    const mail = String(email || '').trim().toLowerCase();
    if (!mail || !password) throw new UnauthorizedException('E-posta ve şifre gerekli');

    const taxpayer = await this.prisma.taxpayer.findFirst({
      where: {
        portalEmail: { equals: mail, mode: 'insensitive' },
        portalEnabled: true,
        isActive: true,
      },
    });
    if (!taxpayer || !taxpayer.portalPasswordHash) {
      throw new UnauthorizedException('Geçersiz e-posta veya şifre');
    }
    const ok = await argon2.verify(taxpayer.portalPasswordHash, password);
    if (!ok) throw new UnauthorizedException('Geçersiz e-posta veya şifre');

    await this.prisma.taxpayer
      .update({ where: { id: taxpayer.id }, data: { portalLastLoginAt: new Date() } })
      .catch(() => null);

    const accessToken = this.jwt.sign(
      { sub: taxpayer.id, tenantId: taxpayer.tenantId, type: 'taxpayer' },
      { expiresIn: '12h' },
    );
    return { accessToken, taxpayer: this.publicProfile(taxpayer) };
  }

  // ============ MÜŞAVİR TARAFI: portal erişimi aç/kapat ============

  /** Müşavir bir mükellefin portal erişimini açar/şifresini belirler. Tenant doğrulanır. */
  async setPortalAccess(
    tenantId: string,
    taxpayerId: string,
    opts: { enabled?: boolean; portalEmail?: string; password?: string },
  ) {
    const tp = await this.prisma.taxpayer.findFirst({ where: { id: taxpayerId, tenantId } });
    if (!tp) throw new NotFoundException('Mükellef bulunamadı');

    const data: any = {};
    if (opts.enabled === false) {
      data.portalEnabled = false;
    } else {
      const mail = String(opts.portalEmail || tp.portalEmail || tp.email || '').trim();
      if (!mail) throw new BadRequestException('Portal e-postası gerekli (mükellefin e-postası yok)');
      data.portalEmail = mail;
      data.portalEnabled = true;
      if (opts.password) {
        if (String(opts.password).length < 6) {
          throw new BadRequestException('Şifre en az 6 karakter olmalı');
        }
        data.portalPasswordHash = await argon2.hash(opts.password, {
          type: argon2.argon2id,
          memoryCost: 65536,
          timeCost: 3,
        });
      }
      if (!tp.portalPasswordHash && !opts.password) {
        throw new BadRequestException('İlk açılışta şifre belirleyin');
      }
    }

    const updated = await this.prisma.taxpayer.update({ where: { id: taxpayerId }, data });
    return {
      taxpayerId,
      portalEnabled: updated.portalEnabled,
      portalEmail: updated.portalEmail,
      hasPassword: !!updated.portalPasswordHash,
    };
  }

  async getPortalAccessStatus(tenantId: string, taxpayerId: string) {
    const tp = await this.prisma.taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      select: { portalEnabled: true, portalEmail: true, portalPasswordHash: true, portalLastLoginAt: true },
    });
    if (!tp) throw new NotFoundException('Mükellef bulunamadı');
    return {
      portalEnabled: tp.portalEnabled,
      portalEmail: tp.portalEmail,
      hasPassword: !!tp.portalPasswordHash,
      portalLastLoginAt: tp.portalLastLoginAt,
    };
  }

  // ============ MÜKELLEFE KİLİTLİ VERİ ============

  async getProfile(taxpayerId: string) {
    const tp = await this.prisma.taxpayer.findUnique({ where: { id: taxpayerId } });
    if (!tp) throw new NotFoundException();
    return this.publicProfile(tp);
  }

  async getBeyannameler(taxpayerId: string) {
    const rows = await this.prisma.beyanDurumu.findMany({
      where: { taxpayerId },
      orderBy: [{ donem: 'desc' }, { beyanTipi: 'asc' }],
      take: 60,
      select: {
        beyanTipi: true,
        donem: true,
        durum: true,
        onayTarihi: true,
        tahakkukTutari: true,
      },
    });
    return rows.map((r) => ({ ...r, tahakkukTutari: r.tahakkukTutari ? Number(r.tahakkukTutari) : null }));
  }

  async getCariOzet(taxpayerId: string) {
    const hareketler = await this.prisma.cariHareket.findMany({
      where: { taxpayerId },
      orderBy: { tarih: 'desc' },
      take: 50,
      select: { tarih: true, tip: true, tutar: true, aciklama: true, donem: true },
    });
    let tahakkuk = 0;
    let tahsilat = 0;
    for (const h of hareketler) {
      const t = Number(h.tutar);
      if (h.tip === 'TAHAKKUK') tahakkuk += t;
      else if (h.tip === 'TAHSILAT') tahsilat += t;
      else if (h.tip === 'IADE') tahsilat += t; // mükellefe iade → borcu azaltır
    }
    return {
      bakiye: tahakkuk - tahsilat,
      tahakkukToplam: tahakkuk,
      tahsilatToplam: tahsilat,
      hareketler: hareketler.map((h) => ({ ...h, tutar: Number(h.tutar) })),
    };
  }

  async getEvraklar(taxpayerId: string) {
    const docs = await this.prisma.document.findMany({
      where: { taxpayerId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, title: true, category: true, createdAt: true, expiresAt: true },
    });
    return docs;
  }

  async getDashboard(taxpayerId: string) {
    const [profile, beyannameler, cari, evraklar] = await Promise.all([
      this.getProfile(taxpayerId),
      this.getBeyannameler(taxpayerId),
      this.getCariOzet(taxpayerId),
      this.getEvraklar(taxpayerId),
    ]);
    const bekleyenBeyan = beyannameler.filter((b) => b.durum === 'beklemede').length;
    return {
      profile,
      ozet: {
        bekleyenBeyan,
        cariBakiye: cari.bakiye,
        evrakSayisi: evraklar.length,
      },
      beyannameler: beyannameler.slice(0, 12),
      cari,
      evraklar: evraklar.slice(0, 12),
    };
  }

  // ============ MÜKELLEFE KİLİTLİ AI SOHBETİ (araçsız, bağlam-temelli) ============

  async chat(taxpayerId: string, message: string) {
    const msg = String(message || '').trim();
    if (!msg) throw new BadRequestException('Mesaj boş olamaz');

    const dash = await this.getDashboard(taxpayerId);
    const p = dash.profile;
    const ad = p.companyName || [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Mükellef';

    const beyanSatir = dash.beyannameler
      .map((b) => `- ${b.beyanTipi} ${b.donem}: ${b.durum}${b.tahakkukTutari ? ` (tahakkuk ${b.tahakkukTutari.toLocaleString('tr-TR')} TL)` : ''}`)
      .join('\n') || 'Kayıt yok.';

    const context = [
      `MÜKELLEF: ${ad}`,
      `Bekleyen beyanname: ${dash.ozet.bekleyenBeyan} · Cari bakiye: ${dash.ozet.cariBakiye.toLocaleString('tr-TR')} TL · Evrak: ${dash.ozet.evrakSayisi}`,
      '',
      'BEYANNAME DURUMU:',
      beyanSatir,
      '',
      `CARİ: Tahakkuk ${dash.cari.tahakkukToplam.toLocaleString('tr-TR')} TL, Tahsilat ${dash.cari.tahsilatToplam.toLocaleString('tr-TR')} TL, Bakiye ${dash.cari.bakiye.toLocaleString('tr-TR')} TL.`,
    ].join('\n');

    const system = [
      'Sen MOREN AI\'sın — Moren Mali Müşavirlik\'in mükellef asistanısın.',
      `Karşındaki kişi "${ad}" adlı mükelleftir. SADECE bu mükellefin aşağıda verilen kendi verisi hakkında konuş.`,
      'Başka mükellef, ofis geneli bilgi veya gizli bilgi ASLA verme. Soru kapsam dışıysa kibarca "Bu konuda müşavirinizle görüşün" de.',
      'Kısa, sade, Türkçe ve mesleki konuş. Rakam verirken mükellefin kendi verisini kullan. Vergi tavsiyesi verirken kesin hüküm yerine yönlendir.',
      '',
      'MÜKELLEFİN GÜNCEL VERİSİ:',
      context,
    ].join('\n');

    try {
      const res = await claudeTextViaMax({ prompt: msg, system, model: 'claude-sonnet-4-6' });
      if (res.ok) return { reply: res.text };
      this.logger.warn(`Mükellef AI Max hatası: ${res.error}`);
      return { reply: 'Şu anda yanıt veremiyorum, lütfen birazdan tekrar deneyin.' };
    } catch (e) {
      this.logger.error(`Mükellef AI hata: ${(e as Error).message}`);
      return { reply: 'Şu anda yanıt veremiyorum, lütfen birazdan tekrar deneyin.' };
    }
  }

  // ============ yardımcı ============

  private publicProfile(tp: any) {
    return {
      id: tp.id,
      type: tp.type,
      firstName: tp.firstName,
      lastName: tp.lastName,
      companyName: tp.companyName,
      taxOffice: tp.taxOffice,
      email: tp.email,
      phone: tp.phone,
      portalEmail: tp.portalEmail,
    };
  }
}
