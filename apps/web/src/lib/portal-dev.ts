import { api } from './api';

export type DevAgentId = 'eren' | 'melis' | 'seda' | 'okan' | 'berk';
export type TaskStatus = 'backlog' | 'in_progress' | 'in_review' | 'done' | 'cancelled';

export interface DevAgent {
  id: DevAgentId;
  displayName: string;
  role: string;
  model: string;
}

export interface DevTaskMessage {
  id: string;
  agent: string;
  content: string;
  ts: string;
}

export interface DevTask {
  id: string;
  tenantId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: 'high' | 'medium' | 'low';
  type: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  assignee: string | null;
  acceptance: string | null;
  proposedFiles: string[];
  proposedDiff: string | null;
  estimateHrs: number | null;
  createdAt: string;
  updatedAt: string;
  messages?: DevTaskMessage[];
}

export const portalDevApi = {
  agents: () => api.get<DevAgent[]>('/portal-dev/agents').then((r) => r.data),
  tasks: (status?: TaskStatus) =>
    api.get<DevTask[]>('/portal-dev/tasks', { params: status ? { status } : {} }).then((r) => r.data),
  task: (id: string) => api.get<DevTask>(`/portal-dev/tasks/${id}`).then((r) => r.data),
  create: (body: { title: string; description: string; priority?: string; type?: string }) =>
    api.post<DevTask>('/portal-dev/tasks', body).then((r) => r.data),
  setStatus: (id: string, status: TaskStatus) =>
    api.patch<DevTask>(`/portal-dev/tasks/${id}/status`, { status }).then((r) => r.data),
  runPlan: (id: string) => api.post<DevTask>(`/portal-dev/tasks/${id}/plan`).then((r) => r.data),
};
