import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EkipRunnerService } from '../ekip/ekip-runner.service';
import { bildirimAcikMi, bildirimTuru } from '../ekip/ekip-akis';

/** Görev kaynağı — kaydı kim açtı (tasks.kaynak). */
export const GOREV_KAYNAKLARI = ['MANUEL', 'WHATSAPP', 'BANKA', 'EKIP', 'AI', 'TAKVIM'] as const;
export type GorevKaynagi = (typeof GOREV_KAYNAKLARI)[number];
/** Kayıt türü — görev (vadeli iş) ya da not (vadesiz, sabitlenebilir). */
export const GOREV_TURLERI = ['GOREV', 'NOT'] as const;
export type GorevTuru = (typeof GOREV_TURLERI)[number];
const ONCELIKLER = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
/** Ajandada "açık" sayılan görev durumları (ertelenmiş de listede kalır). */
const ACIK_DURUMLAR = ['OPEN', 'IN_PROGRESS', 'SNOOZED'] as const;
/** Ekibe ver: arka plandaki Koordinatör koşusunun iş kimliği ('baslangic' olayı) bu kadar beklenir. */
const EKIBE_VER_ISID_BEKLEME_MS = 3000;
const TAKVIM_TAVANI = 100;

export interface CreateTaskDto {
  title: string;
  description?: string;
  category?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  color?: string;
  tags?: string[];
  taxpayerId?: string;
  dueDate?: string; // ISO string
  dueTime?: string; // "HH:mm"
  allDay?: boolean;
  recurrence?: any;
  reminderConfig?: any;
  notifyInApp?: boolean;
  notifyEmail?: boolean;
  notifyBrowser?: boolean;
  notifySound?: boolean;
  // 2026-09-14 Görevler & Notlar
  tur?: GorevTuru;
  pinned?: boolean;
  kaynak?: GorevKaynagi;
  notifyWhatsapp?: boolean;
  notifyPush?: boolean;
  taxCalendarId?: string | null;
  /** Ofis personeline de hatırlat — portal kullanıcı id'leri (portal bildirimi + push + WhatsApp) */
  hatirlatUserIds?: string[];
}

export interface UpdateTaskDto extends Partial<CreateTaskDto> {
  status?: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'SNOOZED' | 'MISSED' | 'CANCELLED';
  snoozedUntil?: string;
}

export interface ListTasksFilters {
  tenantId: string;
  status?: string;
  taxpayerId?: string;
  category?: string;
  priority?: string;
  kaynak?: string;
  tur?: string;
  fromDate?: Date;
  toDate?: Date;
  search?: string;
  isTemplate?: boolean;
  limit?: number;
  offset?: number;
}

/** GET /tasks/ajanda süzgeçleri — sayaçlar süzgeçten BAĞIMSIZ (ekip akışı ile aynı kural). */
export interface AjandaSecenekleri {
  taxpayerId?: string | null;
  category?: string | null;
  priority?: string | null;
  kaynak?: string | null;
  tur?: string | null;
  search?: string | null;
  /** Takvim penceresi: bugünden ileri gün (varsayılan 30, 1..365). */
  gun?: number | string | null;
}

export type TopluIslem = 'tamamla' | 'yeniden-ac' | 'ertele' | 'sil' | 'iptal' | 'kategori' | 'oncelik' | 'sabitle' | 'sabit-kaldir';
export const TOPLU_ISLEMLER: TopluIslem[] = ['tamamla', 'yeniden-ac', 'ertele', 'sil', 'iptal', 'kategori', 'oncelik', 'sabitle', 'sabit-kaldir'];

export interface TopluDto {
  ids: string[];
  islem: TopluIslem;
  until?: string;
  category?: string | null;
  priority?: string;
}

export interface TakvimdenDto {
  taxCalendarId: string;
  taxpayerId?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
}

/** Ajanda için zaman aralıkları — hepsi Europe/Istanbul günü (UTC Date olarak). */
export interface AjandaZaman {
  gunBasi: Date;
  gunSonu: Date;
  /** Bu haftanın Pazar günü sonu (bugün Pazar ise bugünün sonu). */
  haftaSonu: Date;
}

/** Istanbul gününün başlangıcı (UTC Date) — ekip-runner gunBasiIstanbul ile aynı kalıp (Türkiye sabit +03:00). */
export function istanbulGunBasi(simdi: Date = new Date()): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(simdi);
  return new Date(`${ymd}T00:00:00+03:00`);
}

/** Bugün / bu hafta sınırları (Istanbul). Saf; test edilebilir. */
export function ajandaZamanAraliklari(simdi: Date = new Date()): AjandaZaman {
  const gunBasi = istanbulGunBasi(simdi);
  const GUN = 24 * 60 * 60 * 1000;
  const gunSonu = new Date(gunBasi.getTime() + GUN - 1);
  // Istanbul haftanın günü: gün başına +3 saat eklenince UTC gün adı Istanbul gününe eşit (0 = Pazar)
  const istHaftaGunu = new Date(gunBasi.getTime() + 3 * 60 * 60 * 1000).getUTCDay();
  const pazaraKalan = istHaftaGunu === 0 ? 0 : 7 - istHaftaGunu;
  const haftaSonu = new Date(gunBasi.getTime() + (pazaraKalan + 1) * GUN - 1);
  return { gunBasi, gunSonu, haftaSonu };
}

/** Takvim dönemi etiketi: '2026-08' / '2026-Q2' / '2026' (tool-executor getTaxCalendar ile aynı). */
export function takvimDonemi(c: { periodYear?: number | null; periodMonth?: number | null; periodQuarter?: number | null }): string {
  if (c.periodMonth) return `${c.periodYear}-${String(c.periodMonth).padStart(2, '0')}`;
  if (c.periodQuarter) return `${c.periodYear}-Q${c.periodQuarter}`;
  return String(c.periodYear ?? '');
}

const kucuk = (s: any) => String(s ?? '').toLocaleLowerCase('tr-TR');
const mukellefAdi = (t: any): string | null => {
  if (!t) return null;
  const ad = String(t.companyName || '').trim() || `${String(t.firstName || '').trim()} ${String(t.lastName || '').trim()}`.trim();
  return ad || null;
};
const nesne = (v: any) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

@Injectable()
export class TasksService {
  /** Liste tavanları — `kirpildi` bayrağı bunlarla kıyaslanır (bulgu 35b). */
  static readonly GOREV_TAVANI = 500;
  static readonly NOT_TAVANI = 200;

  private readonly logger = new Logger('TasksService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: EkipRunnerService,
  ) {}

  private get db(): any {
    return this.prisma as any;
  }

  private static readonly TEMEL_INCLUDE = {
    taxpayer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
    createdBy: { select: { id: true, firstName: true, lastName: true } },
  };

  private turSec(v: any): GorevTuru | null {
    const t = String(v || '').trim().toUpperCase();
    return (GOREV_TURLERI as readonly string[]).includes(t) ? (t as GorevTuru) : null;
  }

  private kaynakSec(v: any): GorevKaynagi | null {
    const k = String(v || '').trim().toUpperCase();
    return (GOREV_KAYNAKLARI as readonly string[]).includes(k) ? (k as GorevKaynagi) : null;
  }

  /** Başlık + açıklama + mükellef adı (büyük/küçük harf duyarsız) arama koşulu. */
  private aramaKosulu(search: string): any[] {
    return [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      {
        taxpayer: {
          OR: [
            { companyName: { contains: search, mode: 'insensitive' } },
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
          ],
        },
      },
    ];
  }

  /** Görev oluştur */
  async create(tenantId: string, userId: string, dto: CreateTaskDto) {
    const tur = this.turSec(dto.tur) || 'GOREV';
    return this.db.task.create({
      data: {
        tenantId,
        title: dto.title,
        description: dto.description,
        category: dto.category,
        priority: dto.priority ?? 'MEDIUM',
        color: dto.color,
        tags: dto.tags ?? [],
        taxpayerId: dto.taxpayerId || null,
        createdById: userId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        dueTime: dto.dueTime,
        allDay: dto.allDay ?? true,
        recurrence: dto.recurrence ?? null,
        reminderConfig: dto.reminderConfig ?? null,
        notifyInApp: dto.notifyInApp ?? true,
        notifyEmail: dto.notifyEmail ?? false,
        notifyBrowser: dto.notifyBrowser ?? true,
        notifySound: dto.notifySound ?? false,
        // 2026-09-14 Görevler & Notlar: tür/kaynak/sabit + hatırlatma varsayılanları (WhatsApp + push açık; motor Faz 2)
        tur,
        pinned: dto.pinned === true,
        kaynak: this.kaynakSec(dto.kaynak) || 'MANUEL',
        notifyWhatsapp: dto.notifyWhatsapp ?? true,
        notifyPush: dto.notifyPush ?? true,
        taxCalendarId: dto.taxCalendarId || null,
        hatirlatUserIds: await this.kisileriDogrula(tenantId, dto.hatirlatUserIds),
        // Eğer recurrence varsa template olarak işaretle, sonraki occurrence'i hesapla (notlarda tekrar yok)
        isTemplate: tur === 'GOREV' && !!dto.recurrence && dto.recurrence?.type !== 'NONE',
      },
      include: TasksService.TEMEL_INCLUDE,
    });
  }

  /** Görev güncelle */
  async update(tenantId: string, taskId: string, userId: string, dto: UpdateTaskDto) {
    const existing = await this.db.task.findFirst({
      where: { id: taskId, tenantId },
    });
    if (!existing) throw new NotFoundException('Görev bulunamadı');

    const updateData: any = {};
    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.category !== undefined) updateData.category = dto.category;
    if (dto.priority !== undefined) updateData.priority = dto.priority;
    if (dto.color !== undefined) updateData.color = dto.color;
    if (dto.tags !== undefined) updateData.tags = dto.tags;
    if (dto.taxpayerId !== undefined) updateData.taxpayerId = dto.taxpayerId || null;
    if (dto.dueDate !== undefined) updateData.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    if (dto.dueTime !== undefined) updateData.dueTime = dto.dueTime;
    if (dto.allDay !== undefined) updateData.allDay = dto.allDay;
    if (dto.recurrence !== undefined) updateData.recurrence = dto.recurrence;
    if (dto.reminderConfig !== undefined) updateData.reminderConfig = dto.reminderConfig;
    if (dto.notifyInApp !== undefined) updateData.notifyInApp = dto.notifyInApp;
    if (dto.notifyEmail !== undefined) updateData.notifyEmail = dto.notifyEmail;
    if (dto.notifyBrowser !== undefined) updateData.notifyBrowser = dto.notifyBrowser;
    if (dto.notifySound !== undefined) updateData.notifySound = dto.notifySound;
    // 2026-09-14 Görevler & Notlar
    if (dto.tur !== undefined) {
      const tur = this.turSec(dto.tur);
      if (!tur) throw new BadRequestException('tur GOREV ya da NOT olmalı');
      updateData.tur = tur;
    }
    if (dto.pinned !== undefined) updateData.pinned = dto.pinned === true;
    if (dto.kaynak !== undefined) {
      const kaynak = this.kaynakSec(dto.kaynak);
      if (!kaynak) throw new BadRequestException(`kaynak şunlardan biri olmalı: ${GOREV_KAYNAKLARI.join(', ')}`);
      updateData.kaynak = kaynak;
    }
    if (dto.notifyWhatsapp !== undefined) updateData.notifyWhatsapp = dto.notifyWhatsapp === true;
    if (dto.notifyPush !== undefined) updateData.notifyPush = dto.notifyPush === true;
    if (dto.taxCalendarId !== undefined) updateData.taxCalendarId = dto.taxCalendarId || null;
    if (dto.hatirlatUserIds !== undefined) updateData.hatirlatUserIds = await this.kisileriDogrula(tenantId, dto.hatirlatUserIds);
    if (dto.status !== undefined) {
      updateData.status = dto.status;
      if (dto.status === 'DONE') {
        updateData.completedAt = new Date();
        updateData.completedById = userId;
      }
    }
    if (dto.snoozedUntil !== undefined) {
      updateData.snoozedUntil = dto.snoozedUntil ? new Date(dto.snoozedUntil) : null;
      if (dto.snoozedUntil) updateData.status = 'SNOOZED';
    }

    return this.db.task.update({
      where: { id: taskId },
      data: updateData,
      include: TasksService.TEMEL_INCLUDE,
    });
  }

  /** Tek görev getir — notlar (yeniden eskiye) + ekler dahil */
  async findOne(tenantId: string, taskId: string) {
    const task = await this.db.task.findFirst({
      where: { id: taskId, tenantId },
      include: {
        ...TasksService.TEMEL_INCLUDE,
        notes: {
          include: { user: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
        },
        attachments: true,
        _count: { select: { notes: true, attachments: true } },
      },
    });
    if (!task) throw new NotFoundException('Görev bulunamadı');
    return task;
  }

  /** Görev listesi (filtreli) */
  async list(filters: ListTasksFilters) {
    const where: any = { tenantId: filters.tenantId };
    if (filters.status) where.status = filters.status;
    if (filters.taxpayerId) where.taxpayerId = filters.taxpayerId;
    if (filters.category) where.category = filters.category;
    if (filters.priority) where.priority = filters.priority;
    // 2026-09-14: kaynak / tur süzgeçleri (verilmezse eski davranış — hepsi)
    const kaynak = this.kaynakSec(filters.kaynak);
    if (kaynak) where.kaynak = kaynak;
    const tur = this.turSec(filters.tur);
    if (tur) where.tur = tur;
    if (filters.isTemplate !== undefined) where.isTemplate = filters.isTemplate;
    if (filters.fromDate || filters.toDate) {
      where.dueDate = {};
      if (filters.fromDate) where.dueDate.gte = filters.fromDate;
      if (filters.toDate) where.dueDate.lte = filters.toDate;
    }
    if (filters.search) {
      where.OR = this.aramaKosulu(filters.search);
    }

    const limit = Math.min(filters.limit ?? 100, 500);
    const offset = filters.offset ?? 0;

    const [items, total] = await Promise.all([
      this.db.task.findMany({
        where,
        orderBy: [
          { status: 'asc' }, // OPEN önce
          { dueDate: 'asc' },
          { priority: 'desc' },
        ],
        take: limit,
        skip: offset,
        include: {
          ...TasksService.TEMEL_INCLUDE,
          notes: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            include: { user: { select: { id: true, firstName: true, lastName: true } } },
          },
          _count: { select: { notes: true, attachments: true } },
        },
      }),
      this.db.task.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  /** hatirlatUserIds: yalnız bu ofisin aktif kullanıcıları, tekil, en çok 20 (2026-09-14 ofis personeline de hatırlat). */
  private async kisileriDogrula(tenantId: string, ids: unknown): Promise<string[]> {
    if (ids === undefined || ids === null) return [];
    if (!Array.isArray(ids)) throw new BadRequestException('hatirlatUserIds dizi olmalı');
    const temiz = Array.from(new Set(ids.map((x) => String(x || '').trim()).filter(Boolean))).slice(0, 20);
    if (!temiz.length) return [];
    const rows: Array<{ id: string }> = await this.db.user.findMany({ where: { tenantId, id: { in: temiz }, isActive: true }, select: { id: true } });
    const gecerli = new Set(rows.map((r) => r.id));
    return temiz.filter((id) => gecerli.has(id));
  }

  /** GET /tasks/kisiler — ofisin aktif portal kullanıcıları (hatırlatma alıcısı seçimi için): id, ad, rol, telefon var mı, ben. */
  async kisiler(tenantId: string, userId: string): Promise<Array<{ id: string; ad: string; rol: string; telefon: boolean; ben: boolean }>> {
    const rows: any[] = await this.db.user.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true, userRoles: { select: { role: { select: { name: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((u) => ({
      id: u.id,
      ad: `${String(u.firstName || '').trim()} ${String(u.lastName || '').trim()}`.trim() || String(u.email || ''),
      rol: String(u.userRoles?.[0]?.role?.name || 'STAFF'),
      telefon: !!u.phone,
      ben: u.id === userId,
    }));
  }

  /** Görev sil (hard delete — notlar, ekler, hatırlatma kayıtları cascade) */
  async remove(tenantId: string, taskId: string) {
    const existing = await this.db.task.findFirst({
      where: { id: taskId, tenantId },
    });
    if (!existing) throw new NotFoundException('Görev bulunamadı');

    // Hard delete (cascades to notes, attachments, reminder_logs)
    return this.db.task.delete({ where: { id: taskId } });
  }

  /**
   * Sayaçlar — ana sayfa kartı / mobil için. Şekil korunur (today/overdue/thisWeek/totalOpen);
   * 2026-09-14: yalnız tur=GOREV sayılır (notlar şişirmez), `acik` = totalOpen, `not` ayrı; gün sınırları Istanbul.
   */
  async getCounts(tenantId: string) {
    const z = ajandaZamanAraliklari();
    const temel = { tenantId, status: { in: ['OPEN', 'IN_PROGRESS'] }, isTemplate: false, tur: 'GOREV' };

    const [today, overdue, thisWeek, totalOpen, not] = await Promise.all([
      this.db.task.count({ where: { ...temel, dueDate: { gte: z.gunBasi, lte: z.gunSonu } } }),
      this.db.task.count({ where: { ...temel, dueDate: { lt: z.gunBasi } } }),
      this.db.task.count({ where: { ...temel, dueDate: { gte: z.gunBasi, lte: z.haftaSonu } } }),
      this.db.task.count({ where: temel }),
      this.db.task.count({ where: { tenantId, isTemplate: false, tur: 'NOT', status: { notIn: ['DONE', 'CANCELLED'] } } }),
    ]);

    return { today, overdue, thisWeek, totalOpen, acik: totalOpen, not };
  }

  /** Görev not ekle */
  async addNote(tenantId: string, taskId: string, userId: string, content: string) {
    const task = await this.db.task.findFirst({
      where: { id: taskId, tenantId },
    });
    if (!task) throw new NotFoundException('Görev bulunamadı');

    return this.db.taskNote.create({
      data: { taskId, userId, content },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
  }

  /** Tamamlandı işaretle (kısa yol) */
  async complete(tenantId: string, taskId: string, userId: string) {
    return this.update(tenantId, taskId, userId, { status: 'DONE' });
  }

  /** Ertele */
  async snooze(tenantId: string, taskId: string, userId: string, until: string) {
    return this.update(tenantId, taskId, userId, { snoozedUntil: until });
  }

  // ─── AJANDA (2026-09-14: görevler + notlar + ekip "sizden istenen" + vergi takvimi tek ekranda) ───

  /**
   * GET /tasks/ajanda — gruplar süzgeçli, sayaçlar süzgeçten bağımsız (tenant geneli).
   *  gorevler     : tur GOREV, durum OPEN|IN_PROGRESS|SNOOZED; sabit önce, sonra vade (vadesizler sonda), öncelik
   *  notlar       : tur NOT, DONE/CANCELLED hariç; sabit önce, sonra son güncellenen
   *  ekipIstekler : açık "Sizden istenen" bildirimleri (AUTOMATION, automationId 'ekip:', tur 'istek', kapanmamış)
   *  takvim       : tax_calendar bugünden `gun` gün ileri (≤100), gorevVar = bu kayıttan açılmış AÇIK görev var mı
   *  sayaclar     : bugun / gecikmis / buHafta / acik / istek / not — Istanbul günü
   */
  async ajanda(tenantId: string, opts: AjandaSecenekleri = {}) {
    const z = ajandaZamanAraliklari();
    const gun = Math.min(Math.max(Math.floor(Number(opts.gun)) || 30, 1), 365);
    const takvimSonu = new Date(z.gunBasi.getTime() + (gun + 1) * 24 * 60 * 60 * 1000 - 1);
    const tur = this.turSec(opts.tur);
    const kaynak = this.kaynakSec(opts.kaynak);
    const taxpayerId = String(opts.taxpayerId || '').trim() || null;
    const search = String(opts.search || '').trim();

    const ortak: any = { tenantId, isTemplate: false };
    if (taxpayerId) ortak.taxpayerId = taxpayerId;
    if (opts.category) ortak.category = String(opts.category);
    if (opts.priority && (ONCELIKLER as readonly string[]).includes(String(opts.priority))) ortak.priority = String(opts.priority);
    if (kaynak) ortak.kaynak = kaynak;
    if (search) ortak.OR = this.aramaKosulu(search);

    const include = { ...TasksService.TEMEL_INCLUDE, _count: { select: { notes: true } } };

    const [gorevler, notlar, istekler, takvimKayitlari, sayaclar] = await Promise.all([
      tur === 'NOT'
        ? Promise.resolve([] as any[])
        : this.db.task.findMany({
            where: { ...ortak, tur: 'GOREV', status: { in: [...ACIK_DURUMLAR] } },
            orderBy: [{ pinned: 'desc' }, { dueDate: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
            take: TasksService.GOREV_TAVANI,
            include,
          }),
      tur === 'GOREV'
        ? Promise.resolve([] as any[])
        : this.db.task.findMany({
            where: { ...ortak, tur: 'NOT', status: { notIn: ['DONE', 'CANCELLED'] } },
            orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
            take: TasksService.NOT_TAVANI,
            include,
          }),
      this.acikEkipIstekleri(tenantId),
      this.db.taxCalendar
        .findMany({ where: { dueDate: { gte: z.gunBasi, lte: takvimSonu } }, orderBy: { dueDate: 'asc' }, take: TAKVIM_TAVANI })
        .catch((e: any) => (this.logger.warn(`ajanda: vergi takvimi okunamadı: ${e?.message || e}`), [] as any[])),
      this.ajandaSayaclari(tenantId, z),
    ]);

    // Takvim → açık görev var mı (tenant geneli)
    const takvimIdleri = (takvimKayitlari as any[]).map((c) => c.id);
    const gorevliTakvim = new Set<string>();
    if (takvimIdleri.length) {
      const rows: any[] = await this.db.task
        .findMany({
          where: { tenantId, taxCalendarId: { in: takvimIdleri }, status: { in: [...ACIK_DURUMLAR] } },
          select: { taxCalendarId: true },
          distinct: ['taxCalendarId'],
        })
        .catch(() => []);
      for (const r of rows) if (r?.taxCalendarId) gorevliTakvim.add(r.taxCalendarId);
    }
    const takvim = (takvimKayitlari as any[]).map((c) => ({
      id: c.id,
      ad: String(c.description || '').trim() || String(c.declarationType || ''),
      tur: c.declarationType,
      tarih: c.dueDate instanceof Date ? c.dueDate.toISOString() : new Date(c.dueDate).toISOString(),
      donem: takvimDonemi(c),
      gorevVar: gorevliTakvim.has(c.id),
    }));

    // Ekip istekleri: süzgeç (mükellef / arama) yalnız listeye; sayaç tümünü sayar
    const aranan = kucuk(search);
    const ekipIstekler = (istekler as any[]).filter((i) => {
      if (taxpayerId && i.taxpayerId !== taxpayerId) return false;
      if (!aranan) return true;
      return [i.baslik, i.aciklama, i.mukellefAd].some((v) => kucuk(v).includes(aranan));
    });

    return {
      gorevler,
      notlar,
      ekipIstekler,
      takvim,
      sayaclar: { ...sayaclar, istek: (istekler as any[]).length },
      // KIRPMA BİLDİRİMİ — 2026-09-25 (portal denetimi bulgu 35b).
      //   Görev listesi 500'e, not listesi 200'e kırpılıyor ve bu SESSİZCE oluyordu:
      //   sınır dolduğunda kullanıcı eksik listeye bakıp tam sanıyordu. Canlı ölçüm
      //   (25 Eylül): 19 açık görev — sınır BUGÜN dolmuyor. Yine de sessiz kalmasın;
      //   dolarsa ekran uyarabilir. Sayfalama gerekirse bu bayrak onu tetikler.
      kirpildi: {
        gorev: (gorevler as any[]).length >= TasksService.GOREV_TAVANI,
        gorevTavan: TasksService.GOREV_TAVANI,
        not: (notlar as any[]).length >= TasksService.NOT_TAVANI,
        notTavan: TasksService.NOT_TAVANI,
      },
    };
  }

  /** Süzgeçten bağımsız sayaçlar (tur GOREV; ertelenmişler "gecikmiş" sayılmaz; not ayrı). */
  private async ajandaSayaclari(tenantId: string, z: AjandaZaman): Promise<{ bugun: number; gecikmis: number; buHafta: number; acik: number; not: number }> {
    const temel = { tenantId, isTemplate: false, tur: 'GOREV', status: { in: [...ACIK_DURUMLAR] } };
    const [bugun, gecikmis, buHafta, acik, not] = await Promise.all([
      this.db.task.count({ where: { ...temel, dueDate: { gte: z.gunBasi, lte: z.gunSonu } } }),
      // 2026-09-25 (portal denetimi bulgu 34) — ERTELEMESİ BİTEN GÖREV SAYAÇTA.
      //   Eskiden sayaç SNOOZED'ı tamamen dışlıyor ve `snoozedUntil`'e hiç bakmıyordu.
      //   Repoda SNOOZED → OPEN geri dönüşü yapan bir iş de YOK, yani erteleme süresi
      //   dolan görev sayaçta sonsuza dek görünmüyordu (kullanıcı "0 gecikmiş" görüp
      //   hiç tıklamıyordu). Ekran tarafı zaten doğru davranıyor: `etkinTarih()`
      //   snoozedUntil'i vade sayıyor ve süresi geçmişi 'overdue' grubuna koyuyor —
      //   sayaç o tanıma hizalandı. Hâlâ ertelemede olanlar sayılmaz.
      this.db.task.count({
        where: {
          ...temel,
          OR: [
            { status: { in: ['OPEN', 'IN_PROGRESS'] }, dueDate: { lt: z.gunBasi } },
            { status: 'SNOOZED', snoozedUntil: { lt: z.gunBasi } },
            // Ertelenmiş ama bitiş tarihi girilmemiş: vadesi geçmişse yine gecikmiş.
            { status: 'SNOOZED', snoozedUntil: null, dueDate: { lt: z.gunBasi } },
          ],
        },
      }),
      this.db.task.count({ where: { ...temel, dueDate: { gte: z.gunBasi, lte: z.haftaSonu } } }),
      this.db.task.count({ where: temel }),
      this.db.task.count({ where: { tenantId, isTemplate: false, tur: 'NOT', status: { notIn: ['DONE', 'CANCELLED'] } } }),
    ]);
    return { bugun, gecikmis, buHafta, acik, not };
  }

  /**
   * Açık "Sizden istenen" kalemleri — notifications: type AUTOMATION, metadata.automationId 'ekip:' ile başlar,
   * metadata.tur='istek', okunmamış ve metadata.kapandi yok (ekip-akis bildirimAcikMi ile aynı kural).
   * Postgres JSON süzgeci düşerse bellekte süzülür. Mükellef adı taxpayers'tan toplu çözülür.
   */
  private async acikEkipIstekleri(tenantId: string): Promise<Array<{ id: string; baslik: string; aciklama: string; taxpayerId: string | null; mukellefAd: string | null; vakaId: string | null; ajanId: string | null; createdAt: string }>> {
    const temel = { tenantId, type: 'AUTOMATION', isRead: false };
    let rows: any[] = [];
    try {
      rows = await this.db.notification.findMany({
        where: { ...temel, metadata: { path: ['tur'], equals: 'istek' } },
        orderBy: { createdAt: 'desc' },
        take: 300,
      });
    } catch (e: any) {
      this.logger.debug(`ajanda: istek JSON süzgeci düştü (${e?.message || e}); bellekte süzülüyor`);
      rows = await this.db.notification.findMany({ where: temel, orderBy: { createdAt: 'desc' }, take: 2000 }).catch(() => []);
    }
    const acik = rows.filter((r) => {
      const md = nesne(r?.metadata);
      return String(md.automationId || '').startsWith('ekip:') && bildirimTuru(r) === 'istek' && bildirimAcikMi(r);
    });
    const tpIdler = Array.from(new Set(acik.map((r) => nesne(r.metadata).taxpayerId).filter((x): x is string => typeof x === 'string' && !!x)));
    const adlar = new Map<string, string>();
    if (tpIdler.length) {
      const tps: any[] = await this.db.taxpayer
        .findMany({ where: { tenantId, id: { in: tpIdler } }, select: { id: true, companyName: true, firstName: true, lastName: true } })
        .catch(() => []);
      for (const t of tps) {
        const ad = mukellefAdi(t);
        if (ad) adlar.set(t.id, ad);
      }
    }
    return acik.map((r) => {
      const md = nesne(r.metadata);
      const tpId = typeof md.taxpayerId === 'string' && md.taxpayerId ? md.taxpayerId : null;
      return {
        id: r.id,
        baslik: String(r.title || '').slice(0, 200),
        aciklama: String(r.body || ''),
        taxpayerId: tpId,
        mukellefAd: tpId ? adlar.get(tpId) ?? null : null,
        vakaId: typeof md.vakaId === 'string' && md.vakaId ? md.vakaId : null,
        ajanId: typeof md.ajanId === 'string' && md.ajanId ? md.ajanId : null,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt || ''),
      };
    });
  }

  // ─── TOPLU İŞLEM ───

  /** POST /tasks/toplu — yalnız bu tenant'ın kayıtları etkilenir (updateMany/deleteMany where tenantId). */
  async toplu(tenantId: string, userId: string, dto: TopluDto): Promise<{ ok: boolean; etkilenen: number }> {
    const ids = Array.from(new Set((Array.isArray(dto?.ids) ? dto.ids : []).map((x) => String(x || '').trim()).filter(Boolean))).slice(0, 500);
    if (!ids.length) throw new BadRequestException('ids boş olamaz');
    const islem = String(dto?.islem || '') as TopluIslem;
    if (!TOPLU_ISLEMLER.includes(islem)) throw new BadRequestException(`islem şunlardan biri olmalı: ${TOPLU_ISLEMLER.join(', ')}`);

    const where = { id: { in: ids }, tenantId };
    if (islem === 'sil') {
      const r = await this.db.task.deleteMany({ where });
      return { ok: true, etkilenen: Number(r?.count) || 0 };
    }

    let data: any;
    switch (islem) {
      case 'tamamla':
        data = { status: 'DONE', completedAt: new Date(), completedById: userId };
        break;
      case 'yeniden-ac':
        data = { status: 'OPEN', completedAt: null, completedById: null, snoozedUntil: null };
        break;
      case 'ertele': {
        const until = dto.until ? new Date(dto.until) : null;
        if (!until || Number.isNaN(until.getTime())) throw new BadRequestException('ertele için geçerli until (ISO tarih) gerekli');
        data = { status: 'SNOOZED', snoozedUntil: until };
        break;
      }
      case 'iptal':
        data = { status: 'CANCELLED' };
        break;
      case 'kategori': {
        if (dto.category === undefined) throw new BadRequestException('kategori için category gerekli');
        const category = String(dto.category ?? '').trim();
        data = { category: category || null };
        break;
      }
      case 'oncelik': {
        const priority = String(dto.priority || '').toUpperCase();
        if (!(ONCELIKLER as readonly string[]).includes(priority)) throw new BadRequestException(`priority şunlardan biri olmalı: ${ONCELIKLER.join(', ')}`);
        data = { priority };
        break;
      }
      case 'sabitle':
        data = { pinned: true };
        break;
      case 'sabit-kaldir':
        data = { pinned: false };
        break;
    }
    const r = await this.db.task.updateMany({ where, data });
    return { ok: true, etkilenen: Number(r?.count) || 0 };
  }

  // ─── EKİBE VER (Koordinatör koşusu, arka plan) ───

  /**
   * POST /tasks/:id/ekibe-ver — görevi Koordinatör'e verir (ajanBaslat kalıbı: 'baslangic' olayından isId ≤3 sn beklenir).
   * Görev: başlık + açıklama + "Mükellef: <ad> (taxpayerId: <id>)". dryRun = !canli, kaynak 'portal', gorevId = görev.
   * Aynı görevde koşan/bekleyen iş varsa (ekipIsId → agent_commands pending/running) reddedilir.
   * Başarıda: ekipIsId, status IN_PROGRESS, TaskNote "Ekibe verildi (kuru test|canlı) — iş <isId>".
   * Koşu bitince raporu runner göreve not olarak düşer (gorevNotuDus); görev durumu DEĞİŞMEZ.
   */
  async ekibeVer(tenantId: string, userId: string, taskId: string, canli = false): Promise<{ ok: boolean; isId?: string | null; error?: string }> {
    const task = await this.db.task.findFirst({ where: { id: taskId, tenantId }, include: TasksService.TEMEL_INCLUDE });
    if (!task) throw new NotFoundException('Görev bulunamadı');

    if (task.ekipIsId) {
      const is = await this.db.agentCommand
        .findFirst({ where: { id: task.ekipIsId, tenantId }, select: { id: true, status: true } })
        .catch(() => null);
      if (is && (is.status === 'running' || is.status === 'pending')) {
        return { ok: false, error: 'Bu görev için ekip zaten çalışıyor' };
      }
    }

    const ad = mukellefAdi(task.taxpayer);
    const gorev = [
      String(task.title || '').trim(),
      String(task.description || '').trim().slice(0, 4000), // prompt boyutu için tavan
      task.taxpayerId ? `Mükellef: ${ad || '-'} (taxpayerId: ${task.taxpayerId})` : '',
    ]
      .filter(Boolean)
      .join('\n');
    if (!gorev) return { ok: false, error: 'Görev metni boş' };

    const kuru = canli !== true;
    const baslangic = await new Promise<{ isId?: string; hata?: string }>((resolve) => {
      let cozuldu = false;
      const bitir = (v: { isId?: string; hata?: string }) => {
        if (cozuldu) return;
        cozuldu = true;
        resolve(v);
      };
      const zamanlayici = setTimeout(() => bitir({}), EKIBE_VER_ISID_BEKLEME_MS);
      (zamanlayici as any).unref?.();
      this.runner
        .calistir({
          ajanId: 'koordinator',
          gorev,
          tenantId,
          userId,
          taxpayerId: task.taxpayerId || null,
          dryRun: kuru,
          kaynak: 'portal',
          gorevId: task.id,
          emit: (e) => {
            if (e.type === 'baslangic') bitir({ isId: e.isId });
            else if (e.type === 'error' && !cozuldu) bitir({ hata: e.error });
          },
        })
        .catch((e: any) => {
          this.logger.warn(`ekibe ver ${task.id} arka plan koşusu hata: ${e?.message || e}`);
          bitir({ hata: e?.message || String(e) });
        });
    });
    if (baslangic.hata) return { ok: false, error: `Ekip başlatılamadı: ${baslangic.hata}` };

    const isId = baslangic.isId || null;
    await this.db.task.update({ where: { id: task.id }, data: { ekipIsId: isId, status: 'IN_PROGRESS' } });
    await this.db.taskNote
      .create({ data: { taskId: task.id, userId, content: `Ekibe verildi (${kuru ? 'kuru test' : 'canlı'}) — iş ${isId || '(kimlik alınamadı)'}` } })
      .catch((e: any) => this.logger.warn(`ekibe ver ${task.id} not yazılamadı: ${e?.message || e}`));
    return { ok: true, isId };
  }

  // ─── TAKVİMDEN GÖREV ───

  /**
   * POST /tasks/takvimden — vergi takvimi kaydından görev: kaynak TAKVIM, başlık "<açıklama> — <dönem>",
   * vade = takvim tarihi (dueDate verilirse o), category BEYANNAME, priority HIGH.
   */
  async takvimdenOlustur(tenantId: string, userId: string, dto: TakvimdenDto) {
    const takvimId = String(dto?.taxCalendarId || '').trim();
    if (!takvimId) throw new BadRequestException('taxCalendarId gerekli');
    const cal = await this.db.taxCalendar.findUnique({ where: { id: takvimId } });
    if (!cal) throw new NotFoundException('Takvim kaydı bulunamadı');

    let taxpayerId: string | null = String(dto.taxpayerId || '').trim() || null;
    if (taxpayerId) {
      const tp = await this.db.taxpayer.findFirst({ where: { id: taxpayerId, tenantId }, select: { id: true } });
      if (!tp) throw new NotFoundException('Mükellef bulunamadı');
      taxpayerId = tp.id;
    }

    const dueDate = dto.dueDate ? new Date(dto.dueDate) : new Date(cal.dueDate);
    if (Number.isNaN(dueDate.getTime())) throw new BadRequestException('dueDate geçersiz');
    const dueTime = String(dto.dueTime || '').trim() || null;
    const ad = String(cal.description || '').trim() || String(cal.declarationType || '');

    return this.db.task.create({
      data: {
        tenantId,
        title: `${ad} — ${takvimDonemi(cal)}`,
        description: null,
        category: 'BEYANNAME',
        priority: 'HIGH',
        tags: [],
        taxpayerId,
        createdById: userId,
        dueDate,
        dueTime,
        allDay: !dueTime,
        kaynak: 'TAKVIM',
        tur: 'GOREV',
        taxCalendarId: cal.id,
        notifyInApp: true,
        notifyBrowser: true,
        notifyWhatsapp: true,
        notifyPush: true,
      },
      include: TasksService.TEMEL_INCLUDE,
    });
  }
}
