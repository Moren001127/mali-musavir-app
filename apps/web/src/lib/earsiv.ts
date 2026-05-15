import { api } from './api';

export type EarsivTip = 'SATIS' | 'ALIS';
export type BelgeKaynak = 'EFATURA' | 'EARSIV';

export interface EarsivFatura {
  id: string;
  tip: EarsivTip;
  belgeKaynak?: BelgeKaynak;
  donem: string;
  faturaNo: string;
  faturaTarihi: string;
  ettn?: string | null;
  satici?: string | null;
  saticiVergiNo?: string | null;
  alici?: string | null;
  aliciVergiNo?: string | null;
  matrah?: string | number | null;
  kdvTutari?: string | number | null;
  kdvOrani?: string | number | null;
  toplamTutar?: string | number | null;
  paraBirimi?: string | null;
  durum?: string | null;
  taxpayerId: string;
  createdAt: string;
}

export interface LucaFetchJob {
  id: string;
  mukellefId?: string | null;
  donem?: string | null;
  tip?: string | null;
  status?: string | null;
  recordCount?: number | null;
  errorMsg?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export const earsivApi = {
  fetchFromLuca: (data: {
    mukellefId: string;
    donem: string;
    tip: EarsivTip;
    belgeKaynak?: BelgeKaynak;
  }) =>
    api
      .post('/earsiv/fetch-from-luca', data)
      .then((r) => r.data as { jobId: string; status: string }),

  getLucaJob: (jobId: string) =>
    api.get(`/earsiv/luca-job/${jobId}`).then((r) => r.data as { job: any }),

  listLucaJobs: (params?: { limit?: number; status?: string; tip?: string }) =>
    api.get('/luca/jobs', { params }).then((r) => r.data as LucaFetchJob[]),

  cancelLucaJob: (jobId: string) =>
    api.post(`/luca/jobs/${jobId}/cancel`).then((r) => r.data as any),

  list: (params: {
    taxpayerId?: string;
    donem?: string;
    tip?: EarsivTip;
    belgeKaynak?: BelgeKaynak;
    search?: string;
    page?: number;
    pageSize?: number;
  }) =>
    api.get('/earsiv/list', { params }).then((r) => r.data as {
      rows: EarsivFatura[];
      total: number;
      page: number;
      pageSize: number;
    }),

  getOne: (id: string) => api.get(`/earsiv/${id}`).then((r) => r.data),

  downloadBulk: (ids: string[]) =>
    api
      .post('/earsiv/download-bulk', { ids }, { responseType: 'blob' })
      .then((r) => r.data as Blob),

  uploadZip: (
    data: { taxpayerId: string; donem: string; tip: EarsivTip; belgeKaynak?: BelgeKaynak },
    file: File,
  ) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('taxpayerId', data.taxpayerId);
    fd.append('donem', data.donem);
    fd.append('tip', data.tip);
    if (data.belgeKaynak) fd.append('belgeKaynak', data.belgeKaynak);
    return api
      .post('/earsiv/upload-zip', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then(
        (r) =>
          r.data as { inserted: number; skipped: number; total: number },
      );
  },
};

export function fmtTRY(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? parseFloat(n) : (n ?? 0);
  if (!isFinite(v as number)) return '0,00';
  return (v as number).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
