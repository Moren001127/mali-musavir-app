import { api } from './api';
import { DocumentCategory } from '@mali-musavir/shared';

export const documentsApi = {
  /** Tüm evraklar (tenant geneli) */
  findAll: (params?: { category?: string; search?: string }) =>
    api.get('/documents', { params }).then((r) => r.data),

  /** Mükellef bazlı evraklar */
  findByTaxpayer: (taxpayerId: string, params?: { category?: string; search?: string }) =>
    api.get(`/documents/taxpayer/${taxpayerId}`, { params }).then((r) => r.data),

  /** Belge detayı */
  findOne: (id: string) => api.get(`/documents/${id}`).then((r) => r.data),

  /** İndirme URL'i */
  getDownloadUrl: (id: string, version?: number) =>
    api
      .get(`/documents/${id}/download`, { params: version ? { version } : {} })
      .then((r) => r.data),

  /**
   * Dosya yükleme (2 adım):
   * 1. presigned URL al  2. S3'e yükle  3. confirm
   */
  upload: async (payload: {
    taxpayerId: string;
    title: string;
    category: DocumentCategory;
    file: File;
    tags?: string[];
    onProgress?: (pct: number) => void;
  }) => {
    // Adım 1 — presigned URL al
    const { uploadUrl, s3Key } = await api
      .post('/documents/upload/initiate', {
        taxpayerId: payload.taxpayerId,
        title: payload.title,
        category: payload.category,
        mimeType: payload.file.type || 'application/octet-stream',
        originalName: payload.file.name,
        tags: payload.tags,
      })
      .then((r) => r.data);

    // Adım 2 — doğrudan S3/MinIO'ya yükle (CORS gerekli)
    await fetch(uploadUrl, {
      method: 'PUT',
      body: payload.file,
      headers: { 'Content-Type': payload.file.type || 'application/octet-stream' },
    });

    payload.onProgress?.(80);

    // Adım 3 — confirm
    const doc = await api
      .post('/documents/upload/confirm', {
        taxpayerId: payload.taxpayerId,
        title: payload.title,
        category: payload.category,
        mimeType: payload.file.type || 'application/octet-stream',
        originalName: payload.file.name,
        tags: payload.tags,
        s3Key,
      })
      .then((r) => r.data);

    payload.onProgress?.(100);
    return doc;
  },

  /** Yeni versiyon yükle */
  uploadVersion: async (documentId: string, file: File, notes?: string) => {
    const { uploadUrl, s3Key } = await api
      .post(`/documents/${documentId}/versions/initiate`, {
        mimeType: file.type,
        originalName: file.name,
      })
      .then((r) => r.data);

    await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    });

    return api
      .post(`/documents/${documentId}/versions/confirm`, {
        s3Key,
        mimeType: file.type,
        notes,
      })
      .then((r) => r.data);
  },

  /** Meta güncelle */
  update: (id: string, dto: { title?: string; category?: string; tags?: string[] }) =>
    api.patch(`/documents/${id}`, dto).then((r) => r.data),

  /** Soft delete */
  remove: (id: string) => api.delete(`/documents/${id}`).then((r) => r.data),
};
