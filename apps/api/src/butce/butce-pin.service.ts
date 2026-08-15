import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
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
 * Kaba kuvvet koruması: 5 yanlış denemede 15 dakika kilit. Sayaç hem "aç" hem de
 * "kur" (PIN değiştirme) ucunda işler; yoksa 5 deneme sınırı kur() üzerinden aşılır.
 *
 * Bilet biçimi: "<bitisMs>.<pinSurum>.<imza>" — üç parça.
 *   pinSurum o anki PIN özetinden türer. PIN değişince sürüm de değişir, eski
 *   biletler kendiliğinden ölür (biletleri ayrıca saklamak gerekmez).
 *   İki parçalı ESKİ biçim artık geçersizdir; kullanıcı bir kez PIN girer.
 */
@Injectable()
export class ButcePinService {
  private static readonly BILET_DAKIKA = 60;
  private static readonly MAKS_DENEME = 5;
  private static readonly KILIT_DAKIKA = 15;
  /** Bilet parça sayısı: bitis + pinSurum + imza */
  private static readonly BILET_PARCA = 3;
  /** Bilete yazılan sürümün uzunluğu (hex hane) */
  private static readonly SURUM_UZUNLUK = 16;

  private readonly logger = new Logger(ButcePinService.name);

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

  /* ===================== SAF BİLET MANTIĞI ===================== */

  /**
   * PIN sürümü: PIN özetinin sha256'sının ilk 16 hex hanesi.
   *
   * DİKKAT: sürüm özetin TAMAMINDAN türetilir, baştan kesilmiş bir parçasından
   * değil. argon2 özetleri "$argon2id$v=19$m=65536,t=3,p=4$..." diye başlar;
   * baştaki onlarca karakter her PIN'de AYNIDIR. Baş taraf kullanılsaydı sürüm
   * hiç değişmez, "PIN değişince eski bilet düşsün" kuralı sessizce çalışmazdı.
   */
  static pinSurumu(pinHash?: string | null): string {
    return crypto
      .createHash('sha256')
      .update(String(pinHash || ''))
      .digest('hex')
      .slice(0, ButcePinService.SURUM_UZUNLUK);
  }

  private static imzala(userId: string, bitis: number, pinSurum: string, gizli: string): string {
    return crypto
      .createHmac('sha256', gizli)
      .update(`${userId}.${bitis}.${pinSurum}`)
      .digest('hex');
  }

  /** userId + bitiş + PIN sürümü imzalı bilet: "<bitisMs>.<pinSurum>.<imza>" */
  static biletOlustur(
    userId: string,
    pinHash: string,
    gizli: string,
    simdi: number = Date.now(),
  ): { bilet: string; bitis: number } {
    const bitis = simdi + ButcePinService.BILET_DAKIKA * 60 * 1000;
    const pinSurum = ButcePinService.pinSurumu(pinHash);
    const imza = ButcePinService.imzala(userId, bitis, pinSurum, gizli);
    return { bilet: `${bitis}.${pinSurum}.${imza}`, bitis };
  }

  /** Bilet: biçim + süre + PIN sürümü + imza. Dördü de tutmazsa geçersiz. */
  static biletDogrula(
    userId: string,
    pinHash: string | null | undefined,
    bilet: string | null | undefined,
    gizli: string,
    simdi: number = Date.now(),
  ): boolean {
    if (!userId || !pinHash || !bilet) return false;
    const parcalar = String(bilet).split('.');
    // Eski iki parçalı biletlerde PIN sürümü yok → güvenilemez, reddedilir.
    if (parcalar.length !== ButcePinService.BILET_PARCA) return false;
    const [bitisStr, pinSurum, imza] = parcalar;
    const bitis = Number(bitisStr);
    if (!Number.isFinite(bitis) || !pinSurum || !imza) return false;
    if (simdi > bitis) return false;
    // PIN değiştiyse (ya da silindiyse) sürüm tutmaz → eldeki bilet ölü.
    if (pinSurum !== ButcePinService.pinSurumu(pinHash)) return false;
    const beklenen = ButcePinService.imzala(userId, bitis, pinSurum, gizli);
    const a = Buffer.from(imza);
    const b = Buffer.from(beklenen);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /**
   * Ayar kaydını tarayıcıya göndermeden önce PIN alanlarını ayıklar.
   *
   * argon2 özeti dışarı SIZMAMALI: eline geçen çevrimdışı deneme yapabilir.
   * Deneme sayacı ile kilit bitişi de kaba kuvvet için ipucudur; onlar da gider
   * (kullanıcı bu bilgiyi zaten pin/durum ucundan görüyor).
   */
  static pinAlanlariniAyikla<T>(ayar: T): T {
    if (!ayar || typeof ayar !== 'object') return ayar;
    const kopya: any = { ...(ayar as any) };
    delete kopya.pinHash;
    delete kopya.pinDenemeSayisi;
    delete kopya.pinKilitBitis;
    return kopya as T;
  }

  /* ===================== UÇLAR ===================== */

  /** Bilet geçerli mi? Sürüm, o anki PIN özetinden yeniden hesaplanır. */
  async biletGecerliMi(k: Kimlik, bilet?: string): Promise<boolean> {
    if (!k?.tenantId || !k?.userId || !bilet) return false;
    const ayar = await this.db.butceAyar.findFirst({
      where: { tenantId: k.tenantId, userId: k.userId },
      select: { pinHash: true },
    });
    if (!ayar?.pinHash) return false;
    return ButcePinService.biletDogrula(k.userId, ayar.pinHash, bilet, this.gizliAnahtar());
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

  /** Kilit açıkken hiçbir PIN işlemine izin yok (hem aç hem kur). */
  private kilitKontrol(ayar: any) {
    if (ayar?.pinKilitBitis && new Date(ayar.pinKilitBitis) > new Date()) {
      const kalanDk = Math.ceil((new Date(ayar.pinKilitBitis).getTime() - Date.now()) / 60000);
      throw new ForbiddenException(`Çok fazla yanlış deneme. ${kalanDk} dakika sonra tekrar deneyin.`);
    }
  }

  /**
   * Yanlış PIN: sayacı ilerlet, sınıra gelindiyse kilitle, kayda geç, hata fırlat.
   * Her durumda fırlatır (dönüş tipi never).
   */
  private async basarisizDeneme(ayar: any, uc: 'ac' | 'kur'): Promise<never> {
    const deneme = (ayar.pinDenemeSayisi || 0) + 1;
    const kilit =
      deneme >= ButcePinService.MAKS_DENEME
        ? new Date(Date.now() + ButcePinService.KILIT_DAKIKA * 60 * 1000)
        : null;
    await this.db.butceAyar.update({
      where: { id: ayar.id },
      data: { pinDenemeSayisi: kilit ? 0 : deneme, pinKilitBitis: kilit },
    });
    // Girilen PIN ASLA loglanmaz; yalnız sayaç, uç ve kullanıcı kimliği yazılır.
    this.logger.warn(
      `[ButcePin] hatalı deneme ${deneme}/${ButcePinService.MAKS_DENEME}` +
        ` (uç: ${uc}, kullanıcı: ${ayar.userId})` +
        (kilit ? ` — ${ButcePinService.KILIT_DAKIKA} dakika kilitlendi` : ''),
    );
    throw new ForbiddenException(
      kilit
        ? `PIN ${ButcePinService.KILIT_DAKIKA} dakika kilitlendi.`
        : `PIN yanlış. Kalan deneme: ${ButcePinService.MAKS_DENEME - deneme}`,
    );
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
    // Kilit ve sayaç burada da işler: yoksa 5 deneme sınırı bu uçtan aşılır.
    this.kilitKontrol(ayar);
    if (ayar.pinHash) {
      if (!eskiPin) throw new BadRequestException('Mevcut PIN gerekli');
      const uydu = await argon2.verify(ayar.pinHash, String(eskiPin)).catch(() => false);
      if (!uydu) await this.basarisizDeneme(ayar, 'kur');
    }
    const hash = await argon2.hash(yeniPin, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3 });
    await this.db.butceAyar.update({
      where: { id: ayar.id },
      data: { pinHash: hash, pinDenemeSayisi: 0, pinKilitBitis: null },
    });
    // Yeni özet → yeni sürüm → o ana kadarki bütün biletler geçersiz.
    const { bilet, bitis } = ButcePinService.biletOlustur(k.userId, hash, this.gizliAnahtar());
    return { ok: true, bilet, bitis, pinSurum: ButcePinService.pinSurumu(hash) };
  }

  /** PIN doğrula → bilet ver */
  async ac(k: Kimlik, pin: string) {
    const ayar = await this.db.butceAyar.findFirst({
      where: { tenantId: k.tenantId, userId: k.userId },
    });
    if (!ayar?.pinHash) throw new BadRequestException('Önce PIN belirleyin');

    this.kilitKontrol(ayar);

    const uydu = await argon2.verify(ayar.pinHash, String(pin || '')).catch(() => false);
    if (!uydu) await this.basarisizDeneme(ayar, 'ac');

    await this.db.butceAyar.update({
      where: { id: ayar.id },
      data: { pinDenemeSayisi: 0, pinKilitBitis: null },
    });
    const { bilet, bitis } = ButcePinService.biletOlustur(k.userId, ayar.pinHash, this.gizliAnahtar());
    return { ok: true, bilet, bitis, pinSurum: ButcePinService.pinSurumu(ayar.pinHash) };
  }

  /**
   * "Kilitle": modülü elle kapatma. Deneme sayacı sıfırlanır, o anki PIN sürümü
   * döner; istemci biletini siler ve bir sonraki istekte PIN yeniden sorulur.
   *
   * NOT: PIN değişmediği için sürüm de değişmez — kopyalanmış bir bileti sunucu
   * süresi dolana dek kabul etmeye devam eder. Gerçek sunucu tarafı iptal için
   * ButceAyar'da "biletSurum / iptalZamani" gibi bir alan gerekir; şema
   * değişikliği istenmediğinden eklenmedi.
   */
  async kilitle(k: Kimlik) {
    const ayar = await this.db.butceAyar.findFirst({
      where: { tenantId: k.tenantId, userId: k.userId },
      select: { id: true, pinHash: true },
    });
    if (ayar) {
      await this.db.butceAyar.update({
        where: { id: ayar.id },
        data: { pinDenemeSayisi: 0 },
      });
    }
    return { ok: true, kilitlendi: true, pinSurum: ButcePinService.pinSurumu(ayar?.pinHash) };
  }
}
