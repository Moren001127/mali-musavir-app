import { api } from './api';

export const kdvApi = {
  /* ── OTURUMLAR ── */
  getSessions: () => api.get('/kdv-control/sessions').then((r) => r.data),
  getSession: (id: string) => api.get(`/kdv-control/sessions/${id}`).then((r) => r.data),
  getStats: (id: string) => api.get(`/kdv-control/sessions/${id}/stats`).then((r) => r.data),
  createSession: (data: { type: string; periodLabel: string; taxpayerId?: string; notes?: string }) =>
    api.post('/kdv-control/sessions', data).then((r) => r.data),
  completeSession: (id: string) =>
    api.patch(`/kdv-control/sessions/${id}/complete`).then((r) => r.data),

  /* ── EXCEL ── */
  uploadExcel: (sessionId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post(`/kdv-control/sessions/${sessionId}/excel`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
  getRecords: (sessionId: string) =>
    api.get(`/kdv-control/sessions/${sessionId}/records`).then((r) => r.data),

  /* ── GÖRSELLER ── */
  /**
   * Görselleri doğrudan backend'e multipart olarak yükler.
   * Presigned URL akışı yerine tek istekle çalışır.
   */
  uploadImages: async (
    sessionId: string,
    files: File[],
    onProgress?: (uploaded: number, total: number) => void,
  ) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('images', f, f.name));
    onProgress?.(0, files.length);
    const result = await api
      .post(`/kdv-control/sessions/${sessionId}/images/upload`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
    onProgress?.(result.uploaded ?? files.length, files.length);
    return result;
  },

  /** Tek görsel yükleme (geriye dönük uyumluluk için) */
  uploadImage: async (
    sessionId: string,
    file: File,
    onProgress?: (pct: number) => void,
  ) => {
    const fd = new FormData();
    fd.append('images', file, file.name);
    onProgress?.(30);
    const result = await api
      .post(`/kdv-control/sessions/${sessionId}/images/upload`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
    onProgress?.(100);
    return result;
  },

  getImages: (sessionId: string) =>
    api.get(`/kdv-control/sessions/${sessionId}/images`).then((r) => r.data),

  getImageUrl: (imageId: string) =>
    api.get(`/kdv-control/images/${imageId}/download`).then((r) => r.data),

  confirmOcr: (imageId: string, data: { belgeNo?: string; date?: string; kdvTutari?: string }) =>
    api.patch(`/kdv-control/images/${imageId}/confirm-ocr`, data).then((r) => r.data),

  deleteImage: (imageId: string) =>
    api.delete(`/kdv-control/images/${imageId}`).then((r) => r.data),

  /* ── EŞLEŞTİRME ── */
  reconcile: (sessionId: string) =>
    api.post(`/kdv-control/sessions/${sessionId}/reconcile`).then((r) => r.data),

  getResults: (sessionId: string) =>
    api.get(`/kdv-control/sessions/${sessionId}/results`).then((r) => r.data),

  resolveResult: (resultId: string, action: 'CONFIRMED' | 'REJECTED', notes?: string) =>
    api.patch(`/kdv-control/results/${resultId}/resolve`, { action, notes }).then((r) => r.data),
};
