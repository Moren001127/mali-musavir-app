'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  PortalCredentialPublic,
  PortalProvider,
  portalAutomationApi,
} from '@/lib/portal-automation';

const GOLD = '#d4b876';
const LINE = 'rgba(255,255,255,0.08)';

type FieldSpec = {
  key: 'username' | 'userCode';
  label: string;
  placeholder?: string;
};

type PasswordSpec = {
  passwordLabel: string;
  secondaryPasswordLabel: string;
};

const PROVIDER_TITLES: Record<PortalProvider, string> = {
  GIB_EBEYANNAME: 'Mali Musavir Sistem Sifresi',
  GIB_IVD: 'Vergi Dairesi Sifresi',
  SGK_EBILDIRGE: 'SGK e-Bildirge Girisi',
};

const FIELD_SPECS: Record<PortalProvider, FieldSpec[]> = {
  GIB_EBEYANNAME: [{ key: 'userCode', label: 'Kullanici Kodu' }],
  GIB_IVD: [{ key: 'userCode', label: 'Kullanici Kodu' }],
  SGK_EBILDIRGE: [{ key: 'username', label: 'Kullanici Adi / E-Kod' }],
};

const PASSWORD_SPECS: Record<PortalProvider, PasswordSpec> = {
  GIB_EBEYANNAME: { passwordLabel: 'Parola', secondaryPasswordLabel: 'Sifre' },
  GIB_IVD: { passwordLabel: 'Parola', secondaryPasswordLabel: 'Sifre' },
  SGK_EBILDIRGE: { passwordLabel: 'Sistem Sifresi', secondaryPasswordLabel: 'Isyeri Sifresi' },
};

function getCredential(rows: PortalCredentialPublic[], provider: PortalProvider, taxpayerId?: string) {
  if (provider === 'GIB_EBEYANNAME') {
    return rows.find((c) => c.provider === provider && c.ownerType === 'TENANT') || null;
  }
  return rows.find((c) => c.provider === provider && c.taxpayerId === taxpayerId) || null;
}

export function AdvisorPortalCredentialCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-automation-credentials'],
    queryFn: () => portalAutomationApi.credentials(),
  });
  const credential = useMemo(
    () => getCredential(data?.rows || [], 'GIB_EBEYANNAME'),
    [data?.rows],
  );

  return (
    <div className="card">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-amber-50 border border-amber-200 text-amber-700">
          <KeyRound size={19} />
        </div>
        <div>
          <h3 className="text-base font-semibold" style={{ color: GOLD }}>Mali Musavir e-Beyanname Sifresi</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            e-Beyanname sistem girisi icin kullanici kodu, parola ve sifre.
          </p>
        </div>
      </div>
      {isLoading ? (
        <LoadingLine />
      ) : (
        <CredentialEditor provider="GIB_EBEYANNAME" credential={credential} />
      )}
    </div>
  );
}

export function TaxpayerPortalCredentialsCard({ taxpayerId }: { taxpayerId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-automation-credentials'],
    queryFn: () => portalAutomationApi.credentials(),
    enabled: !!taxpayerId,
  });

  const gibCredential = useMemo(
    () => getCredential(data?.rows || [], 'GIB_IVD', taxpayerId),
    [data?.rows, taxpayerId],
  );
  const sgkCredential = useMemo(
    () => getCredential(data?.rows || [], 'SGK_EBILDIRGE', taxpayerId),
    [data?.rows, taxpayerId],
  );

  if (isLoading) {
    return (
      <div className="card">
        <LoadingLine />
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-amber-50 border border-amber-200 text-amber-700">
          <ShieldCheck size={19} />
        </div>
        <div>
          <h2 className="text-base font-semibold" style={{ color: GOLD }}>Vergi ve SGK Sifreleri</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Bu mukellefin Vergi Dairesi ve SGK e-Bildirge giris bilgileri.
          </p>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <CredentialEditor provider="GIB_IVD" taxpayerId={taxpayerId} credential={gibCredential} compact />
        <CredentialEditor provider="SGK_EBILDIRGE" taxpayerId={taxpayerId} credential={sgkCredential} compact />
      </div>
    </div>
  );
}

function CredentialEditor({
  provider,
  taxpayerId,
  credential,
  compact,
}: {
  provider: PortalProvider;
  taxpayerId?: string;
  credential: PortalCredentialPublic | null;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [userCode, setUserCode] = useState('');
  const [password, setPassword] = useState('');
  const [secondaryPassword, setSecondaryPassword] = useState('');

  useEffect(() => {
    setUsername(credential?.username || '');
    setUserCode(credential?.userCode || '');
    setPassword('');
    setSecondaryPassword('');
  }, [credential?.id, credential?.username, credential?.userCode]);

  const passwordSpec = PASSWORD_SPECS[provider];
  const fields = FIELD_SPECS[provider];

  const saveMut = useMutation({
    mutationFn: () =>
      portalAutomationApi.saveCredential({
        provider,
        taxpayerId: provider === 'GIB_EBEYANNAME' ? undefined : taxpayerId,
        username: fields.some((f) => f.key === 'username') ? username : '',
        userCode: fields.some((f) => f.key === 'userCode') ? userCode : '',
        officeCode: '',
        workplaceCode: '',
        password,
        secondaryPassword,
        isActive: true,
      }),
    onSuccess: () => {
      toast.success('Sifre kaydi guncellendi');
      qc.invalidateQueries({ queryKey: ['portal-automation-credentials'] });
      qc.invalidateQueries({ queryKey: ['portal-automation-summary'] });
      setPassword('');
      setSecondaryPassword('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Sifre kaydedilemedi'),
  });

  const hasIdentity = provider === 'SGK_EBILDIRGE' ? username.trim() : userCode.trim();
  const disabled =
    saveMut.isPending ||
    (provider !== 'GIB_EBEYANNAME' && !taxpayerId) ||
    !hasIdentity ||
    (!credential && (!password || !secondaryPassword));

  return (
    <div
      className={compact ? 'rounded-xl p-4' : 'rounded-xl p-4'}
      style={{ background: compact ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.02)', border: `1px solid ${LINE}` }}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="text-sm font-semibold" style={{ color: '#fafaf9' }}>
            {PROVIDER_TITLES[provider]}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: credential ? '#86efac' : 'rgba(250,250,249,.42)' }}>
            {credential ? 'Kayitli' : 'Kayit yok'}
          </div>
        </div>
        {credential?.lastSuccessAt && (
          <span className="text-[10.5px] px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-300">
            Calisiyor
          </span>
        )}
      </div>

      <div className="grid gap-3">
        {fields.map((field) => (
          <TextInput
            key={field.key}
            label={field.label}
            value={field.key === 'username' ? username : userCode}
            onChange={field.key === 'username' ? setUsername : setUserCode}
            placeholder={field.placeholder}
          />
        ))}
        <PasswordInput
          label={passwordSpec.passwordLabel}
          value={password}
          onChange={setPassword}
          hasSaved={!!credential?.hasPassword}
        />
        <PasswordInput
          label={passwordSpec.secondaryPasswordLabel}
          value={secondaryPassword}
          onChange={setSecondaryPassword}
          hasSaved={!!credential?.hasSecondaryPassword}
        />
      </div>

      {credential?.lastError && (
        <div className="mt-3 text-[11px] rounded-lg px-3 py-2 bg-red-500/10 text-red-200">
          {credential.lastError}
        </div>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() => saveMut.mutate()}
        className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] text-[12.5px] font-bold disabled:opacity-50"
        style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
      >
        {saveMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
        Sifreyi Kaydet
      </button>
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold mb-1" style={{ color: 'rgba(250,250,249,.62)' }}>{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-white/10 bg-black/20 text-white rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
      />
    </label>
  );
}

function PasswordInput({
  label,
  value,
  onChange,
  hasSaved,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hasSaved: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold mb-1" style={{ color: 'rgba(250,250,249,.62)' }}>{label}</span>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hasSaved ? 'Kayitli - degistirmek icin yaz' : ''}
        className="w-full border border-white/10 bg-black/20 text-white rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
      />
    </label>
  );
}

function LoadingLine() {
  return (
    <div className="text-sm text-gray-400 flex items-center gap-2">
      <Loader2 size={14} className="animate-spin" /> Yukleniyor...
    </div>
  );
}
