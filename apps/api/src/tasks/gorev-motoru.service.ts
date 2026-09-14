import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notification-types';
import { EmailService } from '../email/email.service';
import { uretilecekGunler, istanbulGunu, gunAnahtari, tekrarMetni } from './gorev-tekrar';
import { hatirlatmaOlaylari, gonderilecekOlay, HatirlatmaGorevi, HatirlatmaOlayi } from './gorev-hatirlatma-kurali';
import { hatirlatmaMesaji, ornekKalemler, HatirlatmaKalemi } from './gorev-hatirlatma-metni';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { normalizeTelefon as telefonNormalize } from '../users/users.service';

/**
 * GÖREV MOTORU (2026-09-14, Görevler & Notlar Faz 2) — iki iş:
 *
 * 1) TEKRAR ÜRETİMİ (her gece 00:15 + açılıştan 3 dk sonra): `isTemplate` şablonlarından 14 gün ileriye kadar
 *    oluşum görevleri açar (`parentTaskId` = şablon, `nextOccurrence` güncellenir). Geçmiş oluşumlar GERİYE DÖNÜK
 *    üretilmez (ilk çalıştırmada 11 eski şablon bugünden itibaren işler). Şablon listede görünmez (tur/isTemplate).
 *
 * 2) HATIRLATMA (her 10 dk, 09:00–21:00 İstanbul): `gorev-hatirlatma-kurali` ile zamanı gelen olay (yaklaşıyor / bugün /
 *    gecikti) → görev başına portal bildirimi (TASK_DUE; sahip + görevde seçilen ofis personeli — push kancası cihazlara
 *    iletir) + ALICI BAŞINA TEK WhatsApp mesajı (şablon `gorev-hatirlatma-metni`; sahibin numaraları + telefonu olan personel;
 *    owner-notifier kancası bu bildirimlerde kapalı → çift mesaj yok, 10 sn debounce'a takılmaz). E-posta seçiliyse ayrıca
 *    mail. Her olay TaskReminderLog'a bir kez yazılır (olayAnahtari) → tekrar gitmez. Eski 07:00 e-posta cron'unun yerini alır.
 *    36 saatten eski (bayat) olay gönderilmez (SKIPPED). `POST /tasks/hatirlatma-ornek` şablonu örnek içerikle gönderir.
 *
 * Kapatma: GOREV_MOTORU=off. Test modunda (isciAcik=false) zamanlayıcılar çalışmaz; metotlar doğrudan çağrılır.
 */
/** Planlanan zamanı bundan eski olay gönderilmez (ilk kurulum / uzun kesinti sonrası toplu patlama önlemi). */
const BAYAT_OLAY_MS = 36 * 60 * 60 * 1000;

@Injectable()
export class GorevMotoruService implements OnApplicationBootstrap {
  private readonly logger = new Logger(GorevMotoruService.name);
  private calisiyor = { tekrar: false, hatirlatma: false };

  constructor(
    private readonly prisma: PrismaService,
    private readonly bildirimler: NotificationsService,
    private readonly email: EmailService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  private kapali(): boolean {
    return String(process.env.GOREV_MOTORU || '').toLowerCase() === 'off';
  }

  onApplicationBootstrap() {
    if (this.kapali()) return;
    const t = setTimeout(() => { void this.tekrarlariUret().catch((e: any) => this.logger.warn(`açılış tekrar üretimi hata: ${e?.message || e}`)); }, 3 * 60 * 1000);
    (t as any).unref?.();
  }

  @Cron('0 15 0 * * *', { timeZone: 'Europe/Istanbul' })
  async geceTekrar() {
    if (this.kapali()) return;
    await this.tekrarlariUret().catch((e: any) => this.logger.warn(`gece tekrar üretimi hata: ${e?.message || e}`));
  }

  @Interval(10 * 60 * 1000)
  async hatirlatmaTiki() {
    if (this.kapali()) return;
    await this.hatirlatmalariGonder().catch((e: any) => this.logger.warn(`hatırlatma tiki hata: ${e?.message || e}`));
  }

  // ── TEKRAR ────────────────────────────────────────────────────────────────────────────────────────

  /** @returns üretilen oluşum sayısı */
  async tekrarlariUret(simdi: Date = new Date()): Promise<number> {
    if (this.calisiyor.tekrar) return 0;
    this.calisiyor.tekrar = true;
    let uretilen = 0;
    try {
      const db: any = this.prisma;
      const sablonlar: any[] = await db.task.findMany({
        where: { isTemplate: true, status: { notIn: ['CANCELLED', 'DONE'] } },
        take: 500,
      });
      for (const s of sablonlar) {
        const ayar = s.recurrence && typeof s.recurrence === 'object' ? s.recurrence : null;
        if (!ayar || ayar.type === 'NONE') continue;
        // son oluşum: en ileri tarihli çocuk; yoksa şablon vadesi/oluşturulması — ama geçmişe dönük üretim YOK
        const sonCocuk = await db.task.findFirst({ where: { parentTaskId: s.id }, orderBy: { dueDate: 'desc' }, select: { dueDate: true } });
        const cocukSayisi = await db.task.count({ where: { parentTaskId: s.id } });
        const bugun = istanbulGunu(simdi);
        let imlec: Date = sonCocuk?.dueDate ? new Date(sonCocuk.dueDate) : new Date(s.dueDate || s.createdAt || simdi);
        // ilk çalıştırma ya da uzun süre çalışmamışsa: geçmişi atla, dünden başla (bugünkü oluşum üretilebilsin)
        if (istanbulGunu(imlec).getTime() < bugun.getTime() - 86400000) imlec = new Date(bugun.getTime() - 86400000);
        const gunler = uretilecekGunler(ayar, imlec, simdi, 14, 12, cocukSayisi);
        for (const gun of gunler) {
          const anahtar = gunAnahtari(gun);
          // aynı gün için oluşum varsa atla (idempotent)
          const var_ = await db.task.findFirst({ where: { parentTaskId: s.id, dueDate: { gte: gun, lt: new Date(gun.getTime() + 86400000) } }, select: { id: true } });
          if (var_) continue;
          await db.task.create({
            data: {
              tenantId: s.tenantId,
              title: s.title,
              description: s.description,
              category: s.category,
              priority: s.priority,
              color: s.color,
              tags: Array.isArray(s.tags) ? s.tags : [],
              taxpayerId: s.taxpayerId || null,
              createdById: s.createdById,
              dueDate: gun,
              dueTime: s.dueTime || null,
              allDay: s.allDay ?? true,
              parentTaskId: s.id,
              isTemplate: false,
              reminderConfig: s.reminderConfig ?? null,
              notifyInApp: s.notifyInApp ?? true,
              notifyEmail: s.notifyEmail ?? false,
              notifyBrowser: s.notifyBrowser ?? true,
              notifySound: s.notifySound ?? false,
              ...(this.alanVar('notifyWhatsapp') ? { notifyWhatsapp: s.notifyWhatsapp ?? true } : {}),
              ...(this.alanVar('notifyPush') ? { notifyPush: s.notifyPush ?? true } : {}),
              ...(this.alanVar('kaynak') ? { kaynak: s.kaynak || 'MANUEL' } : {}),
              ...(this.alanVar('tur') ? { tur: s.tur || 'GOREV' } : {}),
              status: 'OPEN',
            },
          });
          uretilen++;
          this.logger.log(`[GOREV-TEKRAR] "${String(s.title).slice(0, 40)}" → ${anahtar} (${tekrarMetni(ayar)})`);
        }
        const sonraki = gunler.length ? gunler[gunler.length - 1] : null;
        if (sonraki) await db.task.update({ where: { id: s.id }, data: { nextOccurrence: sonraki } }).catch(() => {});
      }
      if (uretilen) this.logger.log(`[GOREV-TEKRAR] ${uretilen} oluşum üretildi (${sablonlar.length} şablon)`);
      return uretilen;
    } finally {
      this.calisiyor.tekrar = false;
    }
  }

  /** Prisma istemcisi yeni alanı tanıyor mu (migration/şema sürüm farkına dayanıklılık). */
  private alanVar(ad: string): boolean {
    try {
      const alanlar = (this.prisma as any)?._runtimeDataModel?.models?.Task?.fields;
      if (Array.isArray(alanlar)) return alanlar.some((f: any) => f?.name === ad);
    } catch { /* bilinmiyorsa yaz */ }
    return true;
  }

  // ── HATIRLATMA ────────────────────────────────────────────────────────────────────────────────────

  /** Sahibin WhatsApp numaraları (owner-notifier ile aynı env: MOREN_OWNER_WHATSAPP_PHONES). */
  private sahipTelefonlari(): string[] {
    const raw = String(process.env.MOREN_OWNER_WHATSAPP_PHONES || process.env.MOREN_OWNER_WHATSAPP_PHONE || '').trim();
    return raw ? raw.split(',').map((p) => telefonNormalize(p)).filter((p): p is string => !!p) : [];
  }

  private sahipHitabi(): string {
    const ozel = String(process.env.MOREN_OWNER_HITAP || '').trim();
    if (ozel) return ozel;
    const ad = String(process.env.MOREN_OWNER_DISPLAY_NAME || 'Muzaffer').trim().split(/\s+/)[0] || 'Muzaffer';
    return `${ad} Bey`;
  }

  private portalUrl(): string {
    return String(process.env.PORTAL_PUBLIC_URL || process.env.PUBLIC_WEB_URL || 'https://portal.morenmusavirlik.com').replace(/\/+$/, '');
  }

  /** Görev → şablon kalemi. */
  private kalemYap(g: any, olay: HatirlatmaOlayi, mukellefAd: string | null): HatirlatmaKalemi {
    return {
      id: g.id,
      baslik: String(g.title || ''),
      tip: olay.tip,
      vadeGunu: g.dueDate ? gunAnahtari(istanbulGunu(new Date(g.dueDate))) : null,
      saat: g.allDay ? null : g.dueTime || null,
      gecikmeGun: olay.gecikmeGun ?? null,
      mukellef: mukellefAd,
      kategori: g.category || null,
      oncelik: g.priority || null,
      aciklama: g.description || null,
    };
  }

  /**
   * Her 10 dk (09:00–21:00 İstanbul): zamanı gelen olaylar → görev başına portal bildirimi (sahip + seçilen personel;
   * push kancası cihazlara iletir) + e-posta (seçiliyse) + ALICI BAŞINA TEK WhatsApp mesajı (şablon: gorev-hatirlatma-metni).
   * owner-notifier'ın WhatsApp kancası bu bildirimler için KAPALI (metadata.kanallar.whatsapp=false) — çift mesaj olmasın.
   * @returns gönderilen bildirim (görev) sayısı
   */
  async hatirlatmalariGonder(simdi: Date = new Date()): Promise<number> {
    if (this.calisiyor.hatirlatma) return 0;
    const saat = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', hour12: false }).format(simdi));
    if (saat < 9 || saat >= 21) return 0; // sessiz saat (owner-notifier ile aynı: 09:00'dan önce / 21:00'den sonra yok)
    this.calisiyor.hatirlatma = true;
    let gonderilen = 0;
    let atlanan = 0;
    const db: any = this.prisma;
    // WhatsApp kovaları: telefon → { hitap, kalemler, tenantId }
    const kovalar = new Map<string, { hitap: string; kalemler: HatirlatmaKalemi[]; tenantId: string; gorevIdleri: string[] }>();
    const kovaEkle = (telefon: string, hitap: string, tenantId: string, kalem: HatirlatmaKalemi) => {
      const k = kovalar.get(telefon) || { hitap, kalemler: [], tenantId, gorevIdleri: [] };
      k.kalemler.push(kalem);
      k.gorevIdleri.push(kalem.id);
      kovalar.set(telefon, k);
    };
    const kisiOnbellek = new Map<string, { id: string; ad: string; phone: string | null; isActive: boolean } | null>();
    const kisiGetir = async (id: string) => {
      if (kisiOnbellek.has(id)) return kisiOnbellek.get(id) || null;
      const u = await db.user.findUnique({ where: { id }, select: { id: true, firstName: true, lastName: true, phone: true, isActive: true } }).catch(() => null);
      const k = u ? { id: u.id, ad: `${String(u.firstName || '').trim()} ${String(u.lastName || '').trim()}`.trim(), phone: telefonNormalize(u.phone), isActive: u.isActive !== false } : null;
      kisiOnbellek.set(id, k);
      return k;
    };
    try {
      const gorevler: any[] = await db.task.findMany({
        where: {
          isTemplate: false,
          status: { in: ['OPEN', 'IN_PROGRESS', 'SNOOZED'] },
          dueDate: { not: null, lte: new Date(simdi.getTime() + 2 * 86400000) },
        },
        include: { taxpayer: { select: { companyName: true, firstName: true, lastName: true } } },
        take: 1000,
      });
      for (const g of gorevler) {
        if (g.status === 'SNOOZED' && g.snoozedUntil && new Date(g.snoozedUntil).getTime() > simdi.getTime()) continue;
        const kanallar = { portal: g.notifyInApp !== false, push: g.notifyPush !== false, whatsapp: g.notifyWhatsapp !== false, email: g.notifyEmail === true };
        if (!kanallar.portal && !kanallar.push && !kanallar.whatsapp && !kanallar.email) continue;
        const ad = g.taxpayer ? (g.taxpayer.companyName || `${g.taxpayer.firstName || ''} ${g.taxpayer.lastName || ''}`.trim()) : null;
        const hg: HatirlatmaGorevi = { id: g.id, title: g.title, status: g.status, dueDate: g.dueDate, dueTime: g.dueTime, priority: g.priority, reminderConfig: g.reminderConfig, taxpayerAd: ad };
        const olaylar = hatirlatmaOlaylari(hg, simdi);
        if (!olaylar.length) continue;
        const loglar: any[] = await db.taskReminderLog.findMany({ where: { taskId: g.id, status: { in: ['SENT', 'SKIPPED'] } }, select: { olayAnahtari: true, channel: true, scheduledFor: true } }).catch(() => []);
        const gonderilmis = new Set<string>(loglar.map((l: any) => String(l.olayAnahtari || `${l.channel}:${l.scheduledFor ? gunAnahtari(istanbulGunu(new Date(l.scheduledFor))) : ''}`)));
        const olay = gonderilecekOlay(olaylar, gonderilmis);
        if (!olay) continue;
        // BAYAT olay (planlanan 36 saatten eski — ilk kurulum / uzun kesinti): toplu bildirim patlaması olmasın; SKIPPED yazılır, bir daha ele alınmaz.
        if (simdi.getTime() - olay.planlanan.getTime() > BAYAT_OLAY_MS) {
          await db.taskReminderLog.create({ data: { taskId: g.id, scheduledFor: olay.planlanan, sentAt: null, channel: 'BILDIRIM', status: 'SKIPPED', recipientId: g.createdById || null, errorMsg: 'bayat olay: planlanan zaman 36 saatten eski, gönderilmedi', ...(this.logAlanVar() ? { olayAnahtari: olay.anahtar } : {}) } }).catch(() => null);
          atlanan++;
          continue;
        }
        const kalem = this.kalemYap(g, olay, ad);
        const personel = Array.isArray(g.hatirlatUserIds) ? (g.hatirlatUserIds as string[]) : [];
        // Bildirim metadata: WhatsApp'ı motor kendisi gönderir → owner-notifier kancası kapalı
        const metadata = {
          taskId: g.id, taxpayerId: g.taxpayerId || null, priority: g.priority || 'MEDIUM', olay: olay.tip, gecikmeGun: olay.gecikmeGun ?? null,
          link: `/panel/gorevler?gorev=${g.id}`, kanallar: { ...kanallar, whatsapp: false }, hatirlatma: true,
        };
        // 1) Portal bildirimi — sahip (görevi açan) + seçilen personel (push kancası her kullanıcının cihazlarına)
        if (kanallar.portal || kanallar.push) {
          const alicilar = new Set<string>();
          if (g.createdById) alicilar.add(g.createdById);
          for (const id of personel) alicilar.add(id);
          let yazildi = false;
          for (const userId of alicilar) {
            try {
              await this.bildirimler.create({
                tenantId: g.tenantId,
                userId,
                type: NOTIFICATION_TYPES.TASK_DUE,
                title: olay.baslik.slice(0, 120),
                body: olay.govde.slice(0, 300),
                metadata,
                dedupeKey: `gorev-hatirlatma:${g.id}:${olay.anahtar}:${userId}`,
                dedupeWindowMin: 60 * 48,
              } as any);
              yazildi = true;
            } catch (e: any) {
              this.logger.warn(`[GOREV-HATIRLATMA] bildirim yazılamadı ${g.id}/${userId}: ${e?.message || e}`);
            }
          }
          if (!yazildi && !kanallar.whatsapp && !kanallar.email) continue;
        }
        // 2) WhatsApp kovaları — sahip numaraları + telefonu olan personel
        if (kanallar.whatsapp) {
          for (const tel of this.sahipTelefonlari()) kovaEkle(tel, this.sahipHitabi(), g.tenantId, kalem);
          for (const id of personel) {
            const u = await kisiGetir(id);
            if (u && u.isActive && u.phone) kovaEkle(u.phone, `Sayın ${u.ad || 'ilgili'}`, g.tenantId, kalem);
          }
        }
        // 3) E-posta (seçiliyse)
        if (kanallar.email) {
          try {
            const alicilar = new Set<string>();
            const u = g.createdById ? await db.user.findUnique({ where: { id: g.createdById }, select: { email: true } }).catch(() => null) : null;
            if (u?.email) alicilar.add(String(u.email).toLowerCase());
            const t = await db.tenant.findUnique({ where: { id: g.tenantId }, select: { email: true } }).catch(() => null);
            if (t?.email) alicilar.add(String(t.email).toLowerCase());
            if (alicilar.size) {
              const metin = hatirlatmaMesaji({ hitap: this.sahipHitabi() }, [kalem], simdi, this.portalUrl());
              await this.email.send({ to: Array.from(alicilar), subject: `Görev — ${olay.baslik.slice(0, 90)}`, text: metin, html: `<pre style="font-family:sans-serif">${metin.replace(/</g, '&lt;')}</pre>` }, g.tenantId);
            }
          } catch (e: any) {
            this.logger.warn(`[GOREV-HATIRLATMA] e-posta gönderilemedi ${g.id}: ${e?.message || e}`);
          }
        }
        await db.taskReminderLog.create({
          data: { taskId: g.id, scheduledFor: olay.planlanan, sentAt: simdi, channel: 'BILDIRIM', status: 'SENT', recipientId: g.createdById || null, ...(this.logAlanVar() ? { olayAnahtari: olay.anahtar } : {}) },
        }).catch((e: any) => this.logger.warn(`[GOREV-HATIRLATMA] günlük yazılamadı ${g.id}: ${e?.message || e}`));
        await db.task.update({ where: { id: g.id }, data: { lastReminderAt: simdi, ...(olay.tip === 'GECIKME' ? { escalationLevel: Math.min(5, Number(g.escalationLevel || 0) + 1) } : {}) } }).catch(() => {});
        gonderilen++;
      }
      // 4) WhatsApp — alıcı başına TEK mesaj
      for (const [telefon, kova] of kovalar) {
        const metin = hatirlatmaMesaji({ hitap: kova.hitap }, kova.kalemler, simdi, this.portalUrl());
        let ok = false;
        try {
          ok = await this.whatsapp.sendMessage(telefon, metin, kova.tenantId, { quote: false });
        } catch (e: any) {
          this.logger.warn(`[GOREV-HATIRLATMA] WhatsApp gönderilemedi ${telefon}: ${e?.message || e}`);
        }
        for (const gorevId of kova.gorevIdleri) {
          await db.taskReminderLog.create({
            data: { taskId: gorevId, scheduledFor: simdi, sentAt: ok ? simdi : null, channel: 'WHATSAPP', status: ok ? 'SENT' : 'FAILED', recipientId: null, errorMsg: ok ? `→ ${telefon}` : `WhatsApp gönderilemedi → ${telefon}` },
          }).catch(() => null);
        }
        this.logger.log(`[GOREV-HATIRLATMA] WhatsApp ${ok ? 'gitti' : 'GİTMEDİ'} → ${telefon} (${kova.kalemler.length} kalem, ${kova.hitap})`);
      }
      if (gonderilen || atlanan) this.logger.log(`[GOREV-HATIRLATMA] ${gonderilen} hatırlatma gönderildi, ${atlanan} bayat olay atlandı (${gorevler.length} aday, ${kovalar.size} WhatsApp alıcısı)`);
      return gonderilen;
    } finally {
      this.calisiyor.hatirlatma = false;
    }
  }

  /**
   * POST /tasks/hatirlatma-ornek — şablonu ÖRNEK içerikle WhatsApp'a gönderir (Muzaffer Bey: "şablonu merak ediyorum, test et").
   * Alıcı: sahibin numaraları; `phone` verilirse yalnız o; `userId` verilirse o kullanıcının kayıtlı telefonu.
   */
  async ornekGonder(tenantId: string, userId: string, opts: { phone?: string; userId?: string } = {}): Promise<{ ok: boolean; telefonlar: string[]; metin: string; hata?: string }> {
    const db: any = this.prisma;
    let telefonlar: string[] = [];
    let hitap = this.sahipHitabi();
    if (opts.phone) {
      const t = telefonNormalize(opts.phone);
      if (!t) return { ok: false, telefonlar: [], metin: '', hata: 'Telefon geçersiz' };
      telefonlar = [t];
    } else if (opts.userId) {
      const u = await db.user.findFirst({ where: { id: opts.userId, tenantId }, select: { firstName: true, lastName: true, phone: true } }).catch(() => null);
      const t = telefonNormalize(u?.phone);
      if (!t) return { ok: false, telefonlar: [], metin: '', hata: 'Kullanıcının kayıtlı telefonu yok' };
      telefonlar = [t];
      hitap = `Sayın ${`${String(u.firstName || '').trim()} ${String(u.lastName || '').trim()}`.trim() || 'ilgili'}`;
    } else {
      telefonlar = this.sahipTelefonlari();
      if (!telefonlar.length) return { ok: false, telefonlar: [], metin: '', hata: 'Sahip WhatsApp numarası tanımlı değil (MOREN_OWNER_WHATSAPP_PHONES)' };
    }
    const metin = hatirlatmaMesaji({ hitap }, ornekKalemler(), new Date(), this.portalUrl(), true);
    let ok = true;
    for (const tel of telefonlar) {
      try {
        const r = await this.whatsapp.sendMessage(tel, metin, tenantId, { quote: false });
        if (!r) ok = false;
      } catch (e: any) {
        ok = false;
        this.logger.warn(`[GOREV-HATIRLATMA] örnek gönderilemedi ${tel}: ${e?.message || e}`);
      }
    }
    this.logger.log(`[GOREV-HATIRLATMA] örnek şablon ${ok ? 'gitti' : 'GİTMEDİ'} → ${telefonlar.join(', ')} (isteyen ${userId})`);
    return { ok, telefonlar, metin };
  }

  private logAlanVar(): boolean {
    try {
      const alanlar = (this.prisma as any)?._runtimeDataModel?.models?.TaskReminderLog?.fields;
      if (Array.isArray(alanlar)) return alanlar.some((f: any) => f?.name === 'olayAnahtari');
    } catch { /* bilinmiyorsa yaz */ }
    return true;
  }
}
