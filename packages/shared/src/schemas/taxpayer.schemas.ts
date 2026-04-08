import { z } from 'zod';
import { TaxpayerType } from '../types';

export const CreateTaxpayerSchema = z.object({
  type: z.nativeEnum(TaxpayerType),
  firstName: z.string().min(2, 'En az 2 karakter').max(100).optional().or(z.literal('')),
  lastName: z.string().min(2, 'En az 2 karakter').max(100).optional().or(z.literal('')),
  companyName: z.string().min(2, 'En az 2 karakter').max(200).optional().or(z.literal('')),
  taxNumber: z.string()
    .min(10, 'VKN 10, TCKN 11 haneli olmalı')
    .max(11, 'VKN 10, TCKN 11 haneli olmalı')
    .regex(/^\d+$/, 'Sadece rakam giriniz'),
  taxOffice: z.string().min(2, 'Vergi dairesi zorunludur').max(100),
  email: z.string().email('Geçerli e-posta giriniz').optional().or(z.literal('')),
  emails: z.array(z.string().email().or(z.literal(''))).optional().default([]),
  phone: z.string().optional().or(z.literal('')),
  phones: z.array(z.string()).optional().default([]),
  address: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  evrakTeslimGunu: z.number().int().min(1).max(30).nullable().optional(),
  whatsappEvrakTalep: z.boolean().optional().default(false),
  whatsappEvrakGeldi: z.boolean().optional().default(false),
});

export type CreateTaxpayerDto = z.infer<typeof CreateTaxpayerSchema>;
