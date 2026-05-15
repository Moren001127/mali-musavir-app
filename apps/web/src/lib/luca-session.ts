import { api } from './api';

export type LucaCaptchaChallenge = {
  id: string;
  jobId?: string | null;
  deviceId?: string | null;
  status: 'pending' | 'answered' | 'consumed' | 'expired' | 'cancelled';
  captchaImage?: string;
  context?: Record<string, any>;
  createdAt: string;
  expiresAt?: string | null;
  answeredAt?: string | null;
  consumedAt?: string | null;
};

export type LucaSessionManagerStatus = {
  credential: {
    saved: boolean;
    uyeNo?: string;
    username?: string;
    lastLoginAt?: string | null;
    lastError?: string | null;
    isActive?: boolean;
    updatedAt?: string;
  };
  session: {
    connected: boolean;
    email?: string | null;
    origin?: string | null;
    updatedAt?: string;
    tokenLength?: number;
  };
  devices: Array<{
    id?: string | null;
    running: boolean;
    lastPing: string;
    url?: string | null;
    version?: string | null;
  }>;
  activeChallenge?: LucaCaptchaChallenge | null;
};

export type LucaWorkerAccount = {
  id: string;
  displayName: string;
  uyeNo: string;
  username: string;
  hasPassword: boolean;
  isActive: boolean;
  maxConcurrency: number;
  sortOrder: number;
  lastLoginAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LucaWorkerAccountInput = {
  displayName: string;
  uyeNo: string;
  username: string;
  password?: string;
  isActive?: boolean;
  maxConcurrency?: number;
  sortOrder?: number;
};

export const lucaSessionApi = {
  status: () =>
    api.get('/luca/session-manager/status').then((r) => r.data as LucaSessionManagerStatus),
  challenges: () =>
    api.get('/luca/session-manager/captcha').then((r) => r.data as LucaCaptchaChallenge[]),
  answerCaptcha: (id: string, answer: string) =>
    api
      .post(`/luca/session-manager/captcha/${id}/answer`, { answer })
      .then((r) => r.data as LucaCaptchaChallenge),
  cancelCaptcha: (id: string) =>
    api
      .post(`/luca/session-manager/captcha/${id}/cancel`)
      .then((r) => r.data as LucaCaptchaChallenge),
  workerAccounts: () =>
    api.get('/luca/worker-accounts').then((r) => r.data as LucaWorkerAccount[]),
  createWorkerAccount: (input: LucaWorkerAccountInput) =>
    api.post('/luca/worker-accounts', input).then((r) => r.data as LucaWorkerAccount),
  updateWorkerAccount: (id: string, input: Partial<LucaWorkerAccountInput>) =>
    api.patch(`/luca/worker-accounts/${id}`, input).then((r) => r.data as LucaWorkerAccount),
  deleteWorkerAccount: (id: string) =>
    api.delete(`/luca/worker-accounts/${id}`).then((r) => r.data),
};
