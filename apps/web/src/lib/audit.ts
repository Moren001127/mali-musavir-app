import { api } from './api';

export type AuditLogItem = {
  id: string;
  tenantId: string;
  userId: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  oldData: any;
  newData: any;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  } | null;
};

export type AuditFacets = {
  resources: Array<{ value: string; count: number }>;
  actions: Array<{ value: string; count: number }>;
  users: Array<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  }>;
};

export type AuditFilters = {
  userId?: string;
  resource?: string;
  action?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export const auditApi = {
  list: (filters: AuditFilters = {}) =>
    api
      .get('/audit-logs', { params: filters })
      .then(
        (r) =>
          r.data as {
            items: AuditLogItem[];
            total: number;
            limit: number;
            offset: number;
          },
      ),
  facets: () =>
    api.get('/audit-logs/facets').then((r) => r.data as AuditFacets),
  dailyStats: (days = 30) =>
    api
      .get('/audit-logs/daily-stats', { params: { days } })
      .then((r) => r.data as Array<{ day: string; count: number }>),
};

/** Türkçe label haritası — backend'den gelen ham değerleri okunabilir hale getir */
export const ACTION_LABELS: Record<string, string> = {
  CREATE: 'Oluşturma',
  UPDATE: 'Güncelleme',
  DELETE: 'Silme',
  LOGIN: 'Giriş',
  LOGOUT: 'Çıkış',
};

export const RESOURCE_LABELS: Record<string, string> = {
  taxpayers: 'Mükellef',
  documents: 'Evrak',
  invoices: 'Fatura',
  notifications: 'Bildirim',
  'kdv-control': 'KDV Kontrol',
  mizan: 'Mizan',
  'cari-kasa': 'Cari Kasa',
  'beyanname-takip': 'Beyanname Takip',
  'beyan-kayitlari': 'Beyanname Kayıtları',
  earsiv: 'E-Arşiv',
  galeri: 'Galeri',
  'fis-yazdirma': 'Fiş Yazdırma',
  'sms-templates': 'SMS Şablonu',
  'pending-decisions': 'Onay Kuyruğu',
  'vendor-memory': 'Firma Hafızası',
  users: 'Kullanıcı',
  auth: 'Auth',
  luca: 'Luca',
  mihsap: 'Mihsap',
  'moren-ai': 'Moren AI',
  whatsapp: 'WhatsApp',
};

export function actionLabel(a: string) {
  return ACTION_LABELS[a] || a;
}

export function resourceLabel(r: string) {
  return RESOURCE_LABELS[r] || r;
}

export function actionColor(a: string): string {
  switch (a) {
    case 'CREATE':
      return '#10b981';
    case 'UPDATE':
      return '#d4b876';
    case 'DELETE':
      return '#ef4444';
    case 'LOGIN':
      return '#3b82f6';
    case 'LOGOUT':
      return '#94a3b8';
    default:
      return '#94a3b8';
  }
}
