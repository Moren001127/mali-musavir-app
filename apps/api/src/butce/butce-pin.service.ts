import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Kimlik } from './butce.service';

/**
 * Modül girişinde sorulan 6 haneli PIN.
 *
 * Neden: portala giriş yapılmış bir bilgisayar başında bırakıldığında kişisel
 * finans verisi açık kalmasın. Oturum açmak yetmez; modül ayrıca PIN ister.
 *
 * Nasıl: PIN argon2 ile saklanır (geri çevrilemez). Doğru girilince sunucu
 * imzalı, süreli bir bilet üretir; istemci bunu sekme belleğinde (sessionStorage)
 * tutar ve her istekte X-Butce-Pin başlığıyla gönderir. Sekme kapanınca bilet gider.
 *
 * Kaba kuvvet koruması: 5 yanlış denemede 15 dakika kilit.
 */
@Injectable()
export class ButcePinService {
  private static readonly BILET_DAKIKA = 60;
  private static readonly MAKS_DENEME = 5;
  private static readonly KILIT_DAKIKA = 15;

  constructor(private prisma: PrismaService) {}

  private get db(): any {
    return this.prisma as any;
  }

  private gizliAnahtar(): string {
    // Biletler JWT_SECRET'ten türetilir; ayrı bir sır yönetimi gerekmez.
    const s = process.env.JWT_SECRET || '';
    if (!s) throw new ForbiddenException('Sunucu yapılandırması eksik');
    return `${s}::butce-pin`;
  }

  /** userId + bitiş zamanı imzalı bilet: "<bitisMs>.<imza>" */
  private biletUret(userId: string): { bilet: string; bitis: number } {
    const bitis = Date.now() + ButcePinService.BILET_DAKIKA * 60 * 1000;
    const imza = crypto
      .createHmac('sha256', this.gizliAnahtar())
      .update(`${userId}.${bitis}`)
      .digest('hex');
    return { bilet: `${bitis}.${imza}`, bitis };
  }

  biletGecerliMi(userId: string, bilet?: string): boolean {
    if (!bilet) return false;
    const [bitisStr, imza] = String(bilet).split('.');
    const bitis = Number(bitisStr);
    if (!Number.isFinite(bitis) || !imza) return false;
    if (Date.now() > bitis) return false;
    const beklenen = crypto
      .createHmac('sha256', this.gizliAnahtar())
      .update(`${userId}.${bitis}`)
      .digest('hex');
    const a = Buffer.from(imza);
    const b = Buffer.from(beklenen);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /** PIN kurulu mu, kilitli mi? */
  async durum(k: Kimlik) {
    const ayar = await this.db.butceAyar.findFirst({
      where: { tenantId: k.tenantId, userId: k.userId },
      select: { pinHash: true, pinKilitBitis: true, pinDenemeSayisi: true },
    });
    const kilitli = !!ayar?.pinKilitBitis && new Date(ayar.pinKilitBitis) > new Date();
    return {
      kurulu: !!ayar?.pinHash,
      kilitli,
      kilitBitis: kilitli ? ayar!.pinKilitBitis : null,
      kalanDeneme: Math.max(ButcePinService.MAKS_DENEME - (ayar?.pinDenemeSayisi || 0), 0),
    };
  }

  private pinDogrula(pin: string) {
    if (!/^\d{6}$/.test(String(pin || ''))) {
      throw new BadRequestException('PIN 6 haneli rakam olmalı');
    }
    if (/^(\d)\1{5}$/.test(pin) || pin === '123456' || pin === '654321') {
      throw new BadRequestException('Çok kolay tahmin edilen bir PIN seçtiniz');
    }
  }

  /** İlk kurulum ya da değiştirme (değiştirmede eski PIN şart) */
  async kur(k: Kimlik, yeniPin: string, eskiPin?: string) {
    this.pinDogrula(yeniPin);
    let ayar = await this.db.butceAyar.findFirst({
      where: { tenantId: k.tenantId, userId: k.userId },
    });
    if (!ayar) {
      // İlk giriş: ayar kaydı henüz oluşmamış olabilir.
      ayar = await this.db.butceAyar.create({ data: { tenantId: k.tenantId, userId: k.userId } });
    }
    if (ayar.pinHash) {
      if (!eskiPin) throw new BadRequestException('Mevcut PIN gerekli');
      const uydu = await argon2.verify(ayar.pinHash, eskiPin).catch(() => false);
      if (!uydu) throw new ForbiddenException('Mevcut PIN yanlış');
    }
    const hash = await argon2.hash(yeniPin, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3 });
    await this.db.butceAyar.update({
      where: { id: ayar.id },
      data: { pinHash: hash, pinDenemeSayisi: 0, pinKilitBitis: null },
    });
    const { bilet, bitis } = this.biletUret(k.userId);
    return { ok: true, bilet, bitis };
  }

  /** PIN doğrula → bilet ver */
  async ac(k: Kimlik, pin: string) {
    const ayar = await this.db.butceAyar.findFirst({
      where: { tenantId: k.tenantId, userId: k.userId },
    });
    if (!ayar?.pinHash) throw new BadRequestException('Önce PIN belirleyin');

    if (ayar.pinKilitBitis && new Date(ayar.pinKilitBitis) > new Date()) {
      const kalanDk = Math.ceil((new Date(ayar.pinKilitBitis).getTime() - Date.now()) / 60000);
      throw new ForbiddenException(`Çok fazla yanlış deneme. ${kalanDk} dakika sonra tekrar deneyin.`);
    }

    const uydu = await argon2.verify(ayar.pinHash, String(pin || '')).catch(() => false);
    if (!uydu) {
      const deneme = (ayar.pinDenemeSayisi || 0) + 1;
      const kilit =
        deneme >= ButcePinService.MAKS_DENEME
          ? new Date(Date.now() + ButcePinService.KILIT_DAKIKA * 60 * 1000)
          : null;
      await this.db.butceAyar.update({
        where: { id: ayar.id },
        data: { pinDenemeSayisi: kilit ? 0 : deneme, pinKilitBitis: kilit },
      });
      throw new ForbiddenException(
        kilit
          ? `PIN ${ButcePinService.KILIT_DAKIKA} dakika kilitlendi.`
          : `PIN yanlış. Kalan deneme: ${ButcePinService.MAKS_DENEME - deneme}`,
      );
    }

    await this.db.butceAyar.update({
      where: { id: ayar.id },
      data: { pinDenemeSayisi: 0, pinKilitBitis: null },
    });
    const { bilet, bitis } = this.biletUret(k.userId);
    return { ok: true, bilet, bitis };
  }
}
