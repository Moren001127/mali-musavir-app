import { z } from 'zod';
import { DocumentCategory } from '../types';

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/x-pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'text/plain',
  'text/csv',
  'text/html',
  'text/xml',
  'application/xml',
  'application/json',
  'application/zip',
  'application/x-zip-compressed',
  'application/gzip',
  'application/x-tar',
  'application/x-rar',
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'application/octet-stream',
  'application/rtf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.ms-excel.sheet.binary.macroenabled.12',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

const MimeTypeSchema = z.string().min(1).transform((value) => value.split(';')[0].trim().toLowerCase()).refine(
  (value) => (ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(value),
  'Desteklenmeyen dosya turu',
);

const S3KeySchema = z.string()
  .min(1)
  .max(512)
  .refine((value) => !value.includes('..') && !value.includes('\\') && !value.startsWith('/'), 'Gecersiz dosya anahtari')
  .refine((value) => /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(value), 'Gecersiz dosya anahtari');

export const InitiateUploadSchema = z.object({
  taxpayerId: z.string().cuid(),
  title: z.string().min(1).max(255),
  category: z.nativeEnum(DocumentCategory).default(DocumentCategory.DIGER),
  mimeType: MimeTypeSchema,
  originalName: z.string().min(1).max(255),
  tags: z.array(z.string().max(50)).max(10).optional(),
}).strict();

export const ConfirmUploadSchema = z.object({
  s3Key: S3KeySchema,
}).strict();

export const InitiateNewVersionSchema = z.object({
  mimeType: MimeTypeSchema,
  originalName: z.string().min(1).max(255),
}).strict();

export const ConfirmNewVersionSchema = z.object({
  s3Key: S3KeySchema,
  mimeType: MimeTypeSchema,
  notes: z.string().max(1000).optional(),
}).strict();

export const UpdateDocumentSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  category: z.nativeEnum(DocumentCategory).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  reminderDays: z.number().int().min(0).max(365).optional(),
  notes: z.string().max(1000).nullable().optional(),
}).strict();

export type InitiateUploadDto = z.infer<typeof InitiateUploadSchema>;
export type ConfirmUploadDto = z.infer<typeof ConfirmUploadSchema>;
export type InitiateNewVersionDto = z.infer<typeof InitiateNewVersionSchema>;
export type ConfirmNewVersionDto = z.infer<typeof ConfirmNewVersionSchema>;
export type UpdateDocumentDto = z.infer<typeof UpdateDocumentSchema>;
