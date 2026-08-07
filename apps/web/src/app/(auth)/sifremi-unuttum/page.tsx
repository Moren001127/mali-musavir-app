'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';

const GOLD = '#d4b876';

export default function SifremiUnuttumPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [rol, setRol] = useState('');

  useEffect(() => {
    try { setRol(new URLSearchParams(window.location.search).get('rol') || ''); } catch { /* yok */ }
  }, []);
  const isMukellef = rol === 'mukellef';
  const girisHref = isMukellef ? '/giris/mukellef' : '/giris/musavir';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || status === 'sending') return;
    setStatus('sending');
    // Varlık bilgisi sızdırmamak için backend her durumda 200 döner → hep "gönderildi" göster.
    const ep = isMukellef ? '/portal/auth/forgot-password' : '/auth/forgot-password';
    try { await api.post(ep, { email: email.trim() }); } catch { /* yut */ }
    setStatus('sent');
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-5" style={{ background: '#17130f' }}>
      <div className="w-full" style={{ maxWidth: 420 }}>
        <div className="flex justify-center mb-8">
          <img src="/brand/moren-logo-gold.png" alt="Moren" style={{ height: 84, width: 'auto', filter: 'drop-shadow(0 8px 30px rgba(212,184,118,.3))' }} />
        </div>
        <div className="rounded-[20px] p-8" style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)' }}>
          {status === 'sent' ? (
            <div className="text-center">
              <div className="flex justify-center mb-4"><CheckCircle2 size={44} style={{ color: '#4ade80' }} /></div>
              <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 24, color: '#fafaf9', marginBottom: 10 }}>E-posta gönderildi</h1>
              <p className="text-[13.5px] leading-[1.7]" style={{ color: 'rgba(250,250,249,.55)' }}>
                Girdiğiniz adres kayıtlıysa, şifre sıfırlama bağlantısını e-postanıza gönderdik.
                Bağlantı <b style={{ color: GOLD }}>1 saat</b> geçerlidir. Gelen kutunuzu ve spam klasörünü kontrol edin.
              </p>
              <a href={girisHref} className="inline-flex items-center gap-2 mt-7 text-[13px] font-semibold" style={{ color: GOLD }}>
                <ArrowLeft size={15} /> Girişe dön
              </a>
            </div>
          ) : (
            <form onSubmit={submit}>
              <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 26, color: '#fafaf9', marginBottom: 6 }}>Şifremi unuttum</h1>
              <p className="text-[13px] leading-[1.6] mb-6" style={{ color: 'rgba(250,250,249,.5)' }}>
                Hesabınızın e-posta adresini girin; şifre sıfırlama bağlantısını gönderelim.
              </p>
              <label className="block text-[12px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'rgba(250,250,249,.55)' }}>E-posta</label>
              <div className="relative mb-5">
                <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,.3)' }} />
                <input
                  type="email" required autoFocus autoComplete="email" value={email}
                  onChange={(e) => setEmail(e.target.value)} placeholder="ornek@morenmusavirlik.com"
                  className="w-full px-4 py-[15px] pl-12 text-[15px] rounded-[14px] outline-none"
                  style={{ color: '#fafaf9', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)' }}
                />
              </div>
              <button
                type="submit" disabled={status === 'sending'}
                className="w-full py-[15px] rounded-[14px] text-[15px] font-bold transition-opacity disabled:opacity-60"
                style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#17130f' }}
              >
                {status === 'sending' ? 'Gönderiliyor…' : 'Sıfırlama bağlantısı gönder'}
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
