import { DocumentCategory } from '@mali-musavir/shared';
import { api } from './api';

export const documentsApi = {
  findAll: (params?: { category?: string; search?: string }) =>
    api.get('/documents', { params }).then((r) => r.data),

  findByTaxpayer: (taxpayerId: string, params?: { category?: string; search?: string }) =>
    api.get(`/documents/taxpayer/${taxpayerId}`, { params }).then((r) => r.data),

  findOne: (id: string) => api.get(`/documents/${id}`).then((r) => r.data),

  getDownloadUrl: (id: string, version?: number) =>
    api
      .get(`/documents/${id}/download`, { params: version ? { version } : {} })
      .then((r) => r.data),

  upload: async (payload: {
    taxpayerId: string;
    title: string;
    category: DocumentCategory;
    file: File;
    tags?: string[];
    onProgress?: (pct: number) => void;
  }) => {
    const formData = new FormData();
    formData.append('taxpayerId', payload.taxpayerId);
    formData.append('title', payload.title);
    formData.append('category', payload.category);
    formData.append('mimeType', payload.file.type || 'application/octet-stream');
    formData.append('originalName', payload.file.name);
    formData.append('tags', JSON.stringify(payload.tags || []));
    formData.append('file', payload.file);

    const doc = await api
      .post('/documents/upload/direct', formData, {
        onUploadProgress: (event) => {
          if (!event.total) {
            payload.onProgress?.(50);
            return;
          }
          const pct = Math.max(1, Math.min(99, Math.round((event.loaded / event.total) * 100)));
          payload.onProgress?.(pct);
        },
      })
      .then((r) => r.data);

    payload.onProgress?.(100);
    return doc;
  },

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
