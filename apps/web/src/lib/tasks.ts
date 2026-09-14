/**
 * Görevler & Notlar — API istemcisi + sözlükler
 * v1.36.74 Faz 1 → 2026-09-14 yeniden tasarım (ajanda / toplu işlem / ekibe ver / mali takvim / not türü)
 */
import { api } from './api';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'SNOOZED' | 'MISSED' | 'CANCELLED';
/** Kaydın nereden geldiği. */
export type TaskKaynak = 'MANUEL' | 'WHATSAPP' | 'BANKA' | 'EKIP' | 'AI' | 'TAKVIM';
/** Görev mi, serbest not mu. */
export type TaskTur = 'GOREV' | 'NOT';

export type RecurrenceType = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | 'CUSTOM';

export interface RecurrenceConfig {
  type: RecurrenceType;
  interval?: number;
  weekdays?: number[];        // [0..6] 0=Pazar
  monthDay?: number;          // 1..31, -1 = ayın son günü
  monthOrdinal?: 'FIRST' | 'SECOND' | 'THIRD' | 'FOURTH' | 'LAST';
  monthOrdinalDay?: number;
  yearMonth?: number;
  yearDay?: number;
  endDate?: string;
  count?: number;
}

export interface ReminderConfig {
  beforeOffsets?: Array<{ minutes?: number; hours?: number; days?: number; weeks?: number }>;
  overdueEscalation?: {
    enabled: boolean;
    intervals: number[];   // dakika cinsinden
    notifyMaliMusavirAfter?: number;
  };
  workingHours?: {
    start: string; end: string; weekdays: number[];
  };
}

export interface TaskNote {
  id: string;
  taskId: string;
  userId: string;
  content: string;
  createdAt: string;
  user?: { id: string; firstName?: string; lastName?: string };
}

export interface TaskAttachment {
  id: string;
  taskId: string;
  filename: string;
  s3Key?: string;
  size: number;
  mimeType?: string | null;
  createdAt: string;
}

export interface Task {
  id: string;
  tenantId: string;
  title: string;
  description?: string;
  category?: string;
  priority: TaskPriority;
  color?: string;
  tags: string[];
  taxpayerId?: string | null;
  taxpayer?: { id: string; firstName?: string; lastName?: string; companyName?: string };
  createdById: string;
  createdBy?: { id: string; firstName: string; lastName: string };
  dueDate?: string | null;
  dueTime?: string | null;
  allDay: boolean;
  recurrence?: RecurrenceConfig | null;
  parentTaskId?: string | null;
  isTemplate: boolean;
  reminderConfig?: ReminderConfig | null;
  notifyInApp: boolean;
  notifyEmail: boolean;
  notifyBrowser: boolean;
  notifySound: boolean;
  /** Telefon (mobil uygulama) bildirimi */
  notifyPush?: boolean;
  /** WhatsApp hatırlatması */
  notifyWhatsapp?: boolean;
  status: TaskStatus;
  completedAt?: string | null;
  snoozedUntil?: string | null;
  escalationLevel: number;
  lastReminderAt?: string | null;
  createdAt: string;
  updatedAt: string;
  // --- 2026-09-14 yeni alanlar ---
  kaynak?: TaskKaynak;
  tur?: TaskTur;
  pinned?: boolean;
  /** Ekibe verildiyse iş kimliği (Ekip konsolu) */
  ekipIsId?: string | null;
  /** Mali Takvim kaleminden üretildiyse */
  taxCalendarId?: string | null;
  /** Görev sahibine ek olarak hatırlatma gidecek ofis personeli (portal kullanıcı id'leri). */
  hatirlatUserIds?: string[];
  notes?: TaskNote[];
  attachments?: TaskAttachment[];
  _count?: { notes: number; attachments?: number };
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  category?: string;
  priority?: TaskPriority;
  color?: string;
  tags?: string[];
  taxpayerId?: string;
  dueDate?: string;
  dueTime?: string;
  allDay?: boolean;
  recurrence?: RecurrenceConfig | null;
  reminderConfig?: ReminderConfig | null;
  notifyInApp?: boolean;
  notifyEmail?: boolean;
  notifyBrowser?: boolean;
  notifySound?: boolean;
  notifyPush?: boolean;
  notifyWhatsapp?: boolean;
  kaynak?: TaskKaynak;
  tur?: TaskTur;
  pinned?: boolean;
  /** Ofis personeline de hatırlat — portal kullanıcı id'leri. */
  hatirlatUserIds?: string[];
}

export interface UpdateTaskInput extends Partial<CreateTaskInput> {
  status?: TaskStatus;
  snoozedUntil?: string;
}

export interface TaskListResponse {
  items: Task[];
  total: number;
  limit: number;
  offset: number;
}

export interface TaskCounts {
  today: number;
  overdue: number;
  thisWeek: number;
  totalOpen: number;
}

/** Ekip ajanlarının Muzaffer Bey'den istediği iş ("Sizden istenen"). */
export interface EkipIstek {
  id: string;
  baslik: string;
  aciklama?: string | null;
  taxpayerId?: string | null;
  mukellefAd?: string | null;
  vakaId?: string | null;
  ajanId?: string | null;
  createdAt: string;
}

/** Mali Takvim kalemi (beyanname son günü vb.). */
export interface TakvimKalemi {
  id: string;
  ad: string;
  tur: string;
  /** ISO tarih (son gün) */
  tarih: string;
  donem?: string | null;
  /** Bu kalemden zaten görev açılmış mı */
  gorevVar: boolean;
}

export interface AjandaSayaclar {
  bugun: number;
  gecikmis: number;
  buHafta: number;
  acik: number;
  istek: number;
  not: number;
}

export interface AjandaResponse {
  gorevler: Task[];
  notlar: Task[];
  ekipIstekler: EkipIstek[];
  takvim: TakvimKalemi[];
  sayaclar: AjandaSayaclar;
}

export interface AjandaParams {
  taxpayerId?: string;
  category?: string;
  priority?: string;
  kaynak?: string;
  tur?: string;
  search?: string;
  gun?: number;
}

export type TopluIslem =
  | 'tamamla'
  | 'yeniden-ac'
  | 'ertele'
  | 'sil'
  | 'iptal'
  | 'kategori'
  | 'oncelik'
  | 'sabitle'
  | 'sabit-kaldir';

export interface TopluInput {
  ids: string[];
  islem: TopluIslem;
  until?: string;
  category?: string;
  priority?: TaskPriority;
}

/** Ofisin aktif portal kullanıcısı — "Ofis personeline de hatırlat" seçeneği (GET /tasks/kisiler). */
export interface KisiSecenek {
  id: string;
  ad: string;
  rol: 'ADMIN' | 'STAFF' | string;
  /** WhatsApp telefonu kayıtlı mı (yoksa WhatsApp gidemez) */
  telefon: boolean;
  /** İstek yapan kullanıcı (görev sahibi — ayrıca seçilmez) */
  ben: boolean;
}

export const tasksApi = {
  list: (params: Record<string, any> = {}) =>
    api.get('/tasks', { params }).then((r) => r.data as TaskListResponse),
  get: (id: string) => api.get(`/tasks/${id}`).then((r) => r.data as Task),
  counts: () => api.get('/tasks/counts').then((r) => r.data as TaskCounts),
  /** Tek çağrıda ajanda: görevler + notlar + ekip istekleri + mali takvim + sayaçlar. */
  ajanda: (params: AjandaParams = {}) =>
    api.get('/tasks/ajanda', { params }).then((r) => r.data as AjandaResponse),
  create: (dto: CreateTaskInput) => api.post('/tasks', dto).then((r) => r.data as Task),
  update: (id: string, dto: UpdateTaskInput) =>
    api.patch(`/tasks/${id}`, dto).then((r) => r.data as Task),
  complete: (id: string) => api.post(`/tasks/${id}/complete`).then((r) => r.data as Task),
  snooze: (id: string, until: string) =>
    api.post(`/tasks/${id}/snooze`, { until }).then((r) => r.data as Task),
  addNote: (id: string, content: string) =>
    api.post(`/tasks/${id}/notes`, { content }).then((r) => r.data),
  remove: (id: string) => api.delete(`/tasks/${id}`).then((r) => r.data),
  /** Toplu işlem (seçili satırlar). */
  toplu: (dto: TopluInput) =>
    api.post('/tasks/toplu', dto).then((r) => r.data as { ok: boolean; etkilenen: number }),
  /** Görevi Ekip'e (yapay çalışan kadrosu) ver. canli=false → kuru test. */
  ekibeVer: (id: string, canli: boolean) =>
    api
      .post(`/tasks/${id}/ekibe-ver`, { canli })
      .then((r) => r.data as { ok: boolean; isId?: string; error?: string }),
  /** Mali Takvim kaleminden görev aç. */
  takvimden: (dto: { taxCalendarId: string; taxpayerId?: string; dueDate?: string; dueTime?: string }) =>
    api.post('/tasks/takvimden', dto).then((r) => r.data as Task),
  /** "Sizden istenen" ekip kalemini kapat (yapıldı). */
  ekipIstekKapat: (id: string) =>
    api.post(`/ekip/istek/${encodeURIComponent(id)}/kapat`, {}).then((r) => r.data as { ok: boolean }),
  /** Ofisin aktif portal kullanıcıları ("Ofis personeline de hatırlat" seçenekleri). */
  kisiler: () => api.get('/tasks/kisiler').then((r) => r.data as KisiSecenek[]),
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: 'Düşük',
  MEDIUM: 'Orta',
  HIGH: 'Yüksek',
  URGENT: 'ACİL',
};

export const PRIORITY_COLOR: Record<TaskPriority, string> = {
  LOW: '#94a3b8',     // gri
  MEDIUM: '#3b82f6',  // mavi
  HIGH: '#f59e0b',    // turuncu
  URGENT: '#ef4444',  // kırmızı
};

export const PRIORITY_ORDER: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  OPEN: 'Açık',
  IN_PROGRESS: 'Sürüyor',
  DONE: 'Bitti',
  SNOOZED: 'Ertelendi',
  MISSED: 'Kaçırıldı',
  CANCELLED: 'İptal',
};

export const STATUS_COLOR: Record<TaskStatus, string> = {
  OPEN: '#d4b876',
  IN_PROGRESS: '#3b82f6',
  DONE: '#22c55e',
  SNOOZED: '#a855f7',
  MISSED: '#ef4444',
  CANCELLED: '#94a3b8',
};

/** Kategori sözlüğü (2026-09-14). Seçenek olarak yalnız bunlar sunulur. */
export const CATEGORY_OPTIONS: Array<{ value: string; label: string; color: string }> = [
  { value: 'BEYANNAME', label: 'Beyanname', color: '#fbbf24' },
  { value: 'KDV_KONTROL', label: 'KDV Kontrol', color: '#60a5fa' },
  { value: 'EVRAK', label: 'Evrak', color: '#a78bfa' },
  { value: 'BANKA', label: 'Banka', color: '#22d3ee' },
  { value: 'TAHSILAT', label: 'Tahsilat', color: '#4ade80' },
  { value: 'MUKELLEF', label: 'Mükellef görüşmesi', color: '#f472b6' },
  { value: 'BORDRO', label: 'Bordro/SGK', color: '#fb923c' },
  { value: 'OFIS', label: 'Ofis', color: '#94a3b8' },
  { value: 'DIGER', label: 'Diğer', color: '#a3a3a3' },
];

/** Eski kayıtlarda kalmış kategori değerleri — listede etiketi gösterilir, seçenek olarak sunulmaz. */
export const ESKI_KATEGORI: Record<string, { label: string; color: string }> = {
  KDV: { label: 'KDV Mutabakatı', color: '#60a5fa' },
  MIHSAP: { label: 'Mihsap', color: '#a78bfa' },
  SGK: { label: 'SGK', color: '#fb923c' },
  BELGE: { label: 'Belge Takibi', color: '#a78bfa' },
};

export function kategoriEtiketi(value?: string | null): string {
  if (!value) return '';
  return CATEGORY_OPTIONS.find((c) => c.value === value)?.label || ESKI_KATEGORI[value]?.label || value;
}

export function kategoriRengi(value?: string | null): string {
  if (!value) return '#a3a3a3';
  return CATEGORY_OPTIONS.find((c) => c.value === value)?.color || ESKI_KATEGORI[value]?.color || '#a3a3a3';
}

/** Kaynak rozeti sözlüğü. */
export const KAYNAK_LABEL: Record<TaskKaynak, string> = {
  MANUEL: 'Elle',
  WHATSAPP: 'WhatsApp',
  BANKA: 'Banka',
  EKIP: 'Ekip',
  AI: 'AI',
  TAKVIM: 'Takvim',
};

export const KAYNAK_COLOR: Record<TaskKaynak, string> = {
  MANUEL: '#a3a3a3',
  WHATSAPP: '#4ade80',
  BANKA: '#22d3ee',
  EKIP: '#7dd3fc',
  AI: '#2dd4bf',
  TAKVIM: '#a78bfa',
};

export const KAYNAK_OPTIONS: Array<{ value: TaskKaynak; label: string }> = (
  ['MANUEL', 'BANKA', 'EKIP', 'TAKVIM', 'AI', 'WHATSAPP'] as TaskKaynak[]
).map((k) => ({ value: k, label: KAYNAK_LABEL[k] }));

export const WEEKDAY_LABEL = ['Pzr', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

export type DueStatus = 'overdue' | 'today' | 'tomorrow' | 'thisWeek' | 'later' | 'none';

/** Yerel takvime göre gün başlangıcı. */
export function gunBasi(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** İki tarih arasındaki tam gün farkı (b - a), yerel takvim. */
export function gunFarki(a: Date, b: Date): number {
  return Math.round((gunBasi(b).getTime() - gunBasi(a).getTime()) / 86_400_000);
}

/** Vade durumu — yerel takvim günü esas alınır (saat hesaba katılmaz). */
export function getDueStatusForDate(iso: string | null | undefined, simdi: Date = new Date()): DueStatus {
  if (!iso) return 'none';
  const due = new Date(iso);
  if (isNaN(due.getTime())) return 'none';
  const fark = gunFarki(simdi, due);
  if (fark < 0) return 'overdue';
  if (fark === 0) return 'today';
  if (fark === 1) return 'tomorrow';
  if (fark <= 7) return 'thisWeek';
  return 'later';
}

export function getDueStatus(task: Pick<Task, 'dueDate'>, simdi: Date = new Date()): DueStatus {
  return getDueStatusForDate(task.dueDate, simdi);
}

/** "14 Eyl" / "14 Eyl 10:00" */
export function formatDueDate(task: Pick<Task, 'dueDate' | 'dueTime' | 'allDay'>): string {
  if (!task.dueDate) return '';
  const d = new Date(task.dueDate);
  const dStr = d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
  if (task.allDay || !task.dueTime) return dStr;
  return `${dStr} ${task.dueTime}`.trim();
}

export function taxpayerName(tp: Task['taxpayer'] | null | undefined): string {
  if (!tp) return '';
  if (tp.companyName) return tp.companyName;
  return `${tp.firstName ?? ''} ${tp.lastName ?? ''}`.trim();
}

/** YYYY-MM-DD (yerel takvim). */
export function isoGun(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const g = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${g}`;
}

/** Bugünden n gün sonrasının YYYY-MM-DD karşılığı. */
export function gunEkle(n: number, simdi: Date = new Date()): string {
  const d = gunBasi(simdi);
  d.setDate(d.getDate() + n);
  return isoGun(d);
}
