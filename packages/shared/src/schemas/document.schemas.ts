import { z } from 'zod';
import { DocumentCategory } from '../types';

export const InitiateUploadSchema = z.object({
  taxpayerId: z.string().cuid(),
  title: z.string().min(1).max(255),
  category: z.nativeEnum(DocumentCategory).default(DocumentCategory.DIGER),
  mimeType: z.string().min(1),
  originalName: z.string().min(1).max(255),
  tags: z.array(z.string().max(50)).max(10).optional(),
});

export const ConfirmUploadSchema = z.object({
  s3Key: z.string().min(1),
});

export const UpdateDocumentSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  category: z.nativeEnum(DocumentCategory).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
});

export type InitiateUploadDto = z.infer<typeof InitiateUploadSchema>;
export type ConfirmUploadDto = z.infer<typeof ConfirmUploadSchema>;
export type UpdateDocumentDto = z.infer<typeof UpdateDocumentSchema>;
