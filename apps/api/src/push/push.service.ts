/**
 * ANLIK BİLDİRİM (push) SERVİSİ — 2026-09-13
 *
 * Mobil uygulama (Expo) cihaz belirtecini kaydeder (kaydet/sil); portala düşen bildirimler
 * Expo'nun ücretsiz push servisiyle (exp.host) cihaza iletilir (gonder).
 *
 * MERKEZİ KANCA: PrismaService.onNotificationCreated — `notifications` tablosuna düşen HER kayıt
 * (NotificationsService.create, createForAllUsers, action-dispatcher create_pending_action, doğrudan
 * prisma.notification.create yapan yerler dahil) tek noktadan yakalanır; owner-notifier'ın WhatsApp
 * kanalıyla aynı kalıp. Kayıt oluştuktan SONRA çalışır, hata yutulur, ana akış beklemez.
 *
 * Kurallar:
 *  - PUSH_BILDIRIM=off → hiç gönderilmez.
 *  - Sessiz saat (22:00–08:00 İstanbul) → atlanır (kuyruk yok; sabah özeti zaten var). İstisna: acil (yeni cihaz girişi).
 *  - Aynı hedef+tip 10 sn içinde tekrar → atlanır (toplu cron patlamaları tek push olur; e-Tebligat muaf).
 *  - Expo "DeviceNotRegistered" (bilet ya da makbuz) → belirteç disabledAt ile kapatılır.
 */
import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  EXPO_MAKBUZ_URL,
  EXPO_PUSH_URL,
  ExpoBilet,
  ExpoMesaj,
  PushHedef,
  PushMesaj,
  expoBelirteciMi,
  expoMesajiKur,
  kisalt,
  oluBelirtecler,
  parcala,
  rotaSec,
  sessizSaatMi,
} from './expo-push';

export type PushKimlik = { tenantId: string; userId?: string | null; taxpayerId?: string | null };

export type PushTokenGirdi = {
  token: string;
  platform: 'ios' | 'android';
  persona?: 'adv' | 'tax';
  deviceName?: string | null;
};

export type PushSonuc = {
  gonderildi: number;
  hatali: number;
  /** Neden hiç gönderilmedi: kapali | sessiz-saat | hedef-yok | cihaz-yok | tekrar */
  atlandi?: string;
};

/** Push'a hiç gitmeyecek bildirim tipleri (owner-notifier ile aynı gerekçeler). */
const ATLANAN_TIPLER = new Set<string>([
  // Bot kendi biçimiyle zaten sahibin WhatsApp'ına iletiyor → cihazda ikinci kez çalmasın
  'WHATSAPP',
  // Sabit numaralara giden HGS borç özeti; sahibe ait bildirim değil
  'GALERI_HGS_OZET',
]);
/** Sessiz saatte de anında gider (güvenlik: yeni cihaz girişi) — owner-notifier NIGHT_INSTANT_TYPES ile aynı. */
const ACIL_TIPLER = new Set<string>(['AUTH_NEW_DEVICE']);
/** Tekrar süzgecinden muaf: her kayıt farklı mükellefin tebligatı. */
const TEKRAR_MUAF_TIPLER = new Set<string>(['E_TEBLIGAT']);
const MAKBUZ_GECIKME_MS = 15 * 60 * 1000;
/** Bu kadar süredir makbuzu gelmeyen bilet listeden düşer (sonsuza dek beklemesin) */
const MAKBUZ_ESKIME_MS = 2 * 60 * 60 * 1000;
const ISTEK_ZAMAN_ASIMI_MS = 10_000;

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  /** Tekrar süzgeci: "tenant::hedef::tip" → son gönderim zamanı (ms) */
  private readonly sonGonderim = new Map<string, number>();
  /** Makbuz kontrolü için bilet id → belirteç (bellek içi; yeniden başlatmada kaybolması zararsız) */
  private readonly bekleyenMakbuzlar = new Map<string, { token: string; zaman: number }>();
  /** Tek zamanlayıcı: kaç bilet birikirse biriksin makbuzlar toplu tek seferde sorulur */
  private makbuzZamanlayici: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    // Tek merkezi nokta: bildirim kaydı DB'ye yazıldıktan sonra tetiklenir (fire-and-forget).
    this.prisma.onNotificationCreated((n) => this.bildirimKancasi(n));
    this.logger.log(`PushService kuruldu — portala düşen bildirimler mobil cihazlara iletilecek (${this.acikMi() ? 'AÇIK' : 'KAPALI: PUSH_BILDIRIM=off'})`);
  }

  /** Env PUSH_BILDIRIM=off → kapalı. Her çağrıda okunur (Railway'de değiştir + yeniden başlat yeter). */
  acikMi(): boolean {
    return String(process.env.PUSH_BILDIRIM ?? '').trim().toLowerCase() !== 'off';
  }

  // ------------------------------------------------------------------
  // BELİRTEÇ KAYDI
  // ------------------------------------------------------------------

  /**
   * Cihaz belirtecini kaydeder (idempotent: aynı belirteç tekrar gelirse yalnız lastSeenAt tazelenir,
   * kapalıysa yeniden açılır). Aynı cihazda başka hesaba girilirse satır yeni sahibe geçer.
   * Persona kimlikten türetilir (mükellef belirteci 'adv' olarak kaydedilemez).
   */
  async kaydet(kimlik: PushKimlik, girdi: PushTokenGirdi) {
    if (!expoBelirteciMi(girdi.token)) throw new BadRequestException('Geçersiz Expo push belirteci');
    const platform = girdi.platform === 'ios' ? 'ios' : 'android';
    const persona = kimlik.taxpayerId ? 'tax' : 'adv';
    const deviceName = girdi.deviceName ? kisalt(girdi.deviceName, 100) : null;
    const simdi = this.simdi();
    const sahip = {
      tenantId: kimlik.tenantId,
      userId: kimlik.taxpayerId ? null : kimlik.userId ?? null,
      taxpayerId: kimlik.taxpayerId ?? null,
    };
    const kayit = await this.prisma.pushToken.upsert({
      where: { token: girdi.token },
      create: { ...sahip, token: girdi.token, platform, persona, deviceName, lastSeenAt: simdi },
      update: { ...sahip, platform, persona, deviceName, lastSeenAt: simdi, disabledAt: null },
      select: { id: true, token: true, persona: true, platform: true },
    });
    return { ok: true, id: kayit.id, persona: kayit.persona, platform: kayit.platform };
  }

  /** Çıkışta belirteci siler — yalnız kendi (tenant + sahip) kaydını silebilir. */
  async sil(kimlik: PushKimlik, token: string) {
    if (!token) return { ok: true, silinen: 0 };
    const sahip = kimlik.taxpayerId ? { taxpayerId: kimlik.taxpayerId } : { userId: kimlik.userId ?? '' };
    const res = await this.prisma.pushToken.deleteMany({ where: { token, tenantId: kimlik.tenantId, ...sahip } });
    return { ok: true, silinen: res.count };
  }

  // ------------------------------------------------------------------
  // GÖNDERİM
  // ------------------------------------------------------------------

  /**
   * Hedefin (kullanıcı / mükellef / tenant geneli) tüm açık cihazlarına push yollar.
   * 100'lük parçalar, DeviceNotRegistered → disabledAt. Hata fırlatmaz; sonuç özeti döner.
   */
  async gonder(hedef: PushHedef, mesaj: PushMesaj): Promise<PushSonuc> {
    if (!this.acikMi()) return { gonderildi: 0, hatali: 0, atlandi: 'kapali' };
    if (!mesaj.acil && sessizSaatMi(this.simdi())) return { gonderildi: 0, hatali: 0, atlandi: 'sessiz-saat' };
    const kosul = this.hedefKosulu(hedef);
    if (!kosul) return { gonderildi: 0, hatali: 0, atlandi: 'hedef-yok' };

    const cihazlar = await this.prisma.pushToken.findMany({ where: kosul, select: { token: true } });
    if (!cihazlar.length) return { gonderildi: 0, hatali: 0, atlandi: 'cihaz-yok' };

    const mesajlar = cihazlar.map((c) => expoMesajiKur(c.token, mesaj));
    let gonderildi = 0;
    let hatali = 0;
    for (const parca of parcala(mesajlar)) {
      try {
        const biletler = await this.expoyaYolla(parca);
        const olu = oluBelirtecler(biletler, parca);
        if (olu.length) await this.kapat(olu);
        biletler.forEach((b, i) => {
          if (b?.status === 'ok') {
            gonderildi += 1;
            if (b.id) this.makbuzBekle(b.id, parca[i]?.to);
          } else {
            hatali += 1;
          }
        });
      } catch (err: any) {
        hatali += parca.length;
        this.logger.warn(`Push gönderimi başarısız (${parca.length} cihaz): ${err?.message || err}`);
      }
    }
    return { gonderildi, hatali };
  }

  /**
   * MERKEZİ KANCA (Prisma ara katmanından gelir). Asla fırlatmaz; gönderim arka planda.
   * userId dolu → o kullanıcının cihazları; userId=null (tenant geneli) → ofisin tüm müşavir cihazları.
   */
  bildirimKancasi(n: any): void {
    try {
      if (!n || !n.tenantId || !n.title) return;
      if (!this.acikMi()) return;
      const tip = String(n.type ?? '');
      if (ATLANAN_TIPLER.has(tip) || this.envAtlananTipler().includes(tip)) return;
      // Görev hatırlatması (2026-09-14): görevin kanal anahtarı telefon push'unu kapattıysa gönderme (metadata.kanallar.push=false).
      if (n.metadata && typeof n.metadata === 'object' && n.metadata.kanallar && n.metadata.kanallar.push === false) return;
      if (this.tekrarMi(n)) return;

      const hedef: PushHedef = n.userId ? { userId: n.userId } : { tenantId: n.tenantId };
      const mesaj: PushMesaj = {
        title: kisalt(n.title, 100),
        body: kisalt(n.body, 160),
        data: { route: rotaSec(n), bildirimId: n.id ?? null, tip },
        acil: ACIL_TIPLER.has(tip),
      };
      this.gonder(hedef, mesaj)
        .then((s) => {
          if (s.gonderildi || s.hatali) this.logger.log(`Push: ${tip} → ${s.gonderildi} cihaz${s.hatali ? `, ${s.hatali} hata` : ''}`);
        })
        .catch((err: any) => this.logger.warn(`Push kancası hata: ${err?.message || err}`));
    } catch (err: any) {
      this.logger.warn(`Push kancası hata: ${err?.message || err}`);
    }
  }

  /**
   * Makbuz kontrolü (~15 dk sonra): Expo bilet 'ok' dese de cihaz silinmiş olabilir; kesin
   * "DeviceNotRegistered" makbuzda gelir. Bellek içi liste; hata yutulur.
   */
  async makbuzKontrol(biletIdleri?: string[]): Promise<number> {
    const idler = biletIdleri ?? Array.from(this.bekleyenMakbuzlar.keys());
    if (!idler.length) return 0;
    let kapatilan = 0;
    try {
      for (const parca of parcala(idler, 300)) {
        const yanit = await this.istek(EXPO_MAKBUZ_URL, { ids: parca });
        const makbuzlar: Record<string, ExpoBilet> = yanit?.data && typeof yanit.data === 'object' ? yanit.data : {};
        const olu: string[] = [];
        const su = this.simdi().getTime();
        for (const id of parca) {
          const m = makbuzlar[id];
          const bekleyen = this.bekleyenMakbuzlar.get(id);
          if (m && m.status === 'error' && m.details?.error === 'DeviceNotRegistered' && bekleyen) olu.push(bekleyen.token);
          // makbuz geldi (ok ya da hata) ya da çok eskidi → listeden düş
          if (m || (bekleyen && su - bekleyen.zaman > MAKBUZ_ESKIME_MS)) this.bekleyenMakbuzlar.delete(id);
        }
        if (olu.length) {
          await this.kapat(olu);
          kapatilan += olu.length;
        }
      }
    } catch (err: any) {
      this.logger.warn(`Push makbuz kontrolü başarısız: ${err?.message || err}`);
    }
    return kapatilan;
  }

  // ------------------------------------------------------------------
  // İÇ YARDIMCILAR
  // ------------------------------------------------------------------

  /** Test için üzerine yazılabilir saat kaynağı. */
  protected simdi(): Date {
    return new Date();
  }

  private envAtlananTipler(): string[] {
    return String(process.env.PUSH_ATLA_TIPLER ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  }

  private hedefKosulu(hedef: PushHedef): Record<string, unknown> | null {
    const kosul: Record<string, unknown> = { disabledAt: null };
    if (hedef.userId) kosul.userId = hedef.userId;
    else if (hedef.taxpayerId) kosul.taxpayerId = hedef.taxpayerId;
    else if (hedef.tenantId) {
      kosul.tenantId = hedef.tenantId;
      kosul.persona = 'adv';
    } else return null;
    return kosul;
  }

  /** Aynı tenant + hedef + tip son N sn içinde gittiyse atla (PUSH_TEKRAR_SN, varsayılan 10). */
  private tekrarMi(n: any): boolean {
    const tip = String(n.type ?? '');
    if (TEKRAR_MUAF_TIPLER.has(tip)) return false;
    const pencereMs = Math.max(0, Number(process.env.PUSH_TEKRAR_SN ?? 10)) * 1000;
    if (!pencereMs) return false;
    const anahtar = `${n.tenantId}::${n.userId || '*'}::${tip}`;
    const su = this.simdi().getTime();
    const son = this.sonGonderim.get(anahtar) ?? 0;
    if (su - son < pencereMs) return true;
    this.sonGonderim.set(anahtar, su);
    if (this.sonGonderim.size > 2000) this.sonGonderim.clear(); // sınırsız büyümesin
    return false;
  }

  private async kapat(tokenlar: string[]): Promise<void> {
    if (!tokenlar.length) return;
    await this.prisma.pushToken
      .updateMany({ where: { token: { in: tokenlar } }, data: { disabledAt: this.simdi() } })
      .catch((err: any) => this.logger.warn(`Ölü belirteç kapatılamadı: ${err?.message || err}`));
    this.logger.log(`Push: ${tokenlar.length} ölü belirteç kapatıldı (DeviceNotRegistered)`);
  }

  private makbuzBekle(biletId: string, token?: string): void {
    if (!token) return;
    this.bekleyenMakbuzlar.set(biletId, { token, zaman: this.simdi().getTime() });
    if (this.bekleyenMakbuzlar.size > 5000) this.bekleyenMakbuzlar.clear();
    this.makbuzPlanla();
  }

  /** ~15 dk sonra tek toplu makbuz sorgusu; zaten planlıysa dokunmaz, kalan olursa bir tur daha planlar. */
  private makbuzPlanla(): void {
    if (this.makbuzZamanlayici || !this.bekleyenMakbuzlar.size) return;
    this.makbuzZamanlayici = setTimeout(() => {
      this.makbuzZamanlayici = null;
      this.makbuzKontrol()
        .catch(() => undefined)
        .finally(() => this.makbuzPlanla());
    }, MAKBUZ_GECIKME_MS);
    // Süreç kapanışını bekletmesin (test/derleme dahil)
    if (typeof (this.makbuzZamanlayici as any)?.unref === 'function') (this.makbuzZamanlayici as any).unref();
  }

  /** Bir parçayı (≤100) Expo'ya yollar; bilet dizisi döner. */
  private async expoyaYolla(parca: ExpoMesaj[]): Promise<ExpoBilet[]> {
    const yanit = await this.istek(EXPO_PUSH_URL, parca);
    if (Array.isArray(yanit?.errors) && yanit.errors.length) {
      throw new Error(`Expo push hatası: ${yanit.errors.map((e: any) => e?.message || e?.code).join('; ')}`);
    }
    return Array.isArray(yanit?.data) ? yanit.data : [];
  }

  /** exp.host'a JSON POST (global fetch; testte sahte). EXPO_ACCESS_TOKEN varsa yetki başlığı eklenir. */
  private async istek(url: string, govde: unknown): Promise<any> {
    const basliklar: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    };
    const erisim = String(process.env.EXPO_ACCESS_TOKEN ?? '').trim();
    if (erisim) basliklar.Authorization = `Bearer ${erisim}`;
    const kesici = new AbortController();
    const zamanlayici = setTimeout(() => kesici.abort(), ISTEK_ZAMAN_ASIMI_MS);
    try {
      const res = await fetch(url, { method: 'POST', headers: basliklar, body: JSON.stringify(govde), signal: kesici.signal });
      const metin = await res.text();
      let json: any = null;
      try {
        json = metin ? JSON.parse(metin) : null;
      } catch {
        json = null;
      }
      if (!res.ok) throw new Error(`Expo ${res.status}: ${kisalt(json?.errors?.[0]?.message || metin, 200)}`);
      return json;
    } finally {
      clearTimeout(zamanlayici);
    }
  }
}
