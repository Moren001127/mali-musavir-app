import { api } from './api';

export type EDefterDonemTipi =
  | 'AYLIK'
  | 'GECICI_Q1'
  | 'GECICI_Q2'
  | 'GECICI_Q3'
  | 'GECICI_Q4'
  | 'YILLIK';

export type ManuelKaynak = 'MIZAN' | 'HAREKET';
export type ManuelKosul =
  | 'BAKIYE_YOK' | 'BAKIYE_VAR' | 'BORC_BAKIYE' | 'ALACAK_BAKIYE' | 'BAKIYE_USTUNDE' | 'BAKIYE_ALTINDA'
  | 'HAREKET_YOK' | 'HAREKET_VAR' | 'BORC_USTUNDE' | 'BORC_ALTINDA' | 'ALACAK_USTUNDE' | 'ALACAK_ALTINDA' | 'ADET_ALTINDA';
export type ManuelDonemKisiti = 'HEPSI' | 'YILLIK' | 'GECICI';
export type ManuelKuralGovde = {
  ad: string;
  aciklama?: string | null;
  seviye: 'ERROR' | 'WARN' | 'INFO';
  hesap: string;
  kaynak: ManuelKaynak;
  kosul: ManuelKosul;
  esik?: number | null;
  herHesapAyri: boolean;
  donemKisiti: ManuelDonemKisiti;
  aktif?: boolean;
};
export type ManuelKural = ManuelKuralGovde & { id: string; aktif: boolean; createdAt?: string; updatedAt?: string; createdBy?: string | null };

export const edefterControlApi = {
  list: (taxpayerId?: string) =>
    api
      .get('/edefter-control', { params: taxpayerId ? { taxpayerId } : {} })
      .then((r) => r.data),
  get: (id: string) => api.get(`/edefter-control/${id}`).then((r) => r.data),
  reanalyze: (id: string) => api.post(`/edefter-control/${id}/reanalyze`).then((r) => r.data),
  getRuleSettings: () =>
    api.get('/edefter-control/rule-settings').then((r) => r.data as {
      settings: Array<{ code: string; active: boolean; updatedAt?: string; updatedBy?: string | null }>;
      defaultDisabledCodes: string[];
      // Tek kural kataloğu (sunucu): kod, ad, açıklama, öneri, şiddet, alan, mevzuat, varsayılan açık/kapalı
      catalog?: Array<{
        kod: string; ad: string; aciklama: string; oneri?: string; siddet: 'ERROR' | 'WARN' | 'INFO'; alan: string;
        mevzuat?: string; varsayilanAktif: boolean; donemKisiti?: string; mizanGerekli?: boolean; motor?: 'ESKI' | 'HDD';
      }>;
    }),
  setRuleActive: (code: string, active: boolean) =>
    api.patch(`/edefter-control/rule-settings/${encodeURIComponent(code)}`, { active }).then((r) => r.data),
  // Manuel (ofis) kuralları — sunucuda saklanır, analizde çalışır (bulgu kodu MANUEL:<id>)
  manuelKurallar: {
    list: () => api.get('/edefter-control/manuel-kurallar').then((r) => r.data as ManuelKural[]),
    create: (body: ManuelKuralGovde) => api.post('/edefter-control/manuel-kurallar', body).then((r) => r.data as ManuelKural),
    update: (id: string, body: Partial<ManuelKuralGovde>) =>
      api.patch(`/edefter-control/manuel-kurallar/${encodeURIComponent(id)}`, body).then((r) => r.data as ManuelKural),
    remove: (id: string) => api.delete(`/edefter-control/manuel-kurallar/${encodeURIComponent(id)}`).then((r) => r.data),
  },
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
