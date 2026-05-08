/**
 * Görevler & Hatırlatmalar API client
 * v1.36.74 Faz 1
 */
import { api } from './api';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'SNOOZED' | 'MISSED' | 'CANCELLED';

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
  status: TaskStatus;
  completedAt?: string | null;
  snoozedUntil?: string | null;
  escalationLevel: number;
  lastReminderAt?: string | null;
  createdAt: string;
  updatedAt: string;
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

export const tasksApi = {
  list: (params: Record<string, any> = {}) =>
    api.get('/tasks', { params }).then((r) => r.data as TaskListResponse),
  get: (id: string) => api.get(`/tasks/${id}`).then((r) => r.data as Task),
  counts: () => api.get('/tasks/counts').then((r) => r.data as TaskCounts),
  create: (dto: CreateTaskInput) => api.post('/tasks', dto).then((r) => r.data as Task),
  update: (id: string, dto: UpdateTaskInput) =>
    api.patch(`/tasks/${id}`, dto).then((r) => r.data as Task),
  complete: (id: string) => api.post(`/tasks/${id}/complete`).then((r) => r.data as Task),
  snooze: (id: string, until: string) =>
    api.post(`/tasks/${id}/snooze`, { until }).then((r) => r.data as Task),
  addNote: (id: string, content: string) =>
    api.post(`/tasks/${id}/notes`, { content }).then((r) => r.data),
  remove: (id: string) => api.delete(`/tasks/${id}`).then((r) => r.data),
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

export const STATUS_LABEL: Record<TaskStatus, string> = {
  OPEN: 'Açık',
  IN_PROGRESS: 'Devam Ediyor',
  DONE: 'Tamamlandı',
  SNOOZED: 'Ertelendi',
  MISSED: 'Kaçırıldı',
  CANCELLED: 'İptal',
};

export const CATEGORY_OPTIONS = [
  { value: 'BEYANNAME', label: 'Beyanname' },
  { value: 'BORDRO', label: 'Bordro' },
  { value: 'SGK', label: 'SGK' },
  { value: 'KDV', label: 'KDV Mutabakatı' },
  { value: 'MIHSAP', label: 'Mihsap' },
  { value: 'BANKA', label: 'Banka' },
  { value: 'OFIS', label: 'Ofis' },
  { value: 'MUKELLEF', label: 'Mükellef İletişim' },
  { value: 'BELGE', label: 'Belge Takibi' },
  { value: 'DIGER', label: 'Diğer' },
];

export const WEEKDAY_LABEL = ['Pzr', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

/** Vade durumu (today/overdue/upcoming) */
export function getDueStatus(task: Task): 'overdue' | 'today' | 'tomorrow' | 'thisWeek' | 'later' | 'none' {
  if (!task.dueDate) return 'none';
  const due = new Date(task.dueDate);
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setHours(23, 59, 59, 999);
  const tomorrow = new Date(startOfToday);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const endOfTomorrow = new Date(tomorrow);
  endOfTomorrow.setHours(23, 59, 59, 999);
  const endOfWeek = new Date(startOfToday);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  if (due < startOfToday) return 'overdue';
  if (due >= startOfToday && due <= endOfToday) return 'today';
  if (due > endOfToday && due <= endOfTomorrow) return 'tomorrow';
  if (due > endOfTomorrow && due <= endOfWeek) return 'thisWeek';
  return 'later';
}

export function formatDueDate(task: Task): string {
  if (!task.dueDate) return '';
  const d = new Date(task.dueDate);
  const dStr = d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
  if (task.allDay) return dStr;
  return `${dStr} ${task.dueTime || ''}`.trim();
}

export function taxpayerName(tp: Task['taxpayer']): string {
  if (!tp) return '';
  if (tp.companyName) return tp.companyName;
  return `${tp.firstName ?? ''} ${tp.lastName ?? ''}`.trim();
}
