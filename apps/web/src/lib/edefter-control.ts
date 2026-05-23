import { api } from './api';

export type EDefterDonemTipi =
  | 'AYLIK'
  | 'GECICI_Q1'
  | 'GECICI_Q2'
  | 'GECICI_Q3'
  | 'GECICI_Q4'
  | 'YILLIK';

export const edefterControlApi = {
  list: (taxpayerId?: string) =>
    api
      .get('/edefter-control', { params: taxpayerId ? { taxpayerId } : {} })
      .then((r) => r.data),
  get: (id: string) => api.get(`/edefter-control/${id}`).then((r) => r.data),
  fetchFromLucaAgent: (data: {
    mukellefId: string;
    donem: string;
    donemTipi?: EDefterDonemTipi;
    targetDeviceId?: string;
  }) => api.post('/edefter-control/fetch-from-luca', data).then((r) => r.data as {
    jobId: string;
    status: string;
    mizanJobId?: string | null;
    mizanStatus?: string | null;
  }),
  getLucaJob: (jobId: string) =>
    api.get(`/edefter-control/luca-job/${jobId}`).then((r) => r.data as {
      job: any;
      session: any;
      mizanJob?: any;
      mizan?: any;
    }),
  cancelLucaJob: (jobId: string) =>
    api.post(`/luca/jobs/${jobId}/cancel`).then((r) => r.data),
  uploadExcel: (
    data: { taxpayerId: string; donem: string; donemTipi?: EDefterDonemTipi },
    file: File,
  ) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('taxpayerId', data.taxpayerId);
    fd.append('donem', data.donem);
    if (data.donemTipi) fd.append('donemTipi', data.donemTipi);
    return api
      .post('/edefter-control/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((r) => r.data);
  },
  updateFindingStatus: (
    sessionId: string,
    findingId: string,
    body: { status: 'OPEN' | 'RESOLVED' | 'IGNORED'; note?: string | null },
  ) =>
    api
      .patch(`/edefter-control/${sessionId}/findings/${findingId}`, body)
      .then((r) => r.data),
  downloadExcel: async (sessionId: string) => {
    const res = await api.get(`/edefter-control/${sessionId}/export.xlsx`, {
      responseType: 'blob',
    });
    const blob = new Blob([res.data], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `edefter-bulgular-${sessionId}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
