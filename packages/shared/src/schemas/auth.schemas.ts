import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email('Geçerli bir e-posta adresi girin'),
  password: z.string().min(8, 'Şifre en az 8 karakter olmalıdır'),
});

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
  firstName: z.string().min(2).max(50),
  lastName: z.string().min(2).max(50),
  tenantName: z.string().min(2).max(100),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string(),
});

export type LoginDto = z.infer<typeof LoginSchema>;
export type RegisterDto = z.infer<typeof RegisterSchema>;
export type RefreshTokenDto = z.infer<typeof RefreshTokenSchema>;
