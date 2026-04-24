import { api } from './api';

export type MizanDonemTipi =
  | 'AYLIK'
  | 'GECICI_Q1'
  | 'GECICI_Q2'
  | 'GECICI_Q3'
  | 'GECICI_Q4'
  | 'YILLIK';

export const mizanApi = {
  /* ── Mizan ── */
  list: (taxpayerId?: string) =>
    api
      .get('/mizan', { params: taxpayerId ? { taxpayerId } : {} })
      .then((r) => r.data),
  get: (id: string) => api.get(`/mizan/${id}`).then((r) => r.data),
  importFromLuca: (data: { taxpayerId: string; donem: string; donemTipi?: MizanDonemTipi }) =>
    api.post('/mizan/import', data).then((r) => r.data),
  // Extension-first Luca çekimi — moren-agent.js tarayıcıdaki açık Luca sekmesinden çekecek
  fetchFromLucaAgent: (data: { mukellefId: string; donem: string; donemTipi?: MizanDonemTipi }) =>
    api.post('/mizan/fetch-from-luca', data).then((r) => r.data as { jobId: string; status: string }),
  getLucaJob: (jobId: string) =>
    api.get(`/mizan/luca-job/${jobId}`).then((r) => r.data as { job: any; mizan: any }),
  uploadExcel: (
    data: { taxpayerId: string; donem: string; donemTipi?: MizanDonemTipi },
    file: File,
  ) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('taxpayerId', data.taxpayerId);
    fd.append('donem', data.donem);
    if (data.donemTipi) fd.append('donemTipi', data.donemTipi);
    return api
      .post('/mizan/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((r) => r.data);
  },
  analyze: (id: string) => api.post(`/mizan/${id}/analyze`).then((r) => r.data),
  lock: (id: string, note?: string) => api.patch(`/mizan/${id}/lock`, { note }).then((r) => r.data),
  unlock: (id: string, reason: string) => api.patch(`/mizan/${id}/unlock`, { reason }).then((r) => r.data),
  remove: (id: string) => api.delete(`/mizan/${id}`).then((r) => r.data),
};

export const gelirTablosuApi = {
  list: (taxpayerId?: string) =>
    api
      .get('/gelir-tablosu', { params: taxpayerId ? { taxpayerId } : {} })
      .then((r) => r.data),
  get: (id: string) => api.get(`/gelir-tablosu/${id}`).then((r) => r.data),
  generate: (data: { mizanId: string; donemTipi?: string }) =>
    api.post('/gelir-tablosu/generate', data).then((r) => r.data),
  exportExcel: (id: string) =>
    api
      .get(`/gelir-tablosu/${id}/export-excel`, { responseType: 'arraybuffer' })
      .then((r) => r.data),
  updateDuzeltmeler: (id: string, duzeltmeler: Record<string, number>) =>
    api.patch(`/gelir-tablosu/${id}/duzeltmeler`, { duzeltmeler }).then((r) => r.data),
  lock: (id: string, note?: string) => api.patch(`/gelir-tablosu/${id}/lock`, { note }).then((r) => r.data),
  unlock: (id: string, reason: string) => api.patch(`/gelir-tablosu/${id}/unlock`, { reason }).then((r) => r.data),
  remove: (id: string) => api.delete(`/gelir-tablosu/${id}`).then((r) => r.data),
};

export const bilancoApi = {
  list: (taxpayerId?: string) =>
    api
      .get('/bilanco', { params: taxpayerId ? { taxpayerId } : {} })
      .then((r) => r.data),
  get: (id: string) => api.get(`/bilanco/${id}`).then((r) => r.data),
  generate: (data: { mizanId: string; tarih?: string; donemTipi?: string }) =>
    api.post('/bilanco/generate', data).then((r) => r.data),
  updateDuzeltmeler: (id: string, duzeltmeler: Record<string, number>) =>
    api.patch(`/bilanco/${id}/duzeltmeler`, { duzeltmeler }).then((r) => r.data),
  lock: (id: string, note?: string) => api.patch(`/bilanco/${id}/lock`, { note }).then((r) => r.data),
  unlock: (id: string, reason: string) => api.patch(`/bilanco/${id}/unlock`, { reason }).then((r) => r.data),
  remove: (id: string) => api.delete(`/bilanco/${id}`).then((r) => r.data),
};

/** "1234567.89" veya number → "1.234.567,89" */
export function fmtTRY(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? parseFloat(n) : (n ?? 0);
  if (!isFinite(v)) return '0,00';
  return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Oran: 0.4087 → "%40,87" */
export function fmtPct(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  return '%' + (n * 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
