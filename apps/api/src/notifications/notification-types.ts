/**
 * Tüm in-app notification tiplerinin merkezi tanımı.
 * Yeni bir tip eklerken:
 *   1) Bu enum'a ekle
 *   2) apps/web/src/app/(panel)/panel/bildirimler/page.tsx içindeki
 *      TYPE_LABELS + typeMeta + notificationHref'i güncelle
 *   3) Modülün ilgili kod noktasında NotificationsService.create()
 *      veya helper'larını çağır (notificationsService.createForTenant vb.)
 */
export const NOTIFICATION_TYPES = {
  // === Mevcut/Aktif ===
  WHATSAPP: 'WHATSAPP',
  OFFICE_CHAT: 'OFFICE_CHAT',
  AUTOMATION: 'AUTOMATION',
  AI: 'AI',
  AI_PROPOSAL: 'AI_PROPOSAL',
  AI_COST_LIMIT: 'AI_COST_LIMIT',
  MOREN_AI_ALERT: 'MOREN_AI_ALERT',
  E_TEBLIGAT: 'E_TEBLIGAT',

  // === Yeni: Kritik (Sprint 1) ===
  TASK_DUE: 'TASK_DUE',
  PORTAL_CREDENTIAL_FAIL: 'PORTAL_CREDENTIAL_FAIL',
  LUCA_SYNC_ERROR: 'LUCA_SYNC_ERROR',

  // === Yeni: Orta Öncelik (Sprint 2) ===
  TAX_DEADLINE: 'TAX_DEADLINE',
  KDV_RESULT: 'KDV_RESULT',
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  PENDING_DECISION: 'PENDING_DECISION',
  BANK_TRANSACTION_ALERT: 'BANK_TRANSACTION_ALERT',

  // === Yeni: Düşük Öncelik (Sprint 3) ===
  SYSTEM: 'SYSTEM',
  AGENT: 'AGENT',
  AUTH_NEW_DEVICE: 'AUTH_NEW_DEVICE',
  INVOICE_OVERDUE: 'INVOICE_OVERDUE',
  MIHSAP_RESULT: 'MIHSAP_RESULT',
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

/** Hangi tipler tenant geneli (userId=null) varsayılan olarak atılır? */
export const TENANT_WIDE_TYPES = new Set<NotificationType>([
  NOTIFICATION_TYPES.WHATSAPP,
  NOTIFICATION_TYPES.AI,
  NOTIFICATION_TYPES.E_TEBLIGAT,
  NOTIFICATION_TYPES.PORTAL_CREDENTIAL_FAIL,
  NOTIFICATION_TYPES.LUCA_SYNC_ERROR,
  NOTIFICATION_TYPES.SYSTEM,
  NOTIFICATION_TYPES.MOREN_AI_ALERT,
]);

/** Tip için varsayılan link (UI'da metadata.link override edebilir) */
export const DEFAULT_LINK_BY_TYPE: Partial<Record<NotificationType, string>> = {
  WHATSAPP: '/panel/mesajlar',
  OFFICE_CHAT: '/panel?officeChat=open',
  TASK_DUE: '/panel/gorevler',
  TAX_DEADLINE: '/panel/beyannameler',
  PORTAL_CREDENTIAL_FAIL: '/panel/ayarlar/entegrasyonlar',
  LUCA_SYNC_ERROR: '/panel/luca',
  KDV_RESULT: '/panel/kdv-kontrol',
  DOCUMENT_UPLOADED: '/panel/evraklar',
  PENDING_DECISION: '/panel/onay-bekleyen',
  BANK_TRANSACTION_ALERT: '/panel/banka-takip',
  E_TEBLIGAT: '/panel/beyannameler',
  AGENT: '/panel/ajanlar',
  AI: '/panel/moren-ai',
  AI_PROPOSAL: '/panel/moren-ai',
  AI_COST_LIMIT: '/panel/moren-ai',
  MOREN_AI_ALERT: '/panel/moren-ai',
  INVOICE_OVERDUE: '/panel/faturalar',
  MIHSAP_RESULT: '/panel/ajanlar/mihsap',
  SYSTEM: '/panel',
  AUTH_NEW_DEVICE: '/panel/ayarlar',
};
