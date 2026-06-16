'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useMe } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { Search, UserRound, ShieldCheck, ShieldOff, KeyRound, Loader2, ChevronDown } from 'lucide-react';

const GOLD = '#d4b876';

type Taxpayer = { id: string; firstName?: string; lastName?: string; companyName?: string; email?: string };
function tpName(t: Taxpayer) {
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isim yok)';
}

export default function MukellefErisimPage() {
  const { data: me } = useMe();
  const isAdmin = !!(me as any)?.roles?.includes('ADMIN');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: taxpayers = [], isLoading } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers', 'portal-erisim', search],
    queryFn: () =>
      api.get('/taxpayers', { params: { scope: 'directory', status: 'all', search: search || undefined } })
        .then((r) => (Array.isArray(r.data) ? r.data : r.data?.data ?? [])),
    enabled: isAdmin,
  });

  if (me && !isAdmin) {
    return (
      <div className="mx-auto max-w-3xl py-20 text-center">
        <ShieldOff size={32} style={{ color: '#f87171', margin: '0 auto 12px' }} />
        <p className="text-[15px] font-semibold" style={{ color: '#fafaf9' }}>Bu sayfa yalnız yöneticilere açık</p>
        <p className="text-[13px] mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>Mükellef portal erişimini yalnız ADMIN rolü yönetebilir.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-12">
      <header className="relative overflow-hidden rounded-2xl border p-5" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'radial-gradient(120% 140% at 0% 0%, rgba(212,184,118,0.16), transparent 45%), #0f0d0b' }}>
        <div className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${GOLD}, #b8863a)` }} />
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: `linear-gradient(135deg, ${GOLD}, #8b7649)` }}>
            <UserRound size={20} style={{ color: '#1a1410' }} />
          </span>
          <div>
            <h1 className="text-[24px] font-semibold leading-tight" style={{ color: '#fafaf9' }}>Mükellef Portal Erişimi</h1>
            <p className="text-[12.5px]" style={{ color: 'rgba(250,250,249,0.5)' }}>Mükellefe self-servis portal girişi açın, e-posta ve şifre belirleyin.</p>
          </div>
        </div>
      </header>

      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,0.4)' }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Mükellef ara…"
          className="w-full pl-10 pr-3 py-2.5 text-[13.5px] rounded-xl outline-none"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
      </div>

      {isLoading ? (
        <div className="py-12 text-center"><Loader2 size={22} className="animate-spin inline" style={{ color: GOLD }} /></div>
      ) : taxpayers.length === 0 ? (
        <p className="py-12 text-center text-[13px]" style={{ color: 'rgba(250,250,249,0.4)' }}>Mükellef bulunamadı.</p>
      ) : (
        <div className="space-y-2">
          {taxpayers.map((t) => (
            <ErisimSatiri key={t.id} taxpayer={t} open={openId === t.id} onToggle={() => setOpenId(openId === t.id ? null : t.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ErisimSatiri({ taxpayer, open, onToggle }: { taxpayer: Taxpayer; open: boolean; onToggle: () => void }) {
  const qc = useQueryClient();
  const { data: status, isLoading } = useQuery({
    queryKey: ['portal-access', taxpayer.id],
    queryFn: () => api.get(`/portal/admin/taxpayers/${taxpayer.id}/access`).then((r) => r.data),
    enabled: open,
  });

  const [portalEmail, setPortalEmail] = useState('');
  const [password, setPassword] = useState('');

  const saveMut = useMutation({
    mutationFn: (body: any) => api.post(`/portal/admin/taxpayers/${taxpayer.id}/access`, body).then((r) => r.data),
    onSuccess: () => {
      toast.success('Portal erişimi güncellendi');
      setPassword('');
      qc.invalidateQueries({ queryKey: ['portal-access', taxpayer.id] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'İşlem başarısız'),
  });

  const enabled = !!status?.portalEnabled;

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between p-3.5 text-left">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-[14px] font-semibold truncate" style={{ color: '#fafaf9' }}>{tpName(taxpayer)}</span>
          {open && enabled && <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md" style={{ background: 'rgba(74,222,128,0.14)', color: '#4ade80' }}><ShieldCheck size={11} /> Açık</span>}
        </div>
        <ChevronDown size={16} style={{ color: 'rgba(250,250,249,0.4)', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && (
        <div className="border-t px-4 pb-4 pt-3 space-y-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          {isLoading ? (
            <Loader2 size={16} className="animate-spin" style={{ color: GOLD }} />
          ) : (
            <>
              <p className="text-[12.5px]" style={{ color: 'rgba(250,250,249,0.55)' }}>
                Durum: <b style={{ color: enabled ? '#4ade80' : '#fbbf24' }}>{enabled ? 'Açık' : 'Kapalı'}</b>
                {status?.portalEmail ? <> · E-posta: <span style={{ color: '#fafaf9' }}>{status.portalEmail}</span></> : null}
                {status?.hasPassword ? ' · Şifre belirli' : ' · Şifre yok'}
              </p>

              <div className="grid sm:grid-cols-2 gap-2">
                <input value={portalEmail} onChange={(e) => setPortalEmail(e.target.value)}
                  placeholder={status?.portalEmail || taxpayer.email || 'Portal e-postası'}
                  className="px-3 py-2.5 text-[13px] rounded-lg outline-none"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fafaf9' }} />
                <div className="relative">
                  <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,0.35)' }} />
                  <input value={password} onChange={(e) => setPassword(e.target.value)} type="text"
                    placeholder="Yeni şifre (en az 6 karakter)"
                    className="w-full pl-9 pr-3 py-2.5 text-[13px] rounded-lg outline-none"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fafaf9' }} />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={saveMut.isPending}
                  onClick={() => saveMut.mutate({ enabled: true, portalEmail: portalEmail || undefined, password: password || undefined })}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold disabled:opacity-40"
                  style={{ background: `linear-gradient(135deg, ${GOLD}, #8b7649)`, color: '#0f0d0b' }}>
                  {saveMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                  {enabled ? 'Güncelle' : 'Erişimi Aç'}
                </button>
                {enabled && (
                  <button type="button" disabled={saveMut.isPending}
                    onClick={() => saveMut.mutate({ enabled: false })}
                    className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold disabled:opacity-40"
                    style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.33)', color: '#f87171' }}>
                    <ShieldOff size={14} /> Kapat
                  </button>
                )}
              </div>
              <p className="text-[11.5px]" style={{ color: 'rgba(250,250,249,0.35)' }}>
                Şifre boş bırakılırsa mevcut şifre korunur. İlk açılışta şifre belirleyin.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
