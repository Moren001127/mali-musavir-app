import { api } from './api';

export type PendingActionStatus =
  | 'pending'
  | 'approved'
  | 'processing'
  | 'rejected'
  | 'expired'
  | 'applied'
  | 'failed';

export type PendingActionSource =
  | 'moren_ofis'
  | 'portal_dev'
  | 'mukellef_msg'
  | 'github_merge'
  | 'migration'
  | 'mobile';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface PendingAction {
  id: string;
  tenantId: string;
  source: PendingActionSource;
  sourceRef: string | null;
  type: string;
  title: string;
  summary: string;
  payload: any;
  riskLevel: RiskLevel;
  requestedByAgent: string | null;
  requestedByUserId: string | null;
  requestedAt: string;
  status: PendingActionStatus;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  appliedAt: string | null;
  errorMessage: string | null;
  expiresAt: string | null;
}

export const pendingActionsApi = {
  list: (params?: { status?: PendingActionStatus; source?: PendingActionSource; limit?: number }) =>
    api.get<PendingAction[]>('/pending-actions', { params }).then((r) => r.data),
  count: (status: PendingActionStatus = 'pending') =>
    api.get<{ count: number }>('/pending-actions/count', { params: { status } }).then((r) => r.data),
  getById: (id: string) =>
    api.get<PendingAction>(`/pending-actions/${id}`).then((r) => r.data),
  approve: (id: string, note?: string) =>
    api.patch<PendingAction>(`/pending-actions/${id}/approve`, { note }).then((r) => r.data),
  reject: (id: string, note?: string) =>
    api.patch<PendingAction>(`/pending-actions/${id}/reject`, { note }).then((r) => r.data),
  bulkApprove: (ids: string[], note?: string) =>
    api.post<{ affected: number }>('/pending-actions/bulk-approve', { ids, note }).then((r) => r.data),
  bulkReject: (ids: string[], note?: string) =>
    api.post<{ affected: number }>('/pending-actions/bulk-reject', { ids, note }).then((r) => r.data),
};
