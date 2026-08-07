'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Lock, Eye, EyeOff, CheckCircle2, ArrowLeft } from 'lucide-react';

const GOLD = '#d4b876';

export default function SifreSifirlaPage() {
  const [token, setToken] = useState('');
  const [rol, setRol] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'done'>('idle');
  const [err, setErr] = useState('');

  useEffect(() => {
    // useSearchParams Suspense zorunluluğundan kaçınmak için doğrudan URL'den oku.
    try {
      const q = new URLSearchParams(window.location.search);
      setToken(q.get('token') || '');
      setRol(q.get('rol') || '');
    } catch { /* yok */ }
  }, []);
  const isMukellef = rol === 'mukellef';
  const girisHref = isMukellef ? '/giris/mukellef' : '/giris/musavir';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (pw.length < 8) { setErr('Şifre en az 8 karakter olmalı.'); return; }
    if (pw !== pw2) { setErr('Şifreler eşleşmiyor.'); return; }
    if (!token) { setErr('Sıfırlama bağlantısı geçersiz. Yeni bağlantı isteyin.'); return; }
    setStatus('saving');
    try {
      const ep = isMukellef ? '/portal/auth/reset-password' : '/auth/reset-password';
      await api.post(ep, { token, password: pw });
      setStatus('done');
      setTimeout(() => { window.location.href = girisHref; }, 2500);
    } catch (e: any) {
      setStatus('idle');
      setErr(e?.response?.data?.message || 'Şifre güncellenemedi. Bağlantının süresi dolmuş olabilir.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-5" style={{ background: '#17130f' }}>
      <div className="w-full" style={{ maxWidth: 420 }}>
        <div className="flex justify-center mb-8">
          <img src="/brand/moren-logo-gold.png" alt="Moren" style={{ height: 84, width: 'auto', filter: 'drop-shadow(0 8px 30px rgba(212,184,118,.3))' }} />
        </div>
        <div className="rounded-[20px] p-8" style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)' }}>
          {status === 'done' ? (
            <div className="text-center">
              <div className="flex justify-center mb-4"><CheckCircle2 size={44} style={{ color: '#4ade80' }} /></div>
              <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 24, color: '#fafaf9', marginBottom: 10 }}>Şifreniz güncellendi</h1>
              <p className="text-[13.5px] leading-[1.7]" style={{ color: 'rgba(250,250,249,.55)' }}>Yeni şifrenizle giriş yapabilirsiniz. Giriş sayfasına yönlendiriliyorsunuz…</p>
            </div>
          ) : (
            <form onSubmit={submit}>
              <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 26, color: '#fafaf9', marginBottom: 6 }}>Yeni şifre belirle</h1>
              <p className="text-[13px] leading-[1.6] mb-6" style={{ color: 'rgba(250,250,249,.5)' }}>En az 8 karakterli yeni bir şifre girin.</p>

              <label className="block text-[12px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'rgba(250,250,249,.55)' }}>Yeni şifre</label>
              <div className="relative mb-4">
                <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,.3)' }} />
                <input type={show ? 'text' : 'password'} required autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••"
                  className="w-full px-4 py-[15px] pl-12 pr-12 text-[15px] rounded-[14px] outline-none" style={{ color: '#fafaf9', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)' }} />
                <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1" style={{ color: 'rgba(250,250,249,.3)' }}>
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              <label className="block text-[12px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'rgba(250,250,249,.55)' }}>Yeni şifre (tekrar)</label>
              <div className="relative mb-5">
                <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,.3)' }} />
                <input type={show ? 'text' : 'password'} required autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="••••••••"
                  className="w-full px-4 py-[15px] pl-12 text-[15px] rounded-[14px] outline-none" style={{ color: '#fafaf9', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)' }} />
              </div>

              {err && <p className="text-[12.5px] mb-4" style={{ color: '#f43f5e' }}>{err}</p>}

              <button type="submit" disabled={status === 'saving'} className="w-full py-[15px] rounded-[14px] text-[15px] font-bold transition-opacity disabled:opacity-60" style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#17130f' }}>
                {status === 'saving' ? 'Kaydediliyor…' : 'Şifremi güncelle'}
              </button>
              <a href={girisHref} className="flex items-center justify-center gap-2 mt-6 text-[13px] font-medium" style={{ color: 'rgba(250,250,249,.5)' }}>
                <ArrowLeft size={15} /> Girişe dön
              </a>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
