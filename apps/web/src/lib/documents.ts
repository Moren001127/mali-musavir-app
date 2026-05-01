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

  /** Meta güncelle (geçerlilik tarihi de buradan yenilenir) */
  update: (
    id: string,
    dto: {
      title?: string;
      category?: string;
      tags?: string[];
      expiresAt?: string | null;
      reminderDays?: number;
      notes?: string | null;
    },
  ) => api.patch(`/documents/${id}`, dto).then((r) => r.data),

  /** Geçerliliği biten / yakında bitecek belgeler */
  getExpiring: (params: {
    daysAhead?: number;
    includeExpired?: boolean;
    taxpayerId?: string;
  } = {}) =>
    api
      .get('/documents/expiring/all', {
        params: {
          daysAhead: params.daysAhead,
          includeExpired: params.includeExpired === false ? 'false' : 'true',
          taxpayerId: params.taxpayerId,
        },
      })
      .then((r) => r.data as Array<ExpiringDocument>),

  /** Soft delete */
  remove: (id: string) => api.delete(`/documents/${id}`).then((r) => r.data),
};

export type ExpiringDocument = {
  id: string;
  title: string;
  category: string;
  expiresAt: string;
  reminderDays: number;
  notes: string | null;
  daysLeft: number;
  status: 'EXPIRED' | 'EXPIRING_SOON';
  taxpayer: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
    taxNumber: string;
  };
};

export function expiringStatusColor(status: 'EXPIRED' | 'EXPIRING_SOON', daysLeft: number) {
  if (status === 'EXPIRED') return '#ef4444';
  if (daysLeft <= 7) return '#f59e0b';
  return '#3b82f6';
}

export function expiringStatusLabel(status: 'EXPIRED' | 'EXPIRING_SOON', daysLeft: number) {
  if (status === 'EXPIRED') {
    return daysLeft === 0 ? 'Bugün doldu' : `${Math.abs(daysLeft)} gün önce doldu`;
  }
  if (daysLeft === 0) return 'Bugün doluyor';
  if (daysLeft === 1) return 'Yarın doluyor';
  return `${daysLeft} gün kaldı`;
}
