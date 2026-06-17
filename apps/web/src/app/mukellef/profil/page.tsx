'use client';
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { GOLD, Card, Spinner, PageTitle } from '../_lib/shared';
import { KeyRound, Check, Loader2 } from 'lucide-react';

export default function MukellefProfil() {
  const { data: me, isLoading } = useQuery({ queryKey: ['portal-me'], queryFn: () => taxpayerApi.get('/portal/me').then((r) => r.data) });

  const [mevcut, setMevcut] = useState('');
  const [yeni, setYeni] = useState('');
  const [yeni2, setYeni2] = useState('');
  const [msg, setMsg] = useState<{ tip: 'ok' | 'err'; text: string } | null>(null);

  const sifreMut = useMutation({
    mutationFn: () => taxpayerApi.post('/portal/me/password', { currentPassword: mevcut, newPassword: yeni }).then((r) => r.data),
    onSuccess: () => { setMsg({ tip: 'ok', text: 'Şifreniz güncellendi.' }); setMevcut(''); setYeni(''); setYeni2(''); },
    onError: (e: any) => setMsg({ tip: 'err', text: e?.response?.data?.message || 'Şifre değiştirilemedi.' }),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (yeni.length < 6) return setMsg({ tip: 'err', text: 'Yeni şifre en az 6 karakter olmalı.' });
    if (yeni !== yeni2) return setMsg({ tip: 'err', text: 'Yeni şifreler eşleşmiyor.' });
    sifreMut.mutate();
  }

  if (isLoading) return (<div><PageTitle ust="Hesap" baslik="Profilim" /><Spinner /></div>);

  const ad = me?.companyName || [me?.firstName, me?.lastName].filter(Boolean).join(' ') || '—';
  const rows: Array<[string, string]> = [
    ['Ünvan / Ad', ad],
    ['Tür', me?.type === 'TUZEL_KISI' ? 'Tüzel Kişi' : me?.type === 'GERCEK_KISI' ? 'Gerçek Kişi' : '—'],
    ['VKN / TCKN', me?.taxNumber || '—'],
    ['Vergi Dairesi', me?.taxOffice || '—'],
    ['E-posta', me?.email || '—'],
    ['Telefon', me?.phone || '—'],
    ['Portal e-postası', me?.portalEmail || '—'],
  ];

  const inputStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fafaf9' };

  return (
    <div className="space-y-4">
      <PageTitle ust="Hesap" baslik="Profilim" />
      <Card>
        <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-3 gap-4">
              <span className="text-[12.5px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.4)' }}>{k}</span>
              <span className="text-[13.5px] text-right" style={{ color: '#fafaf9' }}>{v}</span>
            </div>
          ))}
        </div>
        <p className="text-[12px] mt-3" style={{ color: 'rgba(250,250,249,0.35)' }}>
          Bilgilerinizde düzeltme gerekiyorsa müşavirinizle iletişime geçin.
        </p>
      </Card>

      <Card>
        <div className="flex items-center gap-2 mb-4">
          <KeyRound size={15} style={{ color: GOLD }} />
          <h2 className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>Şifre Değiştir</h2>
        </div>
        <form onSubmit={submit} className="space-y-3 max-w-md">
          <input type="password" value={mevcut} onChange={(e) => setMevcut(e.target.value)} placeholder="Mevcut şifreniz" autoComplete="current-password" className="w-full px-3.5 py-2.5 text-[13.5px] rounded-xl outline-none" style={inputStyle} />
          <input type="password" value={yeni} onChange={(e) => setYeni(e.target.value)} placeholder="Yeni şifre (en az 6 karakter)" autoComplete="new-password" className="w-full px-3.5 py-2.5 text-[13.5px] rounded-xl outline-none" style={inputStyle} />
          <input type="password" value={yeni2} onChange={(e) => setYeni2(e.target.value)} placeholder="Yeni şifre (tekrar)" autoComplete="new-password" className="w-full px-3.5 py-2.5 text-[13.5px] rounded-xl outline-none" style={inputStyle} />
          {msg && (
            <div className="text-[12.5px] flex items-center gap-1.5" style={{ color: msg.tip === 'ok' ? '#4ade80' : '#f87171' }}>
              {msg.tip === 'ok' ? <Check size={14} /> : null}{msg.text}
            </div>
          )}
          <button type="submit" disabled={sifreMut.isPending || !mevcut || !yeni || !yeni2} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-40" style={{ background: `linear-gradient(135deg, ${GOLD}, #8b7649)`, color: '#0f0d0b' }}>
            {sifreMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />} Şifreyi Güncelle
          </button>
        </form>
      </Card>
    </div>
  );
}
