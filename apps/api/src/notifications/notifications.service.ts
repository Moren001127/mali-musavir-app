import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CRITICAL_TYPES,
  DEFAULT_LINK_BY_TYPE,
  NOTIFICATION_TYPES,
  NotificationType,
} from './notification-types';
import { bildirimPolitikasi } from './notification-policy';

export type CreateNotificationInput = {
  tenantId: string;
  userId?: string | null;
  title: string;
  body: string;
  type: NotificationType | string;
  metadata?: Record<string, any>;
  /** Eger true ise duplicate kontrolu yapilir (dedupeKey + dedupeWindowMin) */
  dedupeKey?: string;
  /** Dedupe penceresi (varsayilan 60 dk) */
  dedupeWindowMin?: number;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * OKUNMAMIŞLIK ÖLÇÜTÜ — 2026-09-25 (denetim bulgusu 32b).
   *
   * `isRead` artık "HERKES İÇİN KAPANDI" demek: sistemin kendiliğinden kapatması
   * (şifre düzeldi, iş kalemi bitti) ve kişiye özel bildirimler onu kullanır.
   * `notification_reads` ise "şu kişi okudu" demek. Bir bildirim X kişisi için
   * okunmamıştır: `isRead = false` VE o tabloda X için satır YOK.
   *
   * Eskiden tek alan vardı; ofis geneline (userId = null) giden bir bildirimi
   * personelden biri açınca HERKES için okundu oluyor, diğerleri onu hiç görmüyordu.
   */
  private okunmamisKosulu(tenantId: string, userId: string) {
    return {
      tenantId,
      isRead: false,
      OR: [{ userId }, { userId: null }],
      reads: { none: { userId } },
    };
  }

  /** Son bildirimler; limit 1..200 aralığına kırpılır (varsayılan 50). */
  async findAll(tenantId: string, userId: string, limit = 50) {
    const take = Math.min(Math.max(Math.floor(Number(limit) || 50), 1), 200);
    const satirlar = await this.prisma.notification.findMany({
      where: {
        tenantId,
        OR: [{ userId }, { userId: null }],
      },
      orderBy: { createdAt: 'desc' },
      take,
      // Bu kullanıcının okuma satırı var mı — yalnız onun satırı çekilir.
      include: { reads: { where: { userId }, select: { readAt: true }, take: 1 } },
    });

    // `isRead` KİŞİYE GÖRE hesaplanıp döner; ekranlar bu alanı okuduğu için
    // sözleşme aynı kalır, arayüzde tek satır değişiklik gerekmez.
    return satirlar.map((n: any) => {
      const kisiOkumasi = n.reads?.[0] || null;
      const { reads, ...kalan } = n;
      return {
        ...kalan,
        isRead: n.isRead || !!kisiOkumasi,
        readAt: n.readAt || kisiOkumasi?.readAt || null,
      };
    });
  }

  async getUnreadCount(tenantId: string, userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: this.okunmamisKosulu(tenantId, userId),
    });
  }

  /**
   * Okunmamış bildirim özeti: toplam + yalnız KRİTİK tipler.
   * Pano "Kritik Uyarı" kartı critical'ı kullanır; rutin bildirimler
   * bu karta karışmaz (kullanıcı şikayeti: her şey kritik görünüyordu).
   */
  async getUnreadSummary(tenantId: string, userId: string): Promise<{ total: number; critical: number }> {
    const baseWhere = () => this.okunmamisKosulu(tenantId, userId);
    const [total, critical] = await Promise.all([
      this.prisma.notification.count({ where: baseWhere() }),
      this.prisma.notification.count({
        where: { ...baseWhere(), type: { in: Array.from(CRITICAL_TYPES) } },
      }),
    ]);
    return { total, critical };
  }

  async markRead(id: string, tenantId: string, userId: string) {
    // IDOR koruması: yalnız kendi tenant'ındaki + kendine/tenant geneline ait
    // bildirimi okundu işaretle. (Eskiden where:{id} idi → başka tenant'ın
    // bildirimi işaretlenebiliyordu.)
    const bildirim = await this.prisma.notification.findFirst({
      where: { id, tenantId, OR: [{ userId }, { userId: null }] },
      select: { id: true, userId: true },
    });
    if (!bildirim) return { updated: 0 };

    // 2026-09-25 (32b): OFİS GENELİ bildirimde yalnız KİŞİ BAZLI okuma satırı yazılır;
    //   `isRead`e dokunulmaz — yoksa diğer personel bildirimi hiç görmez.
    //   Kişiye özel bildirimde eski davranış sürer (`isRead`), ayrıca okuma satırı da
    //   yazılır ki sayaç ile liste tek ölçütten beslenmeye devam etsin.
    await this.kisiOkumasiYaz(bildirim.id, userId);
    if (bildirim.userId) {
      await this.prisma.notification.update({
        where: { id: bildirim.id },
        data: { isRead: true, readAt: new Date() },
      });
    }
    return { updated: 1 };
  }

  /** Kişi bazlı okuma satırı — aynı kişi iki kez okursa çakışma yaratmaz. */
  private async kisiOkumasiYaz(notificationId: string, userId: string) {
    await (this.prisma as any).notificationRead.upsert({
      where: { notificationId_userId: { notificationId, userId } },
      create: { notificationId, userId },
      update: {},
    }).catch(() => null);
  }

  /**
   * Kullanıcının okunmamış bildirimlerini (kendi + ofis geneli) okundu işaretler.
   *
   * 2026-09-25 (32b): ofis geneli olanlara `isRead` YAZILMAZ — yalnız bu kişi için
   * okuma satırı açılır; diğer personel bildirimi görmeye devam eder. Kişiye özel
   * olanlarda eski davranış (`isRead`) sürer.
   */
  async markAllRead(tenantId: string, userId: string) {
    const okunmamislar = await this.prisma.notification.findMany({
      where: this.okunmamisKosulu(tenantId, userId),
      select: { id: true, userId: true },
    });
    if (!okunmamislar.length) return { count: 0 };

    const kendi = okunmamislar.filter((n) => !!n.userId).map((n) => n.id);
    if (kendi.length) {
      await this.prisma.notification.updateMany({
        where: { id: { in: kendi }, tenantId },
        data: { isRead: true, readAt: new Date() },
      });
    }

    await (this.prisma as any).notificationRead.createMany({
      data: okunmamislar.map((n) => ({ notificationId: n.id, userId })),
      skipDuplicates: true,
    }).catch(() => null);

    return { count: okunmamislar.length };
  }

  /**
   * Durum düzelince (şifre güncellendi vb.) o konunun AÇIK bildirimlerini
   * kendiliğinden kapatır: kiracıdaki okunmamış + metadata.dedupeKey değeri
   * `prefix` ile BAŞLAYAN bildirimleri okundu işaretler. Kapatılan sayıyı döner;
   * hata olursa 0 (bildirim kapatma hiçbir ana akışı durdurmamalı).
   */
  async resolveByDedupePrefix(tenantId: string, prefix: string): Promise<number> {
    if (!tenantId || !prefix) return 0;
    try {
      const res = await this.prisma.notification.updateMany({
        where: {
          tenantId,
          isRead: false,
          metadata: { path: ['dedupeKey'], string_starts_with: prefix },
        },
        data: { isRead: true, readAt: new Date() },
      });
      return res.count;
    } catch (e) {
      this.logger.warn(`resolveByDedupePrefix hata (prefix=${prefix}): ${(e as Error).message}`);
      return 0;
    }
  }

  /**
   * resolveByDedupePrefix'in metadata alanına göre çalışan hali: belirtilen tipte,
   * okunmamış ve `metadata[path] === equals` olan bildirimleri okundu işaretler.
   * dedupeKey taşımayan eski kayıtlar için (örn. kind === 'stale-pending').
   */
  async resolveByMetadata(tenantId: string, type: string, path: string[], equals: string): Promise<number> {
    if (!tenantId || !type || !path?.length) return 0;
    try {
      const res = await this.prisma.notification.updateMany({
        where: {
          tenantId,
          type,
          isRead: false,
          metadata: { path, equals },
        },
        data: { isRead: true, readAt: new Date() },
      });
      return res.count;
    } catch (e) {
      this.logger.warn(`resolveByMetadata hata (type=${type}, ${path.join('.')}=${equals}): ${(e as Error).message}`);
      return 0;
    }
  }

  /**
   * Tek bir bildirim olusturur. dedupeKey verilirse ayni tenant'ta son
   * dedupeWindowMin (varsayilan 60) dakika icinde ayni anahtarla acilan
   * bildirim (okunmus ya da okunmamis) varsa tekrar olusturmaz (no-op).
   * Eger userId verilirse + o user bu type'i mute etmisse -> no-op.
   * Once merkezi politika (notification-policy.ts) calisir; "atla" derse hic yazilmaz.
   */
  async create(data: CreateNotificationInput) {
    // Merkezi politika: kopya / bilgi-kirliligi bildirimleri tek yerden elenir.
    const karar = bildirimPolitikasi(data);
    if (karar.atla) {
      this.logger.debug(`Bildirim politika ile atlandi (${data.type}): ${karar.neden || ''}`);
      return { id: 'policy-skipped', skipped: true, neden: karar.neden } as any;
    }

    const metadata = this.enrichMetadata(data);

    // Preference check (sadece userId verildiyse - tenant geneli atlanir)
    if (data.userId) {
      const muted = await this.isTypeMuted(data.userId, String(data.type));
      if (muted) {
        return { id: 'muted', skipped: true } as any;
      }
    }

    if (data.dedupeKey) {
      const windowMin = data.dedupeWindowMin ?? 60;
      const since = new Date(Date.now() - windowMin * 60 * 1000);
      // 2026-09-14: Burada `isRead: false` sarti vardi → kullanici bildirimi okur okumaz
      //   ayni olay pencere icinde YENIDEN bildirim uretiyordu. "Portal sifre hatasi" x90/ay
      //   ve "Luca isi bekliyor" x1.577 gurultusunun koku buydu. Artik pencere icinde
      //   ayni dedupeKey ile acilmis bildirim (okunmus ya da okunmamis) varsa uretilmez.
      const existing = await this.prisma.notification.findFirst({
        where: {
          tenantId: data.tenantId,
          createdAt: { gte: since },
          metadata: { path: ['dedupeKey'], equals: data.dedupeKey },
        },
        select: { id: true },
      }).catch(() => null);
      if (existing) {
        return existing;
      }
    }

    return this.prisma.notification.create({
      data: {
        tenantId: data.tenantId,
        userId: data.userId ?? null,
        title: this.truncate(data.title, 200),
        body: this.truncate(data.body, 1000),
        type: data.type,
        metadata,
      },
    });
  }

  /**
   * Tenant'in tum aktif kullanicilarina ayri ayri bildirim olusturur.
   */
  async createForAllUsers(input: Omit<CreateNotificationInput, 'userId'>) {
    const users = await this.prisma.user.findMany({
      where: { tenantId: input.tenantId, isActive: true },
      select: { id: true },
    });
    if (!users.length) {
      return [await this.create({ ...input, userId: null })];
    }
    const results = await Promise.all(
      users.map((u) =>
        this.create({ ...input, userId: u.id }).catch((e) => {
          this.logger.warn(
            `createForAllUsers failed user=${u.id}: ${(e as Error).message}`,
          );
          return null;
        }),
      ),
    );
    return results.filter(Boolean);
  }

  /** Belirli bir role sahip kullanicilara bildirim. */
  async createForRole(
    input: Omit<CreateNotificationInput, 'userId'>,
    roleNames: string | string[],
  ) {
    const roles = Array.isArray(roleNames) ? roleNames : [roleNames];
    const users = await this.prisma.user.findMany({
      where: {
        tenantId: input.tenantId,
        isActive: true,
        userRoles: { some: { role: { name: { in: roles } } } },
      },
      select: { id: true },
    });
    if (!users.length) return [];
    const results = await Promise.all(
      users.map((u) => this.create({ ...input, userId: u.id }).catch(() => null)),
    );
    return results.filter(Boolean);
  }

  /** Sadece tenant geneli (userId=null) */
  async createForTenant(input: Omit<CreateNotificationInput, 'userId'>) {
    return this.create({ ...input, userId: null });
  }

  /** Kullanicinin bildirim tercihlerini getir */
  async getPreferences(userId: string): Promise<{ mutedTypes: string[] }> {
    const pref = await (this.prisma as any).notificationPreference.findUnique({
      where: { userId },
      select: { mutedTypes: true },
    }).catch(() => null);
    return { mutedTypes: pref?.mutedTypes || [] };
  }

  /** Kullanicinin bildirim tercihlerini guncelle (upsert) */
  async setPreferences(tenantId: string, userId: string, mutedTypes: string[]) {
    const sanitized = Array.from(new Set(mutedTypes.filter((t) => typeof t === 'string' && t.length))).slice(0, 50);
    return (this.prisma as any).notificationPreference.upsert({
      where: { userId },
      create: { tenantId, userId, mutedTypes: sanitized },
      update: { mutedTypes: sanitized },
    });
  }

  private async isTypeMuted(userId: string, type: string): Promise<boolean> {
    try {
      const pref = await (this.prisma as any).notificationPreference.findUnique({
        where: { userId },
        select: { mutedTypes: true },
      });
      if (!pref?.mutedTypes || !Array.isArray(pref.mutedTypes)) return false;
      return pref.mutedTypes.includes(type);
    } catch {
      return false;
    }
  }

  private enrichMetadata(data: CreateNotificationInput): Record<string, any> {
    const base = data.metadata ? { ...data.metadata } : {};
    if (typeof data.type === 'string' && !base.link) {
      const defaultLink = (DEFAULT_LINK_BY_TYPE as any)[data.type];
      if (defaultLink) base.link = defaultLink;
    }
    if (data.dedupeKey) base.dedupeKey = data.dedupeKey;
    return base;
  }

  private truncate(value: string, max: number): string {
    const s = String(value ?? '');
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + '…';
  }

  static readonly TYPES = NOTIFICATION_TYPES;
}
