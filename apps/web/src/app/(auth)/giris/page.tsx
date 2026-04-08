'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginSchema, LoginDto } from '@mali-musavir/shared';
import { useLogin } from '@/hooks/useAuth';
import Image from 'next/image';
import { Eye, EyeOff, Lock, Mail, TrendingUp, Shield, Zap } from 'lucide-react';
import { useState } from 'react';

const features = [
  { icon: TrendingUp, text: 'KDV kontrol ve muavin defter eşleştirme' },
  { icon: Shield,     text: 'KVKK uyumlu güvenli veri yönetimi' },
  { icon: Zap,        text: 'Otomatik fiş yazdırma ve arşivleme' },
];

export default function GirisPage() {
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginDto>({ resolver: zodResolver(LoginSchema) });

  const login = useLogin();

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--bg)' }}>
      {/* Sol — Brand Panel */}
      <div
        className="hidden lg:flex flex-col justify-between w-[46%] p-12 relative overflow-hidden"
        style={{ background: 'var(--navy)' }}
      >
        {/* Dekoratif arka plan deseni */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: `radial-gradient(circle at 25% 25%, white 1px, transparent 1px),
                              radial-gradient(circle at 75% 75%, white 1px, transparent 1px)`,
            backgroundSize: '48px 48px',
          }}
        />
        {/* Altın dekoratif daire */}
        <div
          className="absolute -bottom-24 -right-24 w-72 h-72 rounded-full opacity-10"
          style={{ background: 'var(--gold)' }}
        />
        <div
          className="absolute -top-12 -left-12 w-48 h-48 rounded-full opacity-5"
          style={{ background: 'var(--gold)' }}
        />

        {/* Logo */}
        <div className="relative z-10">
          <div
            className="w-16 h-16 rounded-2xl overflow-hidden flex items-center justify-center"
            style={{ border: '1px solid rgba(201,152,42,.4)', background: 'rgba(201,152,42,.12)' }}
          >
            <Image
              src="/brand/logo.jpg"
              alt="Moren Mali Müşavirlik"
              width={60}
              height={60}
              className="object-contain w-full h-full"
            />
          </div>
        </div>

        {/* Orta içerik */}
        <div className="relative z-10 space-y-8">
          <div>
            <h1
              className="text-3xl font-extrabold leading-tight text-white"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
            >
              Güvenilir finansal
              <br />
              <span style={{ color: 'var(--gold-light)' }}>yönetim merkezi</span>
            </h1>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,.55)' }}>
              Mükellef takibinden KDV kontrolüne, beyanname yönetiminden evrak arşivine kadar
              tüm mali müşavirlik süreçlerinizi tek platformda yönetin.
            </p>
          </div>

          <div className="space-y-3">
            {features.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(201,152,42,.18)' }}
                >
                  <Icon size={15} style={{ color: 'var(--gold-light)' }} />
                </div>
                <p className="text-sm" style={{ color: 'rgba(255,255,255,.65)' }}>{text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Alt */}
        <div className="relative z-10">
          <p className="text-xs" style={{ color: 'rgba(255,255,255,.25)' }}>
            © 2025 Moren Mali Müşavirlik · KVKK Uyumlu · v0.1.0
          </p>
        </div>
      </div>

      {/* Sağ — Form Paneli */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-[400px]">
          {/* Mobil logo */}
          <div className="lg:hidden flex justify-center mb-8">
            <Image src="/brand/logo.jpg" alt="Moren" width={64} height={64} className="object-contain rounded-xl" />
          </div>

          <div className="mb-8">
            <h2
              className="text-2xl font-extrabold"
              style={{ color: 'var(--text)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}
            >
              Hoş Geldiniz
            </h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
              Hesabınıza giriş yapın
            </p>
          </div>

          <form onSubmit={handleSubmit((d) => login.mutate(d))} className="space-y-4">
            {/* E-posta */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text)' }}>
                E-posta adresi
              </label>
              <div className="relative">
                <Mail
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--text-muted)' }}
                />
                <input
                  {...register('email')}
                  type="email"
                  className={`input-base pl-9 ${errors.email ? 'input-error' : ''}`}
                  placeholder="admin@moren.com"
                />
              </div>
              {errors.email && (
                <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>
              )}
            </div>

            {/* Şifre */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text)' }}>
                Şifre
              </label>
              <div className="relative">
                <Lock
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--text-muted)' }}
                />
                <input
                  {...register('password')}
                  type={showPassword ? 'text' : 'password'}
                  className={`input-base pl-9 pr-10 ${errors.password ? 'input-error' : ''}`}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {errors.password && (
                <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>
              )}
            </div>

            {/* Hata */}
            {login.isError && (
              <div
                className="rounded-lg px-4 py-3 text-sm"
                style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#DC2626' }}
              >
                Giriş başarısız. E-posta veya şifrenizi kontrol edin.
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={login.isPending}
              className="btn-primary w-full py-3 text-base mt-2"
            >
              {login.isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Giriş yapılıyor...
                </span>
              ) : (
                'Giriş Yap'
              )}
            </button>
          </form>

          <p className="text-center text-xs mt-8" style={{ color: 'var(--text-muted)' }}>
            Sorun yaşıyorsanız sistem yöneticinizle iletişime geçin.
          </p>
        </div>
      </div>
    </div>
  );
}
