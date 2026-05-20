import { api } from './api';

export type AutomationTriggerType = 'CRON' | 'EVENT' | 'WEBHOOK' | 'MANUAL';
export type AutomationStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ERROR' | 'ARCHIVED';

export interface ParsedAutomation {
  title: string;
  description: string;
  humanReadablePreview: string;
  triggerType: AutomationTriggerType;
  triggerConfig: Record<string, unknown>;
  steps: { schemaVersion: 1; steps: any[] };
  estimatedCostPerRun: number;
  privacyNotice?: string;
  confidence: number;
  meta: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    parseCostUsd: number;
  };
}

export interface Automation {
  id: string;
  tenantId: string;
  createdById: string;
  prompt: string;
  title: string;
  description: string | null;
  triggerType: AutomationTriggerType;
  triggerConfig: Record<string, unknown>;
  steps: any;
  status: AutomationStatus;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  nextRunAt: string | null;
  totalRuns: number;
  successRuns: number;
  failureRuns: number;
  failurePolicy: string;
  estimatedCostPerRun: number | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: { id: string; firstName: string; lastName: string; email: string };
  _count?: { runs: number };
}

export interface ListResponse {
  items: Automation[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const automationsApi = {
  /** Cümleyi parse et — kaydetmez, sadece öneri döner */
  async parse(prompt: string): Promise<ParsedAutomation> {
    const { data } = await api.post('/automations/parse', { prompt });
    return data;
  },

  /** Önizleme onaylandıktan sonra gerçekten kaydet */
  async create(payload: {
    prompt: string;
    title: string;
    description?: string;
    triggerType: AutomationTriggerType;
    triggerConfig: Record<string, unknown>;
    steps: any;
    failurePolicy?: string;
  }): Promise<Automation> {
    const { data } = await api.post('/automations', payload);
    return data;
  },

  async list(filters?: {
    status?: AutomationStatus;
    triggerType?: AutomationTriggerType;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<ListResponse> {
    const { data } = await api.get('/automations', { params: filters });
    return data;
  },

  async getOne(id: string): Promise<Automation> {
    const { data } = await api.get(`/automations/${id}`);
    return data;
  },

  async setStatus(id: string, status: AutomationStatus): Promise<Automation> {
    const { data } = await api.patch(`/automations/${id}/status`, { status });
    return data;
  },

  async archive(id: string): Promise<Automation> {
    const { data } = await api.delete(`/automations/${id}`);
    return data;
  },

  async getCatalog(): Promise<
    Array<{ name: string; category: string; description: string; estimatedClaudeCostPerCall: number }>
  > {
    const { data } = await api.get('/automations/catalog');
    return data;
  },

  /** Manuel "Şimdi Çalıştır" — gerçek aksiyon yapar */
  async runNow(id: string): Promise<{ runId: string; status: string; summary?: string }> {
    const { data } = await api.post(`/automations/${id}/run`);
    return data;
  },

  /** Dry-run — gerçek aksiyon yapmaz, sadece adımları logla */
  async dryRun(id: string): Promise<{ runId: string; status: string; summary?: string }> {
    const { data } = await api.post(`/automations/${id}/dry-run`);
    return data;
  },

  /** Otomasyonun son çalışmalarının listesi */
  async listRuns(id: string, limit = 20): Promise<AutomationRun[]> {
    const { data } = await api.get(`/automations/${id}/runs`, { params: { limit } });
    return data;
  },
};

export interface AutomationRun {
  id: string;
  automationId: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'failure' | 'partial';
  triggerPayload: any;
  stepLogs: Array<{
    stepId: string;
    tool: string;
    input?: unknown;
    output?: unknown;
    error?: string;
    ms: number;
    ts: string;
  }>;
  summary: string | null;
  errorMessage: string | null;
  costUsd: number | null;
}
