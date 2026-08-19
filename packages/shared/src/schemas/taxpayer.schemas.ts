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
  // E-postalar: her elemanı TRIM et, boş/boşluk olanları ELE. Eski/bozuk tek bir e-posta yüzünden
  //   mükellef güncellemesi (ör. NACE ekleme) engellenmesin — "emails.0: Invalid email" hatasının kökü.
  emails: z.preprocess(
    (v) => (Array.isArray(v) ? v.map((e) => String(e ?? '').trim()).filter((e) => e.length > 0) : []),
    z.array(z.string()).optional().default([]),
  ),
  phone: z.string().optional().or(z.literal('')),
  phones: z.array(z.string()).optional().default([]),
  /** REHBER: numara -> ad. Anahtar normalize numara ("905339233674"). */
  telefonAdlari: z.record(z.string(), z.string()).nullable().optional(),

  address: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  evrakTeslimGunu: z.number().int().min(1).max(30).nullable().optional(),
  whatsappEvrakTalep: z.boolean().optional().default(false),
  whatsappEvrakGeldi: z.boolean().optional().default(false),
  // E-Fatura mükellefi mi? (E-Arşiv/E-Fatura modüllerinde filtre olarak kullanılacak)
  isEFaturaMukellefi: z.boolean().optional().default(false),
  // Otomasyon ajanları için
  lucaSlug: z.string().optional().nullable(),
  mihsapId: z.string().optional().nullable(),
  mihsapDefterTuru: z.string().optional().nullable(),
  // Defter Türü — genel alan (Banka Takip ve diğer modüller için).
  // "BILANCO" → Bilanço esasında defter (Banka Takip listesinde görünür)
  // "ISLETME" → İşletme defteri (Banka Takip listesine girmez)
  defterTuru: z.enum(['BILANCO', 'ISLETME']).optional().nullable(),

  // === v1.37.0: Mükellef kartı genişletme (Hattat tarzı) ===
  logoUrl: z.string().url().optional().nullable().or(z.literal('')),
  naceKodu: z.string().max(20).optional().nullable().or(z.literal('')),
  faaliyetAciklama: z.string().max(300).optional().nullable().or(z.literal('')),
  ticaretSicilNo: z.string().max(50).optional().nullable().or(z.literal('')),
  mersisNo: z.string().max(20).optional().nullable().or(z.literal('')),
  odaSicilNo: z.string().max(50).optional().nullable().or(z.literal('')),
  bagkurSicilNo: z.string().max(50).optional().nullable().or(z.literal('')),
  kepAdresi: z.string().email('Geçerli KEP adresi giriniz').optional().nullable().or(z.literal('')),
  webSitesi: z.string().optional().nullable().or(z.literal('')),
  eFaturaEntegrator: z.string().max(50).optional().nullable().or(z.literal('')),
});

export type CreateTaxpayerDto = z.infer<typeof CreateTaxpayerSchema>;

export const UpdateTaxpayerSchema = z.object({
  type: z.nativeEnum(TaxpayerType).optional(),
  firstName: z.string().min(2, 'En az 2 karakter').max(100).optional().or(z.literal('')),
  lastName: z.string().min(2, 'En az 2 karakter').max(100).optional().or(z.literal('')),
  companyName: z.string().min(2, 'En az 2 karakter').max(200).optional().or(z.literal('')),
  taxNumber: z.string()
    .min(10, 'VKN 10, TCKN 11 haneli olmali')
    .max(11, 'VKN 10, TCKN 11 haneli olmali')
    .regex(/^\d+$/, 'Sadece rakam giriniz')
    .optional(),
  taxOffice: z.string().min(2, 'Vergi dairesi zorunludur').max(100).optional(),
  email: z.string().email('Gecerli e-posta giriniz').optional().or(z.literal('')),
  // E-postalar: trim + boşları ele; geçersiz eski veri güncellemeyi engellemesin. Gönderilmezse
  //   (undefined) dokunma (mevcut e-postaları silme).
  emails: z.preprocess(
    (v) => (v === undefined ? undefined : Array.isArray(v) ? v.map((e) => String(e ?? '').trim()).filter((e) => e.length > 0) : []),
    z.array(z.string()).optional(),
  ),
  phone: z.string().optional().or(z.literal('')),
  phones: z.array(z.string()).optional(),
  /** REHBER: numara -> ad. Anahtar normalize numara ("905339233674"). */
  telefonAdlari: z.record(z.string(), z.string()).nullable().optional(),

  address: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  evrakTeslimGunu: z.number().int().min(1).max(30).nullable().optional(),
  whatsappEvrakTalep: z.boolean().optional(),
  whatsappEvrakGeldi: z.boolean().optional(),
  isEFaturaMukellefi: z.boolean().optional(),
  isActive: z.boolean().optional(),
  lucaSlug: z.string().optional().nullable(),
  mihsapId: z.string().optional().nullable(),
  mihsapDefterTuru: z.string().optional().nullable(),
  defterTuru: z.enum(['BILANCO', 'ISLETME']).optional().nullable(),
  logoUrl: z.string().url().optional().nullable().or(z.literal('')),
  naceKodu: z.string().max(20).optional().nullable().or(z.literal('')),
  faaliyetAciklama: z.string().max(300).optional().nullable().or(z.literal('')),
  ticaretSicilNo: z.string().max(50).optional().nullable().or(z.literal('')),
  mersisNo: z.string().max(20).optional().nullable().or(z.literal('')),
  odaSicilNo: z.string().max(50).optional().nullable().or(z.literal('')),
  bagkurSicilNo: z.string().max(50).optional().nullable().or(z.literal('')),
  kepAdresi: z.string().email('Gecerli KEP adresi giriniz').optional().nullable().or(z.literal('')),
  webSitesi: z.string().optional().nullable().or(z.literal('')),
  eFaturaEntegrator: z.string().max(50).optional().nullable().or(z.literal('')),
}).strict();

export type UpdateTaxpayerDto = z.infer<typeof UpdateTaxpayerSchema>;

// ============================================================
// v1.37.0: TaxpayerYetkili (firma yetkilileri) şemaları
// ============================================================
export const CreateTaxpayerYetkiliSchema = z.object({
  firstName: z.string().min(2, 'Ad en az 2 karakter').max(100),
  lastName: z.string().min(2, 'Soyad en az 2 karakter').max(100),
  tcNo: z.string().regex(/^\d{11}$/, 'TC No 11 haneli olmalı').optional().nullable().or(z.literal('')),
  gorev: z.string().max(100).optional().nullable().or(z.literal('')),
  telefon: z.string().max(50).optional().nullable().or(z.literal('')),
  eposta: z.string().email('Geçerli e-posta giriniz').optional().nullable().or(z.literal('')),
  notes: z.string().max(500).optional().nullable().or(z.literal('')),
  isPrimary: z.boolean().optional().default(false),
});
export type CreateTaxpayerYetkiliDto = z.infer<typeof CreateTaxpayerYetkiliSchema>;

export const UpdateTaxpayerYetkiliSchema = CreateTaxpayerYetkiliSchema.partial();
export type UpdateTaxpayerYetkiliDto = z.infer<typeof UpdateTaxpayerYetkiliSchema>;
