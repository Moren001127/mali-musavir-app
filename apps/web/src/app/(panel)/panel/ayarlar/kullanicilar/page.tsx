'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi, PortalUser } from '@/lib/users';
import { ArrowLeft, UsersRound, Plus, Trash2, Copy, Check, X as IconX, KeyRound, Mail } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

type Mode = 'password' | 'invite';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function rolesOf(u: PortalUser): string[] {
  return (u.userRoles || []).map((ur) => ur.role?.name).filter(Boolean) as string[];
}

function fullName(u: PortalUser): string {
  return [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email;
}

export default function KullanicilarPage() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['portal-users'],
    queryFn: () => usersApi.list(),
  });

  const deactivateMut = useMutation({
    mutationFn: (id: string) => usersApi.deactivate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-users'] });
      toast.success('Kullanıcı pasife alındı');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'İşlem başarısız'),
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/panel/ayarlar" className="p-2 rounded-lg hover:bg-stone-800/40 text-stone-400 hover:text-stone-200 transition">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2" style={{ color: '#d4b876' }}>
              <UsersRound className="w-6 h-6" /> Kullanıcılar &amp; Erişim
            </h1>
            <p className="text-sm text-stone-400 mt-1">
              Portala giriş yapabilen personel hesapları. Rol: <strong>ADMIN</strong> tam yetki, <strong>STAFF</strong> işlem yapar,
              {' '}<strong>READONLY</strong> sadece görüntüler.
            </p>
          </div>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-bold rounded-lg transition"
          style={{ background: 'linear-gradient(135deg, #d4b876, #b8a06f)', color: '#0f0d0b' }}
        >
          <Plus size={14} /> Yeni Kullanıcı
        </button>
      </div>

      {isLoading && <div className="text-stone-400 text-sm">Yükleniyor...</div>}

      {!isLoading && users.length === 0 && (
        <div className="rounded-lg p-12 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <UsersRound className="w-10 h-10 mx-auto mb-3" style={{ color: 'rgba(250,250,249,0.2)' }} />
          <p className="text-stone-400">Henüz kullanıcı yok.</p>
        </div>
      )}

      {users.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <table className="w-full text-[13px]" style={{ color: 'rgba(250,250,249,0.85)' }}>
            <thead style={{ background: 'rgba(184,160,111,0.08)' }}>
              <tr className="text-left text-[10.5px] uppercase tracking-wider font-semibold" style={{ color: 'rgba(250,250,249,0.55)' }}>
                <th className="px-4 py-3">Kullanıcı</th>
                <th className="px-4 py-3">E-posta</th>
                <th className="px-4 py-3">Rol</th>
                <th className="px-4 py-3">Son Giriş</th>
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const roles = rolesOf(u);
                return (
                  <tr key={u.id} className="group" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                    <td className="px-4 py-2.5 font-medium" style={{ color: '#fafaf9' }}>{fullName(u)}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px]" style={{ color: 'rgba(250,250,249,0.75)' }}>{u.email}</td>
                    <td className="px-4 py-2.5">
                      {roles.length === 0 ? (
                        <span className="text-[11px] italic" style={{ color: 'rgba(250,250,249,0.4)' }}>—</span>
                      ) : (
                        <div className="flex gap-1 flex-wrap">
                          {roles.map((r) => (
                            <span key={r} className="text-[10.5px] font-bold uppercase tracking-wider px-2 py-[2px] rounded" style={{
                              background: r === 'ADMIN' ? 'rgba(244,63,94,0.1)' : r === 'STAFF' ? 'rgba(212,184,118,0.12)' : 'rgba(250,250,249,0.05)',
                              color: r === 'ADMIN' ? '#f43f5e' : r === 'STAFF' ? '#d4b876' : 'rgba(250,250,249,0.6)',
                              border: `1px solid ${r === 'ADMIN' ? 'rgba(244,63,94,0.3)' : r === 'STAFF' ? 'rgba(212,184,118,0.3)' : 'rgba(250,250,249,0.1)'}`,
                            }}>{r}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[12px]" style={{ color: 'rgba(250,250,249,0.6)' }}>{fmtDate(u.lastLoginAt)}</td>
                    <td className="px-4 py-2.5">
                      {u.isActive ? (
                        <span className="text-[10.5px] font-semibold uppercase tracking-wider px-2 py-[2px] rounded" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}>Aktif</span>
                      ) : (
                        <span className="text-[10.5px] font-semibold uppercase tracking-wider px-2 py-[2px] rounded" style={{ background: 'rgba(250,250,249,0.05)', color: 'rgba(250,250,249,0.5)', border: '1px solid rgba(250,250,249,0.1)' }}>Pasif</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {u.isActive && (
                        <button
                          onClick={() => {
                            if (confirm(`${fullName(u)} pasife alınacak. Devam?`)) deactivateMut.mutate(u.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-rose-500/10 transition"
                          style={{ color: 'rgba(244,63,94,0.7)' }}
                          title="Pasife al"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && <AddUserModal onClose={() => setAddOpen(false)} onDone={() => qc.invalidateQueries({ queryKey: ['portal-users'] })} />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// ADD USER MODAL — iki mod: Şifre belirle / Davet gönder (otomatik şifre)
// ════════════════════════════════════════════════════════════
function AddUserModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [roleName, setRoleName] = useState<'ADMIN' | 'STAFF' | 'READONLY'>('STAFF');
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const createMut = useMutation({
    mutationFn: () => usersApi.create({ email, password, firstName, lastName, roleName }),
    onSuccess: () => {
      toast.success('Kullanıcı oluşturuldu');
      onDone();
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Oluşturulamadı'),
  });

  const inviteMut = useMutation({
    mutationFn: () => usersApi.invite({ email, firstName, lastName, roleName }),
    onSuccess: (res) => {
      setTempPassword(res.tempPassword);
      onDone();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Davet başarısız'),
  });

  const copyPassword = async () => {
    if (!tempPassword) return;
    await navigator.clipboard.writeText(tempPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Kopyalandı');
  };

  const handleSubmit = () => {
    if (!email.trim()) return toast.error('E-posta gerekli');
    if (mode === 'password' && password.length < 8) return toast.error('Şifre en az 8 karakter olmalı');
    if (mode === 'password') createMut.mutate();
    else inviteMut.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl overflow-hidden" style={{ background: '#11100c', border: '1px solid rgba(184,160,111,0.3)' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <h3 style={{ fontFamily: 'Fraunces, serif', fontSize: 20, fontWeight: 600, color: '#fafaf9' }}>Yeni Kullanıcı</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-200"><IconX size={18} /></button>
        </div>

        {tempPassword ? (
          <div className="p-5 space-y-4">
            <div className="text-center">
              <div className="w-14 h-14 mx-auto rounded-full flex items-center justify-center mb-3" style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.35)' }}>
                <Check size={24} style={{ color: '#22c55e' }} />
              </div>
              <div className="text-[15px] font-semibold" style={{ color: '#fafaf9' }}>Kullanıcı oluşturuldu</div>
              <div className="text-[12px] mt-1" style={{ color: 'rgba(250,250,249,0.6)' }}>
                {email} — geçici şifre aşağıda
              </div>
            </div>

            <div className="rounded-xl p-4" style={{ background: 'rgba(212,184,118,0.08)', border: '1px solid rgba(212,184,118,0.3)' }}>
              <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: '#d4b876' }}>Geçici Şifre</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[14px] font-bold tabular-nums p-2 rounded" style={{ background: 'rgba(0,0,0,0.4)', color: '#fafaf9', fontFamily: 'JetBrains Mono, monospace' }}>
                  {tempPassword}
                </code>
                <button onClick={copyPassword} className="px-3 py-2 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5"
                  style={{ background: 'rgba(212,184,118,0.15)', color: '#d4b876', border: '1px solid rgba(212,184,118,0.4)' }}>
                  {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Kopyalandı' : 'Kopyala'}
                </button>
              </div>
              <p className="text-[11px] mt-2.5" style={{ color: 'rgba(250,250,249,0.55)' }}>
                Bu şifreyi kullanıcıya güvenli bir kanaldan ilet. İlk girişten sonra profil sayfasından değiştirmesi önerilir.
              </p>
            </div>

            <button onClick={onClose} className="w-full py-2.5 rounded-md text-[13px] font-bold"
              style={{ background: `linear-gradient(135deg, #d4b876, #b8a06f)`, color: '#0f0d0b' }}>
              Kapat
            </button>
          </div>
        ) : (
          <>
            {/* Mod seçici */}
            <div className="flex" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <button onClick={() => setMode('password')}
                className="flex-1 py-3 text-[12.5px] font-semibold inline-flex items-center justify-center gap-2"
                style={{ background: mode === 'password' ? 'rgba(212,184,118,0.1)' : 'transparent', color: mode === 'password' ? '#d4b876' : 'rgba(250,250,249,0.5)' }}>
                <KeyRound size={14} /> Şifre Belirle
              </button>
              <button onClick={() => setMode('invite')}
                className="flex-1 py-3 text-[12.5px] font-semibold inline-flex items-center justify-center gap-2"
                style={{ background: mode === 'invite' ? 'rgba(212,184,118,0.1)' : 'transparent', color: mode === 'invite' ? '#d4b876' : 'rgba(250,250,249,0.5)', borderLeft: '1px solid rgba(255,255,255,0.06)' }}>
                <Mail size={14} /> Davet Gönder
              </button>
            </div>

            <div className="p-5 space-y-3">
              <Field label="E-posta *">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="personel@morenmusavirlik.com" autoFocus
                  className="w-full px-3 py-2 rounded-md text-[14px] font-mono outline-none"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Ad">
                  <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Ali"
                    className="w-full px-3 py-2 rounded-md text-[13px] outline-none"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
                </Field>
                <Field label="Soyad">
                  <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Yılmaz"
                    className="w-full px-3 py-2 rounded-md text-[13px] outline-none"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
                </Field>
              </div>

              <Field label="Rol *">
                <div className="flex gap-1">
                  {(['STAFF', 'ADMIN', 'READONLY'] as const).map((r) => (
                    <button key={r} type="button" onClick={() => setRoleName(r)}
                      className="flex-1 px-3 py-2 text-[12px] font-semibold rounded-md transition"
                      style={{
                        background: roleName === r ? 'rgba(212,184,118,0.16)' : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${roleName === r ? 'rgba(212,184,118,0.4)' : 'rgba(255,255,255,0.08)'}`,
                        color: roleName === r ? '#d4b876' : 'rgba(250,250,249,0.65)',
                      }}>
                      {r}
                    </button>
                  ))}
                </div>
                <p className="text-[10.5px] mt-1.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  {roleName === 'ADMIN' && 'Tam yetki: kullanıcı ekleme, silme, tüm ayarlar.'}
                  {roleName === 'STAFF' && 'Ofis personeli: mükellef, beyanname, fatura işlemleri yapar.'}
                  {roleName === 'READONLY' && 'Sadece görüntüleme: verileri görür, değişiklik yapamaz.'}
                </p>
              </Field>

              {mode === 'password' && (
                <Field label="Şifre * (min 8 karakter)">
                  <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="güçlü-şifre-belirle"
                    className="w-full px-3 py-2 rounded-md text-[14px] outline-none font-mono"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
                  <p className="text-[10.5px] mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
                    Şifreyi kullanıcıya güvenli bir kanaldan ilet.
                  </p>
                </Field>
              )}

              {mode === 'invite' && (
                <div className="rounded-lg p-3 text-[11.5px]" style={{ background: 'rgba(212,184,118,0.06)', border: '1px solid rgba(212,184,118,0.2)', color: 'rgba(250,250,249,0.7)' }}>
                  Sistem rastgele güçlü bir geçici şifre oluşturacak. Şifreyi kopyalayıp kullanıcıya iletirsin.
                </div>
              )}
            </div>

            <div className="px-5 py-3 flex justify-end gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button onClick={onClose} className="px-4 py-2 text-[12.5px] font-medium rounded-md"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}>İptal</button>
              <button onClick={handleSubmit} disabled={!email || createMut.isPending || inviteMut.isPending || (mode === 'password' && password.length < 8)}
                className="px-5 py-2 text-[12.5px] font-bold rounded-md disabled:opacity-40"
                style={{ background: `linear-gradient(135deg, #d4b876, #b8a06f)`, color: '#0f0d0b' }}>
                {(createMut.isPending || inviteMut.isPending) ? 'Oluşturuluyor...' : mode === 'password' ? 'Oluştur' : 'Davet Et'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10.5px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(250,250,249,0.55)' }}>{label}</label>
      {children}
    </div>
  );
}
