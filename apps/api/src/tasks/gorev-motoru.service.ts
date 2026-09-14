import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notification-types';
import { EmailService } from '../email/email.service';
import { uretilecekGunler, istanbulGunu, gunAnahtari, tekrarMetni } from './gorev-tekrar';
import { hatirlatmaOlaylari, gonderilecekOlay, HatirlatmaGorevi } from './gorev-hatirlatma-kurali';

/**
 * GÖREV MOTORU (2026-09-14, Görevler & Notlar Faz 2) — iki iş:
 *
 * 1) TEKRAR ÜRETİMİ (her gece 00:15 + açılıştan 3 dk sonra): `isTemplate` şablonlarından 14 gün ileriye kadar
 *    oluşum görevleri açar (`parentTaskId` = şablon, `nextOccurrence` güncellenir). Geçmiş oluşumlar GERİYE DÖNÜK
 *    üretilmez (ilk çalıştırmada 11 eski şablon bugünden itibaren işler). Şablon listede görünmez (tur/isTemplate).
 *
 * 2) HATIRLATMA (her 10 dk, 07:00–21:00 İstanbul): `gorev-hatirlatma-kurali` ile zamanı gelen olay (yaklaşıyor / bugün /
 *    gecikti) → TEK portal bildirimi (TASK_DUE). Bildirim katmanı bunu kendiliğinden telefon push'una ve sahibin
 *    WhatsApp'ına iletir (push modülü + owner-notifier kancaları); görevin kanal anahtarları metadata.kanallar ile
 *    taşınır (kapalı kanal o katmanda atlanır). E-posta seçiliyse ayrıca mail. Her olay TaskReminderLog'a bir kez yazılır
 *    (olayAnahtari) → tekrar gitmez. Eski 07:00 e-posta cron'unun yerini alır.
 *
 * Kapatma: GOREV_MOTORU=off. Test modunda (isciAcik=false) zamanlayıcılar çalışmaz; metotlar doğrudan çağrılır.
 */
@Injectable()
export class GorevMotoruService implements OnApplicationBootstrap {
  private readonly logger = new Logger(GorevMotoruService.name);
  private calisiyor = { tekrar: false, hatirlatma: false };

  constructor(
    private readonly prisma: PrismaService,
    private readonly bildirimler: NotificationsService,
    private readonly email: EmailService,
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

  /** @returns gönderilen bildirim sayısı */
  async hatirlatmalariGonder(simdi: Date = new Date()): Promise<number> {
    if (this.calisiyor.hatirlatma) return 0;
    const saat = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', hour12: false }).format(simdi));
    if (saat < 7 || saat >= 21) return 0; // gece: bildirim katmanı zaten erteler; boşuna tarama yok
    this.calisiyor.hatirlatma = true;
    let gonderilen = 0;
    try {
      const db: any = this.prisma;
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
        const loglar: any[] = await db.taskReminderLog.findMany({ where: { taskId: g.id, status: 'SENT' }, select: { olayAnahtari: true, channel: true, scheduledFor: true } }).catch(() => []);
        const gonderilmis = new Set<string>(loglar.map((l: any) => String(l.olayAnahtari || `${l.channel}:${l.scheduledFor ? gunAnahtari(istanbulGunu(new Date(l.scheduledFor))) : ''}`)));
        const olay = gonderilecekOlay(olaylar, gonderilmis);
        if (!olay) continue;
        // 1) Portal bildirimi (→ push + WhatsApp kancaları)
        if (kanallar.portal || kanallar.push || kanallar.whatsapp) {
          try {
            await this.bildirimler.create({
              tenantId: g.tenantId,
              userId: g.createdById || undefined,
              type: NOTIFICATION_TYPES.TASK_DUE,
              title: olay.baslik.slice(0, 120),
              body: olay.govde.slice(0, 300),
              metadata: {
                taskId: g.id, taxpayerId: g.taxpayerId || null, priority: g.priority || 'MEDIUM', olay: olay.tip, gecikmeGun: olay.gecikmeGun ?? null,
                link: `/panel/gorevler?id=${g.id}`, kanallar, hatirlatma: true,
              },
              dedupeKey: `gorev-hatirlatma:${g.id}:${olay.anahtar}`,
              dedupeWindowMin: 60 * 48,
            } as any);
            gonderilen++;
          } catch (e: any) {
            this.logger.warn(`[GOREV-HATIRLATMA] bildirim yazılamadı ${g.id}: ${e?.message || e}`);
            continue;
          }
        }
        // 2) E-posta (seçiliyse)
        if (kanallar.email) {
          try {
            const alicilar = new Set<string>();
            const u = g.createdById ? await db.user.findUnique({ where: { id: g.createdById }, select: { email: true } }).catch(() => null) : null;
            if (u?.email) alicilar.add(String(u.email).toLowerCase());
            const t = await db.tenant.findUnique({ where: { id: g.tenantId }, select: { email: true } }).catch(() => null);
            if (t?.email) alicilar.add(String(t.email).toLowerCase());
            if (alicilar.size) {
              const metin = `${olay.baslik}\n\n${olay.govde}${g.description ? '\n\n' + String(g.description).slice(0, 800) : ''}\n\nPortal: /panel/gorevler?id=${g.id}`;
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
      }
      if (gonderilen) this.logger.log(`[GOREV-HATIRLATMA] ${gonderilen} hatırlatma gönderildi (${gorevler.length} aday)`);
      return gonderilen;
    } finally {
      this.calisiyor.hatirlatma = false;
    }
  }

  private logAlanVar(): boolean {
    try {
      const alanlar = (this.prisma as any)?._runtimeDataModel?.models?.TaskReminderLog?.fields;
      if (Array.isArray(alanlar)) return alanlar.some((f: any) => f?.name === 'olayAnahtari');
    } catch { /* bilinmiyorsa yaz */ }
    return true;
  }
}
