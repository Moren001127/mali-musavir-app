'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Mail, Lock, Eye, EyeOff, ArrowRight, ArrowLeft, UserRound,
  FileText, Wallet, ShieldCheck,
} from 'lucide-react';
import { taxpayerApi, setTaxpayerToken } from '@/lib/taxpayer-api';

const GOLD = '#d4b876';

const features = [
  { icon: FileText,    title: 'Beyanname Takibi', text: 'Durumu anlık görün' },
  { icon: Wallet,      title: 'Cari & Bakiye',    text: 'Hesabınız tek ekranda' },
  { icon: ShieldCheck, title: 'Güvenli Erişim',   text: 'KVKK uyumlu koruma' },
];

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

  const focusOn = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = 'rgba(212,184,118,.4)';
    e.currentTarget.style.background = 'rgba(255,255,255,.06)';
    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(212,184,118,.08)';
  };
  const focusOff = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = 'rgba(255,255,255,.08)';
    e.currentTarget.style.background = 'rgba(255,255,255,.04)';
    e.currentTarget.style.boxShadow = 'none';
  };

  return (
    <div className="min-h-screen flex" style={{ background: '#17130f' }}>
      {/* ═════ SOL — BRAND PANEL ═════ */}
      <div
        className="hidden lg:flex flex-col justify-between relative overflow-hidden"
        style={{
          width: '52%',
          padding: 56,
          background:
            'radial-gradient(ellipse at 15% 5%, rgba(184,160,111,.22), transparent 55%),' +
            'radial-gradient(ellipse at 85% 95%, rgba(184,160,111,.12), transparent 50%),' +
            'radial-gradient(ellipse at 50% 50%, rgba(212,184,118,.04), transparent 70%),' +
            'linear-gradient(160deg, #211c15 0%, #17130f 100%)',
        }}
      >
        {/* Dekoratif halkalar */}
        <div className="absolute pointer-events-none" style={{ borderRadius: '50%', border: '1px solid rgba(184,160,111,.12)', width: 700, height: 700, top: -250, right: -200 }} />
        <div className="absolute pointer-events-none" style={{ borderRadius: '50%', border: '1px solid rgba(184,160,111,.06)', width: 900, height: 900, top: -320, right: -300 }} />
        <div className="absolute pointer-events-none" style={{ borderRadius: '50%', border: '1px solid rgba(184,160,111,.08)', width: 500, height: 500, bottom: -150, left: -150 }} />
        <div className="absolute pointer-events-none" style={{ borderRadius: '50%', border: '1px solid rgba(184,160,111,.05)', width: 300, height: 300, bottom: 100, right: 50 }} />

        {/* Yatay çizgiler */}
        <div className="absolute" style={{ top: '35%', left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(184,160,111,.2), transparent)' }} />
        <div className="absolute" style={{ top: '68%', left: '10%', right: '10%', height: 1, background: 'linear-gradient(90deg, transparent, rgba(184,160,111,.1), transparent)' }} />

        {/* ORTALANMIŞ LOGO */}
        <div className="relative z-10 flex justify-center">
          <img
            src="/brand/moren-logo-gold.png"
            alt="Moren Mali Müşavirlik"
            className="transition-transform duration-500"
            style={{
              height: 150,
              width: 'auto',
              maxWidth: 420,
              filter: 'drop-shadow(0 10px 40px rgba(212,184,118,.35)) drop-shadow(0 2px 10px rgba(0,0,0,.5))',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.03)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
          />
        </div>

        {/* Merkez İçerik */}
        <div className="relative z-10 flex-1 flex flex-col justify-center py-10">
          <h1
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 54,
              fontWeight: 600,
              lineHeight: 1.1,
              letterSpacing: '-0.04em',
              color: '#fafaf9',
              marginBottom: 10,
            }}
          >
            Her şey kontrolünüzde,
            <span className="block mt-1.5 pl-20" style={{ color: '#e3c480', fontWeight: 600 }}>
              <em style={{ fontStyle: 'italic', color: GOLD, fontWeight: 500 }}>her an elinizin altında.</em>
            </span>
          </h1>
          <p className="text-[15px] leading-[1.7] mt-2" style={{ color: 'rgba(250,250,249,.5)', maxWidth: 440 }}>
            Beyanname durumunuzdan cari bakiyenize, yüklediğiniz evraklardan KDV kontrolüne kadar
            tüm mali süreçlerinizi tek ekranda, güvenle takip edin.
          </p>

          <div className="flex gap-7 mt-11">
            {features.map(({ icon: Icon, title, text }) => (
              <div key={title} className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{
                    background: 'linear-gradient(135deg, rgba(184,160,111,.18), rgba(184,160,111,.06))',
                    border: '1px solid rgba(184,160,111,.2)',
                  }}
                >
                  <Icon size={16} style={{ color: GOLD }} />
                </div>
                <div className="text-[13px] leading-[1.3]" style={{ color: 'rgba(250,250,249,.6)' }}>
                  <strong className="block text-[13.5px]" style={{ color: '#fafaf9' }}>{title}</strong>
                  {text}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Alt */}
        <div className="relative z-10 flex items-center justify-between">
          <span className="text-[11px] tracking-wider" style={{ color: 'rgba(250,250,249,.2)' }}>
            © 2026 Moren Mali Müşavirlik
          </span>
          <span
            className="text-[10px] font-bold uppercase px-3.5 py-1.5 rounded-full tracking-[.2em]"
            style={{
              background: 'linear-gradient(135deg, rgba(184,160,111,.15), rgba(184,160,111,.05))',
              border: '1px solid rgba(184,160,111,.25)',
              color: GOLD,
            }}
          >
            Mükellef Portalı
          </span>
        </div>
      </div>

      {/* ═════ SAĞ — FORM PANELİ ═════ */}
      <div
        className="flex-1 flex items-center justify-center relative"
        style={{
          background:
            'radial-gradient(ellipse at 50% 0%, rgba(184,160,111,.06), transparent 50%),' +
            '#1c1813',
        }}
      >
        {/* Üst çizgi */}
        <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(184,160,111,.15), transparent)' }} />

        <div className="w-full max-w-[400px] px-10">
          {/* Giriş türü seçimine dön */}
          <Link
            href="/giris"
            className="inline-flex items-center gap-1.5 text-[12.5px] mb-8 transition-opacity hover:opacity-100"
            style={{ color: 'rgba(250,250,249,.5)', opacity: 0.8 }}
          >
            <ArrowLeft size={14} /> Giriş türü seçimi
          </Link>

          {/* Mobil logo */}
          <div className="lg:hidden flex justify-center mb-8">
            <img
              src="/brand/moren-logo-gold.png"
              alt="Moren"
              style={{ height: 90, width: 'auto', filter: 'drop-shadow(0 8px 24px rgba(212,184,118,.35))' }}
            />
          </div>

          <div className="mb-9">
            <div
              className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider mb-4"
              style={{ background: 'rgba(184,160,111,.12)', border: '1px solid rgba(184,160,111,.25)', color: GOLD }}
            >
              <UserRound size={12} /> Mükellef
            </div>
            <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 32, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
              Mükellef Girişi
            </h2>
            <p className="text-[14px] mt-2" style={{ color: 'rgba(250,250,249,.4)' }}>
              Müşavirinizin verdiği e-posta ve şifreyle giriş yapın
            </p>
          </div>

          <form onSubmit={submit} className="space-y-5">
            {/* E-posta */}
            <div>
              <label className="block text-[12px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'rgba(250,250,249,.55)' }}>
                E-posta Adresi
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,.3)' }} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="ornek@eposta.com"
                  required
                  className="w-full px-4 py-[15px] pl-12 text-[15px] rounded-[14px] outline-none transition-all"
                  style={{ fontFamily: 'Inter, sans-serif', color: '#fafaf9', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)' }}
                  onFocus={focusOn}
                  onBlur={focusOff}
                />
              </div>
            </div>

            {/* Şifre */}
            <div>
              <label className="block text-[12px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'rgba(250,250,249,.55)' }}>
                Şifre
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,.3)' }} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  required
                  className="w-full px-4 py-[15px] pl-12 pr-12 text-[15px] rounded-[14px] outline-none transition-all"
                  style={{ fontFamily: 'Inter, sans-serif', color: '#fafaf9', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)' }}
                  onFocus={focusOn}
                  onBlur={focusOff}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1"
                  style={{ color: 'rgba(250,250,249,.3)' }}
                  aria-label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Hata */}
            {error && (
              <div className="rounded-xl px-4 py-3 text-[13px]" style={{ background: 'rgba(244,63,94,.08)', border: '1px solid rgba(244,63,94,.25)', color: '#f43f5e' }}>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-7 flex items-center justify-center gap-2 py-4 px-6 rounded-[14px] font-bold text-[15px] tracking-wide transition-all disabled:opacity-60"
              style={{
                color: '#0f0d0b',
                background: `linear-gradient(135deg, ${GOLD} 0%, #b8a06f 50%, #8b7649 100%)`,
                fontFamily: 'Inter, sans-serif',
              }}
              onMouseEnter={(e) => {
                if (loading) return;
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 8px 30px rgba(212,184,118,.35), 0 2px 8px rgba(0,0,0,.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(0,0,0,.2)', borderTopColor: '#0f0d0b' }} />
                  Giriş yapılıyor...
                </>
              ) : (
                <>
                  <span>Giriş Yap</span>
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          <div className="text-center mt-8 pt-6" style={{ borderTop: '1px solid rgba(255,255,255,.05)' }}>
            <p className="text-[12px] leading-relaxed" style={{ color: 'rgba(250,250,249,.25)' }}>
              Giriş bilgileriniz yoksa müşavirinizden talep edin.
            </p>
            <div className="flex items-center justify-center gap-1.5 mt-5 text-[11px]" style={{ color: 'rgba(250,250,249,.2)' }}>
              <Lock size={12} />
              <span>256-bit SSL ile korunmaktadır</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
