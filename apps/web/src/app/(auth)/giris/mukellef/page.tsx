'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Mail, Lock, Eye, EyeOff, ArrowRight, ArrowLeft, UserRound } from 'lucide-react';
import { taxpayerApi, setTaxpayerToken } from '@/lib/taxpayer-api';

const GOLD = '#d4b876';

export default function MukellefGirisPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await taxpayerApi.post('/portal/auth/login', { email, password });
      setTaxpayerToken(data.accessToken);
      router.push('/mukellef');
    } catch {
      setError('Giriş başarısız. E-posta veya şifrenizi kontrol edin.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6"
      style={{
        background:
          'radial-gradient(ellipse at 50% 0%, rgba(184,160,111,.08), transparent 55%),' +
          'linear-gradient(160deg, #211c15 0%, #17130f 100%)',
      }}
    >
      <div className="w-full max-w-[400px]">
        <Link href="/giris" className="inline-flex items-center gap-1.5 text-[12.5px] mb-6" style={{ color: 'rgba(250,250,249,.5)' }}>
          <ArrowLeft size={14} /> Giriş türü seçimi
        </Link>

        <div className="flex justify-center mb-6">
          <img src="/brand/moren-logo-gold.png" alt="Moren" style={{ height: 80, width: 'auto', filter: 'drop-shadow(0 8px 24px rgba(212,184,118,.3))' }} />
        </div>

        <div className="mb-7 text-center">
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider mb-3" style={{ background: 'rgba(184,160,111,.12)', border: '1px solid rgba(184,160,111,.25)', color: GOLD }}>
            <UserRound size={12} /> Mükellef
          </div>
          <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 28, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
            Mükellef Girişi
          </h2>
          <p className="text-[13px] mt-2" style={{ color: 'rgba(250,250,249,.4)' }}>
            Müşavirinizin verdiği e-posta ve şifreyle giriş yapın
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="relative">
            <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,.3)' }} />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="E-posta"
              required
              className="w-full px-4 py-[15px] pl-12 text-[15px] rounded-[14px] outline-none"
              style={{ color: '#fafaf9', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)' }}
            />
          </div>
          <div className="relative">
            <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,.3)' }} />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Şifre"
              required
              className="w-full px-4 py-[15px] pl-12 pr-12 text-[15px] rounded-[14px] outline-none"
              style={{ color: '#fafaf9', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)' }}
            />
            <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1" style={{ color: 'rgba(250,250,249,.3)' }}>
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {error && (
            <div className="rounded-xl px-4 py-3 text-[13px]" style={{ background: 'rgba(244,63,94,.08)', border: '1px solid rgba(244,63,94,.25)', color: '#f43f5e' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 flex items-center justify-center gap-2 py-4 rounded-[14px] font-bold text-[15px] disabled:opacity-60"
            style={{ color: '#0f0d0b', background: `linear-gradient(135deg, ${GOLD} 0%, #b8a06f 50%, #8b7649 100%)` }}
          >
            {loading ? (
              <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(0,0,0,.2)', borderTopColor: '#0f0d0b' }} />
            ) : (
              <>Giriş Yap <ArrowRight size={18} /></>
            )}
          </button>
        </form>

        <p className="text-center mt-7 text-[12px]" style={{ color: 'rgba(250,250,249,.3)' }}>
          Giriş bilgileriniz yoksa müşavirinizden talep edin.
        </p>
      </div>
    </div>
  );
}
