import { api } from './api';

/** Luca otomatik scraper (backend Playwright) için credential API */
export interface LucaLoginResult {
  ok: boolean;
  needsCaptcha?: boolean;
  captchaImage?: string; // "data:image/png;base64,..."
  expiresInSec?: number;
  error?: string;
}
export const lucaCredentialApi = {
  /** Kayıtlı Luca hesabı var mı + son login durumu */
  status: () => api.get('/luca/credential').then((r) => r.data),
  /** Üye No + Kullanıcı Adı + Şifre kaydet (backend AES-GCM ile şifreler) */
  save: (uyeNo: string, username: string, password: string) =>
    api.post('/luca/credential', { uyeNo, username, password }).then((r) => r.data),
  /** Kayıtlı hesabı sil */
  remove: () => api.delete('/luca/credential').then((r) => r.data),
  /** Luca'ya login başlat — backend Playwright açar, CAPTCHA varsa resmini döner */
  test: () =>
    api.post('/luca/credential/test').then((r) => r.data as LucaLoginResult),
  /** CAPTCHA çözümünü gönder — yanlışsa yeni CAPTCHA resmi döner */
  submitCaptcha: (captchaText: string) =>
    api.post('/luca/credential/captcha', { captchaText }).then((r) => r.data as LucaLoginResult),
  /** Bekleyen CAPTCHA login oturumunu iptal et */
  cancel: () => api.post('/luca/credential/cancel').then((r) => r.data),
};

export const kdvApi = {
  /* ── OTURUMLAR ── */
  getSessions: () => api.get('/kdv-control/sessions').then((r) => r.data),
  getSession: (id: string) => api.get(`/kdv-control/sessions/${id}`).then((r) => r.data),
  deleteSession: (id: string) => api.delete(`/kdv-control/sessions/${id}`).then((r) => r.data),
  getStats: (id: string) => api.get(`/kdv-control/sessions/${id}/stats`).then((r) => r.data),
  createSession: (data: { type: string; periodLabel: string; taxpayerId?: string; notes?: string }) =>
    api.post('/kdv-control/sessions', data).then((r) => r.data),
  findOrCreateSession: (data: { type: string; periodLabel: string; taxpayerId?: string; notes?: string }) =>
    api.post('/kdv-control/sessions/find-or-create', data).then((r) => r.data as { session: any; created: boolean }),
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

  /* ── OTOMATİK ÇEKİM (LUCA + MIHSAP) ── */
  /** Luca'dan 191/391 veya işletme defteri verisini otomatik çekmek için
   *  bir fetch job oluşturur. Luca sayfasında açık runner bu job'u işler. */
  importFromLuca: (sessionId: string) =>
    api.post(`/kdv-control/sessions/${sessionId}/import-from-luca`).then((r) => r.data),

  /** Portal veritabanında kayıtlı (daha önce Mihsap'tan çekilmiş) faturaları
   *  bu kontrol oturumuna görsel olarak bağlar. Mihsap'a yeniden gitmez. */
  linkMihsapInvoices: (sessionId: string) =>
    api.post(`/kdv-control/sessions/${sessionId}/link-mihsap-invoices`).then((r) => r.data),

  /** Oturumdaki bekleyen tüm görsellerin OCR'ını başlatır. */
  startOcr: (sessionId: string) =>
    api.post(`/kdv-control/sessions/${sessionId}/start-ocr`).then((r) => r.data),

  /* ── EŞLEŞTİRME ── */
  reconcile: (sessionId: string) =>
    api.post(`/kdv-control/sessions/${sessionId}/reconcile`).then((r) => r.data),

  getResults: (sessionId: string) =>
    api.get(`/kdv-control/sessions/${sessionId}/results`).then((r) => r.data),

  exportExcel: (sessionId: string) =>
    api.get(`/kdv-control/sessions/${sessionId}/export-excel`, { responseType: 'arraybuffer' }).then((r) => r.data),

  resolveResult: (resultId: string, action: 'CONFIRMED' | 'REJECTED', notes?: string) =>
    api.patch(`/kdv-control/results/${resultId}/resolve`, { action, notes }).then((r) => r.data),

  /* ── ÇIKTI ARŞİVİ ── */
  /** Tüm KDV kontrol çıktıları (bayt içeriği hariç) */
  listOutputs: () =>
    api.get('/kdv-control/outputs').then((r) => r.data),

  /** Kayıtlı bir çıktıyı indir (arraybuffer) */
  downloadOutput: (outputId: string) =>
    api.get(`/kdv-control/outputs/${outputId}/download`, { responseType: 'arraybuffer' }).then((r) => r.data),

  /** Kayıtlı bir çıktıyı sil */
  deleteOutput: (outputId: string) =>
    api.delete(`/kdv-control/outputs/${outputId}`).then((r) => r.data),
};
