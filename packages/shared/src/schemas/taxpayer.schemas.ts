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
  phone: z.string().optional().or(z.literal('')),
  address: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
});

export type CreateTaxpayerDto = z.infer<typeof CreateTaxpayerSchema>;
